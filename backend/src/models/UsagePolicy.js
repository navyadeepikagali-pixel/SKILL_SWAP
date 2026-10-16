import mongoose from "mongoose";

const usagePolicySchema = new mongoose.Schema({
  key: { type: String, enum: ["default"], default: "default", unique: true },
  activeActions: {
    type: [{ type: String, trim: true, lowercase: true, maxlength: 100 }],
    default: ["tutor_search", "connection_request"],
    validate: value => value.length <= 20
  },
  dailyLimit: { type: Number, default: 5, min: 1, max: 10000 },
  cooldownHours: { type: Number, default: 12, min: 1, max: 720 },
  version: { type: Number, default: 1, min: 1 }
}, { timestamps: true });

export const UsagePolicy = mongoose.model("UsagePolicy", usagePolicySchema);
