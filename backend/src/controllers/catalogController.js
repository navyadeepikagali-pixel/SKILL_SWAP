import mongoose from "mongoose";
import { Category } from "../models/Category.js";
import { Skill } from "../models/Skill.js";
import { SkillSuggestion } from "../models/SkillSuggestion.js";
import { failure, success } from "../utils/responses.js";

const slugFor = value => value.trim().toLowerCase().normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export const catalogController = {
  listCategories: async (_req, res) => {
    const categories = await Category.find({ isActive: true })
      .select("name slug description parent")
      .populate("parent", "name slug")
      .sort("name");
    return success(res, 200, "Categories retrieved", { categories });
  },

  getCategory: async (req, res) => {
    const category = await Category.findOne({ slug: req.params.slug, isActive: true })
      .select("name slug description parent")
      .populate("parent", "name slug");
    if (!category) return failure(res, 404, "Category not found");
    return success(res, 200, "Category retrieved", { category });
  },

  getCategorySkills: async (req, res) => {
    const category = await Category.findOne({ slug: req.params.slug, isActive: true }).select("_id name slug");
    if (!category) return failure(res, 404, "Category not found");
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
    const categoryIds = descendants[0]?.ids || [category._id];
    const skills = await Skill.find({ category: { $in: categoryIds }, isActive: true })
      .select("name slug description category")
      .populate("category", "name slug")
      .sort("name");
    return success(res, 200, "Category skills retrieved", { category, skills });
  },

  createCategory: async (req, res) => {
    const { name, description = "", parent = null } = req.body;
    if (typeof name !== "string" || name.trim().length < 2 || name.trim().length > 100 ||
      typeof description !== "string" || description.length > 1000 ||
      (parent !== null && (typeof parent !== "string" || !mongoose.isValidObjectId(parent)))) {
      return failure(res, 400, "Category name, description, or parent is invalid");
    }
    if (parent && !(await Category.exists({ _id: parent, isActive: true }))) return failure(res, 400, "Parent category is unavailable");
    const slug = slugFor(name);
    if (!slug) return failure(res, 400, "Category name must contain letters or numbers");
    const existing = await Category.findOne({ $or: [{ slug }, { name: name.trim() }] });
    if (existing) return failure(res, 409, "A category with that name already exists");
    const category = await Category.create({ name: name.trim(), slug, description: description.trim(), parent, createdBy: req.user._id });
    return success(res, 201, "Category created", { category });
  },

  updateCategory: async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) return failure(res, 400, "Category id is invalid");
    const category = await Category.findById(req.params.id);
    if (!category) return failure(res, 404, "Category not found");
    const { name, description, parent, isActive } = req.body;
    if (name !== undefined) {
      if (typeof name !== "string" || name.trim().length < 2 || name.trim().length > 100 || !slugFor(name)) return failure(res, 400, "Category name is invalid");
      const slug = slugFor(name);
      if (await Category.exists({ _id: { $ne: category._id }, $or: [{ slug }, { name: name.trim() }] })) {
        return failure(res, 409, "A category with that name already exists");
      }
      category.name = name.trim();
      category.slug = slug;
    }
    if (description !== undefined) {
      if (typeof description !== "string" || description.length > 1000) return failure(res, 400, "Category description is invalid");
      category.description = description.trim();
    }
    if (parent !== undefined) {
      if (parent !== null && (typeof parent !== "string" || !mongoose.isValidObjectId(parent))) return failure(res, 400, "Parent category id is invalid");
      if (parent && (parent === String(category._id) || !(await Category.exists({ _id: parent, isActive: true })))) return failure(res, 400, "Parent category is unavailable");
      category.parent = parent;
    }
    if (isActive !== undefined) {
      if (typeof isActive !== "boolean") return failure(res, 400, "Category active state must be true or false");
      category.isActive = isActive;
    }
    await category.save();
    return success(res, 200, "Category updated", { category });
  },

  deactivateCategory: async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) return failure(res, 400, "Category id is invalid");
    const category = await Category.findById(req.params.id);
    if (!category) return failure(res, 404, "Category not found");
    category.isActive = false;
    await category.save();
    return success(res, 200, "Category deactivated", { category });
  },

  createSkill: async (req, res) => {
    const { name, description = "", category } = req.body;
    if (typeof name !== "string" || name.trim().length < 2 || name.trim().length > 100 ||
      typeof description !== "string" || description.length > 1500 ||
      typeof category !== "string" || !mongoose.isValidObjectId(category)) {
      return failure(res, 400, "Skill name, description, or category is invalid");
    }
    if (!(await Category.exists({ _id: category, isActive: true }))) return failure(res, 400, "Category is unavailable");
    const slug = slugFor(name);
    if (!slug) return failure(res, 400, "Skill name must contain letters or numbers");
    if (await Skill.exists({ category, slug })) return failure(res, 409, "This skill already exists in the category");
    const skill = await Skill.create({ name: name.trim().replace(/\s+/g, " "), slug, description: description.trim(), category });
    return success(res, 201, "Skill created", { skill });
  },

  updateSkill: async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) return failure(res, 400, "Skill id is invalid");
    const skill = await Skill.findById(req.params.id);
    if (!skill) return failure(res, 404, "Skill not found");
    const { name, description, category, isActive } = req.body;
    if (name !== undefined) {
      if (typeof name !== "string" || name.trim().length < 2 || name.trim().length > 100 || !slugFor(name)) return failure(res, 400, "Skill name is invalid");
      skill.name = name.trim().replace(/\s+/g, " ");
      skill.slug = slugFor(skill.name);
    }
    if (description !== undefined) {
      if (typeof description !== "string" || description.length > 1500) return failure(res, 400, "Skill description is invalid");
      skill.description = description.trim();
    }
    if (category !== undefined) {
      if (typeof category !== "string" || !mongoose.isValidObjectId(category) ||
        !(await Category.exists({ _id: category, isActive: true }))) return failure(res, 400, "Category is invalid or inactive");
      skill.category = category;
    }
    if (isActive !== undefined) {
      if (typeof isActive !== "boolean") return failure(res, 400, "Skill active state must be true or false");
      skill.isActive = isActive;
    }
    if (await Skill.exists({ _id: { $ne: skill._id }, category: skill.category, slug: skill.slug })) {
      return failure(res, 409, "This skill already exists in the category");
    }
    await skill.save();
    return success(res, 200, "Skill updated", { skill });
  },

  deactivateSkill: async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) return failure(res, 400, "Skill id is invalid");
    const skill = await Skill.findByIdAndUpdate(req.params.id, { $set: { isActive: false } }, { new: true });
    if (!skill) return failure(res, 404, "Skill not found");
    return success(res, 200, "Skill deactivated", { skill });
  },

  suggestSkill: async (req, res) => {
    const { name, category, description = "" } = req.body;
    if (typeof name !== "string" || name.trim().length < 2 || name.trim().length > 100 ||
      typeof category !== "string" || !mongoose.isValidObjectId(category) ||
      typeof description !== "string" || description.length > 1000) {
      return failure(res, 400, "Suggestion name, description, or category is invalid");
    }
    if (!(await Category.exists({ _id: category, isActive: true }))) return failure(res, 400, "Category is unavailable");
    const normalizedName = name.trim().replace(/\s+/g, " ").toLowerCase();
    if (await Skill.exists({ category, slug: slugFor(name) })) return failure(res, 409, "This skill is already in the catalog");
    const suggestion = await SkillSuggestion.create({
      name: name.trim().replace(/\s+/g, " "),
      normalizedName,
      category,
      suggestedBy: req.user._id,
      description: description.trim()
    });
    return success(res, 201, "Skill suggestion submitted for review", { suggestion });
  },

  listSuggestions: async (_req, res) => {
    const suggestions = await SkillSuggestion.find({ status: "pending" })
      .populate("category", "name slug")
      .populate("suggestedBy", "name")
      .sort("-createdAt");
    return success(res, 200, "Pending suggestions retrieved", { suggestions });
  },

  reviewSuggestion: async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) return failure(res, 400, "Suggestion id is invalid");
    if (!["approved", "rejected"].includes(req.body.status)) return failure(res, 400, "Status must be approved or rejected");
    const suggestion = await SkillSuggestion.findOne({ _id: req.params.id, status: "pending" });
    if (!suggestion) return failure(res, 404, "Pending suggestion not found");
    if (req.body.status === "approved") {
      const category = await Category.findOne({ _id: suggestion.category, isActive: true });
      if (!category) return failure(res, 409, "Suggestion category is no longer active");
      const slug = slugFor(suggestion.name);
      if (!(await Skill.exists({ category: category._id, slug }))) {
        await Skill.create({ name: suggestion.name, slug, description: suggestion.description, category: category._id });
      }
    }
    suggestion.status = req.body.status;
    await suggestion.save();
    return success(res, 200, `Suggestion ${req.body.status}`, { suggestion });
  }
};
