import mongoose from "mongoose";
import { CreditTransaction } from "../models/CreditTransaction.js";
import { AuditLog } from "../models/AuditLog.js";
import { Category } from "../models/Category.js";
import { Dispute } from "../models/Dispute.js";
import { Message } from "../models/Message.js";
import { Notification } from "../models/Notification.js";
import { Review } from "../models/Review.js";
import { Session } from "../models/Session.js";
import { SubscriptionPlan } from "../models/SubscriptionPlan.js";
import { UsagePolicy } from "../models/UsagePolicy.js";
import { User } from "../models/User.js";
import { failure, success } from "../utils/responses.js";
import { activeAccountFilter } from "../utils/accountAccess.js";

const fail = (status, message) => Object.assign(new Error(message), { status });
const safeId = value => typeof value === "string" && mongoose.isValidObjectId(value);
const pageOptions = query => {
  const page = Number(query.page || 1);
  const limit = Number(query.limit || 20);
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100) return null;
  return { page, limit, skip: (page - 1) * limit };
};
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const adminController = {
  dashboard: async (_req, res) => {
    const [
      users, verified, unverified, tutors, learners, sessionStatuses,
      [creditTotals = { issued: 0, transferred: 0 }], [rating = { average: 0, count: 0 }],
      policy, plans
    ] = await Promise.all([
      User.countDocuments({}),
      User.countDocuments({ isEmailVerified: true }),
      User.countDocuments({ isEmailVerified: false }),
      User.countDocuments({ ...activeAccountFilter(), skillsToTeach: { $exists: true, $ne: [] } }),
      User.countDocuments({ ...activeAccountFilter(), skillsToLearn: { $exists: true, $ne: [] } }),
      Session.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
      CreditTransaction.aggregate([
        { $group: {
          _id: null,
          issued: { $sum: { $cond: [
            { $and: [{ $eq: ["$direction", "credit"] }, { $in: ["$type", ["signup-grant", "admin-adjustment"]] }] },
            "$amount", 0
          ] } },
          transferred: { $sum: { $cond: [{ $eq: ["$type", "session-charge"] }, "$amount", 0] } }
        } },
        { $project: { _id: 0, issued: 1, transferred: 1 } }
      ]),
      Review.aggregate([{ $group: { _id: null, average: { $avg: "$rating" }, count: { $sum: 1 } } }]),
      UsagePolicy.findOne({ key: "default" }).lean(),
      SubscriptionPlan.find().select("name price currency usageLimit cooldownHours isFree isActive billingPeriod").sort({ displayOrder: 1 }).lean()
    ]);
    return success(res, 200, "Admin dashboard retrieved", {
      users: { total: users, verified, unverified, activeTutors: tutors, activeLearners: learners },
      sessions: Object.fromEntries(["pending", "scheduled", "completed", "cancelled", "rejected", "disputed"]
        .map(status => [status, sessionStatuses.find(item => item._id === status)?.count || 0])),
      credits: creditTotals,
      reviews: { count: rating.count, average: Math.round(rating.average * 100) / 100 },
      usage: policy || { activeActions: ["tutor_search", "connection_request"], dailyLimit: 5, cooldownHours: 12 },
      plans
    });
  },

  categories: async (req, res) => {
    const paging = pageOptions(req.query);
    if (!paging) return failure(res, 400, "Page must be positive and page size must be 1–100");
    const filter = {};
    if (req.query.active !== undefined) {
      if (!["true", "false"].includes(req.query.active)) return failure(res, 400, "Category active filter is invalid");
      filter.isActive = req.query.active === "true";
    }
    if (req.query.q !== undefined) {
      if (typeof req.query.q !== "string" || req.query.q.length > 100) return failure(res, 400, "Category search query is too long");
      filter.name = { $regex: escapeRegex(req.query.q.trim()), $options: "i" };
    }
    const [categories, total] = await Promise.all([
      Category.find(filter).sort({ name: 1 }).skip(paging.skip).limit(paging.limit)
        .populate("parent", "name slug").lean(),
      Category.countDocuments(filter)
    ]);
    return success(res, 200, "Categories retrieved", {
      categories, pagination: { page: paging.page, limit: paging.limit, total, pages: Math.ceil(total / paging.limit) }
    });
  },

  users: async (req, res) => {
    const paging = pageOptions(req.query);
    if (!paging) return failure(res, 400, "Page must be positive and page size must be 1–100");
    const filter = {};
    if (req.query.status) {
      if (!["pending", "active", "suspended", "deleted"].includes(req.query.status)) return failure(res, 400, "Account status filter is invalid");
      filter.accountStatus = req.query.status;
    }
    if (req.query.verified !== undefined) {
      if (!["true", "false"].includes(req.query.verified)) return failure(res, 400, "Verification filter is invalid");
      filter.isEmailVerified = req.query.verified === "true";
    }
    if (req.query.q !== undefined) {
      if (typeof req.query.q !== "string" || req.query.q.length > 100) return failure(res, 400, "Search query is too long");
      const term = escapeRegex(req.query.q.trim());
      filter.$or = [{ name: { $regex: term, $options: "i" } }, { email: { $regex: term, $options: "i" } }];
    }
    const [items, total] = await Promise.all([
      User.find(filter).select("name email accountStatus isEmailVerified accountType createdAt lastLoginAt skillsToTeach skillsToLearn")
        .sort({ createdAt: -1, _id: -1 }).skip(paging.skip).limit(paging.limit).lean(),
      User.countDocuments(filter)
    ]);
    return success(res, 200, "Users retrieved", {
      users: items, pagination: { page: paging.page, limit: paging.limit, total, pages: Math.ceil(total / paging.limit) }
    });
  },

  userSessions: async (req, res) => {
    if (!safeId(req.params.userId)) return failure(res, 400, "User id is invalid");
    const paging = pageOptions(req.query);
    if (!paging) return failure(res, 400, "Page must be positive and page size must be 1–100");
    if (!(await User.exists({ _id: req.params.userId }))) return failure(res, 404, "User not found");
    const filter = { $or: [{ tutor: req.params.userId }, { learner: req.params.userId }] };
    if (req.query.status) {
      const statuses = String(req.query.status).split(",");
      if (statuses.length > 6 || statuses.some(status => !["pending", "scheduled", "completed", "cancelled", "rejected", "disputed"].includes(status))) {
        return failure(res, 400, "Session status filter is invalid");
      }
      filter.status = { $in: statuses };
    }
    const [sessions, total] = await Promise.all([
      Session.find(filter).sort({ startsAt: -1 }).skip(paging.skip).limit(paging.limit)
        .populate("skill", "name").populate("tutor learner", "name email"),
      Session.countDocuments(filter)
    ]);
    return success(res, 200, "User session history retrieved", {
      sessions, pagination: { page: paging.page, limit: paging.limit, total, pages: Math.ceil(total / paging.limit) }
    });
  },

  setUserStatus: async (req, res) => {
    if (!safeId(req.params.userId)) return failure(res, 400, "User id is invalid");
    const { accountStatus, reason } = req.body || {};
    if (!["active", "suspended"].includes(accountStatus) ||
      typeof reason !== "string" || reason.trim().length < 5 || reason.trim().length > 500) {
      return failure(res, 400, "Choose active or suspended and provide a reason of 5–500 characters");
    }
    if (String(req.user._id) === req.params.userId) return failure(res, 409, "Administrators cannot change their own account status");
    const user = await User.findById(req.params.userId);
    if (!user) return failure(res, 404, "User not found");
    if (user.accountType === "admin") return failure(res, 403, "Administrator accounts require the controlled provisioning process");
    if (accountStatus === "active" && !user.isEmailVerified && user.emailVerificationRequired) {
      return failure(res, 409, "An unverified account cannot be reactivated");
    }
    const previousStatus = user.accountStatus;
    if (previousStatus === accountStatus) return success(res, 200, "Account status is unchanged", {
      user: { _id: user._id, name: user.name, email: user.email, accountStatus: user.accountStatus }
    });
    const mongoSession = await mongoose.startSession();
    let updated;
    let notification;
    try {
      await mongoSession.withTransaction(async () => {
        updated = await User.findOneAndUpdate(
          { _id: user._id, accountStatus: previousStatus, accountType: { $ne: "admin" } },
          { $set: { accountStatus } },
          { new: true, runValidators: true, session: mongoSession }
        ).select("name email accountStatus");
        if (!updated) throw fail(409, "Account status changed during this request; reload and retry");
        await AuditLog.create([{
          actor: req.user._id,
          action: accountStatus === "suspended" ? "admin.user.suspend" : "admin.user.reactivate",
          resourceType: "user",
          resourceId: String(user._id),
          outcome: "success",
          metadata: { previousStatus, nextStatus: accountStatus, reason: reason.trim() }
        }], { session: mongoSession });
        [notification] = await Notification.create([{
          user: updated._id, actor: req.user._id,
          type: accountStatus === "suspended" ? "account_suspended" : "account_reactivated",
          message: accountStatus === "suspended"
            ? "Your account has been suspended. Contact support if you believe this is an error."
            : "Your account has been reactivated.",
          resourceType: "user", resourceId: updated._id,
          dedupeKey: `account-status:${updated._id}:${accountStatus}:${Date.now()}`
        }], { session: mongoSession });
      });
    } finally {
      await mongoSession.endSession();
    }
    req.app.get("io")?.to(`user:${updated._id}`).emit("notification:new", notification);
    req.app.get("io")?.to(`user:${updated._id}`).emit("account:status", { accountStatus });
    if (accountStatus === "suspended") req.app.get("io")?.in(`user:${updated._id}`).disconnectSockets(true);
    return success(res, 200, "Account status updated", {
      user: { _id: updated._id, name: updated.name, email: updated.email, accountStatus: updated.accountStatus },
      previousStatus,
      reason: reason.trim()
    });
  },

  disputes: async (req, res) => {
    const paging = pageOptions(req.query);
    if (!paging) return failure(res, 400, "Page must be positive and page size must be 1–100");
    const filter = {};
    if (req.query.status) {
      if (!["OPEN", "UNDER_REVIEW", "RESOLVED", "REJECTED"].includes(req.query.status)) return failure(res, 400, "Dispute status filter is invalid");
      filter.status = req.query.status;
    }
    const [disputes, total] = await Promise.all([
      Dispute.find(filter).sort({ createdAt: -1, _id: -1 }).skip(paging.skip).limit(paging.limit)
        .populate("session", "title startsAt timezone status settlement")
        .populate("openedBy tutor learner", "name email"),
      Dispute.countDocuments(filter)
    ]);
    return success(res, 200, "Disputes retrieved", {
      disputes, pagination: { page: paging.page, limit: paging.limit, total, pages: Math.ceil(total / paging.limit) }
    });
  },

  disputeDetail: async (req, res) => {
    if (!safeId(req.params.disputeId)) return failure(res, 400, "Dispute id is invalid");
    const dispute = await Dispute.findById(req.params.disputeId)
      .populate("session", "title description startsAt endsAt timezone status completion settlement conversation skill category")
      .populate("openedBy tutor learner", "name email accountStatus");
    if (!dispute) return failure(res, 404, "Dispute not found");
    const sessionId = dispute.session._id;
    const [messages, ledger] = await Promise.all([
      Message.find({ conversation: dispute.session.conversation, deletedAt: { $exists: false } })
        .sort({ createdAt: -1 }).limit(100).populate("sender", "name").select("sender text createdAt editedAt"),
      CreditTransaction.find({ session: sessionId }).sort({ createdAt: 1 }).populate("user", "name").lean()
    ]);
    return success(res, 200, "Dispute details retrieved", { dispute, messages: messages.reverse(), ledger });
  },

  reviewDispute: async (req, res) => {
    if (!safeId(req.params.disputeId)) return failure(res, 400, "Dispute id is invalid");
    const { note = "" } = req.body || {};
    if (typeof note !== "string" || note.length > 2000) return failure(res, 400, "Internal note is invalid");
    const dispute = await Dispute.findOneAndUpdate({
      _id: req.params.disputeId, status: { $in: ["OPEN", "UNDER_REVIEW"] }
    }, {
      $set: { status: "UNDER_REVIEW" },
      $push: {
        history: { status: "UNDER_REVIEW", actor: req.user._id, note: "Status changed to under review." },
        ...(note.trim() ? { internalNotes: note.trim() } : {})
      }
    }, { new: true, runValidators: true });
    if (!dispute) {
      if (!(await Dispute.exists({ _id: req.params.disputeId }))) return failure(res, 404, "Dispute not found");
      return failure(res, 409, "This dispute is already closed");
    }
    const notifications = await notifyDispute(dispute, req.user._id, "dispute_under_review", "Your session dispute is now under review.");
    emitNotifications(req, notifications);
    return success(res, 200, "Dispute moved to review", { dispute });
  },

  resolveDispute: async (req, res) => {
    if (!safeId(req.params.disputeId)) return failure(res, 400, "Dispute id is invalid");
    const { status, summary, internalNote = "", adjustment = null } = req.body || {};
    if (!["RESOLVED", "REJECTED"].includes(status) ||
      typeof summary !== "string" || summary.trim().length < 5 || summary.trim().length > 2000 ||
      typeof internalNote !== "string" || internalNote.length > 2000) {
      return failure(res, 400, "Resolution status, summary, or internal note is invalid");
    }
    if (adjustment !== null && (!adjustment || !safeId(adjustment.userId) ||
      !["credit", "debit"].includes(adjustment.direction) ||
      !Number.isSafeInteger(adjustment.amount) || adjustment.amount < 1 || adjustment.amount > 100000 ||
      typeof adjustment.description !== "string" || adjustment.description.trim().length < 3 ||
      adjustment.description.trim().length > 300)) {
      return failure(res, 400, "Credit adjustment must specify an involved user, direction, positive amount, and description");
    }
    const mongoSession = await mongoose.startSession();
    let dispute;
    let notifications = [];
    let adjustmentEntry = null;
    try {
      await mongoSession.withTransaction(async () => {
        dispute = await Dispute.findById(req.params.disputeId).session(mongoSession);
        if (!dispute) throw fail(404, "Dispute not found");
        if (!["OPEN", "UNDER_REVIEW"].includes(dispute.status)) throw fail(409, "This dispute has already been resolved");
        const now = new Date();
        if (adjustment) {
          const targetId = String(adjustment.userId);
          if (![String(dispute.tutor), String(dispute.learner)].includes(targetId)) {
            throw fail(400, "Credit adjustments can only affect a dispute participant");
          }
          const reference = `dispute-adjustment:${dispute._id}:${req.get("Idempotency-Key") || ""}`;
          if (!/dispute-adjustment:[a-f\d]{24}:[A-Za-z0-9:_-]{8,100}/i.test(reference)) {
            throw fail(400, "A valid Idempotency-Key is required when applying a credit adjustment");
          }
          if (await CreditTransaction.exists({ reference }).session(mongoSession)) {
            throw fail(409, "This credit adjustment was already processed");
          }
          const criteria = { _id: targetId };
          if (adjustment.direction === "debit") criteria.creditBalance = { $gte: adjustment.amount };
          else criteria.creditBalance = { $lte: Number.MAX_SAFE_INTEGER - adjustment.amount };
          const before = await User.findOneAndUpdate(criteria, {
            $inc: { creditBalance: adjustment.direction === "credit" ? adjustment.amount : -adjustment.amount }
          }, { new: false, session: mongoSession }).select("creditBalance");
          if (!before) throw fail(409, adjustment.direction === "debit"
            ? "The participant does not have enough credits for this adjustment"
            : "The resulting credit balance would exceed the supported limit");
          [adjustmentEntry] = await CreditTransaction.create([{
            user: targetId, amount: adjustment.amount, type: "admin-adjustment", direction: adjustment.direction,
            balanceBefore: before.creditBalance,
            balanceAfter: before.creditBalance + (adjustment.direction === "credit" ? adjustment.amount : -adjustment.amount),
            counterparty: String(dispute.tutor) === targetId ? dispute.learner : dispute.tutor,
            session: dispute.session, reference,
            settlementReference: `dispute:${dispute._id}`,
            description: adjustment.description.trim()
          }], { session: mongoSession });
          await AuditLog.create([{
            actor: req.user._id,
            action: "admin.dispute.credit_adjustment",
            resourceType: "dispute",
            resourceId: String(dispute._id),
            outcome: "success",
            metadata: {
              user: targetId,
              direction: adjustment.direction,
              amount: adjustment.amount,
              reference
            }
          }], { session: mongoSession });
          dispute.adjustment = { reference, transaction: adjustmentEntry._id };
        }
        dispute.status = status;
        dispute.resolutionSummary = summary.trim();
        dispute.resolvedBy = req.user._id;
        dispute.resolvedAt = now;
        if (internalNote.trim()) dispute.internalNotes.push(internalNote.trim());
        dispute.history.push({
          status, actor: req.user._id,
          note: summary.trim(), at: now
        });
        await dispute.save({ session: mongoSession });
        await AuditLog.create([{
          actor: req.user._id,
          action: "admin.dispute.decision",
          resourceType: "dispute",
          resourceId: String(dispute._id),
          outcome: "success",
          metadata: { status, hasCreditAdjustment: Boolean(adjustment) }
        }], { session: mongoSession });
        notifications = await Notification.create([dispute.tutor, dispute.learner].map(user => ({
          user, actor: req.user._id,
          type: status === "RESOLVED" ? "dispute_resolved" : "dispute_rejected",
          message: status === "RESOLVED"
            ? "An administrator resolved your session dispute."
            : "An administrator reviewed and rejected your session dispute.",
          resourceType: "dispute", resourceId: dispute._id,
          dedupeKey: `dispute:${dispute._id}:${status}:${user}`
        })), { session: mongoSession, ordered: true });
      });
    } finally {
      await mongoSession.endSession();
    }
    emitNotifications(req, notifications);
    return success(res, 200, "Dispute decision recorded", { dispute, adjustment: adjustmentEntry });
  },

  auditLogs: async (req, res) => {
    const paging = pageOptions(req.query);
    if (!paging) return failure(res, 400, "Page must be positive and page size must be 1–100");
    const filter = {};
    if (req.query.action) {
      if (typeof req.query.action !== "string" || req.query.action.length > 120) return failure(res, 400, "Action filter is invalid");
      filter.action = req.query.action;
    }
    if (req.query.outcome) {
      if (!["success", "failure", "denied"].includes(req.query.outcome)) return failure(res, 400, "Outcome filter is invalid");
      filter.outcome = req.query.outcome;
    }
    const [logs, total] = await Promise.all([
      AuditLog.find(filter).sort({ createdAt: -1, _id: -1 }).skip(paging.skip).limit(paging.limit)
        .populate("actor", "name email").lean(),
      AuditLog.countDocuments(filter)
    ]);
    return success(res, 200, "Audit logs retrieved", {
      logs, pagination: { page: paging.page, limit: paging.limit, total, pages: Math.ceil(total / paging.limit) }
    });
  }
};

async function notifyDispute(dispute, actor, type, message) {
  return Notification.create([dispute.tutor, dispute.learner].map(user => ({
    user, actor, type, message, resourceType: "dispute", resourceId: dispute._id,
    dedupeKey: `dispute:${dispute._id}:${type}:${user}:${Date.now()}`
  })));
}

function emitNotifications(req, notifications) {
  for (const notification of notifications) {
    req.app.get("io")?.to(`user:${notification.user}`).emit("notification:new", notification);
  }
}
