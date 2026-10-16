import { Router } from "express";
import { profileController } from "../controllers/profileController.js";
import { tutorController } from "../controllers/tutorController.js";
import { authenticate } from "../middleware/authenticate.js";

const asyncHandler = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const router = Router();
router.use(authenticate);

router.get("/me/skills", asyncHandler(profileController.getSkills));
router.put("/me/skills", asyncHandler(profileController.replaceSkills));
router.delete("/me/skills/:skillId", asyncHandler(profileController.removeSkill));
router.get("/me", asyncHandler(profileController.me));
router.patch("/me", asyncHandler(profileController.updateMe));
router.get("/:id", asyncHandler(profileController.publicProfile));

export default router;
