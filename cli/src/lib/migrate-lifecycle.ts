import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { isAdoptedBootstrap } from './project-yaml.js';
import { effectiveBaselineSeedState } from './baseline-jit.js';

export interface MigrateResult {
  migrated: boolean;
  autoMarked?: string;   // module id that was auto-marked launched
  warned?: boolean;      // true if multi-module warning was emitted
}

/**
 * Detects old config.lifecycle === 'active' with no launched modules.
 * Single-module: auto-marks it as launched and returns autoMarked.
 * Multi-module: emits a warning and returns warned=true.
 * Called by both sync and launch before deriving isLaunched.
 */
export function migrateProjectLifecycle(root: string): MigrateResult {
  const configPath = join(root, 'logos', 'logos.config.json');
  if (!existsSync(configPath)) return { migrated: false };

  let config: Record<string, unknown>;
  try {
    config = JSON.parse(readFileSync(configPath, 'utf-8'));
  } catch {
    return { migrated: false };
  }

  if (config['lifecycle'] !== 'active') return { migrated: false };

  const yamlPath = join(root, 'logos', 'logos-project.yaml');
  if (!existsSync(yamlPath)) return { migrated: false };

  let yaml: Record<string, unknown>;
  try {
    yaml = parseYaml(readFileSync(yamlPath, 'utf-8')) ?? {};
  } catch {
    return { migrated: false };
  }

  const modules = Array.isArray(yaml['modules'])
    ? (yaml['modules'] as Array<{ id: string; lifecycle?: string }>)
    : [];

  const hasLaunched = modules.some(m => m.lifecycle === 'launched');
  if (hasLaunched) return { migrated: false };

  if (modules.length === 1) {
    modules[0].lifecycle = 'launched';
    writeFileSync(yamlPath, stringifyYaml(yaml, { lineWidth: 0 }));
    // Remove stale project-level lifecycle field
    delete config['lifecycle'];
    writeFileSync(configPath, JSON.stringify(config, null, 2));
    return { migrated: true, autoMarked: modules[0].id };
  }

  if (modules.length > 1) {
    // Remove stale project-level lifecycle field even in multi-module case
    delete config['lifecycle'];
    writeFileSync(configPath, JSON.stringify(config, null, 2));
    return { migrated: true, warned: true };
  }

  return { migrated: false };
}

export interface BaselineMigrateResult {
  migrated: boolean;
  backupPath?: string;
  changes: string[];
}

/**
 * brownfield-adopter（S33）：老 adopted 项目 provenance 元数据的保守逐产物迁移。
 *
 * 持久化改写两类（baseline-seed-legacy-default-unify 扩展）：
 * 1. 历史布尔 `baseline_seed_required: true` → 枚举 `baseline_seed_state: required`（既有行为不回归）；
 * 2. `bootstrap: adopted`（含历史 `skipped` 兼容读取）且仍无 `baseline_seed_state` 的模块 →
 *    经共享 helper `effectiveBaselineSeedState`（唯一事实源）派生并**写入显式枚举**，changes 记录写明派生依据；
 *    落盘后 legacy 缺省态物理消亡，运行时派生仅作过渡兜底。已有显式值不覆盖。
 * provenance 本身为派生值、不落 YAML：缺 `## 逆向基线来源` 章节的既有文档一律派生 `unknown`/`legacy-unclassified`，
 * **不虚构 candidates[]、不推断 reverse-engineered/human-verified、无产物不创建任何 provenance**。
 *
 * 不变量：幂等（重复运行不改结果）、写前备份（logos-project.yaml.bak）、旧版 CLI 忽略未知字段。
 * 锁纪律：调用方（sync）已在 `withRecoveredReadLocks` 的**全模块读锁区间**内执行本迁移——
 * 派生一律 `assumeLocked: true` 复用该区间，不自取锁（自取会与已持锁互斥而误判 commit_in_progress）。
 */
export function migrateBaselineProvenance(root: string): BaselineMigrateResult {
  const yamlPath = join(root, 'logos', 'logos-project.yaml');
  if (!existsSync(yamlPath)) return { migrated: false, changes: [] };

  const original = readFileSync(yamlPath, 'utf-8');
  let yaml: Record<string, unknown>;
  try {
    yaml = parseYaml(original) ?? {};
  } catch {
    return { migrated: false, changes: [] };
  }

  const modules = Array.isArray(yaml['modules'])
    ? (yaml['modules'] as Array<Record<string, unknown>>)
    : [];

  const changes: string[] = [];
  for (const m of modules) {
    // 布尔→枚举兼容：仅当布尔为 true 且尚无枚举时映射为 required；false 移除布尔后按下方「无字段派生落盘」处理。
    const legacyBool = m['baseline_seed_required'];
    const hasEnum = m['baseline_seed_state'] === 'required'
      || m['baseline_seed_state'] === 'partial'
      || m['baseline_seed_state'] === 'seeded';
    if (legacyBool !== undefined) {
      if (!hasEnum && legacyBool === true) {
        m['baseline_seed_state'] = 'required';
        changes.push(`${String(m['id'] ?? '?')}: baseline_seed_required(true) → baseline_seed_state: required`);
      } else if (!hasEnum && legacyBool === false) {
        changes.push(`${String(m['id'] ?? '?')}: 移除历史布尔 baseline_seed_required(false)`);
      } else {
        changes.push(`${String(m['id'] ?? '?')}: 移除历史布尔 baseline_seed_required`);
      }
      delete m['baseline_seed_required'];
    }

    // baseline-seed-legacy-default-unify：adopted（含历史 skipped）且仍无显式枚举 → 派生落盘（唯一事实源 helper）。
    const hasEnumNow = m['baseline_seed_state'] === 'required'
      || m['baseline_seed_state'] === 'partial'
      || m['baseline_seed_state'] === 'seeded';
    const moduleId = typeof m['id'] === 'string' ? m['id'] : null;
    if (!hasEnumNow && moduleId && isAdoptedBootstrap(m['bootstrap'])) {
      // 调用方（sync）持全模块读锁 → assumeLocked 复用；不在此处自取锁。
      const eff = effectiveBaselineSeedState(root, moduleId, null, { assumeLocked: true });
      const basis = eff.state === 'required'
        ? '无逆向候选'
        : eff.state === 'seeded'
          ? '有逆向候选'
          : '有逆向候选且存在 open run';
      m['baseline_seed_state'] = eff.state;
      changes.push(`${moduleId}: baseline_seed_state 缺省 → ${eff.state}（派生：${basis}）`);
    }
  }

  if (changes.length === 0) {
    // 幂等：无可迁移项 → 不写盘、不建备份。
    return { migrated: false, changes: [] };
  }

  // 写前备份（幂等地覆盖到同一 .bak，恢复依据）。
  const backupPath = `${yamlPath}.bak`;
  writeFileSync(backupPath, original);
  writeFileSync(yamlPath, stringifyYaml(yaml, { lineWidth: 0 }));
  return { migrated: true, backupPath, changes };
}
