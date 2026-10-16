import jwt from "jsonwebtoken";
import { Conversation } from "./models/Conversation.js";
import { Message } from "./models/Message.js";
import { User } from "./models/User.js";
import { createMessage, deleteMessage, editMessage, markConversationRead } from "./services/chatService.js";
import { getAuthCookieName } from "./utils/authCookies.js";
import { activeAccountFilter } from "./utils/accountAccess.js";

const validId = value => typeof value === "string" && /^[a-f\d]{24}$/i.test(value);
const conversationRoom = id => `conversation:${id}`;
const userRoom = id => `user:${id}`;
const safeError = error => {
  if (Number.isInteger(error.status) && error.status >= 400 && error.status < 500) return error.message;
  console.error("Realtime chat operation failed:", error);
  return "The chat operation could not be completed";
};

function cookieValue(header, name) {
  for (const part of (header || "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

function acknowledge(callback, result) {
  if (typeof callback === "function") callback(result);
}

export function attachRealtime(io) {
  const roomPresence = new Map();
  const changeRoomPresence = (conversationId, userId, delta) => {
    let members = roomPresence.get(conversationId);
    if (!members) {
      members = new Map();
      roomPresence.set(conversationId, members);
    }
    const count = (members.get(userId) || 0) + delta;
    if (count <= 0) members.delete(userId);
    else members.set(userId, count);
    if (delta > 0 && count === 1) {
      io.to(conversationRoom(conversationId)).emit("user:online", { userId });
    } else if (delta < 0 && count === 0) {
      io.to(conversationRoom(conversationId)).emit("user:offline", { userId });
    }
    if (!members.size) roomPresence.delete(conversationId);
    return [...(roomPresence.get(conversationId)?.keys() || [])];
  };
  io.use(async (socket, next) => {
    try {
      const token = cookieValue(socket.handshake.headers.cookie, getAuthCookieName());
      if (!token) return next(new Error("Authentication required"));
      const payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ["HS256"] });
      const user = await User.findOne({
        _id: payload.sub,
        ...activeAccountFilter()
      }).select("_id name");
      if (!user) return next(new Error("Authentication required"));
      socket.data.user = { id: String(user._id), name: user.name };
      return next();
    } catch {
      return next(new Error("Authentication required"));
    }
  });

  io.on("connection", socket => {
    const userId = socket.data.user.id;
    socket.join(userRoom(userId));
    socket.data.joinedConversations = new Set();
    socket.data.messageTimes = [];

    const requireJoined = id => {
      if (!validId(id) || !socket.data.joinedConversations.has(id)) {
        throw Object.assign(new Error("Join this conversation before using chat events"), { status: 403 });
      }
    };

    socket.on("conversation:join", async (payload, callback) => {
      try {
        const conversationId = payload?.conversationId;
        if (!validId(conversationId)) throw Object.assign(new Error("Conversation id is invalid"), { status: 400 });
        const conversation = await Conversation.findById(conversationId).select("participants");
        if (!conversation || !conversation.participants.some(id => String(id) === userId)) {
          throw Object.assign(new Error("Conversation not found"), { status: 404 });
        }
        const alreadyJoined = socket.data.joinedConversations.has(conversationId);
        await socket.join(conversationRoom(conversationId));
        if (!alreadyJoined) {
          socket.data.joinedConversations.add(conversationId);
          changeRoomPresence(conversationId, userId, 1);
        }
        const onlineUsers = [...(roomPresence.get(conversationId)?.keys() || [])]
          .filter(onlineUserId => onlineUserId !== userId);
        acknowledge(callback, { success: true, data: { conversationId, onlineUsers } });
      } catch (error) {
        acknowledge(callback, { success: false, message: safeError(error) });
      }
    });

    socket.on("conversation:leave", async (payload, callback) => {
      const conversationId = payload?.conversationId;
      try {
        requireJoined(conversationId);
        changeRoomPresence(conversationId, userId, -1);
        await socket.leave(conversationRoom(conversationId));
        socket.data.joinedConversations.delete(conversationId);
        acknowledge(callback, { success: true, data: { conversationId } });
      } catch (error) {
        acknowledge(callback, { success: false, message: safeError(error) });
      }
    });

    socket.on("message:send", async (payload, callback) => {
      try {
        requireJoined(payload?.conversationId);
        const now = Date.now();
        socket.data.messageTimes = socket.data.messageTimes.filter(time => now - time < 60_000);
        if (socket.data.messageTimes.length >= 30) {
          throw Object.assign(new Error("You are sending messages too quickly"), { status: 429 });
        }
        socket.data.messageTimes.push(now);
        const result = await createMessage({
          conversationId: payload.conversationId,
          senderId: userId,
          text: payload.text,
          clientMessageId: payload.clientMessageId
        });
        if (!result.duplicate) {
          io.to(conversationRoom(payload.conversationId)).emit("message:new", { message: result.message });
          io.to(userRoom(result.recipientId)).emit("notification:new", result.notification);
        }
        acknowledge(callback, {
          success: true,
          data: { message: result.message, duplicate: result.duplicate }
        });
      } catch (error) {
        acknowledge(callback, { success: false, message: safeError(error) });
      }
    });

    socket.on("message:edit", async (payload, callback) => {
      try {
        if (!validId(payload?.messageId)) throw Object.assign(new Error("Message id is invalid"), { status: 400 });
        const existing = await Message.findById(payload.messageId).select("conversation");
        if (!existing) throw Object.assign(new Error("Message not found"), { status: 404 });
        requireJoined(String(existing.conversation));
        const message = await editMessage({
          messageId: payload.messageId,
          userId,
          text: payload.text
        });
        io.to(conversationRoom(String(message.conversation))).emit("message:edit", { message });
        acknowledge(callback, { success: true, data: { message } });
      } catch (error) {
        acknowledge(callback, { success: false, message: safeError(error) });
      }
    });

    socket.on("message:delete", async (payload, callback) => {
      try {
        if (!validId(payload?.messageId)) throw Object.assign(new Error("Message id is invalid"), { status: 400 });
        const existing = await Message.findById(payload.messageId).select("conversation");
        if (!existing) throw Object.assign(new Error("Message not found"), { status: 404 });
        requireJoined(String(existing.conversation));
        const message = await deleteMessage({ messageId: payload.messageId, userId });
        const safeMessage = {
          _id: message._id,
          conversation: message.conversation,
          sender: message.sender,
          text: "",
          messageType: message.messageType,
          deletedAt: message.deletedAt,
          createdAt: message.createdAt,
          updatedAt: message.updatedAt
        };
        io.to(conversationRoom(String(message.conversation))).emit("message:delete", { message: safeMessage });
        acknowledge(callback, { success: true, data: { message: safeMessage } });
      } catch (error) {
        acknowledge(callback, { success: false, message: safeError(error) });
      }
    });

    socket.on("message:read", async (payload, callback) => {
      try {
        requireJoined(payload?.conversationId);
        const readAt = await markConversationRead(payload.conversationId, userId);
        const data = { conversationId: payload.conversationId, userId, readAt };
        io.to(conversationRoom(payload.conversationId)).emit("message:read", data);
        acknowledge(callback, { success: true, data });
      } catch (error) {
        acknowledge(callback, { success: false, message: safeError(error) });
      }
    });

    for (const event of ["typing:start", "typing:stop"]) {
      socket.on(event, (payload, callback) => {
        try {
          requireJoined(payload?.conversationId);
          socket.to(conversationRoom(payload.conversationId)).emit(event, {
            conversationId: payload.conversationId,
            userId,
            name: socket.data.user.name
          });
          acknowledge(callback, { success: true });
        } catch (error) {
          acknowledge(callback, { success: false, message: safeError(error) });
        }
      });
    }

    socket.on("disconnect", () => {
      for (const conversationId of socket.data.joinedConversations) {
        changeRoomPresence(conversationId, userId, -1);
      }
    });
  });
}
