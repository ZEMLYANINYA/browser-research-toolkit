(function() {
    'use strict';

    console.log('🛡️ Starting Reddit Memory-Safe Security Analysis...');

    // Конфигурация с лимитами для Reddit
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
        maxPostRequests: 300,
        maxCommentRequests: 200,
        maxSubredditRequests: 100,
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
            redditConstants: {},
            userId: null,
            sessionId: null,
            csrfToken: null,
            modhash: null,
            loid: null
        },
        network: {
            requests: [],
            websockets: [],
            endpoints: new Map(),
            graphqlQueries: new Map(),
            postRequests: new Map(),
            commentRequests: new Map(),
            subredditRequests: new Map(),
            voteRequests: new Map(),
            mediaRequests: new Map()
        },
        security: {
            headers: {},
            redditAuth: {},
            authFlows: [],
            csrfTokens: {},
            redditSpecific: {}
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
            postElements: new Set(),
            commentElements: new Set(),
            voteElements: new Set()
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

        addPostRequest: function(id, postData) {
            this.network.postRequests.set(id, postData);
            if (this.network.postRequests.size > CONFIG.maxPostRequests) {
                const firstKey = this.network.postRequests.keys().next().value;
                this.network.postRequests.delete(firstKey);
            }
        },

        addCommentRequest: function(id, commentData) {
            this.network.commentRequests.set(id, commentData);
            if (this.network.commentRequests.size > CONFIG.maxCommentRequests) {
                const firstKey = this.network.commentRequests.keys().next().value;
                this.network.commentRequests.delete(firstKey);
            }
        },

        addSubredditRequest: function(id, subredditData) {
            this.network.subredditRequests.set(id, subredditData);
            if (this.network.subredditRequests.size > CONFIG.maxSubredditRequests) {
                const firstKey = this.network.subredditRequests.keys().next().value;
                this.network.subredditRequests.delete(firstKey);
            }
        },

        addVoteRequest: function(id, voteData) {
            this.network.voteRequests.set(id, voteData);
            if (this.network.voteRequests.size > CONFIG.maxBatches) {
                const firstKey = this.network.voteRequests.keys().next().value;
                this.network.voteRequests.delete(firstKey);
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
            this.network.postRequests.clear();
            this.network.commentRequests.clear();
            this.network.subredditRequests.clear();
            this.network.voteRequests.clear();
            this.network.mediaRequests.clear();
            this.network.endpoints.clear();
            this.dom.events = [];
            this.dom.currentXHRs.clear();
            this.dom.postElements.clear();
            this.dom.commentElements.clear();
            this.dom.voteElements.clear();
            this.security.authFlows = [];
            this.timing.performanceEntries = [];
            this.timing.events = [];
            this.timing.startTime = Date.now();
        }
    };

    // 1. Перехват Fetch с обработкой Reddit API
    function setupMemorySafeFetchInterception() {
        console.group('🌐 REDDIT MEMORY-SAFE FETCH INTERCEPTION');

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
                isPostAPI: false,
                isCommentAPI: false,
                isSubredditAPI: false,
                isVoteAPI: false,
                isMediaAPI: false,
                isAuthentication: false
            };

            // Определяем тип запроса Reddit
            if (typeof url === 'string') {
                requestData.isGraphQL = url.includes('/graphql') || url.includes('/gql/');
                requestData.isPostAPI = url.includes('/api/submit') || url.includes('/api/info') || 
                                      url.includes('/api/v1/') || url.includes('/comments/');
                requestData.isCommentAPI = url.includes('/api/comment') || url.includes('/api/morechildren');
                requestData.isSubredditAPI = url.includes('/r/') || url.includes('/subreddits/');
                requestData.isVoteAPI = url.includes('/api/vote') || url.includes('/api/save') || 
                                      url.includes('/api/hide');
                requestData.isMediaAPI = url.includes('/media') || url.includes('/upload') || 
                                       url.includes('.jpg') || url.includes('.png');
                requestData.isAuthentication = url.includes('/api/login') || url.includes('/api/register') ||
                                             url.includes('/api/access_token');
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

            // Обработка GraphQL запросов Reddit
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
                        const graphqlInfo = parseRedditGraphQL(bodyText);
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

            // Обработка пост-запросов
            if (requestData.isPostAPI) {
                const postInfo = extractPostInfo(requestData.url, requestData.requestBody);
                securityAnalysis.addPostRequest(requestId, {
                    url: url,
                    timestamp: requestData.timestamp,
                    method: requestData.method,
                    type: postInfo.type,
                    postId: postInfo.postId,
                    subreddit: postInfo.subreddit,
                    size: requestData.size
                });
            }

            // Обработка комментариев
            if (requestData.isCommentAPI) {
                const commentInfo = extractCommentInfo(requestData.url, requestData.requestBody);
                securityAnalysis.addCommentRequest(requestId, {
                    url: url,
                    timestamp: requestData.timestamp,
                    method: requestData.method,
                    type: commentInfo.type,
                    commentId: commentInfo.commentId,
                    postId: commentInfo.postId,
                    size: requestData.size
                });
            }

            // Обработка сабреддитов
            if (requestData.isSubredditAPI) {
                const subredditInfo = extractSubredditInfo(requestData.url);
                securityAnalysis.addSubredditRequest(requestId, {
                    url: url,
                    timestamp: requestData.timestamp,
                    method: requestData.method,
                    subreddit: subredditInfo.name,
                    type: subredditInfo.type,
                    size: requestData.size
                });
            }

            // Обработка голосов
            if (requestData.isVoteAPI) {
                const voteInfo = extractVoteInfo(requestData.url, requestData.requestBody);
                securityAnalysis.addVoteRequest(requestId, {
                    url: url,
                    timestamp: requestData.timestamp,
                    method: requestData.method,
                    type: voteInfo.type,
                    targetId: voteInfo.targetId,
                    direction: voteInfo.direction,
                    size: requestData.size
                });
            }

            // Анализ Reddit-специфичных заголовков
            analyzeRedditHeaders(args[1]?.headers, requestData, 'request');

            // Безопасное добавление запроса
            securityAnalysis.addRequest(requestData);

            console.log(`📡 Reddit Fetch: ${requestData.method} ${url}`, {
                type: requestData.isGraphQL ? 'GraphQL' : 
                      (requestData.isPostAPI ? 'Post' : 
                      (requestData.isCommentAPI ? 'Comment' : 
                      (requestData.isSubredditAPI ? 'Subreddit' : 
                      (requestData.isVoteAPI ? 'Vote' : 
                      (requestData.isMediaAPI ? 'Media' : 'Regular'))))),
                operation: requestData.graphqlOperation,
                subreddit: requestData.isSubredditAPI ? extractSubredditFromUrl(url) : null,
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

                    // Для пост-ответов
                    if (requestData.isPostAPI) {
                        const postData = securityAnalysis.network.postRequests.get(requestId);
                        if (postData) {
                            postData.responseSize = text.length;
                            postData.duration = requestData.duration;
                            postData.success = response.status === 200;
                            
                            // Извлекаем ID созданного поста
                            const postIdMatch = text.match(/"id":\s*"t3_([a-z0-9]+)"/);
                            if (postIdMatch) {
                                postData.createdPostId = postIdMatch[1];
                            }
                        }
                    }

                    // Для комментариев
                    if (requestData.isCommentAPI) {
                        const commentData = securityAnalysis.network.commentRequests.get(requestId);
                        if (commentData) {
                            commentData.responseSize = text.length;
                            commentData.duration = requestData.duration;
                            commentData.success = response.status === 200;
                        }
                    }

                    requestData.size += text.length;
                } catch (e) {
                    requestData.responseBody = '[Failed to read response body]';
                }

                analyzeRedditHeaders(requestData.responseHeaders, requestData, 'response');

                console.log(`📦 Reddit Response: ${response.status} ${url}`, {
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

        // Парсер GraphQL запросов Reddit
        function parseRedditGraphQL(bodyText) {
            try {
                const parsed = JSON.parse(bodyText);
                const operationName = parsed.operationName || 'unknown';
                const variables = parsed.variables ? Object.keys(parsed.variables) : [];
                
                return {
                    operation: operationName,
                    variables: variables
                };
            } catch (e) {
                return { operation: 'parse_error', variables: [] };
            }
        }

        // Извлечение информации о посте
        function extractPostInfo(url, body) {
            if (url.includes('/api/submit')) {
                return { type: 'create', postId: null, subreddit: extractSubredditFromBody(body) };
            } else if (url.includes('/api/info')) {
                return { type: 'info', postId: extractPostIdFromUrl(url), subreddit: null };
            } else if (url.includes('/comments/')) {
                return { type: 'view', postId: extractPostIdFromUrl(url), subreddit: extractSubredditFromUrl(url) };
            }
            return { type: 'unknown', postId: null, subreddit: null };
        }

        function extractPostIdFromUrl(url) {
            const match = url.match(/comments\/([a-z0-9]+)/);
            return match ? match[1] : null;
        }

        function extractSubredditFromUrl(url) {
            const match = url.match(/\/r\/([a-zA-Z0-9_]+)/);
            return match ? match[1] : null;
        }

        function extractSubredditFromBody(body) {
            if (!body) return null;
            const match = body.match(/sr=([a-zA-Z0-9_]+)/);
            return match ? match[1] : null;
        }

        // Извлечение информации о комментарии
        function extractCommentInfo(url, body) {
            if (url.includes('/api/comment')) {
                return { type: 'create', commentId: null, postId: extractThingIdFromBody(body, 'thing_id') };
            } else if (url.includes('/api/morechildren')) {
                return { type: 'load_more', commentId: null, postId: extractThingIdFromBody(body, 'link_id') };
            }
            return { type: 'unknown', commentId: null, postId: null };
        }

        function extractThingIdFromBody(body, key) {
            if (!body) return null;
            const match = new RegExp(`${key}=t3_([a-z0-9]+)`).exec(body);
            return match ? match[1] : null;
        }

        // Извлечение информации о сабреддите
        function extractSubredditInfo(url) {
            if (url.includes('/r/') && url.includes('/about')) {
                return { type: 'about', name: extractSubredditFromUrl(url) };
            } else if (url.includes('/r/') && url.includes('/api/')) {
                return { type: 'api', name: extractSubredditFromUrl(url) };
            } else if (url.includes('/subreddits/')) {
                return { type: 'list', name: null };
            }
            return { type: 'browse', name: extractSubredditFromUrl(url) };
        }

        // Извлечение информации о голосе
        function extractVoteInfo(url, body) {
            if (url.includes('/api/vote')) {
                const dirMatch = body.match(/dir=(-1|0|1)/);
                const idMatch = body.match(/id=(t[0-9]_[a-z0-9]+)/);
                return { 
                    type: 'vote', 
                    targetId: idMatch ? idMatch[1] : null, 
                    direction: dirMatch ? dirMatch[1] : null 
                };
            } else if (url.includes('/api/save')) {
                return { type: 'save', targetId: extractThingIdFromBody(body, 'id'), direction: null };
            } else if (url.includes('/api/hide')) {
                return { type: 'hide', targetId: extractThingIdFromBody(body, 'id'), direction: null };
            }
            return { type: 'unknown', targetId: null, direction: null };
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

    // 2. XHR перехват для Reddit
    function setupMemorySafeXHRInterception() {
        console.group('🌐 REDDIT MEMORY-SAFE XHR INTERCEPTION');

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

            // Определяем тип запроса Reddit
            if (typeof url === 'string') {
                data.isGraphQL = url.includes('/graphql') || url.includes('/gql/');
                data.isPostAPI = url.includes('/api/submit') || url.includes('/api/info');
                data.isCommentAPI = url.includes('/api/comment');
                data.isSubredditAPI = url.includes('/r/') || url.includes('/subreddits/');
                data.isVoteAPI = url.includes('/api/vote') || url.includes('/api/save');
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
                                const graphqlInfo = parseRedditGraphQL(body);
                                data.graphqlOperation = graphqlInfo.operation;

                                data.requestBodyBase64 = btoa(unescape(encodeURIComponent(body)));
                                
                                securityAnalysis.addGraphQLQuery(data.id, {
                                    url: data.url,
                                    requestBodyBase64: data.requestBodyBase64,
                                    operation: data.graphqlOperation,
                                    timestamp: data.timestamp,
                                    size: body.length,
                                    type: 'xhr'
                                });
                            } catch (e) {
                                data.graphqlOperation = 'parse_error';
                            }
                        }

                        // Обработка пост-запросов
                        if (data.isPostAPI) {
                            const postInfo = extractPostInfo(data.url, body);
                            securityAnalysis.addPostRequest(data.id, {
                                url: data.url,
                                timestamp: data.timestamp,
                                method: data.method,
                                type: postInfo.type,
                                postId: postInfo.postId,
                                subreddit: postInfo.subreddit
                            });
                        }

                        // Обработка комментариев
                        if (data.isCommentAPI) {
                            const commentInfo = extractCommentInfo(data.url, body);
                            securityAnalysis.addCommentRequest(data.id, {
                                url: data.url,
                                timestamp: data.timestamp,
                                method: data.method,
                                type: commentInfo.type,
                                commentId: commentInfo.commentId,
                                postId: commentInfo.postId
                            });
                        }

                        // Обработка голосов
                        if (data.isVoteAPI) {
                            const voteInfo = extractVoteInfo(data.url, body);
                            securityAnalysis.addVoteRequest(data.id, {
                                url: data.url,
                                timestamp: data.timestamp,
                                method: data.method,
                                type: voteInfo.type,
                                targetId: voteInfo.targetId,
                                direction: voteInfo.direction
                            });
                        }
                    } else if (body instanceof Blob) {
                        data.requestBody = `[Blob: ${body.size} bytes]`;
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

            // Анализ заголовков Reddit
            analyzeRedditHeaders(data.headers, data, 'request');

            // Безопасное добавление запроса
            securityAnalysis.addRequest(data);

            console.log(`📡 Reddit XHR: ${data.method} ${data.url}`, {
                type: data.isGraphQL ? 'GraphQL' : 
                      (data.isPostAPI ? 'Post' : 'Regular'),
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

                        if (data.isPostAPI) {
                            const postData = securityAnalysis.network.postRequests.get(data.id);
                            if (postData) {
                                postData.responseSize = this.responseText.length;
                                postData.duration = data.duration;
                                postData.success = this.status === 200;
                            }
                        }

                        data.size += this.responseText.length;
                    }
                } catch (e) {
                    data.responseBody = '[Failed to read response]';
                }

                analyzeRedditHeaders(this.getAllResponseHeaders(), data, 'response');

                console.log(`📦 Reddit XHR Response: ${this.status} ${data.url}`, {
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

    // 3. Анализ Reddit-специфичных заголовков
    function analyzeRedditHeaders(headers, requestData, type) {
        const redditSecurityHeaders = ['x-reddit-session', 'x-reddit-loid', 'x-modhash'];
        const redditAuthHeaders = ['authorization', 'x-reddit-auth', 'cookie'];
        const redditTrackingHeaders = ['x-requested-with', 'x-reddit-tracking', 'x-reddit-user-id'];

        if (type === 'request') {
            requestData.redditSecurityHeaders = {};
            requestData.redditAuthHeaders = {};
            requestData.redditTrackingHeaders = {};

            Object.entries(headers || {}).forEach(([key, value]) => {
                const lowerKey = key.toLowerCase();

                if (redditSecurityHeaders.some(h => lowerKey.includes(h))) {
                    requestData.redditSecurityHeaders[key] = String(value).substring(0, 200);
                    
                    // Сохраняем важные security headers
                    if (key === 'x-modhash') {
                        securityAnalysis.session.modhash = value;
                    }
                    if (key === 'x-reddit-loid') {
                        securityAnalysis.session.loid = value;
                    }
                }

                if (redditAuthHeaders.some(h => lowerKey.includes(h))) {
                    requestData.redditAuthHeaders[key] = String(value).substring(0, 200);

                    securityAnalysis.addAuthFlow({
                        type: `reddit_${type}_header`,
                        header: key,
                        value: String(value).substring(0, 100),
                        timestamp: requestData.timestamp,
                        requestId: requestData.id
                    });
                }

                if (redditTrackingHeaders.some(h => lowerKey.includes(h))) {
                    requestData.redditTrackingHeaders[key] = String(value).substring(0, 200);
                }
            });

            // Анализ cookies для сессионных данных
            if (headers?.cookie) {
                const cookieData = analyzeRedditCookies(headers.cookie);
                if (cookieData.reddit_session) {
                    securityAnalysis.session.sessionId = cookieData.reddit_session;
                }
                if (cookieData.token) {
                    securityAnalysis.session.tokens.push(cookieData.token);
                }
                if (cookieData.loid) {
                    securityAnalysis.session.loid = cookieData.loid;
                }
            }
        }
    }

    // 4. Анализ Reddit cookies
    function analyzeRedditCookies(cookieHeader) {
        const cookies = {};
        const sessionMatch = cookieHeader.match(/reddit_session=([^;]+)/);
        const tokenMatch = cookieHeader.match(/token=([^;]+)/);
        const loidMatch = cookieHeader.match(/loid=([^;]+)/);
        const csrfMatch = cookieHeader.match(/csrf_token=([^;]+)/);

        if (sessionMatch) cookies.reddit_session = sessionMatch[1];
        if (tokenMatch) cookies.token = tokenMatch[1];
        if (loidMatch) cookies.loid = loidMatch[1];
        if (csrfMatch) cookies.csrf_token = csrfMatch[1];

        return cookies;
    }

    // 5. Мониторинг пост-элементов Reddit
    function setupPostElementMonitoring() {
        console.group('📝 REDDIT POST ELEMENT MONITORING');

        // Наблюдатель за пост-элементами
        const postObserver = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === 1) { // Element node
                        // Поиск постов
                        const postSelectors = [
                            '[data-testid="post-container"]',
                            '.Post',
                            '[data-click-id="body"]',
                            'shreddit-post'
                        ];

                        postSelectors.forEach(selector => {
                            const elements = node.querySelectorAll ? node.querySelectorAll(selector) : [];
                            elements.forEach(element => {
                                const postId = element.getAttribute('id') || 
                                             element.getAttribute('data-fullname') ||
                                             generatePostId();
                                
                                if (postId && !securityAnalysis.dom.postElements.has(postId)) {
                                    securityAnalysis.dom.postElements.add(postId);
                                    
                                    const postData = {
                                        id: postId,
                                        element: element,
                                        timestamp: new Date().toISOString(),
                                        interactions: []
                                    };

                                    // Мониторинг взаимодействий
                                    const interactionHandlers = {
                                        'upvote': '[data-click-id="upvote"]',
                                        'downvote': '[data-click-id="downvote"]',
                                        'comments': '[data-click-id="comments"]',
                                        'share': '[data-click-id="share"]',
                                        'save': '[data-testid="save-post"]'
                                    };

                                    Object.entries(interactionHandlers).forEach(([type, selector]) => {
                                        const button = element.querySelector(selector);
                                        if (button) {
                                            button.addEventListener('click', (e) => {
                                                postData.interactions.push({
                                                    type: type,
                                                    timestamp: new Date().toISOString()
                                                });

                                                securityAnalysis.addDOMEvent({
                                                    type: `post_${type}`,
                                                    timestamp: new Date().toISOString(),
                                                    postId: postId,
                                                    coordinates: { x: e.clientX, y: e.clientY }
                                                });

                                                if (postData.interactions.length > 20) {
                                                    postData.interactions.shift();
                                                }

                                                console.log(`📝 Post ${type}: ${postId}`);
                                            });
                                        }
                                    });

                                    console.log(`📝 Reddit Post Element: ${postId}`);
                                }
                            });
                        });

                        // Мониторинг комментариев
                        const commentSelectors = [
                            '[data-testid="comment"]',
                            '.Comment',
                            'shreddit-comment'
                        ];

                        commentSelectors.forEach(selector => {
                            const elements = node.querySelectorAll ? node.querySelectorAll(selector) : [];
                            elements.forEach(element => {
                                const commentId = element.getAttribute('id') || 
                                                element.getAttribute('data-fullname') ||
                                                generateCommentId();
                                
                                if (commentId && !securityAnalysis.dom.commentElements.has(commentId)) {
                                    securityAnalysis.dom.commentElements.add(commentId);
                                    
                                    const commentData = {
                                        id: commentId,
                                        element: element,
                                        timestamp: new Date().toISOString(),
                                        interactions: []
                                    };

                                    // Мониторинг взаимодействий с комментариями
                                    const commentHandlers = {
                                        'upvote': '.icon-upvote',
                                        'downvote': '.icon-downvote',
                                        'reply': '[data-click-id="reply"]',
                                        'award': '[data-click-id="award"]'
                                    };

                                    Object.entries(commentHandlers).forEach(([type, selector]) => {
                                        const button = element.querySelector(selector);
                                        if (button) {
                                            button.addEventListener('click', (e) => {
                                                commentData.interactions.push({
                                                    type: type,
                                                    timestamp: new Date().toISOString()
                                                });

                                                securityAnalysis.addDOMEvent({
                                                    type: `comment_${type}`,
                                                    timestamp: new Date().toISOString(),
                                                    commentId: commentId
                                                });

                                                if (commentData.interactions.length > 20) {
                                                    commentData.interactions.shift();
                                                }
                                            });
                                        }
                                    });

                                    console.log(`💬 Reddit Comment Element: ${commentId}`);
                                }
                            });
                        });
                    }
                });
            });
        });

        postObserver.observe(document.body, {
            childList: true,
            subtree: true
        });

        function generatePostId() {
            return `post_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        }

        function generateCommentId() {
            return `comment_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        }

        console.groupEnd();
        return () => postObserver.disconnect();
    }

    // 6. Performance Observer для Reddit
    function setupSafePerformanceObserver() {
        console.group('⏱️ REDDIT PERFORMANCE OBSERVER');

        try {
            const perfObserver = new PerformanceObserver((list) => {
                list.getEntries().forEach(entry => {
                    // Особый интерес представляют GraphQL и медиа ресурсы
                    if (entry.name.includes('reddit') || entry.name.includes('/api/') || 
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
            console.log('✅ Reddit Performance Observer started');
            return perfObserver;
        } catch (e) {
            console.log('❌ Reddit Performance Observer failed:', e);
            return null;
        }

        console.groupEnd();
    }

    // 7. Система управления жизненным циклом
    function setupLifecycleManagement() {
        console.group('🔧 REDDIT LIFECYCLE MANAGEMENT');

        let cleanupCallbacks = [];
        let intervals = [];

        window.stopRedditAnalysis = function() {
            console.log('🛑 Stopping Reddit Security Analysis...');

            intervals.forEach(clearInterval);
            intervals = [];

            cleanupCallbacks.forEach(callback => {
                try {
                    callback();
                } catch (e) {
                    console.log('Reddit cleanup error:', e);
                }
            });
            cleanupCallbacks = [];

            securityAnalysis.clearAll();

            console.log('✅ Reddit Security Analysis stopped completely');
        };

        const autoStopTimeout = setTimeout(() => {
            console.warn(`⏰ Auto-stopping Reddit analysis after ${CONFIG.autoStopMinutes} minutes`);
            window.stopRedditAnalysis();
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

    // 8. Инициализация Reddit мониторинга
    function startRedditAnalysis() {
        console.log('🚀 STARTING REDDIT MEMORY-SAFE SECURITY ANALYSIS...');

        const lifecycle = setupLifecycleManagement();

        setupMemorySafeFetchInterception();

        const xhrCleanup = setupMemorySafeXHRInterception();
        if (xhrCleanup) lifecycle.registerCleanup(xhrCleanup);

        const perfObserver = setupSafePerformanceObserver();
        if (perfObserver) lifecycle.registerCleanup(() => perfObserver.disconnect());

        const postCleanup = setupPostElementMonitoring();
        if (postCleanup) lifecycle.registerCleanup(postCleanup);

        // Периодический сбор статистики
        const statsInterval = setInterval(() => {
            const stats = {
                requests: securityAnalysis.network.requests.length,
                graphqlQueries: securityAnalysis.network.graphqlQueries.size,
                postRequests: securityAnalysis.network.postRequests.size,
                commentRequests: securityAnalysis.network.commentRequests.size,
                subredditRequests: securityAnalysis.network.subredditRequests.size,
                voteRequests: securityAnalysis.network.voteRequests.size,
                postElements: securityAnalysis.dom.postElements.size,
                commentElements: securityAnalysis.dom.commentElements.size,
                websockets: securityAnalysis.network.websockets.length,
                domEvents: securityAnalysis.dom.events.length,
                authFlows: securityAnalysis.security.authFlows.length,
                perfEntries: securityAnalysis.timing.performanceEntries.length,
                memory: Math.round(performance.memory?.usedJSHeapSize / 1048576) || 'N/A'
            };

            console.log('📈 Reddit Memory-Safe Stats:', stats);

            if (performance.memory && performance.memory.usedJSHeapSize > 500 * 1048576) {
                console.warn('🚨 High memory usage detected, clearing old data');
                securityAnalysis.clearAll();
            }
        }, 15000);

        lifecycle.registerInterval(statsInterval);

        setupRedditCommands();

        console.log('✅ REDDIT MEMORY-SAFE SECURITY ANALYSIS ACTIVE!');
        console.log('💡 Available commands:');
        console.log('💡 stopRedditAnalysis() - Complete shutdown');
        console.log('💡 getRedditMemoryStats() - Current memory usage');
        console.log('💡 getGraphQLQueries() - View GraphQL operations');
        console.log('💡 getPostActivity() - View post interactions');
        console.log('💡 getVoteHistory() - View voting history');
        console.log('💡 getSessionInfo() - View session data');
    }

    // Команды для Reddit анализа
    function setupRedditCommands() {
        window.getRedditMemoryStats = function() {
            const stats = {
                requests: securityAnalysis.network.requests.length,
                graphqlQueries: securityAnalysis.network.graphqlQueries.size,
                postRequests: securityAnalysis.network.postRequests.size,
                commentRequests: securityAnalysis.network.commentRequests.size,
                subredditRequests: securityAnalysis.network.subredditRequests.size,
                voteRequests: securityAnalysis.network.voteRequests.size,
                postElements: securityAnalysis.dom.postElements.size,
                commentElements: securityAnalysis.dom.commentElements.size,
                websockets: securityAnalysis.network.websockets.length,
                domEvents: securityAnalysis.dom.events.length,
                authFlows: securityAnalysis.security.authFlows.length,
                perfEntries: securityAnalysis.timing.performanceEntries.length,
                session: {
                    userId: securityAnalysis.session.userId,
                    sessionId: securityAnalysis.session.sessionId,
                    modhash: securityAnalysis.session.modhash,
                    loid: securityAnalysis.session.loid
                }
            };

            if (performance.memory) {
                stats.memoryMB = Math.round(performance.memory.usedJSHeapSize / 1048576);
                stats.memoryLimitMB = Math.round(performance.memory.jsHeapSizeLimit / 1048576);
            }

            console.log('💾 Reddit Memory Statistics:', stats);
            return stats;
        };

        window.clearRedditData = function() {
            securityAnalysis.clearAll();
            console.log('🧹 Reddit data cleared');
        };

        window.getGraphQLQueries = function() {
            const queries = Array.from(securityAnalysis.network.graphqlQueries.entries());
            console.log('🕸️ GraphQL Queries:', queries);
            return queries;
        };

        window.getPostActivity = function() {
            const postData = {
                postRequests: Array.from(securityAnalysis.network.postRequests.entries()),
                commentRequests: Array.from(securityAnalysis.network.commentRequests.entries()),
                postElements: Array.from(securityAnalysis.dom.postElements),
                interactions: securityAnalysis.dom.events.filter(e => e.type.includes('post_'))
            };
            console.log('📝 Post Activity:', postData);
            return postData;
        };

        window.getVoteHistory = function() {
            const votes = Array.from(securityAnalysis.network.voteRequests.entries());
            console.log('🗳️ Vote History:', votes);
            return votes;
        };

        window.getSessionInfo = function() {
            console.log('👤 Reddit Session:', securityAnalysis.session);
            return securityAnalysis.session;
        };

        window.getSubredditActivity = function() {
            const subreddits = Array.from(securityAnalysis.network.subredditRequests.entries());
            console.log('🏷️ Subreddit Activity:', subreddits);
            return subreddits;
        };
    }

    // Запуск анализа Reddit
    startRedditAnalysis();

})();