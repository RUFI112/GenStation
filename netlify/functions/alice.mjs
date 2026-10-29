// Netlify Function: вебхук навыка Яндекс Алисы.
// Адаптирует Web API Request/Response к существующему обработчику api/index.js (формат req/res),
// поэтому вся логика навыка (Gemini, Serper, интенты, история) остаётся в одном месте.
import handler, { aliceResponse } from "../../api/index.js";

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store"
};

// Эхо сессии из запроса Алисы для поля session в ответе
function sessionFrom(body) {
  const session = body?.session && typeof body.session === "object" ? body.session : {};
  return {
    session_id: String(session.session_id || ""),
    message_id: Number.isFinite(session.message_id) ? session.message_id : 0,
    user_id: String(session.user?.user_id || session.user_id || session.application?.application_id || "")
  };
}

// Гарантия полей version, response и session в ответе протокола Яндекс Диалогов
function withSession(payload, body) {
  if (!payload || typeof payload !== "object" || !payload.response) return payload;
  return { ...payload, version: payload.version || "1.0", session: sessionFrom(body) };
}

function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders }
  });
}

// Минимальная реализация res в стиле Vercel/Express для вызова существующего обработчика
function createResponseCollector() {
  return {
    statusCode: 200,
    headers: {},
    payload: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(key, value) {
      this.headers[key] = value;
      return this;
    },
    json(data) {
      this.payload = data;
      return this;
    }
  };
}

export default async (req) => {
  let body = {};

  if (req.method === "POST") {
    const raw = await req.text().catch(() => "");
    if (raw.trim()) {
      try {
        body = JSON.parse(raw);
      } catch {
        return jsonResponse(
          withSession(aliceResponse("Не удалось разобрать запрос: ожидается JSON навыка Алисы."), {}),
          400
        );
      }
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) body = {};
  }

  const res = createResponseCollector();

  try {
    await handler({ method: req.method, headers: Object.fromEntries(req.headers), body }, res);
  } catch (error) {
    // Логируем только тип/код ошибки, без тела запроса и переменных окружения
    console.error("alice handler failed:", error?.name || "Error", error?.message || "");
    return jsonResponse(
      withSession(aliceResponse("Произошла временная заминка. Попробуйте повторить запрос."), body),
      200
    );
  }

  if (res.payload === undefined) {
    return jsonResponse({ error: "Empty response" }, 500);
  }

  return jsonResponse(withSession(res.payload, body), res.statusCode, res.headers);
};

export const config = {
  path: ["/api", "/api/"]
};
