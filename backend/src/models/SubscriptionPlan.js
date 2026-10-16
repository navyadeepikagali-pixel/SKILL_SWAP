import mongoose from "mongoose";

const subscriptionPlanSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, unique: true, maxlength: 100 },
  description: { type: String, default: "", maxlength: 1000 },
  price: { type: Number, default: 0, min: 0 },
  currency: { type: String, default: "USD", uppercase: true, maxlength: 3 },
  usageLimit: { type: Number, default: 5, min: 0 },
  billingPeriod: { type: String, enum: ["none", "monthly", "yearly"], default: "none" },
  benefits: [{ type: String, maxlength: 200 }],
  includedFeatures: [{ type: String, trim: true, maxlength: 100 }],
  restrictedFeatures: [{ type: String, trim: true, maxlength: 100 }],
  accessRestrictions: [{ type: String, trim: true, maxlength: 200 }],
  cooldownHours: { type: Number, default: 12, min: 1, max: 720 },
  displayOrder: { type: Number, default: 0, min: 0, max: 10000 },
  isFree: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true, index: true },
  paymentProviderPriceId: { type: String, default: "" }
}, { timestamps: true });

subscriptionPlanSchema.index({ isActive: 1, price: 1 });

export const SubscriptionPlan = mongoose.model("SubscriptionPlan", subscriptionPlanSchema);
