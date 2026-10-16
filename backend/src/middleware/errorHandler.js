import mongoose from "mongoose";

export function errorHandler(error, _req, res, _next) {
  if (res.headersSent) return;
  if (error instanceof mongoose.Error.ValidationError || error instanceof mongoose.Error.CastError) {
    return res.status(400).json({ success: false, message: "Submitted data is invalid" });
  }
  if (error.code === 11000) {
    return res.status(409).json({ success: false, message: "A record with that value already exists" });
  }
  if (error.code === "EMAIL_NOT_CONFIGURED" || error.code === "EMAIL_DELIVERY_FAILED") {
    return res.status(503).json({ success: false, message: error.message });
  }
  if (Number.isInteger(error.status) && error.status >= 400 && error.status < 500) {
    return res.status(error.status).json({
      success: false,
      message: error.message || "Request could not be completed"
    });
  }

  console.error("Unhandled API error:", error);
  return res.status(500).json({ success: false, message: "Internal server error" });
}
