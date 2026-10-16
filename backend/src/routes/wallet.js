import { Router } from "express";
import { walletController } from "../controllers/walletController.js";
import { authenticate } from "../middleware/authenticate.js";

const asyncHandler = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const router = Router();

router.use(authenticate);
router.get("/", asyncHandler(walletController.summary));
router.get("/transactions", asyncHandler(walletController.transactions));
router.get("/transactions/:id", asyncHandler(walletController.transaction));

export default router;
