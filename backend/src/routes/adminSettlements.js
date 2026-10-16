import { Router } from "express";
import { authenticate } from "../middleware/authenticate.js";
import { authorizeAdmin } from "../middleware/authorizeAdmin.js";
import { listSettlementAudit, reconcileSessionSettlement } from "../services/walletService.js";
import { success } from "../utils/responses.js";
import { auditAdmin } from "../middleware/auditAdmin.js";

const asyncHandler = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const router = Router();

router.use(authenticate, authorizeAdmin);
router.get("/", auditAdmin("admin.settlements.list", "settlement"), asyncHandler(async (req, res) =>
  success(res, 200, "Settlement audit retrieved", await listSettlementAudit({ query: req.query }))));
router.get("/:sessionId/reconciliation", auditAdmin("admin.settlement.reconcile", "session"), asyncHandler(async (req, res) =>
  success(res, 200, "Settlement reconciliation retrieved", {
    reconciliation: await reconcileSessionSettlement(req.params.sessionId)
  })));

export default router;
