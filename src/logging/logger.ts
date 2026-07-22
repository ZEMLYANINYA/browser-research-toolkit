import { BoundedList } from '../storage/bounded-store.js';
import type { ErrorEntry, LogLevel, ResearchConfig } from '../types.js';

const LEVEL_WEIGHT: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

const STYLES: Record<LogLevel, string> = {
  debug: 'color: #9E9E9E;',
  info: 'color: #2196F3; font-weight: bold;',
  warn: 'color: #FF9800; font-weight: bold;',
  error: 'color: #F44336; font-weight: bold;',
};

export class Logger {
  private readonly errors = new BoundedList<ErrorEntry>(100);
  // Captured at construction time — before ErrorMonitor (or anything else) can
  // patch console.error. Logger must never call the *current* console.error,
  // only this one, or a patched console.error that itself logs through here
  // recurses forever (console.error -> logError -> console.error -> ...).
  private readonly rawConsoleError = console.error.bind(console);

  constructor(private readonly config: ResearchConfig) {}

  log(level: LogLevel, message: string, data?: unknown): void {
    if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[this.config.logLevel]) return;
    console.log(`%c[Research] ${message}`, STYLES[level], data ?? '');
  }

  logDiscovery(type: string, message: string, data?: unknown): void {
    if (this.config.logLevel === 'error') return;

    console.groupCollapsed(
      `%c${type} %c${message}`,
      'color: #FF6B6B; font-weight: bold; background: #FFF3E0; padding: 2px 6px; border-radius: 3px;',
      'color: #00897B; font-weight: normal;',
    );
    if (data && this.config.logLevel === 'debug') {
      console.log('📋 Data:', data);
    }
    console.groupEnd();
  }

  logError(type: string, error: unknown, context?: unknown): void {
    this.rawConsoleError(
      `%c❌ ${type}`,
      'color: #FF5252; font-weight: bold; background: #FFEBEE; padding: 2px 6px; border-radius: 3px;',
      error,
      context,
    );

    const err = error instanceof Error ? error : undefined;
    this.errors.push({
      type,
      error: err?.message ?? String(error),
      context,
      timestamp: Date.now(),
      stack: err?.stack,
    });
  }

  getErrors(limit = 50): ErrorEntry[] {
    return this.errors.tail(limit);
  }

  clearErrors(): void {
    this.errors.clear();
  }

  printHelp(config: ResearchConfig): void {
    console.log('%c╔══════════════════════════════════════════════════════════╗', 'color: #4CAF50; font-weight: bold;');
    console.log('%c║  🔬 BROWSER RESEARCH TOOLKIT                             ║', 'color: #4CAF50; font-weight: bold;');
    console.log('%c╚══════════════════════════════════════════════════════════╝', 'color: #4CAF50; font-weight: bold;');
    console.log('%c\n📚 Available Commands:', 'color: #2196F3; font-weight: bold; font-size: 14px;');
    console.log('%c\n  Data Collection:', 'color: #FF9800; font-weight: bold;');
    console.log('    research.getSummary()         - collection stats');
    console.log('    research.getEndpoints()       - discovered API endpoints');
    console.log('    research.getJsonResponses()   - JSON responses seen');
    console.log('    research.getWebSockets()      - WebSocket connections');
    console.log('    research.getErrors()          - error history');
    console.log('%c\n  Export & Control:', 'color: #FF9800; font-weight: bold;');
    console.log('    research.exportData()         - export everything to JSON');
    console.log('    research.clearData()          - clear collected data');
    console.log('    research.stop()               - pause collection');
    console.log('    research.start()              - resume collection');
    console.log('    research.cleanup()            - restore patched globals');
    console.log('%c\n⚙️  Current Config:', 'color: #9C27B0; font-weight: bold;');
    console.log(`    Max Requests: ${config.maxRequests}`);
    console.log(`    Max Events: ${config.maxEvents}`);
    console.log(`    Max Endpoints: ${config.maxEndpoints}`);
    console.log(`    Redact Sensitive: ${config.redactSensitive}`);
    console.log(`    Log Level: ${config.logLevel}`);
  }
}
