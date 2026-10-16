import mongoose from "mongoose";

const loginOtpSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },
  otpHash: { type: String, required: true, select: false },
  expiresAt: { type: Date, required: true },
  resendAfter: { type: Date, required: true },
  attempts: { type: Number, default: 0, min: 0, max: 5 }
}, { timestamps: true });

loginOtpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const LoginOtp = mongoose.model("LoginOtp", loginOtpSchema);
