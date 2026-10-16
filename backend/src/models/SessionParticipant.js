import mongoose from "mongoose";

const sessionParticipantSchema = new mongoose.Schema({
  session: { type: mongoose.Schema.Types.ObjectId, ref: "Session", required: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  status: { type: String, enum: ["invited", "pending", "accepted", "rejected", "cancelled", "completed"], default: "pending" },
  joinedAt: Date,
  completionConfirmedAt: Date
}, { timestamps: true });

sessionParticipantSchema.index({ session: 1, user: 1 }, { unique: true });
sessionParticipantSchema.index({ user: 1, status: 1 });

export const SessionParticipant = mongoose.model("SessionParticipant", sessionParticipantSchema);
