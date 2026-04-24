/**
 * Logger utility for Next.js application
 *
 * 在服务器端运行时，日志会同时输出到控制台和文件（.log/web.log）
 * 在客户端运行时，只输出到浏览器控制台
 */

import fs from 'fs';
import path from 'path';

type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

interface LogContext {
  [key: string]: unknown;
}

/**
 * 文件日志写入器（仅在服务器端使用）
 */
class FileLogger {
  private static instance: FileLogger | null = null;
  private logFilePath: string | null = null;
  private isServer: boolean = false;

  private constructor() {
    // 检测是否在服务器端运行
    this.isServer = typeof window === 'undefined';

    if (this.isServer) {
      try {
        // 创建日志目录
        const logDir = path.resolve(process.cwd(), '../../.log');
        if (!fs.existsSync(logDir)) {
          fs.mkdirSync(logDir, { recursive: true });
        }
        this.logFilePath = path.join(logDir, 'web.log');
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
    if (this.isServer && this.logFilePath) {
      try {
        fs.appendFileSync(this.logFilePath, logLine + '\n', 'utf-8');
      } catch (error) {
        // 文件写入失败时静默处理，避免影响主流程
      }
    }
  }
}

/**
 * Logger 类
 * 提供结构化的日志输出功能
 */
export class Logger {
  private readonly module: string;
  private fileLogger: FileLogger | null = null;

  constructor(module: string) {
    this.module = module;

    // 只在服务器端初始化文件日志
    if (typeof window === 'undefined') {
      this.fileLogger = FileLogger.getInstance();
    }
  }

  private format(level: LogLevel, message: string, context?: LogContext): string {
    return JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      module: this.module,
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

    // 在服务器端同时写入文件
    this.fileLogger?.write(logLine);
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
    const errorContext = error
      ? {
          errorName: error.name,
          errorMessage: error.message,
          stack: error.stack?.split('\n').slice(0, 5).join('\n'),
          ...context,
        }
      : context;
    this.log('ERROR', message, errorContext);
  }

  /**
   * 创建子日志器，附加模块名称
   */
  child(subModule: string): Logger {
    return new Logger(`${this.module}:${subModule}`);
  }
}

/**
 * 创建日志器的工厂函数
 */
export function createLogger(module: string): Logger {
  return new Logger(module);
}

/**
 * 默认导出一个全局日志器
 */
export const logger = new Logger('web');
