import mongoose from "mongoose";

const connectionRequestSchema = new mongoose.Schema({
  learner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  tutor: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  skill: { type: mongoose.Schema.Types.ObjectId, ref: "Skill", required: true },
  conversation: { type: mongoose.Schema.Types.ObjectId, ref: "Conversation" },
  initialMessageId: { type: mongoose.Schema.Types.ObjectId, ref: "Message" },
  status: { type: String, enum: ["pending", "accepted", "rejected", "cancelled"], default: "pending", index: true }
}, { timestamps: true });

connectionRequestSchema.index({ learner: 1, tutor: 1, skill: 1 }, { unique: true });
connectionRequestSchema.index({ tutor: 1, status: 1, updatedAt: -1 });

export const ConnectionRequest = mongoose.model("ConnectionRequest", connectionRequestSchema);
