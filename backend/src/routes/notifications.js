import { Router } from "express";
import { sessionController } from "../controllers/sessionController.js";
import { authenticate } from "../middleware/authenticate.js";
import { notificationController } from "../controllers/notificationController.js";

const asyncHandler = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const router = Router();
router.use(authenticate);
router.get("/", asyncHandler(sessionController.notifications));
router.patch("/read-all", asyncHandler(notificationController.markAllRead));
router.patch("/:id/read", asyncHandler(notificationController.markRead));
export default router;
