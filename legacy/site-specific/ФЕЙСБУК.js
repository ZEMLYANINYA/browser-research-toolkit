(function() {
    'use strict';

    console.log('🛡️ Starting Facebook Memory-Safe Security Analysis...');

    // Конфигурация с лимитами для Facebook
    const CONFIG = {
        maxBodySize: 10000,
        maxGraphQLSize: 50000, // 50KB лимит для GraphQL
        maxRequests: 1000,
        maxBatches: 100,
        maxWebSockets: 50,
        maxDomEvents: 500,
        maxPerfEntries: 200,
        maxAuthFlows: 500,
        autoStopMinutes: 30
    };

    // Хранилище с методами безопасного добавления
    const securityAnalysis = {
        config: CONFIG,
        session: {
            cookies: {},
            localStorage: {},
            sessionStorage: {},
            tokens: [],
            fbConstants: {},
            userID: null
        },
        network: {
            requests: [],
            websockets: [],
            endpoints: new Map(),
            graphqlQueries: new Map(),
            apiCalls: new Map()
        },
        security: {
            headers: {},
            fbAuth: {},
            authFlows: [],
            trackingParams: {}
        },
        timing: {
            startTime: Date.now(),
            events: [],
            performanceEntries: [],
            domTriggers: []
        },
        dom: {
            events: [],
            lastInteraction: null,
            currentXHRs: new Set()
        },

        // Методы безопасного добавления с проверкой лимитов
        addRequest: function(requestData) {
            this.network.requests.push(requestData);
            if (this.network.requests.length > CONFIG.maxRequests) {
                this.network.requests.shift();
            }
        },

        addGraphQLQuery: function(id, queryData) {
            this.network.graphqlQueries.set(id, queryData);
            if (this.network.graphqlQueries.size > CONFIG.maxBatches) {
                const firstKey = this.network.graphqlQueries.keys().next().value;
                this.network.graphqlQueries.delete(firstKey);
            }
        },

        addWebSocket: function(wsData) {
            this.network.websockets.push(wsData);
            if (this.network.websockets.length > CONFIG.maxWebSockets) {
                this.network.websockets.shift();
            }
        },

        addDOMEvent: function(eventData) {
            this.dom.events.push(eventData);
            if (this.dom.events.length > CONFIG.maxDomEvents) {
                this.dom.events.shift();
            }
        },

        addAuthFlow: function(authData) {
            this.security.authFlows.push(authData);
            if (this.security.authFlows.length > CONFIG.maxAuthFlows) {
                this.security.authFlows.shift();
            }
        },

        addPerfEntry: function(entry) {
            this.timing.performanceEntries.push(entry);
            if (this.timing.performanceEntries.length > CONFIG.maxPerfEntries) {
                this.timing.performanceEntries.shift();
            }
        },

        // Полная очистка всех данных
        clearAll: function() {
            this.network.requests = [];
            this.network.websockets = [];
            this.network.graphqlQueries.clear();
            this.network.apiCalls.clear();
            this.network.endpoints.clear();
            this.dom.events = [];
            this.dom.currentXHRs.clear();
            this.security.authFlows = [];
            this.timing.performanceEntries = [];
            this.timing.events = [];
            this.timing.startTime = Date.now();
        }
    };

    // 1. Перехват Fetch с обработкой Facebook GraphQL
    function setupMemorySafeFetchInterception() {
        console.group('🌐 FACEBOOK MEMORY-SAFE FETCH INTERCEPTION');

        const originalFetch = window.fetch;
        window.fetch = async function(...args) {
            const url = args[0];
            const requestId = `fetch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const startTime = performance.now();

            const requestData = {
                id: requestId,
                type: 'fetch',
                url: url,
                method: args[1]?.method || 'GET',
                headers: { ...args[1]?.headers },
                timestamp: new Date().toISOString(),
                startTime: startTime,
                requestBody: null,
                responseBody: null,
                status: null,
                statusText: null,
                domTrigger: securityAnalysis.dom.lastInteraction,
                size: 0,
                isGraphQL: false,
                isFacebookAPI: false
            };

            // Определяем тип запроса Facebook
            if (typeof url === 'string') {
                requestData.isGraphQL = url.includes('/graphql') || url.includes('graphql');
                requestData.isFacebookAPI = url.includes('/api/') || url.includes('facebook.com/api');
                requestData.isFBPlatform = url.includes('fbcdn.net') || url.includes('facebook.com/platform');
            }

            // Безопасная обработка тела запроса
            if (args[1]?.body) {
                try {
                    if (typeof args[1].body === 'string') {
                        requestData.requestBody = args[1].body.substring(0, CONFIG.maxBodySize);
                        requestData.size = args[1].body.length;
                    } else if (args[1].body instanceof FormData) {
                        const formString = Array.from(args[1].body.entries())
                            .map(([k, v]) => `${k}=${v}`).join('&');
                        requestData.requestBody = 'FormData: ' + formString.substring(0, CONFIG.maxBodySize);
                        requestData.size = formString.length;
                    } else if (args[1].body instanceof URLSearchParams) {
                        requestData.requestBody = 'URLSearchParams: ' + args[1].body.toString()
                            .substring(0, CONFIG.maxBodySize);
                        requestData.size = args[1].body.toString().length;
                    } else if (args[1].body instanceof Blob) {
                        requestData.requestBody = `[Blob: ${args[1].body.size} bytes, type: ${args[1].body.type}]`;
                        requestData.size = args[1].body.size;
                    } else {
                        const bodyString = String(args[1].body);
                        requestData.requestBody = bodyString.substring(0, CONFIG.maxBodySize);
                        requestData.size = bodyString.length;
                    }
                } catch (e) {
                    requestData.requestBody = '[Unreadable body]';
                }
            }

            // Обработка GraphQL запросов
            if (requestData.isGraphQL && args[1]?.body) {
                try {
                    const bodyText = await cloneAndReadBody(args[1].body);
                    if (bodyText.length > CONFIG.maxGraphQLSize) {
                        requestData.requestBody = `[GraphQL TOO_LARGE: ${bodyText.length} bytes]`;
                        requestData.requestBodyBase64 = 'TOO_LARGE';
                    } else {
                        requestData.requestBodyBase64 = btoa(unescape(encodeURIComponent(bodyText)));
                        requestData.requestBody = `GraphQL (base64): ${requestData.requestBodyBase64.substring(0, 200)}...`;
                    }
                    requestData.size = bodyText.length;

                    // Сохраняем GraphQL запрос
                    securityAnalysis.addGraphQLQuery(requestId, {
                        url: url,
                        requestBodyBase64: requestData.requestBodyBase64,
                        timestamp: requestData.timestamp,
                        size: bodyText.length,
                        type: 'fetch'
                    });
                } catch (e) {
                    requestData.requestBody = '[Failed to read GraphQL body]';
                }
            }

            // Анализ Facebook-специфичных заголовков
            analyzeFBHeaders(args[1]?.headers, requestData, 'request');

            // Безопасное добавление запроса
            securityAnalysis.addRequest(requestData);

            console.log(`📡 Facebook Fetch: ${requestData.method} ${url}`, {
                type: requestData.isGraphQL ? 'GraphQL' : (requestData.isFacebookAPI ? 'API' : 'Regular'),
                size: requestData.size
            });

            try {
                const response = await originalFetch.apply(this, args);
                const endTime = performance.now();

                requestData.endTime = endTime;
                requestData.duration = endTime - startTime;
                requestData.status = response.status;
                requestData.statusText = response.statusText;
                requestData.responseHeaders = {};

                // Сохраняем заголовки ответа
                response.headers.forEach((value, key) => {
                    requestData.responseHeaders[key] = value;
                });

                // Безопасное чтение тела ответа
                try {
                    const clone = response.clone();
                    const text = await clone.text();

                    if (text.length > CONFIG.maxBodySize) {
                        requestData.responseBody = `[Response TOO_LARGE: ${text.length} bytes]`;
                    } else {
                        requestData.responseBody = text;
                    }

                    // Для GraphQL ответов
                    if (requestData.isGraphQL) {
                        if (text.length > CONFIG.maxGraphQLSize) {
                            requestData.responseBodyBase64 = 'TOO_LARGE';
                        } else {
                            requestData.responseBodyBase64 = btoa(unescape(encodeURIComponent(text)));
                        }
                    }

                    requestData.size += text.length;
                } catch (e) {
                    requestData.responseBody = '[Failed to read response body]';
                }

                analyzeFBHeaders(requestData.responseHeaders, requestData, 'response');

                console.log(`📦 Facebook Response: ${response.status} ${url}`, {
                    duration: requestData.duration + 'ms',
                    type: requestData.isGraphQL ? 'GraphQL' : 'Regular'
                });

                return response;
            } catch (error) {
                requestData.error = error.message;
                requestData.endTime = performance.now();
                requestData.duration = requestData.endTime - startTime;
                throw error;
            }
        };

        // Вспомогательная функция для безопасного чтения тела
        async function cloneAndReadBody(body) {
            if (typeof body === 'string') return body;
            if (body instanceof Blob) {
                return new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result);
                    reader.readAsText(body);
                });
            }
            try {
                return String(body);
            } catch (e) {
                return '[Unreadable body type]';
            }
        }

        console.groupEnd();
    }

    // 2. XHR перехват для Facebook
    function setupMemorySafeXHRInterception() {
        console.group('🌐 FACEBOOK MEMORY-SAFE XHR INTERCEPTION');

        const originalOpen = XMLHttpRequest.prototype.open;
        const originalSend = XMLHttpRequest.prototype.send;
        const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;

        const xhrData = new Map();
        const xhrCleanup = new Set();

        // Периодическая очистка завершенных XHR
        const xhrCleanupInterval = setInterval(() => {
            xhrCleanup.forEach(xhr => {
                if (xhr.readyState === 4) {
                    xhrData.delete(xhr);
                    xhrCleanup.delete(xhr);
                }
            });

            securityAnalysis.dom.currentXHRs.forEach(xhr => {
                if (xhr.readyState === 4) {
                    securityAnalysis.dom.currentXHRs.delete(xhr);
                }
            });
        }, 30000);

        XMLHttpRequest.prototype.setRequestHeader = function(header, value) {
            if (!xhrData.has(this)) {
                xhrData.set(this, { headers: {}, id: `xhr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}` });
            }
            const data = xhrData.get(this);
            data.headers[header] = value;
            return originalSetRequestHeader.call(this, header, value);
        };

        XMLHttpRequest.prototype.open = function(method, url) {
            if (!xhrData.has(this)) {
                xhrData.set(this, {
                    headers: {},
                    id: `xhr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
                });
            }
            const data = xhrData.get(this);
            data.method = method;
            data.url = url;
            data.startTime = performance.now();
            data.timestamp = new Date().toISOString();
            data.domTrigger = securityAnalysis.dom.lastInteraction;

            // Определяем тип запроса Facebook
            if (typeof url === 'string') {
                data.isGraphQL = url.includes('/graphql') || url.includes('graphql');
                data.isFacebookAPI = url.includes('/api/') || url.includes('facebook.com/api');
            }

            securityAnalysis.dom.currentXHRs.add(this);
            xhrCleanup.add(this);

            return originalOpen.apply(this, arguments);
        };

        XMLHttpRequest.prototype.send = function(body) {
            const data = xhrData.get(this) || {};
            data.type = 'xhr';

            // Синхронная обработка тела запроса
            if (body) {
                try {
                    if (typeof body === 'string') {
                        data.requestBody = body.substring(0, CONFIG.maxBodySize);
                        data.size = body.length;
                    } else if (body instanceof Blob) {
                        if (body.size < 10000) {
                            const reader = new FileReader();
                            reader.onloadend = () => {
                                data.requestBody = reader.result.substring(0, CONFIG.maxBodySize);
                            };
                            reader.readAsText(body);
                        } else {
                            data.requestBody = `[Blob: ${body.size} bytes, type: ${body.type}]`;
                        }
                        data.size = body.size;
                    } else if (body instanceof FormData) {
                        data.requestBody = '[FormData]';
                    } else {
                        data.requestBody = String(body).substring(0, CONFIG.maxBodySize);
                        data.size = String(body).length;
                    }
                } catch (e) {
                    data.requestBody = '[Unreadable body]';
                }
            }

            // Обработка GraphQL для XHR
            if (data.isGraphQL && body) {
                try {
                    if (typeof body === 'string' && body.length <= CONFIG.maxGraphQLSize) {
                        data.requestBodyBase64 = btoa(unescape(encodeURIComponent(body)));
                        data.requestBody = `GraphQL (base64): ${data.requestBodyBase64.substring(0, 200)}...`;

                        securityAnalysis.addGraphQLQuery(data.id, {
                            url: data.url,
                            requestBodyBase64: data.requestBodyBase64,
                            timestamp: data.timestamp,
                            size: body.length,
                            type: 'xhr'
                        });
                    } else {
                        data.requestBody = `[GraphQL TOO_LARGE: ${body.size || body.length} bytes]`;
                        data.requestBodyBase64 = 'TOO_LARGE';
                    }
                } catch (e) {
                    data.requestBody = '[Failed to process GraphQL body]';
                }
            }

            // Анализ заголовков Facebook
            analyzeFBHeaders(data.headers, data, 'request');

            // Безопасное добавление запроса
            securityAnalysis.addRequest(data);

            console.log(`📡 Facebook XHR: ${data.method} ${data.url}`, {
                type: data.isGraphQL ? 'GraphQL' : 'Regular',
                size: data.size
            });

            this.addEventListener('load', function() {
                const endTime = performance.now();
                data.endTime = endTime;
                data.duration = endTime - data.startTime;
                data.status = this.status;
                data.statusText = this.statusText;
                data.responseHeaders = this.getAllResponseHeaders();

                // Безопасное чтение ответа
                try {
                    if (this.responseText) {
                        if (this.responseText.length > CONFIG.maxBodySize) {
                            data.responseBody = `[Response TOO_LARGE: ${this.responseText.length} bytes]`;
                        } else {
                            data.responseBody = this.responseText;
                        }

                        if (data.isGraphQL) {
                            if (this.responseText.length > CONFIG.maxGraphQLSize) {
                                data.responseBodyBase64 = 'TOO_LARGE';
                            } else {
                                data.responseBodyBase64 = btoa(unescape(encodeURIComponent(this.responseText)));
                            }
                        }

                        data.size += this.responseText.length;
                    }
                } catch (e) {
                    data.responseBody = '[Failed to read response]';
                }

                analyzeFBHeaders(this.getAllResponseHeaders(), data, 'response');

                console.log(`📦 Facebook XHR Response: ${this.status} ${data.url}`, {
                    duration: data.duration + 'ms'
                });
            });

            this.addEventListener('error', function() {
                data.error = 'XHR Error';
                data.endTime = performance.now();
                data.duration = data.endTime - data.startTime;
            });

            return originalSend.call(this, body);
        };

        console.groupEnd();
        return () => {
            clearInterval(xhrCleanupInterval);
            xhrData.clear();
            xhrCleanup.clear();
        };
    }

    // 3. Анализ Facebook-специфичных заголовков
    function analyzeFBHeaders(headers, requestData, type) {
        const fbSecurityHeaders = ['x-fb-request-id', 'x-fb-trace-id', 'x-fb-rev', 'x-fb-backend', 'x-fb-connection-quality'];
        const fbAuthHeaders = ['authorization', 'cookie', 'x-fb-user', 'x-fb-access-token', 'x-fb-session-id'];
        const fbTrackingHeaders = ['x-fb-ads-insights', 'x-fb-analytics', 'x-fb-debug'];

        if (type === 'request') {
            requestData.fbSecurityHeaders = {};
            requestData.fbAuthHeaders = {};
            requestData.fbTrackingHeaders = {};

            Object.entries(headers || {}).forEach(([key, value]) => {
                const lowerKey = key.toLowerCase();

                if (fbSecurityHeaders.some(h => lowerKey.includes(h))) {
                    requestData.fbSecurityHeaders[key] = String(value).substring(0, 200);
                }

                if (fbAuthHeaders.some(h => lowerKey.includes(h))) {
                    requestData.fbAuthHeaders[key] = String(value).substring(0, 200);

                    securityAnalysis.addAuthFlow({
                        type: `fb_${type}_header`,
                        header: key,
                        value: String(value).substring(0, 100),
                        timestamp: requestData.timestamp,
                        requestId: requestData.id
                    });
                }

                if (fbTrackingHeaders.some(h => lowerKey.includes(h))) {
                    requestData.fbTrackingHeaders[key] = String(value).substring(0, 200);
                }
            });
        }
    }

    // 4. Мониторинг Facebook WebSocket соединений
    function setupSafeWebSocketMonitoring() {
        console.group('🔌 FACEBOOK WEB SOCKET MONITORING');

        const originalWebSocket = window.WebSocket;
        window.WebSocket = function(url, protocols) {
            const ws = new originalWebSocket(url, protocols);
            const wsId = `ws_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

            const wsData = {
                id: wsId,
                url: url,
                protocols: protocols,
                timestamp: new Date().toISOString(),
                messages: [],
                state: 'connecting',
                messageCount: 0,
                totalSize: 0,
                isFBRealtime: url.includes('realtime') || url.includes('websocket')
            };

            securityAnalysis.addWebSocket(wsData);

            const originalSend = ws.send;
            ws.send = function(data) {
                const messageSize = typeof data === 'string' ? data.length : data.byteLength;
                const safeData = typeof data === 'string' ?
                    data.substring(0, 500) : `[Binary: ${messageSize} bytes]`;

                wsData.messages.push({
                    type: 'sent',
                    data: safeData,
                    timestamp: new Date().toISOString(),
                    size: messageSize
                });
                wsData.messageCount++;
                wsData.totalSize += messageSize;

                if (wsData.messages.length > 100) {
                    wsData.messages.shift();
                }

                return originalSend.call(this, data);
            };

            ws.addEventListener('open', function() {
                wsData.state = 'open';
                wsData.openTime = new Date().toISOString();
                console.log(`🔌 Facebook WebSocket Connected: ${url}`);
            });

            ws.addEventListener('message', function(event) {
                const messageSize = typeof event.data === 'string' ? event.data.length : event.data.byteLength;
                const safeData = typeof event.data === 'string' ?
                    event.data.substring(0, 500) : `[Binary: ${messageSize} bytes]`;

                wsData.messages.push({
                    type: 'received',
                    data: safeData,
                    timestamp: new Date().toISOString(),
                    size: messageSize
                });
                wsData.messageCount++;
                wsData.totalSize += messageSize;

                if (wsData.messages.length > 100) {
                    wsData.messages.shift();
                }
            });

            ws.addEventListener('close', function(event) {
                wsData.state = 'closed';
                wsData.closeTime = new Date().toISOString();
                wsData.closeCode = event.code;
                wsData.closeReason = event.reason;
                console.log(`🔌 Facebook WebSocket Closed: ${url} (${event.code})`);
            });

            ws.addEventListener('error', function(error) {
                wsData.state = 'error';
                wsData.error = error;
                console.log(`🔌 Facebook WebSocket Error: ${url}`, error);
            });

            console.log(`🔌 Facebook WebSocket Created: ${url}`);

            return ws;
        };

        console.groupEnd();
        return () => { window.WebSocket = originalWebSocket; };
    }

    // 5. Performance Observer (без изменений)
    function setupSafePerformanceObserver() {
        console.group('⏱️ FACEBOOK PERFORMANCE OBSERVER');

        try {
            const perfObserver = new PerformanceObserver((list) => {
                list.getEntries().forEach(entry => {
                    const safeEntry = {
                        name: entry.name,
                        entryType: entry.entryType,
                        startTime: entry.startTime,
                        duration: entry.duration,
                        initiatorType: entry.initiatorType
                    };
                    securityAnalysis.addPerfEntry(safeEntry);
                });
            });

            perfObserver.observe({ entryTypes: ['resource', 'navigation', 'measure'] });
            console.log('✅ Facebook Performance Observer started');
            return perfObserver;
        } catch (e) {
            console.log('❌ Facebook Performance Observer failed:', e);
            return null;
        }

        console.groupEnd();
    }

    // 6. Система управления жизненным циклом
    function setupLifecycleManagement() {
        console.group('🔧 FACEBOOK LIFECYCLE MANAGEMENT');

        let cleanupCallbacks = [];
        let intervals = [];

        window.stopFacebookAnalysis = function() {
            console.log('🛑 Stopping Facebook Security Analysis...');

            intervals.forEach(clearInterval);
            intervals = [];

            cleanupCallbacks.forEach(callback => {
                try {
                    callback();
                } catch (e) {
                    console.log('Facebook cleanup error:', e);
                }
            });
            cleanupCallbacks = [];

            securityAnalysis.clearAll();

            console.log('✅ Facebook Security Analysis stopped completely');
        };

        const autoStopTimeout = setTimeout(() => {
            console.warn(`⏰ Auto-stopping Facebook analysis after ${CONFIG.autoStopMinutes} minutes`);
            window.stopFacebookAnalysis();
        }, CONFIG.autoStopMinutes * 60 * 1000);

        const registerCleanup = (callback) => {
            cleanupCallbacks.push(callback);
        };

        const registerInterval = (interval) => {
            intervals.push(interval);
        };

        console.groupEnd();
        return { registerCleanup, registerInterval, autoStopTimeout };
    }

    // 7. Инициализация Facebook мониторинга
    function startFacebookAnalysis() {
        console.log('🚀 STARTING FACEBOOK MEMORY-SAFE SECURITY ANALYSIS...');

        const lifecycle = setupLifecycleManagement();

        setupMemorySafeFetchInterception();

        const xhrCleanup = setupMemorySafeXHRInterception();
        if (xhrCleanup) lifecycle.registerCleanup(xhrCleanup);

        const perfObserver = setupSafePerformanceObserver();
        if (perfObserver) lifecycle.registerCleanup(() => perfObserver.disconnect());

        const wsCleanup = setupSafeWebSocketMonitoring();
        if (wsCleanup) lifecycle.registerCleanup(wsCleanup);

        // Периодический сбор статистики
        const statsInterval = setInterval(() => {
            const stats = {
                requests: securityAnalysis.network.requests.length,
                graphqlQueries: securityAnalysis.network.graphqlQueries.size,
                websockets: securityAnalysis.network.websockets.length,
                domEvents: securityAnalysis.dom.events.length,
                authFlows: securityAnalysis.security.authFlows.length,
                perfEntries: securityAnalysis.timing.performanceEntries.length,
                memory: Math.round(performance.memory?.usedJSHeapSize / 1048576) || 'N/A'
            };

            console.log('📈 Facebook Memory-Safe Stats:', stats);

            if (performance.memory && performance.memory.usedJSHeapSize > 500 * 1048576) {
                console.warn('🚨 High memory usage detected, clearing old data');
                securityAnalysis.clearAll();
            }
        }, 15000);

        lifecycle.registerInterval(statsInterval);

        setupFacebookCommands();

        console.log('✅ FACEBOOK MEMORY-SAFE SECURITY ANALYSIS ACTIVE!');
        console.log('💡 Available commands:');
        console.log('💡 stopFacebookAnalysis() - Complete shutdown');
        console.log('💡 getFacebookMemoryStats() - Current memory usage');
        console.log('💡 clearFacebookData() - Clear all collected data');
    }

    // Команды для Facebook анализа
    function setupFacebookCommands() {
        window.getFacebookMemoryStats = function() {
            const stats = {
                requests: securityAnalysis.network.requests.length,
                graphqlQueries: securityAnalysis.network.graphqlQueries.size,
                websockets: securityAnalysis.network.websockets.length,
                domEvents: securityAnalysis.dom.events.length,
                authFlows: securityAnalysis.security.authFlows.length,
                perfEntries: securityAnalysis.timing.performanceEntries.length
            };

            if (performance.memory) {
                stats.memoryMB = Math.round(performance.memory.usedJSHeapSize / 1048576);
                stats.memoryLimitMB = Math.round(performance.memory.jsHeapSizeLimit / 1048576);
            }

            console.log('💾 Facebook Memory Statistics:', stats);
            return stats;
        };

        window.clearFacebookData = function() {
            securityAnalysis.clearAll();
            console.log('🧹 Facebook data cleared');
        };

        window.getGraphQLQueries = function() {
            const queries = Array.from(securityAnalysis.network.graphqlQueries.entries());
            console.log('🕸️ GraphQL Queries:', queries);
            return queries;
        };

        window.getFBAuthFlows = function() {
            console.log('🔐 Facebook Auth Flows:', securityAnalysis.security.authFlows);
            return securityAnalysis.security.authFlows;
        };
    }

    // Запуск анализа Facebook
    startFacebookAnalysis();

})();