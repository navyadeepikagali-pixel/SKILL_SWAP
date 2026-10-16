import mongoose from "mongoose";
import { ConnectionRequest } from "../models/ConnectionRequest.js";
import { Conversation } from "../models/Conversation.js";
import { Message } from "../models/Message.js";
import { Notification } from "../models/Notification.js";
import {
  createConnection,
  createMessage,
  deleteMessage,
  editMessage,
  isConversationParticipant,
  markConversationRead
} from "../services/chatService.js";
import { failure, success } from "../utils/responses.js";

const validId = id => mongoose.isValidObjectId(id);
const userFields = "name profileImage";

function emit(io, room, event, payload) {
  io?.to(room).emit(event, payload);
}

function publicMessage(message) {
  return {
    _id: message._id,
    conversation: message.conversation,
    sender: message.sender,
    text: message.deletedAt ? "" : message.text,
    messageType: message.messageType,
    clientMessageId: message.clientMessageId,
    editedAt: message.editedAt,
    deletedAt: message.deletedAt,
    readBy: message.readBy,
    createdAt: message.createdAt,
    updatedAt: message.updatedAt
  };
}

export const chatController = {
  createConnection: async (req, res) => {
    const { tutorId, skillId } = req.body;
    if (!validId(tutorId) || !validId(skillId)) {
      return failure(res, 400, "Tutor and skill are required");
    }
    const result = await createConnection({ learnerId: req.user._id, tutorId, skillId });
    if (!result.created) await req.usageReservation?.finish("released");
    const io = req.app.get("io");
    if (result.created) {
      emit(io, `user:${tutorId}`, "connection:new", {
        connectionId: result.connection._id,
        conversationId: result.conversation._id
      });
      if (result.notification) emit(io, `user:${tutorId}`, "notification:new", result.notification);
      emit(io, `conversation:${result.conversation._id}`, "message:new", {
        message: await Message.findOne({ conversation: result.conversation._id, messageType: "initial_template" })
          .populate("sender", userFields)
      });
    }
    return success(res, result.created ? 201 : 200, result.created ? "Connection created" : "Existing conversation retrieved", {
      connectionId: result.connection._id,
      status: result.connection.status,
      conversationId: result.conversation._id
    });
  },

  listConnections: async (req, res) => {
    const connections = await ConnectionRequest.find({
      $or: [{ learner: req.user._id }, { tutor: req.user._id }]
    })
      .sort({ updatedAt: -1 })
      .populate("learner", userFields)
      .populate("tutor", userFields)
      .populate("skill", "name slug")
      .select("learner tutor skill conversation status createdAt updatedAt");
    return success(res, 200, "Connections retrieved", { connections });
  },

  updateConnection: async (req, res) => {
    const { id, action } = req.params;
    if (!validId(id)) return failure(res, 400, "Connection id is invalid");
    let connection = await ConnectionRequest.findById(id);
    if (!connection) return failure(res, 404, "Connection not found");
    if (String(connection.tutor) !== String(req.user._id)) return failure(res, 403, "Only the tutor can respond to this connection");
    if (connection.status === action) {
      return success(res, 200, `Connection ${action}`, { connection });
    }
    if (connection.status !== "pending") return failure(res, 409, "This connection has already been resolved");

    connection = await ConnectionRequest.findOneAndUpdate(
      { _id: id, tutor: req.user._id, status: "pending" },
      { $set: { status: action } },
      { new: true, runValidators: true }
    );
    if (!connection) {
      const latest = await ConnectionRequest.findById(id);
      if (latest?.status === action) return success(res, 200, `Connection ${action}`, { connection: latest });
      return failure(res, latest ? 409 : 404, latest ? "This connection has already been resolved" : "Connection not found");
    }
    const learner = connection.learner;
    const notification = await Notification.create({
      user: learner,
      actor: req.user._id,
      type: `connection_${action}`,
      message: action === "accepted" ? "Your connection request was accepted." : "Your connection request was declined.",
      resourceType: "conversation",
      resourceId: connection.conversation,
      dedupeKey: `connection:${connection._id}:${action}`
    });
    const io = req.app.get("io");
    emit(io, `conversation:${connection.conversation}`, "connection:update", {
      connectionId: connection._id,
      status: connection.status
    });
    emit(io, `user:${learner}`, "notification:new", notification);
    return success(res, 200, `Connection ${action}`, { connection });
  },

  listConversations: async (req, res) => {
    const conversations = await Conversation.find({ participants: req.user._id })
      .sort({ lastActivityAt: -1, _id: -1 })
      .populate("participants", userFields)
      .populate("skill", "name slug")
      .populate("connectionRequest", "learner tutor status")
      .populate({ path: "lastMessage", select: "text messageType sender createdAt editedAt deletedAt readBy" });
    return success(res, 200, "Conversations retrieved", {
      conversations: conversations.map(conversation => ({
        _id: conversation._id,
        participants: conversation.participants,
        skill: conversation.skill,
        connectionRequest: conversation.connectionRequest,
        lastMessage: conversation.lastMessage ? publicMessage(conversation.lastMessage) : null,
        lastMessagePreview: conversation.lastMessagePreview,
        lastActivityAt: conversation.lastActivityAt,
        lastMessageAt: conversation.lastMessageAt,
        unreadCount: conversation.unreadCounts.find(item => String(item.user) === String(req.user._id))?.count || 0
      }))
    });
  },

  getConversation: async (req, res) => {
    if (!validId(req.params.conversationId)) return failure(res, 400, "Conversation id is invalid");
    const conversation = await Conversation.findById(req.params.conversationId)
      .populate("participants", userFields)
      .populate("skill", "name slug")
      .populate({
        path: "connectionRequest",
        select: "learner tutor status",
        populate: [{ path: "learner", select: userFields }, { path: "tutor", select: userFields }]
      });
    if (!conversation || !isConversationParticipant(conversation, req.user._id)) {
      return failure(res, 404, "Conversation not found");
    }
    return success(res, 200, "Conversation retrieved", {
      conversation: {
        _id: conversation._id,
        participants: conversation.participants,
        skill: conversation.skill,
        connectionRequest: conversation.connectionRequest,
        lastActivityAt: conversation.lastActivityAt,
        unreadCount: conversation.unreadCounts.find(item => String(item.user) === String(req.user._id))?.count || 0
      }
    });
  },

  listMessages: async (req, res) => {
    const { conversationId } = req.params;
    if (!validId(conversationId)) return failure(res, 400, "Conversation id is invalid");
    const conversation = await Conversation.findById(conversationId).select("participants");
    if (!conversation || !isConversationParticipant(conversation, req.user._id)) {
      return failure(res, 404, "Conversation not found");
    }
    const limit = Number(req.query.limit ?? 40);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      return failure(res, 400, "Message page size must be between 1 and 100");
    }
    const query = { conversation: conversationId };
    if (req.query.before !== undefined) {
      const before = new Date(req.query.before);
      if (Number.isNaN(before.getTime())) return failure(res, 400, "Message cursor is invalid");
      if (req.query.beforeId !== undefined) {
        if (!validId(req.query.beforeId)) return failure(res, 400, "Message cursor is invalid");
        query.$or = [
          { createdAt: { $lt: before } },
          { createdAt: before, _id: { $lt: req.query.beforeId } }
        ];
      } else {
        query.createdAt = { $lt: before };
      }
    }
    const rows = await Message.find(query).sort({ createdAt: -1, _id: -1 }).limit(limit + 1)
      .populate("sender", userFields);
    const hasMore = rows.length > limit;
    const messages = rows.slice(0, limit).reverse().map(publicMessage);
    return success(res, 200, "Messages retrieved", {
      messages,
      pagination: {
        hasMore,
        nextBefore: messages[0]?.createdAt || null,
        nextBeforeId: messages[0]?._id || null
      }
    });
  },

  sendMessage: async (req, res) => {
    const { conversationId } = req.params;
    if (!validId(conversationId)) return failure(res, 400, "Conversation id is invalid");
    const result = await createMessage({
      conversationId,
      senderId: req.user._id,
      text: req.body.text,
      clientMessageId: req.body.clientMessageId
    });
    if (!result.duplicate) {
      emit(req.app.get("io"), `conversation:${conversationId}`, "message:new", {
        message: result.message
      });
      emit(req.app.get("io"), `user:${result.recipientId}`, "notification:new", result.notification);
    }
    return success(res, result.duplicate ? 200 : 201, "Message sent", {
      message: result.message,
      duplicate: result.duplicate
    });
  },

  editMessage: async (req, res) => {
    if (!validId(req.params.messageId)) return failure(res, 400, "Message id is invalid");
    const message = await editMessage({
      messageId: req.params.messageId,
      userId: req.user._id,
      text: req.body.text
    });
    const payload = { message };
    emit(req.app.get("io"), `conversation:${message.conversation}`, "message:edit", payload);
    return success(res, 200, "Message updated", payload);
  },

  deleteMessage: async (req, res) => {
    if (!validId(req.params.messageId)) return failure(res, 400, "Message id is invalid");
    const message = await deleteMessage({ messageId: req.params.messageId, userId: req.user._id });
    const payload = {
      message: {
        _id: message._id,
        conversation: message.conversation,
        sender: message.sender,
        text: "",
        messageType: message.messageType,
        deletedAt: message.deletedAt,
        createdAt: message.createdAt,
        updatedAt: message.updatedAt
      }
    };
    emit(req.app.get("io"), `conversation:${message.conversation}`, "message:delete", payload);
    return success(res, 200, "Message deleted", payload);
  },

  markRead: async (req, res) => {
    const { conversationId } = req.params;
    if (!validId(conversationId)) return failure(res, 400, "Conversation id is invalid");
    const readAt = await markConversationRead(conversationId, req.user._id);
    const payload = { conversationId, userId: req.user._id, readAt };
    emit(req.app.get("io"), `conversation:${conversationId}`, "message:read", payload);
    return success(res, 200, "Conversation marked as read", { readAt });
  }
};
