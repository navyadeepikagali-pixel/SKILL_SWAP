import test, { before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import mongoose from "mongoose";
import request from "supertest";
import { Server } from "socket.io";
import { io as createSocketClient } from "socket.io-client";
import { randomUUID } from "node:crypto";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { createAuthToken } from "../src/services/authService.js";
import { getAuthCookieName } from "../src/utils/authCookies.js";
import { attachRealtime } from "../src/realtime.js";
import { validateEnvironment } from "../src/config/env.js";

process.env.NODE_ENV = "test";
process.env.EMAIL_PROVIDER = "smtp";
process.env.JWT_SECRET = "test-only-secret-that-is-long-enough-for-hmac-and-jwt";
process.env.CLIENT_URL = "http://localhost:5173";

let replicaSet;
let app;
let mailer;
let sentOtps;
let sentResetTokens;

before(async () => {
  replicaSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" }
  });
  await mongoose.connect(replicaSet.getUri());
  const emails = await import("../src/models/User.js");
  await emails.User.init();
  const authModules = await import("../src/app.js");
  sentOtps = [];
  sentResetTokens = [];
  mailer = {
    async sendOtpEmail(email, code) { sentOtps.push({ email, code }); },
    async sendLoginOtpEmail(email, code) { sentOtps.push({ email, code, purpose: "login" }); },
    async sendPasswordResetEmail(email, token) { sentResetTokens.push({ email, token }); }
  };
  app = authModules.createApp({
    mailer,
    authRateLimit: {
      otp: { limit: 200 },
      login: { limit: 200 },
      reset: { limit: 200 }
    }
  });
});

beforeEach(async () => {
  await Promise.all(Object.values(mongoose.connection.collections).map(collection => collection.deleteMany({})));
  sentOtps.length = 0;
  sentResetTokens.length = 0;
});

after(async () => {
  await mongoose.disconnect();
  await replicaSet.stop();
});

test("production configuration validates frontend and selected email provider", () => {
  const keys = ["NODE_ENV", "PORT", "MONGODB_URI", "JWT_SECRET", "CLIENT_URL", "RENDER_EXTERNAL_URL", "ALLOW_PASSWORD_ONLY_AUTH", "EMAIL_PROVIDER", "BREVO_API_KEY", "EMAIL_FROM", "SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_SECURE"];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    Object.assign(process.env, {
      NODE_ENV: "production",
      PORT: "5000",
      MONGODB_URI: "mongodb://example.invalid/skill_swap?replicaSet=rs0",
      JWT_SECRET: "test-secret-long-enough-to-meet-minimum-length",
      EMAIL_PROVIDER: "smtp",
      CLIENT_URL: "https://skills.example.com"
    });
    process.env.MONGODB_URI = "https://example.invalid/skill_swap";
    assert.throws(validateEnvironment, /MONGODB_URI must use the mongodb:\/\//);
    process.env.MONGODB_URI = "mongodb:///skill_swap";
    assert.throws(validateEnvironment, /MONGODB_URI must include a MongoDB host/);
    process.env.MONGODB_URI = "mongodb://example.invalid/skill_swap?replicaSet=rs0";
    for (const key of ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS"]) delete process.env[key];
    assert.throws(validateEnvironment, /are required in production/);
    Object.assign(process.env, {
      SMTP_HOST: "smtp.example.com",
      SMTP_PORT: "587",
      SMTP_USER: "test@example.com",
      SMTP_PASS: "test-password"
    });
    assert.doesNotThrow(validateEnvironment);
    process.env.EMAIL_PROVIDER = "none";
    delete process.env.ALLOW_PASSWORD_ONLY_AUTH;
    assert.throws(validateEnvironment, /EMAIL_PROVIDER=none in production requires ALLOW_PASSWORD_ONLY_AUTH=true/);
    process.env.ALLOW_PASSWORD_ONLY_AUTH = "true";
    assert.doesNotThrow(validateEnvironment);
    delete process.env.CLIENT_URL;
    process.env.RENDER_EXTERNAL_URL = "https://skill-swap.onrender.com";
    assert.doesNotThrow(validateEnvironment);
    process.env.CLIENT_URL = "https://skills.example.com";
    delete process.env.RENDER_EXTERNAL_URL;
    delete process.env.ALLOW_PASSWORD_ONLY_AUTH;

    process.env.EMAIL_PROVIDER = "brevo";
    for (const key of ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS"]) delete process.env[key];
    process.env.BREVO_API_KEY = "test-brevo-key";
    process.env.EMAIL_FROM = "no-reply@example.com";
    assert.doesNotThrow(validateEnvironment);
    delete process.env.BREVO_API_KEY;
    assert.throws(validateEnvironment, /BREVO_API_KEY and EMAIL_FROM are required/);

    process.env.EMAIL_PROVIDER = "smtp";
    Object.assign(process.env, {
      SMTP_HOST: "smtp.example.com",
      SMTP_PORT: "587",
      SMTP_USER: "test@example.com",
      SMTP_PASS: "test-password"
    });
    process.env.SMTP_PORT = "not-a-port";
    assert.throws(validateEnvironment, /SMTP_PORT must be a valid TCP port/);
    process.env.SMTP_PORT = "587";
    process.env.CLIENT_URL = "http://skills.example.com";
    assert.throws(validateEnvironment, /must use HTTPS in production/);
    process.env.CLIENT_URL = "https://skills.example.com/app";
    assert.throws(validateEnvironment, /only the frontend origin/);
    process.env.CLIENT_URL = "https://skills.example.com";
    delete process.env.CLIENT_URL;
    assert.throws(validateEnvironment, /CLIENT_URL is required in production/);
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});
async function register(email = "learner@example.com") {
  const response = await request(app).post("/api/auth/register").send({
    name: "Test Learner",
    email,
    password: "a-secure-password"
  });
  assert.equal(response.status, 202, response.body.message);
  assert.equal(response.body.success, true);
  assert.equal(sentOtps.length, 1);
  return { response, code: sentOtps[0].code, email };
}

async function verify(email, otp) {
  return request(app).post("/api/auth/verify-email").send({ email, otp });
}

async function completeLogin(email, password, requester = request(app)) {
  const started = await requester.post("/api/auth/login").send({ email, password });
  if (started.status !== 202) return started;
  const message = sentOtps.at(-1);
  assert.equal(message.email, email);
  assert.equal(message.purpose, "login");
  return requester.post("/api/auth/verify-login-otp").send({ email, otp: message.code });
}

test("password-only mode creates and authenticates accounts without sending email", async () => {
  const previousProvider = process.env.EMAIL_PROVIDER;
  process.env.EMAIL_PROVIDER = "none";
  try {
    const configuration = await request(app).get("/api/auth/config");
    assert.equal(configuration.status, 200);
    assert.deepEqual(configuration.body.data, {
      emailOtpEnabled: false,
      passwordResetEnabled: false
    });

    const agent = request.agent(app);
    const registration = await agent.post("/api/auth/register").send({
      name: "Password Only",
      email: "password-only@example.com",
      password: "a-secure-password"
    });
    assert.equal(registration.status, 201, registration.body.message);
    assert.equal(registration.body.data.user.isEmailVerified, false);
    assert.equal(registration.body.data.user.accountStatus, "active");
    assert.equal(registration.body.data.user.creditBalance, 100);
    assert.equal(sentOtps.length, 0);
    assert.equal((await agent.get("/api/auth/me")).status, 200);

    const signedOut = await agent.post("/api/auth/logout");
    assert.equal(signedOut.status, 200);
    const login = await agent.post("/api/auth/login").send({
      email: "password-only@example.com",
      password: "a-secure-password"
    });
    assert.equal(login.status, 200, login.body.message);
    assert.equal(login.body.data.user.isEmailVerified, false);
    assert.equal((await agent.get("/api/auth/me")).status, 200);

    assert.equal((await request(app).post("/api/auth/verify-email").send({
      email: "password-only@example.com",
      otp: "123456"
    })).status, 410);
    assert.equal((await request(app).post("/api/auth/forgot-password").send({
      email: "password-only@example.com"
    })).status, 503);
  } finally {
    if (previousProvider === undefined) delete process.env.EMAIL_PROVIDER;
    else process.env.EMAIL_PROVIDER = previousProvider;
  }
});

function withUsageIdempotency(agent) {
  for (const method of ["get", "post"]) {
    const original = agent[method].bind(agent);
    agent[method] = path => {
      const outgoing = original(path);
      const restrictedTutorRead = method === "get" && /^\/api\/tutors(?:\/search)?(?:\?|$)/.test(path);
      const newConnection = method === "post" && path === "/api/connections";
      return restrictedTutorRead || newConnection
        ? outgoing.set("Idempotency-Key", `test:${randomUUID()}`)
        : outgoing;
    };
  }
  return agent;
}

test("registration validates input and sends only a real email OTP", async () => {
  const invalid = await request(app).post("/api/auth/register").send({
    name: "A",
    email: "bad-email",
    password: "short"
  });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.success, false);
  assert.equal(sentOtps.length, 0);

  const pending = await register();
  assert.equal(pending.response.body.data.email, "learner@example.com");
  assert.equal(JSON.stringify(pending.response.body).includes(pending.code), false);
});

test("members can register with different email providers and each OTP goes to its own address", async () => {
  const addresses = [
    "gmail-member@gmail.com",
    "outlook-member@outlook.com",
    "yahoo-member@yahoo.com"
  ];

  for (const [index, email] of addresses.entries()) {
    const response = await request(app).post("/api/auth/register").send({
      name: `Member ${index + 1}`,
      email,
      password: "a-secure-password"
    });
    assert.equal(response.status, 202, response.body.message);
    assert.equal(sentOtps.at(-1).email, email);
  }

  assert.deepEqual(sentOtps.map(message => message.email), addresses);
});

async function signedInAgent(email) {
  const pending = await register(email);
  const verified = await verify(email, pending.code);
  assert.equal(verified.status, 201);
  const agent = withUsageIdempotency(request.agent(app));
  const login = await completeLogin(email, "a-secure-password", agent);
  assert.equal(login.status, 200, login.body.message);
  return agent;
}

  test("usage limits are atomic, idempotent, and return the configured cooldown message", async () => {
    const agent = await signedInAgent("usage-limits@example.com");
    await request(app).get("/api/plans");
    const { UsagePolicy, UsageRecord, UsageEvent, Notification } = await import("../src/models/index.js");
    await UsagePolicy.updateOne({ key: "default" }, {
      $set: { activeActions: ["tutor_search"], dailyLimit: 2, cooldownHours: 12 }
    });

    const one = await agent.get("/api/tutors/search").set("Idempotency-Key", "tutor-search:usage-0001");
    const retry = await agent.get("/api/tutors/search").set("Idempotency-Key", "tutor-search:usage-0001");
    const two = await agent.get("/api/tutors/search").set("Idempotency-Key", "tutor-search:usage-0002");
    const expiryAfterLimit = (await UsageRecord.findOne({ action: "tutor_search" })).cooldownUntil;
    const blocked = await agent.get("/api/tutors/search").set("Idempotency-Key", "tutor-search:usage-0003");
    const blockedAgain = await agent.get("/api/tutors/search").set("Idempotency-Key", "tutor-search:usage-0004");

    assert.equal(one.status, 200);
    assert.equal(retry.status, 200);
    assert.equal(two.status, 200);
    assert.equal(blocked.status, 429);
    assert.equal(blockedAgain.status, 429);
    assert.equal(blocked.body.code, "USAGE_LIMIT_REACHED");
    assert.equal(blocked.body.message, "You have reached your usage limit for today. You can use Skill Swap again after 12 hours or upgrade your plan for additional access.");
    assert.equal(await UsageEvent.countDocuments({ status: "consumed" }), 2);
    const counter = await UsageRecord.findOne({ action: "tutor_search" });
    assert.equal(counter.count, 2);
    assert.equal(counter.cooldownUntil.getTime(), expiryAfterLimit.getTime());
    assert.equal(await Notification.countDocuments({ type: "usage_limit_reached" }), 1);
  });

  test("invalid tutor-search requests release their usage reservation", async () => {
    const agent = await signedInAgent("usage-rollback@example.com");
    await request(app).get("/api/plans");
    const { UsageRecord, UsageEvent } = await import("../src/models/index.js");
    const response = await agent.get("/api/tutors/search?limit=999").set("Idempotency-Key", "tutor-search:invalid-001");
    assert.equal(response.status, 400);
    assert.equal(await UsageRecord.countDocuments({ action: "tutor_search", count: { $gt: 0 } }), 0);
    assert.equal(await UsageEvent.countDocuments({ action: "tutor_search", status: "released" }), 1);
  });

  test("concurrent tutor searches cannot exceed the configured allowance", async () => {
    const agent = await signedInAgent("usage-concurrency@example.com");
    await request(app).get("/api/plans");
    const { UsagePolicy, UsageRecord, UsageEvent } = await import("../src/models/index.js");
    await UsagePolicy.updateOne({ key: "default" }, {
      $set: { activeActions: ["tutor_search"], dailyLimit: 3, cooldownHours: 12 }
    });
    const results = await Promise.all(Array.from({ length: 10 }, (_, index) =>
      agent.get("/api/tutors/search").set("Idempotency-Key", `tutor-search:parallel-${String(index).padStart(2, "0")}`)
    ));
    assert.equal(results.filter(response => response.status === 200).length, 3);
    assert.equal(results.filter(response => response.status === 429).length, 7);
    assert.equal((await UsageRecord.findOne({ action: "tutor_search" })).count, 3);
    assert.equal(await UsageEvent.countDocuments({ action: "tutor_search", status: "consumed" }), 3);
  });

  test("unauthenticated users cannot read usage status and non-admins cannot change policy", async () => {
    const status = await request(app).get("/api/usage/status");
    const agent = await signedInAgent("usage-authz@example.com");
    const policy = await agent.put("/api/admin/usage/policy").send({
      activeActions: ["tutor_search"],
      dailyLimit: 3,
      cooldownHours: 12
    });
    assert.equal(status.status, 401);
    assert.equal(policy.status, 403);
  });

  test("administrators can manage usage policy and plans but unsupported actions are rejected", async () => {
    const { User, SubscriptionPlan } = await import("../src/models/index.js");
    const admin = await makeProfileUser({ accountType: "admin" });
    const agent = authenticatedAgent(admin);
    const policy = await agent.get("/api/admin/usage/policy");
    assert.equal(policy.status, 200);
    const invalidPolicy = await agent.put("/api/admin/usage/policy").send({
      activeActions: ["messages"],
      dailyLimit: 5,
      cooldownHours: 12
    });
    assert.equal(invalidPolicy.status, 400);
    const created = await agent.post("/api/admin/usage/plans").send({
      name: "Admin managed",
      description: "Editable catalog entry",
      price: 9,
      currency: "USD",
      usageLimit: 30,
      cooldownHours: 12,
      billingPeriod: "monthly",
      benefits: ["Configured access"],
      includedFeatures: ["discovery"],
      restrictedFeatures: [],
      accessRestrictions: [],
      isFree: false,
      isActive: true,
      displayOrder: 1
    });
    assert.equal(created.status, 201, created.body.message);
    const updated = await agent.patch(`/api/admin/usage/plans/${created.body.data.plan._id}`).send({ usageLimit: 40 });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.data.plan.usageLimit, 40);
    assert.equal((await SubscriptionPlan.findById(created.body.data.plan._id)).usageLimit, 40);
    assert.equal(await User.countDocuments({ accountType: "admin" }), 1);
    const stats = await agent.get("/api/admin/usage/statistics");
    const restrictions = await agent.get("/api/admin/usage/restrictions");
    assert.equal(stats.status, 200);
    assert.equal(restrictions.status, 200);
  });

  test("expired subscription records revert to Free entitlements without deleting history", async () => {
    const agentUser = await makeProfileUser();
    const agent = authenticatedAgent(agentUser);
    await agent.get("/api/plans");
    const { SubscriptionPlan, Subscription } = await import("../src/models/index.js");
    const plan = await SubscriptionPlan.create({
      name: "Expired Plan",
      description: "Past paid plan",
      price: 4,
      currency: "USD",
      usageLimit: 20,
      cooldownHours: 12,
      billingPeriod: "monthly",
      benefits: [],
      includedFeatures: [],
      restrictedFeatures: [],
      accessRestrictions: [],
      isFree: false,
      isActive: true
    });
    const expired = await Subscription.create({
      user: agentUser._id,
      plan: plan._id,
      status: "active",
      startsAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
      endsAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      billingPeriod: "monthly"
    });
    const response = await agent.get("/api/subscriptions/me");
    assert.equal(response.status, 200);
    assert.equal(response.body.data.activePlan.name, "Free");
    assert.equal((await Subscription.findById(expired._id)).status, "expired");
    assert.equal(await Subscription.countDocuments({ user: agentUser._id }), 1);
  });

  test("demo checkout records no payment and does not activate subscription entitlements or change credits", async () => {
    const agent = await signedInAgent("usage-demo-checkout@example.com");
    const { SubscriptionPlan, Subscription, User, PaymentRecord } = await import("../src/models/index.js");
    const user = await User.findOne({ email: "usage-demo-checkout@example.com" });
    const startingBalance = user.creditBalance;
    const plan = await SubscriptionPlan.create({
      name: "Configured Monthly",
      description: "Configured plan used for the demo checkout integration test.",
      price: 8.5,
      currency: "USD",
      usageLimit: 50,
      cooldownHours: 12,
      billingPeriod: "monthly",
      benefits: ["Higher configured daily allowance"],
      includedFeatures: [],
      restrictedFeatures: [],
      accessRestrictions: [],
      isFree: false,
      isActive: true
    });
    const response = await agent.post("/api/subscriptions/checkout")
      .set("Idempotency-Key", "checkout:demo-case-0001")
      .send({ planId: String(plan._id) });
    assert.equal(response.status, 200);
    assert.equal(response.body.data.checkoutMode, "demo");
    assert.equal(response.body.data.entitlementsActivated, false);
    assert.equal(response.body.data.payment.status, "demo_unpaid");
    assert.match(response.body.message, /No payment was processed/);
    assert.equal(await Subscription.countDocuments({ user: user._id }), 0);
    assert.equal((await User.findById(user._id)).creditBalance, startingBalance);
    assert.equal(await PaymentRecord.countDocuments({ status: "demo_unpaid" }), 1);
  });

  test("signed, idempotent provider webhooks activate a real subscription and cancellation reverts access", async () => {
    const crypto = await import("node:crypto");
    const { createApp } = await import("../src/app.js");
    const { SubscriptionPlan, Subscription, User } = await import("../src/models/index.js");
    const signingSecret = "test-payment-webhook-secret";
    const provider = {
      name: "test-gateway",
      async createCheckout({ paymentId }) {
        return { providerReference: `provider-${paymentId}`, redirectUrl: "https://payments.example.test/checkout" };
      },
      async verifyWebhook(rawBody, signature) {
        const expected = crypto.createHmac("sha256", signingSecret).update(rawBody).digest("hex");
        return signature === expected;
      },
      async parseWebhook(rawBody) { return JSON.parse(rawBody.toString("utf8")); },
      async cancelSubscription() { return true; }
    };
    const paymentApp = createApp({ mailer, paymentProvider: provider });
    const agent = request.agent(paymentApp);
    const pending = await register("verified-checkout@example.com");
    await verify(pending.email, pending.code);
    await completeLogin(pending.email, "a-secure-password", agent);
    const plan = await SubscriptionPlan.create({
      name: "Verified Monthly",
      description: "Provider-backed plan test.",
      price: 12,
      currency: "USD",
      usageLimit: 100,
      cooldownHours: 12,
      billingPeriod: "monthly",
      benefits: ["Provider-verified entitlement"],
      includedFeatures: [],
      restrictedFeatures: [],
      accessRestrictions: [],
      isFree: false,
      isActive: true
    });
    const checkout = await agent.post("/api/subscriptions/checkout")
      .set("Idempotency-Key", "checkout:verified-case-0001")
      .send({ planId: String(plan._id) });
    assert.equal(checkout.status, 201, checkout.body.message);
    const paymentId = checkout.body.data.payment.id;
    const event = {
      paymentId,
      providerReference: `provider-${paymentId}`,
      status: "paid"
    };
    const payload = JSON.stringify(event);
    const signature = crypto.createHmac("sha256", signingSecret).update(payload).digest("hex");
    const invalidSignature = await request(paymentApp).post("/api/subscriptions/webhook")
      .set("x-payment-signature", "invalid-signature").send(event);
    const first = await request(paymentApp).post("/api/subscriptions/webhook").set("x-payment-signature", signature).send(event);
    const repeated = await request(paymentApp).post("/api/subscriptions/webhook").set("x-payment-signature", signature).send(event);
    assert.equal(invalidSignature.status, 401);
    assert.equal(first.status, 200, first.body.message);
    assert.equal(repeated.status, 200, repeated.body.message);
    assert.equal(await Subscription.countDocuments({ status: "active" }), 1);
    const subscription = await Subscription.findOne({ status: "active" });
    const details = await agent.get("/api/subscriptions/me");
    assert.equal(details.body.data.activePlan.name, "Verified Monthly");
    const cancelled = await agent.post("/api/subscriptions/cancel")
      .set("Idempotency-Key", "subscription:cancel-case-01")
      .send({ subscriptionId: String(subscription._id) });
    const repeatedCancellation = await agent.post("/api/subscriptions/cancel")
      .set("Idempotency-Key", "subscription:cancel-case-01")
      .send({ subscriptionId: String(subscription._id) });
    assert.equal(cancelled.status, 200, cancelled.body.message);
    assert.equal(repeatedCancellation.status, 200);
    const afterCancellation = await agent.get("/api/subscriptions/me");
    assert.equal(afterCancellation.body.data.activePlan.name, "Free");
    assert.equal((await User.findOne({ email: pending.email })).creditBalance, 100);
  });

test("duplicate account email is rejected", async () => {
  const pending = await register();
  const created = await verify(pending.email, pending.code);
  assert.equal(created.status, 201);

  const duplicate = await request(app).post("/api/auth/register").send({
    name: "Duplicate",
    email: pending.email.toUpperCase(),
    password: "another-secure-password"
  });
  assert.equal(duplicate.status, 409);
});

test("invalid OTP increments attempt count and the fifth attempt invalidates it", async () => {
  const pending = await register();
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const response = await verify(pending.email, "000000");
    assert.equal(response.status, attempt === 5 ? 429 : 400);
  }
  const lockedOut = await verify(pending.email, pending.code);
  assert.equal(lockedOut.status, 400);
});

test("expired OTP cannot verify an account", async () => {
  const pending = await register();
  const { RegistrationOtp } = await import("../src/models/RegistrationOtp.js");
  await RegistrationOtp.updateOne({ email: pending.email }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
  const response = await verify(pending.email, pending.code);
  assert.equal(response.status, 400);
  const { User } = await import("../src/models/User.js");
  assert.equal(await User.countDocuments({ email: pending.email }), 0);
});

test("resend enforces cooldown and sends a new code once it expires", async () => {
  const pending = await register();
  const early = await request(app).post("/api/auth/resend-otp").send({ email: pending.email });
  assert.equal(early.status, 429);

  const { RegistrationOtp } = await import("../src/models/RegistrationOtp.js");
  await RegistrationOtp.updateOne({ email: pending.email }, { $set: { resendAfter: new Date(Date.now() - 1000) } });
  const resent = await request(app).post("/api/auth/resend-otp").send({ email: pending.email });
  assert.equal(resent.status, 200);
  assert.equal(sentOtps.length, 2);
  assert.notEqual(sentOtps[1].code, pending.code);
  assert.equal((await verify(pending.email, pending.code)).status, 400);
  assert.equal((await verify(pending.email, sentOtps[1].code)).status, 201);
});

test("verification activates account and grants exactly 100 credits once", async () => {
  const pending = await register();
  const verified = await verify(pending.email, pending.code);
  assert.equal(verified.status, 201);
  assert.equal(verified.body.data.user.creditBalance, 100);
  assert.equal(verified.body.data.user.isEmailVerified, true);
  assert.equal("passwordHash" in verified.body.data.user, false);

  assert.equal((await verify(pending.email, pending.code)).status, 400);
  const { User } = await import("../src/models/User.js");
  const { CreditTransaction } = await import("../src/models/CreditTransaction.js");
  const user = await User.findOne({ email: pending.email }).select("+passwordHash");
  assert.equal(user.creditBalance, 100);
  assert.notEqual(user.passwordHash, "a-secure-password");
  assert.equal(await CreditTransaction.countDocuments({ user: user._id, type: "signup-grant" }), 1);
  const grant = await CreditTransaction.findOne({ user: user._id, type: "signup-grant" });
  assert.deepEqual([grant.amount, grant.direction, grant.balanceBefore, grant.balanceAfter], [100, "credit", 0, 100]);
});

test("unverified users cannot log in; login never awards additional credits", async () => {
  const pending = await register();
  const blocked = await request(app).post("/api/auth/login").send({
    email: pending.email,
    password: "a-secure-password"
  });
  assert.equal(blocked.status, 401);

  await verify(pending.email, pending.code);
  const agent = request.agent(app);
  const loginStarted = await agent.post("/api/auth/login").send({ email: pending.email, password: "a-secure-password" });
  assert.equal(loginStarted.status, 202);
  assert.equal(loginStarted.headers["set-cookie"], undefined);
  assert.equal(sentOtps.at(-1).email, pending.email);
  assert.equal(sentOtps.at(-1).purpose, "login");
  const login = await agent.post("/api/auth/verify-login-otp").send({ email: pending.email, otp: sentOtps.at(-1).code });
  assert.equal(login.status, 200);
  assert.equal(login.body.data.user.creditBalance, 100);
  assert.equal(login.headers["set-cookie"][0].toLowerCase().includes("httponly"), true);
  assert.equal(login.headers["set-cookie"][0].includes("Secure"), false);

  const { User } = await import("../src/models/User.js");
  const { CreditTransaction } = await import("../src/models/CreditTransaction.js");
  assert.equal((await User.findOne({ email: pending.email })).creditBalance, 100);
  assert.equal(await CreditTransaction.countDocuments({ type: "signup-grant" }), 1);
});

test("login requires a single-use email OTP and invalid attempts are limited", async () => {
  const pending = await register("login-otp@example.com");
  await verify(pending.email, pending.code);
  const loginOtpStarted = await request(app).post("/api/auth/login").send({
    email: pending.email,
    password: "a-secure-password"
  });
  assert.equal(loginOtpStarted.status, 202);
  const code = sentOtps.at(-1).code;

  const invalid = await request(app).post("/api/auth/verify-login-otp").send({
    email: pending.email,
    otp: "000000"
  });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.headers["set-cookie"], undefined);

  const verified = await request(app).post("/api/auth/verify-login-otp").send({
    email: pending.email,
    otp: code
  });
  assert.equal(verified.status, 200);
  assert.ok(verified.headers["set-cookie"]);
  assert.equal((await request(app).post("/api/auth/verify-login-otp").send({
    email: pending.email,
    otp: code
  })).status, 400);
  const { LoginOtp } = await import("../src/models/LoginOtp.js");
  assert.equal(await LoginOtp.countDocuments(), 0);
});

test("login OTP resend replaces the previous code after the cooldown", async () => {
  const pending = await register("login-otp-resend@example.com");
  await verify(pending.email, pending.code);
  await request(app).post("/api/auth/login").send({
    email: pending.email,
    password: "a-secure-password"
  });
  const firstCode = sentOtps.at(-1).code;
  const { LoginOtp } = await import("../src/models/LoginOtp.js");
  await LoginOtp.updateOne(
    {},
    { $set: { resendAfter: new Date(Date.now() - 1000) } }
  );

  const resent = await request(app).post("/api/auth/resend-login-otp").send({ email: pending.email });
  assert.equal(resent.status, 200);
  const newCode = sentOtps.at(-1).code;
  assert.notEqual(newCode, firstCode);
  assert.equal((await request(app).post("/api/auth/verify-login-otp").send({
    email: pending.email,
    otp: firstCode
  })).status, 400);
  assert.equal((await request(app).post("/api/auth/verify-login-otp").send({
    email: pending.email,
    otp: newCode
  })).status, 200);
});

test("protected current-user route requires cookie and logout clears it", async () => {
  const unauthorized = await request(app).get("/api/auth/me");
  assert.equal(unauthorized.status, 401);

  const pending = await register();
  await verify(pending.email, pending.code);
  const agent = request.agent(app);
  assert.equal((await completeLogin(pending.email, "a-secure-password", agent)).status, 200);
  const me = await agent.get("/api/auth/me");
  assert.equal(me.status, 200);
  assert.equal(me.body.data.user.email, pending.email);
  assert.equal("passwordHash" in me.body.data.user, false);
  const logout = await agent.post("/api/auth/logout");
  assert.equal(logout.status, 200);
  assert.equal((await agent.get("/api/auth/me")).status, 401);
});

test("production authentication cookies are secure", async () => {
  const pending = await register();
  await verify(pending.email, pending.code);
  const previousEnvironment = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    const response = await completeLogin(pending.email, "a-secure-password");
    assert.equal(response.status, 200);
    assert.equal(response.headers["set-cookie"][0].includes("Secure"), true);
    assert.equal(response.headers["set-cookie"][0].toLowerCase().includes("httponly"), true);
    assert.equal(response.headers["set-cookie"][0].toLowerCase().includes("samesite=lax"), true);
  } finally {
    process.env.NODE_ENV = previousEnvironment;
  }
});

test("SMTP delivery failures are explicit and leave no pending registration", async () => {
  const brokenApp = (await import("../src/app.js")).createApp({
    mailer: {
      async sendOtpEmail() { throw Object.assign(new Error("Email is not configured"), { code: "EMAIL_NOT_CONFIGURED" }); },
      async sendPasswordResetEmail() {}
    },
    authRateLimit: { otp: { limit: 200 } }
  });
  const response = await request(brokenApp).post("/api/auth/register").send({
    name: "Test Learner",
    email: "mail-failure@example.com",
    password: "a-secure-password"
  });
  assert.equal(response.status, 503);
  assert.equal(response.body.success, false);
  const { RegistrationOtp } = await import("../src/models/RegistrationOtp.js");
  assert.equal(await RegistrationOtp.countDocuments({ email: "mail-failure@example.com" }), 0);
});

test("password reset does not enumerate accounts and reset token is single-use", async () => {
  const unknownEmail = await request(app).post("/api/auth/forgot-password").send({ email: "nobody@example.com" });
  assert.equal(unknownEmail.status, 200);
  assert.equal(sentResetTokens.length, 0);

  const pending = await register();
  await verify(pending.email, pending.code);
  const forgot = await request(app).post("/api/auth/forgot-password").send({ email: pending.email });
  assert.equal(forgot.status, 200);
  assert.equal(forgot.body.message.includes(pending.email), false);
  const token = sentResetTokens[0].token;

  const invalidToken = await request(app).post("/api/auth/reset-password").send({
    token: `${token.slice(0, -1)}x`,
    password: "new-secure-password"
  });
  assert.equal(invalidToken.status, 400);
  const reset = await request(app).post("/api/auth/reset-password").send({ token, password: "new-secure-password" });
  assert.equal(reset.status, 200);
  assert.equal((await request(app).post("/api/auth/reset-password").send({ token, password: "another-password" })).status, 400);
  assert.equal((await request(app).post("/api/auth/login").send({ email: pending.email, password: "a-secure-password" })).status, 401);
  assert.equal((await completeLogin(pending.email, "new-secure-password")).status, 200);
});

test("expired password reset tokens cannot change a password", async () => {
  const pending = await register();
  await verify(pending.email, pending.code);
  await request(app).post("/api/auth/forgot-password").send({ email: pending.email });
  const token = sentResetTokens[0].token;

  const [{ PasswordResetToken }, { User }] = await Promise.all([
    import("../src/models/PasswordResetToken.js"),
    import("../src/models/User.js")
  ]);
  const user = await User.findOne({ email: pending.email });
  await PasswordResetToken.updateOne({ user: user._id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
  const response = await request(app).post("/api/auth/reset-password").send({ token, password: "new-secure-password" });
  assert.equal(response.status, 400);
  assert.equal((await completeLogin(pending.email, "a-secure-password")).status, 200);
});

test("resend for an unknown address reveals no registration status", async () => {
  const response = await request(app).post("/api/auth/resend-otp").send({ email: "unknown@example.com" });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.data, { resendAfterSeconds: 0 });
});

test("forgot-password does not reveal a delivery failure for a known account", async () => {
  const pending = await register();
  await verify(pending.email, pending.code);
  const failureMailerApp = (await import("../src/app.js")).createApp({
    mailer: {
      async sendOtpEmail() {},
      async sendPasswordResetEmail() {
        throw Object.assign(new Error("SMTP unavailable"), { code: "EMAIL_DELIVERY_FAILED" });
      }
    },
    authRateLimit: { reset: { limit: 200 } }
  });
  const response = await request(failureMailerApp).post("/api/auth/forgot-password").send({ email: pending.email });
  assert.equal(response.status, 200);
  assert.match(response.body.message, /may be sent/);
});

test("model registry includes all Phase 2 domain models", async () => {
  const models = await import("../src/models/index.js");
  for (const name of [
    "User", "Category", "Skill", "Post", "ConnectionRequest", "Conversation",
    "Message", "Session", "SessionParticipant", "CreditTransaction",
    "Notification", "Review", "UsageRecord", "UsageEvent", "UsagePolicy",
    "SubscriptionPlan", "Subscription", "PaymentRecord", "AuditLog", "Dispute",
    "RegistrationOtp", "PasswordResetToken", "SkillSuggestion"
  ]) {
    assert.ok(models[name], `${name} model should be registered`);
  }
});

async function makeProfileUser(overrides = {}) {
  const { User } = await import("../src/models/User.js");
  const user = await User.create({
    name: "Profile Learner",
    email: `profile-${Math.random().toString(36).slice(2)}@example.com`,
    passwordHash: "not-used-by-these-tests",
    isEmailVerified: true,
    accountStatus: "active",
    ...overrides
  });
  return user;
}

function authenticatedAgent(user) {
  return withUsageIdempotency(request.agent(app).set("Cookie", `${getAuthCookieName()}=${createAuthToken(user)}`));
}

async function makeCategory(name, isActive = true) {
  const { Category } = await import("../src/models/Category.js");
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return Category.create({ name, slug, description: "", isActive });
}

async function makeSkill(category, name) {
  const { Skill } = await import("../src/models/Skill.js");
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return Skill.create({ name, slug, category: category._id, isActive: true });
}

test("profile retrieval and update only permit own editable fields", async () => {
  const user = await makeProfileUser({ creditBalance: 100 });
  const agent = authenticatedAgent(user);
  const profile = await agent.get("/api/users/me");
  assert.equal(profile.status, 200);
  assert.equal(profile.body.data.user.email, user.email);
  assert.equal(profile.body.data.user.profileCompletion.percent, 13);

  const update = await agent.patch("/api/users/me").send({
    name: "Updated Learner",
    bio: "I am happy to share what I have learned.",
    location: "Chennai",
    languages: ["English", "Telugu"],
    interests: ["Web development"],
    experienceLevel: "intermediate",
    preferredLearningMode: "online",
    availableTimeSlots: [{ dayOfWeek: 2, startTime: "09:00", endTime: "10:00", timezone: "Asia/Kolkata" }],
    profileImage: "https://example.com/profile.png",
    email: "attacker@example.com",
    creditBalance: 999999,
    permissions: ["manage:catalog"],
    accountType: "admin",
    isEmailVerified: false,
    passwordHash: "changed"
  });
  assert.equal(update.status, 200);
  assert.equal(update.body.data.user.name, "Updated Learner");
  assert.equal(update.body.data.user.email, user.email);
  assert.equal(update.body.data.user.creditBalance, 100);
  assert.equal(update.body.data.user.accountType, "user");
  assert.equal(update.body.data.user.permissions, undefined);
  const { User } = await import("../src/models/User.js");
  const stored = await User.findById(user._id).select("+passwordHash");
  assert.equal(stored.isEmailVerified, true);
  assert.equal(stored.passwordHash, "not-used-by-these-tests");
});

test("profile patch validates supported fields and protected profile routes require authentication", async () => {
  const unauthorized = await request(app).patch("/api/users/me").send({ name: "Should not work" });
  assert.equal(unauthorized.status, 401);
  const user = await makeProfileUser();
  const invalid = await authenticatedAgent(user).patch("/api/users/me").send({
    preferredLearningMode: "everywhere",
    availableTimeSlots: [{ dayOfWeek: 8, startTime: "25:60", endTime: "08:00" }]
  });
  assert.equal(invalid.status, 400);
  const { User } = await import("../src/models/User.js");
  assert.equal((await User.findById(user._id)).preferredLearningMode, "either");
});

test("users can select existing teaching and learning skills and remove only their own references", async () => {
  const user = await makeProfileUser();
  const category = await makeCategory("Programming");
  const [react, java] = await Promise.all([makeSkill(category, "React"), makeSkill(category, "Java")]);
  const agent = authenticatedAgent(user);
  const saved = await agent.put("/api/users/me/skills").send({
    skillsToTeach: [String(react._id)],
    skillsToLearn: [String(java._id)]
  });
  assert.equal(saved.status, 200);
  const listed = await agent.get("/api/users/me/skills");
  assert.equal(listed.body.data.skillsToTeach[0].name, "React");
  assert.equal(listed.body.data.skillsToLearn[0].name, "Java");
  const removed = await agent.delete(`/api/users/me/skills/${react._id}`);
  assert.equal(removed.status, 200);
  assert.equal((await agent.get("/api/users/me/skills")).body.data.skillsToTeach.length, 0);
  assert.equal((await agent.delete(`/api/users/me/skills/${react._id}`)).status, 404);
  assert.equal((await agent.put("/api/users/me/skills").send({
    skillsToTeach: [String(new mongoose.Types.ObjectId())],
    skillsToLearn: []
  })).status, 400);
});

test("categories and skills are Mongo-backed, inactive catalog entries stay hidden, and suggestions are moderated", async () => {
  const active = await makeCategory("Technology");
  const inactive = await makeCategory("Hidden arts", false);
  const python = await makeSkill(active, "Python");
  await makeSkill(inactive, "Secret skill");
  const list = await request(app).get("/api/categories");
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.data.categories.map(category => category.name), ["Technology"]);
  const category = await request(app).get("/api/categories/technology");
  assert.equal(category.body.data.category.slug, "technology");
  const skills = await request(app).get("/api/categories/technology/skills");
  assert.deepEqual(skills.body.data.skills.map(skill => skill.name), ["Python"]);
  assert.equal((await request(app).get("/api/categories/hidden-arts")).status, 404);

  const user = await makeProfileUser();
  const suggestion = await authenticatedAgent(user).post("/api/skills/suggestions").send({
    name: "New experimental topic",
    category: String(active._id),
    description: "Please add this learning topic"
  });
  assert.equal(suggestion.status, 201);
  assert.equal(await (await import("../src/models/Skill.js")).Skill.countDocuments({ _id: python._id }), 1);
  assert.equal(await (await import("../src/models/Skill.js")).Skill.countDocuments({ category: active._id, slug: "new-experimental-topic" }), 0);
});

test("category-scoped skills prevent duplicate normalized slugs", async () => {
  const category = await makeCategory("Languages");
  await makeSkill(category, "Spoken English");
  const { Skill } = await import("../src/models/Skill.js");
  await assert.rejects(() => Skill.create({
    name: "spoken   english",
    slug: "spoken-english",
    category: category._id
  }), error => error.code === 11000);
});

test("admin-only category and skill management rejects ordinary users", async () => {
  const user = await makeProfileUser();
  const userAgent = authenticatedAgent(user);
  assert.equal((await userAgent.post("/api/categories").send({ name: "New category" })).status, 403);
  assert.equal((await userAgent.post("/api/skills").send({ name: "New skill" })).status, 403);

  user.accountType = "admin";
  await user.save();
  const admin = authenticatedAgent(user);
  const created = await admin.post("/api/categories").send({ name: "Admin category", description: "Managed by admin" });
  assert.equal(created.status, 201);
  const skill = await admin.post("/api/skills").send({
    name: "Managed topic",
    category: String(created.body.data.category._id)
  });
  assert.equal(skill.status, 201);
  const updated = await admin.patch(`/api/categories/${created.body.data.category._id}`).send({ name: "Renamed category" });
  assert.equal(updated.body.data.category.slug, "renamed-category");
  assert.equal((await admin.delete(`/api/categories/${created.body.data.category._id}`)).status, 200);
  assert.equal((await request(app).get("/api/categories/renamed-category")).status, 404);
});

test("tutor search filters by teaching skill, category, experience, language, mode, availability, and pagination", async () => {
  const category = await makeCategory("Technology");
  const [java, python] = await Promise.all([makeSkill(category, "Java"), makeSkill(category, "Python")]);
  const first = await makeProfileUser({
    name: "Java Teacher",
    skillsToTeach: [java._id],
    experienceLevel: "advanced",
    languages: ["English"],
    preferredLearningMode: "online",
    availableTimeSlots: [{ dayOfWeek: 2, startTime: "10:00", endTime: "12:00" }]
  });
  await makeProfileUser({ name: "Python Teacher", skillsToTeach: [python._id] });
  const current = await makeProfileUser({ name: "Current Learner", skillsToTeach: [java._id] });
  const agent = authenticatedAgent(current);

  const found = await agent.get("/api/tutors/search").query({
    category: "technology",
    skill: "java",
    experience: "advanced",
    language: "english",
    mode: "online",
    dayOfWeek: 2,
    page: 1,
    limit: 1
  });
  assert.equal(found.status, 200);
  assert.equal(found.body.data.pagination.total, 1);
  assert.equal(found.body.data.tutors[0].user.name, "Java Teacher");
  assert.equal(found.body.data.tutors[0].user.creditBalance, undefined);
  assert.equal(found.body.data.tutors[0].user.email, undefined);
  assert.equal(String(found.body.data.tutors[0].user._id), String(first._id));
});

test("tutor search excludes self, unverified, inactive, and private profiles and supports empty result/pagination", async () => {
  const category = await makeCategory("Academics");
  const math = await makeSkill(category, "Mathematics");
  const current = await makeProfileUser({ skillsToTeach: [math._id] });
  await makeProfileUser({ name: "Unverified", isEmailVerified: false, skillsToTeach: [math._id] });
  await makeProfileUser({ name: "Suspended", accountStatus: "suspended", skillsToTeach: [math._id] });
  await makeProfileUser({ name: "Private", isProfilePublic: false, skillsToTeach: [math._id] });
  const agent = authenticatedAgent(current);

  const noTutors = await agent.get("/api/tutors").query({ skill: "mathematics" });
  assert.equal(noTutors.status, 200);
  assert.equal(noTutors.body.data.tutors.length, 0);
  assert.equal(noTutors.body.data.pagination.total, 0);
  const noMatch = await agent.get("/api/tutors/search").query({ skill: "nonexistent" });
  assert.equal(noMatch.body.data.tutors.length, 0);
  assert.equal((await agent.get("/api/tutors").query({ limit: 51 })).status, 400);
});

test("public tutor profile excludes private fields and respects profile visibility", async () => {
  const category = await makeCategory("Creative");
  const music = await makeSkill(category, "Singing");
  const tutor = await makeProfileUser({
    name: "Public Tutor",
    bio: "A public bio for learners",
    location: "Hyderabad",
    skillsToTeach: [music._id],
    creditBalance: 500,
    permissions: ["manage:catalog"]
  });
  const agent = authenticatedAgent(await makeProfileUser());
  const profile = await agent.get(`/api/tutors/${tutor._id}`);
  assert.equal(profile.status, 200);
  assert.equal(profile.body.data.tutor.name, "Public Tutor");
  assert.equal(profile.body.data.tutor.skillsToTeach[0].name, "Singing");
  for (const privateField of ["email", "creditBalance", "permissions", "passwordHash"]) {
    assert.equal(privateField in profile.body.data.tutor, false);
  }
  tutor.isProfilePublic = false;
  await tutor.save();
  assert.equal((await agent.get(`/api/tutors/${tutor._id}`)).status, 404);
  assert.equal((await agent.get("/api/tutors/not-an-id")).status, 400);
});

test("tutor discovery paginates ordered database results and filters by review rating", async () => {
  const category = await makeCategory("Languages");
  const english = await makeSkill(category, "English conversation");
  const alpha = await makeProfileUser({ name: "Alpha Tutor", skillsToTeach: [english._id] });
  const beta = await makeProfileUser({ name: "Beta Tutor", skillsToTeach: [english._id] });
  const gamma = await makeProfileUser({ name: "Gamma Tutor", skillsToTeach: [english._id] });
  const learner = await makeProfileUser();
  const { Session } = await import("../src/models/Session.js");
  const { Review } = await import("../src/models/Review.js");
  const alphaStartsAt = new Date(Date.now() - 86400000);
  const session = await Session.create({
    title: "English conversation",
    skill: english._id,
    category: category._id,
    tutor: alpha._id,
    learner: learner._id,
    conversation: new mongoose.Types.ObjectId(),
    createdBy: alpha._id,
    startsAt: alphaStartsAt,
    endsAt: new Date(alphaStartsAt.getTime() + 60 * 60_000),
    timezone: "UTC",
    durationMinutes: 60,
    status: "completed"
  });
  await Review.create({ session: session._id, author: learner._id, recipient: alpha._id, rating: 5, text: "Great lesson" });
  const betaStartsAt = new Date(Date.now() - 172800000);
  const betaSession = await Session.create({
    title: "English basics",
    skill: english._id,
    category: category._id,
    tutor: beta._id,
    learner: learner._id,
    conversation: new mongoose.Types.ObjectId(),
    createdBy: beta._id,
    startsAt: betaStartsAt,
    endsAt: new Date(betaStartsAt.getTime() + 60 * 60_000),
    timezone: "UTC",
    durationMinutes: 60,
    status: "completed"
  });
  await Review.create({ session: betaSession._id, author: learner._id, recipient: beta._id, rating: 3, text: "Helpful" });

  const agent = authenticatedAgent(learner);
  const firstPage = await agent.get("/api/tutors/search").query({ skill: "english-conversation", sort: "name", limit: 1, page: 1 });
  const secondPage = await agent.get("/api/tutors/search").query({ skill: "english-conversation", sort: "name", limit: 1, page: 2 });
  assert.equal(firstPage.body.data.pagination.total, 3);
  assert.equal(firstPage.body.data.pagination.pages, 3);
  assert.notEqual(firstPage.body.data.tutors[0].user._id, secondPage.body.data.tutors[0].user._id);

  const highRated = await agent.get("/api/tutors/search").query({ skill: "english-conversation", minRating: 4 });
  assert.deepEqual(highRated.body.data.tutors.map(item => item.user.name), ["Alpha Tutor"]);
  assert.equal(highRated.body.data.tutors[0].rating.average, 5);
  const maxRating = await agent.get("/api/tutors/search").query({ skill: "english-conversation", maxRating: 3 });
  assert.deepEqual(maxRating.body.data.tutors.map(item => item.user.name), ["Beta Tutor"]);
});

test("category skill listing and tutor search include active nested subcategories", async () => {
  const root = await makeCategory("Technical Education");
  const child = await makeCategory("Frontend Skills");
  const { Category } = await import("../src/models/Category.js");
  child.parent = root._id;
  await child.save();
  const react = await makeSkill(child, "React UI");
  const teacher = await makeProfileUser({ skillsToTeach: [react._id] });
  const learner = await makeProfileUser();
  const categorySkills = await request(app).get("/api/categories/technical-education/skills");
  assert.equal(categorySkills.status, 200);
  assert.equal(categorySkills.body.data.skills[0].name, "React UI");
  const result = await authenticatedAgent(learner).get("/api/tutors").query({ category: "technical-education" });
  assert.deepEqual(result.body.data.tutors.map(item => item.user.name), [teacher.name]);
});

test("category, skill, and tutor query input limits are enforced", async () => {
  const user = await makeProfileUser();
  const agent = authenticatedAgent(user);
  assert.equal((await agent.get("/api/tutors").query({ q: "x".repeat(81) })).status, 400);
  assert.equal((await agent.get("/api/tutors").query({ experience: "world-class" })).status, 400);
  assert.equal((await agent.get("/api/tutors").query({ sort: "$where" })).status, 400);
});

async function createConnectionFixture() {
  const category = await makeCategory(`Chat skills ${new mongoose.Types.ObjectId()}`);
  const skill = await makeSkill(category, "Guitar");
  const learner = await makeProfileUser({ name: "Learner Name" });
  const tutor = await makeProfileUser({ name: "Tutor Name", skillsToTeach: [skill._id] });
  const outsider = await makeProfileUser({ name: "Outside User" });
  return { category, skill, learner, tutor, outsider };
}

test("connections create one persistent conversation and the exact initial message once", async () => {
  const { skill, learner, tutor } = await createConnectionFixture();
  const learnerAgent = authenticatedAgent(learner);
  const unauthenticated = await request(app).post("/api/connections").send({ tutorId: tutor.id, skillId: skill.id });
  assert.equal(unauthenticated.status, 401);

  const selfConnect = await learnerAgent.post("/api/connections").send({
    tutorId: learner.id,
    skillId: skill.id
  });
  assert.equal(selfConnect.status, 400);
  const invalidSkill = await learnerAgent.post("/api/connections").send({
    tutorId: tutor.id,
    skillId: String(new mongoose.Types.ObjectId())
  });
  assert.equal(invalidSkill.status, 404);

  const first = await learnerAgent.post("/api/connections").send({
    tutorId: tutor.id,
    skillId: skill.id
  });
  assert.equal(first.status, 201, first.body.message);
  assert.equal(first.body.data.status, "pending");
  const repeated = await learnerAgent.post("/api/connections").send({
    tutorId: tutor.id,
    skillId: skill.id
  });
  assert.equal(repeated.status, 200);
  assert.equal(repeated.body.data.conversationId, first.body.data.conversationId);

  const [{ ConnectionRequest }, { Conversation }, { Message }, { Notification }] = await Promise.all([
    import("../src/models/ConnectionRequest.js"),
    import("../src/models/Conversation.js"),
    import("../src/models/Message.js"),
    import("../src/models/Notification.js")
  ]);
  assert.equal(await ConnectionRequest.countDocuments({ learner: learner.id, tutor: tutor.id, skill: skill.id }), 1);
  assert.equal(await Conversation.countDocuments({ connectionRequest: first.body.data.connectionId }), 1);
  assert.equal(await Message.countDocuments({ conversation: first.body.data.conversationId, messageType: "initial_template" }), 1);
  assert.equal(await Notification.countDocuments({ user: tutor.id, type: "connection_request" }), 1);
  const initial = await Message.findOne({ conversation: first.body.data.conversationId });
  assert.equal(initial.sender.toString(), learner.id);
  assert.equal(initial.messageType, "initial_template");
  assert.equal(initial.text, "Hi! I'm Learner Name. I'm interested in learning Guitar from you. Could we connect for a learning session? Please let me know your available time slots. Thank you!");

  const tutorAgent = authenticatedAgent(tutor);
  const conversation = await tutorAgent.get(`/api/conversations/${first.body.data.conversationId}`);
  assert.equal(conversation.status, 200);
  assert.equal(conversation.body.data.conversation.participants.length, 2);
  assert.equal(conversation.body.data.conversation.skill.name, "Guitar");
  assert.equal((await learnerAgent.get("/api/connections")).body.data.connections.length, 1);
});

test("only the intended tutor can accept or reject a connection", async () => {
  const { skill, learner, tutor, outsider } = await createConnectionFixture();
  const created = await authenticatedAgent(learner).post("/api/connections").send({
    tutorId: tutor.id,
    skillId: skill.id
  });
  assert.equal(created.status, 201, created.body.message);
  const id = created.body.data.connectionId;
  assert.equal((await authenticatedAgent(outsider).patch(`/api/connections/${id}/accept`)).status, 403);
  assert.equal((await authenticatedAgent(learner).patch(`/api/connections/${id}/accept`)).status, 403);

  const accepted = await authenticatedAgent(tutor).patch(`/api/connections/${id}/accept`);
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.data.connection.status, "accepted");
  assert.equal((await authenticatedAgent(tutor).patch(`/api/connections/${id}/accept`)).status, 200);

  const otherLearner = await makeProfileUser({ name: "Another Learner" });
  const rejectedRequest = await authenticatedAgent(otherLearner).post("/api/connections").send({
    tutorId: tutor.id,
    skillId: skill.id
  });
  const rejected = await authenticatedAgent(tutor).patch(`/api/connections/${rejectedRequest.body.data.connectionId}/reject`);
  assert.equal(rejected.status, 200);
  assert.equal(rejected.body.data.connection.status, "rejected");
});

test("chat REST APIs enforce participant access, paginate, edit/delete sender messages, and track read state", async () => {
  const { skill, learner, tutor, outsider } = await createConnectionFixture();
  const learnerAgent = authenticatedAgent(learner);
  const tutorAgent = authenticatedAgent(tutor);
  const outsiderAgent = authenticatedAgent(outsider);
  const created = await learnerAgent.post("/api/connections").send({ tutorId: tutor.id, skillId: skill.id });
  assert.equal(created.status, 201, created.body.message);
  const conversationId = created.body.data.conversationId;
  const connectionId = created.body.data.connectionId;

  assert.equal((await outsiderAgent.get(`/api/conversations/${conversationId}`)).status, 404);
  assert.equal((await outsiderAgent.get(`/api/conversations/${conversationId}/messages`)).status, 404);
  assert.equal((await outsiderAgent.post(`/api/conversations/${conversationId}/messages`).send({
    text: "Unauthorized",
    clientMessageId: "outsider-message"
  })).status, 404);

  const send = (clientMessageId, text) => learnerAgent.post(`/api/conversations/${conversationId}/messages`).send({
    text,
    clientMessageId,
    sender: String(outsider.id)
  });
  const first = await send("message-one", "A real persisted message");
  assert.equal(first.status, 201);
  assert.equal(first.body.data.message.sender._id, learner.id);
  const duplicate = await send("message-one", "A retry must not duplicate");
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.body.data.duplicate, true);
  assert.equal(duplicate.body.data.message._id, first.body.data.message._id);
  const second = await send("message-two", "A second message");
  assert.equal(second.status, 201);
  const third = await send("message-three", "A third message");
  assert.equal(third.status, 201);
  const { Notification } = await import("../src/models/Notification.js");
  assert.equal(await Notification.countDocuments({
    user: tutor.id,
    type: "new_message",
    resourceId: conversationId
  }), 3);
  assert.equal((await send("message-three", "A retried message")).body.data.duplicate, true);
  assert.equal(await Notification.countDocuments({
    user: tutor.id,
    type: "new_message",
    resourceId: conversationId
  }), 3);

  const page = await tutorAgent.get(`/api/conversations/${conversationId}/messages`).query({ limit: 2 });
  assert.equal(page.status, 200);
  assert.equal(page.body.data.messages.length, 2);
  assert.equal(page.body.data.pagination.hasMore, true);
  const older = await tutorAgent.get(`/api/conversations/${conversationId}/messages`).query({
    limit: 2,
    before: page.body.data.pagination.nextBefore,
    beforeId: page.body.data.pagination.nextBeforeId
  });
  assert.equal(older.status, 200);
  assert.ok(older.body.data.messages.every(message => !page.body.data.messages.some(row => row._id === message._id)));

  const messageId = first.body.data.message._id;
  assert.equal((await tutorAgent.patch(`/api/messages/${messageId}`).send({ text: "Not my message" })).status, 404);
  const edited = await learnerAgent.patch(`/api/messages/${messageId}`).send({ text: "Updated by its sender" });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.data.message.text, "Updated by its sender");
  assert.ok(edited.body.data.message.editedAt);
  assert.equal((await tutorAgent.delete(`/api/messages/${messageId}`)).status, 404);
  const deleted = await learnerAgent.delete(`/api/messages/${messageId}`);
  assert.equal(deleted.status, 200, JSON.stringify(deleted.body));
  assert.equal(deleted.body.data.message.text, "");
  const persistedDeleted = await tutorAgent.get(`/api/conversations/${conversationId}/messages`).query({ limit: 100 });
  assert.equal(persistedDeleted.body.data.messages.find(message => message._id === messageId).text, "");

  const tutorConversations = await tutorAgent.get("/api/conversations");
  const tutorConversation = tutorConversations.body.data.conversations.find(row => row._id === conversationId);
  assert.equal(tutorConversation.unreadCount, 4);
  const read = await tutorAgent.patch(`/api/conversations/${conversationId}/read`);
  assert.equal(read.status, 200, JSON.stringify(read.body));
  const readState = (await tutorAgent.get("/api/conversations")).body.data.conversations.find(row => row._id === conversationId);
  assert.equal(readState.unreadCount, 0);
  assert.equal((await learnerAgent.get(`/api/conversations/${conversationId}/messages`).query({ limit: 100 }))
    .body.data.messages.filter(message => message.sender._id === learner.id && !message.deletedAt)
    .every(message => message.readBy.some(id => String(id) === tutor.id)), true);
  assert.equal((await request(app).get(`/api/conversations/${conversationId}/messages`)).status, 401);
  assert.equal((await tutorAgent.patch(`/api/connections/${connectionId}/reject`)).status, 200);
});

function connectSocket(socket) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Socket connection timed out")), 3000);
    socket.once("connect", () => { clearTimeout(timer); resolve(); });
    socket.once("connect_error", error => { clearTimeout(timer); reject(error); });
    socket.connect();
  });
}

function emitSocket(socket, event, payload) {
  return new Promise(resolve => socket.emit(event, payload, resolve));
}

test("Socket.IO requires the HTTP-only auth cookie and authorizes conversation rooms and persisted sends", async () => {
  const { skill, learner, tutor, outsider } = await createConnectionFixture();
  const created = await authenticatedAgent(learner).post("/api/connections").send({
    tutorId: tutor.id,
    skillId: skill.id
  });
  assert.equal(created.status, 201, created.body.message);
  const conversationId = created.body.data.conversationId;
  const httpServer = createServer(app);
  const ioServer = new Server(httpServer, { cors: { origin: process.env.CLIENT_URL, credentials: true } });
  attachRealtime(ioServer);
  await new Promise(resolve => httpServer.listen(0, "127.0.0.1", resolve));
  const address = httpServer.address();
  const url = `http://127.0.0.1:${address.port}`;
  const cookie = `${getAuthCookieName()}=${createAuthToken(learner)}`;
  const tutorCookie = `${getAuthCookieName()}=${createAuthToken(tutor)}`;
  const outsiderCookie = `${getAuthCookieName()}=${createAuthToken(outsider)}`;
  const clients = [];
  try {
    const unauthenticated = createSocketClient(url, { autoConnect: false, transports: ["websocket"] });
    clients.push(unauthenticated);
    await assert.rejects(connectSocket(unauthenticated), /Authentication required/);
    const learnerSocket = createSocketClient(url, {
      autoConnect: false,
      transports: ["websocket"],
      extraHeaders: { Cookie: cookie }
    });
    const tutorSocket = createSocketClient(url, {
      autoConnect: false,
      transports: ["websocket"],
      extraHeaders: { Cookie: tutorCookie }
    });
    const outsiderSocket = createSocketClient(url, {
      autoConnect: false,
      transports: ["websocket"],
      extraHeaders: { Cookie: outsiderCookie }
    });
    clients.push(learnerSocket, tutorSocket, outsiderSocket);
    await Promise.all([connectSocket(learnerSocket), connectSocket(tutorSocket), connectSocket(outsiderSocket)]);
    assert.equal((await emitSocket(outsiderSocket, "conversation:join", { conversationId })).success, false);
    assert.equal((await emitSocket(tutorSocket, "conversation:join", { conversationId })).success, true);
    assert.equal((await emitSocket(learnerSocket, "conversation:join", { conversationId, userId: outsider.id })).success, true);

    const delivered = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("No realtime message was delivered")), 3000);
      tutorSocket.once("message:new", payload => { clearTimeout(timer); resolve(payload.message); });
    });
    const notified = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("No realtime notification was delivered")), 3000);
      tutorSocket.once("notification:new", payload => { clearTimeout(timer); resolve(payload); });
    });
    const sendAck = await emitSocket(learnerSocket, "message:send", {
      conversationId,
      text: "Socket message stored before broadcast",
      clientMessageId: "socket-message-1",
      senderId: outsider.id
    });
    assert.equal(sendAck.success, true, sendAck.message);
    const received = await delivered;
    const notification = await notified;
    assert.equal(received.text, "Socket message stored before broadcast");
    assert.equal(received.sender._id, learner.id);
    assert.equal(notification.type, "new_message");
    assert.equal(notification.user, tutor.id);
    const retry = await emitSocket(learnerSocket, "message:send", {
      conversationId,
      text: "Socket retry",
      clientMessageId: "socket-message-1",
      senderId: outsider.id
    });
    assert.equal(retry.success, true);
    assert.equal(retry.data.duplicate, true);

    const [{ Message }, { Notification }] = await Promise.all([
      import("../src/models/Message.js"),
      import("../src/models/Notification.js")
    ]);
    assert.equal(await Message.countDocuments({ conversation: conversationId, clientMessageId: "socket-message-1" }), 1);
    assert.equal(await Notification.countDocuments({ user: tutor.id, type: "new_message" }), 1);
    assert.equal((await emitSocket(outsiderSocket, "typing:start", { conversationId })).success, false);
  } finally {
    clients.forEach(client => client.disconnect());
    await new Promise(resolve => ioServer.close(resolve));
  }
});

function futureUtcBookingInput(daysAhead = 10) {
  const date = new Date(Date.now() + daysAhead * 24 * 60 * 60_000);
  return {
    date: date.toISOString().slice(0, 10),
    startTime: "10:00",
    timezone: "UTC",
    durationMinutes: 30,
    format: "online",
    title: "Focused guitar practice",
    description: "Practice chord transitions."
  };
}

async function createAcceptedBookingFixture() {
  const fixture = await createConnectionFixture();
  fixture.tutor.availableTimeSlots = Array.from({ length: 7 }, (_, dayOfWeek) => ({
    dayOfWeek, startTime: "00:00", endTime: "23:59", timezone: "UTC"
  }));
  await fixture.tutor.save();
  const created = await authenticatedAgent(fixture.learner).post("/api/connections").send({
    tutorId: fixture.tutor.id, skillId: fixture.skill.id
  });
  assert.equal(created.status, 201, created.body.message);
  fixture.conversationId = created.body.data.conversationId;
  fixture.connectionId = created.body.data.connectionId;
  const accepted = await authenticatedAgent(fixture.tutor).patch(`/api/connections/${fixture.connectionId}/accept`);
  assert.equal(accepted.status, 200);
  return fixture;
}

test("session proposal validates access, timezone, duration, availability, and creates persistent notifications without transferring credits", async () => {
  const { skill, learner, tutor, outsider, conversationId } = await createAcceptedBookingFixture();
  const tutorAgent = authenticatedAgent(tutor);
  const unauthorized = await authenticatedAgent(learner).post("/api/sessions").send({
    ...futureUtcBookingInput(), conversationId, skillId: skill.id, idempotencyKey: "unauthorized-booking"
  });
  assert.equal(unauthorized.status, 403);
  const invalidDuration = await tutorAgent.post("/api/sessions").send({
    ...futureUtcBookingInput(), conversationId, skillId: skill.id, durationMinutes: 20,
    idempotencyKey: "invalid-duration"
  });
  assert.equal(invalidDuration.status, 400);
  const invalidDate = await tutorAgent.post("/api/sessions").send({
    ...futureUtcBookingInput(), conversationId, skillId: skill.id, date: "2026-02-30",
    idempotencyKey: "invalid-date-time"
  });
  assert.equal(invalidDate.status, 400);
  const invalidTimezone = await tutorAgent.post("/api/sessions").send({
    ...futureUtcBookingInput(), conversationId, skillId: skill.id, timezone: "Not/AZone",
    idempotencyKey: "invalid-timezone"
  });
  assert.equal(invalidTimezone.status, 400);

  const startBalance = [learner.creditBalance, tutor.creditBalance];
  const created = await tutorAgent.post("/api/sessions").set("Idempotency-Key", "booking-proposal-001").send({
    ...futureUtcBookingInput(), conversationId, skillId: skill.id,
    tutor: outsider.id, learner: outsider.id, status: "scheduled", creditPrice: 0,
    idempotencyKey: "booking-proposal-001"
  });
  assert.equal(created.status, 201, created.body.message);
  assert.equal(created.body.data.session.status, "pending");
  assert.equal(String(created.body.data.session.tutor._id), tutor.id);
  assert.equal(String(created.body.data.session.learner._id), learner.id);
  assert.equal(created.body.data.session.durationMinutes, 30);
  assert.equal(new Date(created.body.data.session.endsAt) - new Date(created.body.data.session.startsAt), 30 * 60_000);

  const retry = await tutorAgent.post("/api/sessions").set("Idempotency-Key", "booking-proposal-001").send({
    ...futureUtcBookingInput(), conversationId, skillId: skill.id, idempotencyKey: "booking-proposal-001"
  });
  assert.equal(retry.status, 200);
  assert.equal(retry.body.data.session._id, created.body.data.session._id);

  const { Notification, Session, CreditTransaction } = await import("../src/models/index.js");
  assert.equal(await Session.countDocuments({ conversation: conversationId }), 1);
  assert.equal(await Notification.countDocuments({ user: learner.id, type: "session_proposed" }), 1);
  assert.deepEqual([ (await (await import("../src/models/User.js")).User.findById(learner.id)).creditBalance,
    (await (await import("../src/models/User.js")).User.findById(tutor.id)).creditBalance ], startBalance);
  assert.equal(await CreditTransaction.countDocuments({ session: created.body.data.session._id }), 0);
  assert.equal((await authenticatedAgent(outsider).get(`/api/sessions/${created.body.data.session._id}`)).status, 404);
  assert.equal((await authenticatedAgent(learner).get(`/api/sessions/${created.body.data.session._id}`)).status, 200);
  assert.equal(await Notification.countDocuments({ user: tutor.id, type: "session_accepted" }), 0);
});

test("session acceptance, rejection, cancellation, calendar authorization, and private availability work", async () => {
  const fixture = await createAcceptedBookingFixture();
  const { skill, learner, tutor, outsider, conversationId } = fixture;
  const tutorAgent = authenticatedAgent(tutor);
  const learnerAgent = authenticatedAgent(learner);
  const input = futureUtcBookingInput();
  const proposed = await tutorAgent.post("/api/sessions").send({
    ...input, conversationId, skillId: skill.id, idempotencyKey: "session-accept-001"
  });
  const sessionId = proposed.body.data.session._id;
  assert.equal((await authenticatedAgent(outsider).patch(`/api/sessions/${sessionId}/accept`)).status, 403);
  const accepted = await learnerAgent.patch(`/api/sessions/${sessionId}/accept`);
  assert.equal(accepted.status, 200, accepted.body.message);
  assert.equal(accepted.body.data.session.status, "scheduled");
  assert.ok(accepted.body.data.session.acceptedAt);
  assert.equal((await learnerAgent.get("/api/sessions/calendar").query({
    from: new Date(Date.now()).toISOString(),
    to: new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString()
  })).body.data.sessions.length, 1);
  assert.equal((await learnerAgent.get("/api/sessions").query({ period: "upcoming" })).body.data.sessions.length, 1);

  const otherLearner = await makeProfileUser({ name: "Rejecting learner" });
  const newConnection = await authenticatedAgent(otherLearner).post("/api/connections").send({ tutorId: tutor.id, skillId: skill.id });
  await tutorAgent.patch(`/api/connections/${newConnection.body.data.connectionId}/accept`);
  const rejectedProposal = await tutorAgent.post("/api/sessions").send({
    ...futureUtcBookingInput(20), conversationId: newConnection.body.data.conversationId,
    skillId: skill.id, idempotencyKey: "session-reject-001"
  });
  const rejectedId = rejectedProposal.body.data.session._id;
  assert.equal((await authenticatedAgent(tutor).patch(`/api/sessions/${rejectedId}/reject`)).status, 403);
  const rejected = await authenticatedAgent(otherLearner).patch(`/api/sessions/${rejectedId}/reject`);
  assert.equal(rejected.status, 200);
  assert.equal(rejected.body.data.session.status, "rejected");
  const { Notification } = await import("../src/models/Notification.js");
  assert.equal(await Notification.countDocuments({ resourceId: rejectedId, type: "session_rejected" }), 2);
  assert.equal(await Notification.countDocuments({ resourceId: sessionId, type: "session_scheduled" }), 1);

  const cancelled = await learnerAgent.patch(`/api/sessions/${sessionId}/cancel`).send({ reason: "Schedule changed" });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.data.session.status, "cancelled");
  assert.equal((await authenticatedAgent(outsider).patch(`/api/sessions/${sessionId}/cancel`).send({ reason: "No access" })).status, 403);

  const availability = await tutorAgent.get("/api/sessions/availability");
  assert.equal(availability.status, 200);
  assert.equal(availability.body.data.unavailableTimeRanges.length, 0);
  assert.equal((await learnerAgent.get("/api/sessions/availability")).status, 200);
  const badAvailability = await tutorAgent.put("/api/sessions/availability").send({
    availableTimeSlots: [{ dayOfWeek: 9, startTime: "09:00", endTime: "10:00", timezone: "UTC" }]
  });
  assert.equal(badAvailability.status, 400);
  const goodAvailability = await tutorAgent.put("/api/sessions/availability").send({
    availableTimeSlots: [{ dayOfWeek: 1, startTime: "09:00", endTime: "12:00", timezone: "Asia/Kolkata" }],
    unavailableTimeRanges: []
  });
  assert.equal(goodAvailability.status, 200);
  assert.equal(goodAvailability.body.data.availableTimeSlots[0].timezone, "Asia/Kolkata");
});

test("session conflicts are checked for tutor and learner and concurrent proposals serialize", async () => {
  const fixture = await createAcceptedBookingFixture();
  const { skill, learner, tutor, conversationId } = fixture;
  const tutorAgent = authenticatedAgent(tutor);
  const scheduledInput = futureUtcBookingInput(12);
  const first = await tutorAgent.post("/api/sessions").send({
    ...scheduledInput, conversationId, skillId: skill.id, idempotencyKey: "session-overlap-001"
  });
  assert.equal(first.status, 201, first.body.message);
  assert.equal((await authenticatedAgent(learner).patch(`/api/sessions/${first.body.data.session._id}/accept`)).status, 200);

  const otherLearner = await makeProfileUser({ name: "Concurrent learner" });
  const otherRequest = await authenticatedAgent(otherLearner).post("/api/connections").send({ tutorId: tutor.id, skillId: skill.id });
  await tutorAgent.patch(`/api/connections/${otherRequest.body.data.connectionId}/accept`);
  const overlapping = await tutorAgent.post("/api/sessions").send({
    ...scheduledInput, conversationId: otherRequest.body.data.conversationId, skillId: skill.id,
    idempotencyKey: "session-overlap-002"
  });
  assert.equal(overlapping.status, 409);

  const secondTutor = await makeProfileUser({
    name: "Second tutor",
    skillsToTeach: [skill._id],
    availableTimeSlots: Array.from({ length: 7 }, (_, dayOfWeek) => ({
      dayOfWeek, startTime: "00:00", endTime: "23:59", timezone: "UTC"
    }))
  });
  const learnerConnection = await authenticatedAgent(learner).post("/api/connections").send({
    tutorId: secondTutor.id, skillId: skill.id
  });
  await authenticatedAgent(secondTutor).patch(`/api/connections/${learnerConnection.body.data.connectionId}/accept`);
  const learnerOverlap = await authenticatedAgent(secondTutor).post("/api/sessions").send({
    ...scheduledInput, conversationId: learnerConnection.body.data.conversationId, skillId: skill.id,
    idempotencyKey: "session-learner-overlap-01"
  });
  assert.equal(learnerOverlap.status, 409);

  const thirdLearner = await makeProfileUser({ name: "Parallel learner" });
  const thirdRequest = await authenticatedAgent(thirdLearner).post("/api/connections").send({ tutorId: tutor.id, skillId: skill.id });
  await tutorAgent.patch(`/api/connections/${thirdRequest.body.data.connectionId}/accept`);
  const competingTime = futureUtcBookingInput(25);
  const parallel = await Promise.all([
    tutorAgent.post("/api/sessions").send({
      ...competingTime, conversationId: otherRequest.body.data.conversationId, skillId: skill.id,
      idempotencyKey: "session-race-learner-a"
    }),
    tutorAgent.post("/api/sessions").send({
      ...competingTime, conversationId: thirdRequest.body.data.conversationId, skillId: skill.id,
      idempotencyKey: "session-race-learner-b"
    })
  ]);
  assert.deepEqual(parallel.map(result => result.status).sort(), [201, 409]);
});

test("rescheduling keeps the confirmed time until the other participant confirms; DST conversion is explicit", async () => {
  const { skill, learner, tutor, conversationId } = await createAcceptedBookingFixture();
  const tutorAgent = authenticatedAgent(tutor);
  const learnerAgent = authenticatedAgent(learner);
  const proposal = await tutorAgent.post("/api/sessions").send({
    ...futureUtcBookingInput(18), conversationId, skillId: skill.id, idempotencyKey: "session-reschedule-base"
  });
  const sessionId = proposal.body.data.session._id;
  await learnerAgent.patch(`/api/sessions/${sessionId}/accept`);
  const originalStart = (await tutorAgent.get(`/api/sessions/${sessionId}`)).body.data.session.startsAt;
  const nextTime = futureUtcBookingInput(28);
  const reschedule = await learnerAgent.patch(`/api/sessions/${sessionId}/reschedule`)
    .set("Idempotency-Key", "session-reschedule-new-01").send({
      date: nextTime.date, startTime: nextTime.startTime, timezone: "UTC", durationMinutes: 45,
      idempotencyKey: "session-reschedule-new-01"
    });
  assert.equal(reschedule.status, 201, reschedule.body.message);
  assert.equal(reschedule.body.data.session.startsAt, originalStart);
  assert.equal(reschedule.body.data.session.rescheduleProposal.status, "pending");
  const confirmed = await tutorAgent.patch(`/api/sessions/${sessionId}/reschedule/accept`);
  assert.equal(confirmed.status, 200, confirmed.body.message);
  assert.equal(confirmed.body.data.session.status, "scheduled");
  assert.notEqual(confirmed.body.data.session.startsAt, originalStart);
  assert.equal(confirmed.body.data.session.durationMinutes, 45);

  const { localDateTimeToUtc } = await import("../src/services/sessionService.js");
  assert.equal(localDateTimeToUtc("2026-10-20", "10:00", "Asia/Kolkata").toISOString(), "2026-10-20T04:30:00.000Z");
  assert.throws(() => localDateTimeToUtc("2026-03-08", "02:30", "America/New_York"), /does not exist/);
  assert.throws(() => localDateTimeToUtc("2026-11-01", "01:30", "America/New_York"), /ambiguous/);
});

test("session proposals reject unavailable weekly and temporary time-off periods", async () => {
  const fixture = await createAcceptedBookingFixture();
  const { skill, tutor, conversationId } = fixture;
  const input = futureUtcBookingInput(16);
  const proposedStart = new Date(`${input.date}T${input.startTime}:00.000Z`);
  const weekday = proposedStart.getUTCDay();
  tutor.availableTimeSlots = [{ dayOfWeek: weekday, startTime: "11:00", endTime: "12:00", timezone: "UTC" }];
  await tutor.save();
  const tutorAgent = authenticatedAgent(tutor);
  const weeklyUnavailable = await tutorAgent.post("/api/sessions").send({
    ...input, conversationId, skillId: skill.id, idempotencyKey: "session-weekly-unavailable"
  });
  assert.equal(weeklyUnavailable.status, 409);
  assert.match(weeklyUnavailable.body.message, /availability/);

  tutor.availableTimeSlots = [{ dayOfWeek: weekday, startTime: "09:00", endTime: "12:00", timezone: "UTC" }];
  tutor.unavailableTimeRanges = [{
    startsAt: proposedStart,
    endsAt: new Date(proposedStart.getTime() + 30 * 60_000),
    reason: "Time off"
  }];
  await tutor.save();
  const timeOff = await tutorAgent.post("/api/sessions").send({
    ...input, conversationId, skillId: skill.id, idempotencyKey: "session-temporary-timeoff"
  });
  assert.equal(timeOff.status, 409);
  assert.match(timeOff.body.message, /unavailable/);
});

test("booking proposals persist before Socket.IO session and notification events are broadcast", async () => {
  const { skill, learner, tutor, conversationId } = await createAcceptedBookingFixture();
  const previousIo = app.get("io");
  const httpServer = createServer(app);
  const ioServer = new Server(httpServer, {
    cors: { origin: process.env.CLIENT_URL, credentials: true }
  });
  attachRealtime(ioServer);
  app.set("io", ioServer);
  await new Promise(resolve => httpServer.listen(0, resolve));
  const url = `http://127.0.0.1:${httpServer.address().port}`;
  const clients = [learner, tutor].map(user => {
    const socket = createSocketClient(url, {
      autoConnect: false,
      transports: ["websocket"],
      extraHeaders: { Cookie: `${getAuthCookieName()}=${createAuthToken(user)}` }
    });
    return socket;
  });
  try {
    await Promise.all(clients.map(connectSocket));
    for (const socket of clients) {
      assert.equal((await emitSocket(socket, "conversation:join", { conversationId })).success, true);
    }
    const proposedEvent = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("No realtime session proposal was delivered")), 3000);
      clients[0].once("session:proposed", payload => { clearTimeout(timer); resolve(payload.session); });
    });
    const notificationEvent = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("No persisted session notification was delivered")), 3000);
      clients[0].once("notification:new", payload => { clearTimeout(timer); resolve(payload); });
    });
    const created = await authenticatedAgent(tutor).post("/api/sessions").send({
      ...futureUtcBookingInput(), conversationId, skillId: skill.id,
      idempotencyKey: "session-socket-event-01"
    });
    assert.equal(created.status, 201, created.body.message);
    const [session, notification] = await Promise.all([proposedEvent, notificationEvent]);
    assert.equal(String(session._id), created.body.data.session._id);
    assert.equal(notification.type, "session_proposed");
    assert.equal(String(notification.user), learner.id);
    const { Notification, Session } = await import("../src/models/index.js");
    assert.equal(await Session.countDocuments({ _id: session._id }), 1);
    assert.equal(await Notification.countDocuments({ _id: notification._id }), 1);
  } finally {
    clients.forEach(socket => socket.disconnect());
    await new Promise(resolve => ioServer.close(resolve));
    app.set("io", previousIo);
  }
});

async function createPastScheduledSessionWithCredits() {
  const fixture = await createAcceptedBookingFixture();
  const { User, Session } = await import("../src/models/index.js");
  await User.updateMany(
    { _id: { $in: [fixture.learner._id, fixture.tutor._id] } },
    { $set: { creditBalance: 100 } }
  );
  const proposal = await authenticatedAgent(fixture.tutor).post("/api/sessions").send({
    ...futureUtcBookingInput(), conversationId: fixture.conversationId, skillId: fixture.skill.id,
    idempotencyKey: `completion-booking-${new mongoose.Types.ObjectId()}`
  });
  assert.equal(proposal.status, 201, proposal.body.message);
  const accepted = await authenticatedAgent(fixture.learner).patch(`/api/sessions/${proposal.body.data.session._id}/accept`);
  assert.equal(accepted.status, 200, accepted.body.message);
  const session = await Session.findById(proposal.body.data.session._id);
  session.startsAt = new Date(Date.now() - 60 * 60_000);
  session.endsAt = new Date(session.startsAt.getTime() + session.durationMinutes * 60_000);
  await session.save();
  return { ...fixture, sessionId: session.id };
}

test("completion confirmation settles one-to-one credits once and provides private wallet history", async () => {
  const { learner, tutor, outsider, sessionId } = await createPastScheduledSessionWithCredits();
  const learnerAgent = authenticatedAgent(learner);
  const tutorAgent = authenticatedAgent(tutor);
  const outsiderAgent = authenticatedAgent(outsider);
  assert.equal((await outsiderAgent.get(`/api/sessions/${sessionId}/completion`)).status, 403);
  assert.equal((await learnerAgent.post(`/api/sessions/${sessionId}/request-completion`)).status, 403);
  assert.equal((await tutorAgent.post(`/api/sessions/${sessionId}/settle`).set("Idempotency-Key", "settle-before-confirm")).status, 409);

  const requested = await tutorAgent.post(`/api/sessions/${sessionId}/request-completion`);
  assert.equal(requested.status, 200, requested.body.message);
  assert.equal(requested.body.data.session.settlement.status, "pending_confirmation");
  assert.equal((await tutorAgent.post(`/api/sessions/${sessionId}/confirm-completion`)).status, 403);
  const confirmed = await learnerAgent.post(`/api/sessions/${sessionId}/confirm-completion`)
    .set("Idempotency-Key", "settle-session-example-01");
  assert.equal(confirmed.status, 200, confirmed.body.message);
  assert.equal(confirmed.body.data.session.status, "completed");
  assert.equal(confirmed.body.data.session.settlement.status, "settled");
  assert.equal(confirmed.body.data.session.settlement.totalCredits, 10);

  const { User, CreditTransaction, Notification } = await import("../src/models/index.js");
  assert.equal((await User.findById(learner.id)).creditBalance, 90);
  assert.equal((await User.findById(tutor.id)).creditBalance, 110);
  const entries = await CreditTransaction.find({ session: sessionId }).sort({ direction: 1 });
  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map(entry => [entry.type, entry.direction, entry.amount]), [
    ["session-earning", "credit", 10], ["session-charge", "debit", 10]
  ]);
  assert.equal(entries.find(entry => entry.direction === "debit").balanceBefore, 100);
  assert.equal(entries.find(entry => entry.direction === "debit").balanceAfter, 90);
  assert.equal(entries.find(entry => entry.direction === "credit").balanceAfter, 110);
  assert.equal(await Notification.countDocuments({ resourceId: sessionId, type: "session_settlement_succeeded" }), 2);

  const repeated = await tutorAgent.post(`/api/sessions/${sessionId}/settle`).set("Idempotency-Key", "settle-session-repeat-02");
  assert.equal(repeated.status, 200);
  assert.equal(repeated.body.data.duplicate, true);
  assert.equal(await CreditTransaction.countDocuments({ session: sessionId }), 2);
  const learnerWallet = await learnerAgent.get("/api/wallet");
  assert.equal(learnerWallet.body.data.balance, 90);
  assert.equal(learnerWallet.body.data.spent, 10);
  const tutorWallet = await tutorAgent.get("/api/wallet");
  assert.equal(tutorWallet.body.data.balance, 110);
  assert.equal(tutorWallet.body.data.earned, 10);
  const history = await tutorAgent.get("/api/wallet/transactions");
  assert.equal(history.body.data.transactions.length, 1);
  assert.equal((await outsiderAgent.get(`/api/wallet/transactions/${history.body.data.transactions[0]._id}`)).status, 404);
  assert.equal((await learnerAgent.get(`/api/admin/settlements/${sessionId}/reconciliation`)).status, 403);
  const admin = await makeProfileUser({ accountType: "admin" });
  const audit = await authenticatedAgent(admin).get("/api/admin/settlements");
  assert.equal(audit.status, 200);
  const reconciliation = await authenticatedAgent(admin).get(`/api/admin/settlements/${sessionId}/reconciliation`);
  assert.equal(reconciliation.status, 200);
  assert.equal(reconciliation.body.data.reconciliation.balanced, true);
  await assert.rejects(
    CreditTransaction.updateOne({ _id: entries[0]._id }, { $set: { amount: 999 } }),
    /immutable/
  );
});

test("insufficient balance records a failed settlement without partial transfer and allows a safe retry", async () => {
  const { learner, tutor, sessionId } = await createPastScheduledSessionWithCredits();
  const { User, CreditTransaction, Session, Notification } = await import("../src/models/index.js");
  await User.updateOne({ _id: learner._id }, { $set: { creditBalance: 5 } });
  const tutorAgent = authenticatedAgent(tutor);
  const learnerAgent = authenticatedAgent(learner);
  assert.equal((await tutorAgent.post(`/api/sessions/${sessionId}/request-completion`)).status, 200);
  const confirmed = await learnerAgent.post(`/api/sessions/${sessionId}/confirm-completion`)
    .set("Idempotency-Key", "settlement-insufficient-01");
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.body.data.settlement.settled, false);
  assert.match(confirmed.body.data.settlement.failureReason, /requires 10 credits.*currently has 5/);
  assert.equal((await User.findById(learner.id)).creditBalance, 5);
  assert.equal((await User.findById(tutor.id)).creditBalance, 100);
  assert.equal(await CreditTransaction.countDocuments({ session: sessionId }), 0);
  assert.equal((await Session.findById(sessionId)).settlement.status, "failed");
  assert.equal(await Notification.countDocuments({ resourceId: sessionId, type: "session_settlement_failed" }), 2);

  await User.updateOne({ _id: learner._id }, { $set: { creditBalance: 10 } });
  const retry = await tutorAgent.post(`/api/sessions/${sessionId}/settle`)
    .set("Idempotency-Key", "settlement-retry-after-credit");
  assert.equal(retry.status, 200);
  assert.equal(retry.body.data.settlement.settled, true);
  assert.equal((await User.findById(learner.id)).creditBalance, 0);
  assert.equal((await User.findById(tutor.id)).creditBalance, 110);
  assert.equal(await CreditTransaction.countDocuments({ session: sessionId }), 2);
});

test("cancelled, disputed, and unconfirmed sessions cannot transfer credits", async () => {
  const first = await createPastScheduledSessionWithCredits();
  const learnerAgent = authenticatedAgent(first.learner);
  const tutorAgent = authenticatedAgent(first.tutor);
  const unconfirmed = await learnerAgent.post(`/api/sessions/${first.sessionId}/settle`)
    .set("Idempotency-Key", "settle-unconfirmed-01");
  assert.equal(unconfirmed.status, 409);
  await tutorAgent.post(`/api/sessions/${first.sessionId}/request-completion`);
  const dispute = await learnerAgent.post(`/api/sessions/${first.sessionId}/dispute`).send({ reason: "The session did not take place." });
  assert.equal(dispute.status, 200);
  assert.equal(dispute.body.data.session.status, "disputed");
  assert.equal((await tutorAgent.post(`/api/sessions/${first.sessionId}/settle`).set("Idempotency-Key", "settle-disputed-01")).status, 409);

  const second = await createPastScheduledSessionWithCredits();
  const { Session, User, CreditTransaction } = await import("../src/models/index.js");
  await Session.updateOne({ _id: second.sessionId }, { $set: { status: "cancelled" } });
  const cancelled = await authenticatedAgent(second.tutor).post(`/api/sessions/${second.sessionId}/settle`)
    .set("Idempotency-Key", "settle-cancelled-01");
  assert.equal(cancelled.status, 409);
  assert.equal((await User.findById(second.learner.id)).creditBalance, 100);
  assert.equal((await User.findById(second.tutor.id)).creditBalance, 100);
  assert.equal(await CreditTransaction.countDocuments({ session: { $in: [first.sessionId, second.sessionId] } }), 0);

  const third = await createPastScheduledSessionWithCredits();
  await Session.updateOne({ _id: third.sessionId }, { $set: { status: "rejected" } });
  const rejected = await authenticatedAgent(third.tutor).post(`/api/sessions/${third.sessionId}/settle`)
    .set("Idempotency-Key", "settle-rejected-01");
  assert.equal(rejected.status, 409);
  assert.equal(await CreditTransaction.countDocuments({ session: third.sessionId }), 0);
});

test("concurrent completion retries commit only one learner debit and tutor credit", async () => {
  const { learner, tutor, sessionId } = await createPastScheduledSessionWithCredits();
  const tutorAgent = authenticatedAgent(tutor);
  const learnerAgent = authenticatedAgent(learner);
  await tutorAgent.post(`/api/sessions/${sessionId}/request-completion`);
  const [left, right] = await Promise.all([
    learnerAgent.post(`/api/sessions/${sessionId}/confirm-completion`).set("Idempotency-Key", "settlement-concurrent-left"),
    learnerAgent.post(`/api/sessions/${sessionId}/confirm-completion`).set("Idempotency-Key", "settlement-concurrent-right")
  ]);
  assert.equal(left.status, 200, left.body.message);
  assert.equal(right.status, 200, right.body.message);
  const { User, CreditTransaction } = await import("../src/models/index.js");
  assert.equal((await User.findById(learner.id)).creditBalance, 90);
  assert.equal((await User.findById(tutor.id)).creditBalance, 110);
  assert.equal(await CreditTransaction.countDocuments({ session: sessionId }), 2);
});

test("settlement transaction rolls back balances and completion state if a ledger write fails", async () => {
  const { learner, tutor, sessionId } = await createPastScheduledSessionWithCredits();
  const tutorAgent = authenticatedAgent(tutor);
  await tutorAgent.post(`/api/sessions/${sessionId}/request-completion`);
  const { CreditTransaction, User, Session } = await import("../src/models/index.js");
  const originalCreate = CreditTransaction.create;
  CreditTransaction.create = async () => { throw new Error("Injected ledger failure"); };
  try {
    const { confirmSessionCompletion } = await import("../src/services/walletService.js");
    await assert.rejects(confirmSessionCompletion({
      sessionId, userId: learner._id, idempotencyKey: "settlement-rollback-01"
    }), /Injected ledger failure/);
  } finally {
    CreditTransaction.create = originalCreate;
  }
  const session = await Session.findById(sessionId);
  assert.equal(session.status, "scheduled");
  assert.equal(session.completion.learnerConfirmedAt, undefined);
  assert.equal((await User.findById(learner.id)).creditBalance, 100);
  assert.equal((await User.findById(tutor.id)).creditBalance, 100);
  assert.equal(await CreditTransaction.countDocuments({ session: sessionId }), 0);
});

test("settlement notifications are sent only after the transaction commits", async () => {
  const { skill, learner, tutor, conversationId } = await createAcceptedBookingFixture();
  const previousIo = app.get("io");
  const httpServer = createServer(app);
  const ioServer = new Server(httpServer, { cors: { origin: process.env.CLIENT_URL, credentials: true } });
  attachRealtime(ioServer);
  app.set("io", ioServer);
  await new Promise(resolve => httpServer.listen(0, resolve));
  const url = `http://127.0.0.1:${httpServer.address().port}`;
  const clients = [learner, tutor].map(user => createSocketClient(url, {
    autoConnect: false, transports: ["websocket"],
    extraHeaders: { Cookie: `${getAuthCookieName()}=${createAuthToken(user)}` }
  }));
  try {
    await Promise.all(clients.map(connectSocket));
    for (const socket of clients) assert.equal((await emitSocket(socket, "conversation:join", { conversationId })).success, true);
    const proposal = await authenticatedAgent(tutor).post("/api/sessions").send({
      ...futureUtcBookingInput(), conversationId, skillId: skill.id,
      idempotencyKey: "settlement-socket-booking-01"
    });
    const sessionId = proposal.body.data.session._id;
    assert.equal((await authenticatedAgent(learner).patch(`/api/sessions/${sessionId}/accept`)).status, 200);
    const { Session, User, Notification, CreditTransaction } = await import("../src/models/index.js");
    await User.updateMany({ _id: { $in: [learner._id, tutor._id] } }, { $set: { creditBalance: 100 } });
    const booking = await Session.findById(sessionId);
    booking.startsAt = new Date(Date.now() - 60 * 60_000);
    booking.endsAt = new Date(booking.startsAt.getTime() + booking.durationMinutes * 60_000);
    await booking.save();
    const completionNotice = new Promise(resolve => clients[0].once("notification:new", resolve));
    const requested = await authenticatedAgent(tutor).post(`/api/sessions/${sessionId}/request-completion`);
    assert.equal(requested.status, 200);
    assert.equal((await completionNotice).type, "session_completion_requested");

    const settledEvent = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Committed settlement was not broadcast")), 3000);
      clients[0].once("session:settled", payload => { clearTimeout(timer); resolve(payload.session); });
    });
    const settlementNotice = new Promise((resolve, reject) => {
      const onNotification = payload => {
        if (payload.type !== "session_settlement_succeeded") return;
        clearTimeout(timer);
        clients[0].off("notification:new", onNotification);
        resolve(payload);
      };
      const timer = setTimeout(() => {
        clients[0].off("notification:new", onNotification);
        reject(new Error("Persisted settlement notification was not broadcast"));
      }, 3000);
      clients[0].on("notification:new", onNotification);
    });
    const confirmed = await authenticatedAgent(learner).post(`/api/sessions/${sessionId}/confirm-completion`)
      .set("Idempotency-Key", "settlement-socket-confirmed");
    assert.equal(confirmed.status, 200);
    const [settled, notification] = await Promise.all([settledEvent, settlementNotice]);
    assert.equal(settled._id, sessionId);
    assert.equal(notification.type, "session_settlement_succeeded");
    assert.equal(await Notification.countDocuments({ _id: notification._id }), 1);
    assert.equal(await CreditTransaction.countDocuments({ session: sessionId }), 2);
  } finally {
    clients.forEach(socket => socket.disconnect());
    await new Promise(resolve => ioServer.close(resolve));
    app.set("io", previousIo);
  }
});

test("reviews require the learner's completed and confirmed session and enforce one per session", async () => {
  const { learner, tutor, sessionId } = await createPastScheduledSessionWithCredits();
  const learnerAgent = authenticatedAgent(learner);
  const tutorAgent = authenticatedAgent(tutor);
  const beforeCompletion = await learnerAgent.post("/api/reviews").send({
    sessionId, rating: 5, text: "Helpful"
  });
  assert.equal(beforeCompletion.status, 409);
  await tutorAgent.post(`/api/sessions/${sessionId}/request-completion`);
  const confirmed = await learnerAgent.post(`/api/sessions/${sessionId}/confirm-completion`)
    .set("Idempotency-Key", "review-session-settlement");
  assert.equal(confirmed.status, 200);
  const created = await learnerAgent.post("/api/reviews").send({
    sessionId, rating: 5, text: "Clear explanations and a useful lesson."
  });
  assert.equal(created.status, 201, created.body.message);
  assert.equal(created.body.data.review.recipient, tutor.id);
  assert.equal((await learnerAgent.post("/api/reviews").send({ sessionId, rating: 4, text: "Again" })).status, 409);
  assert.equal((await tutorAgent.post("/api/reviews").send({ sessionId, rating: 4, text: "Wrong role" })).status, 403);
  const reviews = await request(app).get(`/api/reviews/tutors/${tutor.id}`);
  assert.equal(reviews.status, 200);
  assert.equal(reviews.body.data.rating.average, 5);
  assert.equal(reviews.body.data.rating.count, 1);
  assert.equal(reviews.body.data.reviews[0].author.email, undefined);
  assert.equal((await learnerAgent.get("/api/reviews/me")).body.data.reviews.length, 1);
  const { Notification } = await import("../src/models/index.js");
  assert.equal(await Notification.countDocuments({ type: "review_received", user: tutor._id }), 1);
});

test("disputes are participant-only, persistent, and admin adjustments are atomic and non-duplicable", async () => {
  const { skill, learner, tutor, outsider, conversationId } = await createAcceptedBookingFixture();
  const tutorAgent = authenticatedAgent(tutor);
  const learnerAgent = authenticatedAgent(learner);
  const proposal = await tutorAgent.post("/api/sessions").send({
    ...futureUtcBookingInput(), conversationId, skillId: skill.id,
    idempotencyKey: "dispute-booking-proposal-01"
  });
  const sessionId = proposal.body.data.session._id;
  const accepted = await learnerAgent.patch(`/api/sessions/${sessionId}/accept`);
  assert.equal(accepted.status, 200, accepted.body.message);
  const outsiderResponse = await authenticatedAgent(outsider).post("/api/disputes").send({
    sessionId, reason: "Concern", description: "This should be forbidden."
  });
  assert.equal(outsiderResponse.status, 403);
  const opened = await learnerAgent.post("/api/disputes").send({
    sessionId,
    reason: "Session not delivered",
    description: "The tutor did not attend the confirmed session.",
    evidence: [{ type: "message", label: "Chat confirmation", reference: "message-reference" }]
  });
  assert.equal(opened.status, 201, opened.body.message);
  assert.equal(opened.body.data.dispute.status, "OPEN");
  const { Session, CreditTransaction, Notification, AuditLog } = await import("../src/models/index.js");
  assert.equal((await Session.findById(sessionId)).status, "disputed");
  assert.equal(await CreditTransaction.countDocuments({ session: sessionId }), 0);
  assert.equal(await Notification.countDocuments({ type: "dispute_opened" }), 2);
  assert.equal((await authenticatedAgent(outsider).get("/api/disputes/me")).body.data.disputes.length, 0);

  const admin = await makeProfileUser({ name: "Dispute Admin", accountType: "admin" });
  const adminAgent = authenticatedAgent(admin);
  assert.equal((await adminAgent.get("/api/admin/disputes")).status, 200);
  assert.equal((await adminAgent.get(`/api/admin/disputes/${opened.body.data.dispute._id}`)).status, 200);
  const moved = await adminAgent.patch(`/api/admin/disputes/${opened.body.data.dispute._id}/review`).send({
    note: "Reviewed booking and related conversation."
  });
  assert.equal(moved.status, 200, moved.body.message);
  const participantView = await learnerAgent.get(`/api/disputes/${opened.body.data.dispute._id}`);
  assert.equal(participantView.status, 200, participantView.body.message);
  assert.equal(participantView.body.data.dispute.internalNotes, undefined);
  assert.equal(participantView.body.data.dispute.history[0].note, undefined);
  assert.equal(participantView.body.data.dispute.history[1].note, undefined);
  const resolved = await adminAgent.patch(`/api/admin/disputes/${opened.body.data.dispute._id}/resolve`)
    .set("Idempotency-Key", "dispute-adjustment-0001").send({
      status: "RESOLVED",
      summary: "Credit the learner for the missed session.",
      internalNote: "Verified the scheduling evidence.",
      adjustment: { userId: learner.id, direction: "credit", amount: 10, description: "Dispute adjustment" }
    });
  assert.equal(resolved.status, 200, resolved.body.message);
  assert.equal(resolved.body.data.adjustment.type, "admin-adjustment");
  const resolvedParticipantView = await learnerAgent.get(`/api/disputes/${opened.body.data.dispute._id}`);
  assert.equal(resolvedParticipantView.status, 200);
  assert.equal(resolvedParticipantView.body.data.dispute.internalNotes, undefined);
  assert.equal(resolvedParticipantView.body.data.dispute.history.some(item => item.note), false);
  const retry = await adminAgent.patch(`/api/admin/disputes/${opened.body.data.dispute._id}/resolve`)
    .set("Idempotency-Key", "dispute-adjustment-0001").send({
      status: "RESOLVED", summary: "Duplicate resolution attempt"
    });
  assert.equal(retry.status, 409);
  assert.equal(await CreditTransaction.countDocuments({ reference: `dispute-adjustment:${opened.body.data.dispute._id}:dispute-adjustment-0001` }), 1);
  assert.ok(await AuditLog.exists({ action: "admin.dispute.decision", resourceId: opened.body.data.dispute._id }));
});

test("admin endpoints are role-protected, user suspension is audited, and metrics use MongoDB data", async () => {
  const member = await makeProfileUser({ name: "Status Member" });
  const memberAgent = authenticatedAgent(member);
  assert.equal((await memberAgent.get("/api/admin/dashboard")).status, 403);
  const admin = await makeProfileUser({ name: "Dashboard Admin", accountType: "admin" });
  const adminAgent = authenticatedAgent(admin);
  const listed = await adminAgent.get("/api/admin/users").query({ q: "Status Member", verified: "true" });
  assert.equal(listed.status, 200);
  assert.equal(listed.body.data.users[0].email, member.email);
  const suspended = await adminAgent.patch(`/api/admin/users/${member.id}/status`).send({
    accountStatus: "suspended", reason: "Temporary review of account activity."
  });
  assert.equal(suspended.status, 200);
  assert.equal((await memberAgent.get("/api/auth/me")).status, 401);
  const { AuditLog, Notification } = await import("../src/models/index.js");
  assert.ok(await AuditLog.exists({ action: "admin.user.suspend", resourceId: member.id }));
  assert.equal(await Notification.countDocuments({ user: member._id, type: "account_suspended" }), 1);
  const { CreditTransaction } = await import("../src/models/index.js");
  const ledgerSessionId = new mongoose.Types.ObjectId();
  await CreditTransaction.create([
    { user: member._id, amount: 100, type: "signup-grant", direction: "credit", reference: "dashboard-signup", description: "Initial credits" },
    { user: member._id, amount: 2, type: "admin-adjustment", direction: "credit", reference: "dashboard-adjustment", description: "Administrative credit" },
    { user: member._id, amount: 9, type: "session-earning", direction: "credit", session: ledgerSessionId, reference: "dashboard-earning", description: "Session earnings" },
    { user: member._id, amount: 9, type: "session-charge", direction: "debit", session: ledgerSessionId, reference: "dashboard-charge", description: "Session charge" }
  ]);
  const dashboard = await adminAgent.get("/api/admin/dashboard");
  assert.equal(dashboard.status, 200);
  assert.equal(typeof dashboard.body.data.users.total, "number");
  assert.deepEqual(dashboard.body.data.credits, { issued: 102, transferred: 9 });
  assert.deepEqual(dashboard.body.data.sessions, {
    pending: 0, scheduled: 0, completed: 0, cancelled: 0, rejected: 0, disputed: 0
  });
  const logs = await adminAgent.get("/api/admin/audit-logs").query({ action: "admin.user.suspend" });
  assert.ok(logs.body.data.logs.some(log => log.resourceId === member.id));
});

test("notification read operations are scoped to the authenticated owner", async () => {
  const owner = await makeProfileUser({ name: "Notification Owner" });
  const other = await makeProfileUser({ name: "Notification Other" });
  const { Notification } = await import("../src/models/index.js");
  const [owned, foreign, secondOwned] = await Notification.create([
    { user: owner._id, type: "test", message: "Owned notification" },
    { user: other._id, type: "test", message: "Private notification" },
    { user: owner._id, type: "test", message: "Second owned notification" }
  ]);
  const ownerAgent = authenticatedAgent(owner);
  const foreignRead = await ownerAgent.patch(`/api/notifications/${foreign._id}/read`);
  assert.equal(foreignRead.status, 404);
  assert.equal((await Notification.findById(foreign._id)).readAt, undefined);
  const ownRead = await ownerAgent.patch(`/api/notifications/${owned._id}/read`);
  assert.equal(ownRead.status, 200, ownRead.body.message);
  assert.ok(ownRead.body.data.notification.readAt);
  const allRead = await ownerAgent.patch("/api/notifications/read-all");
  assert.equal(allRead.status, 200);
  assert.ok((await Notification.findById(secondOwned._id)).readAt);
  assert.equal((await Notification.findById(foreign._id)).readAt, undefined);
});
