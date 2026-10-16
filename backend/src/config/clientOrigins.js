const localIpv4 = host => {
  const octets = host.split(".").map(Number);
  if (octets.length !== 4 || octets.some(value => !Number.isInteger(value) || value < 0 || value > 255)) {
    return false;
  }
  return octets[0] === 10 ||
    octets[0] === 192 && octets[1] === 168 ||
    octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31;
};

export function getClientOrigin() {
  return process.env.CLIENT_URL || process.env.RENDER_EXTERNAL_URL ||
    (process.env.NODE_ENV === "production" ? "" : "http://localhost:5173");
}

export function isAllowedClientOrigin(origin, configuredOrigin, development = process.env.NODE_ENV !== "production") {
  if (origin === configuredOrigin) return true;
  if (!development || !origin) return false;

  let url;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }

  if (url.protocol !== "http:" || url.port !== "5173" || url.origin !== origin) return false;
  const host = url.hostname.toLowerCase();
  return host === "localhost" ||
    host === "127.0.0.1" ||
    host === "[::1]" ||
    localIpv4(host);
}
