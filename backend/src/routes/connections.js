import { Router } from "express";
import rateLimit from "express-rate-limit";
import { chatController } from "../controllers/chatController.js";
import { authenticate } from "../middleware/authenticate.js";
import { applyUsagePolicy } from "../middleware/applyUsagePolicy.js";

const asyncHandler = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const router = Router();
const connectionLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  keyGenerator: req => req.user._id.toString(),
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { success: false, message: "Too many connection requests. Please try again later." }
});

router.use(authenticate);
router.post("/", connectionLimiter, applyUsagePolicy("connection_request"), asyncHandler(chatController.createConnection));
router.get("/", asyncHandler(chatController.listConnections));
router.patch("/:id/accept", connectionLimiter, (req, _res, next) => {
  req.params.action = "accepted";
  next();
}, asyncHandler(chatController.updateConnection));
router.patch("/:id/reject", connectionLimiter, (req, _res, next) => {
  req.params.action = "rejected";
  next();
}, asyncHandler(chatController.updateConnection));

export default router;
