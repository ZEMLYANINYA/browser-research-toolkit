import type { CollectorContext } from '../context.js';
import type { Monitor } from '../types.js';

export class ErrorMonitor implements Monitor {
  private originalConsoleError: typeof console.error | null = null;
  private onError = (event: ErrorEvent) => {
    this.ctx.logger.logError('Global Error', event.error ?? event.message, {
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      type: 'global_error',
    });
  };
  private onRejection = (event: PromiseRejectionEvent) => {
    this.ctx.logger.logError('Unhandled Promise Rejection', event.reason, { type: 'promise_rejection' });
  };

  constructor(private readonly ctx: CollectorContext) {}

  install(): void {
    window.addEventListener('error', this.onError);
    window.addEventListener('unhandledrejection', this.onRejection);

    this.originalConsoleError = console.error;
    const original = this.originalConsoleError;
    const ctx = this.ctx;
    console.error = (...args: unknown[]) => {
      ctx.logger.logError('Console Error', args[0], { args: args.slice(1) });
      return original.apply(console, args as []);
    };
  }

  teardown(): void {
    window.removeEventListener('error', this.onError);
    window.removeEventListener('unhandledrejection', this.onRejection);
    if (this.originalConsoleError) console.error = this.originalConsoleError;
  }
}
