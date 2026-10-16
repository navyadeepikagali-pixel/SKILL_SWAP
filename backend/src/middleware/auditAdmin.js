import { AuditLog } from "../models/AuditLog.js";

export function auditAdmin(action, resourceType) {
  return (req, res, next) => {
    const sendJson = res.json.bind(res);
    let recorded = false;
    res.json = body => {
      if (recorded) return sendJson(body);
      recorded = true;
      const statusCode = res.statusCode;
      const outcome = statusCode >= 400 || body?.success === false ? "failure" : "success";
      const resourceId = req.params.id || req.params.disputeId || req.params.userId ||
        req.params.sessionId || req.params.slug || "";
      return AuditLog.create({
        actor: req.user?._id || null,
        action,
        resourceType,
        resourceId: String(resourceId).slice(0, 120),
        outcome,
        metadata: {
          method: req.method,
          path: req.route?.path || req.path,
          statusCode,
          ...(req.method === "GET" ? {} : { changedFields: Object.keys(req.body || {}).slice(0, 30) })
        }
      }).then(() => sendJson(body)).catch(next);
    };
    return next();
  };
}
