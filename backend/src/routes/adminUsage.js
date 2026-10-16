import { Router } from "express";
import { usageController } from "../controllers/usageController.js";
import { authenticate } from "../middleware/authenticate.js";
import { authorizeAdmin } from "../middleware/authorizeAdmin.js";
import { auditAdmin } from "../middleware/auditAdmin.js";

const asyncHandler = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const router = Router();

router.use(authenticate, authorizeAdmin);
router.get("/policy", auditAdmin("admin.usage.policy.view", "usage_policy"), asyncHandler(usageController.adminPolicy));
router.put("/policy", auditAdmin("admin.usage.policy.update", "usage_policy"), asyncHandler(usageController.updatePolicy));
router.get("/plans", auditAdmin("admin.plans.list", "subscription_plan"), asyncHandler(usageController.adminPlans));
router.post("/plans", auditAdmin("admin.plan.create", "subscription_plan"), asyncHandler(usageController.createPlan));
router.patch("/plans/:id", auditAdmin("admin.plan.update", "subscription_plan"), asyncHandler(usageController.updatePlan));
router.get("/statistics", auditAdmin("admin.usage.statistics.view", "usage"), asyncHandler(usageController.stats));
router.get("/restrictions", auditAdmin("admin.usage.restrictions.view", "usage"), asyncHandler(usageController.restrictions));

export default router;
