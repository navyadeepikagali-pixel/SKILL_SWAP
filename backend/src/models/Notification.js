import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  actor: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  type: { type: String, required: true, maxlength: 80 },
  message: { type: String, required: true, maxlength: 500 },
  resourceType: { type: String, maxlength: 80 },
  resourceId: mongoose.Schema.Types.ObjectId,
  dedupeKey: { type: String, maxlength: 200 },
  readAt: Date
}, { timestamps: true });

notificationSchema.index({ user: 1, createdAt: -1 });
notificationSchema.index({ dedupeKey: 1 }, { unique: true, sparse: true });

export const Notification = mongoose.model("Notification", notificationSchema);
