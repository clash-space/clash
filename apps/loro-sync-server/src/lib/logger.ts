/**
 * Structured Logger for Cloudflare Workers
 * Outputs JSON format for Logpush integration
 *
 * 在本地开发环境下，日志同时输出到控制台和文件（.log/loro-sync-server.log）
 * 在生产环境（Cloudflare Workers）下，只输出到控制台（由 Logpush 收集）
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export interface LogContext {
  requestId?: string;
  action?: string;
  nodeId?: string;
  taskId?: string;
  projectId?: string;
  duration?: string;
  [key: string]: unknown;
}

// 文件日志写入器（仅在本地开发环境使用）
class FileLogger {
  private static instance: FileLogger | null = null;
  private logFilePath: string | null = null;
  private isLocalDev: boolean = false;

  private constructor() {
    // 检测是否为本地开发环境（wrangler dev）
    this.isLocalDev = typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production';

    if (this.isLocalDev) {
      try {
        // 在本地开发环境下创建日志目录和文件
        const logDir = path.resolve(process.cwd(), '../../.log');
        if (!fs.existsSync(logDir)) {
          fs.mkdirSync(logDir, { recursive: true });
        }
        this.logFilePath = path.join(logDir, 'loro-sync-server.log');
      } catch (error) {
        console.warn('Failed to initialize file logger:', error);
        this.logFilePath = null;
      }
    }
  }

  static getInstance(): FileLogger {
    if (!FileLogger.instance) {
      FileLogger.instance = new FileLogger();
    }
    return FileLogger.instance;
  }

  write(logLine: string): void {
    if (this.isLocalDev && this.logFilePath) {
      try {
        fs.appendFileSync(this.logFilePath, logLine + '\n', 'utf-8');
      } catch (error) {
        // 文件写入失败时静默处理，避免影响主流程
      }
    }
  }
}

export class Logger {
  private readonly module: string;
  private readonly requestId?: string;
  private fileLogger: FileLogger;

  constructor(module: string, requestId?: string) {
    this.module = module;
    this.requestId = requestId;
    this.fileLogger = FileLogger.getInstance();
  }

  private format(level: LogLevel, message: string, context?: LogContext): string {
    return JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      module: this.module,
      requestId: this.requestId || context?.requestId,
      message,
      ...context,
    });
  }

  private log(level: LogLevel, message: string, context?: LogContext): void {
    const logLine = this.format(level, message, context);

    // 输出到控制台
    switch (level) {
      case 'DEBUG':
        console.debug(logLine);
        break;
      case 'INFO':
        console.info(logLine);
        break;
      case 'WARN':
        console.warn(logLine);
        break;
      case 'ERROR':
        console.error(logLine);
        break;
    }

    // 在本地开发环境下同时写入文件
    this.fileLogger.write(logLine);
  }

  debug(message: string, context?: LogContext): void {
    this.log('DEBUG', message, context);
  }

  info(message: string, context?: LogContext): void {
    this.log('INFO', message, context);
  }

  warn(message: string, context?: LogContext): void {
    this.log('WARN', message, context);
  }

  error(message: string, error?: Error, context?: LogContext): void {
    const errorContext = error ? {
      errorName: error.name,
      errorMessage: error.message,
      stack: error.stack?.split('\n').slice(0, 5).join('\n'),
      ...context,
    } : context;
    this.log('ERROR', message, errorContext);
  }

  /**
   * Create a child logger with a sub-module name
   */
  child(subModule: string): Logger {
    return new Logger(`${this.module}:${subModule}`, this.requestId);
  }

  /**
   * Create a child logger with a specific requestId
   */
  withRequestId(requestId: string): Logger {
    return new Logger(this.module, requestId);
  }
}

/**
 * Factory function to create loggers
 */
export function createLogger(module: string, requestId?: string): Logger {
  return new Logger(module, requestId);
}
