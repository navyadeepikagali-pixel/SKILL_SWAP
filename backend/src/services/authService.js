import bcrypt from "bcrypt";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { CreditTransaction } from "../models/CreditTransaction.js";
import { LoginOtp } from "../models/LoginOtp.js";
import { PasswordResetToken } from "../models/PasswordResetToken.js";
import { RegistrationOtp } from "../models/RegistrationOtp.js";
import { User } from "../models/User.js";

export const OTP_TTL_MS = 5 * 60 * 1000;
export const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
export const RESET_TTL_MS = 15 * 60 * 1000;
export const RESET_MAX_ATTEMPTS = 5;
export const INITIAL_CREDITS = 100;

function createOtp() {
  return crypto.randomInt(100000, 1000000).toString();
}

function hashSecret(value, purpose) {
  return crypto.createHmac("sha256", process.env.JWT_SECRET).update(`${purpose}:${value}`).digest("hex");
}

function secretsMatch(first, second) {
  const firstBuffer = Buffer.from(first, "hex");
  const secondBuffer = Buffer.from(second, "hex");
  return firstBuffer.length === secondBuffer.length && crypto.timingSafeEqual(firstBuffer, secondBuffer);
}

export function createResetToken() {
  return crypto.randomBytes(32).toString("base64url");
}

export async function createPendingRegistration({ name, email, password }, mailer, now = new Date()) {
  const normalizedEmail = email.trim().toLowerCase();
  if (await User.exists({ email: normalizedEmail })) {
    const error = new Error("An account with this email already exists");
    error.status = 409;
    throw error;
  }

  const existing = await RegistrationOtp.findOne({ email: normalizedEmail });
  if (existing && existing.resendAfter > now) {
    const error = new Error("Please wait before requesting another verification code");
    error.status = 429;
    error.retryAfter = existing.resendAfter;
    throw error;
  }

  const code = createOtp();
  const otpHash = hashSecret(code, "registration-otp");
  const passwordHash = await bcrypt.hash(password, 12);
  await RegistrationOtp.findOneAndUpdate(
    { email: normalizedEmail },
    {
      email: normalizedEmail,
      name: name.trim(),
      passwordHash,
      otpHash,
      expiresAt: new Date(now.getTime() + OTP_TTL_MS),
      resendAfter: new Date(now.getTime() + OTP_RESEND_COOLDOWN_MS),
      attempts: 0
    },
    { upsert: true, new: true, runValidators: true }
  );

  try {
    await mailer.sendOtpEmail(normalizedEmail, code);
  } catch (error) {
    await RegistrationOtp.deleteOne({ email: normalizedEmail, otpHash });
    throw error;
  }

  return { email: normalizedEmail, resendAfter: OTP_RESEND_COOLDOWN_MS };
}

export async function createPasswordAccount({ name, email, password }) {
  const normalizedEmail = email.trim().toLowerCase();
  if (await User.exists({ email: normalizedEmail })) {
    const error = new Error("An account with this email already exists");
    error.status = 409;
    throw error;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const session = await mongoose.startSession();
  let user;
  try {
    await session.withTransaction(async () => {
      const [createdUser] = await User.create([{
        name: name.trim(),
        email: normalizedEmail,
        passwordHash,
        isEmailVerified: false,
        emailVerificationRequired: false,
        accountStatus: "active",
        creditBalance: INITIAL_CREDITS
      }], { session });
      user = createdUser;

      await CreditTransaction.create([{
        user: createdUser._id,
        amount: INITIAL_CREDITS,
        type: "signup-grant",
        direction: "credit",
        balanceBefore: 0,
        balanceAfter: INITIAL_CREDITS,
        reference: `signup:${createdUser._id}`,
        description: "Initial signup credit grant"
      }], { session });
    });
  } catch (error) {
    throw mapTransactionError(error);
  } finally {
    await session.endSession();
  }

  return user;
}

export async function resendRegistrationOtp(email, mailer, now = new Date()) {
  const normalizedEmail = email.trim().toLowerCase();
  const pending = await RegistrationOtp.findOne({ email: normalizedEmail });
  if (!pending) return { sent: false };
  if (pending.expiresAt <= now) {
    await RegistrationOtp.deleteOne({ _id: pending._id });
    return { sent: false };
  }
  if (pending.resendAfter > now) {
    const error = new Error("Please wait before requesting another verification code");
    error.status = 429;
    error.retryAfter = pending.resendAfter;
    throw error;
  }

  const code = createOtp();
  const otpHash = hashSecret(code, "registration-otp");
  const updated = await RegistrationOtp.findOneAndUpdate(
    { _id: pending._id, resendAfter: { $lte: now }, expiresAt: { $gt: now } },
    {
      $set: {
        otpHash,
        expiresAt: new Date(now.getTime() + OTP_TTL_MS),
        resendAfter: new Date(now.getTime() + OTP_RESEND_COOLDOWN_MS),
        attempts: 0
      }
    },
    { new: true }
  );
  if (!updated) {
    const error = new Error("Please wait before requesting another verification code");
    error.status = 429;
    throw error;
  }

  try {
    await mailer.sendOtpEmail(normalizedEmail, code);
  } catch (error) {
    await RegistrationOtp.deleteOne({ _id: updated._id, otpHash });
    throw error;
  }
  return { sent: true, resendAfter: OTP_RESEND_COOLDOWN_MS };
}

export async function createLoginOtp(user, mailer, now = new Date()) {
  const existing = await LoginOtp.findOne({ user: user._id });
  if (existing && existing.resendAfter > now) {
    const error = new Error("Please wait before requesting another sign-in code");
    error.status = 429;
    error.retryAfter = existing.resendAfter;
    throw error;
  }

  const code = createOtp();
  const otpHash = hashSecret(code, "login-otp");
  const loginOtp = await LoginOtp.findOneAndUpdate(
    { user: user._id },
    {
      user: user._id,
      otpHash,
      expiresAt: new Date(now.getTime() + OTP_TTL_MS),
      resendAfter: new Date(now.getTime() + OTP_RESEND_COOLDOWN_MS),
      attempts: 0
    },
    { upsert: true, new: true, runValidators: true }
  );

  try {
    await mailer.sendLoginOtpEmail(user.email, code);
  } catch (error) {
    await LoginOtp.deleteOne({ _id: loginOtp._id, otpHash });
    throw error;
  }

  return { email: user.email, resendAfter: OTP_RESEND_COOLDOWN_MS };
}

export async function resendLoginOtp(email, mailer, now = new Date()) {
  const normalizedEmail = email.trim().toLowerCase();
  const user = await User.findOne({
    email: normalizedEmail,
    isEmailVerified: true,
    accountStatus: "active"
  });
  if (!user) return { sent: false };

  const pending = await LoginOtp.findOne({ user: user._id });
  if (!pending || pending.expiresAt <= now) {
    if (pending) await LoginOtp.deleteOne({ _id: pending._id });
    return { sent: false };
  }
  if (pending.resendAfter > now) {
    const error = new Error("Please wait before requesting another sign-in code");
    error.status = 429;
    error.retryAfter = pending.resendAfter;
    throw error;
  }

  const code = createOtp();
  const otpHash = hashSecret(code, "login-otp");
  const updated = await LoginOtp.findOneAndUpdate(
    { _id: pending._id, resendAfter: { $lte: now }, expiresAt: { $gt: now } },
    {
      $set: {
        otpHash,
        expiresAt: new Date(now.getTime() + OTP_TTL_MS),
        resendAfter: new Date(now.getTime() + OTP_RESEND_COOLDOWN_MS),
        attempts: 0
      }
    },
    { new: true }
  );
  if (!updated) {
    const error = new Error("Please wait before requesting another sign-in code");
    error.status = 429;
    throw error;
  }

  try {
    await mailer.sendLoginOtpEmail(normalizedEmail, code);
  } catch (error) {
    await LoginOtp.deleteOne({ _id: updated._id, otpHash });
    throw error;
  }
  return { sent: true, resendAfter: OTP_RESEND_COOLDOWN_MS };
}

export async function verifyLoginOtp(email, code, now = new Date()) {
  const normalizedEmail = email.trim().toLowerCase();
  const user = await User.findOne({
    email: normalizedEmail,
    isEmailVerified: true,
    accountStatus: "active"
  });
  if (!user) {
    const error = new Error("Sign-in code is invalid or expired");
    error.status = 400;
    throw error;
  }

  const presentedHash = hashSecret(code, "login-otp");
  const existing = await LoginOtp.findOne({ user: user._id }).select("+otpHash");
  if (!existing || existing.expiresAt <= now) {
    if (existing?.expiresAt <= now) await LoginOtp.deleteOne({ _id: existing._id });
    const error = new Error("Sign-in code is invalid or expired");
    error.status = 400;
    throw error;
  }
  if (existing.attempts >= OTP_MAX_ATTEMPTS) {
    await LoginOtp.deleteOne({ _id: existing._id });
    const error = new Error("Too many incorrect codes; sign in again to request a new code");
    error.status = 429;
    throw error;
  }

  if (!secretsMatch(existing.otpHash, presentedHash)) {
    const updated = await LoginOtp.findOneAndUpdate(
      { _id: existing._id, expiresAt: { $gt: now }, attempts: { $lt: OTP_MAX_ATTEMPTS } },
      { $inc: { attempts: 1 } },
      { new: true }
    );
    if (updated?.attempts >= OTP_MAX_ATTEMPTS) {
      await LoginOtp.deleteOne({ _id: updated._id, attempts: { $gte: OTP_MAX_ATTEMPTS } });
    }
    const error = new Error(updated?.attempts >= OTP_MAX_ATTEMPTS
      ? "Too many incorrect codes; sign in again to request a new code"
      : "Sign-in code is incorrect");
    error.status = updated?.attempts >= OTP_MAX_ATTEMPTS ? 429 : 400;
    error.attemptsRemaining = Math.max(0, OTP_MAX_ATTEMPTS - (updated?.attempts || OTP_MAX_ATTEMPTS));
    throw error;
  }

  const consumed = await LoginOtp.findOneAndDelete({
    _id: existing._id,
    user: user._id,
    otpHash: presentedHash,
    expiresAt: { $gt: now },
    attempts: { $lt: OTP_MAX_ATTEMPTS }
  });
  if (!consumed) {
    const error = new Error("Sign-in code is invalid or expired");
    error.status = 400;
    throw error;
  }

  user.lastLoginAt = now;
  await user.save();
  return user;
}

function mapTransactionError(error) {
  if (
    error.code === 20 ||
    error.codeName === "IllegalOperation" ||
    /transaction numbers are only allowed|does not support retryable writes|replica set/i.test(error.message)
  ) {
    const transactionError = new Error("MongoDB transactions are required to create accounts and grant signup credits. Configure MongoDB as a replica set or use MongoDB Atlas.");
    transactionError.status = 503;
    transactionError.cause = error;
    return transactionError;
  }
  return error;
}

export async function verifyRegistrationEmail(email, code, now = new Date()) {
  const normalizedEmail = email.trim().toLowerCase();
  const presentedHash = hashSecret(code, "registration-otp");
  const existing = await RegistrationOtp.findOne({ email: normalizedEmail }).select("+otpHash");
  if (!existing || existing.expiresAt <= now) {
    if (existing?.expiresAt <= now) await RegistrationOtp.deleteOne({ _id: existing._id });
    const error = new Error("Verification code is invalid or expired");
    error.status = 400;
    throw error;
  }
  if (existing.attempts >= OTP_MAX_ATTEMPTS) {
    await RegistrationOtp.deleteOne({ _id: existing._id });
    const error = new Error("Too many incorrect codes; request a new verification code");
    error.status = 429;
    throw error;
  }

  if (!secretsMatch(existing.otpHash, presentedHash)) {
    const updated = await RegistrationOtp.findOneAndUpdate(
      { _id: existing._id, expiresAt: { $gt: now }, attempts: { $lt: OTP_MAX_ATTEMPTS } },
      { $inc: { attempts: 1 } },
      { new: true }
    );
    if (updated?.attempts >= OTP_MAX_ATTEMPTS) {
      await RegistrationOtp.deleteOne({ _id: updated._id, attempts: { $gte: OTP_MAX_ATTEMPTS } });
    }
    const error = new Error(updated?.attempts >= OTP_MAX_ATTEMPTS
      ? "Too many incorrect codes; request a new verification code"
      : "Verification code is incorrect");
    error.status = updated?.attempts >= OTP_MAX_ATTEMPTS ? 429 : 400;
    error.attemptsRemaining = Math.max(0, OTP_MAX_ATTEMPTS - (updated?.attempts || OTP_MAX_ATTEMPTS));
    throw error;
  }

  const session = await mongoose.startSession();
  let user;
  try {
    await session.withTransaction(async () => {
      const consumed = await RegistrationOtp.findOneAndDelete({
        _id: existing._id,
        email: normalizedEmail,
        otpHash: presentedHash,
        expiresAt: { $gt: now },
        attempts: { $lt: OTP_MAX_ATTEMPTS }
      }, { session });
      if (!consumed) {
        const error = new Error("Verification code is invalid or expired");
        error.status = 400;
        throw error;
      }

      const [createdUser] = await User.create([{
        name: consumed.name,
        email: normalizedEmail,
        passwordHash: consumed.passwordHash,
        isEmailVerified: true,
        accountStatus: "active",
        creditBalance: INITIAL_CREDITS
      }], { session });
      user = createdUser;

      await CreditTransaction.create([{
        user: createdUser._id,
        amount: INITIAL_CREDITS,
        type: "signup-grant",
        direction: "credit",
        balanceBefore: 0,
        balanceAfter: INITIAL_CREDITS,
        reference: `signup:${createdUser._id}`,
        description: "Initial signup credit grant"
      }], { session });
    });
  } catch (error) {
    throw mapTransactionError(error);
  } finally {
    await session.endSession();
  }

  return user;
}

export async function createPasswordReset(email, mailer, now = new Date()) {
  const normalizedEmail = email.trim().toLowerCase();
  const user = await User.findOne({
    email: normalizedEmail,
    isEmailVerified: true,
    accountStatus: "active"
  });
  if (!user) return;

  const token = createResetToken();
  const tokenHash = hashSecret(token, "password-reset");
  await PasswordResetToken.findOneAndUpdate(
    { user: user._id },
    {
      user: user._id,
      tokenHash,
      expiresAt: new Date(now.getTime() + RESET_TTL_MS),
      attempts: 0
    },
    { upsert: true, new: true, runValidators: true }
  );

  try {
    await mailer.sendPasswordResetEmail(normalizedEmail, token);
  } catch (error) {
    await PasswordResetToken.deleteOne({ user: user._id, tokenHash });
    throw error;
  }
}

export async function resetUserPassword(token, password, now = new Date()) {
  const tokenHash = hashSecret(token, "password-reset");
  const reset = await PasswordResetToken.findOne({ tokenHash }).select("+tokenHash");
  if (!reset || reset.expiresAt <= now || reset.attempts >= RESET_MAX_ATTEMPTS) {
    const error = new Error("Password reset link is invalid or expired");
    error.status = 400;
    throw error;
  }

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const consumed = await PasswordResetToken.findOneAndDelete({
        _id: reset._id,
        tokenHash,
        expiresAt: { $gt: now },
        attempts: { $lt: RESET_MAX_ATTEMPTS }
      }, { session });
      if (!consumed) {
        const error = new Error("Password reset link is invalid or expired");
        error.status = 400;
        throw error;
      }

      const result = await User.updateOne(
        { _id: consumed.user, isEmailVerified: true, accountStatus: "active" },
        { $set: { passwordHash: await bcrypt.hash(password, 12) } },
        { session }
      );
      if (!result.matchedCount) {
        const error = new Error("Password reset link is invalid or expired");
        error.status = 400;
        throw error;
      }
      await LoginOtp.deleteOne({ user: consumed.user }, { session });
    });
  } catch (error) {
    throw mapTransactionError(error);
  } finally {
    await session.endSession();
  }
}

export function createAuthToken(user) {
  const maxAgeSeconds = Math.floor(Number(process.env.AUTH_COOKIE_MAX_AGE_MS || 7 * 24 * 60 * 60 * 1000) / 1000);
  return jwt.sign({ sub: user._id.toString() }, process.env.JWT_SECRET, {
    algorithm: "HS256",
    expiresIn: maxAgeSeconds
  });
}

export function toPublicUser(user) {
  return {
    id: user._id,
    name: user.name,
    email: user.email,
    isEmailVerified: user.isEmailVerified,
    accountStatus: user.accountStatus,
    profileImage: user.profileImage,
    bio: user.bio,
    location: user.location,
    experienceLevel: user.experienceLevel,
    preferredLearningMode: user.preferredLearningMode,
    isProfilePublic: user.isProfilePublic,
    skillsToTeach: user.skillsToTeach,
    skillsToLearn: user.skillsToLearn,
    interests: user.interests,
    availableTimeSlots: user.availableTimeSlots,
    languages: user.languages,
    creditBalance: user.creditBalance,
    permissions: user.permissions,
    accountType: user.accountType,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
}
