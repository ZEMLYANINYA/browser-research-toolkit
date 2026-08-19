(function() {
    'use strict';

    const config = {
        logToConsole: true,
        logToStorage: true,
        maxStorageEntries: 1000,
        captureStackTraces: true,
        monitorKeywords: [
            'log', 'gen_204', 'check', 'ping', 'bot', 'captcha', 
            'recaptcha', 'cloudflare', 'challenge', 'validate',
            'verify', 'token', 'fingerprint', 'beacon'
        ]
    };

    class AntiBotMonitor {
        constructor() {
            this.logs = [];
            this.sessionId = this.generateSessionId();
            this.startTime = Date.now();
            this.init();
        }

        generateSessionId() {
            return Math.random().toString(36).substring(2) + Date.now().toString(36);
        }

        log(type, data, extra = {}) {
            const entry = {
                timestamp: Date.now(),
                sessionId: this.sessionId,
                type,
                data,
                extra,
                url: window.location.href,
                userAgent: navigator.userAgent,
                stack: config.captureStackTraces ? new Error().stack : undefined
            };

            this.logs.push(entry);

            if (config.logToConsole) {
                this.consoleLog(entry);
            }

            if (config.logToStorage) {
                this.saveToStorage(entry);
            }

            // Ограничение размера логов в памяти
            if (this.logs.length > config.maxStorageEntries) {
                this.logs = this.logs.slice(-config.maxStorageEntries);
            }
        }

        consoleLog(entry) {
            const colors = {
                FETCH: '🔥',
                XHR: '🧨',
                WEBSOCKET: '🔗',
                TIMER: '⏰',
                DOM: '🌳',
                EVENT: '🎯',
                STORAGE: '💾',
                ERROR: '❌',
                NETWORK: '📡'
            };

            const emoji = colors[entry.type] || '📝';
            console.group(`${emoji} ANTIBOT ${entry.type}:`, entry.timestamp);
            console.log('Data:', entry.data);
            if (entry.extra) console.log('Extra:', entry.extra);
            if (entry.stack) console.log('Stack:', entry.stack);
            console.groupEnd();
        }

        saveToStorage(entry) {
            try {
                const stored = JSON.parse(localStorage.getItem('antibot_monitor_logs') || '[]');
                stored.push(entry);
                
                // Ограничение размера в localStorage
                if (stored.length > config.maxStorageEntries) {
                    stored.splice(0, stored.length - config.maxStorageEntries);
                }
                
                localStorage.setItem('antibot_monitor_logs', JSON.stringify(stored));
                localStorage.setItem('antibot_monitor_last_update', Date.now());
            } catch (e) {
                console.warn('Failed to save to storage:', e);
            }
        }

        exportLogs() {
            return {
                sessionId: this.sessionId,
                startTime: this.startTime,
                exportTime: Date.now(),
                logs: this.logs,
                userAgent: navigator.userAgent,
                url: window.location.href,
                platform: navigator.platform,
                plugins: Array.from(navigator.plugins || []).map(p => p.name)
            };
        }

        init() {
            this.monitorFetch();
            this.monitorXHR();
            this.monitorWebSockets();
            this.monitorTimers();
            this.monitorDOM();
            this.monitorEvents();
            this.monitorStorage();
            this.monitorErrors();
            this.monitorNetwork();
            
            // Экспорт логов в глобальную область
            window.getAntiBotLogs = () => this.exportLogs();
            window.clearAntiBotLogs = () => {
                this.logs = [];
                localStorage.removeItem('antibot_monitor_logs');
            };

            console.log(`🚀 ANTIBOT MONITOR ACTIVE - Session: ${this.sessionId}`);
        }

        monitorFetch() {
            const origFetch = window.fetch;
            window.fetch = async (...args) => {
                const url = args[0]?.toString() || "";
                const shouldLog = config.monitorKeywords.some(kw => url.includes(kw));
                
                if (shouldLog) {
                    this.log('FETCH', {
                        url,
                        method: args[1]?.method || 'GET',
                        headers: args[1]?.headers,
                        body: args[1]?.body
                    }, {
                        arguments: args
                    });
                }

                const startTime = Date.now();
                try {
                    const response = await origFetch.apply(this, args);
                    
                    if (shouldLog) {
                        this.log('FETCH_RESPONSE', {
                            url,
                            status: response.status,
                            statusText: response.statusText,
                            responseTime: Date.now() - startTime
                        });
                    }
                    
                    return response;
                } catch (error) {
                    if (shouldLog) {
                        this.log('FETCH_ERROR', {
                            url,
                            error: error.message,
                            responseTime: Date.now() - startTime
                        });
                    }
                    throw error;
                }
            };
        }

        monitorXHR() {
            const origOpen = XMLHttpRequest.prototype.open;
            const origSend = XMLHttpRequest.prototype.send;
            const xhrMap = new WeakMap();

            XMLHttpRequest.prototype.open = function(method, url, ...rest) {
                xhrMap.set(this, { method, url, startTime: Date.now() });
                
                const shouldLog = config.monitorKeywords.some(kw => url.includes(kw));
                if (shouldLog) {
                    this._antibot_monitored = true;
                    monitor.log('XHR', {
                        method,
                        url,
                        async: rest[0],
                        user: rest[2]
                    });
                }

                return origOpen.call(this, method, url, ...rest);
            };

            XMLHttpRequest.prototype.send = function(body) {
                const xhrData = xhrMap.get(this);
                
                if (this._antibot_monitored) {
                    monitor.log('XHR_SEND', {
                        url: xhrData.url,
                        body: body
                    });
                }

                this.addEventListener('readystatechange', () => {
                    if (this.readyState === 4 && this._antibot_monitored) {
                        monitor.log('XHR_RESPONSE', {
                            url: xhrData.url,
                            status: this.status,
                            statusText: this.statusText,
                            responseTime: Date.now() - xhrData.startTime,
                            response: this.response
                        });
                    }
                });

                return origSend.call(this, body);
            };
        }

        monitorWebSockets() {
            const origWebSocket = window.WebSocket;
            window.WebSocket = function(url, protocols) {
                const shouldLog = config.monitorKeywords.some(kw => url.includes(kw));
                
                if (shouldLog) {
                    monitor.log('WEBSOCKET', {
                        url,
                        protocols
                    });
                }

                const ws = protocols ? new origWebSocket(url, protocols) : new origWebSocket(url);
                
                ws.addEventListener('open', (event) => {
                    if (shouldLog) monitor.log('WEBSOCKET_OPEN', { url });
                });

                ws.addEventListener('message', (event) => {
                    if (shouldLog) monitor.log('WEBSOCKET_MESSAGE', { 
                        url, 
                        data: event.data 
                    });
                });

                ws.addEventListener('error', (event) => {
                    if (shouldLog) monitor.log('WEBSOCKET_ERROR', { url });
                });

                ws.addEventListener('close', (event) => {
                    if (shouldLog) monitor.log('WEBSOCKET_CLOSE', { 
                        url, 
                        code: event.code,
                        reason: event.reason 
                    });
                });

                return ws;
            };
        }

        monitorTimers() {
            const origSetTimeout = window.setTimeout;
            const origSetInterval = window.setInterval;

            window.setTimeout = function(callback, delay, ...args) {
                const stack = new Error().stack;
                if (delay < 1000) { // Логируем только быстрые таймеры
                    monitor.log('TIMER', {
                        type: 'setTimeout',
                        delay,
                        stack
                    });
                }
                return origSetTimeout.call(this, callback, delay, ...args);
            };

            window.setInterval = function(callback, delay, ...args) {
                const stack = new Error().stack;
                monitor.log('TIMER', {
                    type: 'setInterval',
                    delay,
                    stack
                });
                return origSetInterval.call(this, callback, delay, ...args);
            };
        }

        monitorDOM() {
            const observer = new MutationObserver((mutations) => {
                mutations.forEach((mutation) => {
                    if (mutation.addedNodes.length) {
                        mutation.addedNodes.forEach((node) => {
                            if (node.nodeType === 1) { // Element node
                                const html = node.outerHTML;
                                if (config.monitorKeywords.some(kw => 
                                    html.toLowerCase().includes(kw.toLowerCase()))) {
                                    monitor.log('DOM', {
                                        type: 'node_added',
                                        html: html.substring(0, 500),
                                        attributes: Array.from(node.attributes || []).map(attr => ({
                                            name: attr.name,
                                            value: attr.value
                                        }))
                                    });
                                }
                            }
                        });
                    }
                });
            });

            observer.observe(document, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['class', 'id', 'name', 'style']
            });
        }

        monitorEvents() {
            const events = ['click', 'mousemove', 'keydown', 'keyup', 'scroll', 'focus', 'blur'];
            events.forEach(eventType => {
                document.addEventListener(eventType, (e) => {
                    if (Math.random() < 0.01) { // Логируем 1% событий чтобы не засорять
                        monitor.log('EVENT', {
                            type: eventType,
                            target: e.target?.tagName,
                            coordinates: {
                                x: e.clientX,
                                y: e.clientY
                            },
                            key: e.key
                        });
                    }
                }, { capture: true });
            });
        }

        monitorStorage() {
            const origSetItem = localStorage.setItem;
            localStorage.setItem = function(key, value) {
                if (config.monitorKeywords.some(kw => 
                    key.toLowerCase().includes(kw.toLowerCase()) || 
                    String(value).toLowerCase().includes(kw.toLowerCase()))) {
                    monitor.log('STORAGE', {
                        type: 'localStorage_set',
                        key,
                        value: String(value).substring(0, 200)
                    });
                }
                return origSetItem.call(this, key, value);
            };
        }

        monitorErrors() {
            window.addEventListener('error', (e) => {
                monitor.log('ERROR', {
                    message: e.message,
                    filename: e.filename,
                    lineno: e.lineno,
                    colno: e.colno,
                    error: e.error?.toString()
                });
            });

            window.addEventListener('unhandledrejection', (e) => {
                monitor.log('ERROR', {
                    type: 'unhandledrejection',
                    reason: e.reason?.toString()
                });
            });
        }

        monitorNetwork() {
            if ('connection' in navigator) {
                const connection = navigator.connection;
                monitor.log('NETWORK', {
                    type: 'connection_info',
                    downlink: connection.downlink,
                    effectiveType: connection.effectiveType,
                    rtt: connection.rtt
                });
            }

            // Мониторинг производительности
            if ('performance' in window) {
                setTimeout(() => {
                    const perfEntries = performance.getEntriesByType('navigation');
                    if (perfEntries.length > 0) {
                        const nav = perfEntries[0];
                        monitor.log('NETWORK', {
                            type: 'performance_navigation',
                            domContentLoaded: nav.domContentLoadedEventEnd - nav.navigationStart,
                            loadComplete: nav.loadEventEnd - nav.navigationStart,
                            dnsLookup: nav.domainLookupEnd - nav.domainLookupStart
                        });
                    }
                }, 1000);
            }
        }
    }

    const monitor = new AntiBotMonitor();
})();