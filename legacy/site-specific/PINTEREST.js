(function() {
    'use strict';

    console.log('🛡️ Starting Pinterest Memory-Safe Security Analysis...');

    // Конфигурация с лимитами для Pinterest
    const CONFIG = {
        maxBodySize: 10000,
        maxGraphQLSize: 50000, // 50KB для GraphQL
        maxImageDataSize: 100000, // 100KB для данных изображений
        maxRequests: 1000,
        maxBatches: 100,
        maxWebSockets: 50,
        maxDomEvents: 500,
        maxPerfEntries: 200,
        maxAuthFlows: 500,
        maxPinRequests: 300,
        maxBoardRequests: 200,
        maxSearchRequests: 100,
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
            pinterestConstants: {},
            userId: null,
            sessionId: null,
            csrfToken: null,
            deviceId: null,
            visitorId: null
        },
        network: {
            requests: [],
            websockets: [],
            endpoints: new Map(),
            graphqlQueries: new Map(),
            pinRequests: new Map(),
            boardRequests: new Map(),
            searchRequests: new Map(),
            imageRequests: new Map(),
            userRequests: new Map(),
            feedRequests: new Map()
        },
        security: {
            headers: {},
            pinterestAuth: {},
            authFlows: [],
            csrfTokens: {},
            pinterestTokens: {}
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
            pinElements: new Set(),
            boardElements: new Set(),
            imageElements: new Set()
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

        addPinRequest: function(id, pinData) {
            this.network.pinRequests.set(id, pinData);
            if (this.network.pinRequests.size > CONFIG.maxPinRequests) {
                const firstKey = this.network.pinRequests.keys().next().value;
                this.network.pinRequests.delete(firstKey);
            }
        },

        addBoardRequest: function(id, boardData) {
            this.network.boardRequests.set(id, boardData);
            if (this.network.boardRequests.size > CONFIG.maxBoardRequests) {
                const firstKey = this.network.boardRequests.keys().next().value;
                this.network.boardRequests.delete(firstKey);
            }
        },

        addSearchRequest: function(id, searchData) {
            this.network.searchRequests.set(id, searchData);
            if (this.network.searchRequests.size > CONFIG.maxSearchRequests) {
                const firstKey = this.network.searchRequests.keys().next().value;
                this.network.searchRequests.delete(firstKey);
            }
        },

        addImageRequest: function(id, imageData) {
            this.network.imageRequests.set(id, imageData);
            if (this.network.imageRequests.size > CONFIG.maxBatches) {
                const firstKey = this.network.imageRequests.keys().next().value;
                this.network.imageRequests.delete(firstKey);
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
            this.network.pinRequests.clear();
            this.network.boardRequests.clear();
            this.network.searchRequests.clear();
            this.network.imageRequests.clear();
            this.network.userRequests.clear();
            this.network.feedRequests.clear();
            this.network.endpoints.clear();
            this.dom.events = [];
            this.dom.currentXHRs.clear();
            this.dom.pinElements.clear();
            this.dom.boardElements.clear();
            this.dom.imageElements.clear();
            this.security.authFlows = [];
            this.timing.performanceEntries = [];
            this.timing.events = [];
            this.timing.startTime = Date.now();
        }
    };

    // 1. Перехват Fetch с обработкой Pinterest API
    function setupMemorySafeFetchInterception() {
        console.group('🌐 PINTEREST MEMORY-SAFE FETCH INTERCEPTION');

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
                isPinAPI: false,
                isBoardAPI: false,
                isSearchAPI: false,
                isImageAPI: false,
                isUserAPI: false,
                isFeedAPI: false,
                isAuthentication: false
            };

            // Определяем тип запроса Pinterest
            if (typeof url === 'string') {
                requestData.isGraphQL = url.includes('/graphql') || url.includes('/gql/') || url.includes('/query');
                requestData.isPinAPI = url.includes('/pin/') || url.includes('/resource/PinResource') || url.includes('/create');
                requestData.isBoardAPI = url.includes('/board/') || url.includes('/resource/BoardResource');
                requestData.isSearchAPI = url.includes('/search/') || url.includes('/typeahead') || url.includes('/suggest');
                requestData.isImageAPI = url.includes('/upload') || url.includes('/image') || url.includes('.jpg') || url.includes('.png');
                requestData.isUserAPI = url.includes('/user/') || url.includes('/me/') || url.includes('/profile');
                requestData.isFeedAPI = url.includes('/feed/') || url.includes('/homefeed') || url.includes('/related');
                requestData.isAuthentication = url.includes('/auth/') || url.includes('/login') || url.includes('/oauth');
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
                        // Для изображений сохраняем только метаданные
                        if (args[1].body.type.includes('image')) {
                            requestData.requestBody = `[Image: ${args[1].body.size} bytes, type: ${args[1].body.type}]`;
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

            // Обработка GraphQL запросов Pinterest
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
                        const graphqlInfo = parsePinterestGraphQL(bodyText);
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

            // Обработка пинов
            if (requestData.isPinAPI && args[1]?.body) {
                try {
                    const bodyText = await cloneAndReadBody(args[1].body);
                    if (bodyText.length > CONFIG.maxBodySize) {
                        requestData.requestBody = `[Pin API TOO_LARGE: ${bodyText.length} bytes]`;
                        requestData.requestBodyBase64 = 'TOO_LARGE';
                    } else {
                        requestData.requestBodyBase64 = btoa(unescape(encodeURIComponent(bodyText)));
                        requestData.requestBody = `Pin API (base64): ${requestData.requestBodyBase64.substring(0, 200)}...`;
                    }
                    requestData.size = bodyText.length;

                    // Извлекаем информацию о пине
                    const pinInfo = extractPinInfo(requestData.url, bodyText);
                    requestData.pinId = pinInfo.pinId;
                    requestData.pinAction = pinInfo.action;

                    // Сохраняем пин-запрос
                    securityAnalysis.addPinRequest(requestId, {
                        url: url,
                        requestBodyBase64: requestData.requestBodyBase64,
                        pinId: requestData.pinId,
                        action: requestData.pinAction,
                        timestamp: requestData.timestamp,
                        size: bodyText.length,
                        type: 'fetch',
                        method: requestData.method
                    });
                } catch (e) {
                    requestData.requestBody = '[Failed to read pin API body]';
                }
            }

            // Обработка досок
            if (requestData.isBoardAPI) {
                const boardInfo = extractBoardInfo(requestData.url, requestData.requestBody);
                securityAnalysis.addBoardRequest(requestId, {
                    url: url,
                    timestamp: requestData.timestamp,
                    method: requestData.method,
                    type: boardInfo.type,
                    boardId: boardInfo.boardId,
                    boardName: boardInfo.boardName,
                    size: requestData.size
                });
            }

            // Обработка поисковых запросов
            if (requestData.isSearchAPI) {
                const searchInfo = extractSearchInfo(requestData.url, requestData.requestBody);
                securityAnalysis.addSearchRequest(requestId, {
                    url: url,
                    timestamp: requestData.timestamp,
                    method: requestData.method,
                    query: searchInfo.query,
                    type: searchInfo.type,
                    size: requestData.size
                });
            }

            // Обработка изображений
            if (requestData.isImageAPI) {
                securityAnalysis.addImageRequest(requestId, {
                    url: url,
                    timestamp: requestData.timestamp,
                    method: requestData.method,
                    size: requestData.size,
                    imageType: requestData.requestBody?.includes('image') ? 'upload' : 'load'
                });
            }

            // Анализ Pinterest-специфичных заголовков
            analyzePinterestHeaders(args[1]?.headers, requestData, 'request');

            // Безопасное добавление запроса
            securityAnalysis.addRequest(requestData);

            console.log(`📡 Pinterest Fetch: ${requestData.method} ${url}`, {
                type: requestData.isGraphQL ? 'GraphQL' : 
                      (requestData.isPinAPI ? 'Pin' : 
                      (requestData.isBoardAPI ? 'Board' : 
                      (requestData.isSearchAPI ? 'Search' : 
                      (requestData.isImageAPI ? 'Image' : 
                      (requestData.isUserAPI ? 'User' : 
                      (requestData.isFeedAPI ? 'Feed' : 'Regular')))))),
                operation: requestData.graphqlOperation,
                pinId: requestData.pinId,
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

                    // Для пин-ответов
                    if (requestData.isPinAPI) {
                        const pinData = securityAnalysis.network.pinRequests.get(requestId);
                        if (pinData) {
                            pinData.responseSize = text.length;
                            pinData.duration = requestData.duration;
                            pinData.success = response.status === 200;
                            
                            // Извлекаем данные пина из ответа
                            const pinInfo = extractPinFromResponse(text);
                            if (pinInfo) {
                                pinData.pinData = pinInfo;
                            }
                        }
                    }

                    // Для поисковых ответов
                    if (requestData.isSearchAPI) {
                        const searchData = securityAnalysis.network.searchRequests.get(requestId);
                        if (searchData) {
                            searchData.responseSize = text.length;
                            searchData.duration = requestData.duration;
                            searchData.resultCount = extractSearchResultCount(text);
                        }
                    }

                    requestData.size += text.length;
                } catch (e) {
                    requestData.responseBody = '[Failed to read response body]';
                }

                analyzePinterestHeaders(requestData.responseHeaders, requestData, 'response');

                console.log(`📦 Pinterest Response: ${response.status} ${url}`, {
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

        // Парсер GraphQL запросов Pinterest
        function parsePinterestGraphQL(bodyText) {
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

        // Извлечение информации о пине
        function extractPinInfo(url, body) {
            let pinId = null;
            let action = 'unknown';

            // Извлекаем из URL
            const pinMatch = url.match(/pin\/([^/?]+)/);
            if (pinMatch) pinId = pinMatch[1];

            // Определяем действие
            if (url.includes('/create') || url.includes('/save')) {
                action = 'create';
            } else if (url.includes('/edit')) {
                action = 'edit';
            } else if (url.includes('/delete')) {
                action = 'delete';
            } else if (url.includes('/like')) {
                action = 'like';
            } else if (url.includes('/repin')) {
                action = 'repin';
            } else if (pinId) {
                action = 'view';
            }

            // Пробуем извлечь из тела
            try {
                if (body) {
                    const parsed = JSON.parse(body);
                    if (parsed.pinId) pinId = parsed.pinId;
                    if (parsed.id) pinId = parsed.id;
                }
            } catch (e) {
                // Игнорируем ошибки парсинга
            }

            return { pinId: pinId, action: action };
        }

        function extractPinFromResponse(responseText) {
            try {
                const parsed = JSON.parse(responseText);
                return {
                    id: parsed.id || parsed.pinId,
                    description: parsed.description || parsed.title,
                    imageUrl: parsed.imageUrl || parsed.images?.original?.url,
                    boardId: parsed.boardId,
                    creatorId: parsed.creatorId
                };
            } catch (e) {
                return null;
            }
        }

        // Извлечение информации о доске
        function extractBoardInfo(url, body) {
            let type = 'unknown';
            let boardId = null;
            let boardName = null;

            if (url.includes('/create')) {
                type = 'create';
            } else if (url.includes('/edit')) {
                type = 'edit';
            } else if (url.includes('/delete')) {
                type = 'delete';
            } else if (url.includes('/follow')) {
                type = 'follow';
            } else {
                type = 'view';
            }

            // Извлекаем из URL
            const boardMatch = url.match(/board\/([^/?]+)/);
            if (boardMatch) boardId = boardMatch[1];

            return { type: type, boardId: boardId, boardName: boardName };
        }

        // Извлечение поисковой информации
        function extractSearchInfo(url, body) {
            let query = null;
            let type = 'search';

            try {
                const urlObj = new URL(url, window.location.origin);
                query = urlObj.searchParams.get('q') || urlObj.searchParams.get('query');
                
                if (url.includes('typeahead')) {
                    type = 'suggestions';
                } else if (url.includes('related')) {
                    type = 'related';
                }

                // Пробуем из тела
                if (body) {
                    const parsed = typeof body === 'string' ? JSON.parse(body) : body;
                    if (parsed.query) query = parsed.query;
                }
            } catch (e) {
                // Игнорируем ошибки парсинга
            }

            return { query: query, type: type };
        }

        function extractSearchResultCount(responseText) {
            try {
                const parsed = JSON.parse(responseText);
                return parsed.data?.length || parsed.results?.length || 0;
            } catch (e) {
                return 0;
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

    // 2. XHR перехват для Pinterest
    function setupMemorySafeXHRInterception() {
        console.group('🌐 PINTEREST MEMORY-SAFE XHR INTERCEPTION');

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

            // Определяем тип запроса Pinterest
            if (typeof url === 'string') {
                data.isGraphQL = url.includes('/graphql') || url.includes('/gql/');
                data.isPinAPI = url.includes('/pin/') || url.includes('/resource/PinResource');
                data.isBoardAPI = url.includes('/board/') || url.includes('/resource/BoardResource');
                data.isSearchAPI = url.includes('/search/') || url.includes('/typeahead');
                data.isImageAPI = url.includes('/upload') || url.includes('/image');
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
                                const graphqlInfo = parsePinterestGraphQL(body);
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

                        // Обработка пин-запросов
                        if (data.isPinAPI) {
                            const pinInfo = extractPinInfo(data.url, body);
                            securityAnalysis.addPinRequest(data.id, {
                                url: data.url,
                                timestamp: data.timestamp,
                                method: data.method,
                                pinId: pinInfo.pinId,
                                action: pinInfo.action
                            });
                        }

                        // Обработка досок
                        if (data.isBoardAPI) {
                            const boardInfo = extractBoardInfo(data.url, body);
                            securityAnalysis.addBoardRequest(data.id, {
                                url: data.url,
                                timestamp: data.timestamp,
                                method: data.method,
                                type: boardInfo.type,
                                boardId: boardInfo.boardId
                            });
                        }

                        // Обработка поиска
                        if (data.isSearchAPI) {
                            const searchInfo = extractSearchInfo(data.url, body);
                            securityAnalysis.addSearchRequest(data.id, {
                                url: data.url,
                                timestamp: data.timestamp,
                                method: data.method,
                                query: searchInfo.query,
                                type: searchInfo.type
                            });
                        }
                    } else if (body instanceof Blob) {
                        data.requestBody = `[Blob: ${body.size} bytes]`;
                        data.size = body.size;

                        if (data.isImageAPI) {
                            securityAnalysis.addImageRequest(data.id, {
                                url: data.url,
                                timestamp: data.timestamp,
                                method: data.method,
                                size: body.size,
                                type: 'image_upload'
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

            // Анализ заголовков Pinterest
            analyzePinterestHeaders(data.headers, data, 'request');

            // Безопасное добавление запроса
            securityAnalysis.addRequest(data);

            console.log(`📡 Pinterest XHR: ${data.method} ${data.url}`, {
                type: data.isGraphQL ? 'GraphQL' : 
                      (data.isPinAPI ? 'Pin' : 'Regular'),
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

                        if (data.isPinAPI) {
                            const pinData = securityAnalysis.network.pinRequests.get(data.id);
                            if (pinData) {
                                pinData.responseSize = this.responseText.length;
                                pinData.duration = data.duration;
                                pinData.success = this.status === 200;
                            }
                        }

                        data.size += this.responseText.length;
                    }
                } catch (e) {
                    data.responseBody = '[Failed to read response]';
                }

                analyzePinterestHeaders(this.getAllResponseHeaders(), data, 'response');

                console.log(`📦 Pinterest XHR Response: ${this.status} ${data.url}`, {
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

    // 3. Анализ Pinterest-специфичных заголовков
    function analyzePinterestHeaders(headers, requestData, type) {
        const pinterestSecurityHeaders = ['x-pinterest-app', 'x-pinterest-device', 'x-pinterest-visitor', 'x-client-id'];
        const pinterestAuthHeaders = ['authorization', 'x-csrf-token', 'x-pinterest-token', 'cookie'];
        const pinterestTrackingHeaders = ['x-pinterest-track', 'x-request-id', 'x-pinterest-session'];

        if (type === 'request') {
            requestData.pinterestSecurityHeaders = {};
            requestData.pinterestAuthHeaders = {};
            requestData.pinterestTrackingHeaders = {};

            Object.entries(headers || {}).forEach(([key, value]) => {
                const lowerKey = key.toLowerCase();

                if (pinterestSecurityHeaders.some(h => lowerKey.includes(h))) {
                    requestData.pinterestSecurityHeaders[key] = String(value).substring(0, 200);
                    
                    // Сохраняем важные security headers
                    if (key === 'x-pinterest-visitor') {
                        securityAnalysis.session.visitorId = value;
                    }
                    if (key === 'x-pinterest-device') {
                        securityAnalysis.session.deviceId = value;
                    }
                }

                if (pinterestAuthHeaders.some(h => lowerKey.includes(h))) {
                    requestData.pinterestAuthHeaders[key] = String(value).substring(0, 200);

                    // Сохраняем токены
                    if (key === 'x-csrf-token') {
                        securityAnalysis.session.csrfToken = value;
                        securityAnalysis.security.csrfTokens[requestData.timestamp] = value;
                    }
                    if (key === 'x-pinterest-token') {
                        securityAnalysis.security.pinterestTokens[requestData.timestamp] = value.substring(0, 50);
                    }
                    if (key === 'authorization' && value.includes('Bearer')) {
                        const token = value.replace('Bearer ', '').substring(0, 50);
                        securityAnalysis.security.pinterestTokens[requestData.timestamp] = token;
                    }

                    securityAnalysis.addAuthFlow({
                        type: `pinterest_${type}_header`,
                        header: key,
                        value: String(value).substring(0, 100),
                        timestamp: requestData.timestamp,
                        requestId: requestData.id
                    });
                }

                if (pinterestTrackingHeaders.some(h => lowerKey.includes(h))) {
                    requestData.pinterestTrackingHeaders[key] = String(value).substring(0, 200);
                }
            });

            // Анализ cookies для сессионных данных
            if (headers?.cookie) {
                const cookieData = analyzePinterestCookies(headers.cookie);
                if (cookieData.session_id) {
                    securityAnalysis.session.sessionId = cookieData.session_id;
                }
                if (cookieData.user_id) {
                    securityAnalysis.session.userId = cookieData.user_id;
                }
                if (cookieData.csrf_token) {
                    securityAnalysis.session.csrfToken = cookieData.csrf_token;
                }
                if (cookieData.visitor_id) {
                    securityAnalysis.session.visitorId = cookieData.visitor_id;
                }
            }
        }
    }

    // 4. Анализ Pinterest cookies
    function analyzePinterestCookies(cookieHeader) {
        const cookies = {};
        const sessionMatch = cookieHeader.match(/session_id=([^;]+)/);
        const userMatch = cookieHeader.match(/user_id=([^;]+)/);
        const csrfMatch = cookieHeader.match(/csrf_token=([^;]+)/);
        const visitorMatch = cookieHeader.match(/visitor_id=([^;]+)/);

        if (sessionMatch) cookies.session_id = sessionMatch[1];
        if (userMatch) cookies.user_id = userMatch[1];
        if (csrfMatch) cookies.csrf_token = csrfMatch[1];
        if (visitorMatch) cookies.visitor_id = visitorMatch[1];

        return cookies;
    }

    // 5. Мониторинг пин-элементов Pinterest
    function setupPinElementMonitoring() {
        console.group('📌 PINTEREST PIN ELEMENT MONITORING');

        // Наблюдатель за пин-элементами
        const pinObserver = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === 1) { // Element node
                        // Поиск пинов
                        const pinSelectors = [
                            '[data-test-id="pin"]',
                            '[data-test-pin-id]',
                            '.Pin',
                            '.pin',
                            '[data-pin-id]',
                            'div[role="listitem"]'
                        ];

                        pinSelectors.forEach(selector => {
                            const elements = node.querySelectorAll ? node.querySelectorAll(selector) : [];
                            elements.forEach(element => {
                                const pinId = element.getAttribute('data-pin-id') || 
                                            element.getAttribute('data-test-pin-id') ||
                                            generatePinId();
                                
                                if (pinId && !securityAnalysis.dom.pinElements.has(pinId)) {
                                    securityAnalysis.dom.pinElements.add(pinId);
                                    
                                    const pinData = {
                                        id: pinId,
                                        element: element,
                                        timestamp: new Date().toISOString(),
                                        interactions: []
                                    };

                                    // Мониторинг взаимодействий
                                    const interactionHandlers = {
                                        'save': '[data-test-id="save-button"]',
                                        'like': '[data-test-id="like-button"]',
                                        'share': '[data-test-id="share-button"]',
                                        'comment': '[data-test-id="comment-button"]',
                                        'closeup': '[data-test-id="closeup-button"]'
                                    };

                                    Object.entries(interactionHandlers).forEach(([type, selector]) => {
                                        const button = element.querySelector(selector);
                                        if (button) {
                                            button.addEventListener('click', (e) => {
                                                pinData.interactions.push({
                                                    type: type,
                                                    timestamp: new Date().toISOString()
                                                });

                                                securityAnalysis.addDOMEvent({
                                                    type: `pin_${type}`,
                                                    timestamp: new Date().toISOString(),
                                                    pinId: pinId,
                                                    coordinates: { x: e.clientX, y: e.clientY }
                                                });

                                                if (pinData.interactions.length > 20) {
                                                    pinData.interactions.shift();
                                                }

                                                console.log(`📌 Pin ${type}: ${pinId}`);
                                            });
                                        }
                                    });

                                    // Общий клик по пину
                                    element.addEventListener('click', (e) => {
                                        securityAnalysis.addDOMEvent({
                                            type: 'pin_click',
                                            timestamp: new Date().toISOString(),
                                            pinId: pinId
                                        });
                                    });

                                    console.log(`📌 Pinterest Pin Element: ${pinId}`);
                                }
                            });
                        });

                        // Поиск досок
                        const boardSelectors = [
                            '[data-test-id="board"]',
                            '.Board',
                            '.board',
                            '[data-board-id]'
                        ];

                        boardSelectors.forEach(selector => {
                            const elements = node.querySelectorAll ? node.querySelectorAll(selector) : [];
                            elements.forEach(element => {
                                const boardId = element.getAttribute('data-board-id') || generateBoardId();
                                if (!securityAnalysis.dom.boardElements.has(boardId)) {
                                    securityAnalysis.dom.boardElements.add(boardId);
                                    
                                    element.addEventListener('click', (e) => {
                                        securityAnalysis.addDOMEvent({
                                            type: 'board_click',
                                            timestamp: new Date().toISOString(),
                                            boardId: boardId
                                        });
                                    });
                                }
                            });
                        });

                        // Мониторинг изображений
                        const imageSelectors = [
                            '[data-test-id="pin-image"]',
                            '.PinImage',
                            'img[src*="pinimg.com"]'
                        ];

                        imageSelectors.forEach(selector => {
                            const elements = node.querySelectorAll ? node.querySelectorAll(selector) : [];
                            elements.forEach(element => {
                                const imageId = generateImageId();
                                if (!securityAnalysis.dom.imageElements.has(imageId)) {
                                    securityAnalysis.dom.imageElements.add(imageId);
                                    
                                    const imageData = {
                                        id: imageId,
                                        element: element,
                                        src: element.src,
                                        timestamp: new Date().toISOString()
                                    };

                                    // Отслеживание загрузки изображений
                                    element.addEventListener('load', () => {
                                        securityAnalysis.addDOMEvent({
                                            type: 'image_load',
                                            timestamp: new Date().toISOString(),
                                            imageId: imageId,
                                            src: element.src
                                        });
                                    });

                                    element.addEventListener('error', () => {
                                        securityAnalysis.addDOMEvent({
                                            type: 'image_error',
                                            timestamp: new Date().toISOString(),
                                            imageId: imageId
                                        });
                                    });
                                }
                            });
                        });

                        // Мониторинг поискового ввода
                        const searchInputs = node.querySelectorAll ? 
                            node.querySelectorAll('[data-test-id="search-box-input"], input[placeholder*="Search"]') : [];
                        searchInputs.forEach(input => {
                            input.addEventListener('input', (e) => {
                                if (e.target.value.length > 2) {
                                    securityAnalysis.addDOMEvent({
                                        type: 'search_input',
                                        timestamp: new Date().toISOString(),
                                        query: e.target.value
                                    });
                                }
                            });
                        });
                    }
                });
            });
        });

        pinObserver.observe(document.body, {
            childList: true,
            subtree: true
        });

        function generatePinId() {
            return `pin_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        }

        function generateBoardId() {
            return `board_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        }

        function generateImageId() {
            return `image_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        }

        console.groupEnd();
        return () => pinObserver.disconnect();
    }

    // 6. Performance Observer для Pinterest
    function setupSafePerformanceObserver() {
        console.group('⏱️ PINTEREST PERFORMANCE OBSERVER');

        try {
            const perfObserver = new PerformanceObserver((list) => {
                list.getEntries().forEach(entry => {
                    // Особый интерес представляют изображения пинов и API вызовы
                    if (entry.name.includes('pinimg.com') || entry.name.includes('pinterest') || 
                        entry.name.includes('/graphql') || entry.initiatorType === 'xmlhttprequest') {
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
            console.log('✅ Pinterest Performance Observer started');
            return perfObserver;
        } catch (e) {
            console.log('❌ Pinterest Performance Observer failed:', e);
            return null;
        }

        console.groupEnd();
    }

    // 7. Система управления жизненным циклом
    function setupLifecycleManagement() {
        console.group('🔧 PINTEREST LIFECYCLE MANAGEMENT');

        let cleanupCallbacks = [];
        let intervals = [];

        window.stopPinterestAnalysis = function() {
            console.log('🛑 Stopping Pinterest Security Analysis...');

            intervals.forEach(clearInterval);
            intervals = [];

            cleanupCallbacks.forEach(callback => {
                try {
                    callback();
                } catch (e) {
                    console.log('Pinterest cleanup error:', e);
                }
            });
            cleanupCallbacks = [];

            securityAnalysis.clearAll();

            console.log('✅ Pinterest Security Analysis stopped completely');
        };

        const autoStopTimeout = setTimeout(() => {
            console.warn(`⏰ Auto-stopping Pinterest analysis after ${CONFIG.autoStopMinutes} minutes`);
            window.stopPinterestAnalysis();
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

    // 8. Инициализация Pinterest мониторинга
    function startPinterestAnalysis() {
        console.log('🚀 STARTING PINTEREST MEMORY-SAFE SECURITY ANALYSIS...');

        const lifecycle = setupLifecycleManagement();

        setupMemorySafeFetchInterception();

        const xhrCleanup = setupMemorySafeXHRInterception();
        if (xhrCleanup) lifecycle.registerCleanup(xhrCleanup);

        const perfObserver = setupSafePerformanceObserver();
        if (perfObserver) lifecycle.registerCleanup(() => perfObserver.disconnect());

        const pinCleanup = setupPinElementMonitoring();
        if (pinCleanup) lifecycle.registerCleanup(pinCleanup);

        // Периодический сбор статистики
        const statsInterval = setInterval(() => {
            const stats = {
                requests: securityAnalysis.network.requests.length,
                graphqlQueries: securityAnalysis.network.graphqlQueries.size,
                pinRequests: securityAnalysis.network.pinRequests.size,
                boardRequests: securityAnalysis.network.boardRequests.size,
                searchRequests: securityAnalysis.network.searchRequests.size,
                imageRequests: securityAnalysis.network.imageRequests.size,
                pinElements: securityAnalysis.dom.pinElements.size,
                boardElements: securityAnalysis.dom.boardElements.size,
                imageElements: securityAnalysis.dom.imageElements.size,
                websockets: securityAnalysis.network.websockets.length,
                domEvents: securityAnalysis.dom.events.length,
                authFlows: securityAnalysis.security.authFlows.length,
                perfEntries: securityAnalysis.timing.performanceEntries.length,
                memory: Math.round(performance.memory?.usedJSHeapSize / 1048576) || 'N/A'
            };

            console.log('📈 Pinterest Memory-Safe Stats:', stats);

            if (performance.memory && performance.memory.usedJSHeapSize > 500 * 1048576) {
                console.warn('🚨 High memory usage detected, clearing old data');
                securityAnalysis.clearAll();
            }
        }, 15000);

        lifecycle.registerInterval(statsInterval);

        setupPinterestCommands();

        console.log('✅ PINTEREST MEMORY-SAFE SECURITY ANALYSIS ACTIVE!');
        console.log('💡 Available commands:');
        console.log('💡 stopPinterestAnalysis() - Complete shutdown');
        console.log('💡 getPinterestMemoryStats() - Current memory usage');
        console.log('💡 getGraphQLQueries() - View GraphQL operations');
        console.log('💡 getPinActivity() - View pin interactions');
        console.log('💡 getSearchHistory() - View search queries');
        console.log('💡 getSessionInfo() - View session data');
    }

    // Команды для Pinterest анализа
    function setupPinterestCommands() {
        window.getPinterestMemoryStats = function() {
            const stats = {
                requests: securityAnalysis.network.requests.length,
                graphqlQueries: securityAnalysis.network.graphqlQueries.size,
                pinRequests: securityAnalysis.network.pinRequests.size,
                boardRequests: securityAnalysis.network.boardRequests.size,
                searchRequests: securityAnalysis.network.searchRequests.size,
                imageRequests: securityAnalysis.network.imageRequests.size,
                pinElements: securityAnalysis.dom.pinElements.size,
                boardElements: securityAnalysis.dom.boardElements.size,
                imageElements: securityAnalysis.dom.imageElements.size,
                websockets: securityAnalysis.network.websockets.length,
                domEvents: securityAnalysis.dom.events.length,
                authFlows: securityAnalysis.security.authFlows.length,
                perfEntries: securityAnalysis.timing.performanceEntries.length,
                session: {
                    userId: securityAnalysis.session.userId,
                    sessionId: securityAnalysis.session.sessionId,
                    visitorId: securityAnalysis.session.visitorId,
                    deviceId: securityAnalysis.session.deviceId
                }
            };

            if (performance.memory) {
                stats.memoryMB = Math.round(performance.memory.usedJSHeapSize / 1048576);
                stats.memoryLimitMB = Math.round(performance.memory.jsHeapSizeLimit / 1048576);
            }

            console.log('💾 Pinterest Memory Statistics:', stats);
            return stats;
        };

        window.clearPinterestData = function() {
            securityAnalysis.clearAll();
            console.log('🧹 Pinterest data cleared');
        };

        window.getGraphQLQueries = function() {
            const queries = Array.from(securityAnalysis.network.graphqlQueries.entries());
            console.log('🕸️ GraphQL Queries:', queries);
            return queries;
        };

        window.getPinActivity = function() {
            const pinData = {
                pinRequests: Array.from(securityAnalysis.network.pinRequests.entries()),
                boardRequests: Array.from(securityAnalysis.network.boardRequests.entries()),
                pinElements: Array.from(securityAnalysis.dom.pinElements),
                interactions: securityAnalysis.dom.events.filter(e => e.type.includes('pin_'))
            };
            console.log('📌 Pin Activity:', pinData);
            return pinData;
        };

        window.getSearchHistory = function() {
            const searches = Array.from(securityAnalysis.network.searchRequests.entries());
            console.log('🔍 Search History:', searches);
            return searches;
        };

        window.getSessionInfo = function() {
            console.log('👤 Pinterest Session:', securityAnalysis.session);
            return securityAnalysis.session;
        };

        window.getImageActivity = function() {
            const imageData = {
                imageRequests: Array.from(securityAnalysis.network.imageRequests.entries()),
                imageElements: Array.from(securityAnalysis.dom.imageElements),
                imageEvents: securityAnalysis.dom.events.filter(e => e.type.includes('image_'))
            };
            console.log('🖼️ Image Activity:', imageData);
            return imageData;
        };
    }

    // Запуск анализа Pinterest
    startPinterestAnalysis();

})();