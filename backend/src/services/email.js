import nodemailer from "nodemailer";

function getEmailProvider() {
  return (process.env.EMAIL_PROVIDER || "smtp").trim().toLowerCase();
}

function getTransport() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  const missing = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS"]
    .filter(key => !process.env[key]?.trim());
  if (missing.length) {
    const error = new Error(`Email is not configured. Set ${missing.join(", ")} in backend/.env, then restart the backend.`);
    error.code = "EMAIL_NOT_CONFIGURED";
    throw error;
  }

  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: process.env.SMTP_SECURE === "true",
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });
}

async function deliverWithBrevo(options) {
  const { BREVO_API_KEY, EMAIL_FROM } = process.env;
  const missing = ["BREVO_API_KEY", "EMAIL_FROM"]
    .filter(key => !process.env[key]?.trim());
  if (missing.length) {
    const error = new Error(`Email is not configured. Set ${missing.join(", ")} in backend/.env, then restart the backend.`);
    error.code = "EMAIL_NOT_CONFIGURED";
    throw error;
  }

  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": BREVO_API_KEY,
      "content-type": "application/json",
      accept: "application/json"
    },
    body: JSON.stringify({
      sender: {
        email: EMAIL_FROM,
        ...(process.env.EMAIL_FROM_NAME?.trim() ? { name: process.env.EMAIL_FROM_NAME.trim() } : {})
      },
      to: [{ email: options.to }],
      subject: options.subject,
      textContent: options.text,
      htmlContent: options.html
    })
  });

  if (!response.ok) {
    throw new Error(`Brevo email request failed with HTTP ${response.status}`);
  }
}

async function deliver(options) {
  try {
    if (getEmailProvider() === "brevo") {
      await deliverWithBrevo(options);
      return;
    }
    if (getEmailProvider() !== "smtp") {
      const error = new Error("EMAIL_PROVIDER must be smtp or brevo");
      error.code = "EMAIL_NOT_CONFIGURED";
      throw error;
    }
    await getTransport().sendMail({ from: process.env.EMAIL_FROM || process.env.SMTP_USER, ...options });
  } catch (cause) {
    if (cause.code === "EMAIL_NOT_CONFIGURED") throw cause;
    const error = new Error("Email delivery failed. Check the configured email provider and try again.");
    error.code = "EMAIL_DELIVERY_FAILED";
    error.cause = cause;
    throw error;
  }
}

export function sendOtpEmail(email, code) {
  return deliver({
    to: email,
    subject: "Your Skill Swap verification code",
    text: `Your Skill Swap email verification code is ${code}. It expires in five minutes.`,
    html: `<p>Your Skill Swap email verification code is <strong>${code}</strong>.</p><p>It expires in five minutes.</p>`
  });
}

export function sendLoginOtpEmail(email, code) {
  return deliver({
    to: email,
    subject: "Your Skill Swap sign-in code",
    text: `Your Skill Swap sign-in code is ${code}. It expires in five minutes.`,
    html: `<p>Your Skill Swap sign-in code is <strong>${code}</strong>.</p><p>It expires in five minutes.</p>`
  });
}

export function sendPasswordResetEmail(email, token) {
  const resetUrl = new URL(process.env.PASSWORD_RESET_URL || "http://localhost:5173/reset-password");
  resetUrl.searchParams.set("token", token);
  return deliver({
    to: email,
    subject: "Reset your Skill Swap password",
    text: `Use this one-time link to reset your password: ${resetUrl.href}. The link expires in 15 minutes.`,
    html: `<p><a href="${resetUrl.href}">Reset your Skill Swap password</a></p><p>This link expires in 15 minutes.</p>`
  });
}
