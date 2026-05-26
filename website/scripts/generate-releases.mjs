import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { enrichReleaseVersions } from '../src/lib/releases-summary.mjs';

const PACKAGE_NAME = '@miniidealab/openlogos';
const REGISTRY_URL = `https://registry.npmjs.org/${encodeURIComponent(PACKAGE_NAME)}`;
const OUTPUT_PATH = resolve('src/data/releases.json');
const CHANGELOG_PATH = resolve('../CHANGELOG.md');
const NPM_PACKAGE_URL = `https://www.npmjs.com/package/${PACKAGE_NAME}`;
const GITHUB_RELEASE_BASE = 'https://github.com/miniidealab/openlogos/releases/tag';
const CHANGELOG_URL = 'https://github.com/miniidealab/openlogos/blob/master/CHANGELOG.md';

function readCache() {
  if (!existsSync(OUTPUT_PATH)) return null;
  return JSON.parse(readFileSync(OUTPUT_PATH, 'utf-8'));
}

function formatBytes(value) {
  if (!Number.isFinite(value) || value <= 0) return null;
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = value;
  let unit = units[0];
  for (let i = 0; i < units.length - 1 && size >= 1024; i += 1) {
    size /= 1024;
    unit = units[i + 1];
  }
  return `${size >= 10 || unit === 'B' ? Math.round(size) : size.toFixed(1)} ${unit}`;
}

function compareVersionsDesc(a, b) {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (right[i] ?? 0) - (left[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

async function getTarballSize(tarballUrl) {
  try {
    const response = await fetch(tarballUrl, { method: 'GET' });
    if (!response.ok) return null;
    const contentLength = response.headers.get('content-length');
    if (!contentLength) return null;
    if (response.body?.cancel) {
      await response.body.cancel();
    }
    const size = Number(contentLength);
    return Number.isFinite(size) ? size : null;
  } catch {
    return null;
  }
}

function buildDistTagMap(distTags) {
  const result = new Map();
  for (const [tag, version] of Object.entries(distTags ?? {})) {
    if (!result.has(version)) result.set(version, []);
    result.get(version).push(tag);
  }
  return result;
}

function buildReleaseData(packument) {
  const distTags = packument['dist-tags'] ?? {};
  const tagMap = buildDistTagMap(distTags);
  const versions = Object.entries(packument.versions ?? {})
    .map(([version, metadata]) => {
      const dist = metadata.dist ?? {};
      const dependencies = metadata.dependencies ?? {};
      const engines = metadata.engines ?? {};
      return {
        version,
        publishedAt: packument.time?.[version] ?? null,
        npmUrl: `${NPM_PACKAGE_URL}/v/${version}`,
        githubReleaseUrl: `${GITHUB_RELEASE_BASE}/v${version}`,
        tarballUrl: dist.tarball ?? null,
        gitHead: metadata.gitHead ?? null,
        size: dist.size ?? null,
        sizeLabel: formatBytes(dist.size),
        unpackedSize: dist.unpackedSize ?? null,
        unpackedSizeLabel: formatBytes(dist.unpackedSize),
        fileCount: dist.fileCount ?? null,
        license: metadata.license ?? packument.license ?? null,
        engines,
        dependencies,
        distTags: tagMap.get(version) ?? [],
      };
    })
    .sort((a, b) => {
      const timeDiff = Date.parse(b.publishedAt ?? '') - Date.parse(a.publishedAt ?? '');
      return Number.isFinite(timeDiff) && timeDiff !== 0
        ? timeDiff
        : compareVersionsDesc(a.version, b.version);
    });

  const generatedAt = packument.time?.modified ?? new Date().toISOString();
  return {
    packageName: PACKAGE_NAME,
    latestVersion: distTags.latest ?? versions[0]?.version ?? null,
    updatedAt: packument.time?.modified ?? generatedAt,
    generatedAt,
    versionCount: versions.length,
    distTags,
    sourceUrl: REGISTRY_URL,
    npmPackageUrl: NPM_PACKAGE_URL,
    changelogUrl: CHANGELOG_URL,
    versions,
  };
}

function readChangelog() {
  try {
    return readFileSync(CHANGELOG_PATH, 'utf-8');
  } catch {
    return null;
  }
}

async function main() {
  try {
    const response = await fetch(REGISTRY_URL, {
      headers: {
        Accept: 'application/json',
      },
    });
    if (!response.ok) {
      throw new Error(`npm registry returned ${response.status}`);
    }
    const packument = await response.json();
    const changelog = readChangelog();
    const data = buildReleaseData(packument);
    data.versions = enrichReleaseVersions(data.versions, changelog ?? '');
    const sizePairs = await Promise.all(data.versions.map(async (item) => [item.version, await getTarballSize(item.tarballUrl)]));
    const sizeMap = new Map(sizePairs);
    for (const item of data.versions) {
      item.size = sizeMap.get(item.version) ?? null;
      item.sizeLabel = formatBytes(item.size);
    }
    mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
    writeFileSync(OUTPUT_PATH, `${JSON.stringify(data, null, 2)}\n`);
    console.log(`Generated ${OUTPUT_PATH} from npm registry (${data.versionCount} versions).`);
  } catch (error) {
    const cache = readCache();
    if (!cache) {
      console.error(`Failed to generate release data and no cache exists: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
    const changelog = readChangelog();
    if (Array.isArray(cache.versions)) {
      cache.versions = enrichReleaseVersions(cache.versions, changelog ?? '');
      mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
      writeFileSync(OUTPUT_PATH, `${JSON.stringify(cache, null, 2)}\n`);
    }
    console.warn(`Failed to refresh release data; using existing cache at ${OUTPUT_PATH}.`);
    console.warn(error instanceof Error ? error.message : String(error));
  }
}

await main();
