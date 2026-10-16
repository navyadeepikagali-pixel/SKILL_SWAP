import { Router } from "express";
import { tutorController } from "../controllers/tutorController.js";
import { authenticate } from "../middleware/authenticate.js";
import { applyUsagePolicy } from "../middleware/applyUsagePolicy.js";

const asyncHandler = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const router = Router();
router.use(authenticate);

router.get("/search", applyUsagePolicy("tutor_search"), asyncHandler(tutorController.search));
router.get("/", applyUsagePolicy("tutor_search"), asyncHandler(tutorController.list));
router.get("/:id", asyncHandler(tutorController.details));

export default router;
