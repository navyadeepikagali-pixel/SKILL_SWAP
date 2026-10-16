import { Router } from "express";
import { catalogController } from "../controllers/catalogController.js";
import { authenticate } from "../middleware/authenticate.js";
import { authorizeAdmin } from "../middleware/authorizeAdmin.js";
import { auditAdmin } from "../middleware/auditAdmin.js";

const asyncHandler = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const router = Router();

router.get("/", asyncHandler(catalogController.listCategories));
router.get("/:slug/skills", asyncHandler(catalogController.getCategorySkills));
router.get("/:slug", asyncHandler(catalogController.getCategory));
router.post("/", authenticate, authorizeAdmin, auditAdmin("admin.category.create", "category"), asyncHandler(catalogController.createCategory));
router.patch("/:id", authenticate, authorizeAdmin, auditAdmin("admin.category.update", "category"), asyncHandler(catalogController.updateCategory));
router.delete("/:id", authenticate, authorizeAdmin, auditAdmin("admin.category.deactivate", "category"), asyncHandler(catalogController.deactivateCategory));

export default router;
