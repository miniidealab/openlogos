import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

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
