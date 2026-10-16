import mongoose from "mongoose";

const subscriptionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  plan: { type: mongoose.Schema.Types.ObjectId, ref: "SubscriptionPlan", required: true },
  status: { type: String, enum: ["active", "cancelled", "expired"], required: true, index: true },
  startsAt: { type: Date, required: true },
  endsAt: { type: Date, required: true, index: true },
  billingPeriod: { type: String, enum: ["monthly", "yearly"], required: true },
  provider: { type: String, maxlength: 80 },
  providerReference: { type: String, maxlength: 200 },
  verifiedPayment: { type: mongoose.Schema.Types.ObjectId, ref: "PaymentRecord", default: null },
  cancelledAt: Date,
  cancellationReason: { type: String, default: "", maxlength: 500 }
}, { timestamps: true });

subscriptionSchema.index({ user: 1, status: 1, endsAt: -1 });
subscriptionSchema.index({ provider: 1, providerReference: 1 }, { sparse: true });

export const Subscription = mongoose.model("Subscription", subscriptionSchema);
