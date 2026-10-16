import "./config/env.js";
import bcrypt from "bcrypt";
import mongoose from "mongoose";
import { User } from "./models/User.js";
import { connectDatabase, disconnectDatabase } from "./config/database.js";

async function provisionAdmin() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME?.trim();
  if (!email || !password || !name) {
    throw new Error("Set ADMIN_EMAIL, ADMIN_PASSWORD, and ADMIN_NAME in the protected server environment before provisioning");
  }
  if (password.length < 16 || password.length > 128) {
    throw new Error("ADMIN_PASSWORD must be 16–128 characters");
  }
  await connectDatabase();
  const existing = await User.findOne({ email });
  if (existing) throw new Error("An account with ADMIN_EMAIL already exists; provisioning will not promote or overwrite it");
  const passwordHash = await bcrypt.hash(password, 12);
  await User.create({
    name,
    email,
    passwordHash,
    isEmailVerified: true,
    accountStatus: "active",
    accountType: "admin",
    creditBalance: 0,
    permissions: []
  });
  console.info(`Provisioned administrator account for ${email}`);
}

provisionAdmin().catch(error => {
  console.error(`Administrator provisioning failed: ${error.message}`);
  process.exitCode = 1;
}).finally(async () => {
  if (mongoose.connection.readyState !== 0) await disconnectDatabase();
});
