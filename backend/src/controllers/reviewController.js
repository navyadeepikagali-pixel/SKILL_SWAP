import mongoose from "mongoose";
import { Review } from "../models/Review.js";
import { Session } from "../models/Session.js";
import { Notification } from "../models/Notification.js";
import { failure, success } from "../utils/responses.js";

function pageParams(query) {
  const page = Number(query.page || 1);
  const limit = Number(query.limit || 20);
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 50) {
    return null;
  }
  return { page, limit, skip: (page - 1) * limit };
}

export const reviewController = {
  create: async (req, res) => {
    const { sessionId, rating, text = "" } = req.body || {};
    if (typeof sessionId !== "string" || !mongoose.isValidObjectId(sessionId) ||
      !Number.isInteger(rating) || rating < 1 || rating > 5 ||
      typeof text !== "string" || text.trim().length > 1500) {
      return failure(res, 400, "Session, 1–5 star rating, or review text is invalid");
    }
    const session = await Session.findById(sessionId).select("tutor learner status completion");
    if (!session) return failure(res, 404, "Session not found");
    if (String(session.learner) !== String(req.user._id) || String(session.tutor) === String(req.user._id)) {
      return failure(res, 403, "Only the learner in this session can review its tutor");
    }
    if (session.status !== "completed" || !session.completion?.learnerConfirmedAt ||
      session.completion?.dispute?.raisedAt) {
      return failure(res, 409, "Only a completed, confirmed, undisputed session can be reviewed");
    }
    const existing = await Review.findOne({ session: session._id, author: req.user._id });
    if (existing) return failure(res, 409, "You have already reviewed this session");
    const mongoSession = await mongoose.startSession();
    let review;
    let notification;
    try {
      await mongoSession.withTransaction(async () => {
        const latest = await Session.findById(sessionId).session(mongoSession);
        if (!latest || String(latest.learner) !== String(req.user._id) ||
          latest.status !== "completed" || !latest.completion?.learnerConfirmedAt ||
          latest.completion?.dispute?.raisedAt) {
          const error = new Error("Only a completed, confirmed, undisputed session can be reviewed");
          error.status = 409;
          throw error;
        }
        [review] = await Review.create([{
          session: latest._id,
          author: req.user._id,
          recipient: latest.tutor,
          rating,
          text: text.trim()
        }], { session: mongoSession });
        [notification] = await Notification.create([{
          user: latest.tutor,
          actor: req.user._id,
          type: "review_received",
          message: `${req.user.name} left you a ${rating}-star session review.`,
          resourceType: "review",
          resourceId: review._id,
          dedupeKey: `review:${review._id}:${latest.tutor}`
        }], { session: mongoSession });
      });
    } finally {
      await mongoSession.endSession();
    }
    req.app.get("io")?.to(`user:${session.tutor}`).emit("notification:new", notification);
    return success(res, 201, "Review submitted", { review });
  },

  tutorReviews: async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.tutorId)) return failure(res, 400, "Tutor id is invalid");
    const paging = pageParams(req.query);
    if (!paging) return failure(res, 400, "Page must be positive and page size must be 1–50");
    const filter = { recipient: req.params.tutorId };
    const [reviews, total, [rating = { average: 0, count: 0 }]] = await Promise.all([
      Review.find(filter).sort({ createdAt: -1, _id: -1 }).skip(paging.skip).limit(paging.limit)
        .populate("author", "name profileImage")
        .populate("session", "title startsAt timezone"),
      Review.countDocuments(filter),
      Review.aggregate([
        { $match: { recipient: new mongoose.Types.ObjectId(req.params.tutorId) } },
        { $group: { _id: null, average: { $avg: "$rating" }, count: { $sum: 1 } } }
      ])
    ]);
    return success(res, 200, "Tutor reviews retrieved", {
      reviews, rating: { average: Math.round(rating.average * 100) / 100, count: rating.count },
      pagination: { page: paging.page, limit: paging.limit, total, pages: Math.ceil(total / paging.limit) }
    });
  },

  mine: async (req, res) => {
    const paging = pageParams(req.query);
    if (!paging) return failure(res, 400, "Page must be positive and page size must be 1–50");
    const filter = { author: req.user._id };
    const [reviews, total] = await Promise.all([
      Review.find(filter).sort({ createdAt: -1, _id: -1 }).skip(paging.skip).limit(paging.limit)
        .populate("recipient", "name profileImage")
        .populate("session", "title startsAt timezone status"),
      Review.countDocuments(filter)
    ]);
    return success(res, 200, "Your review history retrieved", {
      reviews, pagination: { page: paging.page, limit: paging.limit, total, pages: Math.ceil(total / paging.limit) }
    });
  }
};
