(function() {
    'use strict';

    console.log('🛡️ Starting Instagram Memory-Safe Security Analysis...');

    // Конфигурация с лимитами для Instagram
    const CONFIG = {
        maxBodySize: 10000,
        maxGraphQLSize: 50000, // 50KB для GraphQL
        maxMediaSize: 100000, // 100KB для медиа данных
        maxRequests: 1000,
        maxBatches: 100,
        maxWebSockets: 50,
        maxDomEvents: 500,
        maxPerfEntries: 200,
        maxAuthFlows: 500,
        maxMediaRequests: 300,
        maxStories: 200,
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
            instagramConstants: {},
            userId: null,
            sessionId: null,
            csrfToken: null,
            userAgent: null
        },
        network: {
            requests: [],
            websockets: [],
            endpoints: new Map(),
            graphqlQueries: new Map(),
            mediaRequests: new Map(),
            storyRequests: new Map(),
            feedRequests: new Map(),
            directRequests: new Map()
        },
        security: {
            headers: {},
            instagramAuth: {},
            authFlows: [],
            csrfTokens: {},
            igClaims: {}
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
            currentXHRs: new Set(),
            mediaElements: new Set(),
            storyElements: new Set()
        },

        // Методы безопасного добавления с проверкой лимитов
        addRequest: function(requestData) {
            this.network.requests.push(requestData);
            if (this.network.requests.length > CONFIG.maxRequests) {
                this.network.requests.shift();
            }
        },

        addGraphQLQuery: function(id, graphqlData) {
            this.network.graphqlQueries.set(id, graphqlData);
            if (this.network.graphqlQueries.size > CONFIG.maxBatches) {
                const firstKey = this.network.graphqlQueries.keys().next().value;
                this.network.graphqlQueries.delete(firstKey);
            }
        },

        addMediaRequest: function(id, mediaData) {
            this.network.mediaRequests.set(id, mediaData);
            if (this.network.mediaRequests.size > CONFIG.maxMediaRequests) {
                const firstKey = this.network.mediaRequests.keys().next().value;
                this.network.mediaRequests.delete(firstKey);
            }
        },

        addStoryRequest: function(id, storyData) {
            this.network.storyRequests.set(id, storyData);
            if (this.network.storyRequests.size > CONFIG.maxStories) {
                const firstKey = this.network.storyRequests.keys().next().value;
                this.network.storyRequests.delete(firstKey);
            }
        },

        addFeedRequest: function(id, feedData) {
            this.network.feedRequests.set(id, feedData);
            if (this.network.feedRequests.size > CONFIG.maxBatches) {
                const firstKey = this.network.feedRequests.keys().next().value;
                this.network.feedRequests.delete(firstKey);
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
            this.network.mediaRequests.clear();
            this.network.storyRequests.clear();
            this.network.feedRequests.clear();
            this.network.directRequests.clear();
            this.network.endpoints.clear();
            this.dom.events = [];
            this.dom.currentXHRs.clear();
            this.dom.mediaElements.clear();
            this.dom.storyElements.clear();
            this.security.authFlows = [];
            this.timing.performanceEntries = [];
            this.timing.events = [];
            this.timing.startTime = Date.now();
        }
    };

    // 1. Перехват Fetch с обработкой Instagram GraphQL API
    function setupMemorySafeFetchInterception() {
        console.group('🌐 INSTAGRAM MEMORY-SAFE FETCH INTERCEPTION');

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
                isMediaAPI: false,
                isStoryAPI: false,
                isFeedAPI: false,
                isDirectAPI: false,
                isAuthentication: false
            };

            // Определяем тип запроса Instagram
            if (typeof url === 'string') {
                requestData.isGraphQL = url.includes('/graphql/query') || url.includes('graphql');
                requestData.isMediaAPI = url.includes('/media/') || url.includes('/create/') || 
                                       url.includes('/configure/') || url.includes('/upload/');
                requestData.isStoryAPI = url.includes('/stories/') || url.includes('/story') || 
                                       url.includes('/reel');
                requestData.isFeedAPI = url.includes('/feed/') || url.includes('/timeline') || 
                                      url.includes('/news');
                requestData.isDirectAPI = url.includes('/direct_v2/') || url.includes('/direct/');
                requestData.isAuthentication = url.includes('/accounts/login') || 
                                             url.includes('/accounts/emailsignup') ||
                                             url.includes('/api/v1/web/fxcal/');
            }

            // Безопасная обработка тела запроса
            if (args[1]?.body) {
                try {
                    if (typeof args[1].body === 'string') {
                        requestData.requestBody = args[1].body.substring(0, CONFIG.maxBodySize);
                        requestData.size = args[1].body.length;
                    } else if (args[1].body instanceof FormData) {
                        const formString = Array.from(args[1].body.entries())
                            .map(([k, v]) => `${k}=${typeof v === 'string' ? v : '[File]'}`).join('&');
                        requestData.requestBody = 'FormData: ' + formString.substring(0, CONFIG.maxBodySize);
                        requestData.size = formString.length;
                    } else if (args[1].body instanceof URLSearchParams) {
                        requestData.requestBody = 'URLSearchParams: ' + args[1].body.toString()
                            .substring(0, CONFIG.maxBodySize);
                        requestData.size = args[1].body.toString().length;
                    } else if (args[1].body instanceof Blob) {
                        // Для медиа файлов сохраняем только метаданные
                        if (args[1].body.type.includes('image') || args[1].body.type.includes('video')) {
                            requestData.requestBody = `[Media File: ${args[1].body.size} bytes, type: ${args[1].body.type}]`;
                        } else {
                            requestData.requestBody = `[Blob: ${args[1].body.size} bytes, type: ${args[1].body.type}]`;
                        }
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

            // Обработка GraphQL запросов Instagram
            if (requestData.isGraphQL && args[1]?.body) {
                try {
                    const bodyText = await cloneAndReadBody(args[1].body);
                    if (bodyText.length > CONFIG.maxGraphQLSize) {
                        requestData.requestBody = `[GraphQL TOO_LARGE: ${bodyText.length} bytes]`;
                        requestData.requestBodyBase64 = 'TOO_LARGE';
                    } else {
                        requestData.requestBodyBase64 = btoa(unescape(encodeURIComponent(bodyText)));
                        requestData.requestBody = `GraphQL (base64): ${requestData.requestBodyBase64.substring(0, 200)}...`;
                        
                        // Парсим GraphQL для извлечения информации
                        const graphqlInfo = parseInstagramGraphQL(bodyText);
                        requestData.graphqlOperation = graphqlInfo.operation;
                        requestData.graphqlVariables = graphqlInfo.variables;
                    }
                    requestData.size = bodyText.length;

                    // Сохраняем GraphQL запрос
                    securityAnalysis.addGraphQLQuery(requestId, {
                        url: url,
                        requestBodyBase64: requestData.requestBodyBase64,
                        operation: requestData.graphqlOperation,
                        variables: requestData.graphqlVariables,
                        timestamp: requestData.timestamp,
                        size: bodyText.length,
                        type: 'fetch'
                    });
                } catch (e) {
                    requestData.requestBody = '[Failed to read GraphQL body]';
                }
            }

            // Обработка медиа запросов
            if (requestData.isMediaAPI) {
                securityAnalysis.addMediaRequest(requestId, {
                    url: url,
                    timestamp: requestData.timestamp,
                    method: requestData.method,
                    type: requestData.isStoryAPI ? 'story' : 'post',
                    size: requestData.size
                });
            }

            // Обработка сторис
            if (requestData.isStoryAPI) {
                securityAnalysis.addStoryRequest(requestId, {
                    url: url,
                    timestamp: requestData.timestamp,
                    method: requestData.method,
                    size: requestData.size
                });
            }

            // Обработка ленты
            if (requestData.isFeedAPI) {
                securityAnalysis.addFeedRequest(requestId, {
                    url: url,
                    timestamp: requestData.timestamp,
                    method: requestData.method,
                    size: requestData.size
                });
            }

            // Анализ Instagram-специфичных заголовков
            analyzeInstagramHeaders(args[1]?.headers, requestData, 'request');

            // Безопасное добавление запроса
            securityAnalysis.addRequest(requestData);

            console.log(`📡 Instagram Fetch: ${requestData.method} ${url}`, {
                type: requestData.isGraphQL ? 'GraphQL' : 
                      (requestData.isMediaAPI ? 'Media' : 
                      (requestData.isStoryAPI ? 'Story' : 
                      (requestData.isFeedAPI ? 'Feed' : 
                      (requestData.isDirectAPI ? 'Direct' : 'Regular')))),
                operation: requestData.graphqlOperation,
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

                        // Обновляем GraphQL запрос данными ответа
                        const graphqlData = securityAnalysis.network.graphqlQueries.get(requestId);
                        if (graphqlData) {
                            graphqlData.responseBodyBase64 = requestData.responseBodyBase64;
                            graphqlData.responseSize = text.length;
                            graphqlData.duration = requestData.duration;
                        }
                    }

                    // Для медиа ответов
                    if (requestData.isMediaAPI || requestData.isStoryAPI) {
                        const mediaData = securityAnalysis.network.mediaRequests.get(requestId) || 
                                        securityAnalysis.network.storyRequests.get(requestId);
                        if (mediaData) {
                            mediaData.responseSize = text.length;
                            mediaData.duration = requestData.duration;
                            mediaData.success = response.status === 200;
                        }
                    }

                    requestData.size += text.length;
                } catch (e) {
                    requestData.responseBody = '[Failed to read response body]';
                }

                analyzeInstagramHeaders(requestData.responseHeaders, requestData, 'response');

                console.log(`📦 Instagram Response: ${response.status} ${url}`, {
                    duration: requestData.duration + 'ms',
                    type: requestData.isGraphQL ? 'GraphQL' : 'API'
                });

                return response;
            } catch (error) {
                requestData.error = error.message;
                requestData.endTime = performance.now();
                requestData.duration = requestData.endTime - startTime;
                throw error;
            }
        };

        // Парсер GraphQL запросов Instagram
        function parseInstagramGraphQL(bodyText) {
            try {
                const parsed = JSON.parse(bodyText);
                return {
                    operation: parsed.operationName || 'unknown',
                    variables: parsed.variables ? Object.keys(parsed.variables) : []
                };
            } catch (e) {
                return { operation: 'parse_error', variables: [] };
            }
        }

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

    // 2. XHR перехват для Instagram
    function setupMemorySafeXHRInterception() {
        console.group('🌐 INSTAGRAM MEMORY-SAFE XHR INTERCEPTION');

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

            // Определяем тип запроса Instagram
            if (typeof url === 'string') {
                data.isGraphQL = url.includes('/graphql/query') || url.includes('graphql');
                data.isMediaAPI = url.includes('/media/') || url.includes('/create/');
                data.isStoryAPI = url.includes('/stories/') || url.includes('/story');
                data.isFeedAPI = url.includes('/feed/') || url.includes('/timeline');
                data.isDirectAPI = url.includes('/direct_v2/');
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

                        // Обработка GraphQL для XHR
                        if (data.isGraphQL && body.length <= CONFIG.maxGraphQLSize) {
                            try {
                                const graphqlInfo = parseInstagramGraphQL(body);
                                data.graphqlOperation = graphqlInfo.operation;
                                data.graphqlVariables = graphqlInfo.variables;

                                data.requestBodyBase64 = btoa(unescape(encodeURIComponent(body)));
                                
                                securityAnalysis.addGraphQLQuery(data.id, {
                                    url: data.url,
                                    requestBodyBase64: data.requestBodyBase64,
                                    operation: data.graphqlOperation,
                                    variables: data.graphqlVariables,
                                    timestamp: data.timestamp,
                                    size: body.length,
                                    type: 'xhr'
                                });
                            } catch (e) {
                                data.graphqlOperation = 'parse_error';
                            }
                        }

                        // Обработка других типов запросов
                        if (data.isMediaAPI) {
                            securityAnalysis.addMediaRequest(data.id, {
                                url: data.url,
                                timestamp: data.timestamp,
                                method: data.method,
                                type: 'post'
                            });
                        }

                        if (data.isStoryAPI) {
                            securityAnalysis.addStoryRequest(data.id, {
                                url: data.url,
                                timestamp: data.timestamp,
                                method: data.method
                            });
                        }
                    } else if (body instanceof Blob) {
                        data.requestBody = `[Blob: ${body.size} bytes]`;
                        data.size = body.size;

                        if (data.isMediaAPI) {
                            securityAnalysis.addMediaRequest(data.id, {
                                url: data.url,
                                timestamp: data.timestamp,
                                method: data.method,
                                type: 'media_upload',
                                size: body.size
                            });
                        }
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

            // Анализ заголовков Instagram
            analyzeInstagramHeaders(data.headers, data, 'request');

            // Безопасное добавление запроса
            securityAnalysis.addRequest(data);

            console.log(`📡 Instagram XHR: ${data.method} ${data.url}`, {
                type: data.isGraphQL ? 'GraphQL' : 
                      (data.isMediaAPI ? 'Media' : 'Regular'),
                operation: data.graphqlOperation
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

                        // Обновляем соответствующие коллекции
                        if (data.isGraphQL) {
                            const graphqlData = securityAnalysis.network.graphqlQueries.get(data.id);
                            if (graphqlData) {
                                graphqlData.responseSize = this.responseText.length;
                                graphqlData.duration = data.duration;
                            }
                        }

                        if (data.isMediaAPI || data.isStoryAPI) {
                            const mediaData = securityAnalysis.network.mediaRequests.get(data.id) || 
                                            securityAnalysis.network.storyRequests.get(data.id);
                            if (mediaData) {
                                mediaData.responseSize = this.responseText.length;
                                mediaData.duration = data.duration;
                                mediaData.success = this.status === 200;
                            }
                        }

                        data.size += this.responseText.length;
                    }
                } catch (e) {
                    data.responseBody = '[Failed to read response]';
                }

                analyzeInstagramHeaders(this.getAllResponseHeaders(), data, 'response');

                console.log(`📦 Instagram XHR Response: ${this.status} ${data.url}`, {
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

    // 3. Анализ Instagram-специфичных заголовков
    function analyzeInstagramHeaders(headers, requestData, type) {
        const instagramSecurityHeaders = ['x-ig-app-id', 'x-ig-www-claim', 'x-ig-device-id', 'x-mid'];
        const instagramAuthHeaders = ['x-csrftoken', 'authorization', 'x-instagram-ajax', 'x-requested-with'];
        const instagramTrackingHeaders = ['x-fb-trace-id', 'x-fb-request-id', 'x-trace-id'];

        if (type === 'request') {
            requestData.instagramSecurityHeaders = {};
            requestData.instagramAuthHeaders = {};
            requestData.instagramTrackingHeaders = {};

            Object.entries(headers || {}).forEach(([key, value]) => {
                const lowerKey = key.toLowerCase();

                if (instagramSecurityHeaders.some(h => lowerKey.includes(h))) {
                    requestData.instagramSecurityHeaders[key] = String(value).substring(0, 200);
                    
                    // Сохраняем важные security headers
                    if (key === 'x-ig-app-id') {
                        securityAnalysis.session.instagramConstants.appId = value;
                    }
                    if (key === 'x-ig-www-claim') {
                        securityAnalysis.security.igClaims.wwwClaim = value.substring(0, 100);
                    }
                }

                if (instagramAuthHeaders.some(h => lowerKey.includes(h))) {
                    requestData.instagramAuthHeaders[key] = String(value).substring(0, 200);

                    // Сохраняем CSRF token
                    if (key === 'x-csrftoken') {
                        securityAnalysis.session.csrfToken = value;
                        securityAnalysis.security.csrfTokens[requestData.timestamp] = value;
                    }

                    securityAnalysis.addAuthFlow({
                        type: `instagram_${type}_header`,
                        header: key,
                        value: String(value).substring(0, 100),
                        timestamp: requestData.timestamp,
                        requestId: requestData.id
                    });
                }

                if (instagramTrackingHeaders.some(h => lowerKey.includes(h))) {
                    requestData.instagramTrackingHeaders[key] = String(value).substring(0, 200);
                }
            });

            // Анализ cookies для сессионных данных
            if (headers?.cookie) {
                const cookieData = analyzeInstagramCookies(headers.cookie);
                if (cookieData.sessionid) {
                    securityAnalysis.session.sessionId = cookieData.sessionid;
                }
                if (cookieData.ds_user_id) {
                    securityAnalysis.session.userId = cookieData.ds_user_id;
                }
                if (cookieData.csrftoken) {
                    securityAnalysis.session.csrfToken = cookieData.csrftoken;
                }
            }
        }
    }

    // 4. Анализ Instagram cookies
    function analyzeInstagramCookies(cookieHeader) {
        const cookies = {};
        const sessionMatch = cookieHeader.match(/sessionid=([^;]+)/);
        const userIdMatch = cookieHeader.match(/ds_user_id=([^;]+)/);
        const csrfMatch = cookieHeader.match(/csrftoken=([^;]+)/);
        const midMatch = cookieHeader.match(/mid=([^;]+)/);

        if (sessionMatch) cookies.sessionid = sessionMatch[1];
        if (userIdMatch) cookies.ds_user_id = userIdMatch[1];
        if (csrfMatch) cookies.csrftoken = csrfMatch[1];
        if (midMatch) cookies.mid = midMatch[1];

        return cookies;
    }

    // 5. Мониторинг медиа элементов Instagram
    function setupMediaElementMonitoring() {
        console.group('📸 INSTAGRAM MEDIA ELEMENT MONITORING');

        // Наблюдатель за медиа элементами
        const mediaObserver = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === 1) { // Element node
                        // Поиск постов
                        const postSelectors = [
                            'article',
                            '[role="main"] div[style]',
                            '._aagw', // Instagram image container
                            '._aak1' // Instagram video container
                        ];

                        postSelectors.forEach(selector => {
                            const elements = node.querySelectorAll ? node.querySelectorAll(selector) : [];
                            elements.forEach(element => {
                                const mediaId = generateMediaId();
                                if (!securityAnalysis.dom.mediaElements.has(mediaId)) {
                                    securityAnalysis.dom.mediaElements.add(mediaId);
                                    
                                    const mediaData = {
                                        id: mediaId,
                                        element: element,
                                        type: element.querySelector('video') ? 'video' : 'image',
                                        timestamp: new Date().toISOString(),
                                        interactions: []
                                    };

                                    // Мониторинг взаимодействий
                                    ['click', 'dblclick', 'mouseenter'].forEach(eventType => {
                                        element.addEventListener(eventType, (e) => {
                                            mediaData.interactions.push({
                                                type: eventType,
                                                timestamp: new Date().toISOString()
                                            });

                                            if (mediaData.interactions.length > 20) {
                                                mediaData.interactions.shift();
                                            }
                                        });
                                    });

                                    console.log(`📸 Instagram Media Element: ${mediaData.type}`);
                                }
                            });
                        });

                        // Мониторинг сторис
                        const storySelectors = [
                            '._acaz', // Story ring
                            '[data-testid="story-ring"]',
                            'circle[cx="54"][cy="54"]' // Story circle
                        ];

                        storySelectors.forEach(selector => {
                            const elements = node.querySelectorAll ? node.querySelectorAll(selector) : [];
                            elements.forEach(element => {
                                const storyId = `story_${Date.now()}`;
                                if (!securityAnalysis.dom.storyElements.has(storyId)) {
                                    securityAnalysis.dom.storyElements.add(storyId);
                                    
                                    element.addEventListener('click', (e) => {
                                        console.log(`📖 Instagram Story Clicked`);
                                    });
                                }
                            });
                        });

                        // Мониторинг лайков и комментариев
                        const likeButtons = node.querySelectorAll ? 
                            node.querySelectorAll('[aria-label="Like"], svg[aria-label="Like"]') : [];
                        likeButtons.forEach(button => {
                            button.addEventListener('click', (e) => {
                                securityAnalysis.addDOMEvent({
                                    type: 'like',
                                    timestamp: new Date().toISOString(),
                                    target: 'post',
                                    coordinates: { x: e.clientX, y: e.clientY }
                                });
                            });
                        });
                    }
                });
            });
        });

        mediaObserver.observe(document.body, {
            childList: true,
            subtree: true
        });

        function generateMediaId() {
            return `media_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        }

        console.groupEnd();
        return () => mediaObserver.disconnect();
    }

    // 6. Performance Observer для Instagram
    function setupSafePerformanceObserver() {
        console.group('⏱️ INSTAGRAM PERFORMANCE OBSERVER');

        try {
            const perfObserver = new PerformanceObserver((list) => {
                list.getEntries().forEach(entry => {
                    // Особый интерес представляют медиа ресурсы
                    if (entry.name.includes('.mp4') || entry.name.includes('.jpg') || 
                        entry.name.includes('instagram.com') || entry.initiatorType === 'xmlhttprequest') {
                        const safeEntry = {
                            name: entry.name,
                            entryType: entry.entryType,
                            startTime: entry.startTime,
                            duration: entry.duration,
                            initiatorType: entry.initiatorType,
                            size: entry.encodedBodySize || entry.decodedBodySize || 0
                        };
                        securityAnalysis.addPerfEntry(safeEntry);
                    }
                });
            });

            perfObserver.observe({ entryTypes: ['resource', 'navigation', 'measure'] });
            console.log('✅ Instagram Performance Observer started');
            return perfObserver;
        } catch (e) {
            console.log('❌ Instagram Performance Observer failed:', e);
            return null;
        }

        console.groupEnd();
    }

    // 7. Система управления жизненным циклом
    function setupLifecycleManagement() {
        console.group('🔧 INSTAGRAM LIFECYCLE MANAGEMENT');

        let cleanupCallbacks = [];
        let intervals = [];

        window.stopInstagramAnalysis = function() {
            console.log('🛑 Stopping Instagram Security Analysis...');

            intervals.forEach(clearInterval);
            intervals = [];

            cleanupCallbacks.forEach(callback => {
                try {
                    callback();
                } catch (e) {
                    console.log('Instagram cleanup error:', e);
                }
            });
            cleanupCallbacks = [];

            securityAnalysis.clearAll();

            console.log('✅ Instagram Security Analysis stopped completely');
        };

        const autoStopTimeout = setTimeout(() => {
            console.warn(`⏰ Auto-stopping Instagram analysis after ${CONFIG.autoStopMinutes} minutes`);
            window.stopInstagramAnalysis();
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

    // 8. Инициализация Instagram мониторинга
    function startInstagramAnalysis() {
        console.log('🚀 STARTING INSTAGRAM MEMORY-SAFE SECURITY ANALYSIS...');

        const lifecycle = setupLifecycleManagement();

        setupMemorySafeFetchInterception();

        const xhrCleanup = setupMemorySafeXHRInterception();
        if (xhrCleanup) lifecycle.registerCleanup(xhrCleanup);

        const perfObserver = setupSafePerformanceObserver();
        if (perfObserver) lifecycle.registerCleanup(() => perfObserver.disconnect());

        const mediaCleanup = setupMediaElementMonitoring();
        if (mediaCleanup) lifecycle.registerCleanup(mediaCleanup);

        // Периодический сбор статистики
        const statsInterval = setInterval(() => {
            const stats = {
                requests: securityAnalysis.network.requests.length,
                graphqlQueries: securityAnalysis.network.graphqlQueries.size,
                mediaRequests: securityAnalysis.network.mediaRequests.size,
                storyRequests: securityAnalysis.network.storyRequests.size,
                feedRequests: securityAnalysis.network.feedRequests.size,
                mediaElements: securityAnalysis.dom.mediaElements.size,
                storyElements: securityAnalysis.dom.storyElements.size,
                websockets: securityAnalysis.network.websockets.length,
                domEvents: securityAnalysis.dom.events.length,
                authFlows: securityAnalysis.security.authFlows.length,
                perfEntries: securityAnalysis.timing.performanceEntries.length,
                memory: Math.round(performance.memory?.usedJSHeapSize / 1048576) || 'N/A'
            };

            console.log('📈 Instagram Memory-Safe Stats:', stats);

            if (performance.memory && performance.memory.usedJSHeapSize > 500 * 1048576) {
                console.warn('🚨 High memory usage detected, clearing old data');
                securityAnalysis.clearAll();
            }
        }, 15000);

        lifecycle.registerInterval(statsInterval);

        setupInstagramCommands();

        console.log('✅ INSTAGRAM MEMORY-SAFE SECURITY ANALYSIS ACTIVE!');
        console.log('💡 Available commands:');
        console.log('💡 stopInstagramAnalysis() - Complete shutdown');
        console.log('💡 getInstagramMemoryStats() - Current memory usage');
        console.log('💡 getGraphQLQueries() - View GraphQL operations');
        console.log('💡 getMediaActivity() - View media interactions');
        console.log('💡 getSessionInfo() - View session data');
    }

    // Команды для Instagram анализа
    function setupInstagramCommands() {
        window.getInstagramMemoryStats = function() {
            const stats = {
                requests: securityAnalysis.network.requests.length,
                graphqlQueries: securityAnalysis.network.graphqlQueries.size,
                mediaRequests: securityAnalysis.network.mediaRequests.size,
                storyRequests: securityAnalysis.network.storyRequests.size,
                feedRequests: securityAnalysis.network.feedRequests.size,
                mediaElements: securityAnalysis.dom.mediaElements.size,
                storyElements: securityAnalysis.dom.storyElements.size,
                websockets: securityAnalysis.network.websockets.length,
                domEvents: securityAnalysis.dom.events.length,
                authFlows: securityAnalysis.security.authFlows.length,
                perfEntries: securityAnalysis.timing.performanceEntries.length,
                session: {
                    userId: securityAnalysis.session.userId,
                    sessionId: securityAnalysis.session.sessionId,
                    csrfToken: securityAnalysis.session.csrfToken
                }
            };

            if (performance.memory) {
                stats.memoryMB = Math.round(performance.memory.usedJSHeapSize / 1048576);
                stats.memoryLimitMB = Math.round(performance.memory.jsHeapSizeLimit / 1048576);
            }

            console.log('💾 Instagram Memory Statistics:', stats);
            return stats;
        };

        window.clearInstagramData = function() {
            securityAnalysis.clearAll();
            console.log('🧹 Instagram data cleared');
        };

        window.getGraphQLQueries = function() {
            const queries = Array.from(securityAnalysis.network.graphqlQueries.entries());
            console.log('🕸️ GraphQL Queries:', queries);
            return queries;
        };

        window.getMediaActivity = function() {
            const mediaData = {
                mediaRequests: Array.from(securityAnalysis.network.mediaRequests.entries()),
                storyRequests: Array.from(securityAnalysis.network.storyRequests.entries()),
                mediaElements: Array.from(securityAnalysis.dom.mediaElements),
                interactions: securityAnalysis.dom.events.filter(e => e.type === 'like')
            };
            console.log('📸 Media Activity:', mediaData);
            return mediaData;
        };

        window.getSessionInfo = function() {
            console.log('👤 Instagram Session:', securityAnalysis.session);
            return securityAnalysis.session;
        };

        window.getAuthFlows = function() {
            console.log('🔐 Authentication Flows:', securityAnalysis.security.authFlows);
            return securityAnalysis.security.authFlows;
        };
    }

    // Запуск анализа Instagram
    startInstagramAnalysis();

})();