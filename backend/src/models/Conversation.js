import mongoose from "mongoose";

const conversationSchema = new mongoose.Schema({
  participants: {
    type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }],
    required: true,
    validate: {
      validator: participants => participants.length === 2 &&
        String(participants[0]) !== String(participants[1]),
      message: "A direct conversation must have exactly two different participants"
    }
  },
  connectionRequest: { type: mongoose.Schema.Types.ObjectId, ref: "ConnectionRequest", unique: true, sparse: true },
  skill: { type: mongoose.Schema.Types.ObjectId, ref: "Skill", required: true },
  lastMessage: { type: mongoose.Schema.Types.ObjectId, ref: "Message" },
  lastMessagePreview: { type: String, default: "", maxlength: 160 },
  unreadCounts: [{
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    count: { type: Number, default: 0, min: 0 }
  }],
  title: { type: String, default: "", maxlength: 120 },
  isGroup: { type: Boolean, default: false, immutable: true },
  lastMessageAt: { type: Date, default: Date.now },
  lastActivityAt: { type: Date, default: Date.now }
}, { timestamps: true });

conversationSchema.index({ participants: 1, lastMessageAt: -1 });
conversationSchema.index({ participants: 1, lastActivityAt: -1 });

export const Conversation = mongoose.model("Conversation", conversationSchema);
