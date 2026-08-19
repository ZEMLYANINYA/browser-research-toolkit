// Получить все логи
const logs = window.getAntiBotLogs();

// Проанализировать
const analysis = AntiBotAnalyzer.analyzeLogs(logs.logs);

// Экспорт в CSV
const csv = AntiBotAnalyzer.exportToCSV(logs.logs);