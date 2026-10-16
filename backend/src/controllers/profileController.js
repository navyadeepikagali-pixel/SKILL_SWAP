import mongoose from "mongoose";
import { Review } from "../models/Review.js";
import { Skill } from "../models/Skill.js";
import { User } from "../models/User.js";
import { failure, success } from "../utils/responses.js";
import { activeAccountFilter } from "../utils/accountAccess.js";

const PROFILE_FIELDS = [
  "name", "profileImage", "bio", "location", "languages", "interests",
  "experienceLevel", "preferredLearningMode", "availableTimeSlots", "isProfilePublic"
];
const EXPERIENCE = new Set(["beginner", "intermediate", "advanced", "expert"]);
const MODES = new Set(["online", "in-person", "either"]);
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function completion(user) {
  const checks = [
    user.name?.trim().length >= 2,
    Boolean(user.profileImage),
    user.bio?.trim().length >= 20,
    Boolean(user.location?.trim()),
    user.languages?.length > 0,
    user.skillsToTeach?.length > 0,
    user.skillsToLearn?.length > 0,
    user.availableTimeSlots?.length > 0
  ];
  const percent = Math.round(checks.filter(Boolean).length / checks.length * 100);
  return { completed: percent === 100, percent };
}

function ownProfile(user) {
  const result = user.toObject();
  delete result.passwordHash;
  delete result.permissions;
  delete result.__v;
  result.profileCompletion = completion(user);
  return result;
}

function publicProfile(user) {
  return {
    id: user._id,
    name: user.name,
    profileImage: user.profileImage,
    bio: user.bio,
    location: user.location,
    languages: user.languages,
    interests: user.interests,
    experienceLevel: user.experienceLevel,
    preferredLearningMode: user.preferredLearningMode,
    availableTimeSlots: user.availableTimeSlots,
    skillsToTeach: user.skillsToTeach,
    skillsToLearn: user.skillsToLearn,
    createdAt: user.createdAt,
    profileCompletion: completion(user)
  };
}

function validateProfilePatch(body) {
  const updates = {};
  for (const key of PROFILE_FIELDS) {
    if (body[key] !== undefined) updates[key] = body[key];
  }

  if ("name" in updates && (typeof updates.name !== "string" || updates.name.trim().length < 2 || updates.name.trim().length > 80)) {
    return "Name must be between 2 and 80 characters";
  }
  if ("bio" in updates && (typeof updates.bio !== "string" || updates.bio.length > 1000)) return "Bio must be 1000 characters or fewer";
  if ("location" in updates && (typeof updates.location !== "string" || updates.location.length > 120)) return "Location must be 120 characters or fewer";
  if ("profileImage" in updates && (typeof updates.profileImage !== "string" || updates.profileImage.length > 2048)) return "Profile image URL must be 2048 characters or fewer";
  if ("experienceLevel" in updates && !EXPERIENCE.has(updates.experienceLevel)) return "Experience level is invalid";
  if ("preferredLearningMode" in updates && !MODES.has(updates.preferredLearningMode)) return "Preferred learning mode is invalid";
  if ("isProfilePublic" in updates && typeof updates.isProfilePublic !== "boolean") return "Profile visibility must be true or false";

  for (const field of ["languages", "interests"]) {
    if (field in updates && (!Array.isArray(updates[field]) || updates[field].length > 30 ||
      updates[field].some(item => typeof item !== "string" || !item.trim() || item.length > 80))) {
      return `${field} must be a list of up to 30 non-empty values`;
    }
    if (field in updates) updates[field] = [...new Set(updates[field].map(value => value.trim()))];
  }

  if ("availableTimeSlots" in updates) {
    const slots = updates.availableTimeSlots;
    if (!Array.isArray(slots) || slots.length > 50 || slots.some(slot =>
      !slot || !Number.isInteger(slot.dayOfWeek) || slot.dayOfWeek < 0 || slot.dayOfWeek > 6 ||
      typeof slot.startTime !== "string" || !TIME_RE.test(slot.startTime) ||
      typeof slot.endTime !== "string" || !TIME_RE.test(slot.endTime) || slot.endTime <= slot.startTime ||
      (slot.timezone !== undefined && (typeof slot.timezone !== "string" || slot.timezone.length > 80)))) {
      return "Availability must contain valid weekly time slots";
    }
    updates.availableTimeSlots = slots.map(slot => ({
      dayOfWeek: slot.dayOfWeek,
      startTime: slot.startTime,
      endTime: slot.endTime,
      timezone: slot.timezone || "UTC"
    }));
  }

  return { updates };
}

export const profileController = {
  me: (req, res) => success(res, 200, "Profile retrieved", { user: ownProfile(req.user) }),

  updateMe: async (req, res) => {
    const validation = validateProfilePatch(req.body);
    if (typeof validation === "string") return failure(res, 400, validation);
    Object.assign(req.user, validation.updates);
    await req.user.save();
    return success(res, 200, "Profile updated", { user: ownProfile(req.user) });
  },

  publicProfile: async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) return failure(res, 400, "User id is invalid");
    const user = await User.findOne({
      _id: req.params.id,
      ...activeAccountFilter(),
      isProfilePublic: true
    }).populate({
      path: "skillsToTeach skillsToLearn",
      match: { isActive: true },
      select: "name slug description category proficiency",
      populate: { path: "category", select: "name slug" }
    });
    if (!user) return failure(res, 404, "Public profile not found");

    const [rating] = await Review.aggregate([
      { $match: { recipient: user._id } },
      { $group: { _id: null, average: { $avg: "$rating" }, count: { $sum: 1 } } }
    ]);
    return success(res, 200, "Public profile retrieved", {
      user: publicProfile(user),
      rating: rating ? { average: Math.round(rating.average * 100) / 100, count: rating.count } : null
    });
  },

  getSkills: async (req, res) => {
    await req.user.populate([
      { path: "skillsToTeach", match: { isActive: true }, select: "name slug description category proficiency", populate: { path: "category", select: "name slug" } },
      { path: "skillsToLearn", match: { isActive: true }, select: "name slug description category proficiency", populate: { path: "category", select: "name slug" } }
    ]);
    return success(res, 200, "Profile skills retrieved", {
      skillsToTeach: req.user.skillsToTeach,
      skillsToLearn: req.user.skillsToLearn
    });
  },

  replaceSkills: async (req, res) => {
    const { skillsToTeach, skillsToLearn } = req.body;
    if (!Array.isArray(skillsToTeach) || !Array.isArray(skillsToLearn) ||
      skillsToTeach.length > 100 || skillsToLearn.length > 100 ||
      [...skillsToTeach, ...skillsToLearn].some(id => typeof id !== "string" || !mongoose.isValidObjectId(id))) {
      return failure(res, 400, "Provide valid teaching and learning skill id lists");
    }
    const teachIds = [...new Set(skillsToTeach)];
    const learnIds = [...new Set(skillsToLearn)];
    const requestedIds = [...new Set([...teachIds, ...learnIds])];
    const found = await Skill.find({ _id: { $in: requestedIds }, isActive: true }).select("_id");
    if (found.length !== requestedIds.length) return failure(res, 400, "One or more skills do not exist or are inactive");

    req.user.skillsToTeach = teachIds;
    req.user.skillsToLearn = learnIds;
    await req.user.save();
    return success(res, 200, "Profile skills updated", { skillsToTeach: teachIds, skillsToLearn: learnIds });
  },

  removeSkill: async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.skillId)) return failure(res, 400, "Skill id is invalid");
    const skillId = new mongoose.Types.ObjectId(req.params.skillId);
    const wasPresent = req.user.skillsToTeach.some(id => id.equals(skillId)) ||
      req.user.skillsToLearn.some(id => id.equals(skillId));
    if (!wasPresent) return failure(res, 404, "Skill is not on your profile");
    req.user.skillsToTeach = req.user.skillsToTeach.filter(id => !id.equals(skillId));
    req.user.skillsToLearn = req.user.skillsToLearn.filter(id => !id.equals(skillId));
    await req.user.save();
    return success(res, 200, "Skill removed from your profile", {
      skillsToTeach: req.user.skillsToTeach,
      skillsToLearn: req.user.skillsToLearn
    });
  }
};
