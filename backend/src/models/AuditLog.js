import mongoose from "mongoose";

const auditLogSchema = new mongoose.Schema({
  actor: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
  action: { type: String, required: true, trim: true, maxlength: 120, index: true },
  resourceType: { type: String, required: true, trim: true, maxlength: 80 },
  resourceId: { type: String, default: "", maxlength: 120, index: true },
  outcome: { type: String, enum: ["success", "failure", "denied"], required: true, index: true },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true });

auditLogSchema.index({ createdAt: -1, _id: -1 });
auditLogSchema.pre("save", function preventAuditMutation() {
  if (!this.isNew) throw new Error("Audit logs are immutable");
});
for (const operation of [
  "updateOne", "updateMany", "replaceOne", "findOneAndUpdate", "findOneAndReplace",
  "deleteOne", "deleteMany", "findOneAndDelete", "bulkWrite"
]) {
  auditLogSchema.pre(operation, function preventAuditQueryMutation() {
    throw new Error("Audit logs are immutable");
  });
}

export const AuditLog = mongoose.model("AuditLog", auditLogSchema);
