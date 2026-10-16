import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";

test("development API root points to the frontend and health endpoint", async () => {
  const { createApp } = await import("../src/app.js");
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
  try {
    const response = await request(createApp()).get("/");
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, {
      success: true,
      message: "Skill Swap API is running",
      data: {
        service: "skill-swap-api",
        frontend: "http://localhost:5173",
        health: "/api/health"
      }
    });
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
});

test("API health route returns the standard success envelope", async () => {
  const { app } = await import("../src/app.js");
  const response = await request(app).get("/api/health");
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    success: true,
    message: "Service is healthy",
    data: { status: "ok", service: "skill-swap-api" }
  });
});

test("production unknown API routes keep the JSON API error instead of returning the app shell", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    const { createApp } = await import("../src/app.js");
    const response = await request(createApp()).get("/api/not-a-route");
    assert.equal(response.status, 404);
    assert.equal(response.body.success, false);
    assert.equal(response.body.message, "API route not found: GET /not-a-route");
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
});
