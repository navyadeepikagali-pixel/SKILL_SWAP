import mongoose from "mongoose";

const messageSchema = new mongoose.Schema({
  conversation: { type: mongoose.Schema.Types.ObjectId, ref: "Conversation", required: true },
  sender: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  text: { type: String, required: true, trim: true, minlength: 1, maxlength: 4000 },
  messageType: { type: String, enum: ["text", "initial_template"], default: "text", required: true },
  clientMessageId: { type: String, maxlength: 100 },
  editedAt: Date,
  deletedAt: Date,
  readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }]
}, { timestamps: true });

messageSchema.index({ conversation: 1, createdAt: 1 });
messageSchema.index(
  { conversation: 1, sender: 1, clientMessageId: 1 },
  { unique: true, partialFilterExpression: { clientMessageId: { $type: "string" } } }
);
messageSchema.index(
  { conversation: 1 },
  { unique: true, partialFilterExpression: { messageType: "initial_template" } }
);

export const Message = mongoose.model("Message", messageSchema);
