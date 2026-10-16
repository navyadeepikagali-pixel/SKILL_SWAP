import "./config/env.js";
import mongoose from "mongoose";
import { connectDatabase, disconnectDatabase } from "./config/database.js";
import { Category } from "./models/Category.js";
import { Skill } from "./models/Skill.js";

const catalog = [
  {
    name: "Technology and Programming",
    description: "Software development, engineering, and digital technology.",
    groups: [
      { name: "Web Development", skills: ["HTML", "CSS", "JavaScript", "TypeScript", "React", "Node.js", "Express.js", "MongoDB", "MERN Stack", "Git", "GitHub", "Web development"] },
      { name: "Programming Languages", skills: ["Python", "Java", "C", "C++", "C#"] },
      { name: "Computer Science", skills: ["SQL", "Data structures", "Algorithms", "AI fundamentals", "Machine learning", "Cybersecurity", "App development"] }
    ]
  },
  {
    name: "Education",
    description: "Academic subjects, tutoring, and exam preparation.",
    groups: [
      { name: "School and College Subjects", skills: ["Mathematics", "Physics", "Chemistry", "Biology", "English", "Computer science"] },
      { name: "Languages", skills: ["Telugu", "Hindi", "Spoken English"] },
      { name: "Exam Preparation", skills: ["School subjects", "College subjects", "Competitive exam preparation"] }
    ]
  },
  {
    name: "Music and Performing Arts",
    description: "Music, singing, dance, and performance.",
    groups: [
      { name: "Music", skills: ["Singing", "Guitar", "Piano", "Musical instruments"] },
      { name: "Dance", skills: ["Dance", "Classical dance", "Contemporary dance"] }
    ]
  },
  {
    name: "Visual Arts and Media",
    description: "Creative visual arts, crafts, photography, and media.",
    groups: [
      { name: "Visual Arts", skills: ["Drawing", "Painting", "Crafts"] },
      { name: "Photography and Video", skills: ["Photography", "Video editing"] }
    ]
  },
  {
    name: "Wellness and Fitness",
    description: "Mindfulness, movement, and wellbeing.",
    groups: [
      { name: "Wellness", skills: ["Fitness", "Yoga", "Meditation"] }
    ]
  },
  {
    name: "Food and Cooking",
    description: "Cooking and baking skills.",
    groups: [
      { name: "Cooking", skills: ["Cooking", "Baking"] }
    ]
  },
  {
    name: "Games and Communication",
    description: "Games, communication, and professional skills.",
    groups: [
      { name: "Games", skills: ["Chess", "Gaming"] },
      { name: "Career and Business", skills: ["Communication", "Interview preparation", "Public speaking", "Business", "Entrepreneurship"] }
    ]
  }
];

const slugFor = value => value.trim().toLowerCase().normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

await connectDatabase();
try {
  let categoryCount = 0;
  let skillCount = 0;
  for (const parent of catalog) {
    const root = await Category.findOneAndUpdate(
      { slug: slugFor(parent.name) },
      { $setOnInsert: { name: parent.name, slug: slugFor(parent.name), description: parent.description, parent: null, isActive: true } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    categoryCount += 1;
    for (const group of parent.groups) {
      const category = await Category.findOneAndUpdate(
        { slug: slugFor(group.name) },
        { $setOnInsert: { name: group.name, slug: slugFor(group.name), description: `${group.name} skills`, parent: root._id, isActive: true } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      categoryCount += 1;
      for (const name of group.skills) {
        await Skill.updateOne(
          { category: category._id, slug: slugFor(name) },
          { $setOnInsert: { name, slug: slugFor(name), category: category._id, description: "", isActive: true } },
          { upsert: true, runValidators: true }
        );
        skillCount += 1;
      }
    }
  }
  console.info(`Catalog seed complete (${categoryCount} category checks, ${skillCount} skill checks; reruns are idempotent).`);
} finally {
  await disconnectDatabase();
  await mongoose.connection.close();
}
