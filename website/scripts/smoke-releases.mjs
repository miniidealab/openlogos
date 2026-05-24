import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const RESULT_PATH = resolve(ROOT, '../logos/resources/verify/smoke-results.jsonl');
const DIST_DIR = resolve(ROOT, 'dist');
const RELEASE_DATA_PATH = resolve(ROOT, 'src/data/releases.json');
const WEBSITE_SMOKE_IDS = new Set(['SMOKE-core-03', 'SMOKE-core-06', 'SMOKE-core-07']);

function removePreviousWebsiteResults() {
  mkdirSync(dirname(RESULT_PATH), { recursive: true });
  if (!existsSync(RESULT_PATH)) {
    writeFileSync(RESULT_PATH, '');
    return;
  }
  const kept = readFileSync(RESULT_PATH, 'utf-8')
    .split('\n')
    .filter((line) => {
      if (!line.trim()) return false;
      try {
        const item = JSON.parse(line);
        return !WEBSITE_SMOKE_IDS.has(item.id);
      } catch {
        return true;
      }
    });
  writeFileSync(RESULT_PATH, kept.length > 0 ? `${kept.join('\n')}\n` : '');
}

function report(id, status, scenario, error) {
  mkdirSync(dirname(RESULT_PATH), { recursive: true });
  const line = {
    id,
    status,
    timestamp: new Date().toISOString(),
    scenario,
  };
  if (error) line.error = error;
  appendFileSync(RESULT_PATH, `${JSON.stringify(line)}\n`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readHtml(path) {
  return readFileSync(resolve(DIST_DIR, path), 'utf-8');
}

function readReleaseData() {
  return JSON.parse(readFileSync(RELEASE_DATA_PATH, 'utf-8'));
}

removePreviousWebsiteResults();
const releaseData = readReleaseData();
const latestVersionText = `v${releaseData.latestVersion}`;
const versionCountText = String(releaseData.versionCount);

try {
  const index = readHtml('index.html');
  assert(index.includes('/releases'), 'Home page missing releases link');
  assert(index.includes('Release Feed'), 'Home page missing release feed section');
  assert(index.includes(latestVersionText), 'Home page missing latest release version');
  assert(index.includes(versionCountText), 'Home page missing release count');
  report('SMOKE-core-07', 'pass', 'home page links to releases');
} catch (error) {
  report('SMOKE-core-07', 'fail', 'home page links to releases', String(error));
  throw error;
}

try {
  const releases = readHtml('releases/index.html');
  assert(releases.includes('OpenLogos Releases'), 'Release page missing title');
  assert(releases.includes('npm install -g @miniidealab/openlogos'), 'Release page missing install command');
  assert(releases.includes(latestVersionText), 'Release page missing latest version');
  assert(releases.includes('versions'), 'Release page missing version count label');
  assert(releases.includes(versionCountText), 'Release page missing version count value');
  report('SMOKE-core-06', 'pass', 'release page shows latest and install command');
} catch (error) {
  report('SMOKE-core-06', 'fail', 'release page shows latest and install command', String(error));
  throw error;
}

try {
  const releases = readHtml('releases/index.html');
  assert(releases.includes('GitHub Release'), 'Release page missing external links');
  report('SMOKE-core-03', 'pass', 'website build includes release history page');
} catch (error) {
  report('SMOKE-core-03', 'fail', 'website build includes release history page', String(error));
  throw error;
}
