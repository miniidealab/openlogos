#!/usr/bin/env node
/**
 * 升版确定性动作（功能规格 §2.81、部署方案「发布前检查通则」第 4 条）。
 *
 * 一次写全部身份载体，随后**调用既有生成器重算 `asset-manifest.json`**——
 * 该文件的 `payloadHash` 是对含 `version` 的整个 payload 求值，手改 `version` 而不重算即制造中间态
 * （0.15.4 实证：12 个文件 72 条 `asset manifest payload hash 不匹配`）。
 *
 * 用法：node cli/scripts/bump-version.mjs <目标版本>
 *   - 目标版本须为 x.y.z；非法即拒绝且**零改写**；
 *   - 对已是目标版本的仓库重复执行**字节不变**（幂等）；
 *   - 输出逐项变更清单（文件 → 旧值 → 新值）供复核。
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const cliRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(cliRoot, '..');

/** 身份载体：`"version": "x.y.z"` 形态的 JSON 文件（相对仓库根）。 */
export const VERSION_CARRIERS = [
  'cli/package.json',
  'cli/package-lock.json',          // 根包两处（顶层 version + packages[""].version）
  'cli/asset-manifest.json',        // 由生成器重算，此处仅先行同步 version 字段
  'plugin/.claude-plugin/plugin.json',
  'plugin-codex/plugin.json',
  'plugin-qoder/.qoder-plugin/plugin.json',
  'plugin-workbuddy/.workbuddy-plugin/plugin.json',
  'plugin-zcode/.zcode-plugin/plugin.json',
];
const CANDIDATE_CONST = 'cli/src/lib/local-release-candidate.ts';
const SEMVER = /^\d+\.\d+\.\d+$/;

export function readCurrentVersion(root = repoRoot) {
  return JSON.parse(readFileSync(join(root, 'cli/package.json'), 'utf8')).version;
}

/**
 * 纯函数：计算一次升版的逐文件改写计划。不做任何 IO 写入，便于测试与 dry-run。
 * 返回 { changes: [{file, from, to}], errors: [] }；目标版本非法或与当前相同时 changes 为空。
 */
export function planBump(root, target) {
  const errors = [];
  if (!SEMVER.test(String(target))) {
    errors.push(`目标版本非法（须为 x.y.z）：${target}`);
    return { changes: [], errors, current: null, rollback: null };
  }
  const current = readCurrentVersion(root);
  // 幂等短路：已是目标版本即零改写。放在一切扫描之前——否则 current === target 时
  // 每一处「值等于 current」都会被当成待改写项，重复执行就不再幂等。
  if (current === target) {
    const constTextIdem = readFileSync(join(root, CANDIDATE_CONST), 'utf8');
    return {
      changes: [], errors,
      current,
      rollback: /LOCAL_RELEASE_ROLLBACK_VERSION\s*=\s*'([^']+)'/.exec(constTextIdem)?.[1] ?? null,
    };
  }
  const changes = [];
  for (const rel of VERSION_CARRIERS) {
    const text = readFileSync(join(root, rel), 'utf8');
    const hits = [...text.matchAll(/"version"\s*:\s*"([^"]+)"/g)]
      .filter(m => m[1] === current || m[1] === target);
    // lockfile 根包两处、其余各一处；只改与当前/目标版本相等的值，绝不触碰依赖的版本号
    const count = rel.endsWith('package-lock.json') ? 2 : 1;
    if (hits.length < count) errors.push(`${rel}：未找到足够的版本字段（期望 ${count}，实得 ${hits.length}）`);
    if (hits.some(m => m[1] === current)) changes.push({ file: rel, from: current, to: target });
  }
  const constText = readFileSync(join(root, CANDIDATE_CONST), 'utf8');
  const candidate = /LOCAL_RELEASE_CANDIDATE_VERSION\s*=\s*'([^']+)'/.exec(constText)?.[1] ?? null;
  const rollback = /LOCAL_RELEASE_ROLLBACK_VERSION\s*=\s*'([^']+)'/.exec(constText)?.[1] ?? null;
  if (!candidate || !rollback) errors.push(`${CANDIDATE_CONST}：候选/回滚常量缺失`);
  if (candidate && candidate !== target) changes.push({ file: `${CANDIDATE_CONST}#CANDIDATE`, from: candidate, to: target });
  if (rollback && candidate && candidate !== target) changes.push({ file: `${CANDIDATE_CONST}#ROLLBACK`, from: rollback, to: current });
  return { changes, errors, current, rollback };
}

export function applyBump(root, target) {
  const plan = planBump(root, target);
  if (plan.errors.length > 0) return plan;                 // 非法输入：零改写
  if (plan.changes.length === 0) return plan;              // 已是目标版本：幂等，零改写
  const { current } = plan;
  for (const rel of VERSION_CARRIERS) {
    const p = join(root, rel);
    const text = readFileSync(p, 'utf8');
    const count = rel.endsWith('package-lock.json') ? 2 : 1;
    writeFileSync(p, text.replace(new RegExp(`("version"\\s*:\\s*)"${current.replace(/\./g, '\\.')}"`, 'g'),
      (m, g1, offset, full) => {
        // 只替换前 count 处（lockfile 的根包版本在文件最前部；依赖版本不参与）
        const before = full.slice(0, offset).match(new RegExp(`"version"\\s*:\\s*"${current.replace(/\./g, '\\.')}"`, 'g'));
        return (before ? before.length : 0) < count ? `${g1}"${target}"` : m;
      }));
  }
  const cp = join(root, CANDIDATE_CONST);
  writeFileSync(cp, readFileSync(cp, 'utf8')
    .replace(/(LOCAL_RELEASE_CANDIDATE_VERSION\s*=\s*')[^']+(')/, `$1${target}$2`)
    .replace(/(LOCAL_RELEASE_ROLLBACK_VERSION\s*=\s*')[^']+(')/, `$1${current}$2`));
  // 派生值必须由生成器产出——手写 payloadHash 即制造中间态（本脚本存在的全部理由）
  const gen = spawnSync(process.execPath, [join(root, 'cli/scripts/build-asset-manifest.mjs')],
    { cwd: join(root, 'cli'), encoding: 'utf8' });
  if (gen.status !== 0) {
    plan.errors.push(`asset manifest 生成器失败：${(gen.stderr || gen.stdout || '').slice(0, 300)}`);
  }
  return plan;
}

if (process.argv[1] && process.argv[1].endsWith('bump-version.mjs')) {
  const target = process.argv[2];
  const result = applyBump(repoRoot, target);
  if (result.errors.length > 0) {
    console.error('升版失败（未改写任何文件或生成器报错）：');
    for (const e of result.errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  if (result.changes.length === 0) {
    console.log(`已是目标版本 ${target}，无需改写（幂等）。`);
    process.exit(0);
  }
  console.log(`升版 ${result.current} → ${target}：`);
  for (const c of result.changes) console.log(`  ${c.file}: ${c.from} → ${c.to}`);
  console.log(`  cli/asset-manifest.json: payloadHash 已由生成器重算`);
}
