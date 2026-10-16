import mongoose from "mongoose";
import { sessionCreditPrice } from "../config/credits.js";
import { CreditTransaction } from "../models/CreditTransaction.js";
import { Notification } from "../models/Notification.js";
import { Session } from "../models/Session.js";
import { User } from "../models/User.js";
import { Dispute } from "../models/Dispute.js";

const fail = (status, message) => Object.assign(new Error(message), { status });
const completionStatuses = ["pending_confirmation", "failed"];

function validateObjectId(id, label) {
  if (!mongoose.isValidObjectId(id)) throw fail(400, `${label} is invalid`);
}

function validateIdempotencyKey(key) {
  if (typeof key !== "string" || !/^[A-Za-z0-9:_-]{8,100}$/.test(key)) {
    throw fail(400, "A valid idempotency key is required");
  }
}

async function inTransaction(operation) {
  const mongoSession = await mongoose.startSession();
  try {
    return await mongoSession.withTransaction(() => operation(mongoSession));
  } catch (error) {
    if (error.code === 20 || error.codeName === "IllegalOperation" ||
      /Transaction numbers are only allowed|replica set member or mongos/i.test(error.message || "")) {
      throw fail(503, "Credit settlement requires MongoDB transactions. Configure a replica set or MongoDB Atlas.");
    }
    throw error;
  } finally {
    await mongoSession.endSession();
  }
}

function notification({ user, actor, sessionId, type, message, suffix }) {
  return {
    user, actor, type, message,
    resourceType: "session",
    resourceId: sessionId,
    dedupeKey: `session:${sessionId}:${suffix}:${user}`
  };
}

async function addNotifications(records, mongoSession) {
  if (!records.length) return [];
  return Notification.create(records, { session: mongoSession, ordered: true });
}

async function populatedSession(sessionId) {
  return Session.findById(sessionId)
    .populate("skill", "name slug")
    .populate("category", "name slug")
    .populate("tutor learner", "name profileImage");
}

function completionResult(session, notifications = [], extras = {}) {
  return { session, notifications, ...extras };
}

async function requireSession(sessionId, mongoSession) {
  const session = await Session.findById(sessionId).session(mongoSession);
  if (!session) throw fail(404, "Session not found");
  return session;
}

function isParticipant(session, userId) {
  return String(session.tutor) === String(userId) || String(session.learner) === String(userId);
}

function ensureParticipants(session, userId) {
  if (!isParticipant(session, userId)) throw fail(403, "Only session participants can access completion details");
}

async function settleInTransaction(session, mongoSession, idempotencyKey) {
  if (session.settlement?.status === "settled") {
    return { settled: true, duplicate: true, balance: null, required: session.settlement.pricePerLearner };
  }
  if (session.status === "disputed" || session.completion?.dispute?.raisedAt) {
    throw fail(409, "A disputed session cannot be settled");
  }
  if (session.status !== "completed" || !session.completion?.tutorRequestedAt ||
    !session.completion?.learnerConfirmedAt) {
    throw fail(409, "Both tutor and learner must confirm completion before settlement");
  }
  if (session.kind !== "one-to-one") {
    throw fail(409, "Group-session settlement is unavailable until group bookings are supported");
  }
  if (session.settlement?.status === "failed" &&
    session.settlement.idempotencyKey === idempotencyKey) {
    return {
      settled: false, duplicate: true,
      balance: session.settlement.availableBalance,
      required: session.settlement.pricePerLearner,
      failureReason: session.settlement.failureReason
    };
  }

  const price = Number(session.settlement?.pricePerLearner || session.creditPrice || sessionCreditPrice());
  if (!Number.isSafeInteger(price) || price < 1) throw fail(500, "Session credit price is invalid");
  const now = new Date();
  const reference = session.settlement?.reference || `session-settlement:${session._id}`;
  const learner = await User.findById(session.learner).select("creditBalance name").session(mongoSession);
  if (!learner) throw fail(409, "The learner account is unavailable");

  session.settlement = {
    ...session.settlement?.toObject?.(),
    status: "processing",
    pricePerLearner: price,
    totalCredits: 0,
    availableBalance: undefined,
    reference,
    idempotencyKey,
    attemptedAt: now,
    failureCode: undefined,
    failureReason: undefined
  };
  await session.save({ session: mongoSession });

  if (learner.creditBalance < price) {
    const message = `Settlement requires ${price} credits; the learner currently has ${learner.creditBalance}.`;
    session.settlement.status = "failed";
    session.settlement.failureCode = "insufficient_credits";
    session.settlement.failureReason = message;
    session.settlement.availableBalance = learner.creditBalance;
    await session.save({ session: mongoSession });
    const notifications = await addNotifications([
      notification({
        user: session.learner, actor: session.tutor, sessionId: session._id,
        type: "session_settlement_failed", message, suffix: `settlement-insufficient:${idempotencyKey}`
      }),
      notification({
        user: session.tutor, actor: session.learner, sessionId: session._id,
        type: "session_settlement_failed", message: "The session is complete, but the learner needs more credits before settlement.",
        suffix: `settlement-insufficient:${idempotencyKey}`
      })
    ], mongoSession);
    return { settled: false, duplicate: false, balance: learner.creditBalance, required: price, failureReason: message, notifications };
  }

  const debit = await User.findOneAndUpdate(
    { _id: session.learner, creditBalance: { $gte: price } },
    { $inc: { creditBalance: -price } },
    { new: false, session: mongoSession }
  ).select("creditBalance");
  if (!debit) {
    throw fail(409, "Learner balance changed during settlement. Retry with a new idempotency key.");
  }
  const tutorBefore = await User.findOneAndUpdate(
    { _id: session.tutor },
    { $inc: { creditBalance: price } },
    { new: false, session: mongoSession }
  ).select("creditBalance");
  if (!tutorBefore) throw fail(409, "The tutor account is unavailable");

  await CreditTransaction.create([
    {
      user: session.learner, amount: price, type: "session-charge", direction: "debit",
      balanceBefore: debit.creditBalance, balanceAfter: debit.creditBalance - price,
      counterparty: session.tutor, session: session._id, reference: `${reference}:debit:${session.learner}`,
      settlementReference: reference, description: `Credits for ${session.title}`
    },
    {
      user: session.tutor, amount: price, type: "session-earning", direction: "credit",
      balanceBefore: tutorBefore.creditBalance, balanceAfter: tutorBefore.creditBalance + price,
      counterparty: session.learner, session: session._id, reference: `${reference}:credit:${session.tutor}`,
      settlementReference: reference, description: `Teaching credits earned: ${session.title}`
    }
  ], { session: mongoSession, ordered: true });

  session.settlement.status = "settled";
  session.settlement.totalCredits = price;
  session.settlement.availableBalance = undefined;
  session.settlement.settledAt = now;
  session.settlement.failureCode = undefined;
  session.settlement.failureReason = undefined;
  await session.save({ session: mongoSession });
  const notifications = await addNotifications([
    notification({
      user: session.learner, actor: session.tutor, sessionId: session._id,
      type: "session_settlement_succeeded", message: `${price} credits were used for your completed session.`,
      suffix: "settlement-success"
    }),
    notification({
      user: session.tutor, actor: session.learner, sessionId: session._id,
      type: "session_settlement_succeeded", message: `You earned ${price} credits for your completed session.`,
      suffix: "settlement-success"
    })
  ], mongoSession);
  return {
    settled: true, duplicate: false, balance: debit.creditBalance - price,
    tutorBalance: tutorBefore.creditBalance + price, required: price, notifications
  };
}

export async function requestSessionCompletion({ sessionId, userId }) {
  validateObjectId(sessionId, "Session id");
  const result = await inTransaction(async mongoSession => {
    const session = await requireSession(sessionId, mongoSession);
    if (String(session.tutor) !== String(userId)) throw fail(403, "Only the tutor can request completion confirmation");
    if (session.status !== "scheduled") throw fail(409, "Only a scheduled session can enter completion confirmation");
    if (session.endsAt > new Date()) throw fail(409, "Completion can be requested after the scheduled session has ended");
    if (session.completion?.tutorRequestedAt) return { duplicate: true, notifications: [] };
    const now = new Date();
    session.completion = { ...session.completion?.toObject?.(), tutorRequestedAt: now };
    session.completionConfirmedBy.addToSet(session.tutor);
    session.settlement.status = "pending_confirmation";
    session.settlement.pricePerLearner = session.creditPrice || sessionCreditPrice();
    session.settlement.reference = `session-settlement:${session._id}`;
    await session.save({ session: mongoSession });
    const notifications = await addNotifications([notification({
      user: session.learner, actor: session.tutor, sessionId: session._id,
      type: "session_completion_requested",
      message: "The tutor marked this session complete. Confirm completion or raise a dispute.",
      suffix: "completion-requested"
    })], mongoSession);
    return { duplicate: false, notifications };
  });
  return completionResult(await populatedSession(sessionId), result.notifications, { duplicate: result.duplicate });
}

export async function confirmSessionCompletion({ sessionId, userId, idempotencyKey }) {
  validateObjectId(sessionId, "Session id");
  const key = idempotencyKey || `completion:${sessionId}`;
  validateIdempotencyKey(key);
  const result = await inTransaction(async mongoSession => {
    const session = await requireSession(sessionId, mongoSession);
    if (String(session.learner) !== String(userId)) throw fail(403, "Only the intended learner can confirm completion");
    if (session.status === "disputed") throw fail(409, "A disputed session cannot be confirmed or settled");
    if (session.status !== "scheduled" && session.status !== "completed") {
      throw fail(409, "This session is not eligible for completion confirmation");
    }
    if (!session.completion?.tutorRequestedAt) throw fail(409, "The tutor has not requested completion confirmation");
    if (session.completion?.dispute?.raisedAt) throw fail(409, "A disputed session cannot be settled");
    const alreadyConfirmed = Boolean(session.completion?.learnerConfirmedAt);
    if (!alreadyConfirmed) {
      const now = new Date();
      session.completion = { ...session.completion?.toObject?.(), learnerConfirmedAt: now };
      session.completionConfirmedBy.addToSet(session.learner);
      session.status = "completed";
      session.completedAt = now;
      session.settlement.status = "pending_confirmation";
      await session.save({ session: mongoSession });
    }
    const completionNotifications = alreadyConfirmed ? [] : await addNotifications([
      notification({
        user: session.tutor, actor: session.learner, sessionId: session._id,
        type: "session_completion_confirmed", message: "The learner confirmed completion of your session.",
        suffix: "completion-confirmed"
      }),
      notification({
        user: session.learner, actor: session.learner, sessionId: session._id,
        type: "session_completion_confirmed", message: "You confirmed completion of this session.",
        suffix: "completion-confirmed"
      })
    ], mongoSession);
    const settlement = await settleInTransaction(session, mongoSession, key);
    return {
      duplicate: alreadyConfirmed && settlement.duplicate,
      notifications: [...completionNotifications, ...(settlement.notifications || [])],
      settlement
    };
  });
  return completionResult(await populatedSession(sessionId), result.notifications, {
    duplicate: result.duplicate,
    settlement: result.settlement
  });
}

export async function disputeSessionCompletion({ sessionId, userId, reason }) {
  validateObjectId(sessionId, "Session id");
  if (typeof reason !== "string" || reason.trim().length < 3 || reason.trim().length > 1000) {
    throw fail(400, "Dispute reason must be between 3 and 1000 characters");
  }
  const result = await inTransaction(async mongoSession => {
    const session = await requireSession(sessionId, mongoSession);
    if (String(session.learner) !== String(userId)) throw fail(403, "Only the intended learner can dispute completion");
    if (session.status !== "scheduled" || !session.completion?.tutorRequestedAt ||
      session.completion?.learnerConfirmedAt) {
      throw fail(409, "This session is not eligible for a completion dispute");
    }
    if (session.completion?.dispute?.raisedAt) return { duplicate: true, notifications: [] };
    const now = new Date();
    session.status = "disputed";
    session.completion = {
      ...session.completion?.toObject?.(),
      dispute: { raisedBy: userId, reason: reason.trim(), raisedAt: now }
    };
    session.settlement.status = "not_started";
    session.settlement.failureCode = "disputed";
    session.settlement.failureReason = "Settlement is blocked while this dispute is unresolved.";
    await session.save({ session: mongoSession });
    const existingDispute = await Dispute.findOne({ session: session._id }).session(mongoSession);
    if (!existingDispute) {
      await Dispute.create([{
        session: session._id,
        openedBy: userId,
        tutor: session.tutor,
        learner: session.learner,
        reason: "Completion dispute",
        description: reason.trim(),
        status: "OPEN",
        history: [{ status: "OPEN", actor: userId, note: "Completion disputed by the learner", at: now }]
      }], { session: mongoSession });
    }
    const notifications = await addNotifications([
      notification({
        user: session.tutor, actor: userId, sessionId: session._id,
        type: "session_disputed", message: "The learner raised a dispute about session completion.",
        suffix: "completion-disputed:tutor"
      }),
      notification({
        user: session.learner, actor: userId, sessionId: session._id,
        type: "session_disputed", message: "Your completion dispute was recorded. Credits will not transfer while it is unresolved.",
        suffix: "completion-disputed:learner"
      })
    ], mongoSession);
    return { duplicate: false, notifications };
  });
  return completionResult(await populatedSession(sessionId), result.notifications, { duplicate: result.duplicate });
}

export async function settleCompletedSession({ sessionId, userId, idempotencyKey }) {
  validateObjectId(sessionId, "Session id");
  validateIdempotencyKey(idempotencyKey);
  const result = await inTransaction(async mongoSession => {
    const session = await requireSession(sessionId, mongoSession);
    ensureParticipants(session, userId);
    const settlement = await settleInTransaction(session, mongoSession, idempotencyKey);
    return { settlement, notifications: settlement.notifications || [] };
  });
  return completionResult(await populatedSession(sessionId), result.notifications, {
    duplicate: result.settlement.duplicate,
    settlement: result.settlement
  });
}

export async function getSessionCompletion({ sessionId, userId }) {
  validateObjectId(sessionId, "Session id");
  const session = await Session.findById(sessionId)
    .populate("tutor learner", "name profileImage");
  if (!session) throw fail(404, "Session not found");
  ensureParticipants(session, userId);
  return {
    sessionId: session._id,
    status: session.status,
    tutor: session.tutor,
    learner: session.learner,
    completion: session.completion,
    completionConfirmedBy: session.completionConfirmedBy,
    completedAt: session.completedAt,
    settlement: session.settlement,
    creditPrice: session.creditPrice || sessionCreditPrice(),
    actions: {
      tutorCanRequest: String(session.tutor._id) === String(userId) &&
        session.status === "scheduled" && session.endsAt <= new Date() &&
        !session.completion?.tutorRequestedAt,
      learnerCanConfirm: String(session.learner._id) === String(userId) &&
        session.status === "scheduled" && Boolean(session.completion?.tutorRequestedAt) &&
        !session.completion?.learnerConfirmedAt && !session.completion?.dispute?.raisedAt,
      learnerCanDispute: String(session.learner._id) === String(userId) &&
        session.status === "scheduled" && Boolean(session.completion?.tutorRequestedAt) &&
        !session.completion?.learnerConfirmedAt && !session.completion?.dispute?.raisedAt,
      canSettle: ["completed"].includes(session.status) &&
        Boolean(session.completion?.tutorRequestedAt && session.completion?.learnerConfirmedAt) &&
        session.settlement?.status !== "settled"
    }
  };
}

export async function getWalletSummary(userId) {
  const user = await User.findById(userId).select("creditBalance");
  if (!user) throw fail(404, "User not found");
  const [summary = {}] = await CreditTransaction.aggregate([
    { $match: { user: new mongoose.Types.ObjectId(String(userId)) } },
    { $group: {
      _id: null,
      earned: { $sum: { $cond: [{ $eq: ["$type", "session-earning"] }, "$amount", 0] } },
      spent: { $sum: { $cond: [{ $eq: ["$type", "session-charge"] }, "$amount", 0] } },
      signupCredits: { $sum: { $cond: [{ $eq: ["$type", "signup-grant"] }, "$amount", 0] } },
      adjustments: { $sum: { $cond: [{ $eq: ["$type", "admin-adjustment"] }, "$amount", 0] } },
      adjustmentCredits: { $sum: { $cond: [{ $and: [{ $eq: ["$type", "admin-adjustment"] }, { $eq: ["$direction", "credit"] }] }, "$amount", 0] } },
      adjustmentDebits: { $sum: { $cond: [{ $and: [{ $eq: ["$type", "admin-adjustment"] }, { $eq: ["$direction", "debit"] }] }, "$amount", 0] } }
    } }
  ]);
  const pendingSessions = await Session.find({
    $or: [{ tutor: userId }, { learner: userId }],
    "settlement.status": { $in: completionStatuses }
  }).sort({ updatedAt: -1 }).limit(10)
    .select("title status settlement tutor learner startsAt")
    .populate("tutor learner", "name");
  return {
    balance: user.creditBalance,
    earned: summary.earned || 0,
    spent: summary.spent || 0,
    signupCredits: summary.signupCredits || 0,
    adjustments: summary.adjustments || 0,
    adjustmentCredits: summary.adjustmentCredits || 0,
    adjustmentDebits: summary.adjustmentDebits || 0,
    pendingSettlements: pendingSessions
  };
}

export async function listWalletTransactions({ userId, query }) {
  const page = Number(query.page || 1);
  const limit = Number(query.limit || 20);
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw fail(400, "Page must be positive and page size must be 1–50");
  }
  const [transactions, total] = await Promise.all([
    CreditTransaction.find({ user: userId }).sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit).limit(limit)
      .populate("session", "title startsAt timezone status settlement")
      .populate("counterparty", "name profileImage"),
    CreditTransaction.countDocuments({ user: userId })
  ]);
  return { transactions, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
}

export async function getWalletTransaction({ userId, transactionId }) {
  validateObjectId(transactionId, "Transaction id");
  const transaction = await CreditTransaction.findOne({ _id: transactionId, user: userId })
    .populate("session", "title startsAt timezone status settlement")
    .populate("counterparty", "name profileImage");
  if (!transaction) throw fail(404, "Transaction not found");
  return transaction;
}

export async function reconcileSessionSettlement(sessionId) {
  validateObjectId(sessionId, "Session id");
  const session = await Session.findById(sessionId);
  if (!session) throw fail(404, "Session not found");
  const entries = await CreditTransaction.find({ session: session._id }).select("amount type direction user reference settlementReference createdAt");
  const debits = entries.filter(entry => entry.direction === "debit" && entry.type === "session-charge");
  const credits = entries.filter(entry => entry.direction === "credit" && entry.type === "session-earning");
  const debitTotal = debits.reduce((total, entry) => total + entry.amount, 0);
  const tutorCreditTotal = credits.reduce((total, entry) => total + entry.amount, 0);
  const balanced = session.settlement?.status === "settled" &&
    debitTotal === tutorCreditTotal &&
    tutorCreditTotal === session.settlement.totalCredits &&
    debits.length === 1 && credits.length === 1;
  return {
    sessionId: session._id,
    status: session.settlement?.status || "not_started",
    expectedCharge: session.settlement?.pricePerLearner || session.creditPrice || sessionCreditPrice(),
    debitTotal,
    tutorCreditTotal,
    balanced: session.settlement?.status === "settled" ? balanced : null,
    references: entries.map(entry => entry.reference)
  };
}

export async function listSettlementAudit({ query }) {
  const page = Number(query.page || 1);
  const limit = Number(query.limit || 20);
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw fail(400, "Page must be positive and page size must be 1–50");
  }
  const filter = { "settlement.status": { $in: ["pending_confirmation", "settled", "failed"] } };
  if (query.status && !["pending_confirmation", "settled", "failed"].includes(query.status)) throw fail(400, "Settlement status filter is invalid");
  if (query.status) filter["settlement.status"] = query.status;
  const [sessions, total] = await Promise.all([
    Session.find(filter).sort({ updatedAt: -1 }).skip((page - 1) * limit).limit(limit)
      .populate("tutor learner", "name email"),
    Session.countDocuments(filter)
  ]);
  const items = await Promise.all(sessions.map(async session => ({
    sessionId: session._id,
    tutor: session.tutor,
    learner: session.learner,
    status: session.settlement.status,
    expectedCharge: session.settlement.pricePerLearner || session.creditPrice,
    totalCredits: session.settlement.totalCredits,
    failureReason: session.settlement.failureReason,
    idempotencyReference: session.settlement.reference,
    idempotencyKey: session.settlement.idempotencyKey,
    attemptedAt: session.settlement.attemptedAt,
    settledAt: session.settlement.settledAt,
    entries: await CreditTransaction.find({ session: session._id }).select("user amount type direction reference balanceBefore balanceAfter createdAt")
  })));
  return { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
}
