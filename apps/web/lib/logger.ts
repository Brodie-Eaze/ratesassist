/**
 * Structured logger (pino) for apps/web.
 *
 * - JSON output to stdout (pretty-printed in dev via pino-pretty).
 * - AU timezone in human-facing timestamps; ISO timestamps under `time`.
 * - Redacts well-known sensitive keys/headers to keep PII out of logs.
 * - Use `logger.child({ scope: "..." })` to add a route/tool scope.
 *
 * IMPORTANT: child processes that speak MCP over stdout (e.g. adapter-demo)
 * MUST NOT use this default destination — pipe to fd 2 instead. See
 * packages/adapter-demo for the stderr-bound child logger.
 */

import pino, { type Logger, type LoggerOptions } from "pino";

const REDACT_PATHS: readonly string[] = [
  "password",
  "*.password",
  "token",
  "*.token",
  "apiKey",
  "*.apiKey",
  "email",
  "*.email",
  "phone",
  "*.phone",
  "abn",
  "*.abn",
  "headers.authorization",
  "headers.Authorization",
  "headers.cookie",
  "headers.Cookie",
  "req.headers.authorization",
  "req.headers.cookie",
  "request.headers.authorization",
  "request.headers.cookie",
];

const isDev =
  process.env.NODE_ENV !== "production" && process.env.NODE_ENV !== "test";

const baseOptions: LoggerOptions = {
  level: process.env.LOG_LEVEL ?? (isDev ? "debug" : "info"),
  base: {
    service: "ratesassist-web",
    env: process.env.NODE_ENV ?? "development",
  },
  timestamp: (): string => {
    // AU timezone (Australia/Sydney) for human-readable `auTime`,
    // alongside the ISO `time` field pino emits by default.
    const now = new Date();
    const auTime = now.toLocaleString("en-AU", {
      timeZone: "Australia/Sydney",
      hour12: false,
    });
    return `,"time":"${now.toISOString()}","auTime":"${auTime}"`;
  },
  redact: {
    paths: [...REDACT_PATHS],
    censor: "[REDACTED]",
    remove: false,
  },
  formatters: {
    level: (label: string): { level: string } => ({ level: label }),
  },
};

function makeLogger(): Logger {
  if (isDev) {
    try {
      return pino({
        ...baseOptions,
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:standard",
            ignore: "pid,hostname",
          },
        },
      });
    } catch {
      // pino-pretty optional — fall through to JSON.
    }
  }
  return pino(baseOptions);
}

export const logger: Logger = makeLogger();

/** Convenience: create a child logger with a scope tag. */
export function scoped(scope: string, extra: Record<string, unknown> = {}): Logger {
  return logger.child({ scope, ...extra });
}

export type { Logger } from "pino";
