import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { getClientOrigin } from "./clientOrigins.js";

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const backendEnvPath = resolve(currentDirectory, "../.env");
const rootEnvPath = resolve(currentDirectory, "../../.env");

dotenv.config({ path: backendEnvPath });
dotenv.config({ path: rootEnvPath });

export function validateEnvironment() {
  const missing = ["MONGODB_URI", "JWT_SECRET"].filter(key => !process.env[key]?.trim());
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}. Set them in backend/.env; copy the root .env.example as a starting point.`);
  }
  const mongoUri = process.env.MONGODB_URI.trim();
  if (!/^mongodb(?:\+srv)?:\/\//i.test(mongoUri)) {
    throw new Error("MONGODB_URI must use the mongodb:// or mongodb+srv:// scheme");
  }
  let mongoUrl;
  try {
    mongoUrl = new URL(mongoUri);
  } catch {
    throw new Error("MONGODB_URI must be a valid MongoDB connection string");
  }
  if (!mongoUrl.hostname) {
    throw new Error("MONGODB_URI must include a MongoDB host");
  }
  if (process.env.JWT_SECRET.length < 12) {
    throw new Error("JWT_SECRET must be at least 12 characters long");
  }
  const port = Number(process.env.PORT || 5000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be a valid TCP port");
  }
  const emailProvider = (process.env.EMAIL_PROVIDER || "smtp").trim().toLowerCase();
  if (!["smtp", "brevo", "none"].includes(emailProvider)) {
    throw new Error("EMAIL_PROVIDER must be smtp, brevo, or none");
  }
  const clientOrigin = getClientOrigin();
  if (clientOrigin) {
    let clientUrl;
    try {
      clientUrl = new URL(clientOrigin);
    } catch {
      throw new Error("CLIENT_URL must be a valid frontend origin");
    }
    if (!["http:", "https:"].includes(clientUrl.protocol) ||
      clientUrl.origin !== clientOrigin) {
      throw new Error("CLIENT_URL must contain only the frontend origin, without a path or trailing slash");
    }
    if (process.env.NODE_ENV === "production" && clientUrl.protocol !== "https:") {
      throw new Error("CLIENT_URL must use HTTPS in production");
    }
  } else if (process.env.NODE_ENV === "production") {
    throw new Error("CLIENT_URL is required in production");
  }
  const creditPrice = Number(process.env.SESSION_CREDIT_PRICE ?? 10);
  if (!Number.isSafeInteger(creditPrice) || creditPrice < 1 || creditPrice > 100_000) {
    throw new Error("SESSION_CREDIT_PRICE must be a positive integer no greater than 100000");
  }
  if (emailProvider === "none") {
    if (process.env.NODE_ENV === "production" && process.env.ALLOW_PASSWORD_ONLY_AUTH !== "true") {
      throw new Error("EMAIL_PROVIDER=none in production requires ALLOW_PASSWORD_ONLY_AUTH=true; email verification and password recovery will be disabled");
    }
  } else if (emailProvider === "brevo") {
    const missingBrevoSettings = ["BREVO_API_KEY", "EMAIL_FROM"]
      .filter(key => !process.env[key]?.trim());
    if (missingBrevoSettings.length && process.env.NODE_ENV === "production") {
      throw new Error(`BREVO_API_KEY and EMAIL_FROM are required in production when EMAIL_PROVIDER=brevo; missing: ${missingBrevoSettings.join(", ")}`);
    }
  } else {
    const smtpSettings = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS"];
    const configuredSmtpSettings = smtpSettings.filter(key => String(process.env[key] ?? "").trim() !== "");
    if (configuredSmtpSettings.length > 0 && configuredSmtpSettings.length < smtpSettings.length) {
      throw new Error("Configure SMTP_HOST, SMTP_PORT, SMTP_USER, and SMTP_PASS together");
    }
    if (process.env.NODE_ENV === "production" && configuredSmtpSettings.length === 0) {
      throw new Error("SMTP_HOST, SMTP_PORT, SMTP_USER, and SMTP_PASS are required in production when EMAIL_PROVIDER=smtp");
    }
    if (configuredSmtpSettings.length === smtpSettings.length) {
      const smtpPort = Number(process.env.SMTP_PORT);
      if (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535) {
        throw new Error("SMTP_PORT must be a valid TCP port");
      }
    }
  }
  if (process.env.SMTP_SECURE) {
    const normalizedSecure = String(process.env.SMTP_SECURE).trim().toLowerCase();
    if (!["true", "false"].includes(normalizedSecure)) {
      throw new Error("SMTP_SECURE must be true or false");
    }
  }
}
