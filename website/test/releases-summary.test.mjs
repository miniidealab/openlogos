import test from 'node:test';
import assert from 'node:assert/strict';
import { enrichReleaseVersions, parseChangelogSummaries } from '../src/lib/releases-summary.mjs';
import { runReported } from './helpers/openlogos-reporter.mjs';

const changelog = `# Changelog

## [1.2.0] - 2026-05-26

### Added

- **Visible release value** — Added structured value summaries.
- [Linked item](https://example.com) is preserved as text.

### Fixed

- \`fallback\` handling now stays explicit.

## [1.1.0] - 2026-05-25

### Changed

- Changed the release layout.
`;

test('UT-S13-24: release summary parsing keeps bilingual text and fallback behavior explicit', async () => runReported('UT-S13-24', () => {
  const summaries = parseChangelogSummaries(changelog);
  const summary = summaries.get('1.2.0');

  assert.deepEqual(summary.valueSummary, [
    'Visible release value — Added structured value summaries.',
    'Linked item is preserved as text.',
  ]);
  assert.deepEqual(summary.fixSummary, [
    'fallback handling now stays explicit.',
  ]);

  const versions = enrichReleaseVersions([
    { version: '1.2.0' },
    { version: '1.1.0' },
    { version: '1.0.0' },
  ], changelog, {
    '1.2.0': {
      valueSummaryEn: [
        'Visible release value summaries are now available in English.',
        'Linked changelog items are preserved as readable text.',
      ],
      fixSummaryEn: ['Fallback handling now stays explicit.'],
    },
    '1.1.0': {
      valueSummaryEn: ['The release layout now has an English value summary.'],
      fixSummaryEn: [],
    },
  });

  assert.equal(versions[0].summarySource, 'bilingual');
  assert.equal(versions[0].summaryFallbackReason, null);
  assert.deepEqual(versions[0].valueSummaryEn, [
    'Visible release value summaries are now available in English.',
    'Linked changelog items are preserved as readable text.',
  ]);
  assert.deepEqual(versions[0].fixSummaryEn, ['Fallback handling now stays explicit.']);
  assert.equal(versions[1].summarySource, 'fallback');
  assert.deepEqual(versions[1].valueSummary, ['Changed the release layout.']);
  assert.deepEqual(versions[1].fixSummary, []);
  assert.deepEqual(versions[1].valueSummaryEn, ['The release layout now has an English value summary.']);
  assert.deepEqual(versions[1].fixSummaryEn, []);
  assert.match(versions[1].summaryFallbackReason, /Chinese fix summary entries are missing/);
  assert.match(versions[1].summaryFallbackReason, /English fix summary entries are missing/);
  assert.equal(versions[2].summarySource, 'fallback');
  assert.deepEqual(versions[2].valueSummary, []);
  assert.deepEqual(versions[2].fixSummary, []);
  assert.match(versions[2].summaryFallbackReason, /does not contain a section/);
}));
