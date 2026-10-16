import mongoose from "mongoose";
import { ConnectionRequest } from "../models/ConnectionRequest.js";
import { Conversation } from "../models/Conversation.js";
import { Notification } from "../models/Notification.js";
import { Session } from "../models/Session.js";
import { SessionParticipant } from "../models/SessionParticipant.js";
import { CreditTransaction } from "../models/CreditTransaction.js";
import { Skill } from "../models/Skill.js";
import { User } from "../models/User.js";
import { sessionCreditPrice } from "../config/credits.js";

const ACTIVE_STATUSES = ["pending", "scheduled"];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const fail = (status, message) => Object.assign(new Error(message), { status });
const configuredDurations = (process.env.SESSION_ALLOWED_DURATIONS || "30,45,60")
  .split(",").map(value => Number(value.trim()));
if (!configuredDurations.length || configuredDurations.some(value => ![30, 45, 60].includes(value))) {
  throw new Error("SESSION_ALLOWED_DURATIONS must be a comma-separated subset of 30,45,60");
}
const allowedDurations = new Set(configuredDurations);

function parseDateParts(date, time) {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    typeof time !== "string" || !TIME_RE.test(time)) return null;
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return { year, month, day, hour, minute };
}

function formatter(timezone) {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
    });
  } catch {
    return null;
  }
}

function localPartsAt(instant, timeZoneFormatter) {
  const parts = Object.fromEntries(timeZoneFormatter.formatToParts(instant)
    .filter(part => part.type !== "literal").map(part => [part.type, Number(part.value)]));
  return { year: parts.year, month: parts.month, day: parts.day, hour: parts.hour, minute: parts.minute, second: parts.second };
}

function sameLocalParts(a, b) {
  return a.year === b.year && a.month === b.month && a.day === b.day &&
    a.hour === b.hour && a.minute === b.minute;
}

export function localDateTimeToUtc(date, time, timezone) {
  const parts = parseDateParts(date, time);
  const zoneFormatter = typeof timezone === "string" && timezone.length <= 80 ? formatter(timezone) : null;
  if (!parts || !zoneFormatter) throw fail(400, "Provide a valid date, time, and IANA timezone");
  const localAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  const offsets = new Set();
  for (let hour = -36; hour <= 36; hour += 3) {
    const probe = new Date(localAsUtc + hour * 60 * 60_000);
    const local = localPartsAt(probe, zoneFormatter);
    const asUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
    offsets.add(asUtc - probe.getTime());
  }
  const candidates = [...offsets].map(offset => new Date(localAsUtc - offset))
    .filter(candidate => sameLocalParts(localPartsAt(candidate, zoneFormatter), parts));
  const unique = [...new Map(candidates.map(value => [value.getTime(), value])).values()];
  if (unique.length !== 1) {
    throw fail(400, unique.length ? "This local time is ambiguous because of a daylight-saving change" : "This local time does not exist in the selected timezone");
  }
  return unique[0];
}

export function sessionDurations() {
  return [...allowedDurations].sort((a, b) => a - b);
}

function getLocalDayAndMinute(date, timeZoneFormatter) {
  const local = localPartsAt(date, timeZoneFormatter);
  return {
    day: new Date(Date.UTC(local.year, local.month - 1, local.day)).getUTCDay(),
    minute: local.hour * 60 + local.minute
  };
}

function rangeHitsUnavailable(tutor, startsAt, endsAt) {
  return (tutor.unavailableTimeRanges || []).some(range =>
    range.startsAt < endsAt && range.endsAt > startsAt);
}

function isInWeeklyAvailability(tutor, startsAt, endsAt) {
  for (const slot of tutor.availableTimeSlots || []) {
    const zoneFormatter = formatter(slot.timezone || "UTC");
    if (!zoneFormatter || !TIME_RE.test(slot.startTime) || !TIME_RE.test(slot.endTime)) continue;
    const start = getLocalDayAndMinute(startsAt, zoneFormatter);
    const end = getLocalDayAndMinute(new Date(endsAt.getTime() - 1), zoneFormatter);
    if (start.day !== slot.dayOfWeek || end.day !== start.day) continue;
    const [startHour, startMinute] = slot.startTime.split(":").map(Number);
    const [endHour, endMinute] = slot.endTime.split(":").map(Number);
    if (start.minute >= startHour * 60 + startMinute &&
      end.minute < endHour * 60 + endMinute) return true;
  }
  return false;
}

async function assertTutorAvailable(tutor, startsAt, endsAt) {
  if (rangeHitsUnavailable(tutor, startsAt, endsAt)) {
    throw fail(409, "The tutor is unavailable for this time");
  }
  if (!isInWeeklyAvailability(tutor, startsAt, endsAt)) {
    throw fail(409, "The proposed time is outside the tutor's listed availability");
  }
}

async function serializeBookingWrites(userIds, mongoSession) {
  const sorted = [...new Set(userIds.map(String))].sort();
  for (const id of sorted) {
    const result = await User.updateOne(
      { _id: id },
      { $inc: { bookingLockVersion: 1 } },
      { session: mongoSession }
    );
    if (!result.matchedCount) throw fail(404, "A session participant is unavailable");
  }
}

async function assertNoOverlap({ tutorId, learnerId, startsAt, endsAt, exceptId, mongoSession }) {
  const query = {
    status: { $in: ACTIVE_STATUSES },
    startsAt: { $lt: endsAt },
    endsAt: { $gt: startsAt },
    $or: [{ tutor: tutorId }, { learner: tutorId }, { tutor: learnerId }, { learner: learnerId }]
  };
  if (exceptId) query._id = { $ne: exceptId };
  let overlaps = Session.findOne(query).select("_id");
  if (mongoSession) overlaps = overlaps.session(mongoSession);
  if (await overlaps) throw fail(409, "One of the participants already has a session during this time");
}

function notificationRecord({ user, actor, type, message, sessionId, suffix }) {
  return {
    user, actor, type, message,
    resourceType: "session",
    resourceId: sessionId,
    dedupeKey: `session:${sessionId}:${suffix}:${user}`
  };
}

function notify(io, notifications, conversationId, event, session) {
  if (!io) return;
  io.to(`conversation:${conversationId}`).emit(event, { session });
  for (const notification of notifications) {
    io.to(`user:${notification.user}`).emit("notification:new", notification);
  }
}

async function populateSession(id) {
  return Session.findById(id)
    .populate("skill", "name slug category")
    .populate("category", "name slug")
    .populate("tutor learner createdBy", "name profileImage")
    .populate("conversation", "participants");
}

export async function createSessionProposal({ userId, conversationId, body, idempotencyKey }) {
  if (!mongoose.isValidObjectId(conversationId)) throw fail(400, "Conversation id is invalid");
  if (typeof idempotencyKey !== "string" || !/^[A-Za-z0-9:_-]{8,100}$/.test(idempotencyKey)) {
    throw fail(400, "A valid idempotency key is required");
  }
  const conversation = await Conversation.findById(conversationId).select("participants skill");
  if (!conversation || !conversation.participants.some(id => String(id) === String(userId))) {
    throw fail(404, "Conversation not found");
  }
  const connection = await ConnectionRequest.findOne({ conversation: conversationId }).select("learner tutor status");
  if (!connection || String(connection.tutor) !== String(userId)) {
    throw fail(403, "Only the tutor in this conversation can propose a session");
  }
  if (connection.status !== "accepted") throw fail(409, "Accept the connection before proposing a session");
  const duplicate = await Session.findOne({ tutor: connection.tutor, idempotencyKey });
  if (duplicate) {
    if (String(duplicate.conversation) !== String(conversationId)) throw fail(409, "This idempotency key was already used");
    return { session: await populateSession(duplicate._id), duplicate: true, notifications: [] };
  }

  const skillId = body.skillId || conversation.skill;
  if (!mongoose.isValidObjectId(skillId)) throw fail(400, "Skill id is invalid");
  const skill = await Skill.findOne({ _id: skillId, isActive: true }).select("_id name category");
  if (!skill) throw fail(400, "Selected skill is unavailable");
  const tutor = await User.findById(connection.tutor).select("skillsToTeach availableTimeSlots unavailableTimeRanges name");
  if (!tutor.skillsToTeach.some(id => String(id) === String(skill._id))) {
    throw fail(403, "The selected skill must be one the tutor teaches");
  }
  const durationMinutes = Number(body.durationMinutes);
  if (!allowedDurations.has(durationMinutes)) throw fail(400, `Duration must be one of: ${sessionDurations().join(", ")} minutes`);
  const startsAt = localDateTimeToUtc(body.date, body.startTime, body.timezone);
  if (startsAt.getTime() < Date.now() + 5 * 60_000) throw fail(400, "A session must be scheduled at least five minutes in the future");
  const endsAt = new Date(startsAt.getTime() + durationMinutes * 60_000);
  if (!["online", "in-person"].includes(body.format)) throw fail(400, "Session mode must be online or in-person");
  if (body.title !== undefined && (typeof body.title !== "string" || body.title.trim().length < 3 || body.title.trim().length > 160)) {
    throw fail(400, "Session title must be between 3 and 160 characters");
  }
  if (body.description !== undefined && (typeof body.description !== "string" || body.description.length > 2000)) {
    throw fail(400, "Session notes must be 2000 characters or fewer");
  }
  if (body.meetingDetails !== undefined && (typeof body.meetingDetails !== "string" || body.meetingDetails.length > 1000)) {
    throw fail(400, "Meeting details must be 1000 characters or fewer");
  }
  if (body.location !== undefined && (typeof body.location !== "string" || body.location.length > 300)) {
    throw fail(400, "Location must be 300 characters or fewer");
  }

  const mongoSession = await mongoose.startSession();
  let created;
  let notifications = [];
  try {
    await mongoSession.withTransaction(async () => {
      await serializeBookingWrites([connection.tutor, connection.learner], mongoSession);
      await assertTutorAvailable(tutor, startsAt, endsAt);
      await assertNoOverlap({
        tutorId: connection.tutor, learnerId: connection.learner, startsAt, endsAt, mongoSession
      });
      [created] = await Session.create([{
        title: body.title?.trim() || `${skill.name} learning session`,
        skill: skill._id,
        category: skill.category,
        tutor: connection.tutor,
        learner: connection.learner,
        conversation: conversationId,
        createdBy: userId,
        description: body.description?.trim() || "",
        startsAt,
        endsAt,
        timezone: body.timezone,
        durationMinutes,
        creditPrice: sessionCreditPrice(),
        format: body.format,
        meetingDetails: body.meetingDetails?.trim() || "",
        location: body.location?.trim() || "",
        status: "pending",
        idempotencyKey
      }], { session: mongoSession });
      await SessionParticipant.create([
        { session: created._id, user: connection.tutor, status: "accepted", joinedAt: new Date() },
        { session: created._id, user: connection.learner, status: "pending" }
      ], { session: mongoSession, ordered: true });
      notifications = await Notification.create([notificationRecord({
        user: connection.learner, actor: userId, type: "session_proposed",
        message: `${tutor.name} proposed a ${durationMinutes}-minute session.`,
        sessionId: created._id, suffix: "proposed"
      })], { session: mongoSession });
    });
  } catch (error) {
    if (error.code === 11000) {
      const existing = await Session.findOne({ tutor: connection.tutor, idempotencyKey });
      if (existing) return { session: await populateSession(existing._id), duplicate: true, notifications: [] };
    }
    throw error;
  } finally {
    await mongoSession.endSession();
  }
  return { session: await populateSession(created._id), duplicate: false, notifications };
}

export async function respondToSession({ sessionId, userId, action }) {
  if (!mongoose.isValidObjectId(sessionId)) throw fail(400, "Session id is invalid");
  if (!["accept", "reject"].includes(action)) throw fail(400, "Session response is invalid");
  const mongoSession = await mongoose.startSession();
  let notifications = [];
  try {
    await mongoSession.withTransaction(async () => {
      let booking = await Session.findById(sessionId).session(mongoSession);
      if (!booking) throw fail(404, "Session not found");
      if (String(booking.learner) !== String(userId)) throw fail(403, "Only the intended learner can respond");
      if (booking.status === (action === "accept" ? "scheduled" : "rejected")) return;
      if (booking.status !== "pending") throw fail(409, "This proposal is no longer pending");
      if (action === "accept") {
        const tutor = await User.findById(booking.tutor).select("availableTimeSlots unavailableTimeRanges");
        await serializeBookingWrites([booking.tutor, booking.learner], mongoSession);
        await assertTutorAvailable(tutor, booking.startsAt, booking.endsAt);
        await assertNoOverlap({
          tutorId: booking.tutor, learnerId: booking.learner,
          startsAt: booking.startsAt, endsAt: booking.endsAt,
          exceptId: booking._id, mongoSession
        });
        booking.status = "scheduled";
        booking.acceptedAt = new Date();
        await booking.save({ session: mongoSession });
        await SessionParticipant.updateOne(
          { session: booking._id, user: userId }, { $set: { status: "accepted", joinedAt: new Date() } }, { session: mongoSession }
        );
      } else {
        booking.status = "rejected";
        booking.rejectedAt = new Date();
        await booking.save({ session: mongoSession });
        await SessionParticipant.updateOne(
          { session: booking._id, user: userId }, { $set: { status: "rejected" } }, { session: mongoSession }
        );
      }
      const verb = action === "accept" ? "accepted" : "rejected";
      notifications = await Notification.create([
        notificationRecord({
          user: booking.tutor, actor: userId, type: `session_${verb}`,
          message: action === "accept" ? "The learner accepted your session proposal." : "The session proposal was rejected.",
          sessionId: booking._id, suffix: `${verb}:${booking.tutor}`
        }),
        notificationRecord({
          user: booking.learner, actor: userId,
          type: action === "accept" ? "session_scheduled" : "session_rejected",
          message: action === "accept" ? "Your session is confirmed." : "Your session proposal was rejected.",
          sessionId: booking._id, suffix: `${verb}:${booking.learner}`
        })
      ], { session: mongoSession, ordered: true });
    });
  } finally {
    await mongoSession.endSession();
  }
  return { session: await populateSession(sessionId), notifications };
}

export async function cancelSession({ sessionId, userId, reason }) {
  if (!mongoose.isValidObjectId(sessionId)) throw fail(400, "Session id is invalid");
  if (typeof reason !== "string" || reason.trim().length < 3 || reason.trim().length > 500) {
    throw fail(400, "Please provide a cancellation reason (3–500 characters)");
  }
  const mongoSession = await mongoose.startSession();
  let notifications = [];
  let conversationId;
  try {
    await mongoSession.withTransaction(async () => {
      const booking = await Session.findById(sessionId).session(mongoSession);
      if (!booking) throw fail(404, "Session not found");
      if (![String(booking.tutor), String(booking.learner)].includes(String(userId))) {
        throw fail(403, "Only session participants can cancel this session");
      }
      if (!ACTIVE_STATUSES.includes(booking.status)) throw fail(409, "This session cannot be cancelled");
      if (booking.startsAt <= new Date()) throw fail(409, "A session cannot be cancelled after it has started");
      booking.status = "cancelled";
      booking.cancelledAt = new Date();
      booking.cancellationReason = reason.trim();
      await booking.save({ session: mongoSession });
      await SessionParticipant.updateMany(
        { session: booking._id }, { $set: { status: "cancelled" } }, { session: mongoSession }
      );
      conversationId = booking.conversation;
      notifications = await Notification.create([
        notificationRecord({
          user: booking.tutor, actor: userId, type: "session_cancelled",
          message: "A session has been cancelled.",
          sessionId: booking._id, suffix: `cancelled:${booking.cancelledAt.getTime()}:${booking.tutor}`
        }),
        notificationRecord({
          user: booking.learner, actor: userId, type: "session_cancelled",
          message: "A session has been cancelled.",
          sessionId: booking._id, suffix: `cancelled:${booking.cancelledAt.getTime()}:${booking.learner}`
        })
      ], { session: mongoSession, ordered: true });
    });
  } finally {
    await mongoSession.endSession();
  }
  return { session: await populateSession(sessionId), notifications, conversationId };
}

export async function proposeReschedule({ sessionId, userId, body, idempotencyKey }) {
  if (!mongoose.isValidObjectId(sessionId)) throw fail(400, "Session id is invalid");
  if (typeof idempotencyKey !== "string" || !/^[A-Za-z0-9:_-]{8,100}$/.test(idempotencyKey)) {
    throw fail(400, "A valid idempotency key is required");
  }
  const booking = await Session.findById(sessionId);
  if (!booking) throw fail(404, "Session not found");
  if (![String(booking.tutor), String(booking.learner)].includes(String(userId))) throw fail(403, "Only session participants can reschedule");
  if (booking.status !== "scheduled") throw fail(409, "Only confirmed sessions can be rescheduled");
  if (booking.rescheduleProposal?.status === "pending") {
    if (booking.rescheduleProposal.idempotencyKey === idempotencyKey && String(booking.rescheduleProposal.proposedBy) === String(userId)) {
      return { session: await populateSession(booking._id), notifications: [], duplicate: true };
    }
    throw fail(409, "A reschedule proposal is already awaiting a response");
  }
  const durationMinutes = Number(body.durationMinutes ?? booking.durationMinutes);
  if (!allowedDurations.has(durationMinutes)) throw fail(400, `Duration must be one of: ${sessionDurations().join(", ")} minutes`);
  const timezone = body.timezone || booking.timezone;
  const startsAt = localDateTimeToUtc(body.date, body.startTime, timezone);
  if (startsAt.getTime() < Date.now() + 5 * 60_000) throw fail(400, "A session must be scheduled at least five minutes in the future");
  const endsAt = new Date(startsAt.getTime() + durationMinutes * 60_000);
  const tutor = await User.findById(booking.tutor).select("availableTimeSlots unavailableTimeRanges");
  const mongoSession = await mongoose.startSession();
  let notifications = [];
  try {
    await mongoSession.withTransaction(async () => {
      await serializeBookingWrites([booking.tutor, booking.learner], mongoSession);
      await assertTutorAvailable(tutor, startsAt, endsAt);
      await assertNoOverlap({
        tutorId: booking.tutor, learnerId: booking.learner, startsAt, endsAt,
        exceptId: booking._id, mongoSession
      });
      const latest = await Session.findById(booking._id).session(mongoSession);
      if (latest.status !== "scheduled" || latest.rescheduleProposal?.status === "pending") {
        throw fail(409, "This session already has a pending change");
      }
      latest.rescheduleProposal = {
        startsAt, endsAt, timezone, durationMinutes,
        proposedBy: userId, proposedAt: new Date(), status: "pending", idempotencyKey
      };
      await latest.save({ session: mongoSession });
      const recipient = String(userId) === String(latest.tutor) ? latest.learner : latest.tutor;
      notifications = await Notification.create([notificationRecord({
        user: recipient, actor: userId, type: "session_reschedule_proposed",
        message: "A participant proposed a new time for your session.",
        sessionId: latest._id, suffix: `reschedule:${idempotencyKey}`
      })], { session: mongoSession });
    });
  } finally {
    await mongoSession.endSession();
  }
  return { session: await populateSession(sessionId), notifications, duplicate: false };
}

export async function respondToReschedule({ sessionId, userId, action }) {
  if (!mongoose.isValidObjectId(sessionId)) throw fail(400, "Session id is invalid");
  if (!["accept", "reject"].includes(action)) throw fail(400, "Reschedule response is invalid");
  const mongoSession = await mongoose.startSession();
  let notifications = [];
  try {
    await mongoSession.withTransaction(async () => {
      const booking = await Session.findById(sessionId).session(mongoSession);
      if (!booking) throw fail(404, "Session not found");
      if (![String(booking.tutor), String(booking.learner)].includes(String(userId))) throw fail(403, "Only session participants can respond");
      if (booking.status !== "scheduled") throw fail(409, "Only confirmed sessions can be rescheduled");
      const proposal = booking.rescheduleProposal;
      if (!proposal || proposal.status !== "pending") throw fail(409, "There is no pending reschedule proposal");
      if (String(proposal.proposedBy) === String(userId)) throw fail(403, "The proposer cannot confirm their own reschedule");
      if (action === "accept") {
        const tutor = await User.findById(booking.tutor).select("availableTimeSlots unavailableTimeRanges");
        await serializeBookingWrites([booking.tutor, booking.learner], mongoSession);
        await assertTutorAvailable(tutor, proposal.startsAt, proposal.endsAt);
        await assertNoOverlap({
          tutorId: booking.tutor, learnerId: booking.learner,
          startsAt: proposal.startsAt, endsAt: proposal.endsAt,
          exceptId: booking._id, mongoSession
        });
        booking.startsAt = proposal.startsAt;
        booking.endsAt = proposal.endsAt;
        booking.timezone = proposal.timezone;
        booking.durationMinutes = proposal.durationMinutes;
      }
      proposal.status = action === "accept" ? "accepted" : "rejected";
      await booking.save({ session: mongoSession });
      notifications = await Notification.create([
        notificationRecord({
          user: booking.tutor, actor: userId, type: `session_reschedule_${proposal.status}`,
          message: action === "accept" ? "The proposed session time was confirmed." : "The proposed session time was declined.",
          sessionId: booking._id, suffix: `reschedule-${proposal.status}:${proposal.idempotencyKey}:${booking.tutor}`
        }),
        notificationRecord({
          user: booking.learner, actor: userId, type: `session_reschedule_${proposal.status}`,
          message: action === "accept" ? "The proposed session time was confirmed." : "The proposed session time was declined.",
          sessionId: booking._id, suffix: `reschedule-${proposal.status}:${proposal.idempotencyKey}:${booking.learner}`
        })
      ], { session: mongoSession, ordered: true });
    });
  } finally {
    await mongoSession.endSession();
  }
  return { session: await populateSession(sessionId), notifications };
}

export async function updateAvailability({ userId, body }) {
  if (!Array.isArray(body.availableTimeSlots) || body.availableTimeSlots.length > 50) {
    throw fail(400, "Provide up to 50 weekly availability slots");
  }
  const slots = body.availableTimeSlots;
  const validTimeZone = value => typeof value === "string" && value.length <= 80 && Boolean(formatter(value));
  if (slots.some(slot => !slot || !Number.isInteger(slot.dayOfWeek) || slot.dayOfWeek < 0 || slot.dayOfWeek > 6 ||
    typeof slot.startTime !== "string" || !TIME_RE.test(slot.startTime) ||
    typeof slot.endTime !== "string" || !TIME_RE.test(slot.endTime) || slot.endTime <= slot.startTime ||
    !validTimeZone(slot.timezone || "UTC"))) {
    throw fail(400, "Availability slots must have valid days, time ranges, and IANA timezones");
  }
  const ranges = body.unavailableTimeRanges ?? [];
  if (!Array.isArray(ranges) || ranges.length > 100 || ranges.some(range =>
    !range || typeof range.startsAt !== "string" || typeof range.endsAt !== "string" ||
    !/(Z|[+-]\d{2}:\d{2})$/i.test(range.startsAt) || !/(Z|[+-]\d{2}:\d{2})$/i.test(range.endsAt) ||
    !Number.isFinite(Date.parse(range.startsAt)) || !Number.isFinite(Date.parse(range.endsAt)) ||
    Date.parse(range.endsAt) <= Date.parse(range.startsAt) ||
    (range.reason !== undefined && (typeof range.reason !== "string" || range.reason.length > 160)))) {
    throw fail(400, "Unavailable periods must have valid start and end instants");
  }
  const user = await User.findByIdAndUpdate(userId, {
    $set: {
      availableTimeSlots: slots.map(slot => ({
        dayOfWeek: slot.dayOfWeek, startTime: slot.startTime,
        endTime: slot.endTime, timezone: slot.timezone || "UTC"
      })),
      unavailableTimeRanges: ranges.map(range => ({
        startsAt: new Date(range.startsAt), endsAt: new Date(range.endsAt), reason: range.reason?.trim() || ""
      }))
    }
  }, { new: true, runValidators: true }).select("availableTimeSlots unavailableTimeRanges");
  return user;
}

export async function getSessionList({ userId, query }) {
  const now = new Date();
  const filter = { $or: [{ tutor: userId }, { learner: userId }] };
  if (query.status) {
    const statuses = String(query.status).split(",");
    const allowed = new Set(["pending", "scheduled", "rejected", "cancelled", "completed", "disputed"]);
    if (statuses.length > 6 || statuses.some(status => !allowed.has(status))) throw fail(400, "Session status filter is invalid");
    filter.status = { $in: statuses };
  }
  if (query.skill !== undefined) {
    if (!mongoose.isValidObjectId(query.skill)) throw fail(400, "Skill filter is invalid");
    filter.skill = query.skill;
  }
  if (query.category !== undefined) {
    if (!mongoose.isValidObjectId(query.category)) throw fail(400, "Category filter is invalid");
    filter.category = query.category;
  }
  if (query.conversation !== undefined) {
    if (!mongoose.isValidObjectId(query.conversation)) throw fail(400, "Conversation filter is invalid");
    filter.conversation = query.conversation;
  }
  if (query.role === "tutor") filter.tutor = userId;
  else if (query.role === "learner") filter.learner = userId;
  else if (query.role && query.role !== "all") throw fail(400, "Role filter must be tutor or learner");
  if (query.period === "upcoming") filter.startsAt = { $gte: now };
  else if (query.period === "past") filter.startsAt = { $lt: now };
  else if (query.period && query.period !== "all") throw fail(400, "Period filter must be upcoming or past");

  const page = Number(query.page || 1);
  const limit = Number(query.limit || 20);
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw fail(400, "Page must be positive and page size must be 1–50");
  }
  const [sessions, total] = await Promise.all([
    Session.find(filter).sort({ startsAt: query.period === "past" ? -1 : 1, _id: 1 })
      .skip((page - 1) * limit).limit(limit)
      .populate("skill", "name slug").populate("category", "name slug")
      .populate("tutor learner", "name profileImage"),
    Session.countDocuments(filter)
  ]);
  const entries = sessions.length ? await CreditTransaction.find({
    user: userId, session: { $in: sessions.map(session => session._id) }
  }).select("session amount direction type").lean() : [];
  const bySession = new Map();
  for (const entry of entries) {
    const item = bySession.get(String(entry.session)) || { charged: 0, earned: 0 };
    if (entry.type === "session-charge" && entry.direction === "debit") item.charged += entry.amount;
    if (entry.type === "session-earning" && entry.direction === "credit") item.earned += entry.amount;
    bySession.set(String(entry.session), item);
  }
  for (const session of sessions) {
    session.set("myCreditHistory", bySession.get(String(session._id)) || { charged: 0, earned: 0 }, { strict: false });
  }
  return { sessions, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
}

export async function getAuthorizedSession(sessionId, userId) {
  if (!mongoose.isValidObjectId(sessionId)) throw fail(400, "Session id is invalid");
  const booking = await populateSession(sessionId);
  if (!booking) throw fail(404, "Session not found");
  if (![String(booking.tutor._id), String(booking.learner._id)].includes(String(userId))) throw fail(404, "Session not found");
  return booking;
}

export async function getCalendar({ userId, from, to }) {
  const start = new Date(from);
  const end = new Date(to);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) ||
    end <= start || end - start > 366 * 24 * 60 * 60_000) {
    throw fail(400, "Provide a valid calendar range of at most 366 days");
  }
  const sessions = await Session.find({
    $or: [{ tutor: userId }, { learner: userId }],
    startsAt: { $lt: end },
    endsAt: { $gt: start }
  }).sort({ startsAt: 1 }).populate("skill", "name slug").populate("tutor learner", "name profileImage");
  return sessions;
}
