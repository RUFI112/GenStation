// Базовая модель Gemini по умолчанию
const DEFAULT_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

// Максимальное количество сообщений, сохраняемых в истории диалога
const MAX_HISTORY_MESSAGES = 8;

// Максимальное количество символов для одного сообщения в истории
const MAX_HISTORY_MESSAGE_CHARS = 1000;

// Максимальная длина текстового ответа для протокола Яндекс Диалогов
const MAX_ALICE_TEXT = 1024;

// Общий лимит времени на всю обработку запроса навыка в миллисекундах
const TOTAL_RESPONSE_BUDGET_MS = 3900;

// Лимит времени на быстрый поиск в поисковой системе Serper
const SERPER_TIMEOUT_MS = 750;

// Максимальный бюджет времени на запрос к Gemini
const GEMINI_TIMEOUT_MS = 3100;

// Системный промпт, задающий роль, правила и голосовой стиль ассистента
const SYSTEM_PROMPT = [
  "Ты – голосовой помощник Джимини, работающий на базе нейросети Gemini от Google для Яндекс Алисы.",
  "Твой ответ будет озвучен синтезатором речи на умных колонках и устройствах Яндекса.",
  "Отвечай строго на русском языке, живо, дружелюбно и по существу.",
  "Длина ответа: строго от 1 до 3 емких предложений, без долгих вступлений.",
  "Категорически запрещено использовать разметку Markdown (звездочки, жирный шрифт, решетки заголовков, списки).",
  "Не вставляй веб-ссылки и URL в текст ответа, их невозможно озвучить.",
  "Если к вопросу приложены факты из поиска, используй их для актуальности цифр и событий.",
  "Если информации нет или ответ неизвестен, честно скажи об этом одной фразой."
].join(" ");

// Очистка текста от Markdown-символов, ссылок и служебных тегов
function cleanMarkdown(text) {
  return String(text || "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*+\*([^*]+)\*+\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/^#+\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/[#*^_`~<>]/g, "");
}

// Подготовка текста к озвучиванию и укладывание в лимиты Алисы
function fitAliceText(value) {
  const text = cleanMarkdown(value)
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();

  if (!text) return "Не удалось получить ответ.";
  if (text.length <= MAX_ALICE_TEXT) return text;

  const candidate = text.slice(0, MAX_ALICE_TEXT);
  const sentenceEnd = Math.max(
    candidate.lastIndexOf(". "),
    candidate.lastIndexOf("! "),
    candidate.lastIndexOf("? ")
  );

  if (sentenceEnd >= 250) {
    return candidate.slice(0, sentenceEnd + 1).trim();
  }

  const lastSpace = candidate.slice(0, MAX_ALICE_TEXT - 3).lastIndexOf(" ");
  if (lastSpace > 200) {
    return candidate.slice(0, lastSpace).trim() + "...";
  }

  return candidate.slice(0, MAX_ALICE_TEXT - 3).trim() + "...";
}

// Формирование разметки TTS с естественными паузами и контролем длины
function formatSpeechTts(text) {
  const formatted = String(text || "")
    .replace(/\s*—\s*/g, " - ")
    .replace(/\s+/g, " ")
    .trim();

  return fitAliceText(formatted);
}

// Генерация кнопок быстрых ответов (саджестов) на экранах
function getActionButtons(isHelp = false) {
  if (isHelp) {
    return [
      { title: "Кто ты?", hide: true },
      { title: "Новости технологий", hide: true },
      { title: "Сбросить диалог", hide: true }
    ];
  }
  return [
    { title: "Что нового в мире?", hide: true },
    { title: "Случайный факт", hide: true },
    { title: "Помощь", hide: true }
  ];
}

// Сборка финального JSON-ответа по стандарту протокола Яндекс Диалогов
function aliceResponse(text, options = {}) {
  let endSession = false;
  let history = [];
  let userState = null;
  let buttons = null;

  if (typeof options === "boolean") {
    endSession = options;
    if (arguments.length > 2 && Array.isArray(arguments[2])) history = arguments[2];
    if (arguments.length > 3) userState = arguments[3];
    if (arguments.length > 4) buttons = arguments[4];
  } else if (options && typeof options === "object") {
    endSession = Boolean(options.endSession);
    history = Array.isArray(options.history) ? options.history : [];
    userState = options.userState || null;
    buttons = options.buttons || null;
  }

  const cleanText = fitAliceText(text);
  const cleanTts = formatSpeechTts(text);

  const result = {
    version: "1.0",
    response: {
      text: cleanText,
      tts: cleanTts,
      end_session: Boolean(endSession)
    },
    session_state: { history }
  };

  if (Array.isArray(buttons) && buttons.length > 0) {
    result.response.buttons = buttons;
  }

  if (userState && typeof userState === "object") {
    result.user_state = userState;
  }

  return result;
}

// Нормализация пользовательского текста для сопоставления интентов
function normalizeIntentText(text) {
  return String(text || "")
    .trim()
    .toLowerCase()
    .replace(/[.!?,;:]+$/g, "")
    .trim();
}

// Проверка на команду выхода и завершения сессии
function isExitIntent(text) {
  const normalized = normalizeIntentText(text);
  return /^(хватит|стоп|выход|пока|отмена|закройся|до свидания|завершить|отбой)$/i.test(normalized);
}

// Проверка на запрос помощи или описания возможностей (включая саджест "Кто ты?")
function isHelpIntent(text) {
  const normalized = normalizeIntentText(text);
  return /^(помощь|что ты умеешь|справка|как пользоваться|команды|кто ты)$/i.test(normalized);
}

// Проверка на команду сброса истории диалога (включая саджест "Сбросить диалог")
function isResetIntent(text) {
  const normalized = normalizeIntentText(text);
  return /^(забудь|сброс|сбросить диалог|сбрось диалог|очисти историю|очистить историю|начни сначала|забудь всё|забудь все|сбрось контекст|сбросить контекст)$/i.test(normalized);
}

// Проверка на запрос повтора последней реплики ассистента
function isRepeatIntent(text) {
  const normalized = normalizeIntentText(text);
  return /^(повтори|повтори ответ|что ты сказала|еще раз|ещё раз|повтори пожалуйста)$/i.test(normalized);
}

// Проверка на диагностический запрос доступности (ping)
function isPingIntent(text) {
  const normalized = normalizeIntentText(text);
  return /^(ping|пинг)$/i.test(normalized);
}

// Проверка необходимости веб-поиска (включая саджест "Что нового в мире?")
function isSearchIntent(text) {
  return /\b(latest|today|current|news|weather|price|rate|recent|search|look up)\b|сегодня|сейчас|последн|новост|что нового|погод|курс|найди|поищи|актуальн|сколько стоит|свеж|результат матча/i.test(text);
}

// Нормализация истории сообщений и чередования ролей для Gemini API
function safeHistory(history) {
  if (!Array.isArray(history)) return [];

  const valid = history
    .filter(item => item && (item.role === "user" || item.role === "model") && typeof item.text === "string" && item.text.trim())
    .map(item => ({
      role: item.role,
      text: item.text.trim().slice(0, MAX_HISTORY_MESSAGE_CHARS)
    }));

  const alternated = [];
  for (const msg of valid) {
    if (alternated.length === 0) {
      if (msg.role === "user") alternated.push(msg);
    } else {
      const prev = alternated[alternated.length - 1];
      if (prev.role !== msg.role) {
        alternated.push(msg);
      } else {
        prev.text = `${prev.text}. ${msg.text}`.slice(0, MAX_HISTORY_MESSAGE_CHARS);
      }
    }
  }

  let trimmed = alternated.slice(-MAX_HISTORY_MESSAGES);
  if (trimmed.length > 0 && trimmed[0].role === "model") {
    trimmed = trimmed.slice(1);
  }

  return trimmed;
}

// Выполнение сетевых HTTP-запросов с безопасным контролем таймаута
async function fetchWithTimeout(url, options, timeoutMs) {
  const ms = Math.max(100, timeoutMs);
  let timer;
  let signal = options.signal;

  if (!signal) {
    if (typeof AbortSignal.timeout === "function") {
      signal = AbortSignal.timeout(ms);
    } else {
      const controller = new AbortController();
      timer = setTimeout(() => controller.abort(), ms);
      signal = controller.signal;
    }
  }

  try {
    const response = await fetch(url, { ...options, signal });
    const data = await response.json().catch(() => ({}));
    return { response, data };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Поиск свежих данных в интернете через поисковый API Serper
async function searchWeb(query, timeoutMs) {
  const key = process.env.SERPER_API_KEY;
  if (!key || timeoutMs < 200) return "";

  try {
    const { response, data } = await fetchWithTimeout(
      "https://google.serper.dev/search",
      {
        method: "POST",
        headers: {
          "X-API-KEY": key,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ q: query, gl: "ru", hl: "ru", num: 3 })
      },
      Math.min(SERPER_TIMEOUT_MS, timeoutMs)
    );

    if (!response.ok) return "";

    const items = [];
    const answerBox = data.answerBox?.answer || data.answerBox?.snippet;
    if (answerBox) {
      items.push(`Ответ поисковика: ${String(answerBox).slice(0, 250)}`);
    }

    if (Array.isArray(data.organic)) {
      for (const item of data.organic.slice(0, 3)) {
        const title = String(item.title || "").slice(0, 120);
        const snippet = String(item.snippet || "").slice(0, 200);
        if (title || snippet) {
          items.push(`${title}: ${snippet}`.trim());
        }
      }
    }

    return items.join("; ");
  } catch {
    return "";
  }
}

// Генерация ответа через Gemini REST API
async function askGemini(text, history, searchContext, timeoutMs) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("MISSING_GEMINI_KEY");
  if (timeoutMs < 300) throw new Error("TIME_BUDGET_EXHAUSTED");

  const model = String(DEFAULT_MODEL).trim();
  const normalizedHistory = safeHistory(history);

  const contents = normalizedHistory.map(item => ({
    role: item.role,
    parts: [{ text: item.text }]
  }));

  const userPrompt = searchContext
    ? `${text}\n\n[Актуальные факты из интернета]: ${searchContext}`
    : text;

  if (contents.length > 0 && contents[contents.length - 1].role === "user") {
    contents[contents.length - 1].parts[0].text += `\n${userPrompt}`;
  } else {
    contents.push({ role: "user", parts: [{ text: userPrompt }] });
  }

  const { response, data } = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": key
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents,
        generationConfig: {
          maxOutputTokens: 250,
          temperature: 0.7
        }
      })
    },
    Math.min(GEMINI_TIMEOUT_MS, timeoutMs)
  );

  if (!response.ok) {
    const status = Number(response.status);
    if (status === 401 || status === 403) throw new Error("GEMINI_KEY_REJECTED");
    if (status === 429) throw new Error("GEMINI_QUOTA");
    throw new Error("GEMINI_REQUEST_FAILED");
  }

  const answer = (data?.candidates?.[0]?.content?.parts || [])
    .map(p => (typeof p.text === "string" ? p.text : ""))
    .join("")
    .trim();

  if (!answer) {
    if (data?.promptFeedback?.blockReason) throw new Error("GEMINI_BLOCKED");
    throw new Error("GEMINI_EMPTY_RESPONSE");
  }

  return cleanMarkdown(answer);
}

// Сопоставление технических кодов ошибок с понятными фразами для Алисы
function errorForUser(error) {
  const msg = error?.name === "AbortError" ? "TIME_BUDGET_EXHAUSTED" : error?.message;

  switch (msg) {
    case "MISSING_GEMINI_KEY":
      return "Навык ещё не настроен: добавьте ключ GEMINI_API_KEY в переменные окружения.";
    case "GEMINI_KEY_REJECTED":
      return "Ошибка авторизации: ключ Gemini API недействителен.";
    case "GEMINI_QUOTA":
      return "Лимит обращений к нейросети временно исчерпан. Пожалуйста, попробуйте чуть позже.";
    case "GEMINI_BLOCKED":
      return "Я не могу дать ответ на этот вопрос по правилам безопасности. Спросите что-нибудь ещё.";
    case "TIME_BUDGET_EXHAUSTED":
      return "Не успела получить ответ вовремя. Попробуйте спросить покороче.";
    default:
      return "Произошла временная заминка со связью. Попробуйте повторить запрос.";
  }
}

// Основная точка входа для обработки вебхуков от Яндекс Диалогов
export default async function handler(req, res) {
  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      status: "ok",
      service: "alice-gemini-skill",
      model: DEFAULT_MODEL
    });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const startedAt = Date.now();
  const remainingMs = () => TOTAL_RESPONSE_BUDGET_MS - (Date.now() - startedAt);

  const body = req.body && typeof req.body === "object" ? req.body : {};
  const isNewSession = Boolean(body?.session?.new);
  
  const payloadText = typeof body?.request?.payload === "string" 
    ? body.request.payload 
    : (body?.request?.payload?.title || "");
  const text = String(body?.request?.command || body?.request?.original_utterance || payloadText || "").trim();

  const userState = body?.state?.user && typeof body.state.user === "object" ? body.state.user : {};
  const currentHistory = isNewSession
    ? []
    : safeHistory(body?.state?.session?.history || userState.history);

  // Первый вход в навык
  if (isNewSession && !text) {
    return res.status(200).json(aliceResponse(
      "Привет! Я Джимини. Задавайте любой вопрос, и я быстро отвечу или найду нужную информацию в сети.",
      {
        endSession: false,
        history: [],
        userState,
        buttons: getActionButtons(false)
      }
    ));
  }

  // Пустой запрос
  if (!text) {
    return res.status(200).json(aliceResponse(
      "Я вас слушаю. Задайте вопрос или попросите что-нибудь найти.",
      {
        endSession: false,
        history: currentHistory,
        userState,
        buttons: getActionButtons(false)
      }
    ));
  }

  // Диагностический пинг навыка
  if (isPingIntent(text)) {
    return res.status(200).json(aliceResponse(
      "Понг! Сервис работает в штатном режиме.",
      {
        endSession: false,
        history: currentHistory,
        userState,
        buttons: getActionButtons(false)
      }
    ));
  }

  // Завершение диалога
  if (isExitIntent(text)) {
    return res.status(200).json(aliceResponse(
      "До встречи! Обращайтесь, если снова понадобится помощь.",
      {
        endSession: true,
        history: [],
        userState
      }
    ));
  }

  // Справка
  if (isHelpIntent(text)) {
    return res.status(200).json(aliceResponse(
      "Я умею отвечать на любые вопросы с помощью нейросети Gemini, а также искать свежие факты и курсы валют в интернете. Просто спросите то, что вам интересно.",
      {
        endSession: false,
        history: currentHistory,
        userState,
        buttons: getActionButtons(true)
      }
    ));
  }

  // Сброс контекста
  if (isResetIntent(text)) {
    const clearedUserState = { ...userState, history: [] };
    return res.status(200).json(aliceResponse(
      "Память диалога очищена. Можем начать общение с чистого листа!",
      {
        endSession: false,
        history: [],
        userState: clearedUserState,
        buttons: getActionButtons(false)
      }
    ));
  }

  // Повтор последней реплики
  if (isRepeatIntent(text)) {
    const lastModelMessage = [...currentHistory].reverse().find(m => m.role === "model");
    if (lastModelMessage?.text) {
      return res.status(200).json(aliceResponse(
        lastModelMessage.text,
        {
          endSession: false,
          history: currentHistory,
          userState,
          buttons: getActionButtons(false)
        }
      ));
    }
  }

  try {
    let searchContext = "";

    if (isSearchIntent(text) && process.env.SERPER_API_KEY) {
      searchContext = await searchWeb(
        text,
        Math.min(SERPER_TIMEOUT_MS, Math.max(0, remainingMs() - 2500))
      );
    }

    const answer = await askGemini(
      text,
      currentHistory,
      searchContext,
      Math.max(0, Math.min(GEMINI_TIMEOUT_MS, remainingMs() - 350))
    );

    const updatedHistory = safeHistory([
      ...currentHistory,
      { role: "user", text: text.slice(0, MAX_HISTORY_MESSAGE_CHARS) },
      { role: "model", text: answer.slice(0, MAX_HISTORY_MESSAGE_CHARS) }
    ]);

    const newUserState = {
      ...userState,
      history: updatedHistory
    };

    return res.status(200).json(aliceResponse(
      answer,
      {
        endSession: false,
        history: updatedHistory,
        userState: newUserState,
        buttons: getActionButtons(false)
      }
    ));
  } catch (error) {
    return res.status(200).json(aliceResponse(
      errorForUser(error),
      {
        endSession: false,
        history: currentHistory,
        userState,
        buttons: getActionButtons(false)
      }
    ));
  }
}

export {
  aliceResponse,
  fitAliceText,
  formatSpeechTts,
  cleanMarkdown,
  isSearchIntent,
  isExitIntent,
  isHelpIntent,
  isResetIntent,
  isRepeatIntent,
  isPingIntent,
  safeHistory
};
