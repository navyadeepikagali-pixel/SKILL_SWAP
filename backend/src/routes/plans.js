import { Router } from "express";
import { usageController } from "../controllers/usageController.js";

const asyncHandler = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const router = Router();

router.get("/", asyncHandler(usageController.plans));

export default router;
