import { Router } from "express";
import rateLimit from "express-rate-limit";
import { sessionController } from "../controllers/sessionController.js";
import { authenticate } from "../middleware/authenticate.js";

const asyncHandler = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const router = Router();
const bookingLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  keyGenerator: req => req.user._id.toString(),
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { success: false, message: "Too many session actions. Please try again later." }
});

router.use(authenticate);
router.get("/availability", asyncHandler(sessionController.getAvailability));
router.put("/availability", asyncHandler(sessionController.putAvailability));
router.get("/calendar", asyncHandler(sessionController.calendar));
router.get("/", asyncHandler(sessionController.list));
router.post("/", bookingLimiter, asyncHandler(sessionController.create));
router.get("/:id/completion", asyncHandler(sessionController.completion));
router.post("/:id/request-completion", bookingLimiter, asyncHandler(sessionController.requestCompletion));
router.post("/:id/confirm-completion", bookingLimiter, asyncHandler(sessionController.confirmCompletion));
router.post("/:id/dispute", bookingLimiter, asyncHandler(sessionController.disputeCompletion));
router.post("/:id/settle", bookingLimiter, asyncHandler(sessionController.settle));
router.get("/:id", asyncHandler(sessionController.get));
router.patch("/:id/accept", bookingLimiter, asyncHandler(sessionController.accept));
router.patch("/:id/reject", bookingLimiter, asyncHandler(sessionController.reject));
router.patch("/:id/cancel", bookingLimiter, asyncHandler(sessionController.cancel));
router.patch("/:id/reschedule", bookingLimiter, asyncHandler(sessionController.proposeReschedule));
router.patch("/:id/reschedule/:action(accept|reject)", bookingLimiter, asyncHandler(sessionController.respondReschedule));

export default router;
