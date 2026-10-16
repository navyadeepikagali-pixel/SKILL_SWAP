import mongoose from "mongoose";
import { Notification } from "../models/Notification.js";
import { PaymentRecord } from "../models/PaymentRecord.js";
import { Subscription } from "../models/Subscription.js";
import { SubscriptionPlan } from "../models/SubscriptionPlan.js";
import { UsageEvent } from "../models/UsageEvent.js";
import { UsagePolicy } from "../models/UsagePolicy.js";
import { UsageRecord } from "../models/UsageRecord.js";

const fail = (status, message, code) => Object.assign(new Error(message), { status, code });
const defaultPolicy = {
  key: "default",
  activeActions: ["tutor_search", "connection_request"],
  dailyLimit: 5,
  cooldownHours: 12,
  version: 1
};
const defaultPlan = {
  name: "Free",
  description: "Community access with a daily limit on selected discovery actions.",
  price: 0,
  currency: "USD",
  usageLimit: 5,
  cooldownHours: 12,
  billingPeriod: "none",
  benefits: ["Create a profile", "Chat with existing connections", "Book and manage sessions"],
  includedFeatures: ["profile", "existing_chat", "sessions", "safety", "account_recovery"],
  restrictedFeatures: [],
  accessRestrictions: ["Daily limits apply to configured tutor discovery and connection actions."],
  isFree: true,
  isActive: true,
  displayOrder: 0
};

export async function ensureUsageDefaults() {
  let policy = await UsagePolicy.findOne({ key: "default" });
  if (!policy) {
    try {
      policy = await UsagePolicy.create(defaultPolicy);
    } catch (error) {
      if (error.code !== 11000) throw error;
      policy = await UsagePolicy.findOne({ key: "default" });
    }
  }
  let freePlan = await SubscriptionPlan.findOne({ isFree: true });
  if (!freePlan) {
    try {
      freePlan = await SubscriptionPlan.create({ ...defaultPlan, usageLimit: policy.dailyLimit, cooldownHours: policy.cooldownHours });
    } catch (error) {
      if (error.code !== 11000) throw error;
      freePlan = await SubscriptionPlan.findOne({ isFree: true });
    }
  }
  return { policy, freePlan };
}

export async function getActiveEntitlements(userId, at = new Date()) {
  const { policy, freePlan } = await ensureUsageDefaults();
  await Subscription.updateMany({
    user: userId,
    status: "active",
    endsAt: { $lte: at }
  }, { $set: { status: "expired" } });
  const subscription = await Subscription.findOne({
    user: userId,
    status: "active",
    startsAt: { $lte: at },
    endsAt: { $gt: at }
  }).sort({ endsAt: -1 }).populate("plan");
  const plan = subscription?.plan?.isActive ? subscription.plan : freePlan;
  return {
    subscription: subscription?.plan?.isActive ? subscription : null,
    plan,
    policy,
    usageLimit: subscription?.plan?.isActive ? plan.usageLimit : policy.dailyLimit,
    cooldownHours: subscription?.plan?.isActive ? plan.cooldownHours : policy.cooldownHours,
    features: subscription?.plan?.isActive ? plan.includedFeatures : freePlan.includedFeatures
  };
}

function utcDayStart(at) {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
}

async function resolveUsageWindow(userId, action, allowance, now, session) {
  const latest = await UsageRecord.findOne({ user: userId, action })
    .sort({ windowStartedAt: -1 }).session(session || null);
  let windowStartedAt = utcDayStart(now);
  if (latest && latest.windowStartedAt > windowStartedAt && (!latest.cooldownUntil || latest.cooldownUntil > now)) {
    windowStartedAt = latest.windowStartedAt;
  }
  if (latest && latest.count >= allowance && latest.cooldownUntil) {
    if (latest.cooldownUntil > now) return { latest, blocked: true, windowStartedAt };
    if (latest.cooldownUntil > windowStartedAt) windowStartedAt = latest.cooldownUntil;
  }
  return { latest, blocked: false, windowStartedAt };
}

function cooldownMessage(cooldownHours) {
  if (cooldownHours === 12) {
    return "You have reached your usage limit for today. You can use Skill Swap again after 12 hours or upgrade your plan for additional access.";
  }
  const cooldownText = cooldownHours < 24
    ? `${cooldownHours} hour${cooldownHours === 1 ? "" : "s"}`
    : `${cooldownHours / 24} day${cooldownHours === 24 ? "" : "s"}`;
  return `You have reached your usage limit for today. You can use Skill Swap again after ${cooldownText} or upgrade your plan for additional access.`;
}

function publishNotification(io, notification) {
  if (notification) io?.to(`user:${notification.user}`).emit("notification:new", notification);
}

async function inTransaction(operation) {
  const session = await mongoose.startSession();
  try {
    return await session.withTransaction(() => operation(session));
  } catch (error) {
    if (error.code === 20 || error.codeName === "IllegalOperation" ||
      /Transaction numbers are only allowed|replica set member or mongos/i.test(error.message || "")) {
      throw fail(503, "Usage limits require MongoDB transactions. Configure a replica set or MongoDB Atlas.");
    }
    throw error;
  } finally {
    await session.endSession();
  }
}

export async function recordUsage(userId, action, idempotencyKey, now = new Date()) {
  if (!mongoose.isValidObjectId(userId)) throw fail(400, "User id is invalid");
  const entitlements = await getActiveEntitlements(userId, now);
  const { policy, plan, usageLimit, cooldownHours } = entitlements;
  if (!policy.activeActions.includes(action)) return { skipped: true, duplicate: false };
  if (typeof idempotencyKey !== "string" || !/^[A-Za-z0-9:_-]{8,100}$/.test(idempotencyKey)) {
    throw fail(400, "A valid Idempotency-Key header is required");
  }
  const initialWindow = await resolveUsageWindow(userId, action, usageLimit, now);
  if (!initialWindow.blocked && !(initialWindow.latest?.count >= usageLimit && !initialWindow.latest.cooldownUntil)) {
    try {
      await UsageRecord.updateOne({
        user: userId, action, windowStartedAt: initialWindow.windowStartedAt
      }, {
        $setOnInsert: {
          user: userId,
          action,
          windowStartedAt: initialWindow.windowStartedAt,
          count: 0,
          policyVersion: policy.version,
          plan: plan?._id || null
        }
      }, { upsert: true });
    } catch (error) {
      if (error.code !== 11000) throw error;
    }
  }
  let result;
  try {
    result = await inTransaction(async session => {
      const existing = await UsageEvent.findOne({ user: userId, action, idempotencyKey }).session(session);
      if (existing && existing.status !== "released") {
        return { event: existing, duplicate: true, notification: null };
      }
      const window = await resolveUsageWindow(userId, action, usageLimit, now, session);
      if (window.blocked) {
        const actualCooldownHours = window.latest.cooldownDurationHours || cooldownHours;
        return {
          blocked: true,
          message: cooldownMessage(actualCooldownHours),
          limit: usageLimit,
          usage: window.latest.count,
          cooldownStartedAt: window.latest.cooldownStartedAt,
          cooldownUntil: window.latest.cooldownUntil,
          cooldownHours: actualCooldownHours,
          notification: null
        };
      }
      const windowStartedAt = window.windowStartedAt;
      let counter = await UsageRecord.findOne({ user: userId, action, windowStartedAt }).session(session);
      if (!counter) {
        [counter] = await UsageRecord.create([{
          user: userId,
          action,
          windowStartedAt,
          count: 0,
          policyVersion: policy.version,
          plan: plan?._id
        }], { session });
      }
      if (counter.count >= usageLimit) {
        const cooldownStartedAt = counter.cooldownStartedAt || now;
        const actualCooldownHours = counter.cooldownDurationHours || cooldownHours;
        const cooldownUntil = counter.cooldownUntil || new Date(cooldownStartedAt.getTime() + actualCooldownHours * 60 * 60 * 1000);
        counter.cooldownStartedAt = cooldownStartedAt;
        counter.cooldownUntil = cooldownUntil;
        counter.cooldownDurationHours = actualCooldownHours;
        counter.policyVersion = policy.version;
        await counter.save({ session });
        const notificationKey = `usage-limit:${userId}:${action}:${windowStartedAt.toISOString()}`;
        let notification = await Notification.findOne({ user: userId, dedupeKey: notificationKey }).session(session);
        if (!notification) {
          [notification] = await Notification.create([{
            user: userId,
            type: "usage_limit_reached",
            message: cooldownMessage(actualCooldownHours),
            resourceType: "usage",
            dedupeKey: notificationKey
          }], { session });
        }
        return {
          blocked: true,
          message: cooldownMessage(actualCooldownHours),
          limit: usageLimit,
          usage: counter.count,
          cooldownUntil,
          cooldownStartedAt,
          cooldownHours: actualCooldownHours,
          notification
        };
      }
      if (existing) {
        existing.status = "reserved";
        existing.policyVersion = policy.version;
        existing.windowStartedAt = windowStartedAt;
        await existing.save({ session });
      }
      counter.count += 1;
      counter.policyVersion = policy.version;
      counter.plan = plan?._id || null;
      let notification = null;
      if (counter.count >= usageLimit) {
        counter.cooldownStartedAt = now;
        counter.cooldownUntil = new Date(now.getTime() + cooldownHours * 60 * 60 * 1000);
        counter.cooldownDurationHours = cooldownHours;
        counter.cooldownTriggeredBy = idempotencyKey;
        const notificationKey = `usage-limit:${userId}:${action}:${windowStartedAt.toISOString()}`;
        [notification] = await Notification.create([{
          user: userId,
          type: "usage_limit_reached",
          message: cooldownMessage(cooldownHours),
          resourceType: "usage",
          dedupeKey: notificationKey
        }], { session });
      }
      await counter.save({ session });
      const event = existing || (await UsageEvent.create([{
        user: userId,
        action,
        idempotencyKey,
        policyVersion: policy.version,
        windowStartedAt,
        status: "reserved",
        metadata: { plan: plan?._id || null }
      }], { session }))[0];
      return { event, duplicate: false, notification, limitReached: counter.count >= usageLimit, windowStartedAt };
    });
  } catch (error) {
    if (error.code === 11000) {
      const duplicate = await UsageEvent.findOne({ user: userId, action, idempotencyKey });
      if (duplicate) return { event: duplicate, duplicate: true, notification: null };
    }
    throw error;
  }
  return { ...result, limit: usageLimit, cooldownHours };
}

export async function finishUsage(eventId, outcome, io) {
  if (!mongoose.isValidObjectId(eventId)) return;
  const result = await inTransaction(async session => {
    const event = await UsageEvent.findById(eventId).session(session);
    if (!event || event.status !== "reserved") return { notification: null };
    const counter = await UsageRecord.findOne({
      user: event.user,
      action: event.action,
      windowStartedAt: event.windowStartedAt
    }).session(session);
    if (!counter) throw new Error("Usage counter is missing for a reserved action");

    if (outcome === "consumed") {
      event.status = "consumed";
      await event.save({ session });
      const notification = counter.cooldownTriggeredBy === event.idempotencyKey
        ? await Notification.findOne({ user: event.user, type: "usage_limit_reached", dedupeKey: `usage-limit:${event.user}:${event.action}:${event.windowStartedAt.toISOString()}` }).session(session)
        : null;
      return { notification };
    }

    event.status = "released";
    await event.save({ session });
    counter.count = Math.max(0, counter.count - 1);
    if (counter.cooldownTriggeredBy === event.idempotencyKey) {
      counter.cooldownStartedAt = undefined;
      counter.cooldownUntil = undefined;
      counter.cooldownTriggeredBy = undefined;
      await Notification.deleteOne({
        user: event.user,
        type: "usage_limit_reached",
        dedupeKey: `usage-limit:${event.user}:${event.action}:${event.windowStartedAt.toISOString()}`
      }, { session });
    }
    await counter.save({ session });
    return { notification: null };
  });
  publishNotification(io, result.notification);
}

export async function getUsageStatus(userId, now = new Date()) {
  const entitlements = await getActiveEntitlements(userId, now);
  const actions = entitlements.policy.activeActions;
  const usage = await Promise.all(actions.map(async action => {
    const window = await resolveUsageWindow(userId, action, entitlements.usageLimit, now);
    const windowStartedAt = window.windowStartedAt;
    const current = await UsageRecord.findOne({ user: userId, action, windowStartedAt }).lean();
    const activeCooldown = window.blocked ? window.latest : null;
    const allowance = entitlements.usageLimit;
    return {
      action,
      consumed: current?.count || 0,
      allowance,
      remaining: Math.max(0, allowance - (current?.count || 0)),
      cooldownStartedAt: activeCooldown?.cooldownStartedAt || current?.cooldownStartedAt || null,
      cooldownUntil: activeCooldown?.cooldownUntil || null,
      cooldownHours: activeCooldown?.cooldownDurationHours ?? entitlements.cooldownHours,
      restricted: Boolean(activeCooldown)
    };
  }));
  return {
    plan: entitlements.plan ? {
      id: entitlements.plan._id,
      name: entitlements.plan.name,
      isFree: entitlements.plan.isFree
    } : null,
    subscription: entitlements.subscription,
    policy: {
      activeActions: entitlements.policy.activeActions,
      dailyLimit: entitlements.policy.dailyLimit,
      cooldownHours: entitlements.policy.cooldownHours,
      version: entitlements.policy.version,
      resetsAt: new Date(utcDayStart(now).getTime() + 24 * 60 * 60 * 1000)
    },
    usage
  };
}

export async function getUsageHistory(userId, { page = 1, limit = 20 } = {}) {
  const [records, total] = await Promise.all([
    UsageEvent.find({ user: userId, status: "consumed" })
      .sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit)
      .select("action policyVersion windowStartedAt createdAt metadata"),
    UsageEvent.countDocuments({ user: userId, status: "consumed" })
  ]);
  return { records, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
}

export async function getUsageStatistics({ since, until } = {}) {
  const match = {};
  if (since || until) match.createdAt = {
    ...(since ? { $gte: new Date(since) } : {}),
    ...(until ? { $lte: new Date(until) } : {})
  };
  return UsageEvent.aggregate([
    { $match: { ...match, status: "consumed" } },
    { $group: { _id: "$action", uses: { $sum: 1 }, users: { $addToSet: "$user" } } },
    { $project: { action: "$_id", uses: 1, uniqueUsers: { $size: "$users" }, _id: 0 } },
    { $sort: { uses: -1 } }
  ]);
}

export async function getRestrictionRecords({ page = 1, limit = 20 } = {}) {
  const [records, total] = await Promise.all([
    UsageRecord.find({ cooldownUntil: { $exists: true } })
      .sort({ cooldownUntil: -1 }).skip((page - 1) * limit).limit(limit)
      .populate("user", "name email").populate("plan", "name isFree").lean(),
    UsageRecord.countDocuments({ cooldownUntil: { $exists: true } })
  ]);
  return { records, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
}

export async function activateVerifiedPayment(paymentId, providerReference) {
  return inTransaction(async session => {
    const payment = await PaymentRecord.findOne({ _id: paymentId, providerReference }).session(session);
    if (!payment) throw fail(404, "Pending checkout was not found");
    if (payment.status === "paid") {
      const priorSubscription = await Subscription.findOne({ verifiedPayment: payment._id }).session(session);
      return { payment, subscription: priorSubscription, duplicate: true };
    }
    if (payment.status !== "pending") throw fail(409, "Checkout is not eligible for activation");
    const plan = await SubscriptionPlan.findById(payment.plan).session(session);
    if (!plan || !plan.isActive || plan.isFree || !["monthly", "yearly"].includes(plan.billingPeriod)) {
      throw fail(409, "The selected plan is no longer available");
    }
    const startsAt = new Date();
    const endsAt = new Date(startsAt);
    if (plan.billingPeriod === "monthly") endsAt.setUTCMonth(endsAt.getUTCMonth() + 1);
    else endsAt.setUTCFullYear(endsAt.getUTCFullYear() + 1);
    payment.status = "paid";
    payment.verifiedAt = startsAt;
    await payment.save({ session });
    await Subscription.updateMany({ user: payment.user, status: "active" }, {
      $set: { status: "expired", endsAt: startsAt }
    }, { session });
    const [subscription] = await Subscription.create([{
      user: payment.user,
      plan: plan._id,
      status: "active",
      startsAt,
      endsAt,
      billingPeriod: plan.billingPeriod,
      provider: payment.provider,
      providerReference: payment.providerReference,
      verifiedPayment: payment._id
    }], { session });
    return { payment, subscription, duplicate: false };
  });
}

export async function updatePaymentStatus(paymentId, providerReference, status, failureReason = "") {
  if (!["failed", "refunded"].includes(status)) throw fail(400, "Payment status is invalid");
  return inTransaction(async session => {
    const payment = await PaymentRecord.findOne({ _id: paymentId, providerReference }).session(session);
    if (!payment) throw fail(404, "Payment record was not found");
    if (payment.status === status) return { payment, duplicate: true };
    if (status === "failed" && payment.status !== "pending") throw fail(409, "Payment can no longer be marked as failed");
    if (status === "refunded" && payment.status !== "paid") throw fail(409, "Only a paid payment can be refunded");
    payment.status = status;
    payment.failureReason = failureReason.slice(0, 500);
    await payment.save({ session });
    if (status === "refunded") {
      await Subscription.updateMany({ verifiedPayment: payment._id, status: "active" }, {
        $set: { status: "cancelled", cancelledAt: new Date(), cancellationReason: "Payment refunded" }
      }, { session });
    }
    return { payment, duplicate: false };
  });
}
