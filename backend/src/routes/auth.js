import { Router } from "express";
import rateLimit from "express-rate-limit";
import { body } from "express-validator";
import { authenticate } from "../middleware/authenticate.js";
import { makeAuthController } from "../controllers/authController.js";
import { success } from "../utils/responses.js";

const normalizeEmail = value => value.trim().toLowerCase();
const emailField = field => body(field).isEmail().withMessage("Enter a valid email address").bail().customSanitizer(normalizeEmail);

export function createAuthRouter({ mailer, rateLimit: limiterOptions = {} }) {
  const router = Router();
  const controller = makeAuthController({ mailer });
  const selectedEmailProvider = () => (process.env.EMAIL_PROVIDER || "smtp").trim().toLowerCase();
  const emailOtpEnabled = () => selectedEmailProvider() !== "none";
  router.get("/config", (_req, res) => success(res, 200, "Authentication configuration retrieved", {
    emailOtpEnabled: emailOtpEnabled(),
    passwordResetEnabled: emailOtpEnabled()
  }));
  const defaults = {
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => res.status(429).json({ success: false, message: "Too many requests. Please try again later." })
  };
  const loginLimiter = rateLimit({
    ...defaults,
    windowMs: 15 * 60 * 1000,
    limit: 10,
    ...limiterOptions.login
  });
  const otpLimiter = rateLimit({
    ...defaults,
    windowMs: 15 * 60 * 1000,
    limit: 10,
    ...limiterOptions.otp
  });
  const resetLimiter = rateLimit({
    ...defaults,
    windowMs: 60 * 60 * 1000,
    limit: 5,
    ...limiterOptions.reset
  });

  router.post("/register", otpLimiter,
    body("name").trim().isLength({ min: 2, max: 80 }).withMessage("Name must be between 2 and 80 characters"),
    emailField("email"),
    body("password").isString().isLength({
      min: selectedEmailProvider() === "none" ? 12 : 8,
      max: 128
    }).withMessage(process.env.EMAIL_PROVIDER === "none"
      ? "Password must be between 12 and 128 characters when email recovery is disabled"
      : "Password must be between 8 and 128 characters"),
    controller.register
  );
  router.post("/verify-email", otpLimiter,
    emailField("email"),
    body("otp").isString().matches(/^\d{6}$/).withMessage("Enter the six-digit verification code"),
    controller.verifyEmail
  );
  router.post("/resend-otp", otpLimiter,
    emailField("email"),
    controller.resendOtp
  );
  router.post("/login", loginLimiter,
    emailField("email"),
    body("password").isString().isLength({ min: 1, max: 128 }).withMessage("Enter your password"),
    controller.login
  );
  router.post("/verify-login-otp", otpLimiter,
    emailField("email"),
    body("otp").isString().matches(/^\d{6}$/).withMessage("Enter the six-digit sign-in code"),
    controller.verifyLoginOtp
  );
  router.post("/resend-login-otp", otpLimiter,
    emailField("email"),
    controller.resendLoginOtp
  );
  router.post("/logout", controller.logout);
  router.get("/me", authenticate, controller.me);
  router.post("/forgot-password", resetLimiter, emailField("email"), controller.forgotPassword);
  router.post("/reset-password", resetLimiter,
    body("token").isString().isLength({ min: 40, max: 128 }).withMessage("Password reset link is invalid or expired"),
    body("password").isString().isLength({ min: 8, max: 128 }).withMessage("Password must be between 8 and 128 characters"),
    controller.resetPassword
  );

  return router;
}
