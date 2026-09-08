import { afterAll, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { TRANSIENT_STATUS_ERROR_CODES } from '../src/lib/json-output.js';
import {
  cleanupFixtureRoots,
  frontierFixture,
  invoke,
  put,
} from './frontier-fixture.js';

afterAll(cleanupFixtureRoots);

describe('status/next 错误 envelope 与瞬态码合同 — S16', () => {
  it('UT-S16-40: 失败路径结构化错误码——baseline 锁硬报稳定码；损坏输入容错为结构化 success envelope（无一无声退化）', () => {
    // 失败路径①：baseline commit 锁被其它活 writer 持有 → stderr error envelope + 稳定码（瞬态类）
    const locked = frontierFixture();
    // 恢复门只对 adopted 模块启用——把 fixture 标记为 adopted，并以其它活进程（ppid）持锁
    put(locked.root, 'logos/logos-project.yaml',
      'project:\n  name: F\nmodules:\n  - id: core\n    name: Core\n    lifecycle: launched\n    bootstrap: adopted\n    baseline_seed_state: partial\n    product_type: cli\nscenario_counter:\n  next_id: 40\nresource_index: []\n');
    const runsDir = join(locked.root, 'logos', 'resources', 'verify', 'baseline-seed-runs');
    mkdirSync(runsDir, { recursive: true });
    writeFileSync(join(runsDir, 'core.commit.lock'),
      JSON.stringify({ pid: process.ppid, at: Date.now(), token: `other-${process.ppid}` }));
    for (const cmd of ['status', 'next']) {
      const result = invoke([cmd, '--format', 'json'], locked.root);
      expect(result.status, cmd).not.toBe(0);
      const envelope = JSON.parse(result.stderr.trim().split('\n').pop()!);
      expect(envelope.error.code, cmd).toBe('baseline_commit_in_progress');
      expect(TRANSIENT_STATUS_ERROR_CODES).toContain(envelope.error.code);
    }
    // 损坏输入路径：合同只允许两种结构化形态——容错（exit 0 + success envelope）或
    // 结构化报错（exit≠0 + stderr error envelope 携带稳定 error.code）；禁止无码纯文本退化。
    for (const breaker of [
      (f: ReturnType<typeof frontierFixture>) => put(f.root, 'logos/.openlogos-guard', '{ broken'),
      (f: ReturnType<typeof frontierFixture>) => put(f.root, 'logos/flow/launched.yaml', '{{{{not yaml'),
    ]) {
      const f = frontierFixture();
      breaker(f);
      for (const cmd of ['status', 'next']) {
        const result = invoke([cmd, '--format', 'json'], f.root);
        if (result.status === 0) {
          const envelope = JSON.parse(result.stdout.trim().split('\n').pop()!);
          expect(envelope.data, `${cmd} 容错形态`).toBeDefined();
        } else {
          const envelope = JSON.parse(result.stderr.trim().split('\n').pop()!);
          expect(typeof envelope.error?.code, `${cmd} 报错形态必须带稳定码`).toBe('string');
          expect(envelope.error.code.length, cmd).toBeGreaterThan(0);
        }
      }
    }
  });

  it('UT-S16-41: 瞬态错误码集合稳定——增删必须显式过本快照（合同版本绑定）', () => {
    expect([...TRANSIENT_STATUS_ERROR_CODES]).toEqual(['baseline_commit_in_progress']);
  });

});
