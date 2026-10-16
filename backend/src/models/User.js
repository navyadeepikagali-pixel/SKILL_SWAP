import mongoose from "mongoose";

const { Schema, model } = mongoose;

const timeSlotSchema = new Schema({
  dayOfWeek: { type: Number, min: 0, max: 6, required: true },
  startTime: { type: String, match: /^([01]\d|2[0-3]):[0-5]\d$/, required: true },
  endTime: { type: String, match: /^([01]\d|2[0-3]):[0-5]\d$/, required: true },
  timezone: { type: String, default: "UTC", maxlength: 80 }
}, { _id: false });

const userSchema = new Schema({
  name: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    maxlength: 254,
    index: true
  },
  passwordHash: { type: String, required: true, select: false },
  isEmailVerified: { type: Boolean, default: false, required: true },
  emailVerificationRequired: { type: Boolean, default: true, required: true },
  accountStatus: {
    type: String,
    enum: ["pending", "active", "suspended", "deleted"],
    default: "pending",
    required: true
  },
  profileImage: { type: String, default: "", maxlength: 2048 },
  bio: { type: String, default: "", maxlength: 1000 },
  location: { type: String, default: "", trim: true, maxlength: 120 },
  experienceLevel: { type: String, enum: ["beginner", "intermediate", "advanced", "expert"], default: "beginner" },
  preferredLearningMode: { type: String, enum: ["online", "in-person", "either"], default: "either" },
  isProfilePublic: { type: Boolean, default: true, index: true },
  skillsToTeach: [{ type: Schema.Types.ObjectId, ref: "Skill" }],
  skillsToLearn: [{ type: Schema.Types.ObjectId, ref: "Skill" }],
  interests: [{ type: String, trim: true, maxlength: 80 }],
  availableTimeSlots: { type: [timeSlotSchema], default: [] },
  unavailableTimeRanges: [{
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    reason: { type: String, default: "", maxlength: 160 }
  }],
  bookingLockVersion: { type: Number, default: 0, select: false },
  languages: [{ type: String, trim: true, maxlength: 60 }],
  creditBalance: { type: Number, default: 0, min: 0, required: true },
  permissions: [{ type: String, trim: true }],
  accountType: { type: String, enum: ["user", "admin"], default: "user", required: true },
  lastLoginAt: Date
}, {
  timestamps: true,
  toJSON: {
    transform(_doc, ret) {
      delete ret.passwordHash;
      delete ret.__v;
      return ret;
    }
  }
});

userSchema.index({ name: "text", bio: "text" });
userSchema.index({ accountStatus: 1, isEmailVerified: 1, isProfilePublic: 1 });
userSchema.index({ skillsToTeach: 1 });
userSchema.index({ languages: 1 });
userSchema.index({ preferredLearningMode: 1 });

export const User = model("User", userSchema);
