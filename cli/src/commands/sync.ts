import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { readLocale, t } from '../i18n.js';
import { deploySpecs, deployAiToolAssets, expandAiTools, ensureVerifyPreRunConfig, printVerifyPreRunBackfillResult, writeInstructionFiles } from './init.js';
import { syncResourceIndex } from '../lib/sync-resource-index.js';
import { VERSION } from '../lib/json-output.js';
import { migrateProjectLifecycle, migrateBaselineProvenance } from '../lib/migrate-lifecycle.js';
import { withRecoveredReadLocks, listProjectModuleIds } from '../lib/baseline-seed-txn.js';
import { syncGuiOverlay, readModulesMissingProductType } from '../lib/ui-first.js';

export function syncLogosProjectName(root: string, projectName: string) {
  const yamlPath = join(root, 'logos', 'logos-project.yaml');
  if (!existsSync(yamlPath)) return false;

  const content = readFileSync(yamlPath, 'utf-8');
  const updated = content.replace(
    /^(\s*name:\s*)"[^"]*"/m,
    `$1"${projectName}"`
  );

  if (updated !== content) {
    writeFileSync(yamlPath, updated);
    return true;
  }
  return false;
}

/**
 * For each scenario in logos-project.yaml that lacks a `module` field,
 * infer the owning module by scanning logos/resources/ for files matching
 * `<moduleId>-<scenarioId>-*.md`. Falls back to 'core' when ambiguous.
 * Idempotent: entries that already have a `module` field are left unchanged.
 * Returns the number of entries that were updated.
 */
export function syncScenariosModuleField(root: string): number {
  const yamlPath = join(root, 'logos', 'logos-project.yaml');
  if (!existsSync(yamlPath)) return 0;

  let yaml: Record<string, unknown>;
  try {
    yaml = parseYaml(readFileSync(yamlPath, 'utf-8')) ?? {};
  } catch {
    return 0;
  }

  const modules = Array.isArray(yaml.modules)
    ? (yaml.modules as Array<{ id: string }>).map(m => m.id)
    : ['core'];

  const scenarios = Array.isArray(yaml.scenarios)
    ? (yaml.scenarios as Array<{ id: string; module?: string }>)
    : [];

  if (scenarios.length === 0) return 0;

  // Scan scenario-implementation dir for <moduleId>-<scenarioId>-*.md files
  const scenImplDir = join(root, 'logos', 'resources', 'prd', '3-technical-plan', '2-scenario-implementation');
  const scenImplFiles: string[] = [];
  if (existsSync(scenImplDir)) {
    try {
      for (const f of readdirSync(scenImplDir)) {
        if (statSync(join(scenImplDir, f)).isFile()) scenImplFiles.push(f);
      }
    } catch { /* ignore */ }
  }

  let updated = 0;
  for (const scenario of scenarios) {
    if (scenario.module !== undefined) continue; // already set, skip

    // Find which module has a file matching <moduleId>-<scenarioId>-*.md
    const matched = modules.find(modId =>
      scenImplFiles.some(f => f.startsWith(`${modId}-${scenario.id}-`) || f.startsWith(`${modId}-${scenario.id}.`)),
    );
    scenario.module = matched ?? 'core';
    updated++;
  }

  if (updated > 0) {
    writeFileSync(yamlPath, stringifyYaml(yaml, { lineWidth: 0 }));
  }

  return updated;
}

export function sync() {
  const root = process.cwd();
  const configPath = join(root, 'logos', 'logos.config.json');

  if (!existsSync(configPath)) {
    console.error('Error: logos/logos.config.json not found.');
    console.error('Run `openlogos init` first to initialize the project.');
    process.exit(1);
  }

  console.log(`\nSyncing project files... (openlogos v${VERSION})\n`);

  const config = JSON.parse(readFileSync(configPath, 'utf-8'));
  const projectName = config.name || 'Unnamed Project';
  const locale = readLocale(root);
  const rawAiTool = config.aiTool ?? 'cursor';
  const aiTools = expandAiTools(rawAiTool);

  // brownfield-adopter（S33 / F7）：在**任何迁移/写副作用之前**取所有模块锁形成**读锁区间** + 恢复未终结提交，
  // 并把「迁移 → 扫描 → 索引 → 部署」全程置于同一锁区间（杜绝门检查与实际写/读之间 writer 插入的 TOCTOU）。
  // 提交进行中（锁被占用、无法恢复）→ 回调**不执行**、**零写副作用**（不迁移 lifecycle/config、不索引/部署），
  // 随后非零退出报 baseline_commit_in_progress。
  const syncInterval = withRecoveredReadLocks(root, new Date().toISOString(), listProjectModuleIds(root), () => {
  // Run migration for old projects (config.lifecycle === 'active' → mark module launched)
  const migration = migrateProjectLifecycle(root);
  if (migration.migrated && migration.autoMarked) {
    console.log(`  ✓ ${t(locale, 'launch.migrationAuto', { module: migration.autoMarked })}`);
  } else if (migration.migrated && migration.warned) {
    console.error(`  ⚠ ${t(locale, 'launch.migrationWarn')}`);
  }

  // brownfield-adopter（S33 / F6）：存量 provenance 保守迁移——历史布尔 baseline_seed_required → 枚举，
  // 缺 `## 逆向基线来源` 章节的既有文档保持 unknown（不虚构/不降级）。幂等 + 写前备份。
  const baselineMigration = migrateBaselineProvenance(root);
  if (baselineMigration.migrated) {
    console.log(`  ✓ baseline provenance migrated: ${baselineMigration.changes.join('; ')}`);
  }

  // Derive isLaunched from modules
  const yamlPath = join(root, 'logos', 'logos-project.yaml');
  let isLaunched = false;
  if (existsSync(yamlPath)) {
    try {
      const yaml = parseYaml(readFileSync(yamlPath, 'utf-8'));
      if (Array.isArray(yaml?.modules)) {
        isLaunched = (yaml.modules as Array<{ lifecycle?: string }>).some(m => m.lifecycle === 'launched');
      }
    } catch { /* ignore */ }
  }

  const namesynced = syncLogosProjectName(root, projectName);
  if (namesynced) {
    console.log(`  ✓ logos-project.yaml name synced to "${projectName}"`);
  }

  // ========== Step 1b: 补全 scenarios[].module 字段 ==========
  const scenariosUpdated = syncScenariosModuleField(root);
  if (scenariosUpdated > 0) {
    console.log(`  ✓ ${t(locale, 'sync.scenariosModuleAdded', { count: String(scenariosUpdated) })}`);
  }

  // ========== Step 2: 扫描并补录缺失的 resource_index 条目 ==========
  const indexResult = syncResourceIndex(root, locale);
  if (indexResult.added > 0) {
    console.log(`  ✓ ${t(locale, 'sync.indexAdded', { count: String(indexResult.added) })}`);
  } else {
    console.log(`  ✓ ${t(locale, 'sync.indexNoop')}`);
  }

  const requiredDocs: Record<string, { label: { en: string; zh: string }; path: string; pattern: string }> = {
    changes: {
      label: { en: 'Change Proposals', zh: '变更提案' },
      path: './changes',
      pattern: '**/*.{md,json}',
    },
  };

  if (!config.documents) config.documents = {};
  let configUpdated = false;
  for (const [key, value] of Object.entries(requiredDocs)) {
    if (!config.documents[key]) {
      config.documents[key] = value;
      configUpdated = true;
      console.log(`  ✓ documents.${key} added to logos.config.json`);
    }
  }
  if (configUpdated) {
    writeFileSync(configPath, JSON.stringify(config, null, 2));
  }

  // Ensure sourceRoots exists (backfill for older projects)
  if (!config.sourceRoots) {
    config.sourceRoots = { src: ['src'], test: ['test'] };
    writeFileSync(configPath, JSON.stringify(config, null, 2));
    console.log('  ✓ sourceRoots added to logos.config.json');
  }

  const verifyBackfill = ensureVerifyPreRunConfig(root, config);
  if (verifyBackfill.mutated) {
    writeFileSync(configPath, JSON.stringify(config, null, 2));
  }
  printVerifyPreRunBackfillResult(locale, verifyBackfill);

  writeInstructionFiles(root, locale, rawAiTool, isLaunched);
  console.log('  ✓ AGENTS.md updated');
  console.log('  ✓ CLAUDE.md updated');

  deployAiToolAssets(root, aiTools, locale, isLaunched, 'synced');

  const specResult = deploySpecs(root);
  if (specResult && specResult.count > 0) {
    console.log(`  ✓ ${specResult.count} specs synced to logos/spec/`);
  }

  // ========== proposal-ui-ux-first 切片1：GUI overlay 幂等对齐 + 缺 product_type 诊断 ==========
  // overlay 注入只依据已写入的 modules[].product_type（缺字段 = 非 GUI，不注入）——安全默认非 GUI。
  const overlaySync = syncGuiOverlay(root);
  if (overlaySync === 'injected') {
    console.log('  ✓ GUI UI-first overlay injected into logos/flow/launched.yaml');
  } else if (overlaySync === 'removed') {
    console.log('  ✓ GUI UI-first overlay removed from logos/flow/launched.yaml');
  }

  // 缺 product_type 字段的 launched 模块 → 输出 PRODUCT_TYPE_CONFIRMATION_REQUIRED 诊断（warning，不阻断）。
  const missingProductType = readModulesMissingProductType(root);
  if (missingProductType.length > 0) {
    console.warn(
      `  ⚠ PRODUCT_TYPE_CONFIRMATION_REQUIRED: ${missingProductType.length} launched module(s) missing product_type: ${missingProductType.join(', ')}`,
    );
    for (const id of missingProductType) {
      console.warn(`    → openlogos module set-product-type ${id} <web|desktop|mobile|cli|api|library|skills|service>`);
    }
  }

  console.log('\nSync complete.\n');
  });
  if (!syncInterval.ok) {
    console.error(`Error: baseline_commit_in_progress — 模块 ${syncInterval.inProgress.join(', ')} 现状基线提交进行中，请稍后重试 openlogos sync。`);
    process.exit(1);
  }

  // S08 版本戳（EX-11.1）：仅成功路径落盘——失败退出（配置缺失 / baseline_commit_in_progress）零写副作用，
  // 避免失败的 sync 刷新版本戳造成「看似已同步」的假象。幂等覆盖，始终反映最近一次成功 sync。
  writeFileSync(
    join(root, 'logos', '.openlogos-sync.json'),
    JSON.stringify({ cliVersion: VERSION, syncedAt: new Date().toISOString() }, null, 2) + '\n',
  );
}
