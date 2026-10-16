import {
  getWalletSummary,
  getWalletTransaction,
  listWalletTransactions
} from "../services/walletService.js";
import { success } from "../utils/responses.js";

export const walletController = {
  summary: async (req, res) => success(res, 200, "Wallet retrieved", await getWalletSummary(req.user._id)),
  transactions: async (req, res) => success(res, 200, "Wallet transactions retrieved",
    await listWalletTransactions({ userId: req.user._id, query: req.query })),
  transaction: async (req, res) => success(res, 200, "Wallet transaction retrieved", {
    transaction: await getWalletTransaction({ userId: req.user._id, transactionId: req.params.id })
  })
};
