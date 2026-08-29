import { describe, expect, it } from 'vitest';

import { enrichReleaseVersions } from '../../website/src/lib/releases-summary.mjs';

describe('S13 发布摘要覆盖', () => {
  it('UT-S13-24: release 摘要保留双语字段并解释英文缺失回退原因', () => {
    const changelog = `# Changelog

## [1.2.0] - 2026-05-26

### Added

- **可见发布价值** — 保留中文原文摘要。

### Fixed

- \`fallback\` 原因保持显式。
`;

    const [bilingual, fallback] = enrichReleaseVersions([
      { version: '1.2.0' },
      { version: '1.1.0' },
    ], changelog, {
      '1.2.0': {
        valueSummaryEn: ['Visible release value is available in English.'],
        fixSummaryEn: ['Fallback reasons stay explicit.'],
      },
    });

    expect(bilingual).toMatchObject({
      valueSummary: ['可见发布价值 — 保留中文原文摘要。'],
      fixSummary: ['fallback 原因保持显式。'],
      valueSummaryEn: ['Visible release value is available in English.'],
      fixSummaryEn: ['Fallback reasons stay explicit.'],
      summarySource: 'bilingual',
      summaryFallbackReason: null,
    });
    expect(fallback).toMatchObject({
      valueSummary: [],
      fixSummary: [],
      valueSummaryEn: [],
      fixSummaryEn: [],
      summarySource: 'fallback',
    });
    expect(fallback.summaryFallbackReason).toContain('CHANGELOG.md does not contain a section');
    expect(fallback.summaryFallbackReason).toContain('English value summary entries are missing');
    expect(fallback.summaryFallbackReason).toContain('English fix summary entries are missing');
  });
});
