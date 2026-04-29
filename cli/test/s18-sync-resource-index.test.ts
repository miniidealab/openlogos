import { describe, it, expect } from 'vitest';
import { inferResourceDesc } from '../src/lib/sync-resource-index.js';

describe('S18 Unit Tests — sync-resource-index inferResourceDesc', () => {

  /* ---- scenario overview ---- */

  it('UT-S18-01: infers desc for core-00-scenario-overview.md (zh)', () => {
    const desc = inferResourceDesc(
      'logos/resources/prd/3-technical-plan/2-scenario-implementation/core-00-scenario-overview.md',
      'zh',
    );
    expect(desc).not.toBeNull();
    expect(desc).toContain('场景实现概览');
  });

  it('UT-S18-02: infers desc for 00-scenario-overview.md without prefix (zh)', () => {
    const desc = inferResourceDesc(
      'logos/resources/prd/3-technical-plan/2-scenario-implementation/00-scenario-overview.md',
      'zh',
    );
    expect(desc).not.toBeNull();
    expect(desc).toContain('场景实现概览');
  });

  it('UT-S18-03: infers desc for payment-00-scenario-overview.md (en)', () => {
    const desc = inferResourceDesc(
      'logos/resources/prd/3-technical-plan/2-scenario-implementation/payment-00-scenario-overview.md',
      'en',
    );
    expect(desc).not.toBeNull();
    expect(desc).toContain('Scenario overview');
  });

  /* ---- scenario sequence diagrams ---- */

  it('UT-S18-04: infers desc for core-S01-cli-init.md (zh)', () => {
    const desc = inferResourceDesc(
      'logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S01-cli-init.md',
      'zh',
    );
    expect(desc).not.toBeNull();
    expect(desc).toContain('S01');
    expect(desc).toContain('场景时序图');
  });

  it('UT-S18-05: infers desc for S01-cli-init.md without prefix (zh)', () => {
    const desc = inferResourceDesc(
      'logos/resources/prd/3-technical-plan/2-scenario-implementation/S01-cli-init.md',
      'zh',
    );
    expect(desc).not.toBeNull();
    expect(desc).toContain('S01');
  });

  it('UT-S18-06: infers desc for payment-S12-checkout.md (en)', () => {
    const desc = inferResourceDesc(
      'logos/resources/prd/3-technical-plan/2-scenario-implementation/payment-S12-checkout.md',
      'en',
    );
    expect(desc).not.toBeNull();
    expect(desc).toContain('S12');
    expect(desc).toContain('sequence diagram');
  });

  /* ---- test cases ---- */

  it('UT-S18-07: infers desc for core-S01-test-cases.md (zh)', () => {
    const desc = inferResourceDesc(
      'logos/resources/test/core-S01-test-cases.md',
      'zh',
    );
    expect(desc).not.toBeNull();
    expect(desc).toContain('S01');
    expect(desc).toContain('测试用例');
  });

  it('UT-S18-08: infers desc for S01-test-cases.md without prefix (zh)', () => {
    const desc = inferResourceDesc(
      'logos/resources/test/S01-test-cases.md',
      'zh',
    );
    expect(desc).not.toBeNull();
    expect(desc).toContain('S01');
  });

  it('UT-S18-09: infers desc for payment-S12-test-cases.md (en)', () => {
    const desc = inferResourceDesc(
      'logos/resources/test/payment-S12-test-cases.md',
      'en',
    );
    expect(desc).not.toBeNull();
    expect(desc).toContain('S12');
    expect(desc).toContain('test cases');
  });

  /* ---- other rules still work ---- */

  it('UT-S18-10: infers desc for architecture file (zh)', () => {
    const desc = inferResourceDesc(
      'logos/resources/prd/3-technical-plan/1-architecture/core-01-architecture-overview.md',
      'zh',
    );
    expect(desc).not.toBeNull();
    expect(desc).toContain('架构');
  });

  it('UT-S18-11: returns null for unrecognized path', () => {
    const desc = inferResourceDesc('some/random/file.txt', 'zh');
    expect(desc).toBeNull();
  });

  it('UT-S18-12: infers desc for spec doc (en)', () => {
    const desc = inferResourceDesc('spec/module-naming-convention.md', 'en');
    expect(desc).not.toBeNull();
    expect(desc).toContain('spec');
  });
});
