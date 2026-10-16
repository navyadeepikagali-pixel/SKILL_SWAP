import { Router } from "express";
import { disputeController } from "../controllers/disputeController.js";
import { authenticate } from "../middleware/authenticate.js";

const asyncHandler = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const router = Router();
router.use(authenticate);
router.get("/me", asyncHandler(disputeController.mine));
router.get("/:disputeId", asyncHandler(disputeController.getMine));
router.post("/", asyncHandler(disputeController.create));
export default router;
