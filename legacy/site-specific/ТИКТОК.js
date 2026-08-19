(function() {
    'use strict';

    console.log('🛡️ Starting TikTok Memory-Safe Security Analysis...');

    // Конфигурация с лимитами для TikTok
    const CONFIG = {
        maxBodySize: 10000,
        maxVideoChunkSize: 100000, // 100KB для видео чанков
        maxRequests: 1000,
        maxBatches: 100,
        maxWebSockets: 50,
        maxDomEvents: 500,
        maxPerfEntries: 200,
        maxAuthFlows: 500,
        maxVideoRequests: 200,
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
            tiktokConstants: {},
            userID: null,
            deviceID: null
        },
        network: {
            requests: [],
            websockets: [],
            endpoints: new Map(),
            apiCalls: new Map(),
            videoRequests: new Map(),
            awemeRequests: new Map()
        },
        security: {
            headers: {},
            tiktokAuth: {},
            authFlows: [],
            signatureParams: {},
            xBogusParams: {}
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
            videoElements: new Set()
        },

        // Методы безопасного добавления с проверкой лимитов
        addRequest: function(requestData) {
            this.network.requests.push(requestData);
            if (this.network.requests.length > CONFIG.maxRequests) {
                this.network.requests.shift();
            }
        },

        addAwemeRequest: function(id, awemeData) {
            this.network.awemeRequests.set(id, awemeData);
            if (this.network.awemeRequests.size > CONFIG.maxBatches) {
                const firstKey = this.network.awemeRequests.keys().next().value;
                this.network.awemeRequests.delete(firstKey);
            }
        },

        addVideoRequest: function(id, videoData) {
            this.network.videoRequests.set(id, videoData);
            if (this.network.videoRequests.size > CONFIG.maxVideoRequests) {
                const firstKey = this.network.videoRequests.keys().next().value;
                this.network.videoRequests.delete(firstKey);
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
            this.network.awemeRequests.clear();
            this.network.videoRequests.clear();
            this.network.apiCalls.clear();
            this.network.endpoints.clear();
            this.dom.events = [];
            this.dom.currentXHRs.clear();
            this.dom.videoElements.clear();
            this.security.authFlows = [];
            this.timing.performanceEntries = [];
            this.timing.events = [];
            this.timing.startTime = Date.now();
        }
    };

    // 1. Перехват Fetch с обработкой TikTok API
    function setupMemorySafeFetchInterception() {
        console.group('🌐 TIKTOK MEMORY-SAFE FETCH INTERCEPTION');

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
                isAwemeAPI: false,
                isVideoAPI: false,
                isTikTokAPI: false,
                isSignatureRequired: false
            };

            // Определяем тип запроса TikTok
            if (typeof url === 'string') {
                requestData.isAwemeAPI = url.includes('/aweme/v') || url.includes('aweme/v') || url.includes('/api/post');
                requestData.isVideoAPI = url.includes('/video/') || url.includes('.mp4') || url.includes('video/tos') || url.includes('video/aweme');
                requestData.isTikTokAPI = url.includes('tiktokv.com') || url.includes('tiktok.com/api') || url.includes('musical.ly');
                requestData.isSignatureRequired = url.includes('_signature') || url.includes('X-Bogus') || url.includes('x-gorgon');
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
                        // Для видео чанков сохраняем только метаданные
                        if (args[1].body.type.includes('video') || args[1].body.size > 100000) {
                            requestData.requestBody = `[Video Chunk: ${args[1].body.size} bytes, type: ${args[1].body.type}]`;
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

            // Обработка aweme API запросов (основной API TikTok)
            if (requestData.isAwemeAPI && args[1]?.body) {
                try {
                    const bodyText = await cloneAndReadBody(args[1].body);
                    if (bodyText.length > CONFIG.maxBodySize) {
                        requestData.requestBody = `[Aweme API TOO_LARGE: ${bodyText.length} bytes]`;
                        requestData.requestBodyBase64 = 'TOO_LARGE';
                    } else {
                        requestData.requestBodyBase64 = btoa(unescape(encodeURIComponent(bodyText)));
                        requestData.requestBody = `Aweme API (base64): ${requestData.requestBodyBase64.substring(0, 200)}...`;
                    }
                    requestData.size = bodyText.length;

                    // Сохраняем aweme запрос
                    securityAnalysis.addAwemeRequest(requestId, {
                        url: url,
                        requestBodyBase64: requestData.requestBodyBase64,
                        timestamp: requestData.timestamp,
                        size: bodyText.length,
                        type: 'fetch',
                        method: requestData.method
                    });
                } catch (e) {
                    requestData.requestBody = '[Failed to read aweme API body]';
                }
            }

            // Обработка видео запросов
            if (requestData.isVideoAPI) {
                requestData.isVideoChunk = true;
                securityAnalysis.addVideoRequest(requestId, {
                    url: url,
                    timestamp: requestData.timestamp,
                    method: requestData.method,
                    headers: { ...args[1]?.headers },
                    estimatedSize: args[1]?.body?.size || 0
                });
            }

            // Анализ TikTok-специфичных заголовков
            analyzeTikTokHeaders(args[1]?.headers, requestData, 'request');

            // Безопасное добавление запроса
            securityAnalysis.addRequest(requestData);

            console.log(`📡 TikTok Fetch: ${requestData.method} ${url}`, {
                type: requestData.isAwemeAPI ? 'Aweme API' : 
                      (requestData.isVideoAPI ? 'Video' : 
                      (requestData.isTikTokAPI ? 'TikTok API' : 'Regular')),
                signed: requestData.isSignatureRequired,
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

                // Безопасное чтение тела ответа (пропускаем для видео)
                if (!requestData.isVideoAPI) {
                    try {
                        const clone = response.clone();
                        const text = await clone.text();

                        if (text.length > CONFIG.maxBodySize) {
                            requestData.responseBody = `[Response TOO_LARGE: ${text.length} bytes]`;
                        } else {
                            requestData.responseBody = text;
                        }

                        // Для aweme API ответов
                        if (requestData.isAwemeAPI) {
                            if (text.length > CONFIG.maxBodySize) {
                                requestData.responseBodyBase64 = 'TOO_LARGE';
                            } else {
                                requestData.responseBodyBase64 = btoa(unescape(encodeURIComponent(text)));
                            }

                            // Обновляем aweme запрос данными ответа
                            const awemeData = securityAnalysis.network.awemeRequests.get(requestId);
                            if (awemeData) {
                                awemeData.responseBodyBase64 = requestData.responseBodyBase64;
                                awemeData.responseSize = text.length;
                                awemeData.duration = requestData.duration;
                            }
                        }

                        requestData.size += text.length;
                    } catch (e) {
                        requestData.responseBody = '[Failed to read response body]';
                    }
                } else {
                    requestData.responseBody = '[Video data - not stored]';
                }

                analyzeTikTokHeaders(requestData.responseHeaders, requestData, 'response');

                console.log(`📦 TikTok Response: ${response.status} ${url}`, {
                    duration: requestData.duration + 'ms',
                    type: requestData.isVideoAPI ? 'Video' : 'API'
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

    // 2. XHR перехват для TikTok
    function setupMemorySafeXHRInterception() {
        console.group('🌐 TIKTOK MEMORY-SAFE XHR INTERCEPTION');

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

            // Определяем тип запроса TikTok
            if (typeof url === 'string') {
                data.isAwemeAPI = url.includes('/aweme/v') || url.includes('aweme/v') || url.includes('/api/post');
                data.isVideoAPI = url.includes('/video/') || url.includes('.mp4') || url.includes('video/tos');
                data.isTikTokAPI = url.includes('tiktokv.com') || url.includes('tiktok.com/api');
                data.isSignatureRequired = url.includes('_signature') || url.includes('X-Bogus');
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
                        if (body.size > 100000) {
                            data.requestBody = `[Large Blob: ${body.size} bytes]`;
                        } else {
                            data.requestBody = `[Blob: ${body.size} bytes]`;
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

            // Обработка aweme API для XHR
            if (data.isAwemeAPI && body) {
                try {
                    if (typeof body === 'string' && body.length <= CONFIG.maxBodySize) {
                        data.requestBodyBase64 = btoa(unescape(encodeURIComponent(body)));
                        data.requestBody = `Aweme API (base64): ${data.requestBodyBase64.substring(0, 200)}...`;

                        securityAnalysis.addAwemeRequest(data.id, {
                            url: data.url,
                            requestBodyBase64: data.requestBodyBase64,
                            timestamp: data.timestamp,
                            size: body.length,
                            type: 'xhr',
                            method: data.method
                        });
                    } else {
                        data.requestBody = `[Aweme API TOO_LARGE: ${body.size || body.length} bytes]`;
                        data.requestBodyBase64 = 'TOO_LARGE';
                    }
                } catch (e) {
                    data.requestBody = '[Failed to process aweme API body]';
                }
            }

            // Обработка видео запросов для XHR
            if (data.isVideoAPI) {
                data.isVideoChunk = true;
                securityAnalysis.addVideoRequest(data.id, {
                    url: data.url,
                    timestamp: data.timestamp,
                    method: data.method,
                    headers: data.headers,
                    estimatedSize: body?.size || 0
                });
            }

            // Анализ заголовков TikTok
            analyzeTikTokHeaders(data.headers, data, 'request');

            // Безопасное добавление запроса
            securityAnalysis.addRequest(data);

            console.log(`📡 TikTok XHR: ${data.method} ${data.url}`, {
                type: data.isAwemeAPI ? 'Aweme API' : 
                      (data.isVideoAPI ? 'Video' : 'Regular'),
                signed: data.isSignatureRequired
            });

            this.addEventListener('load', function() {
                const endTime = performance.now();
                data.endTime = endTime;
                data.duration = endTime - data.startTime;
                data.status = this.status;
                data.statusText = this.statusText;
                data.responseHeaders = this.getAllResponseHeaders();

                // Безопасное чтение ответа (пропускаем для видео)
                if (!data.isVideoAPI) {
                    try {
                        if (this.responseText) {
                            if (this.responseText.length > CONFIG.maxBodySize) {
                                data.responseBody = `[Response TOO_LARGE: ${this.responseText.length} bytes]`;
                            } else {
                                data.responseBody = this.responseText;
                            }

                            if (data.isAwemeAPI) {
                                if (this.responseText.length > CONFIG.maxBodySize) {
                                    data.responseBodyBase64 = 'TOO_LARGE';
                                } else {
                                    data.responseBodyBase64 = btoa(unescape(encodeURIComponent(this.responseText)));
                                }

                                // Обновляем aweme запрос
                                const awemeData = securityAnalysis.network.awemeRequests.get(data.id);
                                if (awemeData) {
                                    awemeData.responseBodyBase64 = data.responseBodyBase64;
                                    awemeData.responseSize = this.responseText.length;
                                    awemeData.duration = data.duration;
                                }
                            }

                            data.size += this.responseText.length;
                        }
                    } catch (e) {
                        data.responseBody = '[Failed to read response]';
                    }
                } else {
                    data.responseBody = '[Video data - not stored]';
                }

                analyzeTikTokHeaders(this.getAllResponseHeaders(), data, 'response');

                console.log(`📦 TikTok XHR Response: ${this.status} ${data.url}`, {
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

    // 3. Анализ TikTok-специфичных заголовков и параметров
    function analyzeTikTokHeaders(headers, requestData, type) {
        const tiktokSecurityHeaders = ['x-tt-trace-id', 'x-tt-span-id', 'x-tt-env', 'x-tt-store-id', 'x-tt-cmpl-token'];
        const tiktokAuthHeaders = ['x-tt-token', 'x-tt-passport-csrf-token', 'x-tt-session-id', 'x-bogus', 'x-gorgon'];
        const tiktokTrackingHeaders = ['x-tt-student', 'x-tt-request-tag', 'x-tt-report-time'];

        if (type === 'request') {
            requestData.tiktokSecurityHeaders = {};
            requestData.tiktokAuthHeaders = {};
            requestData.tiktokTrackingHeaders = {};

            Object.entries(headers || {}).forEach(([key, value]) => {
                const lowerKey = key.toLowerCase();

                if (tiktokSecurityHeaders.some(h => lowerKey.includes(h))) {
                    requestData.tiktokSecurityHeaders[key] = String(value).substring(0, 200);
                }

                if (tiktokAuthHeaders.some(h => lowerKey.includes(h))) {
                    requestData.tiktokAuthHeaders[key] = String(value).substring(0, 200);

                    securityAnalysis.addAuthFlow({
                        type: `tiktok_${type}_header`,
                        header: key,
                        value: String(value).substring(0, 100),
                        timestamp: requestData.timestamp,
                        requestId: requestData.id,
                        isSignature: key.includes('bogus') || key.includes('gorgon')
                    });
                }

                if (tiktokTrackingHeaders.some(h => lowerKey.includes(h))) {
                    requestData.tiktokTrackingHeaders[key] = String(value).substring(0, 200);
                }
            });

            // Анализ URL на наличие сигнатурных параметров
            if (requestData.url && typeof requestData.url === 'string') {
                const urlObj = new URL(requestData.url, window.location.origin);
                const signatureParams = ['_signature', 'X-Bogus', 'x-gorgon', 'msToken'];
                
                signatureParams.forEach(param => {
                    if (urlObj.searchParams.has(param)) {
                        requestData.signatureParams = requestData.signatureParams || {};
                        requestData.signatureParams[param] = urlObj.searchParams.get(param).substring(0, 100);
                        
                        securityAnalysis.security.signatureParams[param] = 
                            securityAnalysis.security.signatureParams[param] || [];
                        securityAnalysis.security.signatureParams[param].push({
                            value: urlObj.searchParams.get(param).substring(0, 50),
                            timestamp: requestData.timestamp,
                            requestId: requestData.id
                        });
                    }
                });
            }
        }
    }

    // 4. Мониторинг видео элементов TikTok
    function setupVideoElementMonitoring() {
        console.group('🎬 TIKTOK VIDEO ELEMENT MONITORING');

        // Наблюдатель за добавлением видео элементов
        const videoObserver = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeName === 'VIDEO' || (node.querySelector && node.querySelector('video'))) {
                        const videos = node.nodeName === 'VIDEO' ? [node] : node.querySelectorAll('video');
                        videos.forEach(video => {
                            if (!securityAnalysis.dom.videoElements.has(video)) {
                                securityAnalysis.dom.videoElements.add(video);
                                
                                const videoData = {
                                    id: `video_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                                    element: video,
                                    src: video.src,
                                    currentTime: 0,
                                    events: [],
                                    timestamp: new Date().toISOString()
                                };

                                // Мониторинг событий видео
                                ['play', 'pause', 'seeked', 'ended', 'timeupdate'].forEach(eventType => {
                                    video.addEventListener(eventType, (e) => {
                                        videoData.events.push({
                                            type: eventType,
                                            currentTime: e.target.currentTime,
                                            timestamp: new Date().toISOString()
                                        });

                                        // Ограничиваем количество событий
                                        if (videoData.events.length > 50) {
                                            videoData.events.shift();
                                        }
                                    });
                                });

                                console.log(`🎬 TikTok Video Element Added: ${video.src}`);
                            }
                        });
                    }
                });
            });
        });

        videoObserver.observe(document.body, {
            childList: true,
            subtree: true
        });

        console.groupEnd();
        return () => videoObserver.disconnect();
    }

    // 5. Performance Observer для TikTok
    function setupSafePerformanceObserver() {
        console.group('⏱️ TIKTOK PERFORMANCE OBSERVER');

        try {
            const perfObserver = new PerformanceObserver((list) => {
                list.getEntries().forEach(entry => {
                    // Фильтруем видео-related ресурсы
                    if (entry.name.includes('video') || entry.name.includes('.mp4') || entry.initiatorType === 'video') {
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
            console.log('✅ TikTok Performance Observer started');
            return perfObserver;
        } catch (e) {
            console.log('❌ TikTok Performance Observer failed:', e);
            return null;
        }

        console.groupEnd();
    }

    // 6. Система управления жизненным циклом
    function setupLifecycleManagement() {
        console.group('🔧 TIKTOK LIFECYCLE MANAGEMENT');

        let cleanupCallbacks = [];
        let intervals = [];

        window.stopTikTokAnalysis = function() {
            console.log('🛑 Stopping TikTok Security Analysis...');

            intervals.forEach(clearInterval);
            intervals = [];

            cleanupCallbacks.forEach(callback => {
                try {
                    callback();
                } catch (e) {
                    console.log('TikTok cleanup error:', e);
                }
            });
            cleanupCallbacks = [];

            securityAnalysis.clearAll();

            console.log('✅ TikTok Security Analysis stopped completely');
        };

        const autoStopTimeout = setTimeout(() => {
            console.warn(`⏰ Auto-stopping TikTok analysis after ${CONFIG.autoStopMinutes} minutes`);
            window.stopTikTokAnalysis();
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

    // 7. Инициализация TikTok мониторинга
    function startTikTokAnalysis() {
        console.log('🚀 STARTING TIKTOK MEMORY-SAFE SECURITY ANALYSIS...');

        const lifecycle = setupLifecycleManagement();

        setupMemorySafeFetchInterception();

        const xhrCleanup = setupMemorySafeXHRInterception();
        if (xhrCleanup) lifecycle.registerCleanup(xhrCleanup);

        const perfObserver = setupSafePerformanceObserver();
        if (perfObserver) lifecycle.registerCleanup(() => perfObserver.disconnect());

        const videoCleanup = setupVideoElementMonitoring();
        if (videoCleanup) lifecycle.registerCleanup(videoCleanup);

        // Периодический сбор статистики
        const statsInterval = setInterval(() => {
            const stats = {
                requests: securityAnalysis.network.requests.length,
                awemeRequests: securityAnalysis.network.awemeRequests.size,
                videoRequests: securityAnalysis.network.videoRequests.size,
                videoElements: securityAnalysis.dom.videoElements.size,
                websockets: securityAnalysis.network.websockets.length,
                domEvents: securityAnalysis.dom.events.length,
                authFlows: securityAnalysis.security.authFlows.length,
                perfEntries: securityAnalysis.timing.performanceEntries.length,
                memory: Math.round(performance.memory?.usedJSHeapSize / 1048576) || 'N/A'
            };

            console.log('📈 TikTok Memory-Safe Stats:', stats);

            if (performance.memory && performance.memory.usedJSHeapSize > 500 * 1048576) {
                console.warn('🚨 High memory usage detected, clearing old data');
                securityAnalysis.clearAll();
            }
        }, 15000);

        lifecycle.registerInterval(statsInterval);

        setupTikTokCommands();

        console.log('✅ TIKTOK MEMORY-SAFE SECURITY ANALYSIS ACTIVE!');
        console.log('💡 Available commands:');
        console.log('💡 stopTikTokAnalysis() - Complete shutdown');
        console.log('💡 getTikTokMemoryStats() - Current memory usage');
        console.log('💡 getAwemeRequests() - View aweme API calls');
        console.log('💡 getSignatureData() - View signature parameters');
    }

    // Команды для TikTok анализа
    function setupTikTokCommands() {
        window.getTikTokMemoryStats = function() {
            const stats = {
                requests: securityAnalysis.network.requests.length,
                awemeRequests: securityAnalysis.network.awemeRequests.size,
                videoRequests: securityAnalysis.network.videoRequests.size,
                videoElements: securityAnalysis.dom.videoElements.size,
                websockets: securityAnalysis.network.websockets.length,
                domEvents: securityAnalysis.dom.events.length,
                authFlows: securityAnalysis.security.authFlows.length,
                perfEntries: securityAnalysis.timing.performanceEntries.length
            };

            if (performance.memory) {
                stats.memoryMB = Math.round(performance.memory.usedJSHeapSize / 1048576);
                stats.memoryLimitMB = Math.round(performance.memory.jsHeapSizeLimit / 1048576);
            }

            console.log('💾 TikTok Memory Statistics:', stats);
            return stats;
        };

        window.clearTikTokData = function() {
            securityAnalysis.clearAll();
            console.log('🧹 TikTok data cleared');
        };

        window.getAwemeRequests = function() {
            const requests = Array.from(securityAnalysis.network.awemeRequests.entries());
            console.log('📱 Aweme API Requests:', requests);
            return requests;
        };

        window.getSignatureData = function() {
            console.log('🔐 TikTok Signature Data:', securityAnalysis.security.signatureParams);
            return securityAnalysis.security.signatureParams;
        };

        window.getVideoRequests = function() {
            const requests = Array.from(securityAnalysis.network.videoRequests.entries());
            console.log('🎬 Video Requests:', requests);
            return requests;
        };
    }

    // Запуск анализа TikTok
    startTikTokAnalysis();

})();