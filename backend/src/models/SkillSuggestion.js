import mongoose from "mongoose";

const skillSuggestionSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  normalizedName: { type: String, required: true, lowercase: true, trim: true },
  category: { type: mongoose.Schema.Types.ObjectId, ref: "Category", required: true },
  suggestedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  description: { type: String, default: "", maxlength: 1000 },
  status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending", index: true }
}, { timestamps: true });

skillSuggestionSchema.index({ category: 1, normalizedName: 1, status: 1 });

export const SkillSuggestion = mongoose.model("SkillSuggestion", skillSuggestionSchema);
