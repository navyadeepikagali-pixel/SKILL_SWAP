import mongoose from "mongoose";
import { PaymentRecord } from "../models/PaymentRecord.js";
import { Subscription } from "../models/Subscription.js";
import { SubscriptionPlan } from "../models/SubscriptionPlan.js";
import { UsagePolicy } from "../models/UsagePolicy.js";
import {
  activateVerifiedPayment,
  ensureUsageDefaults,
  getActiveEntitlements,
  getRestrictionRecords,
  getUsageHistory,
  getUsageStatistics,
  getUsageStatus,
  updatePaymentStatus
} from "../services/usageService.js";
import { failure, success } from "../utils/responses.js";

const validId = value => mongoose.isValidObjectId(value);
const asyncFail = (status, message) => Object.assign(new Error(message), { status });

function pagination(req) {
  const page = Number.parseInt(req.query.page || "1", 10);
  const limit = Number.parseInt(req.query.limit || "20", 10);
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw asyncFail(400, "Pagination values are invalid");
  }
  return { page, limit };
}

function safePlan(plan) {
  return {
    id: plan._id,
    name: plan.name,
    description: plan.description,
    price: plan.price,
    currency: plan.currency,
    usageLimit: plan.usageLimit,
    cooldownHours: plan.cooldownHours,
    billingPeriod: plan.billingPeriod,
    benefits: plan.benefits,
    includedFeatures: plan.includedFeatures,
    restrictedFeatures: plan.restrictedFeatures,
    accessRestrictions: plan.accessRestrictions,
    isFree: plan.isFree,
    displayOrder: plan.displayOrder
  };
}

function validatePlan(body, partial = false) {
  const errors = [];
  const allowedFields = new Set([
    "name", "description", "price", "currency", "usageLimit", "cooldownHours",
    "billingPeriod", "benefits", "includedFeatures", "restrictedFeatures",
    "accessRestrictions", "isFree", "isActive", "displayOrder"
  ]);
  if (Object.keys(body).some(field => !allowedFields.has(field))) errors.push("unknown fields");
  const required = field => !partial && (body[field] === undefined || body[field] === null);
  if (required("name") || (body.name !== undefined && (typeof body.name !== "string" || body.name.trim().length < 2 || body.name.length > 100))) errors.push("name");
  if (required("description") || (body.description !== undefined && (typeof body.description !== "string" || body.description.length > 1000))) errors.push("description");
  if (body.price !== undefined && (!Number.isFinite(body.price) || body.price < 0)) errors.push("price");
  if (body.currency !== undefined && (typeof body.currency !== "string" || !/^[A-Za-z]{3}$/.test(body.currency))) errors.push("currency");
  if (body.usageLimit !== undefined && (!Number.isInteger(body.usageLimit) || body.usageLimit < 0 || body.usageLimit > 10000)) errors.push("usageLimit");
  if (body.cooldownHours !== undefined && (!Number.isFinite(body.cooldownHours) || body.cooldownHours < 1 || body.cooldownHours > 720)) errors.push("cooldownHours");
  if (body.billingPeriod !== undefined && !["none", "monthly", "yearly"].includes(body.billingPeriod)) errors.push("billingPeriod");
  for (const field of ["benefits", "includedFeatures", "restrictedFeatures", "accessRestrictions"]) {
    if (body[field] !== undefined && (!Array.isArray(body[field]) || body[field].length > 50 ||
      body[field].some(value => typeof value !== "string" || value.length > 200))) errors.push(field);
  }
  if (body.isFree !== undefined && typeof body.isFree !== "boolean") errors.push("isFree");
  if (body.isActive !== undefined && typeof body.isActive !== "boolean") errors.push("isActive");
  if (body.displayOrder !== undefined && (!Number.isInteger(body.displayOrder) || body.displayOrder < 0 || body.displayOrder > 10000)) errors.push("displayOrder");
  if (errors.length) throw asyncFail(400, `Plan fields are invalid: ${[...new Set(errors)].join(", ")}`);
  return body;
}

function publicPaymentStatus(payment) {
  return {
    id: payment._id,
    status: payment.status,
    amount: payment.amount,
    currency: payment.currency,
    provider: payment.provider || null,
    redirectUrl: payment.metadata?.redirectUrl || null,
    verifiedAt: payment.verifiedAt,
    createdAt: payment.createdAt
  };
}

export const usageController = {
  status: async (req, res) => success(res, 200, "Usage status retrieved", { status: await getUsageStatus(req.user._id) }),
  history: async (req, res) => success(res, 200, "Usage history retrieved", await getUsageHistory(req.user._id, pagination(req))),
  plans: async (req, res) => {
    await ensureUsageDefaults();
    const plans = await SubscriptionPlan.find({ isActive: true }).sort({ displayOrder: 1, price: 1, name: 1 }).lean();
    return success(res, 200, "Plans retrieved", { plans: plans.map(safePlan), checkoutAvailable: Boolean(req.app.get("paymentProvider")) });
  },
  subscription: async (req, res) => {
    await ensureUsageDefaults();
    const entitlements = await getActiveEntitlements(req.user._id);
    const [subscriptions, payments] = await Promise.all([
      Subscription.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(50).populate("plan", "name price currency usageLimit billingPeriod benefits isFree"),
      PaymentRecord.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(50).populate("plan", "name")
    ]);
    return success(res, 200, "Subscription details retrieved", {
      current: entitlements.subscription,
      activePlan: safePlan(entitlements.plan),
      subscriptions,
      payments: payments.map(publicPaymentStatus)
    });
  },
  checkout: async (req, res) => {
    const { planId } = req.body;
    const idempotencyKey = req.get("Idempotency-Key");
    if (!validId(planId)) return failure(res, 400, "A valid plan is required");
    if (typeof idempotencyKey !== "string" || !/^[A-Za-z0-9:_-]{8,100}$/.test(idempotencyKey)) {
      return failure(res, 400, "A valid Idempotency-Key header is required");
    }
    const existing = await PaymentRecord.findOne({ user: req.user._id, idempotencyKey });
    if (existing) {
      const plan = await SubscriptionPlan.findById(existing.plan).select("name");
      return success(res, 200, existing.status === "demo_unpaid" ? "Demo checkout did not process a payment" : "Checkout retrieved", {
        payment: publicPaymentStatus(existing),
        plan: plan?.name,
        checkoutMode: existing.status === "demo_unpaid" ? "demo" : "provider",
        entitlementsActivated: existing.status === "paid"
      });
    }
    const plan = await SubscriptionPlan.findOne({ _id: planId, isActive: true });
    if (!plan || plan.isFree || plan.billingPeriod === "none") return failure(res, 400, "Select an active paid plan");
    const paymentProvider = req.app.get("paymentProvider");
    if (!paymentProvider) {
      let payment;
      try {
        payment = await PaymentRecord.create({
          user: req.user._id,
          plan: plan._id,
          amount: plan.price,
          currency: plan.currency,
          status: "demo_unpaid",
          idempotencyKey,
          metadata: { checkoutMode: "demo" }
        });
      } catch (error) {
        if (error.code !== 11000) throw error;
        payment = await PaymentRecord.findOne({ user: req.user._id, idempotencyKey });
        if (!payment) throw error;
      }
      return success(res, 200, "Demo checkout recorded. No payment was processed and no paid entitlements were activated.", {
        payment: publicPaymentStatus(payment),
        plan: plan.name,
        checkoutMode: "demo",
        entitlementsActivated: false
      });
    }
    let payment;
    try {
      payment = await PaymentRecord.create({
        user: req.user._id,
        plan: plan._id,
        amount: plan.price,
        currency: plan.currency,
        status: "pending",
        provider: paymentProvider.name || "configured-provider",
        idempotencyKey
      });
    } catch (error) {
      if (error.code !== 11000) throw error;
      payment = await PaymentRecord.findOne({ user: req.user._id, idempotencyKey });
      if (!payment) throw error;
      return success(res, 200, "Checkout retrieved", {
        payment: publicPaymentStatus(payment),
        plan: plan.name,
        checkoutMode: "provider",
        entitlementsActivated: payment.status === "paid"
      });
    }
    try {
      const checkout = await paymentProvider.createCheckout({
        paymentId: String(payment._id),
        userId: String(req.user._id),
        plan: safePlan(plan),
        idempotencyKey
      });
      if (!checkout?.providerReference || typeof checkout.providerReference !== "string" ||
        (checkout.redirectUrl && !/^https:\/\//i.test(checkout.redirectUrl))) {
        throw new Error("Payment provider returned an invalid checkout session");
      }
      payment.providerReference = checkout.providerReference;
      payment.metadata = { redirectUrl: checkout.redirectUrl || null };
      await payment.save();
      return success(res, 201, "Checkout session created", {
        payment: publicPaymentStatus(payment),
        plan: plan.name,
        checkoutMode: "provider",
        entitlementsActivated: false
      });
    } catch (error) {
      payment.status = "failed";
      payment.failureReason = "Provider checkout could not be created";
      await payment.save();
      throw error;
    }
  },
  cancelSubscription: async (req, res) => {
    const { subscriptionId } = req.body;
    if (!validId(subscriptionId)) return failure(res, 400, "A valid subscription is required");
    const subscription = await Subscription.findOne({ _id: subscriptionId, user: req.user._id, status: "active" });
    if (!subscription) {
      const cancelled = await Subscription.findOne({ _id: subscriptionId, user: req.user._id, status: "cancelled" });
      if (cancelled) return success(res, 200, "Subscription was already cancelled", { subscription: cancelled });
      return failure(res, 404, "Active subscription not found");
    }
    if (subscription.endsAt <= new Date()) {
      await Subscription.updateOne({ _id: subscription._id, status: "active" }, { $set: { status: "expired" } });
      return failure(res, 404, "Active subscription not found");
    }
    const paymentProvider = req.app.get("paymentProvider");
    if (subscription.provider && !paymentProvider?.cancelSubscription) {
      return failure(res, 503, "Subscription cancellation is unavailable until the payment provider is configured");
    }
    if (subscription.provider) {
      const cancelled = await paymentProvider.cancelSubscription({
        providerReference: subscription.providerReference,
        subscriptionId: String(subscription._id)
      });
      if (cancelled !== true) return failure(res, 502, "The payment provider did not confirm cancellation");
    }
    subscription.status = "cancelled";
    subscription.cancelledAt = new Date();
    subscription.cancellationReason = "Cancelled by subscriber";
    await subscription.save();
    return success(res, 200, "Subscription cancelled. Paid access has ended; history is retained.", { subscription });
  },
  webhook: async (req, res) => {
    const provider = req.app.get("paymentProvider");
    const signature = req.get("x-payment-signature");
    if (!provider?.verifyWebhook || !provider?.parseWebhook || !Buffer.isBuffer(req.rawBody) ||
      !(await provider.verifyWebhook(req.rawBody, signature))) {
      return failure(res, 401, "Payment webhook signature is invalid");
    }
    const event = await provider.parseWebhook(req.rawBody);
    if (!event || !validId(event.paymentId) || typeof event.providerReference !== "string" ||
      !["paid", "failed", "refunded"].includes(event.status)) {
      return failure(res, 400, "Payment event is invalid");
    }
    const payment = await PaymentRecord.findById(event.paymentId);
    if (!payment || payment.provider !== (provider.name || "configured-provider") ||
      payment.providerReference !== event.providerReference) return failure(res, 404, "Payment record was not found");
    if (event.status === "paid") {
      const result = await activateVerifiedPayment(payment._id, event.providerReference);
      return success(res, 200, result.duplicate ? "Payment event already processed" : "Verified payment applied", {
        duplicate: result.duplicate,
        subscriptionId: result.subscription?._id || null
      });
    }
    const result = await updatePaymentStatus(payment._id, event.providerReference, event.status, event.failureReason || "");
    return success(res, 200, result.duplicate ? "Payment event already processed" : "Payment status updated", {
      duplicate: result.duplicate,
      status: result.payment.status
    });
  },
  adminPolicy: async (_req, res) => {
    const { policy } = await ensureUsageDefaults();
    return success(res, 200, "Usage policy retrieved", { policy });
  },
  updatePolicy: async (req, res) => {
    const { activeActions, dailyLimit, cooldownHours } = req.body;
    const allowedActions = new Set(["tutor_search", "connection_request"]);
    if (!Array.isArray(activeActions) || activeActions.length > 20 ||
      activeActions.some(action => typeof action !== "string" || !allowedActions.has(action)) ||
      !Number.isInteger(dailyLimit) || dailyLimit < 1 || dailyLimit > 10000 ||
      !Number.isFinite(cooldownHours) || cooldownHours < 1 || cooldownHours > 720) {
      return failure(res, 400, "Usage policy values are invalid");
    }
    const { policy } = await ensureUsageDefaults();
    policy.activeActions = [...new Set(activeActions)];
    policy.dailyLimit = dailyLimit;
    policy.cooldownHours = cooldownHours;
    policy.version += 1;
    await policy.save();
    await SubscriptionPlan.updateMany({ isFree: true }, { $set: { usageLimit: dailyLimit, cooldownHours } });
    return success(res, 200, "Usage policy updated", { policy });
  },
  adminPlans: async (_req, res) => {
    const plans = await SubscriptionPlan.find().sort({ displayOrder: 1, name: 1 }).lean();
    return success(res, 200, "Subscription plans retrieved", { plans });
  },
  createPlan: async (req, res) => {
    const values = validatePlan(req.body);
    if (values.usageLimit !== undefined && values.usageLimit < 1) return failure(res, 400, "Usage allowance must be at least one");
    values.name = values.name.trim();
    values.description = values.description || "";
    values.currency = (values.currency || "USD").toUpperCase();
    values.cooldownHours ??= 12;
    values.benefits ??= [];
    values.includedFeatures ??= [];
    values.restrictedFeatures ??= [];
    values.accessRestrictions ??= [];
    values.isFree ??= false;
    values.isActive ??= true;
    values.displayOrder ??= 0;
    if (values.isFree && values.price !== 0) return failure(res, 400, "Free plans must have a zero price");
    if (values.isFree && values.billingPeriod !== "none") return failure(res, 400, "Free plans cannot have a paid billing period");
    if (!values.isFree && !["monthly", "yearly"].includes(values.billingPeriod)) return failure(res, 400, "Paid plans require a monthly or yearly billing period");
    if (values.isFree && await SubscriptionPlan.exists({ isFree: true })) return failure(res, 409, "A free plan already exists");
    const plan = await SubscriptionPlan.create(values);
    return success(res, 201, "Subscription plan created", { plan });
  },
  updatePlan: async (req, res) => {
    if (!validId(req.params.id)) return failure(res, 400, "Plan id is invalid");
    const values = validatePlan(req.body, true);
    const existing = await SubscriptionPlan.findById(req.params.id);
    if (!existing) return failure(res, 404, "Plan not found");
    const next = { ...existing.toObject(), ...values };
    if (next.usageLimit < 1) return failure(res, 400, "Usage allowance must be at least one");
    if (next.isFree && (next.price !== 0 || next.billingPeriod !== "none")) return failure(res, 400, "Free plans must have a zero price and no paid billing period");
    if (!next.isFree && !["monthly", "yearly"].includes(next.billingPeriod)) return failure(res, 400, "Paid plans require a monthly or yearly billing period");
    if (existing.isFree && values.isActive === false) return failure(res, 400, "The free plan cannot be deactivated");
    if (next.isFree && await SubscriptionPlan.exists({ isFree: true, _id: { $ne: existing._id } })) {
      return failure(res, 409, "A free plan already exists");
    }
    if (Object.keys(values).length === 0) return failure(res, 400, "At least one plan field is required");
    const plan = await SubscriptionPlan.findByIdAndUpdate(req.params.id, { $set: values }, { new: true, runValidators: true });
    if (!plan) return failure(res, 404, "Plan not found");
    return success(res, 200, "Subscription plan updated", { plan });
  },
  stats: async (req, res) => {
    const { since, until } = req.query;
    if ((since && Number.isNaN(Date.parse(since))) || (until && Number.isNaN(Date.parse(until)))) {
      return failure(res, 400, "Statistics date range is invalid");
    }
    return success(res, 200, "Usage statistics retrieved", { statistics: await getUsageStatistics({ since, until }) });
  },
  restrictions: async (req, res) => success(res, 200, "Usage restrictions retrieved", await getRestrictionRecords(pagination(req)))
};
