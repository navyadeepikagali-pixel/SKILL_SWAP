import test from "node:test";
import assert from "node:assert/strict";
import { sendOtpEmail } from "../src/services/email.js";

test("email configuration errors identify missing SMTP setting names without exposing values", async () => {
  const keys = ["EMAIL_PROVIDER", "BREVO_API_KEY", "EMAIL_FROM", "SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS"];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    for (const key of keys) delete process.env[key];
    process.env.EMAIL_PROVIDER = "smtp";
    await assert.rejects(
      sendOtpEmail("recipient@example.com", "123456"),
      {
        code: "EMAIL_NOT_CONFIGURED",
        message: "Email is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS in backend/.env, then restart the backend."
      }
    );

    process.env.SMTP_HOST = "smtp.example.com";
    await assert.rejects(
      sendOtpEmail("recipient@example.com", "123456"),
      {
        code: "EMAIL_NOT_CONFIGURED",
        message: "Email is not configured. Set SMTP_PORT, SMTP_USER, SMTP_PASS in backend/.env, then restart the backend."
      }
    );
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});

test("Brevo sends email through its API without exposing the API key", async () => {
  const keys = ["EMAIL_PROVIDER", "BREVO_API_KEY", "EMAIL_FROM", "EMAIL_FROM_NAME"];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  let request;
  try {
    process.env.EMAIL_PROVIDER = "brevo";
    process.env.BREVO_API_KEY = "test-brevo-key";
    process.env.EMAIL_FROM = "no-reply@example.com";
    process.env.EMAIL_FROM_NAME = "Skill Swap";
    globalThis.fetch = async (url, options) => {
      request = { url, options };
      return { ok: true, status: 201 };
    };

    await sendOtpEmail("recipient@example.com", "123456");

    assert.equal(request.url, "https://api.brevo.com/v3/smtp/email");
    assert.equal(request.options.method, "POST");
    assert.equal(request.options.headers["api-key"], "test-brevo-key");
    const body = JSON.parse(request.options.body);
    assert.deepEqual(body.sender, { email: "no-reply@example.com", name: "Skill Swap" });
    assert.deepEqual(body.to, [{ email: "recipient@example.com" }]);
    assert.match(body.textContent, /123456/);
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});

test("Brevo delivery failures return a safe error without exposing provider details", async () => {
  const keys = ["EMAIL_PROVIDER", "BREVO_API_KEY", "EMAIL_FROM"];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  try {
    process.env.EMAIL_PROVIDER = "brevo";
    process.env.BREVO_API_KEY = "test-brevo-key";
    process.env.EMAIL_FROM = "no-reply@example.com";
    globalThis.fetch = async () => ({ ok: false, status: 401 });

    await assert.rejects(sendOtpEmail("recipient@example.com", "123456"), {
      code: "EMAIL_DELIVERY_FAILED",
      message: "Email delivery failed. Check the configured email provider and try again."
    });
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});
