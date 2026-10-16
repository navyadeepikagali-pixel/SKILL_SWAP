import test from "node:test";
import assert from "node:assert/strict";
import { getClientOrigin, isAllowedClientOrigin } from "../src/config/clientOrigins.js";

test("client origin uses Render's public URL when no explicit origin is configured", () => {
  const previous = {
    clientUrl: process.env.CLIENT_URL,
    renderUrl: process.env.RENDER_EXTERNAL_URL,
    nodeEnv: process.env.NODE_ENV
  };
  try {
    delete process.env.CLIENT_URL;
    process.env.RENDER_EXTERNAL_URL = "https://skill-swap.onrender.com";
    process.env.NODE_ENV = "production";
    assert.equal(getClientOrigin(), "https://skill-swap.onrender.com");
  } finally {
    if (previous.clientUrl === undefined) delete process.env.CLIENT_URL;
    else process.env.CLIENT_URL = previous.clientUrl;
    if (previous.renderUrl === undefined) delete process.env.RENDER_EXTERNAL_URL;
    else process.env.RENDER_EXTERNAL_URL = previous.renderUrl;
    if (previous.nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous.nodeEnv;
  }
});

test("development allows loopback and private-LAN frontend origins", () => {
  const configuredOrigin = "http://localhost:5173";
  assert.equal(isAllowedClientOrigin(configuredOrigin, configuredOrigin), true);
  assert.equal(isAllowedClientOrigin("http://127.0.0.1:5173", configuredOrigin), true);
  assert.equal(isAllowedClientOrigin("http://192.168.1.25:5173", configuredOrigin), true);
  assert.equal(isAllowedClientOrigin("http://10.0.0.4:5173", configuredOrigin), true);
  assert.equal(isAllowedClientOrigin("http://172.20.1.2:5173", configuredOrigin), true);
  assert.equal(isAllowedClientOrigin("http://172.40.1.2:5173", configuredOrigin), false);
  assert.equal(isAllowedClientOrigin("http://192.168.1.25:5174", configuredOrigin), false);
  assert.equal(isAllowedClientOrigin("https://192.168.1.25:5173", configuredOrigin), false);
});

test("production only allows its configured frontend origin", () => {
  const configuredOrigin = "https://skills.example.com";
  assert.equal(isAllowedClientOrigin(configuredOrigin, configuredOrigin, false), true);
  assert.equal(isAllowedClientOrigin("http://localhost:5173", configuredOrigin, false), false);
  assert.equal(isAllowedClientOrigin("https://other.example.com", configuredOrigin, false), false);
});
