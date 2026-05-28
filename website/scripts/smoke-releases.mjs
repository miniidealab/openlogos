import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { RELEASE_SUMMARY_FALLBACK_MESSAGE } from '../src/lib/releases-summary.mjs';

const ROOT = process.cwd();
const RESULT_PATH = resolve(ROOT, '../logos/resources/verify/smoke-results.jsonl');
const DIST_DIR = resolve(ROOT, 'dist');
const RELEASE_DATA_PATH = resolve(ROOT, 'src/data/releases.json');
const GITHUB_LATEST_RELEASE_API = 'https://api.github.com/repos/miniidealab/openlogos/releases/latest';
const GITHUB_TIMEOUT_MS = 15000;
const WEBSITE_SMOKE_IDS = new Set(['SMOKE-core-03', 'SMOKE-core-07', 'SMOKE-core-08', 'SMOKE-core-15']);

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

function normalizeVersion(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/^v/, '');
  return normalized.length > 0 ? normalized : null;
}

async function fetchLatestReleaseTag() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GITHUB_TIMEOUT_MS);
  try {
    const response = await fetch(GITHUB_LATEST_RELEASE_API, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'openlogos-smoke-releases',
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`GitHub latest release API returned ${response.status}`);
    }
    const payload = await response.json();
    const tag = typeof payload.tag_name === 'string' ? payload.tag_name : '';
    const version = normalizeVersion(tag);
    if (!version) {
      throw new Error('GitHub latest release API missing tag_name');
    }
    return {
      tag,
      version,
      url: typeof payload.html_url === 'string' ? payload.html_url : null,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function run() {
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
    report('SMOKE-core-08', 'pass', 'home page links to releases');
  } catch (error) {
    report('SMOKE-core-08', 'fail', 'home page links to releases', String(error));
    throw error;
  }

  try {
    const releases = readHtml('releases/index.html');
    const versions = Array.isArray(releaseData.versions) ? releaseData.versions : [];
    const versionsWithEnglishValue = versions.filter((item) => item.valueSummaryEn?.length > 0);
    const versionsWithEnglishFix = versions.filter((item) => item.fixSummaryEn?.length > 0);
    const versionsWithChineseOriginal = versions.filter((item) => item.valueSummary?.length > 0 || item.fixSummary?.length > 0);
    const fallbackVersions = versions.filter((item) => item.summarySource === 'fallback');
    assert(releases.includes('OpenLogos Releases'), 'Release page missing title');
    assert(releases.includes('npm install -g @miniidealab/openlogos'), 'Release page missing install command');
    assert(releases.includes(latestVersionText), 'Release page missing latest version');
    assert(releases.includes('versions'), 'Release page missing version count label');
    assert(releases.includes(versionCountText), 'Release page missing version count value');
    assert(versionsWithEnglishValue.length > 0, 'Release data missing English value summaries');
    assert(versionsWithEnglishFix.length > 0, 'Release data missing English fix summaries');
    assert(versionsWithChineseOriginal.length > 0, 'Release data missing Chinese original summaries');
    assert(fallbackVersions.length > 0, 'Release data missing fallback summary markers');
    assert(releases.includes('What changed'), 'Release page missing value summary heading');
    assert(releases.includes('What got fixed'), 'Release page missing fix summary heading');
    assert(releases.includes('Chinese original'), 'Release page missing Chinese original disclosure');
    assert(releases.includes(versionsWithEnglishValue[0].valueSummaryEn[0]), 'Release page missing rendered English value summary');
    assert(releases.includes(versionsWithEnglishFix[0].fixSummaryEn[0]), 'Release page missing rendered English fix summary');
    assert(releases.includes(RELEASE_SUMMARY_FALLBACK_MESSAGE), 'Release page missing fixed fallback summary text');
    assert(releases.includes('CHANGELOG'), 'Release page missing changelog links');
    report('SMOKE-core-07', 'pass', 'release page shows bilingual version summaries');
  } catch (error) {
    report('SMOKE-core-07', 'fail', 'release page shows bilingual version summaries', String(error));
    throw error;
  }

  try {
    const releases = readHtml('releases/index.html');
    assert(releases.includes('GitHub Release'), 'Release page missing external links');
    assert(releases.includes('maintained bilingual release data'), 'Release page missing bilingual source explanation');
    assert(releases.includes('structured CHANGELOG extraction'), 'Release page missing Chinese original source explanation');
    report('SMOKE-core-03', 'pass', 'website build includes release history page');
  } catch (error) {
    report('SMOKE-core-03', 'fail', 'website build includes release history page', String(error));
    throw error;
  }

  try {
    const latestTag = await fetchLatestReleaseTag();
    assert(
      releaseData.latestVersion === latestTag.version,
      `Release latestVersion mismatch: site=${releaseData.latestVersion}, tag=${latestTag.tag}`,
    );
    report(
      'SMOKE-core-15',
      'pass',
      `tag release sync: latest=${releaseData.latestVersion}, tag=${latestTag.tag}, release=${latestTag.url ?? 'n/a'}`,
    );
  } catch (error) {
    report('SMOKE-core-15', 'fail', 'tag release latest version matches website release', String(error));
    throw error;
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
