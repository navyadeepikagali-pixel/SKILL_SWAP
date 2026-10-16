import mongoose from "mongoose";

const categorySchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, unique: true, maxlength: 100 },
  slug: { type: String, required: true, lowercase: true, trim: true, unique: true, maxlength: 120 },
  description: { type: String, default: "", maxlength: 1000 },
  parent: { type: mongoose.Schema.Types.ObjectId, ref: "Category", default: null },
  isActive: { type: Boolean, default: true, index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
}, { timestamps: true });

categorySchema.index({ parent: 1, name: 1 });

categorySchema.pre("validate", function normalizeCategory(next) {
  if (this.isModified("name") || !this.slug) {
    this.slug = this.name.trim().toLowerCase()
      .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }
  next();
});

export const Category = mongoose.model("Category", categorySchema);
