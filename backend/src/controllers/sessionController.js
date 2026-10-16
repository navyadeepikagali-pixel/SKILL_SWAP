import { Notification } from "../models/Notification.js";
import {
  cancelSession,
  createSessionProposal,
  getAuthorizedSession,
  getCalendar,
  getSessionList,
  proposeReschedule,
  respondToReschedule,
  respondToSession,
  sessionDurations,
  updateAvailability
} from "../services/sessionService.js";
import { failure, success } from "../utils/responses.js";
import {
  confirmSessionCompletion,
  disputeSessionCompletion,
  getSessionCompletion,
  requestSessionCompletion,
  settleCompletedSession
} from "../services/walletService.js";

function publish(req, result, event = "session:update") {
  if (!result.session) return;
  const io = req.app.get("io");
  io?.to(`conversation:${result.session.conversation?._id || result.session.conversation}`).emit(event, {
    session: result.session
  });
  for (const notification of result.notifications || []) {
    io?.to(`user:${notification.user}`).emit("notification:new", notification);
  }
}

export const sessionController = {
  create: async (req, res) => {
    const result = await createSessionProposal({
      userId: req.user._id,
      conversationId: req.body.conversationId,
      body: req.body,
      idempotencyKey: req.get("Idempotency-Key") || req.body.idempotencyKey
    });
    publish(req, result, "session:proposed");
    return success(res, result.duplicate ? 200 : 201, result.duplicate ? "Existing session proposal retrieved" : "Session proposal created", {
      session: result.session,
      duplicate: result.duplicate,
      allowedDurations: sessionDurations()
    });
  },

  list: async (req, res) => success(res, 200, "Sessions retrieved", await getSessionList({ userId: req.user._id, query: req.query })),

  get: async (req, res) => {
    const session = await getAuthorizedSession(req.params.id, req.user._id);
    return success(res, 200, "Session retrieved", { session });
  },

  completion: async (req, res) => success(res, 200, "Session completion retrieved", {
    completion: await getSessionCompletion({ sessionId: req.params.id, userId: req.user._id })
  }),

  requestCompletion: async (req, res) => {
    const result = await requestSessionCompletion({ sessionId: req.params.id, userId: req.user._id });
    publish(req, result, "session:completion-requested");
    return success(res, 200, result.duplicate ? "Completion confirmation was already requested" : "Completion confirmation requested", {
      session: result.session, duplicate: result.duplicate
    });
  },

  confirmCompletion: async (req, res) => {
    const result = await confirmSessionCompletion({
      sessionId: req.params.id,
      userId: req.user._id,
      idempotencyKey: req.get("Idempotency-Key") || req.body?.idempotencyKey
    });
    const event = result.settlement?.settled ? "session:settled" : "session:settlement-failed";
    publish(req, result, event);
    return success(res, 200,
      result.settlement?.settled ? "Completion confirmed and credits settled" :
        result.settlement?.failureReason || "Completion confirmed; settlement requires attention",
      { session: result.session, settlement: result.settlement, duplicate: result.duplicate });
  },

  disputeCompletion: async (req, res) => {
    const result = await disputeSessionCompletion({
      sessionId: req.params.id, userId: req.user._id, reason: req.body.reason
    });
    publish(req, result, "session:disputed");
    return success(res, 200, result.duplicate ? "Completion dispute was already recorded" : "Completion dispute recorded", {
      session: result.session, duplicate: result.duplicate
    });
  },

  settle: async (req, res) => {
    const result = await settleCompletedSession({
      sessionId: req.params.id,
      userId: req.user._id,
      idempotencyKey: req.get("Idempotency-Key") || req.body?.idempotencyKey
    });
    publish(req, result, result.settlement?.settled ? "session:settled" : "session:settlement-failed");
    return success(res, 200,
      result.settlement?.settled ? "Credits settled" :
        result.settlement?.failureReason || "Settlement is not eligible",
      { session: result.session, settlement: result.settlement, duplicate: result.duplicate });
  },

  accept: async (req, res) => {
    const result = await respondToSession({ sessionId: req.params.id, userId: req.user._id, action: "accept" });
    publish(req, result, "session:accepted");
    return success(res, 200, "Session accepted", { session: result.session });
  },

  reject: async (req, res) => {
    const result = await respondToSession({ sessionId: req.params.id, userId: req.user._id, action: "reject" });
    publish(req, result, "session:rejected");
    return success(res, 200, "Session proposal rejected", { session: result.session });
  },

  cancel: async (req, res) => {
    const result = await cancelSession({ sessionId: req.params.id, userId: req.user._id, reason: req.body.reason });
    publish(req, result, "session:cancelled");
    return success(res, 200, "Session cancelled", { session: result.session });
  },

  proposeReschedule: async (req, res) => {
    const result = await proposeReschedule({
      sessionId: req.params.id,
      userId: req.user._id,
      body: req.body,
      idempotencyKey: req.get("Idempotency-Key") || req.body.idempotencyKey
    });
    publish(req, result, "session:reschedule-proposed");
    return success(res, result.duplicate ? 200 : 201, "Reschedule proposal submitted", {
      session: result.session,
      duplicate: result.duplicate
    });
  },

  respondReschedule: async (req, res) => {
    const result = await respondToReschedule({
      sessionId: req.params.id,
      userId: req.user._id,
      action: req.params.action
    });
    publish(req, result, `session:reschedule-${req.params.action}ed`);
    return success(res, 200, `Reschedule ${req.params.action}ed`, { session: result.session });
  },

  getAvailability: (req, res) => success(res, 200, "Availability retrieved", {
    availableTimeSlots: req.user.availableTimeSlots,
    unavailableTimeRanges: req.user.unavailableTimeRanges
  }),

  putAvailability: async (req, res) => {
    const availability = await updateAvailability({ userId: req.user._id, body: req.body });
    return success(res, 200, "Availability updated", {
      availableTimeSlots: availability.availableTimeSlots,
      unavailableTimeRanges: availability.unavailableTimeRanges
    });
  },

  calendar: async (req, res) => {
    const sessions = await getCalendar({ userId: req.user._id, from: req.query.from, to: req.query.to });
    return success(res, 200, "Calendar sessions retrieved", { sessions });
  },

  notifications: async (req, res) => {
    const page = Number(req.query.page || 1);
    const limit = Number(req.query.limit || 20);
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 50) {
      return failure(res, 400, "Page must be positive and page size must be 1–50");
    }
    const notifications = await Notification.find({ user: req.user._id })
      .sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit)
      .populate("actor", "name profileImage");
    return success(res, 200, "Notifications retrieved", { notifications, page, limit });
  }
};
