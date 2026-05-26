const VALUE_SECTION_NAMES = new Set(['added', 'changed', 'deprecated', 'removed', 'security']);
const FIX_SECTION_NAMES = new Set(['fixed']);

export const RELEASE_SUMMARY_FALLBACK_MESSAGE = 'Structured release summary unavailable for this version.';
export const RELEASE_SUMMARY_FALLBACK_REASON = 'CHANGELOG.md does not contain a structured release summary for this version.';

const VERSION_HEADING_RE = /^##\s+\[([^\]]+)\]/;
const SECTION_HEADING_RE = /^###\s+(.+?)\s*$/;
const BULLET_RE = /^-\s+(.+)$/;

function cleanSummaryText(text) {
  return text
    .replace(/\[([^\]]+)\]\((?:[^)]+)\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function createSummaryRecord() {
  return {
    hasSection: false,
    hasStructuredSummary: false,
    valueSummary: [],
    fixSummary: [],
  };
}

export function parseChangelogSummaries(content) {
  const summaries = new Map();
  let currentVersion = null;
  let currentKind = null;

  const ensureRecord = (version) => {
    if (!summaries.has(version)) {
      summaries.set(version, createSummaryRecord());
    }
    return summaries.get(version);
  };

  for (const line of content.split(/\r?\n/)) {
    const versionMatch = line.match(VERSION_HEADING_RE);
    if (versionMatch) {
      const version = versionMatch[1].trim();
      currentVersion = version.toLowerCase() === 'unreleased' ? null : version;
      currentKind = null;
      if (currentVersion) {
        ensureRecord(currentVersion).hasSection = true;
      }
      continue;
    }

    if (!currentVersion) continue;

    const sectionMatch = line.match(SECTION_HEADING_RE);
    if (sectionMatch) {
      const sectionName = sectionMatch[1].trim().toLowerCase();
      if (VALUE_SECTION_NAMES.has(sectionName)) {
        currentKind = 'value';
      } else if (FIX_SECTION_NAMES.has(sectionName)) {
        currentKind = 'fix';
      } else {
        currentKind = null;
      }
      continue;
    }

    if (!currentKind) continue;

    const bulletMatch = line.match(BULLET_RE);
    if (!bulletMatch) continue;

    const text = cleanSummaryText(bulletMatch[1]);
    if (!text) continue;

    const record = ensureRecord(currentVersion);
    const target = currentKind === 'value' ? record.valueSummary : record.fixSummary;
    if (target.length < 3) {
      target.push(text);
      record.hasStructuredSummary = true;
    }
  }

  for (const record of summaries.values()) {
    record.hasStructuredSummary = record.valueSummary.length > 0 || record.fixSummary.length > 0;
  }

  return summaries;
}

function summarizeVersion(version, summaries) {
  const record = summaries.get(version);
  if (!record) {
    return {
      valueSummary: [],
      fixSummary: [],
      summarySource: 'fallback',
      summaryFallbackReason: `CHANGELOG.md does not contain a section for v${version}.`,
    };
  }

  if (!record.hasStructuredSummary || record.valueSummary.length === 0 || record.fixSummary.length === 0) {
    const missing = [];
    if (record.valueSummary.length === 0) missing.push('value summary');
    if (record.fixSummary.length === 0) missing.push('fix summary');
    return {
      valueSummary: record.valueSummary.slice(0, 3),
      fixSummary: record.fixSummary.slice(0, 3),
      summarySource: 'fallback',
      summaryFallbackReason: `CHANGELOG.md lists v${version}, but ${missing.join(' and ')} entries are missing.`,
    };
  }

  return {
    valueSummary: record.valueSummary.slice(0, 3),
    fixSummary: record.fixSummary.slice(0, 3),
    summarySource: 'changelog',
    summaryFallbackReason: null,
  };
}

export function enrichReleaseVersions(versions, changelogContent) {
  const summaries = typeof changelogContent === 'string' && changelogContent.length > 0
    ? parseChangelogSummaries(changelogContent)
    : new Map();

  return versions.map((version) => ({
    ...version,
    ...summarizeVersion(version.version, summaries),
  }));
}
