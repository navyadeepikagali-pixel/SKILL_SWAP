import mongoose from "mongoose";

const usageEventSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  action: { type: String, required: true, maxlength: 100 },
  idempotencyKey: { type: String, required: true, maxlength: 100 },
  policyVersion: { type: Number, required: true, min: 1 },
  windowStartedAt: { type: Date, required: true },
  status: { type: String, enum: ["reserved", "consumed", "released"], default: "reserved", required: true },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true });

usageEventSchema.index({ user: 1, action: 1, idempotencyKey: 1 }, { unique: true });
usageEventSchema.index({ user: 1, createdAt: -1 });

export const UsageEvent = mongoose.model("UsageEvent", usageEventSchema);
