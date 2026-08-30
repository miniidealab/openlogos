export declare const VERSION: string;
export type OutputFormat = 'text' | 'json';
export declare function parseFormat(args: string[]): OutputFormat;
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
export declare function makeEnvelope(command: string, data: unknown): JsonEnvelope;
export declare function makeErrorEnvelope(command: string, code: string, message: string): JsonEnvelope;
//# sourceMappingURL=json-output.d.ts.map