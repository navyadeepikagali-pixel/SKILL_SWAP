import bcrypt from "bcrypt";
import { createHash } from "node:crypto";
import { matchedData, validationResult } from "express-validator";
import { User } from "../models/User.js";
import {
  createAuthToken,
  createLoginOtp,
  createPasswordAccount,
  createPendingRegistration,
  createPasswordReset,
  resetUserPassword,
  resendRegistrationOtp,
  resendLoginOtp,
  toPublicUser,
  verifyLoginOtp,
  verifyRegistrationEmail
} from "../services/authService.js";
import { clearAuthCookie, getAuthCookieName, getAuthCookieOptions } from "../utils/authCookies.js";
import { failure, success } from "../utils/responses.js";
import { recordAudit } from "../services/auditService.js";

function validateRequest(req, res) {
  const errors = validationResult(req);
  if (errors.isEmpty()) return true;
  failure(res, 400, errors.array({ onlyFirstError: true })[0].msg);
  return false;
}

function sendCookie(res, user) {
  res.cookie(getAuthCookieName(), createAuthToken(user), getAuthCookieOptions());
}

function emailOtpEnabled() {
  return (process.env.EMAIL_PROVIDER || "smtp").trim().toLowerCase() !== "none";
}

export function makeAuthController({ mailer }) {
  return {
    register: async (req, res, next) => {
      try {
        if (!validateRequest(req, res)) return;
        const input = matchedData(req);
        if (!emailOtpEnabled()) {
          const user = await createPasswordAccount(input);
          sendCookie(res, user);
          return success(res, 201, "Account created successfully", { user: toPublicUser(user) });
        }
        const result = await createPendingRegistration(input, mailer);
        return success(res, 202, "Verification code sent to your email", {
          email: result.email,
          resendAfterSeconds: result.resendAfter / 1000
        });
      } catch (error) {
        if (error.status) {
          if (error.retryAfter) {
            res.set("Retry-After", String(Math.max(1, Math.ceil((error.retryAfter - Date.now()) / 1000))));
          }
          return failure(res, error.status, error.message);
        }
        return next(error);
      }
    },

    verifyEmail: async (req, res, next) => {
      try {
        if (!emailOtpEnabled()) {
          return failure(res, 410, "Email verification is disabled; create an account with your password");
        }
        if (!validateRequest(req, res)) return;
        const { email, otp } = matchedData(req);
        const user = await verifyRegistrationEmail(email, otp);
        return success(res, 201, "Email verified and account created", { user: toPublicUser(user) });
      } catch (error) {
        if (error.status) {
          if (error.attemptsRemaining !== undefined) {
            return res.status(error.status).json({
              success: false,
              message: error.message,
              data: { attemptsRemaining: error.attemptsRemaining }
            });
          }
          return failure(res, error.status, error.message);
        }
        return next(error);
      }
    },

    resendOtp: async (req, res, next) => {
      try {
        if (!emailOtpEnabled()) {
          return failure(res, 410, "Email verification codes are disabled");
        }
        if (!validateRequest(req, res)) return;
        const { email } = matchedData(req);
        const result = await resendRegistrationOtp(email, mailer);
        return success(res, 200, "If a pending registration exists, a verification code has been sent", {
          resendAfterSeconds: result.sent ? result.resendAfter / 1000 : 0
        });
      } catch (error) {
        if (error.status) {
          if (error.retryAfter) {
            res.set("Retry-After", String(Math.max(1, Math.ceil((error.retryAfter - Date.now()) / 1000))));
          }
          return failure(res, error.status, error.message);
        }
        return next(error);
      }
    },

    login: async (req, res, next) => {
      try {
        if (!validateRequest(req, res)) return;
        const { email, password } = matchedData(req);
        const user = await User.findOne({ email }).select("+passwordHash");
        const passwordMatches = user ? await bcrypt.compare(password, user.passwordHash) : false;
        const emailAuthEnabled = emailOtpEnabled();
        if (!user || !passwordMatches ||
          (emailAuthEnabled && !user.isEmailVerified) ||
          (!emailAuthEnabled && !user.isEmailVerified && user.emailVerificationRequired) ||
          user.accountStatus !== "active") {
          if (user?.accountType === "admin") {
            await recordAudit({
              actor: user._id,
              action: "admin.login.failed",
              resourceType: "admin_auth",
              outcome: "failure",
              metadata: { emailFingerprint: createHash("sha256").update(email).digest("hex") }
            });
          }
          return failure(res, 401, "Invalid email or password");
        }
        if (!emailAuthEnabled) {
          user.lastLoginAt = new Date();
          await user.save();
          if (user.accountType === "admin") {
            await recordAudit({
              actor: user._id,
              action: "admin.login.succeeded",
              resourceType: "admin_auth",
              outcome: "success"
            });
          }
          sendCookie(res, user);
          return success(res, 200, "Signed in successfully", { user: toPublicUser(user) });
        }
        const result = await createLoginOtp(user, mailer);
        return success(res, 202, "Sign-in code sent to your email", {
          email: result.email,
          resendAfterSeconds: result.resendAfter / 1000
        });
      } catch (error) {
        if (error.status) {
          if (error.retryAfter) {
            res.set("Retry-After", String(Math.max(1, Math.ceil((error.retryAfter - Date.now()) / 1000))));
          }
          return failure(res, error.status, error.message);
        }
        return next(error);
      }
    },

    verifyLoginOtp: async (req, res, next) => {
      try {
        if (!emailOtpEnabled()) {
          return failure(res, 410, "Email sign-in codes are disabled; sign in with your password");
        }
        if (!validateRequest(req, res)) return;
        const { email, otp } = matchedData(req);
        const user = await verifyLoginOtp(email, otp);
        if (user.accountType === "admin") {
          await recordAudit({
            actor: user._id,
            action: "admin.login.succeeded",
            resourceType: "admin_auth",
            outcome: "success"
          });
        }
        sendCookie(res, user);
        return success(res, 200, "Signed in successfully", { user: toPublicUser(user) });
      } catch (error) {
        if (error.status) {
          if (error.attemptsRemaining !== undefined) {
            return res.status(error.status).json({
              success: false,
              message: error.message,
              data: { attemptsRemaining: error.attemptsRemaining }
            });
          }
          return failure(res, error.status, error.message);
        }
        return next(error);
      }
    },

    resendLoginOtp: async (req, res, next) => {
      try {
        if (!emailOtpEnabled()) {
          return failure(res, 410, "Email sign-in codes are disabled");
        }
        if (!validateRequest(req, res)) return;
        const { email } = matchedData(req);
        const result = await resendLoginOtp(email, mailer);
        return success(res, 200, "If a pending sign-in exists, a code has been sent", {
          resendAfterSeconds: result.sent ? result.resendAfter / 1000 : 0
        });
      } catch (error) {
        if (error.status) {
          if (error.retryAfter) {
            res.set("Retry-After", String(Math.max(1, Math.ceil((error.retryAfter - Date.now()) / 1000))));
          }
          return failure(res, error.status, error.message);
        }
        return next(error);
      }
    },

    logout: (_req, res) => {
      clearAuthCookie(res);
      return success(res, 200, "Signed out successfully", {});
    },

    me: (req, res) => success(res, 200, "Current user retrieved", { user: toPublicUser(req.user) }),

    forgotPassword: async (req, res, next) => {
      try {
        if (!validateRequest(req, res)) return;
        if (!emailOtpEnabled()) {
          return failure(res, 503, "Password reset is unavailable without an email provider");
        }
        const { email } = matchedData(req);
        await createPasswordReset(email, mailer);
        return success(res, 200, "If an active account exists and email delivery is available, password reset instructions may be sent", {});
      } catch (error) {
        if (error.code === "EMAIL_NOT_CONFIGURED" || error.code === "EMAIL_DELIVERY_FAILED") {
          console.error("Password reset email delivery failed");
          return success(res, 200, "If an active account exists and email delivery is available, password reset instructions may be sent", {});
        }
        return next(error);
      }
    },

    resetPassword: async (req, res, next) => {
      try {
        if (!validateRequest(req, res)) return;
        const { token, password } = matchedData(req);
        await resetUserPassword(token, password);
        return success(res, 200, "Password reset successfully", {});
      } catch (error) {
        if (error.status) return failure(res, error.status, error.message);
        return next(error);
      }
    }
  };
}
