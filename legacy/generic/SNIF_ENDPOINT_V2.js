(function() {
    'use strict';

    /**
     * Конфигурация по умолчанию (v3.0)
     */
    const DEFAULT_CONFIG = {
        maxRequests: 500,           // Максимум сетевых запросов в памяти
        maxEvents: 300,             // Максимум событий
        maxStorageItems: 100,       // Максимум элементов storage
        maxEndpoints: 200,          // Максимум хранимых endpoint'ов
        maxJsonResponses: 100,      // Максимум JSON ответов
        maxResponseSize: 1024 * 1024, // 1 MB, лимит ответа для анализа
        endpointTtl: 3600000,       // 1 час, удалять старые endpoint'ы
        redactSensitive: true,      // Редактировать чувствительные данные
        enablePerformance: true,    // Собирать performance метрики
        enableMutations: false,     // MutationObserver (тяжелый!)
        enableMouseTracking: false, // Отключаем mousemove по умолчанию
        logLevel: 'info',           // 'debug' | 'info' | 'warn' | 'error'
        autoExport: false,          // Авто-экспорт при достижении лимитов
        circularRefDepth: 5,        // Глубина для защиты от циклов
        keywords: [
            'api', 'maps', 'google', 'json', 'data', 'endpoint', 'rest', 'graphql',
            'auth', 'token', 'oauth', 'geocode', 'directions', 'route', 'search',
            'autocomplete', 'place', 'location', 'map', 'tile', 'vector', 'raster',
            'pbf', 'proto', 'grpc', 'websocket', 'sse', 'realtime'
        ]
    };

    /**
     * Паттерны для обнаружения чувствительных данных
     */
    const SENSITIVE_PATTERNS = {
        apiKey: /api[_-]?key|apikey|api_secret/i,
        auth: /authorization|bearer|token|jwt|session/i,
        password: /password|passwd|pwd/i,
        credentials: /username|email|phone|ssn|credit[_-]?card/i,
        cookies: /cookie|csrf|xsrf/i
    };

    class AdvancedResearchCollector {
        constructor(config = {}) {
            // Объединяем конфигурацию
            this.config = { ...DEFAULT_CONFIG, ...config };

            // Хранилища данных с автоматической ротацией
            this.endpoints = new Map();
            this.jsonData = new Map();
            this.websockets = new Map();
            this.events = new Map();
            this.errors = [];
            this.performanceData = new Map();
            this.localStorage = new Map();
            this.sessionStorage = new Map();
            this.cookies = new Map();
            this.globalObjects = new Map();
            this.networkRequests = [];

            // Служебные структуры
            this.originalFunctions = {};     // Для восстановления
            this.requestIdCounter = 0;
            this.startTime = Date.now();
            this.isActive = true;

            // Статистика
            this.stats = {
                totalRequests: 0,
                totalEvents: 0,
                droppedRequests: 0,
                droppedEvents: 0,
                redactedItems: 0
            };

            this.init();
        }

        init() {
            this.log('info', '🔬 ADVANCED RESEARCH TOOLKIT v3.0 ACTIVATED');

            // Инициализация мониторинга
            this.setupNetworkMonitoring();
            this.setupEventMonitoring();
            this.setupErrorMonitoring();
            this.setupStorageMonitoring();

            if (this.config.enablePerformance) {
                this.setupPerformanceMonitoring();
            }

            this.setupGlobalObjectMonitoring();

            if (this.config.enableMutations) {
                this.setupMutationObserver();
            }

            this.setupBeaconMonitoring();
            this.setupEventSourceMonitoring();

            // Cleanup при закрытии страницы
            window.addEventListener('beforeunload', () => this.cleanup());

            // Автоматический анализ существующих запросов
            setTimeout(() => this.analyzeExistingRequests(), 2000);

            this.printHelp();
        }

        // ========== NETWORK MONITORING ==========

        setupNetworkMonitoring() {
            const self = this;

            // === FETCH API ===
            this.originalFunctions.fetch = window.fetch;
            window.fetch = async function(...args) {
                if (!self.isActive) return self.originalFunctions.fetch.apply(this, args);

                const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
                const options = args[1] || {};
                const method = options.method || 'GET';
                const requestId = self.generateId();

                const requestData = {
                    id: requestId,
                    type: 'fetch',
                    url: self.sanitizeUrl(url),
                    method,
                    timestamp: Date.now(),
                    headers: self.sanitizeHeaders(options.headers),
                    body: self.sanitizeBody(options.body, url)
                };

                self.addNetworkRequest(requestData);
                self.logDiscovery('🌐 FETCH', `${method} ${self.truncate(url, 80)}`, requestData);

                try {
                    const response = await self.originalFunctions.fetch.apply(this, args);
                    const clonedResponse = response.clone();

                    // Асинхронный анализ ответа
                    self.analyzeResponse(clonedResponse, requestData).catch(err =>
                        self.logError('Response Analysis Error', err, { requestId })
                    );

                    return response;
                } catch (error) {
                    self.logError('Fetch Error', error, { url, method });
                    throw error;
                }
            };

            // === XMLHttpRequest ===
            const OriginalXHR = window.XMLHttpRequest;
            this.originalFunctions.XMLHttpRequest = OriginalXHR;

            window.XMLHttpRequest = function() {
                const xhr = new OriginalXHR();
                const requestId = self.generateId();
                let requestData = { id: requestId, type: 'xhr' };

                // Intercept open
                const originalOpen = xhr.open;
                xhr.open = function(method, url, ...rest) {
                    requestData = {
                        ...requestData,
                        url: self.sanitizeUrl(url),
                        method,
                        timestamp: Date.now()
                    };
                    return originalOpen.call(this, method, url, ...rest);
                };

                // Intercept send
                const originalSend = xhr.send;
                xhr.send = function(data) {
                    if (!self.isActive) return originalSend.call(this, data);

                    requestData.body = self.sanitizeBody(data, requestData.url);
                    self.addNetworkRequest(requestData);
                    self.logDiscovery('🌐 XHR', `${requestData.method} ${self.truncate(requestData.url, 80)}`, requestData);

                    // Мониторинг ответа
                    this.addEventListener('load', function() {
                        requestData.status = this.status;
                        requestData.statusText = this.statusText;
                        requestData.responseType = this.responseType;

                        self.analyzeXHRResponse(this, requestData).catch(err =>
                            self.logError('XHR Response Error', err, { requestId })
                        );
                    });

                    this.addEventListener('error', function() {
                        self.logError('XHR Error', new Error('Network Error'), requestData);
                    });

                    return originalSend.call(this, data);
                };

                return xhr;
            };

            // === WebSocket ===
            this.originalFunctions.WebSocket = window.WebSocket;
            window.WebSocket = function(url, protocols) {
                if (!self.isActive) return new self.originalFunctions.WebSocket(url, protocols);

                const ws = new self.originalFunctions.WebSocket(url, protocols);
                const wsId = self.generateId();

                const wsData = {
                    id: wsId,
                    type: 'websocket',
                    url: self.sanitizeUrl(url),
                    protocols,
                    timestamp: Date.now(),
                    messages: [],
                    state: 'connecting'
                };

                self.websockets.set(wsId, wsData);
                self.logDiscovery('🔌 WEBSOCKET', `Connecting to ${self.truncate(url, 60)}`, wsData);

                // Мониторинг сообщений
                ws.addEventListener('open', () => {
                    wsData.state = 'open';
                    self.log('debug', `WebSocket opened: ${wsId}`);
                });

                ws.addEventListener('message', (event) => {
                    const message = {
                        type: 'received',
                        data: self.sanitizeWebSocketData(event.data),
                        timestamp: Date.now()
                    };

                    // Ротация старых сообщений
                    if (wsData.messages.length > 50) {
                        wsData.messages.shift();
                    }
                    wsData.messages.push(message);

                    self.analyzeWebSocketMessage(event.data, wsData);
                });

                ws.addEventListener('close', () => {
                    wsData.state = 'closed';
                    wsData.closedAt = Date.now();
                });

                ws.addEventListener('error', (error) => {
                    wsData.state = 'error';
                    self.logError('WebSocket Error', error, { wsId, url });
                });

                // Intercept send
                const originalSend = ws.send.bind(ws);
                ws.send = function(data) {
                    const message = {
                        type: 'sent',
                        data: self.sanitizeWebSocketData(data),
                        timestamp: Date.now()
                    };

                    if (wsData.messages.length > 50) {
                        wsData.messages.shift();
                    }
                    wsData.messages.push(message);

                    return originalSend(data);
                };

                return ws;
            };

            // === Dynamic Resources ===
            this.monitorDynamicResources();
        }

        monitorDynamicResources() {
            const self = this;
            const originalAppendChild = Element.prototype.appendChild;
            const originalInsertBefore = Element.prototype.insertBefore;

            Element.prototype.appendChild = function(element) {
                if (!self.isActive) return originalAppendChild.call(this, element);

                if (element.tagName === 'SCRIPT' && element.src) {
                    self.logDiscovery('📜 DYNAMIC SCRIPT', element.src, {
                        url: element.src,
                        async: element.async,
                        defer: element.defer,
                        type: 'dynamic_script'
                    });
                }

                if (element.tagName === 'LINK' && element.rel === 'stylesheet') {
                    self.logDiscovery('🎨 DYNAMIC CSS', element.href, {
                        url: element.href,
                        type: 'dynamic_css'
                    });
                }

                return originalAppendChild.call(this, element);
            };

            Element.prototype.insertBefore = function(element, reference) {
                if (!self.isActive) return originalInsertBefore.call(this, element, reference);

                if (element.tagName === 'SCRIPT' && element.src) {
                    self.logDiscovery('📜 DYNAMIC SCRIPT', element.src, {
                        url: element.src,
                        method: 'insertBefore',
                        type: 'dynamic_script'
                    });
                }

                return originalInsertBefore.call(this, element, reference);
            };
        }

        async analyzeResponse(response, requestData) {
            try {
                const contentType = response.headers.get('content-type') || '';
                requestData.contentType = contentType;
                requestData.status = response.status;

                // Анализ только текстовых ответов с ограничением размера
                if (contentType.includes('json') || contentType.includes('text') || contentType.includes('javascript')) {
                    const text = await response.text();
                    const size = text.length;
                    const truncated = size > this.config.maxResponseSize;
                    const body = truncated ? text.slice(0, this.config.maxResponseSize) : text;

                    if (this.containsSensitiveData(body)) {
                        requestData.responseText = '[REDACTED - Contains sensitive data]';
                        this.stats.redactedItems++;
                    } else {
                        // Попытка парсинга JSON
                        if (contentType.includes('json')) {
                            try {
                                const json = JSON.parse(body);
                                requestData.responseType = 'json';
                                requestData.jsonData = this.sanitizeObject(json);
                                if (truncated) requestData.jsonData.__response_truncated__ = true;

                                this.jsonData.set(requestData.id, {
                                    request: requestData,
                                    response: requestData.jsonData,
                                    timestamp: Date.now()
                                });
                                this.rotateJsonResponses();
                                this.logDiscovery('📦 JSON RESPONSE',
                                    `From: ${this.truncate(requestData.url, 60)}`,
                                    { size, truncated, keys: Object.keys(json).length });
                            } catch (e) {
                                requestData.responseType = 'text';
                                requestData.responseText = this.truncate(body, 500);
                            }
                        } else {
                            requestData.responseType = 'text';
                            requestData.responseText = this.truncate(body, 500);
                        }
                    }
                }

                // Проверка на API endpoint
                if (this.isApiEndpoint(requestData.url)) {
                    this.endpoints.set(requestData.id, requestData);
                    this.rotateEndpoints();
                    this.log('info', `🎯 API Endpoint discovered: ${this.truncate(requestData.url, 60)}`);
                }

            } catch (error) {
                this.logError('Response Analysis Failed', error, { requestId: requestData.id });
            }
        }

        async analyzeXHRResponse(xhr, requestData) {
            try {
                if (xhr.responseType === '' || xhr.responseType === 'text') {
                    const text = xhr.responseText || '';

                    if (this.containsSensitiveData(text)) {
                        requestData.response = '[REDACTED]';
                        this.stats.redactedItems++;
                        return;
                    }

                    try {
                        const json = JSON.parse(text);
                        requestData.responseType = 'json';
                        requestData.jsonData = this.sanitizeObject(json);

                        this.jsonData.set(requestData.id, {
                            request: requestData,
                            response: json,
                            timestamp: Date.now()
                        });
                        this.rotateJsonResponses();
                    } catch (e) {
                        requestData.responseType = 'text';
                        requestData.responseText = this.truncate(text, 500);
                    }
                } else if (xhr.responseType === 'json') {
                    requestData.jsonData = this.sanitizeObject(xhr.response);
                }

                if (this.isApiEndpoint(requestData.url)) {
                    this.endpoints.set(requestData.id, requestData);
                    this.rotateEndpoints();
                }

            } catch (error) {
                this.logError('XHR Response Analysis Failed', error, { requestId: requestData.id });
            }
        }

        analyzeWebSocketMessage(data, wsData) {
            try {
                // Попытка парсинга JSON в WebSocket сообщениях
                if (typeof data === 'string') {
                    try {
                        const json = JSON.parse(data);
                        this.logDiscovery('📨 WS JSON', `WebSocket: ${wsData.id}`,
                            { type: 'websocket_json', data: this.sanitizeObject(json) });
                    } catch (e) {
                        // Not JSON, ignore
                    }
                }
            } catch (error) {
                this.log('debug', 'WebSocket message analysis failed', error);
            }
        }

        // ========== BEACON & EVENTSOURCE MONITORING ==========

        setupBeaconMonitoring() {
            if (!navigator.sendBeacon) return;
            const self = this;
            const originalBeacon = navigator.sendBeacon;
            navigator.sendBeacon = function(url, data) {
                if (self.isActive) {
                    self.logDiscovery('📡 BEACON', url, {
                        url: self.sanitizeUrl(url),
                        dataSize: data?.size || (data?.length) || 'unknown',
                        type: 'beacon'
                    });
                }
                return originalBeacon.call(this, url, data);
            };
            this.originalFunctions.sendBeacon = originalBeacon;
        }

        setupEventSourceMonitoring() {
            if (!window.EventSource) return;
            const self = this;
            const OriginalEventSource = window.EventSource;
            window.EventSource = function(url, eventSourceInitDict) {
                self.logDiscovery('🔌 EVENTSOURCE', `Connecting to ${self.truncate(url, 80)}`, {
                    url: self.sanitizeUrl(url),
                    withCredentials: eventSourceInitDict?.withCredentials || false
                });
                const es = new OriginalEventSource(url, eventSourceInitDict);
                // Можно добавить перехват сообщений, если нужно
                return es;
            };
            this.originalFunctions.EventSource = OriginalEventSource;
        }

        // ========== EVENT MONITORING ==========

        setupEventMonitoring() {
            const self = this;
            const eventTypes = [
                'click', 'dblclick', 'mousedown', 'mouseup',
                'keydown', 'keyup', 'keypress',
                'submit', 'change', 'input', 'focus', 'blur',
                'scroll', 'resize', 'load', 'error'
            ];
            if (this.config.enableMouseTracking) {
                eventTypes.push('mousemove');
            }

            eventTypes.forEach(type => {
                document.addEventListener(type, function(event) {
                    if (!self.isActive) return;

                    const eventData = {
                        type: event.type,
                        timestamp: Date.now(),
                        target: self.getElementInfo(event.target),
                        details: self.getEventDetails(event)
                    };

                    self.addEvent(type, eventData);

                    // Логируем только важные события
                    if (['click', 'submit', 'error'].includes(type)) {
                        self.logDiscovery(`🎯 EVENT:${type.toUpperCase()}`,
                            `Target: ${eventData.target}`, eventData);
                    }
                }, true);
            });
        }

        // ========== ERROR MONITORING ==========

        setupErrorMonitoring() {
            const self = this;

            // Global error handler
            window.addEventListener('error', function(event) {
                self.logError('Global Error', event.error || event.message, {
                    filename: event.filename,
                    lineno: event.lineno,
                    colno: event.colno,
                    type: 'global_error'
                });
            });

            // Promise rejection handler
            window.addEventListener('unhandledrejection', function(event) {
                self.logError('Unhandled Promise Rejection', event.reason, {
                    type: 'promise_rejection'
                });
            });

            // Console error intercept
            const originalConsoleError = console.error;
            console.error = function(...args) {
                self.logError('Console Error', args[0], { args: args.slice(1) });
                return originalConsoleError.apply(console, args);
            };
        }

        // ========== STORAGE MONITORING ==========

        setupStorageMonitoring() {
            const self = this;

            // Снимок текущего состояния
            this.captureStorageSnapshot();

            // Intercept localStorage
            const originalSetItem = Storage.prototype.setItem;
            Storage.prototype.setItem = function(key, value) {
                if (!self.isActive) return originalSetItem.call(this, key, value);

                const storageType = this === window.localStorage ? 'localStorage' : 'sessionStorage';
                const targetMap = this === window.localStorage ? self.localStorage : self.sessionStorage;

                const sanitizedValue = self.sanitizeStorageValue(value, key);
                targetMap.set(key, {
                    value: sanitizedValue,
                    timestamp: Date.now(),
                    size: value.length
                });

                self.logDiscovery(`💾 ${storageType.toUpperCase()}`,
                    `SET ${key}`, { key, valueLength: value.length });

                // Ротация
                if (targetMap.size > self.config.maxStorageItems) {
                    const firstKey = targetMap.keys().next().value;
                    targetMap.delete(firstKey);
                }

                return originalSetItem.call(this, key, value);
            };

            // Мониторинг cookies
            this.monitorCookies();
        }

        captureStorageSnapshot() {
            try {
                for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);
                    const value = localStorage.getItem(key);
                    this.localStorage.set(key, {
                        value: this.sanitizeStorageValue(value, key),
                        timestamp: Date.now(),
                        size: value.length
                    });
                }

                for (let i = 0; i < sessionStorage.length; i++) {
                    const key = sessionStorage.key(i);
                    const value = sessionStorage.getItem(key);
                    this.sessionStorage.set(key, {
                        value: this.sanitizeStorageValue(value, key),
                        timestamp: Date.now(),
                        size: value.length
                    });
                }
            } catch (error) {
                this.log('warn', 'Storage snapshot failed', error);
            }
        }

        monitorCookies() {
            try {
                const cookies = document.cookie.split(';');
                cookies.forEach(cookie => {
                    const eqPos = cookie.indexOf('=');
                    if (eqPos === -1) return;
                    const name = cookie.slice(0, eqPos).trim();
                    const value = cookie.slice(eqPos + 1).trim();
                    if (name && !this.containsSensitiveData(name)) {
                        this.cookies.set(name, {
                            value: this.sanitizeStorageValue(value || '', name),
                            timestamp: Date.now()
                        });
                    }
                });
            } catch (error) {
                this.log('debug', 'Cookie monitoring failed', error);
            }
        }

        // ========== PERFORMANCE MONITORING ==========

        setupPerformanceMonitoring() {
            const self = this;

            if (!window.performance || !performance.getEntriesByType) {
                this.log('warn', 'Performance API not available');
                return;
            }

            // Performance Observer
            try {
                const observer = new PerformanceObserver((list) => {
                    list.getEntries().forEach(entry => {
                        if (self.isApiEndpoint(entry.name)) {
                            self.performanceData.set(entry.name, {
                                name: entry.name,
                                duration: entry.duration,
                                startTime: entry.startTime,
                                type: entry.entryType,
                                timestamp: Date.now()
                            });

                            self.log('debug', `⚡ Performance: ${entry.name} - ${entry.duration.toFixed(2)}ms`);
                        }
                    });
                });

                observer.observe({ entryTypes: ['resource', 'navigation', 'measure'] });
            } catch (error) {
                this.log('warn', 'PerformanceObserver setup failed', error);
            }
        }

        analyzeExistingRequests() {
            if (!window.performance || !performance.getEntriesByType) return;

            try {
                const entries = performance.getEntriesByType('resource');
                let foundCount = 0;

                entries.forEach(entry => {
                    if (this.isApiEndpoint(entry.name)) {
                        foundCount++;
                        this.performanceData.set(entry.name, {
                            name: entry.name,
                            duration: entry.duration,
                            initiatorType: entry.initiatorType,
                            transferSize: entry.transferSize,
                            timestamp: Date.now()
                        });
                    }
                });

                if (foundCount > 0) {
                    this.log('info', `🔍 Found ${foundCount} API endpoints in performance history`);
                }
            } catch (error) {
                this.log('warn', 'Existing requests analysis failed', error);
            }
        }

        // ========== GLOBAL OBJECT MONITORING ==========

        setupGlobalObjectMonitoring() {
            const self = this;

            // Мониторинг специфичных глобальных объектов
            const objectsToMonitor = ['google', 'gm', 'GM', 'config', 'appConfig', 'API_KEY'];

            objectsToMonitor.forEach(objName => {
                if (window[objName]) {
                    try {
                        this.globalObjects.set(objName, {
                            value: this.sanitizeObject(window[objName], 0),
                            timestamp: Date.now(),
                            type: typeof window[objName]
                        });

                        this.log('info', `🔍 Global object found: ${objName}`);
                    } catch (error) {
                        this.log('debug', `Failed to capture ${objName}`, error);
                    }
                }
            });

            // Мониторинг window._* переменных (часто используются для конфигурации)
            Object.keys(window).forEach(key => {
                if (key.startsWith('_') && typeof window[key] === 'object') {
                    try {
                        this.globalObjects.set(key, {
                            value: this.sanitizeObject(window[key], 0),
                            timestamp: Date.now()
                        });
                    } catch (error) {
                        // Ignore
                    }
                }
            });
        }

        // ========== MUTATION OBSERVER (исправлен) ==========

        setupMutationObserver() {
            if (!window.MutationObserver) return;

            const self = this;
            const observer = new MutationObserver((mutations) => {
                mutations.forEach(mutation => {
                    // Отслеживаем добавление data-* атрибутов
                    if (mutation.type === 'attributes' && mutation.attributeName && mutation.attributeName.startsWith('data-')) {
                        const node = mutation.target;
                        const key = mutation.attributeName;
                        const value = node.getAttribute(key);
                        if (value && self.config.keywords.some(kw => key.toLowerCase().includes(kw))) {
                            self.logDiscovery('🔍 DATA ATTRIBUTE', `${key}=${self.truncate(value, 100)}`, {
                                element: self.getElementInfo(node),
                                attribute: key,
                                value: self.truncate(value, 100)
                            });
                        }
                    }
                    // Отслеживаем новые узлы с data-*
                    if (mutation.type === 'childList') {
                        mutation.addedNodes.forEach(node => {
                            if (node.nodeType === 1 && node.dataset) {
                                Object.keys(node.dataset).forEach(key => {
                                    if (self.config.keywords.some(kw => key.toLowerCase().includes(kw))) {
                                        self.logDiscovery('🔍 DATA ATTRIBUTE (new node)', `${key}=${node.dataset[key]}`, {
                                            element: self.getElementInfo(node),
                                            attribute: key,
                                            value: self.truncate(node.dataset[key], 100)
                                        });
                                    }
                                });
                            }
                        });
                    }
                });
            });

            observer.observe(document.body, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: [] // data-* не вписываются в фильтр, обрабатываем вручную
            });

            this.mutationObserver = observer;
        }

        // ========== SANITIZATION & SECURITY (улучшенный sanitizeObject) ==========

        containsSensitiveData(str) {
            if (typeof str !== 'string') return false;
            return Object.values(SENSITIVE_PATTERNS).some(pattern => pattern.test(str));
        }

        sanitizeUrl(url) {
            if (!this.config.redactSensitive) return url;

            try {
                const urlObj = new URL(url, window.location.href);

                // Редактируем чувствительные query параметры
                ['key', 'token', 'apikey', 'api_key', 'secret', 'auth', 'password'].forEach(param => {
                    if (urlObj.searchParams.has(param)) {
                        urlObj.searchParams.set(param, '[REDACTED]');
                    }
                });

                return urlObj.toString();
            } catch (e) {
                return url;
            }
        }

        sanitizeHeaders(headers) {
            if (!headers || !this.config.redactSensitive) return headers;

            const sanitized = {};
            const headersObj = headers instanceof Headers ?
                Object.fromEntries(headers.entries()) : headers;

            for (const [key, value] of Object.entries(headersObj)) {
                if (SENSITIVE_PATTERNS.auth.test(key) || SENSITIVE_PATTERNS.apiKey.test(key)) {
                    sanitized[key] = '[REDACTED]';
                    this.stats.redactedItems++;
                } else {
                    sanitized[key] = value;
                }
            }

            return sanitized;
        }

        sanitizeBody(body, url = '') {
            if (!body) return null;
            if (!this.config.redactSensitive) return this.truncate(String(body), 500);

            // Проверяем URL на наличие чувствительных эндпоинтов
            if (/login|auth|register|password/i.test(url)) {
                this.stats.redactedItems++;
                return '[REDACTED - Auth endpoint]';
            }

            if (typeof body === 'string') {
                if (this.containsSensitiveData(body)) {
                    this.stats.redactedItems++;
                    return '[REDACTED - Contains sensitive data]';
                }
                return this.truncate(body, 500);
            }

            return '[Binary Data]';
        }

        sanitizeObject(obj, depth = 0, seen = new WeakSet()) {
            if (depth > this.config.circularRefDepth) {
                return '[Max depth reached]';
            }

            if (obj === null || typeof obj !== 'object') {
                return obj;
            }

            // Защита от циклических ссылок (локальный WeakSet)
            if (seen.has(obj)) {
                return '[Circular Reference]';
            }

            seen.add(obj);

            try {
                if (Array.isArray(obj)) {
                    const arr = obj.slice(0, 10).map(item => this.sanitizeObject(item, depth + 1, seen));
                    if (obj.length > 10) {
                        arr.push(`[+${obj.length - 10} more]`);
                    }
                    return arr;
                }

                const keys = Object.keys(obj);
                const truncated = keys.length > 50;
                const limitedKeys = truncated ? keys.slice(0, 50) : keys;
                const sanitized = {};

                for (const key of limitedKeys) {
                    if (this.containsSensitiveData(key)) {
                        sanitized[key] = '[REDACTED]';
                        this.stats.redactedItems++;
                    } else {
                        try {
                            sanitized[key] = this.sanitizeObject(obj[key], depth + 1, seen);
                        } catch (e) {
                            sanitized[key] = '[Error accessing property]';
                        }
                    }
                }

                if (truncated) {
                    sanitized.__keys_truncated__ = keys.length;
                }
                return sanitized;
            } finally {
                seen.delete(obj);
            }
        }

        sanitizeStorageValue(value, key) {
            if (this.containsSensitiveData(key)) {
                this.stats.redactedItems++;
                return '[REDACTED]';
            }

            try {
                const parsed = JSON.parse(value);
                return this.sanitizeObject(parsed);
            } catch (e) {
                return this.truncate(value, 200);
            }
        }

        sanitizeWebSocketData(data) {
            if (typeof data === 'string') {
                if (this.containsSensitiveData(data)) {
                    this.stats.redactedItems++;
                    return '[REDACTED]';
                }
                return this.truncate(data, 500);
            }
            return '[Binary Data]';
        }

        // ========== UTILITY METHODS ==========

        isApiEndpoint(url) {
            if (!url) return false;
            const urlLower = url.toLowerCase();
            return this.config.keywords.some(keyword => urlLower.includes(keyword.toLowerCase()));
        }

        addNetworkRequest(requestData) {
            this.stats.totalRequests++;

            // FIFO ротация при превышении лимита
            if (this.networkRequests.length >= this.config.maxRequests) {
                this.networkRequests.shift();
                this.stats.droppedRequests++;

                if (this.config.autoExport && this.stats.droppedRequests % 100 === 0) {
                    this.log('warn', '⚠️ Request buffer full, consider exporting data');
                }
            }

            this.networkRequests.push(requestData);
        }

        addEvent(type, eventData) {
            this.stats.totalEvents++;

            if (!this.events.has(type)) {
                this.events.set(type, []);
            }

            const eventArray = this.events.get(type);

            // Ротация событий
            if (eventArray.length >= this.config.maxEvents) {
                eventArray.shift();
                this.stats.droppedEvents++;
            }

            eventArray.push(eventData);
        }

        rotateEndpoints() {
            if (this.endpoints.size <= this.config.maxEndpoints) return;
            const now = Date.now();
            // Удаляем старые по TTL
            for (const [id, ep] of this.endpoints.entries()) {
                if (now - ep.timestamp > this.config.endpointTtl) {
                    this.endpoints.delete(id);
                }
            }
            // Если всё ещё слишком много, удаляем самые старые
            if (this.endpoints.size > this.config.maxEndpoints) {
                const sorted = Array.from(this.endpoints.entries()).sort((a,b) => a[1].timestamp - b[1].timestamp);
                const toDelete = sorted.slice(0, this.endpoints.size - this.config.maxEndpoints);
                for (const [id] of toDelete) this.endpoints.delete(id);
            }
        }

        rotateJsonResponses() {
            if (this.jsonData.size <= this.config.maxJsonResponses) return;
            const sorted = Array.from(this.jsonData.entries()).sort((a,b) => a[1].timestamp - b[1].timestamp);
            const toDelete = sorted.slice(0, this.jsonData.size - this.config.maxJsonResponses);
            for (const [id] of toDelete) this.jsonData.delete(id);
        }

        logDiscovery(type, message, data) {
            if (this.config.logLevel === 'error') return;

            console.groupCollapsed(`%c${type} %c${message}`,
                'color: #FF6B6B; font-weight: bold; background: #FFF3E0; padding: 2px 6px; border-radius: 3px;',
                'color: #00897B; font-weight: normal;');

            if (data && this.config.logLevel === 'debug') {
                console.log('📋 Data:', data);
            }

            console.groupEnd();
        }

        logError(type, error, context) {
            console.error(`%c❌ ${type}`,
                'color: #FF5252; font-weight: bold; background: #FFEBEE; padding: 2px 6px; border-radius: 3px;',
                error, context);

            // Ротация ошибок
            if (this.errors.length > 100) {
                this.errors.shift();
            }

            this.errors.push({
                type,
                error: error.message || String(error),
                context,
                timestamp: Date.now(),
                stack: error.stack
            });
        }

        log(level, message, data) {
            const levels = { debug: 0, info: 1, warn: 2, error: 3 };
            const currentLevel = levels[this.config.logLevel] || 1;
            const messageLevel = levels[level] || 1;

            if (messageLevel < currentLevel) return;

            const styles = {
                debug: 'color: #9E9E9E;',
                info: 'color: #2196F3; font-weight: bold;',
                warn: 'color: #FF9800; font-weight: bold;',
                error: 'color: #F44336; font-weight: bold;'
            };

            console.log(`%c[Research] ${message}`, styles[level], data || '');
        }

        generateId() {
            return `req_${++this.requestIdCounter}_${Date.now().toString(36)}`;
        }

        getElementInfo(element) {
            if (!element || !element.tagName) return 'Unknown';

            const tag = element.tagName.toLowerCase();
            const id = element.id ? `#${element.id}` : '';
            const classes = element.className ?
                `.${element.className.toString().split(' ').filter(c => c).slice(0, 2).join('.')}` : '';

            return `${tag}${id}${classes}`;
        }

        getEventDetails(event) {
            const details = { type: event.type };

            if (event.type === 'click' || event.type === 'mousedown') {
                details.coordinates = { x: event.clientX, y: event.clientY };
                details.button = event.button;
            }

            if (event.type.startsWith('key')) {
                details.key = event.key;
                details.code = event.code;
                details.ctrlKey = event.ctrlKey;
                details.shiftKey = event.shiftKey;
            }

            if (event.target && event.target.value !== undefined) {
                const value = String(event.target.value);
                details.value = this.containsSensitiveData(value) ?
                    '[REDACTED]' : this.truncate(value, 100);
            }

            return details;
        }

        truncate(str, maxLength) {
            if (typeof str !== 'string') return String(str);
            return str.length > maxLength ? str.substring(0, maxLength) + '...' : str;
        }

        // ========== PUBLIC API ==========

        getSummary() {
            const now = Date.now();
            const uptime = now - this.startTime;

            return {
                status: this.isActive ? 'active' : 'stopped',
                uptime: `${Math.floor(uptime / 1000)}s`,
                stats: {
                    ...this.stats,
                    requestsInMemory: this.networkRequests.length,
                    eventsInMemory: Array.from(this.events.values()).reduce((sum, arr) => sum + arr.length, 0)
                },
                collections: {
                    endpoints: this.endpoints.size,
                    jsonResponses: this.jsonData.size,
                    websockets: this.websockets.size,
                    eventTypes: this.events.size,
                    errors: this.errors.length,
                    performanceEntries: this.performanceData.size,
                    localStorageItems: this.localStorage.size,
                    sessionStorageItems: this.sessionStorage.size,
                    cookies: this.cookies.size,
                    globalObjects: this.globalObjects.size
                },
                config: {
                    maxRequests: this.config.maxRequests,
                    maxEvents: this.config.maxEvents,
                    maxEndpoints: this.config.maxEndpoints,
                    maxJsonResponses: this.config.maxJsonResponses,
                    redactSensitive: this.config.redactSensitive,
                    logLevel: this.config.logLevel,
                    endpointTtl: this.config.endpointTtl
                }
            };
        }

        getEndpoints() {
            return Array.from(this.endpoints.values()).map(ep => ({
                id: ep.id,
                url: ep.url,
                method: ep.method,
                type: ep.type,
                timestamp: ep.timestamp,
                hasJsonResponse: !!ep.jsonData
            }));
        }

        getJsonResponses() {
            return Array.from(this.jsonData.values()).map(data => ({
                requestId: data.request.id,
                url: data.request.url,
                method: data.request.method,
                response: data.response,
                timestamp: data.timestamp
            }));
        }

        getWebSockets() {
            return Array.from(this.websockets.values()).map(ws => ({
                id: ws.id,
                url: ws.url,
                state: ws.state,
                messageCount: ws.messages.length,
                timestamp: ws.timestamp
            }));
        }

        getErrors() {
            return this.errors.slice(-50); // Последние 50 ошибок
        }

        exportData(format = 'json') {
            const data = {
                meta: {
                    exportTime: new Date().toISOString(),
                    url: window.location.href,
                    userAgent: navigator.userAgent,
                    version: '3.0',
                    uptime: Date.now() - this.startTime
                },
                summary: this.getSummary(),
                endpoints: this.getEndpoints(),
                jsonData: this.getJsonResponses(),
                websockets: this.getWebSockets(),
                events: Object.fromEntries(
                    Array.from(this.events.entries()).map(([type, events]) =>
                        [type, events.slice(-20)] // Последние 20 событий каждого типа
                    )
                ),
                errors: this.getErrors(),
                networkRequests: this.networkRequests.slice(-100), // Последние 100
                performanceData: Array.from(this.performanceData.values()),
                localStorage: Object.fromEntries(this.localStorage),
                sessionStorage: Object.fromEntries(this.sessionStorage),
                cookies: Object.fromEntries(this.cookies),
                globalObjects: Object.fromEntries(this.globalObjects)
            };

            if (format === 'json') {
                const jsonStr = JSON.stringify(data, null, 2);
                const blob = new Blob([jsonStr], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                const filename = `research_${window.location.hostname}_${Date.now()}.json`;

                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);

                this.log('info', `✅ Data exported: ${filename}`);
            }

            return data;
        }

        clearData() {
            this.endpoints.clear();
            this.jsonData.clear();
            this.websockets.clear();
            this.events.clear();
            this.errors = [];
            this.performanceData.clear();
            this.localStorage.clear();
            this.sessionStorage.clear();
            this.cookies.clear();
            this.globalObjects.clear();
            this.networkRequests = [];

            // Сброс статистики
            this.stats = {
                totalRequests: 0,
                totalEvents: 0,
                droppedRequests: 0,
                droppedEvents: 0,
                redactedItems: 0
            };

            this.log('info', '🗑️ All research data cleared');
        }

        stop() {
            this.isActive = false;
            this.log('warn', '⏸️ Research collector stopped');
        }

        start() {
            this.isActive = true;
            this.log('info', '▶️ Research collector started');
        }

        cleanup() {
            this.stop();

            // Restore original functions
            if (this.originalFunctions.fetch) {
                window.fetch = this.originalFunctions.fetch;
            }
            if (this.originalFunctions.XMLHttpRequest) {
                window.XMLHttpRequest = this.originalFunctions.XMLHttpRequest;
            }
            if (this.originalFunctions.WebSocket) {
                window.WebSocket = this.originalFunctions.WebSocket;
            }
            if (this.originalFunctions.sendBeacon) {
                navigator.sendBeacon = this.originalFunctions.sendBeacon;
            }
            if (this.originalFunctions.EventSource) {
                window.EventSource = this.originalFunctions.EventSource;
            }

            if (this.mutationObserver) {
                this.mutationObserver.disconnect();
            }

            this.log('info', '🧹 Cleanup completed, original functions restored');
        }

        printHelp() {
            console.log('%c╔══════════════════════════════════════════════════════════╗', 'color: #4CAF50; font-weight: bold;');
            console.log('%c║  🔬 ADVANCED RESEARCH TOOLKIT v3.0                      ║', 'color: #4CAF50; font-weight: bold;');
            console.log('%c╚══════════════════════════════════════════════════════════╝', 'color: #4CAF50; font-weight: bold;');
            console.log('%c\n📚 Available Commands:', 'color: #2196F3; font-weight: bold; font-size: 14px;');
            console.log('%c\n  Data Collection:', 'color: #FF9800; font-weight: bold;');
            console.log('    research.getSummary()         - Статистика сбора данных');
            console.log('    research.getEndpoints()       - Список обнаруженных API');
            console.log('    research.getJsonResponses()   - JSON ответы');
            console.log('    research.getWebSockets()      - WebSocket соединения');
            console.log('    research.getErrors()          - История ошибок');
            console.log('%c\n  Export & Control:', 'color: #FF9800; font-weight: bold;');
            console.log('    research.exportData()         - Экспорт всех данных в JSON');
            console.log('    research.clearData()          - Очистить собранные данные');
            console.log('    research.stop()               - Остановить сбор');
            console.log('    research.start()              - Возобновить сбор');
            console.log('    research.cleanup()            - Полная очистка и восстановление');
            console.log('%c\n⚙️  Current Config:', 'color: #9C27B0; font-weight: bold;');
            console.log(`    Max Requests: ${this.config.maxRequests}`);
            console.log(`    Max Events: ${this.config.maxEvents}`);
            console.log(`    Max Endpoints: ${this.config.maxEndpoints}`);
            console.log(`    Max JSON responses: ${this.config.maxJsonResponses}`);
            console.log(`    Redact Sensitive: ${this.config.redactSensitive}`);
            console.log(`    Log Level: ${this.config.logLevel}`);
            console.log(`    Endpoint TTL: ${this.config.endpointTtl / 60000} min`);
            console.log('%c\n💡 Tip:', 'color: #00BCD4; font-weight: bold;',
                'Используйте research.exportData() перед закрытием страницы\n');
        }
    }

    // ========== INITIALIZATION ==========

    // Инициализация с возможностью кастомной конфигурации
    window.research = new AdvancedResearchCollector(window.RESEARCH_CONFIG || {});

    // Глобальные хелперы для быстрого доступа
    window.getEndpoints = () => window.research.getEndpoints();
    window.getJsonData = () => window.research.getJsonResponses();
    window.getResearchStats = () => window.research.getSummary();
    window.exportResearch = () => window.research.exportData();

    // Автоэкспорт при закрытии (опционально)
    if (window.RESEARCH_CONFIG?.autoExportOnUnload) {
        window.addEventListener('beforeunload', () => {
            try {
                const data = window.research.exportData();
                if (navigator.sendBeacon && window.RESEARCH_CONFIG.beaconUrl) {
                    navigator.sendBeacon(window.RESEARCH_CONFIG.beaconUrl, JSON.stringify(data));
                }
            } catch (e) {
                console.error('Auto-export failed', e);
            }
        });
    }
})();