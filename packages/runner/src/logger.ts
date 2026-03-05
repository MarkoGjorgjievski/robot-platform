import { db } from '@robot/db';
import { runs } from '@robot/db/schema';
import { eq } from 'drizzle-orm';

type LogLevel = 'info' | 'warn' | 'error';

type LogEntry = {
  timestamp: string;
  level: LogLevel;
  message: string;
};

export class RunLogger {
  private entries: LogEntry[] = [];
  private runId: string;

  constructor(runId: string) {
    this.runId = runId;
  }

  log(level: LogLevel, message: string) {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
    };
    this.entries.push(entry);
    console.log(`[${entry.timestamp}] [${level.toUpperCase()}] ${message}`);
  }

  info(message: string) { this.log('info', message); }
  warn(message: string) { this.log('warn', message); }
  error(message: string) { this.log('error', message); }

  async flush() {
    await db.update(runs)
      .set({ logs: JSON.stringify(this.entries) })
      .where(eq(runs.id, this.runId));
  }
}
