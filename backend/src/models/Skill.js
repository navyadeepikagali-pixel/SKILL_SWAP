import mongoose from "mongoose";

const skillSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 100, index: true },
  slug: { type: String, required: true, lowercase: true, trim: true, maxlength: 120 },
  description: { type: String, default: "", maxlength: 1500 },
  category: { type: mongoose.Schema.Types.ObjectId, ref: "Category", required: true, index: true },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
  proficiency: { type: String, enum: ["beginner", "intermediate", "advanced", "expert"], default: "beginner" },
  direction: { type: String, enum: ["teach", "learn"] },
  isActive: { type: Boolean, default: true, index: true }
}, { timestamps: true });

skillSchema.index({ name: "text", description: "text" });
skillSchema.index({ owner: 1, direction: 1, category: 1 });
skillSchema.index({ category: 1, slug: 1 }, { unique: true });
skillSchema.index({ isActive: 1, category: 1, slug: 1 });

skillSchema.pre("validate", function normalizeSkill(next) {
  if (this.isModified("name") || !this.slug) {
    this.name = this.name.trim().replace(/\s+/g, " ");
    this.slug = this.name.toLowerCase()
      .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }
  next();
});

export const Skill = mongoose.model("Skill", skillSchema);
