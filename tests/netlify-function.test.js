import test from "node:test";
import assert from "node:assert/strict";

import netlifyHandler, { config } from "../netlify/functions/alice.mjs";

function aliceRequest(body, method = "POST") {
  return new Request("https://example.netlify.app/api", {
    method,
    headers: { "Content-Type": "application/json" },
    body: method === "POST" ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined
  });
}

const session = {
  session_id: "s-1",
  message_id: 3,
  user_id: "u-1",
  new: false
};

test("Netlify Function: маршрут /api", () => {
  assert.ok([].concat(config.path).includes("/api"));
});

test("Netlify Function: ответ содержит response, session и version", async () => {
  const res = await netlifyHandler(aliceRequest({
    version: "1.0",
    session,
    request: { command: "пинг", original_utterance: "пинг", type: "SimpleUtterance" }
  }));
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /application\/json/);
  const data = await res.json();
  assert.equal(data.version, "1.0");
  assert.equal(data.response.end_session, false);
  assert.match(data.response.text, /Понг/);
  assert.deepEqual(data.session, { session_id: "s-1", message_id: 3, user_id: "u-1" });
});

test("Netlify Function: без GEMINI_API_KEY возвращается корректный ответ Алисы", async () => {
  const saved = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    const res = await netlifyHandler(aliceRequest({
      version: "1.0",
      session,
      request: { command: "расскажи анекдот", type: "SimpleUtterance" }
    }));
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.match(data.response.text, /не настроен/);
    assert.equal(data.session.session_id, "s-1");
  } finally {
    if (saved !== undefined) process.env.GEMINI_API_KEY = saved;
  }
});

test("Netlify Function: некорректный JSON даёт 400 в формате Алисы", async () => {
  const res = await netlifyHandler(aliceRequest("{not json"));
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.equal(data.version, "1.0");
  assert.ok(data.response.text);
  assert.ok(data.session);
});

test("Netlify Function: GET возвращает статус сервиса", async () => {
  const res = await netlifyHandler(aliceRequest(null, "GET"));
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
});

test("Netlify Function: неподдерживаемый метод даёт 405", async () => {
  const res = await netlifyHandler(new Request("https://example.netlify.app/api", { method: "PUT" }));
  assert.equal(res.status, 405);
  assert.equal(res.headers.get("allow"), "GET, POST");
});
