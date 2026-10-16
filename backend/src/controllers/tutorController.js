import mongoose from "mongoose";
import { Category } from "../models/Category.js";
import { Review } from "../models/Review.js";
import { Skill } from "../models/Skill.js";
import { User } from "../models/User.js";
import { failure, success } from "../utils/responses.js";
import { activeAccountFilter } from "../utils/accountAccess.js";

const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const publicProjection = "name profileImage bio location languages interests experienceLevel preferredLearningMode availableTimeSlots skillsToTeach skillsToLearn createdAt";
const SORTS = {
  newest: { createdAt: -1 },
  name: { name: 1 },
  rating: { ratingAverage: -1, reviewCount: -1, createdAt: -1 }
};

async function getSearchParams(req, res) {
  const {
    q, name, category, skill, subject, experience, language, mode,
    dayOfWeek, availability, minRating, maxRating, page = "1", limit = "12",
    sort = "newest", includeSelf
  } = req.query;
  for (const [label, value] of Object.entries({ q, name, category, skill, subject, experience, language })) {
    if (value !== undefined && (typeof value !== "string" || value.length > (label === "q" || label === "name" ? 80 : 120))) {
      failure(res, 400, `${label} filter is invalid or too long`);
      return null;
    }
    if (experience !== undefined && !["beginner", "intermediate", "advanced", "expert"].includes(experience)) {
      failure(res, 400, "Experience filter is invalid");
      return null;
    }
  }
  const pageNumber = Number(page);
  const pageSize = Number(limit);
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > 100000 ||
    !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50) {
    failure(res, 400, "Pagination values are invalid; page must be positive and limit must be 1–50");
    return null;
  }
  if (!Object.hasOwn(SORTS, sort)) {
    failure(res, 400, "Sort must be newest, name, or rating");
    return null;
  }
  if (mode !== undefined && !["online", "in-person", "either"].includes(mode)) {
    failure(res, 400, "Mode filter is invalid");
    return null;
  }
  if (dayOfWeek !== undefined && (!/^[0-6]$/.test(String(dayOfWeek)))) {
    failure(res, 400, "dayOfWeek must be an integer from 0 through 6");
    return null;
  }
  if (availability !== undefined && !["true", "false"].includes(String(availability))) {
    failure(res, 400, "availability must be true or false");
    return null;
  }
  const min = minRating === undefined ? undefined : Number(minRating);
  const max = maxRating === undefined ? undefined : Number(maxRating);
  if ((min !== undefined && (!Number.isFinite(min) || min < 1 || min > 5)) ||
    (max !== undefined && (!Number.isFinite(max) || max < 1 || max > 5)) ||
    (min !== undefined && max !== undefined && min > max)) {
    failure(res, 400, "Rating filters must be between 1 and 5 and minimum cannot exceed maximum");
    return null;
  }
  return {
    q: q || name,
    category,
    skill: skill || subject,
    experience,
    language,
    mode,
    dayOfWeek: dayOfWeek === undefined ? undefined : Number(dayOfWeek),
    availability,
    minRating: min,
    maxRating: max,
    page: pageNumber,
    limit: pageSize,
    sort,
    includeSelf: includeSelf === "true"
  };
}

async function searchTutors(req, res) {
  const filters = await getSearchParams(req, res);
  if (!filters) return;
  const skillQuery = { isActive: true };

  let categoryIds;
  if (filters.category) {
    const category = mongoose.isValidObjectId(filters.category)
      ? await Category.findOne({ _id: filters.category, isActive: true }).select("_id")
      : await Category.findOne({ slug: filters.category.toLowerCase(), isActive: true }).select("_id");
    if (!category) return success(res, 200, "Tutor search completed", {
      tutors: [], pagination: { page: filters.page, limit: filters.limit, total: 0, pages: 0 }
    });
    const descendants = await Category.aggregate([
      { $match: { _id: category._id } },
      {
        $graphLookup: {
          from: Category.collection.name,
          startWith: "$_id",
          connectFromField: "_id",
          connectToField: "parent",
          as: "descendants",
          restrictSearchWithMatch: { isActive: true }
        }
      },
      { $project: { ids: { $concatArrays: [["$_id"], "$descendants._id"] } } }
    ]);
    categoryIds = descendants[0]?.ids || [category._id];
    skillQuery.category = { $in: categoryIds };
  }

  if (filters.skill) {
    if (mongoose.isValidObjectId(filters.skill)) skillQuery._id = filters.skill;
    else {
      const normalizedSlug = filters.skill.toLowerCase().trim().replace(/\s+/g, "-");
      skillQuery.$or = [
        { slug: normalizedSlug },
        { name: new RegExp(`^${escapeRegex(filters.skill.trim())}$`, "i") }
      ];
    }
  }
  const matchingSkills = await Skill.find(skillQuery).select("_id");
  if (filters.skill && matchingSkills.length === 0) {
    return success(res, 200, "Tutor search completed", {
      tutors: [], pagination: { page: filters.page, limit: filters.limit, total: 0, pages: 0 }
    });
  }

  const match = {
    ...activeAccountFilter(),
    isProfilePublic: true
  };
  if (!filters.includeSelf) match._id = { $ne: req.user._id };
  if (filters.q) match.name = new RegExp(escapeRegex(filters.q.trim()), "i");
  if (matchingSkills.length) match.skillsToTeach = { $in: matchingSkills.map(item => item._id) };
  if (filters.experience) {
    match.experienceLevel = filters.experience;
  }
  if (filters.language) match.languages = new RegExp(`^${escapeRegex(filters.language.trim())}$`, "i");
  if (filters.mode && filters.mode !== "either") match.preferredLearningMode = { $in: [filters.mode, "either"] };
  if (filters.dayOfWeek !== undefined) match["availableTimeSlots.dayOfWeek"] = filters.dayOfWeek;
  if (filters.availability === "true") match["availableTimeSlots.0"] = { $exists: true };
  if (filters.availability === "false") match["availableTimeSlots.0"] = { $exists: false };

  const pipeline = [
    { $match: match },
    {
      $lookup: {
        from: Review.collection.name,
        localField: "_id",
        foreignField: "recipient",
        pipeline: [{ $project: { rating: 1 } }],
        as: "reviewRecords"
      }
    },
    {
      $addFields: {
        ratingAverage: { $avg: "$reviewRecords.rating" },
        reviewCount: { $size: "$reviewRecords" }
      }
    }
  ];
  const ratingMatch = {};
  if (filters.minRating !== undefined) ratingMatch.ratingAverage = { ...ratingMatch.ratingAverage, $gte: filters.minRating };
  if (filters.maxRating !== undefined) ratingMatch.ratingAverage = { ...ratingMatch.ratingAverage, $lte: filters.maxRating };
  if (Object.keys(ratingMatch).length) pipeline.push({ $match: ratingMatch });
  pipeline.push({
    $facet: {
      metadata: [{ $count: "total" }],
      results: [
        { $sort: SORTS[filters.sort] },
        { $skip: (filters.page - 1) * filters.limit },
        { $limit: filters.limit },
        { $project: { passwordHash: 0, email: 0, creditBalance: 0, permissions: 0, reviewRecords: 0, __v: 0 } }
      ]
    }
  });
  const [result] = await User.aggregate(pipeline);
  const items = result?.results || [];
  const users = await User.find({ _id: { $in: items.map(item => item._id) } })
    .select(publicProjection)
    .populate({ path: "skillsToTeach", match: { isActive: true }, select: "name slug description category proficiency", populate: { path: "category", select: "name slug" } });
  const byId = new Map(users.map(user => [String(user._id), user]));
  const tutors = items.map(item => ({
    user: byId.get(String(item._id)),
    rating: item.reviewCount ? { average: Math.round(item.ratingAverage * 100) / 100, count: item.reviewCount } : null
  })).filter(item => item.user);
  const total = result?.metadata[0]?.total || 0;
  return success(res, 200, "Tutor search completed", {
    tutors,
    pagination: { page: filters.page, limit: filters.limit, total, pages: Math.ceil(total / filters.limit) }
  });
}

export const tutorController = {
  list: searchTutors,
  search: searchTutors,

  details: async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) return failure(res, 400, "Tutor id is invalid");
    const user = await User.findOne({
      _id: req.params.id,
      ...activeAccountFilter(),
      isProfilePublic: true
    }).select(publicProjection)
      .populate({ path: "skillsToTeach skillsToLearn", match: { isActive: true }, select: "name slug description category proficiency", populate: { path: "category", select: "name slug" } });
    if (!user) return failure(res, 404, "Public tutor profile not found");

    const [rating] = await Review.aggregate([
      { $match: { recipient: user._id } },
      { $group: { _id: null, average: { $avg: "$rating" }, count: { $sum: 1 } } }
    ]);
    const reviews = await Review.find({ recipient: user._id })
      .select("author rating text createdAt session")
      .populate("author", "name profileImage")
      .populate("session", "title startsAt")
      .sort("-createdAt")
      .limit(20);
    return success(res, 200, "Tutor profile retrieved", {
      tutor: {
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
        createdAt: user.createdAt
      },
      rating: rating ? { average: Math.round(rating.average * 100) / 100, count: rating.count } : null,
      reviews
    });
  }
};
