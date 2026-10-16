import mongoose from "mongoose";
import { sessionCreditPrice } from "../config/credits.js";

const sessionSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 160 },
  skill: { type: mongoose.Schema.Types.ObjectId, ref: "Skill", required: true },
  category: { type: mongoose.Schema.Types.ObjectId, ref: "Category", required: true },
  tutor: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  learner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  conversation: { type: mongoose.Schema.Types.ObjectId, ref: "Conversation", required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  description: { type: String, default: "", maxlength: 2000 },
  startsAt: { type: Date, required: true },
  endsAt: { type: Date, required: true },
  timezone: { type: String, required: true, maxlength: 80 },
  durationMinutes: { type: Number, required: true, enum: [30, 45, 60] },
  creditPrice: { type: Number, required: true, min: 1, default: sessionCreditPrice },
  format: { type: String, enum: ["online", "in-person"], default: "online" },
  meetingDetails: { type: String, default: "", maxlength: 1000 },
  location: { type: String, default: "", maxlength: 300 },
  kind: { type: String, enum: ["one-to-one", "group", "practice", "workshop"], default: "one-to-one" },
  capacity: { type: Number, default: 1, min: 1, max: 100 },
  language: { type: String, default: "English", maxlength: 60 },
  status: {
    type: String,
    enum: ["pending", "scheduled", "completed", "cancelled", "rejected", "disputed"],
    default: "pending",
    index: true
  },
  idempotencyKey: { type: String, maxlength: 100 },
  acceptedAt: Date,
  rejectedAt: Date,
  cancelledAt: Date,
  cancellationReason: { type: String, default: "", maxlength: 500 },
  rescheduleProposal: {
    startsAt: Date,
    endsAt: Date,
    timezone: String,
    durationMinutes: Number,
    proposedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    proposedAt: Date,
    status: { type: String, enum: ["pending", "accepted", "rejected"] },
    idempotencyKey: String
  },
  completionConfirmedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  completion: {
    tutorRequestedAt: Date,
    learnerConfirmedAt: Date,
    dispute: {
      raisedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      reason: { type: String, maxlength: 1000 },
      raisedAt: Date
    }
  },
  settlement: {
    status: {
      type: String,
      enum: ["not_started", "pending_confirmation", "processing", "settled", "failed"],
      default: "not_started",
      index: true
    },
    pricePerLearner: { type: Number, min: 1 },
    totalCredits: { type: Number, min: 0, default: 0 },
    availableBalance: { type: Number, min: 0 },
    reference: { type: String, maxlength: 150 },
    idempotencyKey: { type: String, maxlength: 100 },
    attemptedAt: Date,
    settledAt: Date,
    failureCode: { type: String, maxlength: 80 },
    failureReason: { type: String, maxlength: 300 }
  },
  completedAt: Date
}, { timestamps: true });

sessionSchema.index({ tutor: 1, startsAt: 1, status: 1, endsAt: 1 });
sessionSchema.index({ learner: 1, startsAt: 1, status: 1, endsAt: 1 });
sessionSchema.index({ conversation: 1, startsAt: 1 });
sessionSchema.index({ tutor: 1, idempotencyKey: 1 }, {
  unique: true,
  partialFilterExpression: { idempotencyKey: { $type: "string" } }
});
sessionSchema.index({ "settlement.status": 1, updatedAt: -1 });

sessionSchema.pre("validate", function validateSessionRange(next) {
  if (this.tutor && this.learner && String(this.tutor) === String(this.learner)) {
    this.invalidate("learner", "Tutor and learner must be different users");
  }
  if (this.startsAt && this.endsAt && this.endsAt <= this.startsAt) {
    this.invalidate("endsAt", "Session end must be later than its start");
  }
  if (this.durationMinutes && this.startsAt && this.endsAt &&
    this.endsAt.getTime() - this.startsAt.getTime() !== this.durationMinutes * 60_000) {
    this.invalidate("endsAt", "Session duration must match its start and end");
  }
  next();
});

export const Session = mongoose.model("Session", sessionSchema);
