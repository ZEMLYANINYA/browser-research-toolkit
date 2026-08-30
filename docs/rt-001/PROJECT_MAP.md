# PROJECT_MAP — карта репозитория browser-research-toolkit

> RT-001. Контрольная точка: tag `checkpoint-rt001-legacy-baseline`, commit `f3c44c0`.
> Документ носит инвентаризационный характер. Каждое утверждение помечено как
> **FACT** (подтверждено кодом), **INFERENCE** (логический вывод из нескольких наблюдений)
> или **PROPOSAL** (новая архитектурная идея, ещё не реализованная).

---

## 1. Два поколения материалов в репозитории

**FACT.** Репозиторий содержит два принципиально разных по природе набора файлов:

| Поколение | Расположение | Язык | Статус |
|---|---|---|---|
| Current implementation | `src/`, `tests/` | TypeScript (ESM), Node test runner | Активно поддерживается, есть CI |
| Legacy research prototypes | `legacy/generic/`, `legacy/site-specific/`, `legacy/antibot/` | Vanilla JS (IIFE, browser-console-паст) | Заморожено, только для истории |

**FACT.** История git показывает прямую связь между поколениями:

```
2de2fb3  Initial commit: layered TS rewrite, tests, CI
4a4f2f3  fix: guard bare navigator references (Node 20 has no global navigator before v21)
dc780a6  chore: ignore local AI snapshots
f3c44c0  RT-001: import legacy research prototypes   ← текущий checkpoint
```

**INFERENCE.** Судя по `README.md` ("Originally a single 1300-line script (`v3.0`, JS). This is
a full rewrite...") и по прямому построчному сравнению, `legacy/generic/SNIF_ENDPOINT_V2.js`
(1311 строк, `AdvancedResearchCollector`, версия помечена как `3.0`) — это тот самый исходный
скрипт, из которого вырос текущий `src/`. Он не является одним из многих экспериментов —
это прямой архитектурный предок current toolkit.

**INFERENCE.** Site-specific и antibot прототипы (`legacy/site-specific/*`, `legacy/antibot/*`)
— это параллельная ветвь экспериментов: тот же generic-паттерн (monkey-patch fetch/XHR/WebSocket +
bounded-хранилища + console API), но с добавленным слоем доменной классификации под конкретную
площадку. Они моложе или современны generic-скрипту (используют аналогичный, но не идентичный
код — см. `INVENTORY_MATRIX.md`), и не были интегрированы в TS-переписывание: current toolkit
(`src/`) не содержит ни одной site-specific концепции (ASIN, subreddit, tweet, GraphQL
operationName и т.д.) — он полностью site-agnostic по замыслу (см. README: "не хардкодим под
Google/Amazon/...").

---

## 2. Current implementation — карта `src/`

**FACT.** Композиционный корень — `src/collector.ts` (`ResearchCollector`). Он строит
`CollectorContext` (`src/context.ts`) и внедряет её во все interceptors/monitors через
конструктор — ни один модуль не знает о существовании других модулей, только о `ctx`.

```
src/
├── types.ts                        — все общие интерфейсы/типы данных
├── config.ts                       — DEFAULT_CONFIG, SENSITIVE_PATTERNS, mergeConfig()
├── context.ts                      — CollectorContext: общее состояние + сервисы,
│                                      строится один раз, инжектируется во всё остальное
├── sanitize/sanitizer.ts           — вся redaction-логика в одном месте
├── storage/bounded-store.ts        — BoundedStore<K,V> (TTL+size cap) и BoundedList<T> (FIFO cap)
├── logging/logger.ts               — консольный вывод + история ошибок (BoundedList<ErrorEntry>)
├── interceptors/
│   ├── fetch-interceptor.ts        — window.fetch
│   ├── xhr-interceptor.ts          — XMLHttpRequest (включая setRequestHeader)
│   ├── websocket-interceptor.ts    — WebSocket (send + все события)
│   ├── beacon-interceptor.ts       — navigator.sendBeacon
│   ├── eventsource-interceptor.ts  — EventSource (включая message-события)
│   └── dom-resource-interceptor.ts — Element.appendChild/insertBefore (динамические <script>/<link>)
├── monitors/
│   ├── event-monitor.ts            — DOM-события (click/submit/input/...), защита sensitive-полей
│   ├── error-monitor.ts            — window.error, unhandledrejection, console.error
│   ├── storage-monitor.ts          — localStorage/sessionStorage/cookies (snapshot + live patch)
│   ├── performance-monitor.ts      — PerformanceObserver + разовый скан истории через 2с после старта
│   ├── global-object-monitor.ts    — снимок сконфигурированных window.* объектов + window._*
│   ├── mutation-monitor.ts         — MutationObserver, ищет keyword-совпадения в data-* атрибутах
│   └── navigation-monitor.ts       — pushState/replaceState/popstate/hashchange (SPA-навигация)
├── analysis/
│   ├── response-analyzer.ts        — parse-then-redact, регистрация endpoint'ов, dedup
│   └── request-fingerprint.ts      — нормализованный fingerprint запроса (method+path+param-names)
├── export/exporter.ts              — сборка ExportPayload + скачивание JSON-файла
├── collector.ts                    — композиционный корень, публичный API (window.research)
└── index.ts                        — точка входа, window.RESEARCH_CONFIG, авто-экспорт на unload
```

**FACT.** Каждый interceptor реализует интерфейс `Interceptor { install(); restore(); }`,
каждый monitor — `Monitor { install(); teardown?(); }` (`src/types.ts:226-235`). Это то, что
делает возможным добавление нового interceptor/monitor без изменения остального кода —
композиция происходит только в `collector.ts` конструкторе.

**FACT.** `ResearchCollector.cleanup()` (`collector.ts:228-237`) вызывает `restore()` на всех
interceptors и `teardown()` на всех monitors — то есть архитектурно заложена полная
обратимость патчинга глобальных объектов. README отдельно фиксирует это как исправленный
недостаток legacy-версии.

**FACT.** Тестовое покрытие (`tests/`) — 17 тестов в двух слоях (пересчитано и подтверждено в
рамках corrective pass; предыдущая версия документа ошибочно указывала 16 — см. `INVENTORY_MATRIX.md`/TESTING):
- unit (`tests/unit/`): `Sanitizer`, `BoundedStore`/`BoundedList`, regression-тесты на
  unbounded-рост коллекций;
- integration (`tests/integration/`): полный `ResearchCollector` против `jsdom`-страницы
  с мокнутым `fetch` (dedup, excludeRules, parse-then-redact, SPA-навигация), отдельный набор
  под конкретные фиксы (input-field protection, XHR `setRequestHeader`, `fetch(new Request(...))`),
  и smoke-тест собранного IIFE-бандла (`dist/research-toolkit.bundle.js`) в реальной странице.

---

## 3. Legacy — карта `legacy/`

**FACT.** Все legacy-файлы — самовызывающиеся функции (`(function() { ... })()`), вставляемые
как есть в консоль браузера (paste-and-run), не модули, без сборки, без тестов.

### 3.1 `legacy/generic/SNIF_ENDPOINT_V2.js` (1311 строк)

**FACT.** Класс `AdvancedResearchCollector`, версия `'3.0'` (см. `exportData()`,
`meta.version`). Прямой предшественник `ResearchCollector`. Архитектурно — один класс
на ~40 методов, все сервисы (redaction, rotation, logging, network patch, DOM patch)
реализованы как методы этого же класса, состояние — свойства `this`. Подробности
и построчное сравнение см. `LEGACY_FINDINGS.md`.

### 3.2 `legacy/site-specific/*` (8 файлов, ~970–1350 строк каждый)

**FACT.** Файлы: `АМАЗОН.js`, `ИНСТА.js`, `РЕДДИТ.js`, `ТИКТОК.js`, `ФЕЙСБУК.js`,
`X_COM.js`, `allegro.js`, `PINTEREST.js`.

**INFERENCE.** Все восемь используют общий структурный скелет (см. также
`LEGACY_FINDINGS.md` и `CORRELATION_GROUNDWORK.md`):
- глобальный объект `CONFIG`/`config` с лимитами коллекций и `autoStopMinutes`;
- объект `securityAnalysis`/аналог с namespace'ами `session`/`network`/`security`/`timing`/`dom`;
- патч `fetch`/XHR с классификацией URL по подстрокам в доменные категории конкретного сайта
  (product/cart/search — Amazon; post/comment/vote/subreddit — Reddit; tweet/timeline — X;
  pin/board — Pinterest; и т.д.);
- `MutationObserver` со списком CSS-селекторов конкретного сайта;
- `PerformanceObserver`, отфильтрованный под ресурсы сайта;
- периодическая проверка `performance.memory` с принудительной полной очисткой при
  превышении порога (обычно 500 МБ);
- таймер авто-остановки (обычно 30 минут);
- набор `window.*`-команд для ручной инспекции из консоли.

Это означает, что site-specific прототипы — не восемь независимых экспериментов, а
восемь применений одного (не до конца формализованного) шаблона "site collector" поверх
разных доменов. Сам шаблон нигде не вынесен в переиспользуемый модуль — каждый файл
дублирует его с нуля.

### 3.3 `legacy/antibot/*` (3 файла)

**FACT.** `ANTIBOT_MONITOR.js` (403 строки) — класс `AntiBotMonitor`, тот же
monkey-patch-скелет (fetch/XHR/WebSocket/timers/DOM/events/storage/errors/network),
но ключевое отличие от site-specific коллекторов — фильтрация не по домену конкретного
сайта, а по общему списку keyword'ов, ассоциируемых с anti-bot/CAPTCHA-инфраструктурой
(`log`, `gen_204`, `bot`, `captcha`, `recaptcha`, `cloudflare`, `challenge`, `validate`,
`verify`, `token`, `fingerprint`, `beacon`), плюс перехват `setTimeout`/`setInterval`
(наблюдение за runtime scheduling — единственный legacy-файл, который это делает) и
захват стека вызовов на каждую запись лога.

`ANTIBOT_ANALIZ.js` (55 строк) — `AntiBotAnalyzer`, статический пост-процессор логов
`AntiBotMonitor` (группировка по типу, по минуте, эвристика "подозрительности" по ключевым
словам, экспорт в CSV).

`ANTIBOT_COMMANDS.js` (7 строк) — не код, а мини-шпаргалка использования (`window.getAntiBotLogs()`
→ `AntiBotAnalyzer.analyzeLogs()` → `exportToCSV()`).

Подробный разбор — в `LEGACY_FINDINGS.md`, раздел anti-bot; переинтерпретация под
"observability, не bypass" — см. §11 задания и `TARGET_ARCHITECTURE_DRAFT.md`.

---

## 4. Связи между поколениями

**FACT.** Прямых импортов между `legacy/` и `src/` нет — это полностью изолированные
деревья кода, `src/` ничего не знает о `legacy/` и наоборот.

**INFERENCE (эволюция требований).** Тем не менее, README текущего toolkit явно документирует
цепочку "что было исправлено при переписывании", и каждый пункт этой цепочки — это
баг или архитектурная слабость, реально присутствующая в `SNIF_ENDPOINT_V2.js`
(например: `websockets`/`performanceData` были обычными `Map` без ограничения размера;
редакция была "redact-then-maybe-parse", а не "parse-then-redact"; `xhr.setRequestHeader`
вообще не перехватывался; `console.error`-патч мог уйти в рекурсию). Это подтверждает,
что current toolkit — не независимая архитектура, а прямой ответ на выявленные при
использовании `SNIF_ENDPOINT_V2.js` проблемы.

**INFERENCE.** Site-specific и antibot прототипы не упомянуты в README вообще — они не
были источником для TS-переписывания. Доменная классификация (ASIN, subreddit, GraphQL
operationName, anti-bot keyword list) в current toolkit отсутствует полностью. Это
самостоятельный, ещё не проинтегрированный пласт исследовательских требований —
собственно то, ради чего написан этот документ и `LEGACY_FINDINGS.md`.

---

## 5. Границы проекта (что это НЕ)

**FACT (из README).** "For frontend/API research on pages you're authorized to inspect.
It's a passive observability tool — it does not evade bot detection, spoof fingerprints,
or bypass access controls."

**FACT (из задания RT-001, раздел 5).** Долгосрочное направление — конвейер
`CAPTURE → CORRELATE → INFER → EXPLAIN`; продукт не должен становиться ещё одним
Network Inspector/HTTP proxy/DevTools clone. Проверка того, какие из этих слоёв уже
существуют в коде (а не только в намерении), — предмет `TARGET_ARCHITECTURE_DRAFT.md`.

---

## 6. Active / Legacy / Experimental

| Категория | Компоненты | Обоснование |
|---|---|---|
| **Active** | весь `src/`, весь `tests/`, `.github/` CI, `package.json`/build-цепочка | Поддерживается, тестируется, собирается в `dist/` |
| **Legacy (frozen)** | весь `legacy/**` | Исторические прототипы, зафиксированы как read-only на этапе RT-001 |
| **Experimental / незавершено даже в момент создания** | `domTrigger`/`lastInteraction` во всех site-specific файлах и в `ANTIBOT_MONITOR.js` (объявлено, читается, но нигде не присваивается — см. `CORRELATION_GROUNDWORK.md`); `recommendationRequests` в `АМАЗОН.js` (классифицируется, но никогда не сохраняется) | Код, который сам себя не закончил — самостоятельный сигнал: авторы уже осознавали потребность в user-action → request корреляции, но не успели/не стали её реализовывать |

---

## 7. Краткая история эволюции (насколько это видно по коду)

**INFERENCE**, реконструировано по содержимому файлов и README (не по датам коммитов —
все legacy-файлы попали в репозиторий одним коммитом `f3c44c0` и внутренних временных
меток не содержат):

1. **Универсальный монолит.** `SNIF_ENDPOINT_V2.js` v3.0 — один общий скрипт без знания
   о конкретном сайте, изначально настроенный под Google Maps (ключевые слова `google`,
   `maps`, `geocode`, `directions`, `tile`/`vector`/`raster`/`pbf` в `DEFAULT_CONFIG.keywords`,
   `objectsToMonitor` включает `google`/`gm`/`GM` — см. `legacy/generic/SNIF_ENDPOINT_V2.js:22-27,690`).
2. **Ветвление под конкретные площадки.** Тот же скелет (fetch/XHR-патч + bounded-хранилища +
   redaction-заглушки + console API) вручную адаптируется под восемь разных сайтов,
   добавляется доменный классификатор URL/DOM. Каждый раз — копипаста, а не переиспользование.
3. **Анти-бот ветвь.** Параллельно тот же скелет применяется не к домену, а к паттерну
   "anti-bot/CAPTCHA инфраструктура" — с добавлением наблюдения за таймерами и стеками вызовов,
   которых нет ни в generic, ни в site-specific версиях.
4. **Переписывание.** `src/` — полная переработка только generic-ядра (без доменной
   классификации) на TypeScript со слоистой архитектурой, устраняющая задокументированные
   в README баги. Доменный и anti-bot слои в переписывание не попали.
5. **RT-001 (текущий этап).** Инвентаризация обоих пластов перед тем, как решить, что и как
   из site-specific/anti-bot знаний стоит формализовать в будущей архитектуре
   (`profiles`, `correlation`, `inference` — см. `TARGET_ARCHITECTURE_DRAFT.md`).
