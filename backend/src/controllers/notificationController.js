import mongoose from "mongoose";
import { Notification } from "../models/Notification.js";
import { failure, success } from "../utils/responses.js";

export const notificationController = {
  markRead: async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) return failure(res, 400, "Notification id is invalid");
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id, readAt: { $exists: false } },
      { $set: { readAt: new Date() } },
      { new: true }
    );
    if (!notification) {
      const existing = await Notification.exists({ _id: req.params.id, user: req.user._id });
      if (!existing) return failure(res, 404, "Notification not found");
      return success(res, 200, "Notification already read", { notification: null });
    }
    return success(res, 200, "Notification marked as read", { notification });
  },

  markAllRead: async (req, res) => {
    const result = await Notification.updateMany(
      { user: req.user._id, readAt: { $exists: false } },
      { $set: { readAt: new Date() } }
    );
    return success(res, 200, "Notifications marked as read", { updated: result.modifiedCount });
  }
};
