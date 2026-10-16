import { Router } from "express";
import { adminController } from "../controllers/adminController.js";
import { authenticate } from "../middleware/authenticate.js";
import { authorizeAdmin } from "../middleware/authorizeAdmin.js";
import { auditAdmin } from "../middleware/auditAdmin.js";

const asyncHandler = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const router = Router();

router.use(authenticate, authorizeAdmin);
router.get("/dashboard", auditAdmin("admin.dashboard.view", "dashboard"), asyncHandler(adminController.dashboard));
router.get("/categories", auditAdmin("admin.categories.list", "category"), asyncHandler(adminController.categories));
router.get("/users", auditAdmin("admin.users.list", "user"), asyncHandler(adminController.users));
router.get("/users/:userId/sessions", auditAdmin("admin.user.sessions.view", "user"), asyncHandler(adminController.userSessions));
router.patch("/users/:userId/status", auditAdmin("admin.user.status.update", "user"), asyncHandler(adminController.setUserStatus));
router.get("/disputes", auditAdmin("admin.disputes.list", "dispute"), asyncHandler(adminController.disputes));
router.get("/disputes/:disputeId", auditAdmin("admin.dispute.view", "dispute"), asyncHandler(adminController.disputeDetail));
router.patch("/disputes/:disputeId/review", auditAdmin("admin.dispute.review", "dispute"), asyncHandler(adminController.reviewDispute));
router.patch("/disputes/:disputeId/resolve", auditAdmin("admin.dispute.resolve", "dispute"), asyncHandler(adminController.resolveDispute));
router.get("/audit-logs", auditAdmin("admin.audit.list", "audit_log"), asyncHandler(adminController.auditLogs));
export default router;
