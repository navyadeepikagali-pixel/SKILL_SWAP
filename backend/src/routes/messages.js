import { Router } from "express";
import { chatController } from "../controllers/chatController.js";
import { authenticate } from "../middleware/authenticate.js";

const asyncHandler = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const router = Router();

router.use(authenticate);
router.patch("/:messageId", asyncHandler(chatController.editMessage));
router.delete("/:messageId", asyncHandler(chatController.deleteMessage));

export default router;
