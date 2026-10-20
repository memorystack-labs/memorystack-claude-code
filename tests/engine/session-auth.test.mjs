import test from "node:test";
import assert from "node:assert/strict";
import { createSessionAuthenticator, getRequestAuthHeaders } from "../../src/engine/session-auth.js";

test("reuses one issued session ticket until its refresh window", async () => {
  let now = 1_000_000;
  const calls = [];
  const auth = createSessionAuthenticator({
    baseUrl: "https://memorystack.test/api/v1",
    apiKey: "mem_live_test_key",
    now: () => now,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({ access_token: "msst_v1.payload.signature", expires_in: 300 }), { status: 201 });
    },
  });

  assert.deepEqual(await auth.getCredential(), { credential: "msst_v1.payload.signature", isSessionTicket: true });
  now += 10_000;
  assert.deepEqual(await auth.getCredential(), { credential: "msst_v1.payload.signature", isSessionTicket: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://memorystack.test/api/v1/auth/session");
  assert.equal(calls[0].options.headers.Authorization, "Bearer mem_live_test_key");
});

test("falls back to the opaque API key and backs off when tickets are unavailable", async () => {
  let now = 1_000_000;
  let calls = 0;
  const auth = createSessionAuthenticator({
    baseUrl: "https://memorystack.test/api/v1",
    apiKey: "mem_live_test_key",
    now: () => now,
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify({ error: "not configured" }), { status: 503 });
    },
  });

  assert.deepEqual(await auth.getCredential(), { credential: "mem_live_test_key", isSessionTicket: false });
  assert.deepEqual(await auth.getCredential(), { credential: "mem_live_test_key", isSessionTicket: false });
  assert.equal(calls, 1);
  now += 60_001;
  await auth.getCredential();
  assert.equal(calls, 2);
});

test("uses X-API-Key for signed tickets so public API middleware does not parse them as Clerk Bearer tokens", () => {
  assert.deepEqual(
    getRequestAuthHeaders("msst_v1.payload.signature", true),
    { "X-API-Key": "msst_v1.payload.signature" },
  );
  assert.deepEqual(
    getRequestAuthHeaders("mem_live_test_key", false),
    { Authorization: "Bearer mem_live_test_key" },
  );
});
