(function() {
    'use strict';

    console.log('🛡️ Starting Amazon Memory-Safe Security Analysis...');

    // Конфигурация с лимитами для Amazon
    const CONFIG = {
        maxBodySize: 10000,
        maxProductDataSize: 50000, // 50KB для данных продуктов
        maxRequests: 1000,
        maxBatches: 100,
        maxWebSockets: 50,
        maxDomEvents: 500,
        maxPerfEntries: 200,
        maxAuthFlows: 500,
        maxProductRequests: 300,
        maxCartOperations: 200,
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
            amazonConstants: {},
            customerId: null,
            sessionId: null,
            marketplace: null
        },
        network: {
            requests: [],
            websockets: [],
            endpoints: new Map(),
            productRequests: new Map(),
            cartOperations: new Map(),
            searchRequests: new Map(),
            recommendationRequests: new Map()
        },
        security: {
            headers: {},
            amazonAuth: {},
            authFlows: [],
            csrfTokens: {},
            fingerprintParams: {}
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
            cartElements: new Set()
        },

        // Методы безопасного добавления с проверкой лимитов
        addRequest: function(requestData) {
            this.network.requests.push(requestData);
            if (this.network.requests.length > CONFIG.maxRequests) {
                this.network.requests.shift();
            }
        },

        addProductRequest: function(id, productData) {
            this.network.productRequests.set(id, productData);
            if (this.network.productRequests.size > CONFIG.maxProductRequests) {
                const firstKey = this.network.productRequests.keys().next().value;
                this.network.productRequests.delete(firstKey);
            }
        },

        addCartOperation: function(id, cartData) {
            this.network.cartOperations.set(id, cartData);
            if (this.network.cartOperations.size > CONFIG.maxCartOperations) {
                const firstKey = this.network.cartOperations.keys().next().value;
                this.network.cartOperations.delete(firstKey);
            }
        },

        addSearchRequest: function(id, searchData) {
            this.network.searchRequests.set(id, searchData);
            if (this.network.searchRequests.size > CONFIG.maxBatches) {
                const firstKey = this.network.searchRequests.keys().next().value;
                this.network.searchRequests.delete(firstKey);
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
            this.network.productRequests.clear();
            this.network.cartOperations.clear();
            this.network.searchRequests.clear();
            this.network.recommendationRequests.clear();
            this.network.endpoints.clear();
            this.dom.events = [];
            this.dom.currentXHRs.clear();
            this.dom.productElements.clear();
            this.dom.cartElements.clear();
            this.security.authFlows = [];
            this.timing.performanceEntries = [];
            this.timing.events = [];
            this.timing.startTime = Date.now();
        }
    };

    // 1. Перехват Fetch с обработкой Amazon API
    function setupMemorySafeFetchInterception() {
        console.group('🌐 AMAZON MEMORY-SAFE FETCH INTERCEPTION');

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
                isProductAPI: false,
                isCartAPI: false,
                isSearchAPI: false,
                isRecommendationAPI: false,
                isAuthenticationAPI: false
            };

            // Определяем тип запроса Amazon
            if (typeof url === 'string') {
                requestData.isProductAPI = url.includes('/product/') || url.includes('/dp/') || 
                                         url.includes('/gp/product/') || url.includes('/product-api/');
                requestData.isCartAPI = url.includes('/cart/') || url.includes('/add-to-cart') || 
                                      url.includes('/cart/api') || url.includes('/cart/widget');
                requestData.isSearchAPI = url.includes('/s/') || url.includes('/search/') || 
                                        url.includes('/suggestions/') || url.includes('complete-search');
                requestData.isRecommendationAPI = url.includes('/recommendations/') || 
                                                url.includes('/sponsored') || url.includes('/ads/');
                requestData.isAuthenticationAPI = url.includes('/ap/signin') || url.includes('/authentication/') ||
                                                url.includes('/auth/');
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

            // Обработка Product API запросов
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

                    // Извлекаем ASIN из URL или тела
                    const asin = extractASIN(requestData.url) || extractASINFromBody(bodyText);
                    if (asin) {
                        requestData.asin = asin;
                    }

                    // Сохраняем product запрос
                    securityAnalysis.addProductRequest(requestId, {
                        url: url,
                        asin: asin,
                        requestBodyBase64: requestData.requestBodyBase64,
                        timestamp: requestData.timestamp,
                        size: bodyText.length,
                        type: 'fetch',
                        method: requestData.method
                    });
                } catch (e) {
                    requestData.requestBody = '[Failed to read product API body]';
                }
            }

            // Обработка Cart API запросов
            if (requestData.isCartAPI && args[1]?.body) {
                try {
                    const bodyText = await cloneAndReadBody(args[1].body);
                    requestData.cartOperation = analyzeCartOperation(bodyText, requestData.url);
                    
                    securityAnalysis.addCartOperation(requestId, {
                        url: url,
                        operation: requestData.cartOperation,
                        timestamp: requestData.timestamp,
                        method: requestData.method,
                        requestBody: bodyText.substring(0, 1000)
                    });
                } catch (e) {
                    requestData.cartOperation = { type: 'unknown' };
                }
            }

            // Обработка Search API запросов
            if (requestData.isSearchAPI) {
                const searchQuery = extractSearchQuery(requestData.url);
                if (searchQuery) {
                    requestData.searchQuery = searchQuery;
                    
                    securityAnalysis.addSearchRequest(requestId, {
                        url: url,
                        query: searchQuery,
                        timestamp: requestData.timestamp,
                        method: requestData.method
                    });
                }
            }

            // Анализ Amazon-специфичных заголовков
            analyzeAmazonHeaders(args[1]?.headers, requestData, 'request');

            // Безопасное добавление запроса
            securityAnalysis.addRequest(requestData);

            console.log(`📡 Amazon Fetch: ${requestData.method} ${url}`, {
                type: requestData.isProductAPI ? 'Product API' : 
                      (requestData.isCartAPI ? 'Cart API' : 
                      (requestData.isSearchAPI ? 'Search API' : 
                      (requestData.isRecommendationAPI ? 'Recommendation API' : 'Regular'))),
                asin: requestData.asin,
                searchQuery: requestData.searchQuery
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

                    // Обновляем соответствующие коллекции данными ответа
                    if (requestData.isProductAPI) {
                        const productData = securityAnalysis.network.productRequests.get(requestId);
                        if (productData) {
                            productData.responseSize = text.length;
                            productData.duration = requestData.duration;
                            productData.responseBodyBase64 = btoa(unescape(encodeURIComponent(text.substring(0, 5000))));
                        }
                    }

                    if (requestData.isCartAPI) {
                        const cartData = securityAnalysis.network.cartOperations.get(requestId);
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

                analyzeAmazonHeaders(requestData.responseHeaders, requestData, 'response');

                console.log(`📦 Amazon Response: ${response.status} ${url}`, {
                    duration: requestData.duration + 'ms',
                    type: requestData.isProductAPI ? 'Product' : 'API'
                });

                return response;
            } catch (error) {
                requestData.error = error.message;
                requestData.endTime = performance.now();
                requestData.duration = requestData.endTime - startTime;
                throw error;
            }
        };

        // Вспомогательная функция для извлечения ASIN
        function extractASIN(url) {
            const asinMatch = url.match(/(?:[/])([A-Z0-9]{10})(?:[/]|$)/);
            return asinMatch ? asinMatch[1] : null;
        }

        function extractASINFromBody(body) {
            const asinMatch = body.match(/"asin":\s*"([A-Z0-9]{10})"/);
            return asinMatch ? asinMatch[1] : null;
        }

        // Вспомогательная функция для анализа операций с корзиной
        function analyzeCartOperation(body, url) {
            if (url.includes('add-to-cart') || body.includes('addToCart')) {
                return { type: 'add', items: extractCartItems(body) };
            } else if (url.includes('delete') || body.includes('delete')) {
                return { type: 'remove', items: extractCartItems(body) };
            } else if (url.includes('update') || body.includes('update')) {
                return { type: 'update', items: extractCartItems(body) };
            } else if (url.includes('view') || url.includes('get')) {
                return { type: 'view' };
            }
            return { type: 'unknown' };
        }

        function extractCartItems(body) {
            const itemMatches = body.match(/"asin":\s*"([A-Z0-9]{10})"/g);
            return itemMatches ? itemMatches.map(m => m.replace(/"asin":\s*"/, '').replace(/"/, '')) : [];
        }

        // Вспомогательная функция для извлечения поискового запроса
        function extractSearchQuery(url) {
            try {
                const urlObj = new URL(url, window.location.origin);
                return urlObj.searchParams.get('k') || urlObj.searchParams.get('field-keywords');
            } catch (e) {
                return null;
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

    // 2. XHR перехват для Amazon
    function setupMemorySafeXHRInterception() {
        console.group('🌐 AMAZON MEMORY-SAFE XHR INTERCEPTION');

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

            // Определяем тип запроса Amazon
            if (typeof url === 'string') {
                data.isProductAPI = url.includes('/product/') || url.includes('/dp/') || url.includes('/gp/product/');
                data.isCartAPI = url.includes('/cart/') || url.includes('/add-to-cart');
                data.isSearchAPI = url.includes('/s/') || url.includes('/search/');
                data.isAuthenticationAPI = url.includes('/ap/signin');
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

                        // Анализ для специфичных API
                        if (data.isProductAPI) {
                            const asin = extractASIN(data.url) || extractASINFromBody(body);
                            if (asin) {
                                data.asin = asin;
                                securityAnalysis.addProductRequest(data.id, {
                                    url: data.url,
                                    asin: asin,
                                    timestamp: data.timestamp,
                                    type: 'xhr',
                                    method: data.method
                                });
                            }
                        }

                        if (data.isCartAPI) {
                            data.cartOperation = analyzeCartOperation(body, data.url);
                            securityAnalysis.addCartOperation(data.id, {
                                url: data.url,
                                operation: data.cartOperation,
                                timestamp: data.timestamp,
                                method: data.method
                            });
                        }

                        if (data.isSearchAPI) {
                            const searchQuery = extractSearchQuery(data.url);
                            if (searchQuery) {
                                data.searchQuery = searchQuery;
                                securityAnalysis.addSearchRequest(data.id, {
                                    url: data.url,
                                    query: searchQuery,
                                    timestamp: data.timestamp,
                                    method: data.method
                                });
                            }
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

            // Анализ заголовков Amazon
            analyzeAmazonHeaders(data.headers, data, 'request');

            // Безопасное добавление запроса
            securityAnalysis.addRequest(data);

            console.log(`📡 Amazon XHR: ${data.method} ${data.url}`, {
                type: data.isProductAPI ? 'Product API' : 
                      (data.isCartAPI ? 'Cart API' : 'Regular'),
                asin: data.asin
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
                        if (data.isProductAPI) {
                            const productData = securityAnalysis.network.productRequests.get(data.id);
                            if (productData) {
                                productData.responseSize = this.responseText.length;
                                productData.duration = data.duration;
                            }
                        }

                        if (data.isCartAPI) {
                            const cartData = securityAnalysis.network.cartOperations.get(data.id);
                            if (cartData) {
                                cartData.responseSize = this.responseText.length;
                                cartData.duration = data.duration;
                                cartData.success = this.status === 200;
                            }
                        }

                        data.size += this.responseText.length;
                    }
                } catch (e) {
                    data.responseBody = '[Failed to read response]';
                }

                analyzeAmazonHeaders(this.getAllResponseHeaders(), data, 'response');

                console.log(`📦 Amazon XHR Response: ${this.status} ${data.url}`, {
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

    // 3. Анализ Amazon-специфичных заголовков
    function analyzeAmazonHeaders(headers, requestData, type) {
        const amazonSecurityHeaders = ['x-amz-server-side-encryption', 'x-amz-security-token', 'x-amz-date', 'x-amz-target'];
        const amazonAuthHeaders = ['x-amz-access-token', 'x-amz-customer-id', 'x-amz-user-id', 'x-amz-marketplace-id'];
        const amazonTrackingHeaders = ['x-amz-trace-id', 'x-amz-request-id', 'x-amz-cf-id', 'x-amz-cf-pop'];

        if (type === 'request') {
            requestData.amazonSecurityHeaders = {};
            requestData.amazonAuthHeaders = {};
            requestData.amazonTrackingHeaders = {};

            Object.entries(headers || {}).forEach(([key, value]) => {
                const lowerKey = key.toLowerCase();

                if (amazonSecurityHeaders.some(h => lowerKey.includes(h))) {
                    requestData.amazonSecurityHeaders[key] = String(value).substring(0, 200);
                }

                if (amazonAuthHeaders.some(h => lowerKey.includes(h))) {
                    requestData.amazonAuthHeaders[key] = String(value).substring(0, 200);

                    securityAnalysis.addAuthFlow({
                        type: `amazon_${type}_header`,
                        header: key,
                        value: String(value).substring(0, 100),
                        timestamp: requestData.timestamp,
                        requestId: requestData.id
                    });
                }

                if (amazonTrackingHeaders.some(h => lowerKey.includes(h))) {
                    requestData.amazonTrackingHeaders[key] = String(value).substring(0, 200);
                }
            });

            // Анализ cookies для сессионных данных
            if (headers?.cookie) {
                const cookieData = analyzeAmazonCookies(headers.cookie);
                if (cookieData.sessionId) {
                    securityAnalysis.session.sessionId = cookieData.sessionId;
                }
                if (cookieData.customerId) {
                    securityAnalysis.session.customerId = cookieData.customerId;
                }
            }
        }
    }

    // 4. Анализ Amazon cookies
    function analyzeAmazonCookies(cookieHeader) {
        const cookies = {};
        const sessionMatch = cookieHeader.match/(session-id=([^;]+)/);
        const customerMatch = cookieHeader.match/(customer-id=([^;]+)/);
        const marketplaceMatch = cookieHeader.match/(marketplace=([^;]+)/);

        if (sessionMatch) cookies.sessionId = sessionMatch[1];
        if (customerMatch) cookies.customerId = customerMatch[1];
        if (marketplaceMatch) cookies.marketplace = marketplaceMatch[1];

        return cookies;
    }

    // 5. Мониторинг продуктовых элементов
    function setupProductElementMonitoring() {
        console.group('🛒 AMAZON PRODUCT ELEMENT MONITORING');

        // Наблюдатель за продуктами
        const productObserver = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === 1) { // Element node
                        // Поиск продуктовых карточек
                        const productSelectors = [
                            '[data-asin]',
                            '.s-result-item',
                            '.s-product',
                            '[data-component-type="s-search-result"]',
                            '.a-carousel-card'
                        ];

                        productSelectors.forEach(selector => {
                            const elements = node.querySelectorAll ? node.querySelectorAll(selector) : [];
                            elements.forEach(element => {
                                const asin = element.getAttribute('data-asin');
                                if (asin && !securityAnalysis.dom.productElements.has(asin)) {
                                    securityAnalysis.dom.productElements.add(asin);
                                    
                                    const productData = {
                                        asin: asin,
                                        element: element,
                                        timestamp: new Date().toISOString(),
                                        events: []
                                    };

                                    // Мониторинг кликов по продукту
                                    element.addEventListener('click', (e) => {
                                        productData.events.push({
                                            type: 'click',
                                            timestamp: new Date().toISOString(),
                                            target: e.target.tagName
                                        });

                                        if (productData.events.length > 20) {
                                            productData.events.shift();
                                        }
                                    });

                                    console.log(`🛒 Amazon Product Element: ${asin}`);
                                }
                            });
                        });

                        // Мониторинг кнопок "Add to Cart"
                        const addToCartButtons = node.querySelectorAll ? 
                            node.querySelectorAll('[id*="add-to-cart"], .a-button-input[type="submit"]') : [];
                        addToCartButtons.forEach(button => {
                            button.addEventListener('click', (e) => {
                                const asin = findClosestASIN(e.target);
                                if (asin) {
                                    securityAnalysis.addCartOperation(`click_${Date.now()}`, {
                                        type: 'add_click',
                                        asin: asin,
                                        timestamp: new Date().toISOString(),
                                        element: e.target.tagName
                                    });
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

        function findClosestASIN(element) {
            let current = element;
            while (current && current !== document.body) {
                const asin = current.getAttribute('data-asin');
                if (asin) return asin;
                current = current.parentElement;
            }
            return null;
        }

        console.groupEnd();
        return () => productObserver.disconnect();
    }

    // 6. Performance Observer для Amazon
    function setupSafePerformanceObserver() {
        console.group('⏱️ AMAZON PERFORMANCE OBSERVER');

        try {
            const perfObserver = new PerformanceObserver((list) => {
                list.getEntries().forEach(entry => {
                    // Особый интерес представляют продуктовые страницы
                    if (entry.name.includes('/dp/') || entry.name.includes('/product/') || 
                        entry.initiatorType === 'xmlhttprequest') {
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
            console.log('✅ Amazon Performance Observer started');
            return perfObserver;
        } catch (e) {
            console.log('❌ Amazon Performance Observer failed:', e);
            return null;
        }

        console.groupEnd();
    }

    // 7. Система управления жизненным циклом
    function setupLifecycleManagement() {
        console.group('🔧 AMAZON LIFECYCLE MANAGEMENT');

        let cleanupCallbacks = [];
        let intervals = [];

        window.stopAmazonAnalysis = function() {
            console.log('🛑 Stopping Amazon Security Analysis...');

            intervals.forEach(clearInterval);
            intervals = [];

            cleanupCallbacks.forEach(callback => {
                try {
                    callback();
                } catch (e) {
                    console.log('Amazon cleanup error:', e);
                }
            });
            cleanupCallbacks = [];

            securityAnalysis.clearAll();

            console.log('✅ Amazon Security Analysis stopped completely');
        };

        const autoStopTimeout = setTimeout(() => {
            console.warn(`⏰ Auto-stopping Amazon analysis after ${CONFIG.autoStopMinutes} minutes`);
            window.stopAmazonAnalysis();
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

    // 8. Инициализация Amazon мониторинга
    function startAmazonAnalysis() {
        console.log('🚀 STARTING AMAZON MEMORY-SAFE SECURITY ANALYSIS...');

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
                productRequests: securityAnalysis.network.productRequests.size,
                cartOperations: securityAnalysis.network.cartOperations.size,
                searchRequests: securityAnalysis.network.searchRequests.size,
                productElements: securityAnalysis.dom.productElements.size,
                websockets: securityAnalysis.network.websockets.length,
                domEvents: securityAnalysis.dom.events.length,
                authFlows: securityAnalysis.security.authFlows.length,
                perfEntries: securityAnalysis.timing.performanceEntries.length,
                memory: Math.round(performance.memory?.usedJSHeapSize / 1048576) || 'N/A'
            };

            console.log('📈 Amazon Memory-Safe Stats:', stats);

            if (performance.memory && performance.memory.usedJSHeapSize > 500 * 1048576) {
                console.warn('🚨 High memory usage detected, clearing old data');
                securityAnalysis.clearAll();
            }
        }, 15000);

        lifecycle.registerInterval(statsInterval);

        setupAmazonCommands();

        console.log('✅ AMAZON MEMORY-SAFE SECURITY ANALYSIS ACTIVE!');
        console.log('💡 Available commands:');
        console.log('💡 stopAmazonAnalysis() - Complete shutdown');
        console.log('💡 getAmazonMemoryStats() - Current memory usage');
        console.log('💡 getProductRequests() - View product API calls');
        console.log('💡 getCartOperations() - View cart operations');
        console.log('💡 getSearchHistory() - View search queries');
    }

    // Команды для Amazon анализа
    function setupAmazonCommands() {
        window.getAmazonMemoryStats = function() {
            const stats = {
                requests: securityAnalysis.network.requests.length,
                productRequests: securityAnalysis.network.productRequests.size,
                cartOperations: securityAnalysis.network.cartOperations.size,
                searchRequests: securityAnalysis.network.searchRequests.size,
                productElements: securityAnalysis.dom.productElements.size,
                websockets: securityAnalysis.network.websockets.length,
                domEvents: securityAnalysis.dom.events.length,
                authFlows: securityAnalysis.security.authFlows.length,
                perfEntries: securityAnalysis.timing.performanceEntries.length,
                session: {
                    customerId: securityAnalysis.session.customerId,
                    sessionId: securityAnalysis.session.sessionId
                }
            };

            if (performance.memory) {
                stats.memoryMB = Math.round(performance.memory.usedJSHeapSize / 1048576);
                stats.memoryLimitMB = Math.round(performance.memory.jsHeapSizeLimit / 1048576);
            }

            console.log('💾 Amazon Memory Statistics:', stats);
            return stats;
        };

        window.clearAmazonData = function() {
            securityAnalysis.clearAll();
            console.log('🧹 Amazon data cleared');
        };

        window.getProductRequests = function() {
            const requests = Array.from(securityAnalysis.network.productRequests.entries());
            console.log('📦 Product API Requests:', requests);
            return requests;
        };

        window.getCartOperations = function() {
            const operations = Array.from(securityAnalysis.network.cartOperations.entries());
            console.log('🛒 Cart Operations:', operations);
            return operations;
        };

        window.getSearchHistory = function() {
            const searches = Array.from(securityAnalysis.network.searchRequests.entries());
            console.log('🔍 Search History:', searches);
            return searches;
        };

        window.getSessionInfo = function() {
            console.log('👤 Amazon Session:', securityAnalysis.session);
            return securityAnalysis.session;
        };
    }

    // Запуск анализа Amazon
    startAmazonAnalysis();

})();