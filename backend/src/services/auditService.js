import mongoose from "mongoose";
import { AuditLog } from "../models/AuditLog.js";

export async function recordAudit({
  actor = null, action, resourceType, resourceId = "", outcome = "success", metadata = {}, session
}) {
  if (!["success", "failure", "denied"].includes(outcome)) throw new Error("Audit outcome is invalid");
  const values = {
    actor: actor && mongoose.isValidObjectId(actor) ? actor : null,
    action: String(action).slice(0, 120),
    resourceType: String(resourceType).slice(0, 80),
    resourceId: String(resourceId || "").slice(0, 120),
    outcome,
    metadata
  };
  const [record] = await AuditLog.create([values], session ? { session } : {});
  return record;
}
