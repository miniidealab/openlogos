import { join } from 'node:path';

export const WORKBUDDY_HOST_BOUNDARIES = Object.freeze([
  { path: '.agents/plugins/marketplace.json', kind: 'file' },
  { path: '.codex/plugins/cache/personal/openlogos', kind: 'tree' },
  { path: '.codex/config.toml', kind: 'file' },
  { path: '.codebuddy', kind: 'tree' },
  { path: '.workbuddy-key-fallback', kind: 'tree' },
  { path: '.workbuddy/memory', kind: 'tree' },
  { path: '.workbuddy/settings.json', kind: 'file' },
  { path: '.workbuddy/plugins', kind: 'tree' },
  { path: '.workbuddy/user-state.json', kind: 'file' },
]);

export const WORKBUDDY_HOST_BOUNDARY_PATHS = Object.freeze(
  WORKBUDDY_HOST_BOUNDARIES.map(item => item.path),
);

const sandboxQuote = value => `"${String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;

export function buildWorkBuddyWriteDenySandboxProfile(hostHome) {
  const rules = WORKBUDDY_HOST_BOUNDARIES.map(item => {
    const selector = item.kind === 'tree' ? 'subpath' : 'literal';
    return `(deny file-write* (${selector} ${sandboxQuote(join(hostHome, item.path))}))`;
  });
  return ['(version 1)', '(allow default)', ...rules, ''].join('\n');
}
