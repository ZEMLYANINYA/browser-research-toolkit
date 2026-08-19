// utils/analyzer.js
class AntiBotAnalyzer {
    static analyzeLogs(logs) {
        const analysis = {
            totalRequests: 0,
            byType: {},
            timelines: {},
            suspiciousActivities: []
        };

        logs.forEach(log => {
            analysis.totalRequests++;
            
            // Группировка по типу
            analysis.byType[log.type] = (analysis.byType[log.type] || 0) + 1;
            
            // Временные линии
            const minute = new Date(log.timestamp).toISOString().substring(0, 16);
            analysis.timelines[minute] = (analysis.timelines[minute] || 0) + 1;
            
            // Поиск подозрительной активности
            if (this.isSuspicious(log)) {
                analysis.suspiciousActivities.push(log);
            }
        });

        return analysis;
    }

    static isSuspicious(log) {
        const suspiciousPatterns = [
            'captcha', 'recaptcha', 'challenge', 'fingerprint',
            'bot', 'block', 'detect', 'validate'
        ];

        const dataStr = JSON.stringify(log.data).toLowerCase();
        return suspiciousPatterns.some(pattern => dataStr.includes(pattern));
    }

    static exportToCSV(logs) {
        const headers = ['timestamp', 'type', 'url', 'data'];
        const csv = [headers.join(',')];
        
        logs.forEach(log => {
            const row = [
                new Date(log.timestamp).toISOString(),
                log.type,
                `"${log.url}"`,
                `"${JSON.stringify(log.data).replace(/"/g, '""')}"`
            ];
            csv.push(row.join(','));
        });
        
        return csv.join('\n');
    }
}