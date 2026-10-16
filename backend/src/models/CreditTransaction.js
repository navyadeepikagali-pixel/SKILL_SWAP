import mongoose from "mongoose";
import { randomUUID } from "node:crypto";

const creditTransactionSchema = new mongoose.Schema({
  transactionId: { type: String, required: true, unique: true, default: randomUUID },
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  amount: { type: Number, required: true, min: 1, validate: { validator: Number.isSafeInteger, message: "Credit amount must be a positive integer" } },
  type: { type: String, enum: ["signup-grant", "session-charge", "session-earning", "refund", "admin-adjustment"], required: true },
  direction: { type: String, enum: ["credit", "debit"], required: true, default: "credit" },
  balanceBefore: { type: Number, min: 0 },
  balanceAfter: { type: Number, min: 0 },
  counterparty: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  session: { type: mongoose.Schema.Types.ObjectId, ref: "Session" },
  reference: { type: String, required: true, unique: true },
  settlementReference: { type: String, maxlength: 150, index: true },
  description: { type: String, required: true, maxlength: 300 }
}, { timestamps: true });

creditTransactionSchema.index({ user: 1, createdAt: -1 });
creditTransactionSchema.pre("validate", function validateLedgerEntry(next) {
  if (this.balanceBefore !== undefined && this.balanceAfter !== undefined) {
    const expected = this.direction === "credit"
      ? this.balanceBefore + this.amount
      : this.balanceBefore - this.amount;
    if (this.balanceBefore < 0 || this.balanceAfter < 0 || this.balanceAfter !== expected) {
      this.invalidate("balanceAfter", "Ledger balance snapshots do not match the transaction");
    }
  }
  if (["session-charge", "session-earning"].includes(this.type) && !this.session) {
    this.invalidate("session", "Session ledger transactions require a session reference");
  }
  next();
});
creditTransactionSchema.pre("save", function preventLedgerMutation() {
  if (!this.isNew) throw new Error("Credit ledger entries are immutable");
});
for (const operation of [
  "updateOne", "updateMany", "replaceOne", "findOneAndUpdate", "findOneAndReplace",
  "deleteOne", "deleteMany", "findOneAndDelete", "bulkWrite"
]) {
  creditTransactionSchema.pre(operation, function preventLedgerQueryMutation() {
    throw new Error("Credit ledger entries are immutable");
  });
}

export const CreditTransaction = mongoose.model("CreditTransaction", creditTransactionSchema);
