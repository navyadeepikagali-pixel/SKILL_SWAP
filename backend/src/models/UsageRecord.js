import mongoose from "mongoose";

const usageRecordSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  action: { type: String, required: true, maxlength: 100 },
  plan: { type: mongoose.Schema.Types.ObjectId, ref: "SubscriptionPlan", default: null },
  windowStartedAt: { type: Date, required: true },
  count: { type: Number, default: 0, min: 0, required: true },
  cooldownStartedAt: Date,
  cooldownUntil: Date,
  cooldownDurationHours: { type: Number, min: 0, max: 720 },
  cooldownTriggeredBy: { type: String, maxlength: 100 },
  policyVersion: { type: Number, default: 1, min: 1, required: true }
}, { timestamps: true });

usageRecordSchema.index({ user: 1, action: 1, windowStartedAt: 1 }, { unique: true });
usageRecordSchema.index({ cooldownUntil: 1 }, { sparse: true });

export const UsageRecord = mongoose.model("UsageRecord", usageRecordSchema);
