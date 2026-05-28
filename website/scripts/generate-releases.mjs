import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { enrichReleaseVersions } from '../src/lib/releases-summary.mjs';

const PACKAGE_NAME = '@miniidealab/openlogos';
const REGISTRY_URL = `https://registry.npmjs.org/${encodeURIComponent(PACKAGE_NAME)}`;
const DEFAULT_OUTPUT_PATH = resolve('src/data/releases.json');
const CHANGELOG_PATH = resolve('../CHANGELOG.md');
const NPM_PACKAGE_URL = `https://www.npmjs.com/package/${PACKAGE_NAME}`;
const GITHUB_RELEASE_BASE = 'https://github.com/miniidealab/openlogos/releases/tag';
const CHANGELOG_URL = 'https://github.com/miniidealab/openlogos/blob/master/CHANGELOG.md';
const DEFAULT_TIMEOUT_MS = 15000;

function readCache(outputPath) {
  if (!existsSync(outputPath)) return null;
  return JSON.parse(readFileSync(outputPath, 'utf-8'));
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

function withTimeout(signal, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const timeoutController = new AbortController();
  const timer = setTimeout(() => timeoutController.abort(), timeoutMs);
  const composite = signal ? AbortSignal.any([signal, timeoutController.signal]) : timeoutController.signal;
  return {
    signal: composite,
    dispose: () => clearTimeout(timer),
  };
}

async function getTarballSize(tarballUrl, signal) {
  if (!tarballUrl) return null;
  const timeout = withTimeout(signal, DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetch(tarballUrl, { method: 'GET', signal: timeout.signal });
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
  } finally {
    timeout.dispose();
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

export async function generateReleaseData(options = {}) {
  const {
    strict = false,
    outputPath = DEFAULT_OUTPUT_PATH,
    signal,
    logger = console,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options;

  const timeout = withTimeout(signal, timeoutMs);
  try {
    const response = await fetch(REGISTRY_URL, {
      headers: { Accept: 'application/json' },
      signal: timeout.signal,
    });
    if (!response.ok) {
      throw new Error(`npm registry returned ${response.status}`);
    }
    const packument = await response.json();
    const changelog = readChangelog();
    const data = buildReleaseData(packument);
    data.versions = enrichReleaseVersions(data.versions, changelog ?? '');
    const sizePairs = await Promise.all(
      data.versions.map(async (item) => [item.version, await getTarballSize(item.tarballUrl, timeout.signal)]),
    );
    const sizeMap = new Map(sizePairs);
    for (const item of data.versions) {
      item.size = sizeMap.get(item.version) ?? null;
      item.sizeLabel = formatBytes(item.size);
    }
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(data, null, 2)}\n`);
    logger.log(`Generated ${outputPath} from npm registry (${data.versionCount} versions).`);
    return {
      ok: true,
      fromCache: false,
      strict,
      data,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (strict) {
      throw new Error(`Strict release data generation failed: ${message}`);
    }
    const cache = readCache(outputPath);
    if (!cache) {
      throw new Error(`Failed to generate release data and no cache exists: ${message}`);
    }
    const changelog = readChangelog();
    if (Array.isArray(cache.versions)) {
      cache.versions = enrichReleaseVersions(cache.versions, changelog ?? '');
      mkdirSync(dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, `${JSON.stringify(cache, null, 2)}\n`);
    }
    logger.warn(`Failed to refresh release data; using existing cache at ${outputPath}.`);
    logger.warn(message);
    return {
      ok: true,
      fromCache: true,
      strict,
      data: cache,
      warning: message,
    };
  } finally {
    timeout.dispose();
  }
}

function parseCliArgs(argv) {
  return {
    strict: argv.includes('--strict'),
  };
}

export async function main(argv = process.argv.slice(2), logger = console) {
  const args = parseCliArgs(argv);
  const result = await generateReleaseData({
    strict: args.strict,
    logger,
  });
  if (result.fromCache) {
    logger.log('Release data generated from existing cache.');
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
const selfPath = resolve(new URL(import.meta.url).pathname);
if (invokedPath === selfPath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
