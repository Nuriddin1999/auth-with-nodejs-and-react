/** Minimal leveled logger: "{time} {LEVEL} {name}: {message}". */

import { format } from 'node:util';
import { settings } from '../config.ts';

const LEVELS = { DEBUG: 10, INFO: 20, WARNING: 30, ERROR: 40 } as const;
type Level = keyof typeof LEVELS;

export interface LogRecord {
  name: string;
  level: Level;
  message: string;
}

/** Tests push functions here to capture log records. */
export const logSinks: Array<(record: LogRecord) => void> = [];

export function getLogger(name: string) {
  const log = (level: Level, args: unknown[]) => {
    const record: LogRecord = { name, level, message: format(...args) };
    for (const sink of logSinks) sink(record);
    const threshold = LEVELS[settings.LOG_LEVEL as Level] ?? LEVELS.INFO;
    if (LEVELS[level] < threshold || process.env.NODE_ENV === 'test') return;
    const time = new Date().toISOString().replace('T', ' ').slice(0, 23);
    const line = `${time} ${level} ${name}: ${record.message}`;
    if (LEVELS[level] >= LEVELS.WARNING) console.error(line);
    else console.log(line);
  };
  return {
    debug: (...args: unknown[]) => log('DEBUG', args),
    info: (...args: unknown[]) => log('INFO', args),
    warning: (...args: unknown[]) => log('WARNING', args),
    error: (...args: unknown[]) => log('ERROR', args),
  };
}
