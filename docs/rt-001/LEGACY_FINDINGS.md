# LEGACY_FINDINGS — детальный разбор legacy-прототипов

> RT-001. Каждый раздел — один файл из `legacy/`. Классификация утверждений: **FACT** / **INFERENCE** / **PROPOSAL**.
> Это НЕ код-ревью новичкового кода — цель разобрать, зачем каждая возможность появилась,
> и что из неё стоит помнить при проектировании будущей архитектуры.
> Файлы не изменялись, не форматировались, не рефакторились — см. `docs/rt-001/` границы записи.

---

## 1. `legacy/generic/SNIF_ENDPOINT_V2.js` — прямой предок current toolkit

**FACT.** 1311 строк, один класс `AdvancedResearchCollector` (`window.research = new AdvancedResearchCollector(...)`,
строка 1291), версия помечена `'3.0'` (строка 1155).

**PURPOSE.** Универсальный (не привязанный к конкретному сайту) monkey-patch коллектор для наблюдения
за сетевым трафиком и DOM-активностью любой страницы, изначально настроенный под Google Maps
(см. ключевые слова `google`, `maps`, `geocode`, `directions`, `tile`/`vector`/`raster`/`pbf`,
строки 22-27; `objectsToMonitor` включает `google`/`gm`/`GM`, строка 690).

**KEY FEATURES.** fetch/XHR/WebSocket monkey-patch (108-320); dynamic `<script>`/`<link>` discovery через
`Element.prototype.appendChild`/`insertBefore` (280-320); Beacon/EventSource перехват без захвата сообщений
(438-469); DOM-событийный монитор с 16 типами событий (473-505); `console.error`-патч (529-535) —
**без защиты от рекурсии**, поскольку он вызывает `originalConsoleError.apply(console, args)`, но сам
`self.logError` внутри использует текущий (уже пропатченный на момент установки ErrorMonitor-эквивалента)
`console.error`, если такой патч ставится после; storage/cookie snapshot + live patch (539-620);
`PerformanceObserver` + разовый скан существующих ресурсов через 2с (624-682); global-object snapshot
(686-721); `MutationObserver` по data-* атрибутам (725-771); redaction-заглушки — URL/headers/body/object/
storage/WS sanitizers (775-915); `BoundedList`-подобная ручная ротация — отдельная реализация для каждой
коллекции (`rotateEndpoints`, `rotateJsonResponses`, инлайновый shift в `addNetworkRequest`/`addEvent`,
924-980); JSON-экспорт с **дополнительным** хардкод-усечением `slice(-100)`/`slice(-20)` поверх уже
ограниченных коллекций (1168, 1149-1194).

**УНИКАЛЬНЫЕ ИДЕИ.** Нет доменной классификации вообще — это чистое инженерное ядро. Всё, что в нём есть,
уже так или иначе перенесено в `src/` (см. `INVENTORY_MATRIX.md`).

**ДУБЛИРУЮЩАЯСЯ ИНФРАСТРУКТУРА / SUPERSEDED.** Ровно то, что описывает README текущего toolkit
как исправленные баги, дословно присутствует здесь:
- `websockets`/`performanceData` — обычные `Map` без cap и TTL (48-52, 636-654) → unbounded growth;
  в `src/context.ts` оба идут через `BoundedStore`.
- `analyzeResponse`/`analyzeXHRResponse` — "redact-then-maybe-parse": `containsSensitiveData(body)`
  проверяется **до** попытки `JSON.parse` (335-364, 384-388) → весь ответ блэкаутится целиком при
  совпадении по любому полю, а не только конкретное поле; в `src/analysis/response-analyzer.ts`
  порядок обратный (parse-then-redact по полям).
- `analyzeXHRResponse` делает `return` в sensitive-ветке **до** `isApiEndpoint`-регистрации (385-388,
  409) → endpoint не регистрируется, если тело показалось чувствительным; в `src/` регистрация вынесена
  в `finally`.
- `xhr.setRequestHeader` вообще не перехватывается — `requestData.headers` для XHR всегда `undefined`
  (строки 152-201); в `src/interceptors/xhr-interceptor.ts` это отдельно перехвачено.
- `fetch(new Request(url, opts))` — однозначный вызов теряет метод/заголовки, так как читается только
  `args[1]` (118-120); `src/interceptors/fetch-interceptor.ts` явно читает `Request`-объект.
- `setTimeout` в `init()` для `analyzeExistingRequests` не отменяется в `cleanup()` (103, 1231-1256) —
  может выстрелить после "полной" очистки; `src/collector.ts` хранит и чистит `analyzeExistingTimer`.
- Размер storage-значения считается через `.length` (556-558, 583-595), не байты; `src/` использует
  `new Blob([value]).size`.
- Бэйр-обращения к `navigator.*` (beacon-интерсептор строка 439, `exportData` строка 1154) не защищены
  от отсутствия глобального `navigator` — актуально для CI под Node < 21; в `src/` эти места явно
  проверяют `typeof navigator !== 'undefined'`.
- Query-param редакция регистронезависимо не работает: `['key','token','apikey',...]` сравнивается через
  `urlObj.searchParams.has(param)` (787-791) — не приводит к нижнему регистру ни параметр, ни список,
  так что `apiKey`/`API_KEY` не совпадут с `apikey`; `src/sanitize/sanitizer.ts` явно приводит оба к
  lower-case.
- Дублирующаяся ротация (`rotateEndpoints`, `rotateJsonResponses`) — два почти идентичных метода;
  в `src/` заменены одним `BoundedStore`.
- Экспортёр дополнительно усекает `slice(-100)`/`slice(-20)` (1168, 1162-1166) поверх уже ограниченных
  коллекций — двойное усечение теряет данные; в `src/export/exporter.ts` это убрано.

**PRIVACY IMPLICATIONS.** Redaction здесь существует, но слабее и менее гранулярна, чем в `src/`
(см. "redact-then-maybe-parse" выше) — то есть перенос этого кода в новую архитектуру напрямую был бы
шагом назад в приватности, а не вперёд.

**QUESTIONABLE.** `sanitizeObject` защищается от циклов через `WeakSet`, но объект добавляется/удаляется
на каждом уровне рекурсии (`seen.add`/`seen.delete` в `finally`, 848-888) — рабочая, но не самая дешёвая
реализация; `src/` сохраняет тот же паттерн (не регресс, просто унаследованная особенность).

---

## 2. `legacy/site-specific/` — восемь site-collector прототипов

**FACT (обновлено в corrective pass — было INFERENCE, теперь подтверждено построчным сравнением).**
Все восемь файлов используют не просто похожий, а буквально один и тот же скопированный шаблон
"site collector" с точечными заменами под площадку. Подтверждающие детали (проверено `node --check`
и построчным grep по всем 8 файлам):
- имя переменной состояния (`securityAnalysis`), состав и порядок 5 namespace'ов (`session`/`network`/
  `security`/`timing`/`dom`) — идентичны во всех 8;
- `CONFIG.autoStopMinutes` — буквально `30` во всех 8 файлах, включая идентичный (посимвольно, кроме
  названия сайта) код таймера авто-остановки;
- порог memory-pressure — буквально `500 * 1048576` (500 МБ) во всех 8 файлах, с идентичной структурой
  вычисления `stats.memoryMB`/`stats.memoryLimitMB`;
- имена helper-методов (`addRequest`, `addWebSocket`, `addDOMEvent`, `addAuthFlow`, `addPerfEntry`,
  `clearAll`) и их тело (push/shift или Map-eviction) — идентичны во всех 8;
- форма объекта `requestData`, строящегося в патче `fetch` (порядок и названия полей), и даже выражение
  генерации ID (`` `fetch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}` ``) — идентичны
  во всех 8;
- стиль и формулировки русскоязычных комментариев и баннеров консоли — идентичны во всех 8, меняется
  только название площадки.

Единственное, что варьируется между файлами — название сайта в строках логов и site-специфичные
CONFIG-ключи/классификаторы/DOM-селекторы, надстроенные поверх идентичного скелета. Вероятность того,
что 8 независимых авторов сошлись бы на одном и том же имени переменной, одном и том же порядке
5 namespace'ов, одних и тех же константах (30 минут, 500 МБ) и одной и той же формулировке
русскоязычных комментариев, пренебрежимо мала — это одна архитектурная болванка, скопированная
8 раз с find/replace под конкретную площадку, а не 8 независимо спроектированных решений. Это важно
для интерпретации любых "во всех 8 файлах"-находок ниже (включая `dom.lastInteraction`, см.
`CORRELATION_GROUNDWORK.md` §3): это одно архитектурное намерение, реплицированное 8 раз, а не
8 независимых источников подтверждения.

Помимо перечисленного выше, общий шаблон включает также:

- fetch/XHR-патч с классификацией URL/body по подстрокам в доменные категории конкретного сайта;
- (кроме Facebook и TikTok) — разбор GraphQL-тела: `operationName` + список имён переменных;
- `MutationObserver` со списком CSS/data-* селекторов конкретного сайта, вешающий click-слушатели на
  найденные элементы;
- `PerformanceObserver`, отфильтрованный под домен/расширения ресурсов сайта;
- набор `window.get*`/`window.stop*`/`window.clear*` команд для интерактивной инспекции живой сессии
  прямо из консоли — отдельно от финального экспорта (которого в большинстве файлов вообще нет:
  ни один из восьми не реализует JSON-экспорт, сравнимый с `Exporter` в `src/`).

**FACT (сквозной баг, подтверждено в corrective pass прямым grep по всем 8 файлам на `\.lastInteraction\s*=` —
0 совпадений, и по всем click/mousedown/keydown/touchstart/mousemove-слушателям — ни один не пишет
в `dom.lastInteraction`).** Во всех восьми файлах поле `dom.lastInteraction` объявлено в состоянии,
**читается** при формировании каждого исходящего запроса как `requestData.domTrigger = securityAnalysis.dom.lastInteraction`,
но **никогда не присваивается**. Важное уточнение (см. выше): поскольку все 8 файлов — один
скопированный шаблон, это одно архитектурное намерение, реплицированное копипастой 8 раз, а не
8 независимо возникших случаев одной и той же идеи. Ценность находки как сигнала требования
("авторы хотели связывать действие пользователя с запросом") при этом не снижается — просто она
основана на одном источнике дизайна, а не на восьми. Подробный разбор — в `CORRELATION_GROUNDWORK.md` §3.

Ниже — специфика каждого файла: что он умеет сверх общего шаблона, и какие идеи в нём уникальны.

### 2.1 `АМАЗОН.js` (970 строк)

**PURPOSE.** Наблюдение за Amazon: product/cart/search/recommendation/auth API, идентификация ASIN.

**KEY FEATURES.** Классификация URL на 5 категорий через `.includes()` (176-186); извлечение ASIN из URL
(`/([A-Z0-9]{10})/`) и из JSON-тела (`"asin":\s*"([A-Z0-9]{10})"`) (367-374); классификация cart-операции
по ключевым словам в URL/теле (377-388); поисковый запрос — из query-параметров `k`/`field-keywords`
(396-403); заголовки Amazon по 2 группам + `x-amz-*` префикс (629-674); DOM: `[data-asin]`,
`.s-result-item`, `.a-carousel-card`, Add-to-Cart селектор (700-778).

**FACT (найдено в corrective pass, критично для оценки этого файла).** `АМАЗОН.js` не проходит
`node --check` — файл содержит настоящий `SyntaxError` на строке 679, верифицировано запуском
`node --check` из корня репозитория: `SyntaxError: Invalid left-hand side in assignment`. Дефект — в
`analyzeAmazonCookies` (объявлена на строке 677): `const sessionMatch = cookieHeader.match/(session-id=([^;]+)/);`.
Механически это **не** "нет закрывающей скобки" (скобки в этом выражении сбалансированы) — реальная
причина в том, что `/` стоит сразу после `.match`, а не сразу после `(`, из-за чего парсер читает
выражение как деление `.match / (...)`, а `session-id=(...)` внутри скобок — как (невалидное)
присваивание в `session - id`. Та же ошибка повторяется на строках 680-681.

Поскольку весь файл — один top-level IIFE (строка 1 — `})();` на строке 970), а `analyzeAmazonCookies`
объявлена внутри него, эта `SyntaxError` **блокирует парсинг и выполнение всего файла целиком** — не
только этой функции — в любом JS-движке (Node или браузер одинаково; движок парсит весь compilation
unit целиком до начала выполнения чего-либо). Это не зависит от того, достижима ли ветка с cookie в
рантайме — синтаксическая валидность проверяется для всего текста программы заранее, а не по факту
исполнения конкретных веток.

**УНИКАЛЬНЫЕ ИДЕИ.**
- `findClosestASIN` (766-774) — при клике по кнопке Add-to-Cart подъём по `parentElement` до ближайшего
  предка с `data-asin`. **Важное уточнение (corrective pass):** сам алгоритм, извлечённый в отдельный
  файл, синтаксически корректен (`node --check` проходит чисто) — это **валидный статический паттерн**,
  достойный документирования как идея. Но **в текущем committed-состоянии `АМАЗОН.js` эта функция
  никогда не выполняется** — весь файл не парсится из-за `SyntaxError` на строке 679 (см. FACT выше).
  Формулировка "рабочий (в отличие от `domTrigger`) паттерн" из более ранней версии этого документа
  была неточной: паттерн хорошо спроектирован, но не "рабочий" в смысле "исполняется" — сейчас не
  исполняется ничего в этом файле. Классификация алгоритма (не факта исполнения): **INFERENCE RULE**
  (обобщается как "найти ближайшего предка с заданным атрибутом", атрибут — конфигурируем).
- Классификация запроса в доменные бакеты (product/cart/search/auth) с отдельными bounded-коллекциями
  и accessor-командами на каждый бакет — **GENERIC ENGINE CAPABILITY**: "классификатор + набор
  bucketed-хранилищ" как переиспользуемый механизм, конкретные Amazon-правила — уже **SITE PROFILE**.
- Реакция на memory-pressure (`performance.memory.usedJSHeapSize > 500MB` → полная очистка, 876-896) —
  **GENERIC ENGINE CAPABILITY**, живой (runtime-driven), а не только capacity-driven backpressure,
  которого в `BoundedStore` current toolkit нет. (Как идея — валидна независимо от того, что сам файл
  сейчас не исполняется; то же самое встречается ещё в 7 файлах, см. §2 выше.)

**QUESTIONABLE.** `analyzeAmazonCookies` (677-688, строки 679-681) — см. FACT выше: это подтверждённая
`node --check` фатальная `SyntaxError`, а не гипотетическая проблема. `recommendationRequests`
объявлена (строка 41), классифицируется (183-184), но никогда не заполняется — незавершённая ветка
(хотя в текущем состоянии это уже не имеет значения, поскольку файл не исполняется вообще).

**PRIVACY.** Полные тела product-API запросов до 50 КБ и первые 5 КБ ответа — в base64, без redaction
по полям (только усечение по размеру); auth-заголовки (`x-amz-access-token`, `x-amz-customer-id`)
логируются как есть (усечены до 200 симв.); `customerId`/`sessionId` из cookie сохраняются в `session`
(путь фактически мёртв из-за сломанного regex). Все доступны через незащищённые `window.*`-команды.

### 2.2 `ИНСТА.js` (1025 строк)

**PURPOSE.** Наблюдение за Instagram: GraphQL, media/story/feed/DM/auth, идентичность сессии.

**KEY FEATURES.** GraphQL operationName + ключи переменных из тела (392-402); заголовки по 3 группам
(`x-ig-app-id`, `x-ig-www-claim`, `x-csrftoken`, `x-fb-trace-id`, ...) (643-705); cookie-парсинг
(`sessionid`, `ds_user_id`, `csrftoken`, `mid`) (708-721); DOM-наблюдение постов/сторис/лайков по
хардкод CSS-классам (724-824), включая пиксель-координатный селектор `circle[cx="54"][cy="54"]` (778)
для story-ring — крайне хрупкий приём.

**УНИКАЛЬНЫЕ ИДЕИ.**
- Request-response корреляция по общему `requestId`-ключу в `Map` для GraphQL: ответ дописывает
  `responseBodyBase64`/duration в ту же запись (351-356, 595-599) — рабочая, простая альтернатива
  fingerprint-дедупу текущего `ResponseAnalyzer`. Классификация: **GENERIC ENGINE CAPABILITY**
  (id-based join запрос↔ответ — более простой механизм, чем content-based fingerprint, но с тем же
  назначением).
- GraphQL-парсинг operationName/переменных как отдельная функция, не завязанная на Instagram-специфику
  — **PROTOCOL PROFILE** (применимо к любому GraphQL-backed сайту).
- Memory-pressure auto-clear (940-943) — тот же паттерн, что у Amazon.

**QUESTIONABLE.** `story.storyElements`/`mediaElements` — это `Set`, хранящий сгенерированные ID
(`Date.now()`-based), а не ссылки на элементы; для media проверка `has` перед `add` частично работает,
но для story ID генерируется заново на каждый вызов (784) — "проверка на дубликаты", которая не
дублирует. Хрупкие CSS-классы (`._aagw`, `._acaz`) ломаются на любом изменении сборки Instagram.

**PRIVACY.** CSRF-токен и история CSRF-токенов (по timestamp) хранятся в открытом виде (673-674);
сессионные cookie (`sessionid`, `ds_user_id`, `mid`) — тоже; `authorization`-заголовок усечён до 200
символов, не редактирован; полные GraphQL-тела — в base64.

### 2.3 `РЕДДИТ.js` (1221 строка)

**PURPOSE.** Наблюдение за Reddit: post/comment/vote/subreddit, GraphQL, идентичность сессии.

**KEY FEATURES.** Post/comment URL-классификация + DOM-селекторы, включая `shreddit-post`/`shreddit-comment`
(web components новой версии Reddit) (464-499, 868-936); vote-парсинг: `dir=` (-1/0/1) и `id=t{n}_...`
regex из form-encoded тела (520-535) — рассчитан на **старый** (не-GraphQL) API; subreddit — единый
regex `/\/r\/([a-zA-Z0-9_]+)/`, переиспользуемый везде (480-483); session/auth: `reddit_session`, `loid`,
`x-modhash`, `csrf_token` (785-856).

**УНИКАЛЬНЫЕ ИДЕИ.**
- **(Исправлено в corrective pass, было переоценено.)** Response-derived entity ID, привязанный
  обратно к исходному запросу: `postData.createdPostId` заполняется из тела ответа regex'ом
  `"id":\s*"t3_([a-z0-9]+)"` (408-412). Ранее это описывалось как "рабочая response → request
  enrichment связь". Проверка control flow показала: это срабатывает не только на `/api/submit`
  (create), а на **любом** ответе, чей запрос прошёл широкий классификатор `isPostAPI` (строки
  206-207: `url.includes('/api/submit') || url.includes('/api/info') || url.includes('/api/v1/') ||
  url.includes('/comments/')`) — то есть в том числе на обычный просмотр существующего поста
  (`/comments/...`, `/api/info`). Функция `extractPostInfo` (464-473) отдельно и корректно вычисляет
  `type: 'create'|'info'|'view'|'unknown'`, но код, заполняющий `createdPostId` (400-414), эту
  классификацию **не проверяет** — гейта `if (postData.type === 'create')` не существует. Поскольку
  `/api/info`-эндпоинт Reddit по конструкции ищет существующие вещи по их `t3_`-префиксованным
  fullname, весьма вероятно, что просмотр существующего поста тоже вернёт `"id":"t3_xxxxx"` в теле
  ответа и ошибочно пометит существующий пост как "созданный". Понижена классификация: это
  **PARTIAL / эвристическая response-entity-ID экстракция с подтверждённым риском false positive**,
  не "рабочая" корреляция в смысле "надёжно отличает создание от просмотра". Как обобщённая идея
  (не как эта конкретная нестрогая реализация) всё ещё годится как **INFERENCE RULE**: "сопоставить
  тело ответа с конфигурируемым паттерном, приписать результат исходному запросу" — но будущая
  реализация обязана проверять тип операции перед записью, чего здесь нет.
- **(Добавлено в corrective pass — ранее не упоминалось для этого файла.)** В отличие от `domTrigger`,
  здесь есть отдельная, **действительно рабочая** (синтаксически валидная, `node --check` проходит)
  click→entity корреляция, устроенная иначе, чем у Amazon: `setupPostElementMonitoring` (863-997)
  через `MutationObserver` резолвит `postId` с контейнера поста (`element.getAttribute('id') ||
  element.getAttribute('data-fullname') || generatePostId()`, 878-880) один раз при появлении
  контейнера, замыкает его в closure, и каждый клик по upvote/downvote/comments/share/save-кнопке
  внутри контейнера (901-983) логирует этот closure-захваченный `postId` синхронно, в момент клика
  (`addDOMEvent`, 910-915, 972-976). То же самое для `commentId` (941-983). Механизм — не
  ancestor-walk (как у Amazon), а "прочитать атрибут контейнера один раз при обнаружении, замкнуть
  в closure, использовать при любом клике внутри" — самостоятельный, отдельный от Amazon паттерн
  **user action → entity** корреляции, который здесь реально исполняется.
- Heap-pressure emergency purge (1126-1129) — тот же паттерн, что и в остальных 7 файлах, здесь явно
  описан как "safety valve" поверх count/TTL-ограничений.
- Интерактивный query API на `window` (`getSessionInfo`, `getVoteHistory`, `getSubredditActivity`, ...)
  — живая инспекция сессии, отдельная от финального экспорта. **GENERIC ENGINE CAPABILITY.**

**QUESTIONABLE.** Смешение form-encoded regex-парсинга (`dir=`, `id=t{n}_`) со свежими GraphQL-путями —
эвристики рассчитаны на legacy Reddit API и не сработают против чисто GraphQL/JSON эндпоинтов.
`isSubredditAPI` матчит любую подстроку `/r/` — коллизии с несвязанными путями. Два параллельных,
несвязанных лога взаимодействия: `postData.interactions` (локальная замыкающая переменная) и отдельный
`addDOMEvent`-вызов (905-908, 967-970) — дублирование без объединения.

**PRIVACY.** `authorization`, `x-reddit-auth`, сырой `cookie`-заголовок — в `redditAuthHeaders`/`authFlows`,
усечены до 100-200 символов, не редактированы; `reddit_session`, `token`, `loid`, `csrf_token` из cookie
— сохранены как есть; полные тела (до 10 КБ, GraphQL — 50 КБ base64) без пофлдевой фильтрации.

### 2.4 `ТИКТОК.js` (840 строк)

**PURPOSE.** Наблюдение за TikTok: aweme API, видео-контент, параметры анти-бот подписи.

**KEY FEATURES.** Классификация "aweme API" (основной контент-API TikTok) через подстроки
`/aweme/v`, `/api/post` (162, 394); видео — через `/video/`, `.mp4`, `video/tos` (163); сканирование
query-параметров и заголовков на известные анти-бот маркеры: `_signature`, `X-Bogus`, `x-gorgon`,
`msToken` (588-603, 397); заголовки по 3 группам (`x-tt-trace-id`, `x-tt-token`, `x-tt-passport-csrf-token`,
`x-bogus`, `x-gorgon`, ...) (551-553); `<video>`-элементы через `MutationObserver`, события play/pause/
seeked/timeupdate (613-662) — **никаких** CSS-селекторов конкретно под TikTok, в отличие от остальных
семи файлов; вместо этого — чисто URL/заголовочная классификация.

**УНИКАЛЬНЫЕ ИДЕИ.**
- Классификация запроса как "требующего подписи" по известным именам анти-бот параметров/заголовков
  (X-Bogus, x-gorgon, msToken, _signature) — **INFERENCE RULE**, напрямую релевантно направлению
  "AntiBot Observability" (§10 задания, `PRIVACY_REVIEW.md`/`TARGET_ARCHITECTURE_DRAFT.md`): это
  свидетельство, что идея "пометить запрос как несущий anti-bot/nonce-подобный параметр" уже возникала
  как site-независимая потребность, не только в `legacy/antibot/`.
- Request/response pairing по общему `id` в Map (`awemeRequests`) — тот же паттерн, что у Instagram/X.
- Явный auto-stop таймер + `window.stopTikTokAnalysis`/`clearTikTokData` — **GENERIC ENGINE CAPABILITY**
  (session lifecycle/kill-switch).

**QUESTIONABLE.** `session.cookies`/`localStorage`/`sessionStorage`/`tokens` объявлены (24-27), но
никогда не заполняются — мёртвые поля. `userID`/`deviceID` тоже объявлены и не используются (29-30).
`document.body`-observer без какого-либо site-специфичного скоупинга — самый "generic" из всех восьми
MutationObserver-реализаций, потому что у TikTok, судя по всему, не было устойчивых CSS-хуков на момент
написания.

**PRIVACY.** Полные тела aweme-запросов/ответов в base64, без redaction (только size-gate);
auth/signature-значения сохраняются как есть (усечены до 100-200 симв.), доступны через
`getSignatureData()`/`getAwemeRequests()`.

### 2.5 `ФЕЙСБУК.js` (765 строк) — самый "поверхностный" из восьми

**PURPOSE.** Наблюдение за Facebook: GraphQL-трафик, WebSocket (realtime), auth-заголовки.

**KEY FEATURES.** Единственный из восьми site-specific файлов, который перехватывает **WebSocket**
(512-602) — классифицирует `isFBRealtime` по подстроке `realtime` в URL. Классификация запроса
всего на 3 категории через `.includes()`: GraphQL / Facebook API (`/api/`) / FB Platform (`fbcdn.net`)
(145-147, 343-344) — **никакой** доменной семантики (нет поста/комментария/реакции, нет разбора
`doc_id`/`fb_api_req_friendly_name`, GraphQL-тело трактуется как непрозрачный blob и просто
base64-кодируется). Заголовки по 3 группам (`x-fb-access-token`, `x-fb-session-id`, `x-fb-user`) (476-478).

**УНИКАЛЬНЫЕ ИДЕИ.**
- Единственный файл, дающий WebSocket своё внимание вне generic-скелета (перехват send + все
  события состояния) — хотя это уже полностью покрыто `src/interceptors/websocket-interceptor.ts`.
- Декларативная классификация заголовков по спискам подстрок в 3 категории (security/auth/tracking)
  — **PROTOCOL PROFILE**: механизм bucketing заголовков по configurable pattern lists, переиспользуем
  как профиль независимо от конкретных FB-имён.
- Работающая (в отличие от `domTrigger`) корреляция: `addAuthFlow({..., requestId: requestData.id})`
  (495-501) — auth-заголовок явно привязан к ID исходного запроса.

**QUESTIONABLE.** `session.cookies`/`localStorage`/`sessionStorage`/`tokens`, `fbConstants`, `userID`
объявлены в схеме состояния (23-29), но нигде не заполняются — похоже на скопированный из другого
файла (например Reddit/Instagram) шаблон без адаптации; WS `send`-обёртка предполагает, что
`data.byteLength` существует у всех не-строковых payload — ломается на `Blob`. Самый неполный по
глубине доменной семантики файл из восьми — вероятно, самый ранний или наименее доработанный.

**PRIVACY.** `Authorization`, сырой `Cookie`-заголовок, `x-fb-access-token`, `x-fb-session-id` — как
есть, усечены до 200 символов; полные тела (включая GraphQL до 50 КБ) — base64 без пофлдевой фильтрации;
всё доступно через `window.getFBAuthFlows()`.

### 2.6 `X_COM.js` (1090 строк)

**PURPOSE.** Наблюдение за X/Twitter: GraphQL, твиты/таймлайны/медиа, auth/session.

**KEY FEATURES.** GraphQL operationName/`features`/`variables` (403-418); классификация твита
(create/view/like/retweet) — не по URL-паттерну, а по **сопоставлению с известными именами GraphQL-
операций**: `CreateTweet`, `TweetDetail`, `FavoriteTweet`, `Retweet` (421-433) — более точный
механизм, чем URL-substring, использованный в остальных файлах; таймлайн-тип — тоже по имени
GraphQL-операции (`HomeTimeline`, `UserTweets`, `SearchTimeline`, 441-446); сессия — `auth_token`,
`ct0` (CSRF), `twid`, `guest_id` из cookie (753-766).

**УНИКАЛЬНЫЕ ИДЕИ.**
- Классификация действия по **имени GraphQL-операции**, а не по URL/body-эвристике — качественно более
  надёжный подход, чем у Amazon/Reddit/Allegro (URL substring) или Facebook (вообще нет классификации
  внутри GraphQL). Классификация: **PROTOCOL PROFILE** (операция → семантическое действие — таблица,
  которая переживёт изменение путей URL, но не переживёт ротацию имён операций на бэкенде).
- **(Исправлено в corrective pass, было переоценено.)** Response-derived ID enrichment:
  `tweetData.createdTweetId` заполняется regex'ом `"rest_id":"(\d+)"` из тела ответа (374) — ранее
  описано как рабочий аналог `createdPostId` у Reddit. Проверка control flow показала тот же дефект:
  срабатывает не только на создание твита, а на любом ответе, чей запрос прошёл широкий классификатор
  `isTweetAPI` (191-192: `url.includes('/Tweet') || url.includes('/CreateTweet') ||
  url.includes('/TweetResult') || url.includes('/TweetDetail')`) — включая `TweetDetail`, операцию
  просмотра существующего твита. `extractTweetInfo` (421-433) корректно вычисляет
  `type: 'create'|'view'|'like'|'retweet'`, но код записи `createdTweetId` (365-379) эту классификацию
  не проверяет. `rest_id` — общее внутреннее поле идентификатора X для любого объекта результата
  (Tweet/User/...), присутствует практически в каждом GraphQL-ответе, включая `TweetDetail` для уже
  существующего твита — то есть почти гарантированный false positive при простом просмотре чужого
  твита. Понижена классификация: **PARTIAL / эвристическая экстракция с подтверждённым риском false
  positive**, не "рабочая" created-entity корреляция.
- **(Добавлено в corrective pass — ранее не упоминалось для этого файла.)** Отдельно от вышеописанного
  — реально рабочая (не сломанная) click→entity корреляция, тем же closure-паттерном, что у Reddit/
  Pinterest/allegro: `setupTweetElementMonitoring` (773-867) резолвит `tweetId` с контейнера твита
  один раз при обнаружении через `MutationObserver` (`data-tweet-id` или синтетический
  `generateTweetId()`-fallback, 788-790, 874-876 — на реальном DOM X/Twitter атрибут `data-tweet-id`
  на `article[role="article"]` обычно отсутствует, так что на практике чаще срабатывает именно
  synthetic fallback, а не настоящий tweet ID площадки), замыкает в closure, и клик по like/retweet/
  reply/share-кнопке внутри контейнера (810-833) логирует этот closure-`tweetId` синхронно.
- Живой query API (`getGraphQLQueries`, `getSessionInfo`, `getAuthData`) — паттерн, общий для
  большинства файлов, но здесь явно оформлен как самостоятельная "control plane" функциональность.

**QUESTIONABLE.** `dom.tweetElements`/`mediaElements` — `Set`, растущие без ограничения несмотря на
существование `CONFIG`-лимитов для них (лимиты объявлены, но нигде не применяются к этим двум
коллекциям) — реальная утечка памяти внутри самого прототипа. Классификация типа медиа через
`requestBody?.includes('image')` (302) — грубая текстовая эвристика.

**PRIVACY.** CSRF-токен, guest-токен, Bearer-токен (первые 50 симв.), `auth_token`/`twid` из cookie —
в `session`/`security`, доступны через `getSessionInfo()`/`getAuthData()`; полные тела (включая
потенциально DM, если бы такой эндпоинт совпал с GraphQL-паттерном) — до 50 КБ base64, без redaction.

### 2.7 `allegro.js` (1334 строки) — крупнейший из восьми

**PURPOSE.** Наблюдение за Allegro (польский e-commerce): продукт/оффер/корзина/заказ/поиск, GraphQL.

**KEY FEATURES.** Самая широкая доменная модель из всех восьми: product/offer (209, ID через regex
из URL или JSON-полей `productId`/`offerId`, извлечение цены/наличия из полей ответа `sellingMode.price.amount`,
`stock.available`, 518-523), cart (211, action-тип по ключевым словам add/remove/update/get в URL, 535-543),
search (213, query + произвольные `filter`/`param`-подобные query-параметры, 567-571), order/checkout
(215, `orderId` через regex `orders/([^/?]+)`, 605) — включает захват checkout/order payload'ов.
Allegro-заголовки: `x-allegro-app/client/device`, `x-client-id`, `x-allegro-token`, `x-allegro-track`
(857-859).

**УНИКАЛЬНЫЕ ИДЕИ.**
- Наиболее полная из восьми таблица "паттерн запроса → доменная сущность → извлекаемые поля" —
  хороший референс структуры, если формализовывать **PROTOCOL PROFILE**/**SITE PROFILE** как
  декларативную конфигурацию, а не код.
- Тот же героический список memory-pressure/auto-stop/kill-switch паттернов, что и у остальных —
  здесь особенно явно виден как "фича, продублированная 8 раз, ни разу не вынесенная в общий модуль".
- **(Добавлено в corrective pass — ранее не упоминалось для этого файла.)** Рабочая (не сломанная,
  `node --check` проходит) click→entity корреляция тем же closure-паттерном, что у Reddit/X_COM/
  Pinterest: `setupProductElementMonitoring` (944-1093) резолвит `productId` с контейнера
  (`data-product-id`/`data-offer-id` или `generateProductId()`-fallback, 965-967) один раз при
  обнаружении, замыкает в closure; клик по view/add_to_cart/add_to_favorites/buy_now-кнопке (988-1022)
  логирует closure-`productId` синхронно. Отдельно — `auctionId` (1073) с той же схемой для
  ставки на аукционе (`bidButton`, 1079-1086).

**QUESTIONABLE.** `network.userRequests`/`auctionRequests` — Map, вычисляются флаги `isUserAPI`/
`isAuctionAPI` (217-219), но методы `addUserRequest`/`addAuctionRequest` **не существуют** — мёртвые
ветки классификации. WebSocket поддержка полностью декоративна: есть `addWebSocket`-метод и
`maxWebSockets`-лимит в конфиге, но **нигде нет патча `window.WebSocket`** — коллекция никогда не
заполняется. Классификация cart-типа по вхождению слова "add"/"remove" в URL — хрупкая эвристика,
ломается на любом ином порядке слов в пути.

**PRIVACY.** Захватываются checkout/order-тела (потенциально адрес доставки, состав заказа) без
пофлдевой редакции — самый чувствительный по семантике данных файл из восьми, поскольку единственный
явно работает с оформлением заказа; Bearer-токен усечён до 50 симв. и сохранён; CSRF-токен — как есть;
session/user/client id из cookie — как есть.

### 2.8 `PINTEREST.js` (1347 строк) — крупнейший файл в репозитории

**PURPOSE.** Наблюдение за Pinterest: пины/доски/поиск/лента, GraphQL, идентичность сессии.

**KEY FEATURES.** Pin — ID через `/pin/([^/?]+)/`, action (create/save/edit/delete/like/repin) по
URL-подстрокам (487-511), поля ответа `imageUrl`/`images.original.url`, `boardId`, `creatorId`
(519-532); Board — аналогично (540-553); поиск — query + suggestions/related (565-578); DOM: pin/board/
image через селекторы `data-test-id`, `data-pin-id`, `.Pin`, `.Board`, `img[src*="pinimg.com"]`
(949-1054); собственные per-collection лимиты **на каждую доменную категорию отдельно** (pins vs
boards vs search — не общий лимит, 7-21).

**УНИКАЛЬНЫЕ ИДЕИ.**
- Per-category независимые бюджеты хранения (не общий cap на все "события", а отдельный cap на pins,
  отдельный на boards, отдельный на search) — **GENERIC ENGINE CAPABILITY**: вариант `BoundedStore`
  с категориальными, а не глобальными бюджетами.
- `interactionHandlers`-карта (save/like/share/comment/closeup → обработчик) — чистая, наиболее
  структурированная реализация click-делегирования из всех восьми файлов (976-1007). **Уточнение
  (corrective pass):** формулировка "не связана с исходящим запросом" была верна буквально (нет связи
  клик→сетевой запрос), но неточна в более широком смысле — это тот же рабочий closure-паттерн
  click→entity, что у Reddit/X_COM/allegro: `pinId` резолвится с контейнера (`data-pin-id`/
  `data-test-pin-id` или `generatePinId()`-fallback, 961-963) один раз при обнаружении через
  `MutationObserver`, замыкается в closure, и каждый клик логирует closure-`pinId` синхронно
  (993-998); аналогично `boardId` для досок (1034-1044).

**QUESTIONABLE.** `websockets`-коллекция объявлена и лимитирована в `CONFIG`, но, как и в Allegro,
**нет патча `window.WebSocket`** — мёртвое поле. Масонри-грид Pinterest — очевидный кандидат для
infinite-scroll → pagination correlation, но такой корреляции нет вообще (даже не начата, в отличие
от `domTrigger`, который хотя бы объявлен). Fallback-генерация ID (`generatePinId` и т.п., 1115-1125)
при отсутствии настоящего ID в разметке — создаёт синтетические, не персистентные идентификаторы,
на которые нельзя полагаться при сопоставлении между сессиями.

**PRIVACY.** Bearer-токен усечён до 50 симв.; CSRF/Pinterest-токен, `session_id`, `user_id`,
`visitor_id` из cookie — как есть, без маскирования; тела запросов/ответов (10 КБ, GraphQL — 50 КБ) —
base64 без пофлдевой фильтрации.

---

## 3. `legacy/antibot/` — anti-bot observability прототипы

> Рассматриваются как ANTI-BOT OBSERVABILITY (наблюдение), а не bypass-инструментарий — см. §10-11
> задания и `TARGET_ARCHITECTURE_DRAFT.md`.

### 3.1 `ANTIBOT_MONITOR.js` (403 строки)

**PURPOSE.** В отличие от site-specific коллекторов, фильтрует не по домену конкретного сайта, а по
общему списку ключевых слов, ассоциируемых с anti-bot/CAPTCHA/challenge-инфраструктурой:
`log`, `gen_204`, `check`, `ping`, `bot`, `captcha`, `recaptcha`, `cloudflare`, `challenge`, `validate`,
`verify`, `token`, `fingerprint`, `beacon` (9-13). Смысл — не "что делает этот сайт", а "какая защитная
инфраструктура присутствует на любом сайте".

**KEY FEATURES, отсутствующие в site-specific файлах и в current toolkit:**
- **Перехват `setTimeout`/`setInterval`** с захватом стека вызова на каждый вызов (261-286) — уникально
  для этого файла; ни один другой legacy-файл и ни один модуль `src/` не наблюдает за runtime
  scheduling. Логируется только `setTimeout` с `delay < 1000` (267) — гипотеза: короткие таймеры
  чаще ассоциируются с polling/challenge-логикой anti-bot систем, чем с обычным UI-таймингом.
- **Захват стека вызовов на каждую запись лога** (`new Error().stack`, строка 37, `config.captureStackTraces`)
  — единственный legacy-файл, системно прикладывающий stack trace к каждому событию, а не только к
  ошибкам.
- **Sampled event logging** (`Math.random() < 0.01`, строка 324) — логирует 1% событий mousemove/click/
  keydown и т.д., чтобы не захлёбываться в объёме — отличная от FIFO-капа стратегия снижения нагрузки
  (вероятностная выборка вместо жёсткого потолка).
- **DOM-мониторинг по ключевым словам в `outerHTML`** добавленных узлов (289-317), а не по заранее
  известным селекторам — единственный DOM-наблюдатель среди всех legacy-файлов, который не завязан на
  конкретную разметку сайта.
- **`navigator.connection`/network-info snapshot** (374-383) и **navigation timing snapshot**
  (dnsLookup, domContentLoaded, loadComplete) (385-399) — единственный файл, фиксирующий сетевые
  условия клиента как часть anti-bot контекста (эти метрики релевантны, потому что многие anti-bot
  системы используют сетевые тайминги как часть fingerprint).
- **Двойное персистентное хранение**: в памяти (`this.logs`) и в `localStorage` (`antibot_monitor_logs`,
  строки 77-92) — единственный legacy-файл, переживающий перезагрузку страницы за счёт localStorage;
  ни один site-specific коллектор и ни один модуль `src/` этого не делает.
- Сессионный ID (`generateSessionId`, 24-26) — привязка всех записей к одной наблюдательной сессии.

**INFERENCE (зачем это появилось).** Судя по набору наблюдаемых сигналов (таймеры, стеки вызовов,
сетевые тайминги, DOM по ключевым словам, а не по селекторам), этот файл решал задачу принципиально
другого рода, чем site-specific коллекторы: не "что делает приложение", а "какие защитные механизмы
работают на странице и как они себя проявляют в runtime". Появление отдельного файла для этого — сигнал,
что авторы осознавали разницу между "профилировать бизнес-логику сайта" и "профилировать защитную
инфраструктуру сайта" как разные задачи, требующие разных сигналов.

**PRIVACY.** `exportLogs()` (94-105) включает `navigator.platform`, список названий плагинов браузера
(`navigator.plugins`) — потенциально fingerprint-релевантные данные о самом браузере наблюдателя,
не о сайте. Это иной класс данных, чем в site-specific файлах (там — токены/cookie сайта), и достоин
отдельного рассмотрения в `PRIVACY_REVIEW.md`: сбор данных о собственном browser fingerprint
наблюдателя — не то же самое, что сбор чужих auth-токенов.

### 3.2 `ANTIBOT_ANALIZ.js` (55 строк)

**PURPOSE.** Статический пост-процессор логов `AntiBotMonitor` — не отдельный коллектор, а слой анализа
поверх уже собранных данных.

**KEY FEATURES.** `analyzeLogs()` (3-28): группировка по типу события, группировка по минуте (timeline),
эвристика "подозрительности" — `isSuspicious()` (30-38) проверяет вхождение одного из паттернов
(`captcha`, `recaptcha`, `challenge`, `fingerprint`, `bot`, `block`, `detect`, `validate`) в
JSON-сериализованное тело лога. `exportToCSV()` (40-55) — плоский табличный экспорт.

**INFERENCE.** Это, по сути, первый (пусть и очень простой) прообраз "EXPLAIN"-слоя из целевой
архитектуры (§5 задания): сырые события → агрегированная временная линия → классификация "подозрительно/
нет". Примитивно (просто keyword match), но направление совпадает с `CAPTURE → CORRELATE → INFER →
EXPLAIN`. Важно: это классификация **самого содержимого события** ("похоже на anti-bot активность"),
а не корреляция между событиями — то есть это ближе к `INFER`, чем к `CORRELATE`.

**QUESTIONABLE.** `isSuspicious` — плоский substring-match по сериализованному JSON, без учёта поля,
контекста или частоты — даст много ложных срабатываний (например, URL, просто содержащий слово "token",
не обязательно связан с anti-bot).

### 3.3 `ANTIBOT_COMMANDS.js` (7 строк)

**PURPOSE.** Не код, а usage-сниппет: `window.getAntiBotLogs()` → `AntiBotAnalyzer.analyzeLogs()` →
`AntiBotAnalyzer.exportToCSV()`. Полезен только как документация связки двух других файлов —
самостоятельной архитектурной ценности не несёт.

---

## 4. Сводная таблица "что уже отражено в current toolkit"

Детальная capability-таблица — в `INVENTORY_MATRIX.md`. Здесь — только關 то, что напрямую пересекается
между legacy-файлами и текущей реализацией:

| Возможность legacy | Уже в `src/`? | Как соотносится |
|---|---|---|
| fetch/XHR/WebSocket/Beacon/EventSource перехват | ДА | `src/` строже (перехват `setRequestHeader`, `Request`-объект, восстановление патчей) |
| Bounded FIFO/TTL хранилища | ДА | `src/` — один `BoundedStore`/`BoundedList`; legacy — 6-10 ручных копий на файл |
| Parse-then-redact JSON | ДА (лучше) | Все legacy-файлы делают redact-then-maybe-parse или вообще не редактируют |
| Redaction по имени поля | ДА (лучше) | Site-specific файлы почти не редактируют — только усекают/base64-кодируют |
| Request fingerprint dedup | ДА | Ни один legacy-файл этого не делает (кроме простого id-based join запрос↔ответ) |
| SPA-навигация (pushState/replaceState/popstate/hashchange) | ДА | Ни один legacy-файл (включая generic) этого не делает вообще |
| Input-field protection (пароль/email/OTP) | ДА | Ни один legacy-файл не защищает поля ввода от логирования |
| Полное восстановление патчей (`cleanup()`) | ДА | Site-specific файлы восстанавливают частично или не восстанавливают вовсе |
| Доменная семантика (ASIN, subreddit, tweet, pin, ...) | НЕТ | Есть только в site-specific legacy — не перенесено |
| GraphQL operationName/переменные | НЕТ | Есть в 6 из 8 site-specific файлов (кроме Facebook, TikTok) |
| domTrigger/lastInteraction (действие → запрос) | НЕТ (и в legacy не работает) | Объявлено, но нигде не реализовано — ни в legacy, ни в `src/` |
| Memory-pressure-driven backpressure | НЕТ | Во всех 8 site-specific + antibot; в `src/` backpressure только capacity/TTL-based |
| Auto-stop таймер / kill-switch сессии | НЕТ | Во всех site-specific + antibot; в `src/` только ручной `stop()`/`cleanup()` |
| Runtime scheduling observation (timers) | НЕТ | Только в `ANTIBOT_MONITOR.js` |
| Stack trace на каждое событие | НЕТ | Только в `ANTIBOT_MONITOR.js` |
| Персистентность между перезагрузками (localStorage) | НЕТ | Только в `ANTIBOT_MONITOR.js` |
