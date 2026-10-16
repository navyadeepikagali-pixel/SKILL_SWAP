import { finishUsage, recordUsage } from "../services/usageService.js";

export function applyUsagePolicy(action) {
  return async (req, res, next) => {
    try {
      const key = req.get("Idempotency-Key");
      const reservation = await recordUsage(req.user._id, action, key);
      if (reservation.skipped) return next();
      if (reservation.blocked) {
        if (reservation.notification) {
          req.app.get("io")?.to(`user:${reservation.notification.user}`).emit("notification:new", reservation.notification);
        }
        return res.status(429).json({
          success: false,
          code: "USAGE_LIMIT_REACHED",
          message: reservation.notification?.message || reservation.message,
          data: {
            action,
            usage: reservation.usage,
            allowance: reservation.limit,
            cooldownStartedAt: reservation.cooldownStartedAt,
            cooldownUntil: reservation.cooldownUntil,
            cooldownHours: reservation.cooldownHours,
            upgradePath: "/plans"
          }
        });
      }
      req.usageReservation = reservation.event ? {
        finish: outcome => finishUsage(reservation.event._id, outcome, req.app.get("io"))
      } : null;
      if (req.usageReservation) {
        const sendJson = res.json.bind(res);
        let finalizing;
        res.json = body => {
          if (finalizing) return finalizing;
          const outcome = res.statusCode >= 200 && res.statusCode < 400 ? "consumed" : "released";
          finalizing = req.usageReservation.finish(outcome)
            .catch(error => {
              console.error("Failed to finalize usage reservation:", error);
            })
            .then(() => sendJson(body));
          return finalizing;
        };
      }
      return next();
    } catch (error) {
      if (error.code === "USAGE_LIMIT_REACHED") {
        return res.status(429).json({
          success: false,
          code: error.code,
          message: error.message,
          data: {
            action,
            usage: error.usage,
            allowance: error.limit,
            cooldownStartedAt: error.cooldownStartedAt,
            cooldownUntil: error.cooldownUntil,
            cooldownHours: error.cooldownHours,
            upgradePath: "/plans"
          }
        });
      }
      return next(error);
    }
  };
}
