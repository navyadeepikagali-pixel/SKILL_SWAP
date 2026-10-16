import { Router } from "express";
import { usageController } from "../controllers/usageController.js";
import { authenticate } from "../middleware/authenticate.js";

const asyncHandler = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const router = Router();

router.post("/webhook", asyncHandler(usageController.webhook));
router.use(authenticate);
router.get("/me", asyncHandler(usageController.subscription));
router.post("/checkout", asyncHandler(usageController.checkout));
router.post("/cancel", asyncHandler(usageController.cancelSubscription));

export default router;
