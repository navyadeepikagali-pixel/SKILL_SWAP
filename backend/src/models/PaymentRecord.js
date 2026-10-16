import mongoose from "mongoose";

const paymentRecordSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  plan: { type: mongoose.Schema.Types.ObjectId, ref: "SubscriptionPlan", required: true },
  amount: { type: Number, required: true, min: 0 },
  currency: { type: String, required: true, uppercase: true, minlength: 3, maxlength: 3 },
  status: {
    type: String,
    enum: ["pending", "paid", "failed", "refunded", "demo_unpaid"],
    required: true,
    index: true
  },
  provider: { type: String, maxlength: 80 },
  providerReference: { type: String, maxlength: 200 },
  idempotencyKey: { type: String, required: true, maxlength: 100 },
  verifiedAt: Date,
  failureReason: { type: String, default: "", maxlength: 500 },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true });

paymentRecordSchema.index({ user: 1, idempotencyKey: 1 }, { unique: true });
paymentRecordSchema.index({ provider: 1, providerReference: 1 }, { unique: true, sparse: true });

export const PaymentRecord = mongoose.model("PaymentRecord", paymentRecordSchema);
