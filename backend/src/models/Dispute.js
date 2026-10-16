import mongoose from "mongoose";

const evidenceSchema = new mongoose.Schema({
  type: { type: String, enum: ["message", "session", "other"], required: true },
  label: { type: String, trim: true, maxlength: 120, required: true },
  reference: { type: String, trim: true, maxlength: 200, default: "" }
}, { _id: false });

const historySchema = new mongoose.Schema({
  status: { type: String, enum: ["OPEN", "UNDER_REVIEW", "RESOLVED", "REJECTED"], required: true },
  actor: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  note: { type: String, maxlength: 2000, default: "" },
  at: { type: Date, default: Date.now, required: true }
}, { _id: false });

const disputeSchema = new mongoose.Schema({
  session: { type: mongoose.Schema.Types.ObjectId, ref: "Session", required: true, unique: true },
  openedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  tutor: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  learner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  reason: { type: String, required: true, trim: true, minlength: 3, maxlength: 160 },
  description: { type: String, required: true, trim: true, minlength: 3, maxlength: 3000 },
  evidence: { type: [evidenceSchema], default: [], validate: value => value.length <= 5 },
  status: { type: String, enum: ["OPEN", "UNDER_REVIEW", "RESOLVED", "REJECTED"], default: "OPEN", required: true, index: true },
  history: { type: [historySchema], default: [] },
  internalNotes: [{ type: String, maxlength: 2000 }],
  resolutionSummary: { type: String, default: "", maxlength: 2000 },
  resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  resolvedAt: Date,
  adjustment: {
    reference: { type: String, default: "", maxlength: 180 },
    transaction: { type: mongoose.Schema.Types.ObjectId, ref: "CreditTransaction", default: null }
  }
}, { timestamps: true });

disputeSchema.index({ status: 1, createdAt: -1 });
disputeSchema.index({ tutor: 1, createdAt: -1 });
disputeSchema.index({ learner: 1, createdAt: -1 });

export const Dispute = mongoose.model("Dispute", disputeSchema);
