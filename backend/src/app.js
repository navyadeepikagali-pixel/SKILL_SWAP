import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isAllowedClientOrigin } from "./config/clientOrigins.js";
import { createAuthRouter } from "./routes/auth.js";
import categoriesRouter from "./routes/categories.js";
import skillsRouter from "./routes/skills.js";
import tutorsRouter from "./routes/tutors.js";
import usersRouter from "./routes/users.js";
import connectionsRouter from "./routes/connections.js";
import conversationsRouter from "./routes/conversations.js";
import messagesRouter from "./routes/messages.js";
import sessionsRouter from "./routes/sessions.js";
import notificationsRouter from "./routes/notifications.js";
import walletRouter from "./routes/wallet.js";
import adminSettlementsRouter from "./routes/adminSettlements.js";
import usageRouter from "./routes/usage.js";
import plansRouter from "./routes/plans.js";
import subscriptionsRouter from "./routes/subscriptions.js";
import adminUsageRouter from "./routes/adminUsage.js";
import reviewsRouter from "./routes/reviews.js";
import disputesRouter from "./routes/disputes.js";
import adminRouter from "./routes/admin.js";
import { sendLoginOtpEmail, sendOtpEmail, sendPasswordResetEmail } from "./services/email.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { apiNotFound } from "./middleware/apiNotFound.js";
import { getClientOrigin } from "./config/clientOrigins.js";

const frontendDist = resolve(dirname(fileURLToPath(import.meta.url)), "../../frontend/dist");

export function createApp({
  mailer = { sendOtpEmail, sendLoginOtpEmail, sendPasswordResetEmail },
  authRateLimit = {},
  paymentProvider = null
} = {}) {
  const app = express();
  const clientUrl = getClientOrigin();

  app.disable("x-powered-by");
  app.use(cors({
    origin: (origin, callback) => callback(null, !origin || isAllowedClientOrigin(origin, clientUrl)),
    credentials: true
  }));
  app.use(express.json({ limit: "1mb", verify: (req, _res, buffer) => { req.rawBody = Buffer.from(buffer); } }));
  app.use(cookieParser());
  app.set("paymentProvider", paymentProvider);

  if (process.env.NODE_ENV !== "production") {
    app.get("/", (_req, res) => {
      res.json({
        success: true,
        message: "Skill Swap API is running",
        data: {
          service: "skill-swap-api",
          frontend: clientUrl,
          health: "/api/health"
        }
      });
    });
  }
  app.get("/api/health", (_req, res) => {
    res.json({ success: true, message: "Service is healthy", data: { status: "ok", service: "skill-swap-api" } });
  });
  app.use("/api/auth", createAuthRouter({ mailer, rateLimit: authRateLimit }));
  app.use("/api/categories", categoriesRouter);
  app.use("/api/skills", skillsRouter);
  app.use("/api/tutors", tutorsRouter);
  app.use("/api/users", usersRouter);
  app.use("/api/connections", connectionsRouter);
  app.use("/api/conversations", conversationsRouter);
  app.use("/api/messages", messagesRouter);
  app.use("/api/sessions", sessionsRouter);
  app.use("/api/notifications", notificationsRouter);
  app.use("/api/wallet", walletRouter);
  app.use("/api/admin/settlements", adminSettlementsRouter);
  app.use("/api/usage", usageRouter);
  app.use("/api/plans", plansRouter);
  app.use("/api/subscriptions", subscriptionsRouter);
  app.use("/api/admin/usage", adminUsageRouter);
  app.use("/api/reviews", reviewsRouter);
  app.use("/api/disputes", disputesRouter);
  app.use("/api/admin", adminRouter);
  if (process.env.NODE_ENV === "production") {
    app.use(express.static(frontendDist, { index: false }));
    app.use("/api", apiNotFound);
    app.get("*", (_req, res, next) => {
      res.sendFile(resolve(frontendDist, "index.html"), error => {
        if (error) next(error);
      });
    });
  } else {
    app.use(apiNotFound);
  }
  app.use(errorHandler);

  return app;
}

export const app = createApp();
