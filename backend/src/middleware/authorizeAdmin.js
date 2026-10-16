import { failure } from "../utils/responses.js";
import { recordAudit } from "../services/auditService.js";

export async function authorizeAdmin(req, res, next) {
  if (req.user?.accountType !== "admin") {
    try {
      await recordAudit({
        actor: req.user?._id,
        action: "authorization.denied",
        resourceType: "admin_endpoint",
        resourceId: req.originalUrl,
        outcome: "denied",
        metadata: { method: req.method }
      });
    } catch (error) {
      return next(error);
    }
    return failure(res, 403, "Administrator access required");
  }
  return next();
}
