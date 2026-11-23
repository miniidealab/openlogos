import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';

// Darwin 的历史默认值与当前宿主的临时路径都属于平台差异。
const defaultRoots = new Set(['/private/tmp', tmpdir(), realpathSync(tmpdir())].map(root => JSON.stringify(root)));

export function normalizeDefaultSandboxRoot(text) {
  return text.replace(
    /("sandbox"\s*:\s*\{[^{}]*?"root"\s*:\s*)("(?:[^"\\]|\\.)*")/g,
    (match, prefix, root) => defaultRoots.has(root) ? prefix + '"<SANDBOX_ROOT>"' : match,
  );
}
