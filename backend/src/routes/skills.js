import { Router } from "express";
import { catalogController } from "../controllers/catalogController.js";
import { authenticate } from "../middleware/authenticate.js";
import { authorizeAdmin } from "../middleware/authorizeAdmin.js";
import { auditAdmin } from "../middleware/auditAdmin.js";

const asyncHandler = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const router = Router();

router.post("/suggestions", authenticate, asyncHandler(catalogController.suggestSkill));
router.get("/suggestions", authenticate, authorizeAdmin, auditAdmin("admin.skill_suggestions.list", "skill_suggestion"), asyncHandler(catalogController.listSuggestions));
router.patch("/suggestions/:id", authenticate, authorizeAdmin, auditAdmin("admin.skill_suggestion.review", "skill_suggestion"), asyncHandler(catalogController.reviewSuggestion));
router.post("/", authenticate, authorizeAdmin, auditAdmin("admin.skill.create", "skill"), asyncHandler(catalogController.createSkill));
router.patch("/:id", authenticate, authorizeAdmin, auditAdmin("admin.skill.update", "skill"), asyncHandler(catalogController.updateSkill));
router.delete("/:id", authenticate, authorizeAdmin, auditAdmin("admin.skill.deactivate", "skill"), asyncHandler(catalogController.deactivateSkill));

export default router;
