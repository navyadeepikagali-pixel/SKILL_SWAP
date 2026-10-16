import { Router } from "express";
import { usageController } from "../controllers/usageController.js";
import { authenticate } from "../middleware/authenticate.js";

const asyncHandler = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const router = Router();

router.use(authenticate);
router.get("/status", asyncHandler(usageController.status));
router.get("/history", asyncHandler(usageController.history));

export default router;
