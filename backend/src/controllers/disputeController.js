import mongoose from "mongoose";
import { Dispute } from "../models/Dispute.js";
import { Notification } from "../models/Notification.js";
import { Session } from "../models/Session.js";
import { failure, success } from "../utils/responses.js";

const fail = (status, message) => Object.assign(new Error(message), { status });
const isParticipant = (session, userId) =>
  String(session.tutor) === String(userId) || String(session.learner) === String(userId);

export const disputeController = {
  mine: async (req, res) => {
    const page = Number(req.query.page || 1);
    const limit = Number(req.query.limit || 20);
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 50) {
      return failure(res, 400, "Page must be positive and page size must be 1–50");
    }
    const filter = { $or: [{ tutor: req.user._id }, { learner: req.user._id }] };
    const [disputes, total] = await Promise.all([
      Dispute.find(filter).select("-internalNotes -history.actor -history.note")
        .sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit)
        .populate("session", "title startsAt timezone status")
        .populate("openedBy tutor learner", "name profileImage"),
      Dispute.countDocuments(filter)
    ]);
    return success(res, 200, "Your disputes retrieved", {
      disputes, pagination: { page, limit, total, pages: Math.ceil(total / limit) }
    });
  },

  getMine: async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.disputeId)) return failure(res, 400, "Dispute id is invalid");
    const dispute = await Dispute.findOne({
      _id: req.params.disputeId,
      $or: [{ tutor: req.user._id }, { learner: req.user._id }]
    }).select("-internalNotes -history.actor -history.note")
      .populate("session", "title startsAt timezone status")
      .populate("openedBy tutor learner", "name profileImage");
    if (!dispute) return failure(res, 404, "Dispute not found");
    return success(res, 200, "Dispute retrieved", { dispute });
  },

  create: async (req, res) => {
    const { sessionId, reason, description, evidence = [] } = req.body || {};
    if (typeof sessionId !== "string" || !mongoose.isValidObjectId(sessionId) ||
      typeof reason !== "string" || reason.trim().length < 3 || reason.trim().length > 160 ||
      typeof description !== "string" || description.trim().length < 10 || description.trim().length > 3000 ||
      !Array.isArray(evidence) || evidence.length > 5 || evidence.some(item =>
        !item || !["message", "session", "other"].includes(item.type) ||
        typeof item.label !== "string" || item.label.trim().length < 1 || item.label.length > 120 ||
        (item.reference !== undefined && (typeof item.reference !== "string" || item.reference.length > 200)))) {
      return failure(res, 400, "Dispute details or evidence metadata are invalid");
    }
    const mongoSession = await mongoose.startSession();
    let dispute;
    let notifications = [];
    try {
      await mongoSession.withTransaction(async () => {
        const session = await Session.findById(sessionId).session(mongoSession);
        if (!session) throw fail(404, "Session not found");
        if (!isParticipant(session, req.user._id)) throw fail(403, "Only session participants can open a dispute");
        if (!["scheduled", "completed", "disputed"].includes(session.status)) {
          throw fail(409, "This session is not eligible for a dispute");
        }
        const existing = await Dispute.findOne({ session: session._id }).session(mongoSession);
        if (existing) {
          if (String(existing.openedBy) === String(req.user._id)) {
            dispute = existing;
            return;
          }
          throw fail(409, "A dispute has already been opened for this session");
        }
        const now = new Date();
        [dispute] = await Dispute.create([{
          session: session._id, openedBy: req.user._id, tutor: session.tutor, learner: session.learner,
          reason: reason.trim(), description: description.trim(),
          evidence: evidence.map(item => ({
            type: item.type, label: item.label.trim(), reference: item.reference?.trim() || ""
          })),
          status: "OPEN",
          history: [{ status: "OPEN", actor: req.user._id, note: "Dispute opened", at: now }]
        }], { session: mongoSession });
        session.status = "disputed";
        if (session.settlement?.status !== "settled") {
          session.settlement.status = "not_started";
          session.settlement.failureCode = "disputed";
          session.settlement.failureReason = "Settlement is blocked while this dispute is unresolved.";
        }
        await session.save({ session: mongoSession });
        notifications = await Notification.create([session.tutor, session.learner].map(user => ({
          user, actor: req.user._id, type: "dispute_opened",
          message: "A dispute was opened for a session. No credits were transferred by this action.",
          resourceType: "dispute", resourceId: dispute._id,
          dedupeKey: `dispute:${dispute._id}:opened:${user}`
        })), { session: mongoSession, ordered: true });
      });
    } finally {
      await mongoSession.endSession();
    }
    for (const notification of notifications) {
      req.app.get("io")?.to(`user:${notification.user}`).emit("notification:new", notification);
    }
    return success(res, 201, "Dispute recorded for administrator review", { dispute });
  }
};
