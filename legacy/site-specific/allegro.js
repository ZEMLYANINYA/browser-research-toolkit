(function() {
    'use strict';

    console.log('🛡️ Starting Allegro Memory-Safe Security Analysis...');

    // Конфигурация с лимитами для Allegro
    const CONFIG = {
        maxBodySize: 10000,
        maxGraphQLSize: 50000, // 50KB для GraphQL
        maxProductDataSize: 100000, // 100KB для данных товаров
        maxRequests: 1000,
        maxBatches: 100,
        maxWebSockets: 50,
        maxDomEvents: 500,
        maxPerfEntries: 200,
        maxAuthFlows: 500,
        maxProductRequests: 300,
        maxCartRequests: 200,
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
            allegroConstants: {},
            userId: null,
            sessionId: null,
            csrfToken: null,
            clientId: null,
            deviceId: null
        },
        network: {
            requests: [],
            websockets: [],
            endpoints: new Map(),
            graphqlQueries: new Map(),
            productRequests: new Map(),
            cartRequests: new Map(),
            searchRequests: new Map(),
            orderRequests: new Map(),
            userRequests: new Map(),
            auctionRequests: new Map()
        },
        security: {
            headers: {},
            allegroAuth: {},
            authFlows: [],
            csrfTokens: {},
            allegroTokens: {}
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
            productElements: new Set(),
            cartElements: new Set(),
            auctionElements: new Set()
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

        addProductRequest: function(id, productData) {
            this.network.productRequests.set(id, productData);
            if (this.network.productRequests.size > CONFIG.maxProductRequests) {
                const firstKey = this.network.productRequests.keys().next().value;
                this.network.productRequests.delete(firstKey);
            }
        },

        addCartRequest: function(id, cartData) {
            this.network.cartRequests.set(id, cartData);
            if (this.network.cartRequests.size > CONFIG.maxCartRequests) {
                const firstKey = this.network.cartRequests.keys().next().value;
                this.network.cartRequests.delete(firstKey);
            }
        },

        addSearchRequest: function(id, searchData) {
            this.network.searchRequests.set(id, searchData);
            if (this.network.searchRequests.size > CONFIG.maxSearchRequests) {
                const firstKey = this.network.searchRequests.keys().next().value;
                this.network.searchRequests.delete(firstKey);
            }
        },

        addOrderRequest: function(id, orderData) {
            this.network.orderRequests.set(id, orderData);
            if (this.network.orderRequests.size > CONFIG.maxBatches) {
                const firstKey = this.network.orderRequests.keys().next().value;
                this.network.orderRequests.delete(firstKey);
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
            this.network.productRequests.clear();
            this.network.cartRequests.clear();
            this.network.searchRequests.clear();
            this.network.orderRequests.clear();
            this.network.userRequests.clear();
            this.network.auctionRequests.clear();
            this.network.endpoints.clear();
            this.dom.events = [];
            this.dom.currentXHRs.clear();
            this.dom.productElements.clear();
            this.dom.cartElements.clear();
            this.dom.auctionElements.clear();
            this.security.authFlows = [];
            this.timing.performanceEntries = [];
            this.timing.events = [];
            this.timing.startTime = Date.now();
        }
    };

    // 1. Перехват Fetch с обработкой Allegro API
    function setupMemorySafeFetchInterception() {
        console.group('🌐 ALLEGRO MEMORY-SAFE FETCH INTERCEPTION');

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
                isProductAPI: false,
                isCartAPI: false,
                isSearchAPI: false,
                isOrderAPI: false,
                isUserAPI: false,
                isAuctionAPI: false,
                isAuthentication: false
            };

            // Определяем тип запроса Allegro
            if (typeof url === 'string') {
                requestData.isGraphQL = url.includes('/graphql') || url.includes('/gql/');
                requestData.isProductAPI = url.includes('/products/') || url.includes('/offers/') || 
                                         url.includes('/listing') || url.includes('/items/');
                requestData.isCartAPI = url.includes('/cart/') || url.includes('/basket/') || 
                                      url.includes('/checkout/') || url.includes('/order/');
                requestData.isSearchAPI = url.includes('/search/') || url.includes('/query') || 
                                        url.includes('/suggestions');
                requestData.isOrderAPI = url.includes('/orders/') || url.includes('/purchases/') || 
                                       url.includes('/transactions/');
                requestData.isUserAPI = url.includes('/users/') || url.includes('/account/') || 
                                      url.includes('/profile/');
                requestData.isAuctionAPI = url.includes('/auctions/') || url.includes('/bids/');
                requestData.isAuthentication = url.includes('/auth/') || url.includes('/login') || 
                                             url.includes('/oauth') || url.includes('/token');
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
                        // Для товарных изображений сохраняем только метаданные
                        if (args[1].body.type.includes('image')) {
                            requestData.requestBody = `[Product Image: ${args[1].body.size} bytes, type: ${args[1].body.type}]`;
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

            // Обработка GraphQL запросов Allegro
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
                        const graphqlInfo = parseAllegroGraphQL(bodyText);
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

            // Обработка товарных запросов
            if (requestData.isProductAPI && args[1]?.body) {
                try {
                    const bodyText = await cloneAndReadBody(args[1].body);
                    if (bodyText.length > CONFIG.maxProductDataSize) {
                        requestData.requestBody = `[Product API TOO_LARGE: ${bodyText.length} bytes]`;
                        requestData.requestBodyBase64 = 'TOO_LARGE';
                    } else {
                        requestData.requestBodyBase64 = btoa(unescape(encodeURIComponent(bodyText)));
                        requestData.requestBody = `Product API (base64): ${requestData.requestBodyBase64.substring(0, 200)}...`;
                    }
                    requestData.size = bodyText.length;

                    // Извлекаем информацию о товаре
                    const productInfo = extractProductInfo(requestData.url, bodyText);
                    requestData.productId = productInfo.productId;
                    requestData.offerId = productInfo.offerId;

                    // Сохраняем товарный запрос
                    securityAnalysis.addProductRequest(requestId, {
                        url: url,
                        requestBodyBase64: requestData.requestBodyBase64,
                        productId: requestData.productId,
                        offerId: requestData.offerId,
                        timestamp: requestData.timestamp,
                        size: bodyText.length,
                        type: 'fetch',
                        method: requestData.method
                    });
                } catch (e) {
                    requestData.requestBody = '[Failed to read product API body]';
                }
            }

            // Обработка корзины
            if (requestData.isCartAPI) {
                const cartInfo = extractCartInfo(requestData.url, requestData.requestBody);
                securityAnalysis.addCartRequest(requestId, {
                    url: url,
                    timestamp: requestData.timestamp,
                    method: requestData.method,
                    type: cartInfo.type,
                    productId: cartInfo.productId,
                    quantity: cartInfo.quantity,
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
                    filters: searchInfo.filters,
                    size: requestData.size
                });
            }

            // Обработка заказов
            if (requestData.isOrderAPI) {
                const orderInfo = extractOrderInfo(requestData.url, requestData.requestBody);
                securityAnalysis.addOrderRequest(requestId, {
                    url: url,
                    timestamp: requestData.timestamp,
                    method: requestData.method,
                    type: orderInfo.type,
                    orderId: orderInfo.orderId,
                    size: requestData.size
                });
            }

            // Анализ Allegro-специфичных заголовков
            analyzeAllegroHeaders(args[1]?.headers, requestData, 'request');

            // Безопасное добавление запроса
            securityAnalysis.addRequest(requestData);

            console.log(`📡 Allegro Fetch: ${requestData.method} ${url}`, {
                type: requestData.isGraphQL ? 'GraphQL' : 
                      (requestData.isProductAPI ? 'Product' : 
                      (requestData.isCartAPI ? 'Cart' : 
                      (requestData.isSearchAPI ? 'Search' : 
                      (requestData.isOrderAPI ? 'Order' : 
                      (requestData.isUserAPI ? 'User' : 
                      (requestData.isAuctionAPI ? 'Auction' : 'Regular')))))),
                operation: requestData.graphqlOperation,
                productId: requestData.productId,
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

                    // Для товарных ответов
                    if (requestData.isProductAPI) {
                        const productData = securityAnalysis.network.productRequests.get(requestId);
                        if (productData) {
                            productData.responseSize = text.length;
                            productData.duration = requestData.duration;
                            productData.success = response.status === 200;
                            
                            // Извлекаем данные товара из ответа
                            const productInfo = extractProductFromResponse(text);
                            if (productInfo) {
                                productData.productData = productInfo;
                            }
                        }
                    }

                    // Для корзины
                    if (requestData.isCartAPI) {
                        const cartData = securityAnalysis.network.cartRequests.get(requestId);
                        if (cartData) {
                            cartData.responseSize = text.length;
                            cartData.duration = requestData.duration;
                            cartData.success = response.status === 200;
                        }
                    }

                    requestData.size += text.length;
                } catch (e) {
                    requestData.responseBody = '[Failed to read response body]';
                }

                analyzeAllegroHeaders(requestData.responseHeaders, requestData, 'response');

                console.log(`📦 Allegro Response: ${response.status} ${url}`, {
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

        // Парсер GraphQL запросов Allegro
        function parseAllegroGraphQL(bodyText) {
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

        // Извлечение информации о товаре
        function extractProductInfo(url, body) {
            let productId = null;
            let offerId = null;

            // Извлекаем из URL
            const productMatch = url.match(/products\/([^/?]+)/);
            const offerMatch = url.match(/offers\/([^/?]+)/);
            
            if (productMatch) productId = productMatch[1];
            if (offerMatch) offerId = offerMatch[1];

            // Пробуем извлечь из тела
            try {
                if (body) {
                    const parsed = JSON.parse(body);
                    if (parsed.productId) productId = parsed.productId;
                    if (parsed.offerId) offerId = parsed.offerId;
                }
            } catch (e) {
                // Игнорируем ошибки парсинга
            }

            return { productId: productId, offerId: offerId };
        }

        function extractProductFromResponse(responseText) {
            try {
                const parsed = JSON.parse(responseText);
                return {
                    name: parsed.name || parsed.title,
                    price: parsed.price || parsed.sellingMode?.price?.amount,
                    currency: parsed.currency || parsed.sellingMode?.price?.currency,
                    available: parsed.available || parsed.stock?.available
                };
            } catch (e) {
                return null;
            }
        }

        // Извлечение информации о корзине
        function extractCartInfo(url, body) {
            let type = 'unknown';
            let productId = null;
            let quantity = 1;

            if (url.includes('add') || url.includes('put')) {
                type = 'add';
            } else if (url.includes('remove') || url.includes('delete')) {
                type = 'remove';
            } else if (url.includes('update')) {
                type = 'update';
            } else if (url.includes('get') || url.includes('view')) {
                type = 'view';
            }

            // Пробуем извлечь из тела
            try {
                if (body) {
                    const parsed = typeof body === 'string' ? JSON.parse(body) : body;
                    if (parsed.productId) productId = parsed.productId;
                    if (parsed.offerId) productId = parsed.offerId;
                    if (parsed.quantity) quantity = parsed.quantity;
                }
            } catch (e) {
                // Игнорируем ошибки парсинга
            }

            return { type: type, productId: productId, quantity: quantity };
        }

        // Извлечение поисковой информации
        function extractSearchInfo(url, body) {
            let query = null;
            let filters = {};

            try {
                const urlObj = new URL(url, window.location.origin);
                query = urlObj.searchParams.get('q') || urlObj.searchParams.get('query') || urlObj.searchParams.get('string');
                
                // Извлекаем фильтры
                urlObj.searchParams.forEach((value, key) => {
                    if (key.includes('filter') || key.includes('param')) {
                        filters[key] = value;
                    }
                });

                // Пробуем из тела
                if (body) {
                    const parsed = typeof body === 'string' ? JSON.parse(body) : body;
                    if (parsed.query) query = parsed.query;
                    if (parsed.filters) filters = { ...filters, ...parsed.filters };
                }
            } catch (e) {
                // Игнорируем ошибки парсинга
            }

            return { query: query, filters: filters };
        }

        // Извлечение информации о заказе
        function extractOrderInfo(url, body) {
            let type = 'unknown';
            let orderId = null;

            if (url.includes('create') || url.includes('add')) {
                type = 'create';
            } else if (url.includes('update')) {
                type = 'update';
            } else if (url.includes('cancel')) {
                type = 'cancel';
            } else if (url.includes('get') || url.includes('view')) {
                type = 'view';
            }

            // Извлекаем orderId из URL
            const orderMatch = url.match(/orders\/([^/?]+)/);
            if (orderMatch) orderId = orderMatch[1];

            return { type: type, orderId: orderId };
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

    // 2. XHR перехват для Allegro
    function setupMemorySafeXHRInterception() {
        console.group('🌐 ALLEGRO MEMORY-SAFE XHR INTERCEPTION');

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

            // Определяем тип запроса Allegro
            if (typeof url === 'string') {
                data.isGraphQL = url.includes('/graphql') || url.includes('/gql/');
                data.isProductAPI = url.includes('/products/') || url.includes('/offers/');
                data.isCartAPI = url.includes('/cart/') || url.includes('/basket/');
                data.isSearchAPI = url.includes('/search/') || url.includes('/query');
                data.isOrderAPI = url.includes('/orders/') || url.includes('/purchases/');
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
                                const graphqlInfo = parseAllegroGraphQL(body);
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

                        // Обработка товарных запросов
                        if (data.isProductAPI) {
                            const productInfo = extractProductInfo(data.url, body);
                            securityAnalysis.addProductRequest(data.id, {
                                url: data.url,
                                timestamp: data.timestamp,
                                method: data.method,
                                productId: productInfo.productId,
                                offerId: productInfo.offerId
                            });
                        }

                        // Обработка корзины
                        if (data.isCartAPI) {
                            const cartInfo = extractCartInfo(data.url, body);
                            securityAnalysis.addCartRequest(data.id, {
                                url: data.url,
                                timestamp: data.timestamp,
                                method: data.method,
                                type: cartInfo.type,
                                productId: cartInfo.productId,
                                quantity: cartInfo.quantity
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
                                filters: searchInfo.filters
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

            // Анализ заголовков Allegro
            analyzeAllegroHeaders(data.headers, data, 'request');

            // Безопасное добавление запроса
            securityAnalysis.addRequest(data);

            console.log(`📡 Allegro XHR: ${data.method} ${data.url}`, {
                type: data.isGraphQL ? 'GraphQL' : 
                      (data.isProductAPI ? 'Product' : 'Regular'),
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

                        if (data.isProductAPI) {
                            const productData = securityAnalysis.network.productRequests.get(data.id);
                            if (productData) {
                                productData.responseSize = this.responseText.length;
                                productData.duration = data.duration;
                                productData.success = this.status === 200;
                            }
                        }

                        data.size += this.responseText.length;
                    }
                } catch (e) {
                    data.responseBody = '[Failed to read response]';
                }

                analyzeAllegroHeaders(this.getAllResponseHeaders(), data, 'response');

                console.log(`📦 Allegro XHR Response: ${this.status} ${data.url}`, {
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

    // 3. Анализ Allegro-специфичных заголовков
    function analyzeAllegroHeaders(headers, requestData, type) {
        const allegroSecurityHeaders = ['x-allegro-app', 'x-allegro-client', 'x-allegro-device', 'x-client-id'];
        const allegroAuthHeaders = ['authorization', 'x-csrf-token', 'x-allegro-token', 'cookie'];
        const allegroTrackingHeaders = ['x-allegro-track', 'x-request-id', 'x-requested-with'];

        if (type === 'request') {
            requestData.allegroSecurityHeaders = {};
            requestData.allegroAuthHeaders = {};
            requestData.allegroTrackingHeaders = {};

            Object.entries(headers || {}).forEach(([key, value]) => {
                const lowerKey = key.toLowerCase();

                if (allegroSecurityHeaders.some(h => lowerKey.includes(h))) {
                    requestData.allegroSecurityHeaders[key] = String(value).substring(0, 200);
                    
                    // Сохраняем важные security headers
                    if (key === 'x-client-id') {
                        securityAnalysis.session.clientId = value;
                    }
                    if (key === 'x-allegro-device') {
                        securityAnalysis.session.deviceId = value;
                    }
                }

                if (allegroAuthHeaders.some(h => lowerKey.includes(h))) {
                    requestData.allegroAuthHeaders[key] = String(value).substring(0, 200);

                    // Сохраняем токены
                    if (key === 'x-csrf-token') {
                        securityAnalysis.session.csrfToken = value;
                        securityAnalysis.security.csrfTokens[requestData.timestamp] = value;
                    }
                    if (key === 'x-allegro-token') {
                        securityAnalysis.security.allegroTokens[requestData.timestamp] = value.substring(0, 50);
                    }
                    if (key === 'authorization' && value.includes('Bearer')) {
                        const token = value.replace('Bearer ', '').substring(0, 50);
                        securityAnalysis.security.allegroTokens[requestData.timestamp] = token;
                    }

                    securityAnalysis.addAuthFlow({
                        type: `allegro_${type}_header`,
                        header: key,
                        value: String(value).substring(0, 100),
                        timestamp: requestData.timestamp,
                        requestId: requestData.id
                    });
                }

                if (allegroTrackingHeaders.some(h => lowerKey.includes(h))) {
                    requestData.allegroTrackingHeaders[key] = String(value).substring(0, 200);
                }
            });

            // Анализ cookies для сессионных данных
            if (headers?.cookie) {
                const cookieData = analyzeAllegroCookies(headers.cookie);
                if (cookieData.session_id) {
                    securityAnalysis.session.sessionId = cookieData.session_id;
                }
                if (cookieData.user_id) {
                    securityAnalysis.session.userId = cookieData.user_id;
                }
                if (cookieData.client_id) {
                    securityAnalysis.session.clientId = cookieData.client_id;
                }
            }
        }
    }

    // 4. Анализ Allegro cookies
    function analyzeAllegroCookies(cookieHeader) {
        const cookies = {};
        const sessionMatch = cookieHeader.match(/session_id=([^;]+)/);
        const userMatch = cookieHeader.match(/user_id=([^;]+)/);
        const clientMatch = cookieHeader.match(/client_id=([^;]+)/);
        const csrfMatch = cookieHeader.match(/csrf_token=([^;]+)/);

        if (sessionMatch) cookies.session_id = sessionMatch[1];
        if (userMatch) cookies.user_id = userMatch[1];
        if (clientMatch) cookies.client_id = clientMatch[1];
        if (csrfMatch) cookies.csrf_token = csrfMatch[1];

        return cookies;
    }

    // 5. Мониторинг товарных элементов Allegro
    function setupProductElementMonitoring() {
        console.group('🛍️ ALLEGRO PRODUCT ELEMENT MONITORING');

        // Наблюдатель за товарными элементами
        const productObserver = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === 1) { // Element node
                        // Поиск товаров
                        const productSelectors = [
                            '[data-role="product"]',
                            '[data-product-id]',
                            '[data-offer-id]',
                            '.product',
                            '.offer',
                            '[data-analytics-view*="product"]'
                        ];

                        productSelectors.forEach(selector => {
                            const elements = node.querySelectorAll ? node.querySelectorAll(selector) : [];
                            elements.forEach(element => {
                                const productId = element.getAttribute('data-product-id') || 
                                                element.getAttribute('data-offer-id') ||
                                                generateProductId();
                                
                                if (productId && !securityAnalysis.dom.productElements.has(productId)) {
                                    securityAnalysis.dom.productElements.add(productId);
                                    
                                    const productData = {
                                        id: productId,
                                        element: element,
                                        timestamp: new Date().toISOString(),
                                        interactions: []
                                    };

                                    // Мониторинг взаимодействий
                                    const interactionHandlers = {
                                        'view': 'data-analytics-view',
                                        'click': 'data-analytics-click',
                                        'add_to_cart': '[data-role="add-to-cart"]',
                                        'add_to_favorites': '[data-role="add-to-favorites"]',
                                        'buy_now': '[data-role="buy-now"]'
                                    };

                                    Object.entries(interactionHandlers).forEach(([type, selector]) => {
                                        if (selector.startsWith('data-')) {
                                            // Атрибут данных
                                            if (element.hasAttribute(selector)) {
                                                productData.interactions.push({
                                                    type: type,
                                                    timestamp: new Date().toISOString()
                                                });
                                            }
                                        } else {
                                            // Кнопка
                                            const button = element.querySelector(selector);
                                            if (button) {
                                                button.addEventListener('click', (e) => {
                                                    productData.interactions.push({
                                                        type: type,
                                                        timestamp: new Date().toISOString()
                                                    });

                                                    securityAnalysis.addDOMEvent({
                                                        type: `product_${type}`,
                                                        timestamp: new Date().toISOString(),
                                                        productId: productId,
                                                        coordinates: { x: e.clientX, y: e.clientY }
                                                    });

                                                    if (productData.interactions.length > 20) {
                                                        productData.interactions.shift();
                                                    }

                                                    console.log(`🛍️ Product ${type}: ${productId}`);
                                                });
                                            }
                                        }
                                    });

                                    // Общий клик по товару
                                    element.addEventListener('click', (e) => {
                                        securityAnalysis.addDOMEvent({
                                            type: 'product_click',
                                            timestamp: new Date().toISOString(),
                                            productId: productId
                                        });
                                    });

                                    console.log(`🛍️ Allegro Product Element: ${productId}`);
                                }
                            });
                        });

                        // Мониторинг корзины
                        const cartSelectors = [
                            '[data-role="cart"]',
                            '.cart',
                            '.basket',
                            '[data-analytics-view*="cart"]'
                        ];

                        cartSelectors.forEach(selector => {
                            const elements = node.querySelectorAll ? node.querySelectorAll(selector) : [];
                            elements.forEach(element => {
                                const cartId = `cart_${Date.now()}`;
                                if (!securityAnalysis.dom.cartElements.has(cartId)) {
                                    securityAnalysis.dom.cartElements.add(cartId);
                                    
                                    element.addEventListener('click', (e) => {
                                        securityAnalysis.addDOMEvent({
                                            type: 'cart_click',
                                            timestamp: new Date().toISOString()
                                        });
                                    });
                                }
                            });
                        });

                        // Мониторинг аукционов
                        const auctionSelectors = [
                            '[data-role="auction"]',
                            '.auction',
                            '[data-bid-button]'
                        ];

                        auctionSelectors.forEach(selector => {
                            const elements = node.querySelectorAll ? node.querySelectorAll(selector) : [];
                            elements.forEach(element => {
                                const auctionId = element.getAttribute('data-auction-id') || generateAuctionId();
                                if (!securityAnalysis.dom.auctionElements.has(auctionId)) {
                                    securityAnalysis.dom.auctionElements.add(auctionId);
                                    
                                    const bidButton = element.querySelector('[data-bid-button]');
                                    if (bidButton) {
                                        bidButton.addEventListener('click', (e) => {
                                            securityAnalysis.addDOMEvent({
                                                type: 'auction_bid',
                                                timestamp: new Date().toISOString(),
                                                auctionId: auctionId
                                            });
                                        });
                                    }
                                }
                            });
                        });
                    }
                });
            });
        });

        productObserver.observe(document.body, {
            childList: true,
            subtree: true
        });

        function generateProductId() {
            return `product_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        }

        function generateAuctionId() {
            return `auction_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        }

        console.groupEnd();
        return () => productObserver.disconnect();
    }

    // 6. Performance Observer для Allegro
    function setupSafePerformanceObserver() {
        console.group('⏱️ ALLEGRO PERFORMANCE OBSERVER');

        try {
            const perfObserver = new PerformanceObserver((list) => {
                list.getEntries().forEach(entry => {
                    // Особый интерес представляют товарные изображения и API вызовы
                    if (entry.name.includes('allegro') || entry.name.includes('/products/') || 
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
            console.log('✅ Allegro Performance Observer started');
            return perfObserver;
        } catch (e) {
            console.log('❌ Allegro Performance Observer failed:', e);
            return null;
        }

        console.groupEnd();
    }

    // 7. Система управления жизненным циклом
    function setupLifecycleManagement() {
        console.group('🔧 ALLEGRO LIFECYCLE MANAGEMENT');

        let cleanupCallbacks = [];
        let intervals = [];

        window.stopAllegroAnalysis = function() {
            console.log('🛑 Stopping Allegro Security Analysis...');

            intervals.forEach(clearInterval);
            intervals = [];

            cleanupCallbacks.forEach(callback => {
                try {
                    callback();
                } catch (e) {
                    console.log('Allegro cleanup error:', e);
                }
            });
            cleanupCallbacks = [];

            securityAnalysis.clearAll();

            console.log('✅ Allegro Security Analysis stopped completely');
        };

        const autoStopTimeout = setTimeout(() => {
            console.warn(`⏰ Auto-stopping Allegro analysis after ${CONFIG.autoStopMinutes} minutes`);
            window.stopAllegroAnalysis();
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

    // 8. Инициализация Allegro мониторинга
    function startAllegroAnalysis() {
        console.log('🚀 STARTING ALLEGRO MEMORY-SAFE SECURITY ANALYSIS...');

        const lifecycle = setupLifecycleManagement();

        setupMemorySafeFetchInterception();

        const xhrCleanup = setupMemorySafeXHRInterception();
        if (xhrCleanup) lifecycle.registerCleanup(xhrCleanup);

        const perfObserver = setupSafePerformanceObserver();
        if (perfObserver) lifecycle.registerCleanup(() => perfObserver.disconnect());

        const productCleanup = setupProductElementMonitoring();
        if (productCleanup) lifecycle.registerCleanup(productCleanup);

        // Периодический сбор статистики
        const statsInterval = setInterval(() => {
            const stats = {
                requests: securityAnalysis.network.requests.length,
                graphqlQueries: securityAnalysis.network.graphqlQueries.size,
                productRequests: securityAnalysis.network.productRequests.size,
                cartRequests: securityAnalysis.network.cartRequests.size,
                searchRequests: securityAnalysis.network.searchRequests.size,
                orderRequests: securityAnalysis.network.orderRequests.size,
                productElements: securityAnalysis.dom.productElements.size,
                cartElements: securityAnalysis.dom.cartElements.size,
                auctionElements: securityAnalysis.dom.auctionElements.size,
                websockets: securityAnalysis.network.websockets.length,
                domEvents: securityAnalysis.dom.events.length,
                authFlows: securityAnalysis.security.authFlows.length,
                perfEntries: securityAnalysis.timing.performanceEntries.length,
                memory: Math.round(performance.memory?.usedJSHeapSize / 1048576) || 'N/A'
            };

            console.log('📈 Allegro Memory-Safe Stats:', stats);

            if (performance.memory && performance.memory.usedJSHeapSize > 500 * 1048576) {
                console.warn('🚨 High memory usage detected, clearing old data');
                securityAnalysis.clearAll();
            }
        }, 15000);

        lifecycle.registerInterval(statsInterval);

        setupAllegroCommands();

        console.log('✅ ALLEGRO MEMORY-SAFE SECURITY ANALYSIS ACTIVE!');
        console.log('💡 Available commands:');
        console.log('💡 stopAllegroAnalysis() - Complete shutdown');
        console.log('💡 getAllegroMemoryStats() - Current memory usage');
        console.log('💡 getGraphQLQueries() - View GraphQL operations');
        console.log('💡 getProductActivity() - View product interactions');
        console.log('💡 getCartOperations() - View cart operations');
        console.log('💡 getSearchHistory() - View search queries');
        console.log('💡 getSessionInfo() - View session data');
    }

    // Команды для Allegro анализа
    function setupAllegroCommands() {
        window.getAllegroMemoryStats = function() {
            const stats = {
                requests: securityAnalysis.network.requests.length,
                graphqlQueries: securityAnalysis.network.graphqlQueries.size,
                productRequests: securityAnalysis.network.productRequests.size,
                cartRequests: securityAnalysis.network.cartRequests.size,
                searchRequests: securityAnalysis.network.searchRequests.size,
                orderRequests: securityAnalysis.network.orderRequests.size,
                productElements: securityAnalysis.dom.productElements.size,
                cartElements: securityAnalysis.dom.cartElements.size,
                auctionElements: securityAnalysis.dom.auctionElements.size,
                websockets: securityAnalysis.network.websockets.length,
                domEvents: securityAnalysis.dom.events.length,
                authFlows: securityAnalysis.security.authFlows.length,
                perfEntries: securityAnalysis.timing.performanceEntries.length,
                session: {
                    userId: securityAnalysis.session.userId,
                    sessionId: securityAnalysis.session.sessionId,
                    clientId: securityAnalysis.session.clientId,
                    deviceId: securityAnalysis.session.deviceId
                }
            };

            if (performance.memory) {
                stats.memoryMB = Math.round(performance.memory.usedJSHeapSize / 1048576);
                stats.memoryLimitMB = Math.round(performance.memory.jsHeapSizeLimit / 1048576);
            }

            console.log('💾 Allegro Memory Statistics:', stats);
            return stats;
        };

        window.clearAllegroData = function() {
            securityAnalysis.clearAll();
            console.log('🧹 Allegro data cleared');
        };

        window.getGraphQLQueries = function() {
            const queries = Array.from(securityAnalysis.network.graphqlQueries.entries());
            console.log('🕸️ GraphQL Queries:', queries);
            return queries;
        };

        window.getProductActivity = function() {
            const productData = {
                productRequests: Array.from(securityAnalysis.network.productRequests.entries()),
                productElements: Array.from(securityAnalysis.dom.productElements),
                interactions: securityAnalysis.dom.events.filter(e => e.type.includes('product_'))
            };
            console.log('🛍️ Product Activity:', productData);
            return productData;
        };

        window.getCartOperations = function() {
            const cartData = Array.from(securityAnalysis.network.cartRequests.entries());
            console.log('🛒 Cart Operations:', cartData);
            return cartData;
        };

        window.getSearchHistory = function() {
            const searches = Array.from(securityAnalysis.network.searchRequests.entries());
            console.log('🔍 Search History:', searches);
            return searches;
        };

        window.getSessionInfo = function() {
            console.log('👤 Allegro Session:', securityAnalysis.session);
            return securityAnalysis.session;
        };

        window.getAuthData = function() {
            const authData = {
                authFlows: securityAnalysis.security.authFlows,
                csrfTokens: securityAnalysis.security.csrfTokens,
                allegroTokens: securityAnalysis.security.allegroTokens
            };
            console.log('🔐 Authentication Data:', authData);
            return authData;
        };
    }

    // Запуск анализа Allegro
    startAllegroAnalysis();

})();