import mongoose from "mongoose";

const registrationOtpSchema = new mongoose.Schema({
  email: { type: String, required: true, lowercase: true, trim: true, unique: true },
  name: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
  passwordHash: { type: String, required: true },
  otpHash: { type: String, required: true, select: false },
  expiresAt: { type: Date, required: true },
  resendAfter: { type: Date, required: true },
  attempts: { type: Number, default: 0, min: 0, max: 5 }
}, { timestamps: true });

registrationOtpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RegistrationOtp = mongoose.model("RegistrationOtp", registrationOtpSchema);
