import mongoose from "mongoose";

const reviewSchema = new mongoose.Schema({
  session: { type: mongoose.Schema.Types.ObjectId, ref: "Session", required: true },
  author: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  recipient: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  rating: { type: Number, required: true, min: 1, max: 5 },
  text: { type: String, default: "", maxlength: 1500 }
}, { timestamps: true });

reviewSchema.index({ session: 1, author: 1 }, { unique: true });
reviewSchema.index({ recipient: 1, createdAt: -1 });
reviewSchema.index({ recipient: 1, rating: 1 });

export const Review = mongoose.model("Review", reviewSchema);
