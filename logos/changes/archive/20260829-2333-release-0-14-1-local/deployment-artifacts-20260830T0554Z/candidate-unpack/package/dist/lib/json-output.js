import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
const _pkg = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../package.json'), 'utf-8'));
export const VERSION = _pkg.version;
export function parseFormat(args) {
    const idx = args.indexOf('--format');
    if (idx !== -1 && args[idx + 1] === 'json') {
        return 'json';
    }
    return 'text';
}
export function makeEnvelope(command, data) {
    return {
        command,
        version: VERSION,
        timestamp: new Date().toISOString(),
        data,
    };
}
export function makeErrorEnvelope(command, code, message) {
    return {
        command,
        version: VERSION,
        timestamp: new Date().toISOString(),
        error: { code, message },
    };
}
//# sourceMappingURL=json-output.js.map