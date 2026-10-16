export function getAuthCookieName() {
  return process.env.AUTH_COOKIE_NAME || "skill_swap_token";
}

export function getAuthCookieOptions() {
  const sameSite = process.env.AUTH_COOKIE_SAME_SITE || "lax";
  const maxAge = Number(process.env.AUTH_COOKIE_MAX_AGE_MS || 7 * 24 * 60 * 60 * 1000);
  if (!["strict", "lax", "none"].includes(sameSite)) {
    throw new Error("AUTH_COOKIE_SAME_SITE must be strict, lax, or none");
  }
  if (!Number.isInteger(maxAge) || maxAge < 1000 || maxAge > 30 * 24 * 60 * 60 * 1000) {
    throw new Error("AUTH_COOKIE_MAX_AGE_MS must be between 1000 and 2592000000");
  }

  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production" || sameSite === "none",
    sameSite,
    path: "/",
    maxAge
  };
}

export function clearAuthCookie(res) {
  const { maxAge: _maxAge, ...options } = getAuthCookieOptions();
  res.clearCookie(getAuthCookieName(), options);
}
