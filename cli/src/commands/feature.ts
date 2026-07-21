/**
 * feature — add-feature-model（S34，切片2）：`openlogos feature list` 只读分组视图。
 *
 * 规范源：spec/cli-json-output.md §1.4「feature list / feature-backfill 命令契约」、
 * logos/resources/prd/1-product-requirements S34 验收。
 *
 * 范式：AI 维护数据、CLI 只读 —— 本命令**只读** `logos-project.yaml`，不取号、不写回。
 * 专用分组视图：对每个 module 列出全部注册 feature（空成员 `scenarios:[]`）+ 末位 `__ungrouped__`
 * （当有未归属/降级场景）；有场景无注册 feature 返回 `[{__ungrouped__}]`，`features:[]` 仅真正空 module。
 * `--module` 未注册 → 错误码 `MODULE_NOT_FOUND`、非零退出。
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readProjectYaml } from '../lib/project-yaml.js';
import { buildModuleFeatureList } from '../lib/feature-grouping.js';
import { makeEnvelope, makeErrorEnvelope } from '../lib/json-output.js';
import type { OutputFormat } from '../lib/json-output.js';
import type { FeatureGroupItem } from '../lib/feature-grouping.js';

interface FeatureListModule {
  id: string;
  name: string;
  features: FeatureGroupItem[];
}

export function featureList(format: OutputFormat = 'text', moduleId?: string): void {
  const root = process.cwd();

  if (!existsSync(join(root, 'logos', 'logos.config.json'))) {
    if (format === 'json') {
      process.stderr.write(JSON.stringify(makeErrorEnvelope('feature list', 'PROJECT_NOT_INITIALIZED', 'logos/logos.config.json not found.')) + '\n');
    } else {
      console.error('Error: logos/logos.config.json not found.');
      console.error('Run `openlogos init` first to initialize the project.');
    }
    process.exit(1);
    return;
  }

  const data = readProjectYaml(root).data;
  const rawModules = data?.modules;
  const scenarios = data?.scenarios ?? [];
  const features = data?.features;

  // module 清单：优先 modules[]；缺失时按 scenarios 的 module（默认 'core'）派生单/多模块
  const moduleList: Array<{ id: string; name: string }> = rawModules && rawModules.length > 0
    ? rawModules.map((m) => ({ id: m.id, name: m.name }))
    : [...new Set(scenarios.map((s) => s.module ?? 'core'))].map((id) => ({ id, name: id }));

  // --module 未注册 → MODULE_NOT_FOUND、非零退出
  if (moduleId !== undefined && !moduleList.some((m) => m.id === moduleId)) {
    const msg = `Module "${moduleId}" is not registered in logos-project.yaml modules[].`;
    if (format === 'json') {
      process.stderr.write(JSON.stringify(makeErrorEnvelope('feature list', 'MODULE_NOT_FOUND', msg)) + '\n');
    } else {
      console.error(`Error: ${msg}`);
    }
    process.exit(1);
    return;
  }

  const targets = moduleId ? moduleList.filter((m) => m.id === moduleId) : moduleList;
  const result: FeatureListModule[] = targets.map((m) => {
    const moduleScenarios = scenarios.filter((s) => (s.module ?? 'core') === m.id);
    return { id: m.id, name: m.name, features: buildModuleFeatureList(m.id, moduleScenarios, features) };
  });

  if (format === 'json') {
    process.stdout.write(JSON.stringify(makeEnvelope('feature list', { modules: result })) + '\n');
    return;
  }

  // text 渲染
  if (result.length === 0) {
    console.log('No modules to list features for.');
    return;
  }
  console.log('\n🗂  Feature Groups\n');
  for (const m of result) {
    console.log(`  ${m.id}  ${m.name}`);
    if (m.features.length === 0) {
      console.log('    (no features, no scenarios)');
      continue;
    }
    for (const f of m.features) {
      const specSuffix = f.spec ? `  → ${f.spec}` : '';
      console.log(`    ${f.id}  ${f.name}${specSuffix}  (${f.scenarios.length})`);
      for (const s of f.scenarios) {
        console.log(`      - ${s.id}  ${s.name}`);
      }
    }
  }
  console.log();
}
