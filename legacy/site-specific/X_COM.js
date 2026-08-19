(function() {
    'use strict';

    console.log('🛡️ Starting X (Twitter) Memory-Safe Security Analysis...');

    // Конфигурация с лимитами для X/Twitter
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
        maxTweetRequests: 300,
        maxTimelineRequests: 200,
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
            twitterConstants: {},
            userId: null,
            sessionId: null,
            csrfToken: null,
            guestId: null
        },
        network: {
            requests: [],
            websockets: [],
            endpoints: new Map(),
            graphqlQueries: new Map(),
            tweetRequests: new Map(),
            timelineRequests: new Map(),
            mediaRequests: new Map(),
            userRequests: new Map()
        },
        security: {
            headers: {},
            twitterAuth: {},
            authFlows: [],
            csrfTokens: {},
            bearerTokens: {}
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
            tweetElements: new Set(),
            mediaElements: new Set()
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

        addTweetRequest: function(id, tweetData) {
            this.network.tweetRequests.set(id, tweetData);
            if (this.network.tweetRequests.size > CONFIG.maxTweetRequests) {
                const firstKey = this.network.tweetRequests.keys().next().value;
                this.network.tweetRequests.delete(firstKey);
            }
        },

        addTimelineRequest: function(id, timelineData) {
            this.network.timelineRequests.set(id, timelineData);
            if (this.network.timelineRequests.size > CONFIG.maxTimelineRequests) {
                const firstKey = this.network.timelineRequests.keys().next().value;
                this.network.timelineRequests.delete(firstKey);
            }
        },

        addMediaRequest: function(id, mediaData) {
            this.network.mediaRequests.set(id, mediaData);
            if (this.network.mediaRequests.size > CONFIG.maxBatches) {
                const firstKey = this.network.mediaRequests.keys().next().value;
                this.network.mediaRequests.delete(firstKey);
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
            this.network.tweetRequests.clear();
            this.network.timelineRequests.clear();
            this.network.mediaRequests.clear();
            this.network.userRequests.clear();
            this.network.endpoints.clear();
            this.dom.events = [];
            this.dom.currentXHRs.clear();
            this.dom.tweetElements.clear();
            this.dom.mediaElements.clear();
            this.security.authFlows = [];
            this.timing.performanceEntries = [];
            this.timing.events = [];
            this.timing.startTime = Date.now();
        }
    };

    // 1. Перехват Fetch с обработкой X/Twitter GraphQL API
    function setupMemorySafeFetchInterception() {
        console.group('🌐 X/TWITTER MEMORY-SAFE FETCH INTERCEPTION');

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
                isTweetAPI: false,
                isTimelineAPI: false,
                isMediaAPI: false,
                isUserAPI: false,
                isAuthentication: false
            };

            // Определяем тип запроса X/Twitter
            if (typeof url === 'string') {
                requestData.isGraphQL = url.includes('/graphql/') || url.includes('/gql/');
                requestData.isTweetAPI = url.includes('/Tweet') || url.includes('/CreateTweet') || 
                                       url.includes('/TweetResult') || url.includes('/TweetDetail');
                requestData.isTimelineAPI = url.includes('/HomeTimeline') || url.includes('/UserTweets') ||
                                          url.includes('/SearchTimeline');
                requestData.isMediaAPI = url.includes('/MediaCreate') || url.includes('/upload/') ||
                                       url.includes('.mp4') || url.includes('.jpg');
                requestData.isUserAPI = url.includes('/UserBy') || url.includes('/Users/') ||
                                      url.includes('/profile');
                requestData.isAuthentication = url.includes('/auth/') || url.includes('/login') ||
                                             url.includes('/onboarding');
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

            // Обработка GraphQL запросов X/Twitter
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
                        const graphqlInfo = parseTwitterGraphQL(bodyText);
                        requestData.graphqlOperation = graphqlInfo.operation;
                        requestData.graphqlFeatures = graphqlInfo.features;
                        requestData.graphqlVariables = graphqlInfo.variables;
                    }
                    requestData.size = bodyText.length;

                    // Сохраняем GraphQL запрос
                    securityAnalysis.addGraphQLQuery(requestId, {
                        url: url,
                        requestBodyBase64: requestData.requestBodyBase64,
                        operation: requestData.graphqlOperation,
                        features: requestData.graphqlFeatures,
                        variables: requestData.graphqlVariables,
                        timestamp: requestData.timestamp,
                        size: bodyText.length,
                        type: 'fetch'
                    });
                } catch (e) {
                    requestData.requestBody = '[Failed to read GraphQL body]';
                }
            }

            // Обработка твит-запросов
            if (requestData.isTweetAPI) {
                const tweetInfo = extractTweetInfo(requestData.url, requestData.requestBody);
                securityAnalysis.addTweetRequest(requestId, {
                    url: url,
                    timestamp: requestData.timestamp,
                    method: requestData.method,
                    type: tweetInfo.type,
                    tweetId: tweetInfo.tweetId,
                    size: requestData.size
                });
            }

            // Обработка ленты
            if (requestData.isTimelineAPI) {
                securityAnalysis.addTimelineRequest(requestId, {
                    url: url,
                    timestamp: requestData.timestamp,
                    method: requestData.method,
                    timelineType: extractTimelineType(requestData.url),
                    size: requestData.size
                });
            }

            // Обработка медиа запросов
            if (requestData.isMediaAPI) {
                securityAnalysis.addMediaRequest(requestId, {
                    url: url,
                    timestamp: requestData.timestamp,
                    method: requestData.method,
                    size: requestData.size,
                    mediaType: requestData.requestBody?.includes('image') ? 'image' : 'video'
                });
            }

            // Анализ X/Twitter-специфичных заголовков
            analyzeTwitterHeaders(args[1]?.headers, requestData, 'request');

            // Безопасное добавление запроса
            securityAnalysis.addRequest(requestData);

            console.log(`📡 X/Twitter Fetch: ${requestData.method} ${url}`, {
                type: requestData.isGraphQL ? 'GraphQL' : 
                      (requestData.isTweetAPI ? 'Tweet' : 
                      (requestData.isTimelineAPI ? 'Timeline' : 
                      (requestData.isMediaAPI ? 'Media' : 
                      (requestData.isUserAPI ? 'User' : 'Regular')))),
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

                    // Для твит-ответов
                    if (requestData.isTweetAPI) {
                        const tweetData = securityAnalysis.network.tweetRequests.get(requestId);
                        if (tweetData) {
                            tweetData.responseSize = text.length;
                            tweetData.duration = requestData.duration;
                            tweetData.success = response.status === 200;
                            
                            // Извлекаем ID созданного твита
                            const tweetIdMatch = text.match(/"rest_id":"(\d+)"/);
                            if (tweetIdMatch) {
                                tweetData.createdTweetId = tweetIdMatch[1];
                            }
                        }
                    }

                    requestData.size += text.length;
                } catch (e) {
                    requestData.responseBody = '[Failed to read response body]';
                }

                analyzeTwitterHeaders(requestData.responseHeaders, requestData, 'response');

                console.log(`📦 X/Twitter Response: ${response.status} ${url}`, {
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

        // Парсер GraphQL запросов X/Twitter
        function parseTwitterGraphQL(bodyText) {
            try {
                const parsed = JSON.parse(bodyText);
                const operationName = parsed.operationName || 'unknown';
                const features = parsed.features ? Object.keys(parsed.features) : [];
                const variables = parsed.variables ? Object.keys(parsed.variables) : [];
                
                return {
                    operation: operationName,
                    features: features,
                    variables: variables
                };
            } catch (e) {
                return { operation: 'parse_error', features: [], variables: [] };
            }
        }

        // Извлечение информации о твите
        function extractTweetInfo(url, body) {
            if (url.includes('CreateTweet')) {
                return { type: 'create', tweetId: null };
            } else if (url.includes('TweetDetail')) {
                const tweetIdMatch = url.match(/(\d+)/);
                return { type: 'view', tweetId: tweetIdMatch ? tweetIdMatch[1] : null };
            } else if (url.includes('FavoriteTweet')) {
                return { type: 'like', tweetId: extractTweetIdFromBody(body) };
            } else if (url.includes('Retweet')) {
                return { type: 'retweet', tweetId: extractTweetIdFromBody(body) };
            }
            return { type: 'unknown', tweetId: null };
        }

        function extractTweetIdFromBody(body) {
            if (!body) return null;
            const match = body.match(/"tweet_id":"(\d+)"/);
            return match ? match[1] : null;
        }

        function extractTimelineType(url) {
            if (url.includes('HomeTimeline')) return 'home';
            if (url.includes('UserTweets')) return 'user';
            if (url.includes('SearchTimeline')) return 'search';
            return 'unknown';
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

    // 2. XHR перехват для X/Twitter
    function setupMemorySafeXHRInterception() {
        console.group('🌐 X/TWITTER MEMORY-SAFE XHR INTERCEPTION');

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

            // Определяем тип запроса X/Twitter
            if (typeof url === 'string') {
                data.isGraphQL = url.includes('/graphql/') || url.includes('/gql/');
                data.isTweetAPI = url.includes('/Tweet') || url.includes('/CreateTweet');
                data.isTimelineAPI = url.includes('/HomeTimeline') || url.includes('/UserTweets');
                data.isMediaAPI = url.includes('/MediaCreate') || url.includes('/upload/');
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
                                const graphqlInfo = parseTwitterGraphQL(body);
                                data.graphqlOperation = graphqlInfo.operation;
                                data.graphqlFeatures = graphqlInfo.features;

                                data.requestBodyBase64 = btoa(unescape(encodeURIComponent(body)));
                                
                                securityAnalysis.addGraphQLQuery(data.id, {
                                    url: data.url,
                                    requestBodyBase64: data.requestBodyBase64,
                                    operation: data.graphqlOperation,
                                    features: data.graphqlFeatures,
                                    timestamp: data.timestamp,
                                    size: body.length,
                                    type: 'xhr'
                                });
                            } catch (e) {
                                data.graphqlOperation = 'parse_error';
                            }
                        }

                        // Обработка твит-запросов
                        if (data.isTweetAPI) {
                            const tweetInfo = extractTweetInfo(data.url, body);
                            securityAnalysis.addTweetRequest(data.id, {
                                url: data.url,
                                timestamp: data.timestamp,
                                method: data.method,
                                type: tweetInfo.type,
                                tweetId: tweetInfo.tweetId
                            });
                        }

                        // Обработка ленты
                        if (data.isTimelineAPI) {
                            securityAnalysis.addTimelineRequest(data.id, {
                                url: data.url,
                                timestamp: data.timestamp,
                                method: data.method,
                                timelineType: extractTimelineType(data.url)
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

            // Анализ заголовков X/Twitter
            analyzeTwitterHeaders(data.headers, data, 'request');

            // Безопасное добавление запроса
            securityAnalysis.addRequest(data);

            console.log(`📡 X/Twitter XHR: ${data.method} ${data.url}`, {
                type: data.isGraphQL ? 'GraphQL' : 
                      (data.isTweetAPI ? 'Tweet' : 'Regular'),
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

                        if (data.isTweetAPI) {
                            const tweetData = securityAnalysis.network.tweetRequests.get(data.id);
                            if (tweetData) {
                                tweetData.responseSize = this.responseText.length;
                                tweetData.duration = data.duration;
                                tweetData.success = this.status === 200;
                            }
                        }

                        data.size += this.responseText.length;
                    }
                } catch (e) {
                    data.responseBody = '[Failed to read response]';
                }

                analyzeTwitterHeaders(this.getAllResponseHeaders(), data, 'response');

                console.log(`📦 X/Twitter XHR Response: ${this.status} ${data.url}`, {
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

    // 3. Анализ X/Twitter-специфичных заголовков
    function analyzeTwitterHeaders(headers, requestData, type) {
        const twitterSecurityHeaders = ['x-twitter-client-language', 'x-twitter-active-user', 'x-client-uuid'];
        const twitterAuthHeaders = ['authorization', 'x-csrf-token', 'x-guest-token', 'cookie'];
        const twitterTrackingHeaders = ['x-client-transaction-id', 'x-twitter-auth-type', 'x-requested-with'];

        if (type === 'request') {
            requestData.twitterSecurityHeaders = {};
            requestData.twitterAuthHeaders = {};
            requestData.twitterTrackingHeaders = {};

            Object.entries(headers || {}).forEach(([key, value]) => {
                const lowerKey = key.toLowerCase();

                if (twitterSecurityHeaders.some(h => lowerKey.includes(h))) {
                    requestData.twitterSecurityHeaders[key] = String(value).substring(0, 200);
                }

                if (twitterAuthHeaders.some(h => lowerKey.includes(h))) {
                    requestData.twitterAuthHeaders[key] = String(value).substring(0, 200);

                    // Сохраняем важные токены
                    if (key === 'x-csrf-token') {
                        securityAnalysis.session.csrfToken = value;
                        securityAnalysis.security.csrfTokens[requestData.timestamp] = value;
                    }
                    if (key === 'x-guest-token') {
                        securityAnalysis.session.guestId = value;
                    }
                    if (key === 'authorization' && value.includes('Bearer')) {
                        const token = value.replace('Bearer ', '').substring(0, 50);
                        securityAnalysis.security.bearerTokens[requestData.timestamp] = token;
                    }

                    securityAnalysis.addAuthFlow({
                        type: `twitter_${type}_header`,
                        header: key,
                        value: String(value).substring(0, 100),
                        timestamp: requestData.timestamp,
                        requestId: requestData.id
                    });
                }

                if (twitterTrackingHeaders.some(h => lowerKey.includes(h))) {
                    requestData.twitterTrackingHeaders[key] = String(value).substring(0, 200);
                }
            });

            // Анализ cookies для сессионных данных
            if (headers?.cookie) {
                const cookieData = analyzeTwitterCookies(headers.cookie);
                if (cookieData.auth_token) {
                    securityAnalysis.session.tokens.push(cookieData.auth_token);
                }
                if (cookieData.ct0) {
                    securityAnalysis.session.csrfToken = cookieData.ct0;
                }
                if (cookieData.twid) {
                    securityAnalysis.session.userId = cookieData.twid;
                }
            }
        }
    }

    // 4. Анализ X/Twitter cookies
    function analyzeTwitterCookies(cookieHeader) {
        const cookies = {};
        const authMatch = cookieHeader.match(/auth_token=([^;]+)/);
        const csrfMatch = cookieHeader.match(/ct0=([^;]+)/);
        const twidMatch = cookieHeader.match(/twid=([^;]+)/);
        const guestMatch = cookieHeader.match(/guest_id=([^;]+)/);

        if (authMatch) cookies.auth_token = authMatch[1];
        if (csrfMatch) cookies.ct0 = csrfMatch[1];
        if (twidMatch) cookies.twid = twidMatch[1];
        if (guestMatch) cookies.guest_id = guestMatch[1];

        return cookies;
    }

    // 5. Мониторинг твит-элементов
    function setupTweetElementMonitoring() {
        console.group('🐦 X/TWITTER TWEET ELEMENT MONITORING');

        // Наблюдатель за твит-элементами
        const tweetObserver = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === 1) { // Element node
                        // Поиск твитов
                        const tweetSelectors = [
                            '[data-testid="tweet"]',
                            'article[role="article"]',
                            '.tweet',
                            '[data-tweet-id]'
                        ];

                        tweetSelectors.forEach(selector => {
                            const elements = node.querySelectorAll ? node.querySelectorAll(selector) : [];
                            elements.forEach(element => {
                                const tweetId = element.getAttribute('data-tweet-id') || 
                                              element.querySelector('[data-tweet-id]')?.getAttribute('data-tweet-id') ||
                                              generateTweetId();
                                
                                if (tweetId && !securityAnalysis.dom.tweetElements.has(tweetId)) {
                                    securityAnalysis.dom.tweetElements.add(tweetId);
                                    
                                    const tweetData = {
                                        id: tweetId,
                                        element: element,
                                        timestamp: new Date().toISOString(),
                                        interactions: []
                                    };

                                    // Мониторинг взаимодействий
                                    const interactionHandlers = {
                                        'like': '[data-testid="like"]',
                                        'retweet': '[data-testid="retweet"]',
                                        'reply': '[data-testid="reply"]',
                                        'share': '[data-testid="share"]'
                                    };

                                    Object.entries(interactionHandlers).forEach(([type, selector]) => {
                                        const button = element.querySelector(selector);
                                        if (button) {
                                            button.addEventListener('click', (e) => {
                                                tweetData.interactions.push({
                                                    type: type,
                                                    timestamp: new Date().toISOString()
                                                });

                                                securityAnalysis.addDOMEvent({
                                                    type: `tweet_${type}`,
                                                    timestamp: new Date().toISOString(),
                                                    tweetId: tweetId,
                                                    coordinates: { x: e.clientX, y: e.clientY }
                                                });

                                                if (tweetData.interactions.length > 20) {
                                                    tweetData.interactions.shift();
                                                }

                                                console.log(`🐦 Tweet ${type}: ${tweetId}`);
                                            });
                                        }
                                    });

                                    console.log(`🐦 Twitter Tweet Element: ${tweetId}`);
                                }
                            });
                        });

                        // Мониторинг медиа в твитах
                        const mediaSelectors = [
                            '[data-testid="tweetPhoto"]',
                            '[data-testid="videoPlayer"]',
                            '.tweet-media'
                        ];

                        mediaSelectors.forEach(selector => {
                            const elements = node.querySelectorAll ? node.querySelectorAll(selector) : [];
                            elements.forEach(element => {
                                const mediaId = generateMediaId();
                                if (!securityAnalysis.dom.mediaElements.has(mediaId)) {
                                    securityAnalysis.dom.mediaElements.add(mediaId);
                                    
                                    element.addEventListener('click', (e) => {
                                        securityAnalysis.addDOMEvent({
                                            type: 'media_click',
                                            timestamp: new Date().toISOString(),
                                            mediaType: element.querySelector('video') ? 'video' : 'image'
                                        });
                                    });
                                }
                            });
                        });
                    }
                });
            });
        });

        tweetObserver.observe(document.body, {
            childList: true,
            subtree: true
        });

        function generateTweetId() {
            return `tweet_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        }

        function generateMediaId() {
            return `media_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        }

        console.groupEnd();
        return () => tweetObserver.disconnect();
    }

    // 6. Performance Observer для X/Twitter
    function setupSafePerformanceObserver() {
        console.group('⏱️ X/TWITTER PERFORMANCE OBSERVER');

        try {
            const perfObserver = new PerformanceObserver((list) => {
                list.getEntries().forEach(entry => {
                    // Особый интерес представляют GraphQL и медиа ресурсы
                    if (entry.name.includes('graphql') || entry.name.includes('.mp4') || 
                        entry.name.includes('.jpg') || entry.initiatorType === 'xmlhttprequest') {
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
            console.log('✅ X/Twitter Performance Observer started');
            return perfObserver;
        } catch (e) {
            console.log('❌ X/Twitter Performance Observer failed:', e);
            return null;
        }

        console.groupEnd();
    }

    // 7. Система управления жизненным циклом
    function setupLifecycleManagement() {
        console.group('🔧 X/TWITTER LIFECYCLE MANAGEMENT');

        let cleanupCallbacks = [];
        let intervals = [];

        window.stopTwitterAnalysis = function() {
            console.log('🛑 Stopping X/Twitter Security Analysis...');

            intervals.forEach(clearInterval);
            intervals = [];

            cleanupCallbacks.forEach(callback => {
                try {
                    callback();
                } catch (e) {
                    console.log('X/Twitter cleanup error:', e);
                }
            });
            cleanupCallbacks = [];

            securityAnalysis.clearAll();

            console.log('✅ X/Twitter Security Analysis stopped completely');
        };

        const autoStopTimeout = setTimeout(() => {
            console.warn(`⏰ Auto-stopping X/Twitter analysis after ${CONFIG.autoStopMinutes} minutes`);
            window.stopTwitterAnalysis();
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

    // 8. Инициализация X/Twitter мониторинга
    function startTwitterAnalysis() {
        console.log('🚀 STARTING X/TWITTER MEMORY-SAFE SECURITY ANALYSIS...');

        const lifecycle = setupLifecycleManagement();

        setupMemorySafeFetchInterception();

        const xhrCleanup = setupMemorySafeXHRInterception();
        if (xhrCleanup) lifecycle.registerCleanup(xhrCleanup);

        const perfObserver = setupSafePerformanceObserver();
        if (perfObserver) lifecycle.registerCleanup(() => perfObserver.disconnect());

        const tweetCleanup = setupTweetElementMonitoring();
        if (tweetCleanup) lifecycle.registerCleanup(tweetCleanup);

        // Периодический сбор статистики
        const statsInterval = setInterval(() => {
            const stats = {
                requests: securityAnalysis.network.requests.length,
                graphqlQueries: securityAnalysis.network.graphqlQueries.size,
                tweetRequests: securityAnalysis.network.tweetRequests.size,
                timelineRequests: securityAnalysis.network.timelineRequests.size,
                mediaRequests: securityAnalysis.network.mediaRequests.size,
                tweetElements: securityAnalysis.dom.tweetElements.size,
                mediaElements: securityAnalysis.dom.mediaElements.size,
                websockets: securityAnalysis.network.websockets.length,
                domEvents: securityAnalysis.dom.events.length,
                authFlows: securityAnalysis.security.authFlows.length,
                perfEntries: securityAnalysis.timing.performanceEntries.length,
                memory: Math.round(performance.memory?.usedJSHeapSize / 1048576) || 'N/A'
            };

            console.log('📈 X/Twitter Memory-Safe Stats:', stats);

            if (performance.memory && performance.memory.usedJSHeapSize > 500 * 1048576) {
                console.warn('🚨 High memory usage detected, clearing old data');
                securityAnalysis.clearAll();
            }
        }, 15000);

        lifecycle.registerInterval(statsInterval);

        setupTwitterCommands();

        console.log('✅ X/TWITTER MEMORY-SAFE SECURITY ANALYSIS ACTIVE!');
        console.log('💡 Available commands:');
        console.log('💡 stopTwitterAnalysis() - Complete shutdown');
        console.log('💡 getTwitterMemoryStats() - Current memory usage');
        console.log('💡 getGraphQLQueries() - View GraphQL operations');
        console.log('💡 getTweetActivity() - View tweet interactions');
        console.log('💡 getSessionInfo() - View session data');
    }

    // Команды для X/Twitter анализа
    function setupTwitterCommands() {
        window.getTwitterMemoryStats = function() {
            const stats = {
                requests: securityAnalysis.network.requests.length,
                graphqlQueries: securityAnalysis.network.graphqlQueries.size,
                tweetRequests: securityAnalysis.network.tweetRequests.size,
                timelineRequests: securityAnalysis.network.timelineRequests.size,
                mediaRequests: securityAnalysis.network.mediaRequests.size,
                tweetElements: securityAnalysis.dom.tweetElements.size,
                mediaElements: securityAnalysis.dom.mediaElements.size,
                websockets: securityAnalysis.network.websockets.length,
                domEvents: securityAnalysis.dom.events.length,
                authFlows: securityAnalysis.security.authFlows.length,
                perfEntries: securityAnalysis.timing.performanceEntries.length,
                session: {
                    userId: securityAnalysis.session.userId,
                    csrfToken: securityAnalysis.session.csrfToken,
                    guestId: securityAnalysis.session.guestId
                }
            };

            if (performance.memory) {
                stats.memoryMB = Math.round(performance.memory.usedJSHeapSize / 1048576);
                stats.memoryLimitMB = Math.round(performance.memory.jsHeapSizeLimit / 1048576);
            }

            console.log('💾 X/Twitter Memory Statistics:', stats);
            return stats;
        };

        window.clearTwitterData = function() {
            securityAnalysis.clearAll();
            console.log('🧹 X/Twitter data cleared');
        };

        window.getGraphQLQueries = function() {
            const queries = Array.from(securityAnalysis.network.graphqlQueries.entries());
            console.log('🕸️ GraphQL Queries:', queries);
            return queries;
        };

        window.getTweetActivity = function() {
            const tweetData = {
                tweetRequests: Array.from(securityAnalysis.network.tweetRequests.entries()),
                timelineRequests: Array.from(securityAnalysis.network.timelineRequests.entries()),
                tweetElements: Array.from(securityAnalysis.dom.tweetElements),
                interactions: securityAnalysis.dom.events.filter(e => e.type.includes('tweet_'))
            };
            console.log('🐦 Tweet Activity:', tweetData);
            return tweetData;
        };

        window.getSessionInfo = function() {
            console.log('👤 X/Twitter Session:', securityAnalysis.session);
            return securityAnalysis.session;
        };

        window.getAuthData = function() {
            const authData = {
                authFlows: securityAnalysis.security.authFlows,
                csrfTokens: securityAnalysis.security.csrfTokens,
                bearerTokens: securityAnalysis.security.bearerTokens
            };
            console.log('🔐 Authentication Data:', authData);
            return authData;
        };
    }

    // Запуск анализа X/Twitter
    startTwitterAnalysis();

})();