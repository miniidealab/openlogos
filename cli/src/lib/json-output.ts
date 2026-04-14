export const VERSION = '0.6.1';

export type OutputFormat = 'text' | 'json';

export function parseFormat(args: string[]): OutputFormat {
  const idx = args.indexOf('--format');
  if (idx !== -1 && args[idx + 1] === 'json') {
    return 'json';
  }
  return 'text';
}

export interface JsonEnvelope {
  command: string;
  version: string;
  timestamp: string;
  data?: unknown;
  error?: {
    code: string;
    message: string;
  };
}

export function makeEnvelope(command: string, data: unknown): JsonEnvelope {
  return {
    command,
    version: VERSION,
    timestamp: new Date().toISOString(),
    data,
  };
}

export function makeErrorEnvelope(command: string, code: string, message: string): JsonEnvelope {
  return {
    command,
    version: VERSION,
    timestamp: new Date().toISOString(),
    error: { code, message },
  };
}
