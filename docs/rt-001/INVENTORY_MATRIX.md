# INVENTORY_MATRIX — матрица возможностей

> RT-001. Статусы: **CURRENT** (есть в `src/`, актуально) · **LEGACY_ONLY** (было в legacy, в `src/`
> нет) · **PARTIAL** (реализовано частично / хуже, чем могло бы быть) · **DUPLICATED** (переизобретено
> независимо в нескольких legacy-файлах, не унифицировано) · **EXPERIMENTAL** (объявлено, но не
> реализовано до конца — ни в legacy, ни в `src/`) · **MISSING** (нигде не реализовано).
>
> Источники для колонки "Site-Specific Legacy": все 8 файлов `legacy/site-specific/*`, см.
> `LEGACY_FINDINGS.md` §2 за подробностями и номерами строк.

---

## NETWORK

| Capability | Current Toolkit | Generic Legacy | Site-Specific Legacy | AntiBot Legacy | Status | Notes |
|---|---|---|---|---|---|---|
| fetch interception | `interceptors/fetch-interceptor.ts` | `SNIF_ENDPOINT_V2.js:115-150` | все 8, шаблонно | `ANTIBOT_MONITOR.js:128-170` | CURRENT | `src/` дополнительно верно обрабатывает `fetch(new Request(...))` — legacy теряет метод/заголовки в этой форме |
| XHR interception | `interceptors/xhr-interceptor.ts` | `SNIF_ENDPOINT_V2.js:152-201` | все 8 | `ANTIBOT_MONITOR.js:172-218` | CURRENT | `src/` перехватывает `setRequestHeader` — ни один legacy-файл этого не делает |
| request method | ДА | ДА | ДА | ДА | CURRENT | — |
| request URL | ДА (+ дедуп по fingerprint) | ДА | ДА | ДА | CURRENT | — |
| request headers | ДА (редактируется по имени поля) | ДА (редактируется по имени поля) | ДА, но не редактируется — только усекается | ДА, не редактируется | CURRENT / PARTIAL (legacy) | Site-specific legacy хранит auth-заголовки почти как есть |
| response headers | ДА (`contentType`) | ДА (`contentType`) | частично, разрозненно | НЕТ | CURRENT | — |
| request body | ДА, но **НЕ parse-then-redact** — только whole-string match (маскирует всё тело целиком) либо truncate; пофлдевой редакции для тела запроса нет вообще (исправлено в corrective pass, ранее ошибочно указано как parse-then-redact) | ДА (redact-then-maybe-parse) | ДА, base64 без пофлдевой редакции | частично | CURRENT (слабее, чем считалось) / PARTIAL (legacy) | См. `PRIVACY_REVIEW.md` §1, §6.4-3 |
| response body | ДА (parse-then-redact по полю — это единственный путь, где parse-then-redact реально применяется) | ДА (redact-then-maybe-parse) | ДА, base64 без пофлдевой редакции | частично | CURRENT / PARTIAL (legacy) | — |
| WebSocket | ДА, полный (send+все события) | ДА | ДА только в `ФЕЙСБУК.js:512-602`; в `allegro.js`/`PINTEREST.js` — лимиты объявлены, патча нет (мёртвый код) | ДА | CURRENT | 6 из 8 site-specific файлов вообще не перехватывают WS несмотря на то, что структуры для этого объявлены |
| EventSource / SSE | ДА, включая приём сообщений | частично — только открытие соединения, сообщения не слушаются | НЕТ ни в одном из 8 | НЕТ | CURRENT | README отдельно фиксирует это как исправленный баг ("EventSource messages are captured at all") |
| Beacon | ДА | ДА | НЕТ ни в одном из 8 | НЕТ | CURRENT | — |
| dynamic resources (`<script>`/`<link>` через DOM API) | ДА | ДА | НЕТ ни в одном из 8 | НЕТ | CURRENT | — |
| request fingerprint dedup | ДА (`analysis/request-fingerprint.ts`) | НЕТ | НЕТ (только простой id-based join запрос↔ответ в 5 из 8 файлов) | НЕТ | CURRENT | Дедуп по method+path+имена параметров — идея, отсутствующая в любом legacy |

## BROWSER STATE

| Capability | Current Toolkit | Generic Legacy | Site-Specific Legacy | AntiBot Legacy | Status | Notes |
|---|---|---|---|---|---|---|
| DOM events | ДА, 16 типов + input-field защита | ДА, те же 16 типов, БЕЗ защиты чувствительных полей | ДА, ad hoc click-делегирование на site-специфичные селекторы | ДА, 1% sampling | CURRENT | `src/monitors/event-monitor.ts` — единственная реализация, защищающая пароль/email/OTP поля от логирования и клавиш, и значений |
| DOM mutations | ДА (`mutation-monitor.ts`, по keyword в data-* атрибутах) | ДА, тот же паттерн | ДА, но по хардкод CSS/data-* селекторам конкретного сайта | ДА, по keyword в `outerHTML`, без привязки к селекторам | CURRENT / DUPLICATED (legacy site-specific) | AntiBot-подход (keyword в HTML) — обобщаемее site-specific подхода (селекторы) |
| navigation (базовая) | косвенно через performance/navigation timing | косвенно | косвенно | ДА, `navigation` perf entry snapshot | PARTIAL | — |
| History API / SPA-навигация | PARTIAL (исправлено в corrective pass) — pushState/replaceState/hashchange работают корректно; **popstate — сломан**: `onPopState` (`navigation-monitor.ts:15-18`) передаёт `window.location.href` и как `from`, и как `to`, а `record()` содержит `if (from === to) return` (строка 54) — эти два значения синхронно идентичны, поэтому popstate-событие отбрасывается всегда, во всех случаях; браузерная навигация назад/вперёд фактически не попадает в `navigationHistory` | НЕТ | НЕТ ни в одном из 8 | НЕТ | CURRENT (частично сломан) | Уникально для `src/` по намерению — README называет причину (SPA не шлёт `beforeunload`); но popstate-путь не работает с момента написания, ни один тест это не покрывает |
| localStorage | ДА (snapshot + live patch, редактируется по ключу) | ДА, тот же паттерн | ДА, частично (в некоторых файлах поле объявлено, но не всегда заполняется — напр. `ТИКТОК.js:24-27`) | ДА, плюс собственный ключ `antibot_monitor_logs` для персистентности | CURRENT | — |
| sessionStorage | ДА | ДА | частично/разрозненно | НЕТ | CURRENT | — |
| cookies | ДА (редактируется по имени, чувствительные имена исключаются) | ДА, тот же паттерн | ДА, извлекаются site-специфичные identity-cookie (`sessionid`, `auth_token`, `csrf_token`...) без редакции | НЕТ | CURRENT / PARTIAL (legacy) | См. `PRIVACY_REVIEW.md` — site-specific legacy хранит сессионные cookie как есть |

## RUNTIME

| Capability | Current Toolkit | Generic Legacy | Site-Specific Legacy | AntiBot Legacy | Status | Notes |
|---|---|---|---|---|---|---|
| timers (setTimeout/setInterval observation) | НЕТ | НЕТ | НЕТ | ДА (`ANTIBOT_MONITOR.js:261-286`, стек вызова на каждый вызов, delay<1000 фильтр) | LEGACY_ONLY | Единственный источник этой возможности во всём репозитории |
| stack traces (систематически, на каждое событие) | НЕТ (только на ошибки, `logger.ts`) | НЕТ (только на ошибки) | НЕТ | ДА (`ANTIBOT_MONITOR.js:37`, `new Error().stack` на каждый лог) | LEGACY_ONLY | `src/` захватывает stack только для `ErrorEntry`, не для discovery-событий |
| runtime errors (window.error, unhandledrejection) | ДА | ДА | ДА (`ФЕЙСБУК.js` и др. — базовый паттерн) | ДА | CURRENT | — |
| console/error monitoring | ДА, без риска рекурсии (`logger.ts` фиксирует "сырой" `console.error` на старте) | ДА, но с риском рекурсии — баг, описанный в README | частично | частично | CURRENT | Легаси-баг: патч `console.error` вызывает сам себя через собственный логгер |
| global objects (window.* снимки) | ДА, конфигурируемый список + `window._*` конвенция | ДА, тот же паттерн, хардкод `google`/`gm`/`GM` | НЕТ явного аналога в 8 site-specific файлах (есть только `session`/`fbConstants`-подобные поля, часто мёртвые) | НЕТ | CURRENT | — |
| **(добавлено в corrective pass)** initiator/stack-based sensor для сетевых запросов (откуда в коде страницы инициирован конкретный запрос, не просто факт ошибки) | НЕТ — stack захватывается только для `ErrorEntry` (`logger.ts:56`), ни для одного interceptor'а нет захвата стека на момент отправки запроса | НЕТ | НЕТ | ДА (`ANTIBOT_MONITOR.js:37`, на каждый лог, не только на ошибки) | MISSING (кроме antibot) | Подтверждено grep `\.stack\b` по всему `src/` — единственное совпадение вне `ErrorEntry` отсутствует |
| **(добавлено в corrective pass)** формальный session-lifecycle sensor (`visibilitychange`/`pagehide`, multi-tab/multi-instance awareness) | НЕТ — только плоский булев флаг `ctx.isActive`, переключаемый `start()`/`stop()` | НЕТ | НЕТ | НЕТ | MISSING | Grep `visibilitychange`/`pagehide`/`visibilityState` по всему `src/` — 0 совпадений |

## PERFORMANCE

| Capability | Current Toolkit | Generic Legacy | Site-Specific Legacy | AntiBot Legacy | Status | Notes |
|---|---|---|---|---|---|---|
| Performance API базовое использование | ДА | ДА | ДА, отфильтровано под ресурсы сайта | ДА (навигационные тайминги) | CURRENT | — |
| PerformanceObserver | ДА, отменяемый через `teardown()` | ДА, без явного disconnect в `cleanup()` (проверить нельзя — метод объявлен, но не вызывается) | ДА, во всех 8 | НЕТ | CURRENT | — |
| resource timing | ДА | ДА | ДА, отфильтровано | НЕТ | CURRENT | — |
| navigation timing | косвенно (через `performance` entries) | косвенно | НЕТ явного использования | ДА (`ANTIBOT_MONITOR.js:385-399`, явный разбор `domContentLoadedEventEnd`/`loadEventEnd`/`domainLookupEnd`) | PARTIAL | AntiBot — единственный, кто явно достаёт DNS/load-тайминги как самостоятельный сигнал |
| разовый скан существующих ресурсов при старте | ДА (`analyzeExistingRequests`, через 2с после старта, таймер отменяется в `cleanup()`) | ДА, тот же паттерн, таймер **не** отменяется в `cleanup()` | НЕТ | НЕТ | CURRENT | Исправленный в `src/` баг (см. `LEGACY_FINDINGS.md` §1) |

## APPLICATION SEMANTICS

| Capability | Current Toolkit | Generic Legacy | Site-Specific Legacy | AntiBot Legacy | Status | Notes |
|---|---|---|---|---|---|---|
| GraphQL detection (по URL/пути) | НЕТ | НЕТ | ДА, в 7 из 8 (все кроме `ТИКТОК.js`, где aweme API не GraphQL) | НЕТ | LEGACY_ONLY | — |
| GraphQL operationName | НЕТ | НЕТ | ДА, в 6 из 8 (кроме `ФЕЙСБУК.js`, где GraphQL-тело трактуется как opaque blob; кроме `ТИКТОК.js`) | НЕТ | LEGACY_ONLY | `X_COM.js` — наиболее точная реализация (классифицирует действие по **имени операции**, а не по URL) |
| GraphQL variables | НЕТ | НЕТ | ДА, в тех же 6 файлах (список имён переменных, не значений) | НЕТ | LEGACY_ONLY | — |
| endpoint classification (доменные категории: product/cart/post/tweet/...) | НЕТ (`isApiEndpoint` — только общий keyword-match, без семантики) | НЕТ | ДА, во всех 8, каждый под свой домен | ДА, но по anti-bot keyword'ам, не по бизнес-домену | LEGACY_ONLY | Ядро того, что `PROPOSAL`-раздел `TARGET_ARCHITECTURE_DRAFT.md` называет "profiles" |
| domain entities: product ID / ASIN | НЕТ | НЕТ | ДА, только `АМАЗОН.js` | НЕТ | LEGACY_ONLY | — |
| post ID / comment ID | НЕТ | НЕТ | ДА, только `РЕДДИТ.js` | НЕТ | LEGACY_ONLY | — |
| user ID | НЕТ | НЕТ | ДА, частично (`ИНСТА.js` через `ds_user_id`; `X_COM.js` через `twid`; остальные — нет явного извлечения) | НЕТ | LEGACY_ONLY, PARTIAL | — |
| votes / реакции | НЕТ | НЕТ | ДА, только `РЕДДИТ.js` (upvote/downvote через `dir=`) | НЕТ | LEGACY_ONLY | — |
| tweets / timeline | НЕТ | НЕТ | ДА, только `X_COM.js` | НЕТ | LEGACY_ONLY | — |
| pins / boards | НЕТ | НЕТ | ДА, только `PINTEREST.js` | НЕТ | LEGACY_ONLY | — |
| search operations | НЕТ | НЕТ | ДА, в 4 из 8 (`АМАЗОН.js`, `РЕДДИТ.js` — косвенно, `allegro.js`, `PINTEREST.js`) | НЕТ | LEGACY_ONLY | — |
| cart / checkout operations | НЕТ | НЕТ | ДА, в 2 из 8 (`АМАЗОН.js`, `allegro.js` — последний ещё и захватывает order-payload) | НЕТ | LEGACY_ONLY | — |
| anti-bot / CAPTCHA / challenge keyword classification | НЕТ | НЕТ | ДА, частично: `ТИКТОК.js` явно ищет anti-bot параметры подписи (X-Bogus/x-gorgon/msToken) как отдельный признак | ДА, это основное назначение `ANTIBOT_MONITOR.js` | LEGACY_ONLY | См. §10-11 задания — трактовать как observability, не bypass |

## CORRELATION

> Детальный разбор с точными местами в коде — в `CORRELATION_GROUNDWORK.md`. Здесь — только сводный статус.

| Capability | Current Toolkit | Generic Legacy | Site-Specific Legacy | AntiBot Legacy | Status | Notes |
|---|---|---|---|---|---|---|
| timestamps на каждой записи | ДА, повсеместно | ДА, повсеместно | ДА, повсеместно | ДА, повсеместно | CURRENT | Единственный по-настоящему универсальный correlation primitive во всём репозитории |
| requestId (генерация, привязка запрос→ответ внутри одного модуля) | ДА (`ctx.generateId()`, используется для dedup body/JSON) | ДА (`generateId()`) | ДА, во всех 8 (свой `req_`-подобный генератор) | НЕТ явного requestId, но есть `sessionId` | CURRENT | — |
| request → response корреляция (кросс-модульная, тело ответа привязывается к записи запроса) | ДА, через `requestData`-объект, разделяемый между interceptor и analyzer | ДА, тот же паттерн | ДА, через Map, ключ — `id`, в 5 из 8 (Instagram, TikTok, Facebook, X, частично Reddit) | НЕТ | CURRENT | — |
| response → request enrichment (сущность из ответа дописывается в запись запроса) | НЕТ | НЕТ | **PARTIAL** (понижено в corrective pass) — реализовано в `РЕДДИТ.js` (`createdPostId`) и `X_COM.js` (`createdTweetId`), но не gated по типу операции (create/view/like), поэтому подтверждён риск false positive: просмотр существующей сущности может быть ошибочно помечен как "созданная" | НЕТ | LEGACY_ONLY (эвристика, не надёжная) | См. `CORRELATION_GROUNDWORK.md` §5 — потенциальная INFERENCE RULE, но требует гейта по типу операции |
| lastInteraction / domTrigger (действие пользователя → исходящий запрос) | НЕТ | НЕТ (в generic-скрипте этого поля нет вообще) | EXPERIMENTAL — объявлено и читается во всех 8, но **нигде не присваивается**. **Уточнение (corrective pass):** все 8 — один скопированный шаблон (см. `LEGACY_FINDINGS.md` §2), т.е. это одно архитектурное намерение, а не 8 независимых подтверждений требования | EXPERIMENTAL — то же самое в `ANTIBOT_MONITOR.js`? Нет, в antibot этого поля нет вообще | EXPERIMENTAL | Ключевая находка RT-001 — см. `CORRELATION_GROUNDWORK.md` §3 |
| DOM-ancestor identity resolution (клик → ближайший предок с доменным ID) | НЕТ | НЕТ | **Пересмотрено в corrective pass.** Только `АМАЗОН.js` (`findClosestASIN`) реализует именно ancestor-walk механизм — сам алгоритм синтаксически валиден в изоляции, но **весь файл `АМАЗОН.js` не проходит `node --check`** (SyntaxError на строке 679, не связанная с этой функцией строка) и в текущем состоянии не исполняется вообще | НЕТ | LEGACY_ONLY (валидный, но неисполняемый паттерн) | **Не** единственная user action → entity корреляция — см. следующую строку |
| **(добавлено в corrective pass)** Closure-capture identity resolution (атрибут контейнера читается один раз при обнаружении, замыкается, используется при любом дочернем клике) | НЕТ | НЕТ | ДА, реально исполняется (`node --check` чисто) в 4 из 8: `РЕДДИТ.js` (postId/commentId), `X_COM.js` (tweetId), `PINTEREST.js` (pinId/boardId), `allegro.js` (productId/auctionId) | НЕТ | LEGACY_ONLY | Структурно отличается от ancestor-walk Amazon — читает атрибут контейнера один раз, не обходит DOM на каждый клик; см. `CORRELATION_GROUNDWORK.md` §4.2 |
| initiator information (откуда инициирован запрос — стек/источник) | НЕТ | НЕТ | НЕТ | ДА, косвенно через stack trace на каждом логе | LEGACY_ONLY | — |
| stack (на события/запросы, не только на ошибки) | НЕТ | НЕТ | НЕТ | ДА | LEGACY_ONLY | — |
| navigation → network activity корреляция | НЕТ явной привязки (события существуют раздельно) | НЕТ | НЕТ | НЕТ | MISSING | Ни один файл в репозитории не связывает конкретную SPA-навигацию с последовавшими за ней запросами |
| timer → network activity корреляция | НЕТ | НЕТ | НЕТ | НЕТ (таймеры и сеть логируются в общий список, но не связываются друг с другом) | MISSING | — |
| **(добавлено в corrective pass)** монотонный sequence-номер (порядок событий независимо от значения времени, кросс-типовой) | НЕТ — есть только `requestIdCounter`, используемый исключительно для ID запросов, не для DOM-событий/навигации/мутаций | НЕТ | НЕТ | НЕТ | MISSING | `Date.now()` (~1мс разрешение) — единственный источник времени; см. `CORRELATION_GROUNDWORK.md` §10, продемонстрирован конкретный сценарий коллизии меток (клик → синхронный fetch) |
| **(добавлено в corrective pass)** session/run-идентификатор коллектора | НЕТ | НЕТ | НЕТ | ДА (`generateSessionId()`, `ANTIBOT_MONITOR.js:19,24-26`) | MISSING (кроме antibot) | Без этого два запуска коллектора/два instance неотличимы при последующем объединении данных; см. `CORRELATION_GROUNDWORK.md` §10 |

## DATA MANAGEMENT

| Capability | Current Toolkit | Generic Legacy | Site-Specific Legacy | AntiBot Legacy | Status | Notes |
|---|---|---|---|---|---|---|
| bounded collections (единый механизм) | ДА, `BoundedStore`/`BoundedList` — один переиспользуемый примитив, арифметика ротации верна (проверено в corrective pass — ни в `BoundedList.push`, ни в `BoundedStore.rotate`, ни в ручной проверке `storage-monitor.ts` off-by-one не найден) | НЕТ, ручная ротация в 2+ местах (`rotateEndpoints`, `rotateJsonResponses`, инлайновый shift) | НЕТ, 6-10 независимых ручных реализаций **на файл** (×8 файлов) | НЕТ, ручной shift/slice | CURRENT / DUPLICATED (legacy) | Самое явное архитектурное улучшение `src/` относительно всего legacy-пласта. **Но (corrective pass): совокупный объём сессии не так туго ограничен, как предполагает чтение по названиям конфигов** — см. новую строку "aggregate session footprint" ниже |
| TTL | ДА (`endpointTtl`, применяется в `BoundedStore`) | ДА (`endpointTtl`, применяется только в `rotateEndpoints`, не в `rotateJsonResponses`) | НЕТ ни в одном из 8 (только count-based cap) | НЕТ | CURRENT | Site-specific legacy вообще не знает TTL как концепцию |
| **(добавлено в corrective pass)** aggregate session memory footprint (совокупный объём в памяти, а не отдельные структуры) | **PARTIAL** — три независимых фактора расширяют реальный потолок за пределы того, что предполагает название конфигов: (1) `maxEvents` применяется **на каждый тип DOM-события отдельно** (`context.ts:120-126`) — реальный потолок `maxEvents × число типов`, до 16-17 типов, т.е. до ~4800-5100 записей, а не 300; (2) начальный снимок `localStorage`/`sessionStorage`/cookies при старте (`storage-monitor.ts:28-38,68-85`) **вообще не ограничен** — только последующие живые записи капаются по одной; (3) WebSocket/EventSource буферы сообщений ограничены составной константой (соединения × сообщения-на-соединение), большей, чем предполагает любой из лимитов по отдельности (де-факто не unbounded, но и не "50 сообщений") | Н/П | Н/П | Н/П | PARTIAL (не MISSING — ничего не растёт бесконечно, но потолок выше ожидаемого) | Детали и точные числа — `PRIVACY_REVIEW.md`/`TARGET_ARCHITECTURE_DRAFT.md`; не называть сессию "полностью ограниченной по памяти" без этой оговорки |
| memory-pressure-driven backpressure (`performance.memory` heap threshold) | НЕТ | НЕТ | ДА, во всех 8 (порог обычно 500 МБ, полная очистка) | НЕТ | LEGACY_ONLY | См. `TARGET_ARCHITECTURE_DRAFT.md` — реальный gap в `src/`, `BoundedStore` реагирует только на count/TTL, не на живой heap |
| deduplication (по содержанию/fingerprint) | ДА (`request-fingerprint.ts`) | НЕТ | НЕТ (только id-based join, не семантический дедуп) | НЕТ | CURRENT | — |
| lifecycle: auto-stop таймер сессии | НЕТ (только ручной `stop()`) | НЕТ | ДА, во всех 8 (обычно 30 мин) | НЕТ явного (есть неограниченная работа до ручной `clearAntiBotLogs`) | LEGACY_ONLY | — |
| lifecycle: cleanup/restore всех патчей | **PARTIAL** (существенно понижено в corrective pass — ранее ошибочно "ДА, полный"). `cleanup()` вызывает `restore()`/`teardown()` на всех модулях, но это не атомарная граница: (1) WebSocket/EventSource — `restore()` меняет только глобальный конструктор, слушатели `message`/`send`, уже привязанные к открытым на момент `cleanup()` соединениям, продолжают писать в контекст без проверки `ctx.isActive` до тех пор, пока соединение не закроется само; (2) fetch/XHR — активность проверяется один раз, при отправке, а не при получении ответа — уже отправленный запрос допишет ответ в контекст, даже если `stop()` вызван до его завершения; (3) `PerformanceObserver`/`MutationObserver` — `disconnect()` вызывается корректно, но сам колбэк не имеет собственной проверки `ctx.isActive` (полагается только на браузерное отключение); (4) `ErrorMonitor` — единственный модуль с полностью корректным teardown (эталон для сравнения); (5) несколько инстансов коллектора на одной странице безопасны только при restore в строго обратном install-порядке (LIFO) — иначе `window.fetch`/`XMLHttpRequest`/`WebSocket` остаётся указывать на "мёртвую" обёртку вместо истинно нативной функции | ДА, но `setTimeout` не отменяется (см. `LEGACY_FINDINGS.md`) | частично/разрозненно, не все файлы восстанавливают все патчи | частично | CURRENT (с оговорками — не hard boundary) | Новый архитектурный риск **Session/Lifecycle Boundary Integrity** — подробности в `TARGET_ARCHITECTURE_DRAFT.md` |
| export (структурированный JSON) | ДА (`Exporter`, без дополнительного усечения поверх уже capped коллекций), но **не полный** — см. следующую строку | ДА, но с доп. хардкод-усечением `slice(-100)`/`slice(-20)` (баг, описанный в README) | НЕТ ни в одном из 8 — только `window.get*`-команды для ручной инспекции | НЕТ (кроме `exportLogs()`, без файлового экспорта) | CURRENT | — |
| **(добавлено в corrective pass)** экспорт данных `MutationMonitor` (`ctx.mutationDiscoveries`) | **НЕТ** — коллекция собирается и хранится (`mutation-monitor.ts:21,33`, `context.ts:53,77`), но не появляется ни в `ExportPayload` (`types.ts:198-223`), ни в `buildPayload()` (`exporter.ts:27-52`), ни в `Summary.collections`, ни в каком-либо публичном геттере на `ResearchCollector` (в отличие от аналогичных `getNavigationHistory()`/`getBeacons()`/`getDynamicResources()`) | Н/П | Н/П | Н/П | MISSING (genuine sensor-to-export gap) | `enableMutations` по умолчанию выключен (`config.ts:15`), но даже при включении собранные данные недостижимы ни из какого публичного API |
| filtering / noise reduction (`excludeRules`) | ДА, конфигурируемые regex + агрегированная статистика по правилу | НЕТ | НЕТ | НЕТ (частично — keyword allowlist сам по себе фильтр) | CURRENT | Уникально для `src/` |
| live query/inspection API (во время работающей сессии, не только экспорт) | ДА, частично (`getSummary`, `getEndpoints`, ...) | ДА, тот же набор команд | ДА, во всех 8, шире по числу команд (`getSessionInfo`, `getAuthData`, `getVoteHistory`, ...) | ДА (`getAntiBotLogs`) | CURRENT / DUPLICATED | Site-specific legacy предлагает больше специализированных read-команд, чем `src/`, ценой отсутствия единого экспорта |

## PRIVACY

> Детальный разбор — `PRIVACY_REVIEW.md`. Здесь — сводный статус наличия механизма.

| Capability | Current Toolkit | Generic Legacy | Site-Specific Legacy | AntiBot Legacy | Status | Notes |
|---|---|---|---|---|---|---|
| redaction (общий механизм) | ДА, единый `Sanitizer`, redact-default-on | ДА, тот же набор методов, но слабее по порядку (redact-then-maybe-parse) | ЧАСТИЧНО/НЕТ — почти везде только усечение по длине + base64-кодирование, не redaction по смыслу | ЧАСТИЧНО (`ANTIBOT_ANALIZ.js` не редактирует вообще, `ANTIBOT_MONITOR.js` не редактирует) | CURRENT | — |
| auth headers redaction | ДА, по regex на имя заголовка | ДА, тот же regex | НЕТ — auth-заголовки специально извлекаются и **сохраняются** для анализа (это их прямое назначение в site-specific файлах) | НЕТ (не является целью) | CURRENT / MISSING (legacy site-specific) | Конфликт целей: site-specific legacy **хочет** видеть auth-заголовки как есть — см. `PRIVACY_REVIEW.md` |
| Bearer/API-token redaction | ДА | ДА | НЕТ, токены сохраняются (обычно усечённые до 50-200 симв., не маскированные) | Косвенно (token — один из keyword'ов, вызывающих логирование, не редакция) | CURRENT / MISSING (legacy) | — |
| CSRF | ДА (через `SENSITIVE_PATTERNS.cookies`) | ДА | НЕТ — CSRF-токен явно извлекается и сохраняется в 7 из 8 файлов | НЕТ | CURRENT / MISSING (legacy) | — |
| cookies | ДА (чувствительные имена исключаются, значения редактируются) | ДА | НЕТ — identity-cookie (`sessionid`, `auth_token`, ...) извлекаются регулярными выражениями и сохраняются как есть | НЕТ (cookies не собираются вообще) | CURRENT / MISSING (legacy) | — |
| session identifiers | НЕТ отдельного класса (попадает под общие sensitive-паттерны) | НЕТ отдельного класса | ДА, явно извлекаются и хранятся (`session_id`, `loid`, `twid`, `visitor_id`, ...) | ДА, генерируется собственный `sessionId` (для маркировки логов, не для обхода) | PARTIAL | — |
| personal data (общее) | ДА, по regex-паттернам полей (`SENSITIVE_PATTERNS.credentials`) | ДА, тот же набор паттернов | НЕТ выделенного механизма — зависит от того, попадёт ли поле под общий keyword-фильтр | НЕТ | CURRENT | — |
| request bodies (redaction) | **ИСПРАВЛЕНО в corrective pass — было "ДА, parse-then-redact", это неверно.** Реально: только whole-string match (весь текст маскируется целиком при совпадении) либо truncate — `JSON.parse`/пофлдевая редакция для тела **запроса** не применяются нигде (`sanitizer.ts:59-77`, `sanitizeBody`) | ДА, слабее (redact-then-maybe-parse) | НЕТ — base64 полного тела, без пофлдевой фильтрации | частично | CURRENT (слабее, чем считалось) | См. `PRIVACY_REVIEW.md` §1 |
| response bodies (redaction) | ДА, parse-then-redact по полю (`response-analyzer.ts` → `sanitizeObject`) — единственный путь, где это реально применяется | ДА, слабее | НЕТ — то же самое | частично | CURRENT | — |
| Base64 encoding (как механизм капсуляции, не redaction) | НЕТ | НЕТ | ДА, во всех 8 (GraphQL/product/aweme тела кодируются в base64 до определённого размера — но это **не** приватность, а просто способ хранения бинарно-небезопасных данных как строки) | НЕТ | LEGACY_ONLY | Важное разграничение для `PRIVACY_REVIEW.md`: base64 ≠ redaction, это часто ошибочно воспринимается как "защита" |
| sensitive value detection (по значению, не по имени поля) | НЕТ (только по имени поля/URL/паттернам строки целиком) | НЕТ | НЕТ | НЕТ | MISSING | Зафиксировано как "Known limitation" в README `src/` — актуально для всего репозитория, не только legacy |
| **(добавлено в corrective pass)** URL fragment/hash redaction | НЕТ — `sanitizeUrl` работает только с `urlObj.searchParams`, `.hash` нигде не читается и не трогается | НЕТ | Н/П (base64/truncate, не URL-специфично) | Н/П | MISSING | OAuth implicit-flow `#access_token=...` проходит без изменений |
| **(добавлено в corrective pass)** покрытие реалистичных имён (code/access_token/session/sessionid/csrf/xsrf/signature/sig) | **НЕТ** — ни `REDACTED_QUERY_PARAMS` (`sanitizer.ts:4`, точное совпадение с 7 именами), ни `SENSITIVE_PATTERNS` (`config.ts:29-35`, 5 категорий) не содержат ни одного из этих имён | Аналогичный, но иной жёстко заданный список — та же категория проблемы | Н/П | Н/П | MISSING | Проверено прямым сопоставлением каждого имени против regex/списков — 0 совпадений на все 8 примеров |
| **(добавлено в corrective pass)** redaction для navigation URL / dynamic resource URL / performance resource name / export meta.url | **НЕТ ни для одного из четырёх** — ни `navigation-monitor.ts`, ни `dom-resource-interceptor.ts`, ни `performance-monitor.ts`, ни `exporter.ts` (поле `meta.url`) ни разу не обращаются к `Sanitizer` | Н/П | Н/П | Н/П | MISSING | Все четыре пути — CAPTURE ДА / STORE raw / EXPORT raw; см. `PRIVACY_REVIEW.md` §6.1 |
| **(добавлено в corrective pass)** redaction для `console.error()`-аргументов и текста/стека ошибок | **НЕТ** — `Logger` (`logger.ts`) не имеет зависимости от `Sanitizer` вообще; `ErrorMonitor`'s console.error-патч передаёт `args.slice(1)` как есть | Н/П | Н/П | Н/П | MISSING | Секрет, который страница сама залогировала через `console.error(msg, token)`, попадает в экспорт как есть |

## TESTING

| Capability | Current Toolkit | Generic Legacy | Site-Specific Legacy | AntiBot Legacy | Status | Notes |
|---|---|---|---|---|---|---|
| unit tests | ДА — `tests/unit/*.test.js`: `bounded-store.test.js` (3), `sanitizer.test.js` (6), `unbounded-growth.test.js` (2) = **11 тестов** (пересчитано в corrective pass) | НЕТ | НЕТ | НЕТ | CURRENT | — |
| integration tests | ДА — `tests/integration/*.test.js`: `bundle.smoke.test.js` (1), `collector.smoke.test.js` (1), `fixes.smoke.test.js` (3), `no-navigator.smoke.test.js` (1) = **6 тестов** (пересчитано в corrective pass) | НЕТ | НЕТ | НЕТ | CURRENT | — |
| regression tests | ДА (`tests/unit/unbounded-growth.test.js` — конкретно на баг с unbounded `websockets`/`performanceData`) | НЕТ | НЕТ | НЕТ | CURRENT | — |
| browser tests (реальный браузер, не jsdom) | НЕТ (только jsdom + мокнутый fetch) | НЕТ | НЕТ (проверялось вручную, по словам README — "paste into DevTools console") | НЕТ | MISSING | **Подтверждено в corrective pass**: ни Playwright, ни Puppeteer, ни Selenium, ни WebdriverIO не упоминаются нигде в репозитории (`package.json` devDependencies — только `esbuild`/`jsdom`/`typescript`); README прямо описывает как проверять вручную в реальном браузере — автоматизации этого шага нет |
| **ИТОГО тестов** | **17** (11 unit + 6 integration; исправлено в corrective pass — предыдущая версия документов ошибочно указывала 16) | Н/П | Н/П | Н/П | CURRENT | — |
| Node compatibility (CI-матрица) | ДА (`.github/` CI, отдельно пойман Node 20.x vs 22.x баг с `navigator`) | Н/П (не тестировалось, скрипт только для браузера) | Н/П | Н/П | CURRENT | — |
