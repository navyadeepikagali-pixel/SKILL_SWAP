import { Router } from "express";
import rateLimit from "express-rate-limit";
import { chatController } from "../controllers/chatController.js";
import { authenticate } from "../middleware/authenticate.js";

const asyncHandler = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const router = Router();
const messageLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { success: false, message: "Too many messages. Please try again later." }
});

router.use(authenticate);
router.get("/", asyncHandler(chatController.listConversations));
router.get("/:conversationId/messages", asyncHandler(chatController.listMessages));
router.post("/:conversationId/messages", messageLimiter, asyncHandler(chatController.sendMessage));
router.patch("/:conversationId/read", asyncHandler(chatController.markRead));
router.get("/:conversationId", asyncHandler(chatController.getConversation));

export default router;
