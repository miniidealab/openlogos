import test from 'node:test';
import assert from 'node:assert/strict';
import { enrichReleaseVersions, parseChangelogSummaries } from '../src/lib/releases-summary.mjs';

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

test('release summary parsing keeps structured text and fallback behavior explicit', () => {
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
  ], changelog);

  assert.equal(versions[0].summarySource, 'changelog');
  assert.equal(versions[0].summaryFallbackReason, null);
  assert.equal(versions[1].summarySource, 'fallback');
  assert.deepEqual(versions[1].valueSummary, ['Changed the release layout.']);
  assert.deepEqual(versions[1].fixSummary, []);
  assert.match(versions[1].summaryFallbackReason, /fix summary entries are missing/);
  assert.equal(versions[2].summarySource, 'fallback');
  assert.deepEqual(versions[2].valueSummary, []);
  assert.deepEqual(versions[2].fixSummary, []);
  assert.match(versions[2].summaryFallbackReason, /does not contain a section/);
});
