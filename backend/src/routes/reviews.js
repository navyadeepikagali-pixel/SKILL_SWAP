import { Router } from "express";
import { reviewController } from "../controllers/reviewController.js";
import { authenticate } from "../middleware/authenticate.js";

const asyncHandler = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const router = Router();

router.get("/tutors/:tutorId", asyncHandler(reviewController.tutorReviews));
router.use(authenticate);
router.post("/", asyncHandler(reviewController.create));
router.get("/me", asyncHandler(reviewController.mine));

export default router;
