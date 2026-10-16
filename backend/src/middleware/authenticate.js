import jwt from "jsonwebtoken";
import { User } from "../models/User.js";
import { failure } from "../utils/responses.js";
import { getAuthCookieName } from "../utils/authCookies.js";
import { activeAccountFilter } from "../utils/accountAccess.js";

export async function authenticate(req, res, next) {
  try {
    const token = req.cookies[getAuthCookieName()];
    if (!token) return failure(res, 401, "Authentication required");

    const payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ["HS256"] });
    const user = await User.findOne({ _id: payload.sub, ...activeAccountFilter() });
    if (!user) return failure(res, 401, "Authentication required");

    req.user = user;
    return next();
  } catch (error) {
    if (error.name === "JsonWebTokenError" || error.name === "TokenExpiredError") {
      return failure(res, 401, "Authentication required");
    }
    return next(error);
  }
}
