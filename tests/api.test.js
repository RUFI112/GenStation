import test from "node:test";
import assert from "node:assert/strict";

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
  isRepeatIntent,
  isPingIntent,
  safeHistory
} = apiModule;

const handler = apiModule.default;

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

test("Формирование ответа Алисы: проверка версии, текста и сохранения истории", () => {
  const result = aliceResponse("Привет", false, [{ role: "user", text: "тест" }]);
  assert.equal(result.version, "1.0");
  assert.equal(result.response.text, "Привет");
  assert.equal(result.response.tts, "Привет");
  assert.equal(result.response.end_session, false);
  assert.deepEqual(result.session_state.history, [{ role: "user", text: "тест" }]);
});

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

test("Очистка разметки: удаление звездочек, ссылок, решеток и обратных кавычек", () => {
  const rawText = "### Заголовок\n**Жирный текст**, _курсив_, `код` и ссылка [сайт](https://example.com).";
  const cleaned = cleanMarkdown(rawText);
  assert.ok(!cleaned.includes("**"));
  assert.ok(!cleaned.includes("###"));
  assert.ok(!cleaned.includes("https://"));
  assert.ok(cleaned.includes("Жирный текст"));
});

test("Подготовка TTS речи: замена длинного тире на дефис с пробелами для естественной паузы", () => {
  const speech = formatSpeechTts("Москва — столица России.");
  assert.equal(speech, "Москва - столица России.");
});

test("Обрезка текста: укладывание длинного ответа в лимит 1024 символов без обрыва слова", () => {
  const value = fitAliceText(("Это короткое предложение. ").repeat(100));
  assert.ok(value.length <= 1024);
  assert.ok(value.endsWith("."));
});

test("Обрезка текста: жесткое соблюдение лимита 1024 символов для неразрывного текста без пробелов", () => {
  const longWord = "a".repeat(1100);
  const fitted = fitAliceText(longWord);
  assert.ok(fitted.length <= 1024, `Длина ${fitted.length} превышает 1024 символа`);
  assert.ok(fitted.endsWith("..."));
});

test("TTS лимит: форматирование речи не превышает лимит 1024 символов при расширении тире", () => {
  const textWithDashes = ("слово—").repeat(200);
  const speech = formatSpeechTts(textWithDashes);
  assert.ok(speech.length <= 1024, `Длина TTS ${speech.length} превышает 1024 символа`);
});

test("Определение поискового намерения: срабатывание на погоду, новости и саджест 'Что нового в мире?'", () => {
  assert.equal(isSearchIntent("Какая погода сегодня в Москве?"), true);
  assert.equal(isSearchIntent("What is the latest tech news?"), true);
  assert.equal(isSearchIntent("Сколько стоит доллар?"), true);
  assert.equal(isSearchIntent("Что нового в мире?"), true);
  assert.equal(isSearchIntent("Что нового?"), true);
  assert.equal(isSearchIntent("Расскажи интересную сказку"), false);
});

test("Определение намерения выхода: распознавание команд завершения сессии с пунктуацией", () => {
  assert.equal(isExitIntent("хватит"), true);
  assert.equal(isExitIntent("стоп!"), true);
  assert.equal(isExitIntent("пока."), true);
  assert.equal(isExitIntent("до свидания!"), true);
  assert.equal(isExitIntent("расскажи анекдот"), false);
});

test("Определение намерения справки: распознавание запросов помощи, команд и саджеста 'Кто ты?'", () => {
  assert.equal(isHelpIntent("помощь?"), true);
  assert.equal(isHelpIntent("что ты умеешь!"), true);
  assert.equal(isHelpIntent("справка"), true);
  assert.equal(isHelpIntent("Кто ты?"), true);
  assert.equal(isHelpIntent("кто президент"), false);
});

test("Определение сброса контекста: распознавание команд очистки памяти и саджеста 'Сбросить диалог'", () => {
  assert.equal(isResetIntent("забудь!"), true);
  assert.equal(isResetIntent("сброс."), true);
  assert.equal(isResetIntent("Сбросить диалог"), true);
  assert.equal(isResetIntent("очисти историю!"), true);
  assert.equal(isResetIntent("напомни правило"), false);
});

test("Определение повтора реплики: распознавание команд повторить ответ", () => {
  assert.equal(isRepeatIntent("повтори"), true);
  assert.equal(isRepeatIntent("что ты сказала?"), true);
  assert.equal(isRepeatIntent("еще раз!"), true);
  assert.equal(isRepeatIntent("повтори пожалуйста."), true);
  assert.equal(isRepeatIntent("какая погода"), false);
});

test("Определение пинга доступности: распознавание команд ping и пинг", () => {
  assert.equal(isPingIntent("ping"), true);
  assert.equal(isPingIntent("пинг!"), true);
  assert.equal(isPingIntent("проверка"), false);
});

test("Обработка запроса пинга через handler: быстрый возврат статуса", async () => {
  const res = createMockResponse();
  const req = {
    method: "POST",
    body: {
      session: { new: false },
      request: { command: "пинг", original_utterance: "пинг" }
    }
  };

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.match(res.payload.response.text, /Понг|режиме/i);
  assert.equal(res.payload.response.end_session, false);
});

test("Обработка повтора реплики: возврат последнего ответа модели из истории диалога", async () => {
  const res = createMockResponse();
  const req = {
    method: "POST",
    body: {
      session: { new: false },
      request: { command: "повтори", original_utterance: "повтори" },
      state: {
        session: {
          history: [
            { role: "user", text: "Сколько будет 2+2?" },
            { role: "model", text: "Два плюс два равно четыре." }
          ]
        }
      }
    }
  };

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.response.text, "Два плюс два равно четыре.");
  assert.equal(res.payload.response.end_session, false);
});

test("Обработка нажатия на кнопку саджеста: извлечение текста из payload", async () => {
  const res = createMockResponse();
  const req = {
    method: "POST",
    body: {
      session: { new: false },
      request: {
        command: "",
        original_utterance: "",
        payload: "помощь"
      }
    }
  };

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.match(res.payload.response.text, /умею отвечать/i);
});

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

test("Gemini API совместимость: история обязана начинаться с user после обрезки длинного диалога", () => {
  const longHistory = [
    { role: "user", text: "1" },
    { role: "model", text: "2" },
    { role: "user", text: "3" },
    { role: "model", text: "4" },
    { role: "user", text: "5" },
    { role: "model", text: "6" },
    { role: "user", text: "7" },
    { role: "model", text: "8" },
    { role: "user", text: "9" }
  ];
  const result = safeHistory(longHistory);
  assert.equal(result[0].role, "user", "Первое сообщение в истории должно иметь роль user для Gemini API");
  assert.ok(result.length <= 8);
});

test("GET запрос проверки статуса: возврат кода 200 и идентификатора сервиса", async () => {
  const res = createMockResponse();
  await handler({ method: "GET" }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.ok, true);
  assert.equal(res.payload.status, "ok");
  assert.ok(typeof res.payload.service === "string");
});

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

test("Проверка запрещенных HTTP методов: возврат ошибки 405 Method Not Allowed", async () => {
  const res = createMockResponse();
  await handler({ method: "DELETE" }, res);

  assert.equal(res.statusCode, 405);
  assert.equal(res.payload.error, "Method not allowed");
  assert.equal(res.headers.Allow, "GET, POST");
});
