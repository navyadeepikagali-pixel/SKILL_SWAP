import mongoose from "mongoose";
import { ConnectionRequest } from "../models/ConnectionRequest.js";
import { Conversation } from "../models/Conversation.js";
import { Message } from "../models/Message.js";
import { Notification } from "../models/Notification.js";
import { Skill } from "../models/Skill.js";
import { User } from "../models/User.js";
import { activeAccountFilter } from "../utils/accountAccess.js";

const fail = (status, message) => Object.assign(new Error(message), { status });

export function isConversationParticipant(conversation, userId) {
  return conversation.participants.some(participant =>
    String(participant?._id || participant) === String(userId));
}

export async function createConnection({ learnerId, tutorId, skillId }) {
  if (String(learnerId) === String(tutorId)) throw fail(400, "You cannot connect with yourself");

  const [tutor, skill] = await Promise.all([
    User.findOne({
      _id: tutorId,
      ...activeAccountFilter(),
      isProfilePublic: true,
      skillsToTeach: skillId
    }).select("_id name"),
    Skill.findOne({ _id: skillId, isActive: true }).select("_id name")
  ]);
  if (!tutor) throw fail(404, "Tutor is unavailable");
  if (!skill) throw fail(400, "Selected skill is unavailable");

  const relationship = { learner: learnerId, tutor: tutor._id, skill: skill._id };
  const existing = await ConnectionRequest.findOne(relationship).select("_id conversation status");
  if (existing?.conversation) {
    return {
      connection: existing,
      conversation: await Conversation.findById(existing.conversation).select("_id"),
      created: false
    };
  }

  const session = await mongoose.startSession();
  let connection;
  let conversation;
  let notification;
  let createdConversation = false;
  let createdConnection = false;
  try {
    await session.withTransaction(async () => {
      connection = await ConnectionRequest.findOne(relationship).session(session);
      if (!connection) {
        [connection] = await ConnectionRequest.create([relationship], { session });
        createdConnection = true;
      }

      conversation = await Conversation.findOne({ connectionRequest: connection._id }).session(session);
      if (!conversation) {
        createdConversation = true;
        [conversation] = await Conversation.create([{
          participants: [learnerId, tutor._id],
          connectionRequest: connection._id,
          skill: skill._id,
          title: skill.name,
          unreadCounts: [{ user: learnerId, count: 0 }, { user: tutor._id, count: 1 }]
        }], { session });

        const text = `Hi! I'm ${(await User.findById(learnerId).select("name").session(session)).name}. I'm interested in learning ${skill.name} from you. Could we connect for a learning session? Please let me know your available time slots. Thank you!`;
        const [initialMessage] = await Message.create([{
          conversation: conversation._id,
          sender: learnerId,
          text,
          messageType: "initial_template",
          clientMessageId: `connection:${connection._id}`,
          readBy: [learnerId]
        }], { session });
        conversation.lastMessage = initialMessage._id;
        conversation.lastMessagePreview = text.slice(0, 160);
        conversation.lastMessageAt = initialMessage.createdAt;
        conversation.lastActivityAt = initialMessage.createdAt;
        await conversation.save({ session });
      }

      connection.conversation = conversation._id;
      await connection.save({ session });
      if (createdConnection) {
        [notification] = await Notification.create([{
          user: tutor._id,
          actor: learnerId,
          type: "connection_request",
          message: "A learner wants to connect with you.",
          resourceType: "conversation",
          resourceId: conversation._id,
          dedupeKey: `connection:${connection._id}:request`
        }], { session });
      }
    });
  } catch (error) {
    if (error.code === 11000) {
      const raced = await ConnectionRequest.findOne(relationship).select("_id conversation status");
      if (raced?.conversation) {
        return {
          connection: raced,
          conversation: await Conversation.findById(raced.conversation).select("_id"),
          created: false
        };
      }
    }
    throw error;
  } finally {
    await session.endSession();
  }
  return { connection, conversation, notification, created: createdConversation };
}

export async function createMessage({
  conversationId,
  senderId,
  text,
  clientMessageId,
  messageType = "text"
}) {
  if (typeof text !== "string" || !text.trim() || text.trim().length > 4000) {
    throw fail(400, "Message must contain between 1 and 4000 characters");
  }
  if (typeof clientMessageId !== "string" || !/^[A-Za-z0-9:_-]{1,100}$/.test(clientMessageId)) {
    throw fail(400, "A valid clientMessageId is required");
  }
  const session = await mongoose.startSession();
  let saved;
  let notification;
  let recipientId;
  let duplicate = false;
  try {
    await session.withTransaction(async () => {
      const conversation = await Conversation.findById(conversationId).session(session);
      if (!conversation || !isConversationParticipant(conversation, senderId)) {
        throw fail(404, "Conversation not found");
      }

      const existing = await Message.findOne({
        conversation: conversationId,
        sender: senderId,
        clientMessageId
      }).session(session);
      if (existing) {
        saved = existing;
        duplicate = true;
        return;
      }

      const [message] = await Message.create([{
        conversation: conversationId,
        sender: senderId,
        text: text.trim(),
        messageType,
        clientMessageId,
        readBy: [senderId]
      }], { session });
      const otherParticipant = conversation.participants.find(id => String(id) !== String(senderId));
      recipientId = String(otherParticipant);
      const sender = await User.findById(senderId).select("name").session(session);
      [notification] = await Notification.create([{
        user: otherParticipant,
        actor: senderId,
        type: "new_message",
        message: `${sender.name} sent you a message.`,
        resourceType: "conversation",
        resourceId: conversation._id,
        dedupeKey: `message:${message._id}:${otherParticipant}`
      }], { session });
      await Conversation.updateOne(
        { _id: conversation._id },
        {
          $set: {
            lastMessage: message._id,
            lastMessagePreview: message.text.slice(0, 160),
            lastMessageAt: message.createdAt,
            lastActivityAt: message.createdAt
          },
          $inc: { "unreadCounts.$[recipient].count": 1 }
        },
        {
          session,
          arrayFilters: [{ "recipient.user": otherParticipant }]
        }
      );
      saved = message;
    });
  } catch (error) {
    if (error.code === 11000) {
      saved = await Message.findOne({ conversation: conversationId, sender: senderId, clientMessageId });
      if (saved) duplicate = true;
      else throw error;
    } else {
      throw error;
    }
  } finally {
    await session.endSession();
  }
  const message = await Message.findById(saved._id).populate("sender", "name profileImage");
  if (duplicate) {
    const conversation = await Conversation.findById(conversationId).select("participants");
    recipientId = String(conversation.participants.find(id => String(id) !== String(senderId)));
  }
  return { message, duplicate, notification, recipientId };
}

export async function editMessage({ messageId, userId, text }) {
  if (typeof text !== "string" || !text.trim() || text.trim().length > 4000) {
    throw fail(400, "Message must contain between 1 and 4000 characters");
  }
  const message = await Message.findOne({ _id: messageId, sender: userId, deletedAt: null });
  if (!message) throw fail(404, "Message not found");
  message.text = text.trim();
  message.editedAt = new Date();
  await message.save();
  const conversation = await Conversation.findById(message.conversation);
  if (conversation?.lastMessage && String(conversation.lastMessage) === String(message._id)) {
    conversation.lastMessagePreview = message.text.slice(0, 160);
    conversation.lastActivityAt = message.editedAt;
    await conversation.save();
  }
  return Message.findById(message._id).populate("sender", "name profileImage");
}

export async function deleteMessage({ messageId, userId }) {
  const message = await Message.findOne({ _id: messageId, sender: userId, deletedAt: null });
  if (!message) throw fail(404, "Message not found");
  message.deletedAt = new Date();
  await message.save();
  const conversation = await Conversation.findById(message.conversation);
  if (conversation?.lastMessage && String(conversation.lastMessage) === String(message._id)) {
    conversation.lastMessagePreview = "Message deleted";
    conversation.lastActivityAt = message.deletedAt;
    await conversation.save();
  }
  return message;
}

export async function markConversationRead(conversationId, userId) {
  const conversation = await Conversation.findById(conversationId);
  if (!conversation || !isConversationParticipant(conversation, userId)) {
    throw fail(404, "Conversation not found");
  }
  await Message.updateMany(
    { conversation: conversationId, sender: { $ne: userId }, readBy: { $ne: userId }, deletedAt: null },
    { $addToSet: { readBy: userId } }
  );
  await Conversation.updateOne(
    { _id: conversationId, "unreadCounts.user": userId },
    { $set: { "unreadCounts.$.count": 0 } }
  );
  return new Date();
}
