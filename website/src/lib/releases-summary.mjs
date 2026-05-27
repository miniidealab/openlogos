import { RELEASE_SUMMARIES_EN } from '../data/release-summaries-en.mjs';

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

function summaryItems(value) {
  return Array.isArray(value) ? value.filter(Boolean).slice(0, 3) : [];
}

function englishSummaryForVersion(version, englishSummaries) {
  const record = englishSummaries?.[version] ?? {};
  return {
    valueSummaryEn: summaryItems(record.valueSummaryEn),
    fixSummaryEn: summaryItems(record.fixSummaryEn),
  };
}

function fallbackReason(version, changelogRecord, englishRecord) {
  const missing = [];

  if (!changelogRecord) {
    missing.push('CHANGELOG.md does not contain a section');
  } else {
    if (changelogRecord.valueSummary.length === 0) missing.push('Chinese value summary entries are missing');
    if (changelogRecord.fixSummary.length === 0) missing.push('Chinese fix summary entries are missing');
  }

  if (englishRecord.valueSummaryEn.length === 0) missing.push('English value summary entries are missing');
  if (englishRecord.fixSummaryEn.length === 0) missing.push('English fix summary entries are missing');

  if (missing.length === 0) return null;
  return `v${version}: ${missing.join('; ')}.`;
}

function summarizeVersion(version, summaries, englishSummaries) {
  const record = summaries.get(version);
  const englishRecord = englishSummaryForVersion(version, englishSummaries);
  const reason = fallbackReason(version, record, englishRecord);

  if (!record) {
    return {
      valueSummary: [],
      fixSummary: [],
      valueSummaryEn: englishRecord.valueSummaryEn,
      fixSummaryEn: englishRecord.fixSummaryEn,
      summarySource: 'fallback',
      summaryFallbackReason: reason,
    };
  }

  if (reason) {
    return {
      valueSummary: record.valueSummary.slice(0, 3),
      fixSummary: record.fixSummary.slice(0, 3),
      valueSummaryEn: englishRecord.valueSummaryEn,
      fixSummaryEn: englishRecord.fixSummaryEn,
      summarySource: 'fallback',
      summaryFallbackReason: reason,
    };
  }

  return {
    valueSummary: record.valueSummary.slice(0, 3),
    fixSummary: record.fixSummary.slice(0, 3),
    valueSummaryEn: englishRecord.valueSummaryEn,
    fixSummaryEn: englishRecord.fixSummaryEn,
    summarySource: 'bilingual',
    summaryFallbackReason: null,
  };
}

export function enrichReleaseVersions(versions, changelogContent, englishSummaries = RELEASE_SUMMARIES_EN) {
  const summaries = typeof changelogContent === 'string' && changelogContent.length > 0
    ? parseChangelogSummaries(changelogContent)
    : new Map();

  return versions.map((version) => ({
    ...version,
    ...summarizeVersion(version.version, summaries, englishSummaries),
  }));
}
