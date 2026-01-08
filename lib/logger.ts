import { parseStackTrace, StackFrame } from './stackTrace';

export type LogLevel = 'info' | 'warn' | 'error' | 'fatal';

export interface LogEntry {
  id: string;
  timestamp: number;
  level: LogLevel;
  message: string;
  frames?: StackFrame[]; // Parsed stack trace for errors
  context?: any;         // The variable state when the log occurred
}

class ForensicLogger {
  private logs: LogEntry[] = [];
  private listeners: ((logs: LogEntry[]) => void)[] = [];
  private maxLogs = 500;

  public log(level: LogLevel, message: string, context?: any, error?: Error) {
    let frames: StackFrame[] | undefined;
    
    if (error && error.stack) {
      frames = parseStackTrace(error.stack);
    } else if (level === 'error' || level === 'fatal') {
      // Capture stack even if no error object provided
      frames = parseStackTrace(new Error().stack || '');
      // Remove the first few frames (this log function)
      frames = frames.slice(1);
    }

    const entry: LogEntry = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      level,
      message,
      context,
      frames
    };

    this.logs = [entry, ...this.logs].slice(0, this.maxLogs);
    this.notify();
    
    // Fallback to console for standard devtools
    if (level === 'error' || level === 'fatal') {
      console.error(`[${level.toUpperCase()}]`, message, context);
    } else {
      console.log(`[${level.toUpperCase()}]`, message);
    }
  }

  public getLogs() {
    return this.logs;
  }

  public subscribe(callback: (logs: LogEntry[]) => void) {
    this.listeners.push(callback);
    callback(this.logs);
    return () => {
      this.listeners = this.listeners.filter(cb => cb !== callback);
    };
  }

  public clear() {
    this.logs = [];
    this.notify();
  }

  private notify() {
    this.listeners.forEach(cb => cb(this.logs));
  }
}

export const Logger = new ForensicLogger();
