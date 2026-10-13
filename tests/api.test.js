import test from "node:test";
import assert from "node:assert/strict";

// Динамический импорт модуля с поддержкой разных путей расположения файла
let apiModule;
try {
  apiModule = await import("../api/index.js");
} catch {
  try {
    apiModule = await import("../index.js");
  } catch {
    apiModule = await import("./index.js");
  }
}

const {
  aliceResponse,
  fitAliceText,
  formatSpeechTts,
  cleanMarkdown,
  isSearchIntent,
  isExitIntent,
  isHelpIntent,
  isResetIntent,
  safeHistory
} = apiModule;

const handler = apiModule.default;

// Вспомогательная функция для эмуляции HTTP-объекта ответа сервера
function createMockResponse() {
  return {
    statusCode: 200,
    headers: {},
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.payload = data;
      return data;
    },
    setHeader(key, value) {
      this.headers[key] = value;
      return this;
    }
  };
}


// Проверка стандартного формата ответа Яндекс Диалогов с позиционными аргументами
test("Формирование ответа Алисы: проверка версии, текста и сохранения истории", () => {
  const result = aliceResponse("Привет", false, [{ role: "user", text: "тест" }]);
  assert.equal(result.version, "1.0");
  assert.equal(result.response.text, "Привет");
  assert.equal(result.response.tts, "Привет");
  assert.equal(result.response.end_session, false);
  assert.deepEqual(result.session_state.history, [{ role: "user", text: "тест" }]);
});

// Проверка передачи конфигурации ответа через объект параметров с кнопками саджестов
test("Формирование ответа Алисы: поддержка объекта параметров, кнопок и user_state", () => {
  const options = {
    endSession: true,
    history: [{ role: "model", text: "Пока!" }],
    userState: { visits: 5 },
    buttons: [{ title: "Справка", hide: true }]
  };
  const result = aliceResponse("До свидания!", options);
  assert.equal(result.response.end_session, true);
  assert.equal(result.response.buttons.length, 1);
  assert.equal(result.user_state.visits, 5);
  assert.deepEqual(result.session_state.history, options.history);
});


// Очистка текста от Markdown символов, ссылок и заголовков
test("Очистка разметки: удаление звездочек, ссылок, решеток и обратных кавычек", () => {
  const rawText = "### Заголовок\n**Жирный текст**, _курсив_, `код` и ссылка [сайт](https://example.com).";
  const cleaned = cleanMarkdown(rawText);
  assert.ok(!cleaned.includes("**"));
  assert.ok(!cleaned.includes("###"));
  assert.ok(!cleaned.includes("https://"));
  assert.ok(cleaned.includes("Жирный текст"));
});

// Форматирование текста для голосового движка с правильными паузами на тире
test("Подготовка TTS речи: замена длинного тире на дефис с пробелами для естественной паузы", () => {
  const speech = formatSpeechTts("Москва — столица России.");
  assert.equal(speech, "Москва - столица России.");
});

// Обрезка длинного сообщения строго по границе законченного предложения до 1024 символов
test("Обрезка текста: укладывание длинного ответа в лимит 1024 символов без обрыва слова", () => {
  const value = fitAliceText(("Это короткое предложение. ").repeat(100));
  assert.ok(value.length <= 1024);
  assert.ok(value.endsWith("."));
});


// Распознавание поискового намерения для запросов свежей информации и курсов
test("Определение поискового намерения: срабатывание на погоду, новости и свежие данные", () => {
  assert.equal(isSearchIntent("Какая погода сегодня в Москве?"), true);
  assert.equal(isSearchIntent("What is the latest tech news?"), true);
  assert.equal(isSearchIntent("Сколько стоит доллар?"), true);
  assert.equal(isSearchIntent("Расскажи интересную сказку"), false);
});

// Распознавание команд завершения диалога и прощания
test("Определение намерения выхода: распознавание команд завершения сессии", () => {
  assert.equal(isExitIntent("хватит"), true);
  assert.equal(isExitIntent("стоп"), true);
  assert.equal(isExitIntent("пока"), true);
  assert.equal(isExitIntent("до свидания"), true);
  assert.equal(isExitIntent("расскажи анекдот"), false);
});

// Распознавание команд вызова справки и описания умений
test("Определение намерения справки: распознавание запросов помощи и команд", () => {
  assert.equal(isHelpIntent("помощь"), true);
  assert.equal(isHelpIntent("что ты умеешь"), true);
  assert.equal(isHelpIntent("справка"), true);
  assert.equal(isHelpIntent("кто президент"), false);
});

// Распознавание команд сброса истории и очистки контекста
test("Определение сброса контекста: распознавание команд очистки памяти беседы", () => {
  assert.equal(isResetIntent("забудь"), true);
  assert.equal(isResetIntent("сброс"), true);
  assert.equal(isResetIntent("очисти историю"), true);
  assert.equal(isResetIntent("напомни правило"), false);
});


// Нормализация истории: фильтрация недопустимых ролей и удержание лимита 8 сообщений
test("Очистка истории: фильтрация мусорных записей и сохранение последних сообщений", () => {
  const input = [
    { role: "user", text: "1" },
    { role: "model", text: "2" },
    { role: "hacker", text: "ignore" },
    { role: "user", text: null },
    { role: "user", text: "3" },
    { role: "model", text: "4" }
  ];
  const result = safeHistory(input);
  assert.equal(result.length, 4);
  assert.equal(result[0].text, "1");
  assert.equal(result[3].text, "4");
});

// Исправление багов дублирования ролей: объединение реплик пользователя подряд
test("Чередование ролей в истории: предотвращение ошибки двух сообщений user подряд", () => {
  const input = [
    { role: "user", text: "Первая часть вопроса" },
    { role: "user", text: "Вторая часть вопроса" },
    { role: "model", text: "Ответ модели" }
  ];
  const result = safeHistory(input);
  assert.equal(result.length, 2);
  assert.equal(result[0].role, "user");
  assert.ok(result[0].text.includes("Первая часть вопроса"));
  assert.ok(result[0].text.includes("Вторая часть вопроса"));
  assert.equal(result[1].role, "model");
});


// Проверка работоспособности сервиса по GET-запросу
test("GET запрос проверки статуса: возврат кода 200 и идентификатора сервиса", async () => {
  const res = createMockResponse();
  await handler({ method: "GET" }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.ok, true);
  assert.equal(res.payload.status, "ok");
  assert.ok(typeof res.payload.service === "string");
});


// Проверка приветствия при первом входе пользователя в навык
test("Стартовый запрос к навыку: возврат приветствия и кнопок саджестов без вызова внешних API", async () => {
  const res = createMockResponse();
  const req = {
    method: "POST",
    body: {
      session: { new: true },
      request: { command: "", original_utterance: "" },
      state: { session: { history: [] } }
    }
  };

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.version, "1.0");
  assert.match(res.payload.response.text, /Привет|Джимини/i);
  assert.equal(res.payload.response.end_session, false);
  assert.ok(Array.isArray(res.payload.response.buttons));
});

// Проверка выхода из навыка с выставлением end_session = true
test("Команда выхода: корректное завершение сессии по команде стоп или пока", async () => {
  const res = createMockResponse();
  const req = {
    method: "POST",
    body: {
      session: { new: false },
      request: { command: "пока", original_utterance: "пока" },
      state: { session: { history: [] } }
    }
  };

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.response.end_session, true);
  assert.match(res.payload.response.text, /встречи|помощь/i);
});

// Проверка сброса контекста диалога и очистки состояния пользователя
test("Команда сброса диалога: очистка памяти беседы и user_state", async () => {
  const res = createMockResponse();
  const req = {
    method: "POST",
    body: {
      session: { new: false },
      request: { command: "сбрось контекст", original_utterance: "сбрось контекст" },
      state: {
        user: { history: [{ role: "user", text: "старый вопрос" }] },
        session: { history: [] }
      }
    }
  };

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.response.end_session, false);
  assert.deepEqual(res.payload.user_state.history, []);
  assert.match(res.payload.response.text, /очищена|листа/i);
});

// Проверка блокировки неподдерживаемых HTTP методов
test("Проверка запрещенных HTTP методов: возврат ошибки 405 Method Not Allowed", async () => {
  const res = createMockResponse();
  await handler({ method: "DELETE" }, res);

  assert.equal(res.statusCode, 405);
  assert.equal(res.payload.error, "Method not allowed");
  assert.equal(res.headers.Allow, "GET, POST");
});
