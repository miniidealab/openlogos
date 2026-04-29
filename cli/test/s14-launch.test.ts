import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { stringify as stringifyYaml, parse as parseYaml } from 'yaml';
import { makeTempRoot, scaffoldProject, captureConsole, mockCwd, mockProcessExit } from './helpers.js';
import { launch } from '../src/commands/launch.js';

function writeProjectYaml(root: string, data: Record<string, unknown>) {
  writeFileSync(join(root, 'logos', 'logos-project.yaml'), stringifyYaml(data, { lineWidth: 0 }));
}

function readProjectYaml(root: string) {
  return parseYaml(readFileSync(join(root, 'logos', 'logos-project.yaml'), 'utf-8')) ?? {};
}

describe('S14 Scenario Tests — launch command (module-level)', () => {
  let root: string;
  let cleanup: () => void;
  let restoreCwd: () => void;
  let con: ReturnType<typeof captureConsole>;
  let exitSpy: ReturnType<typeof mockProcessExit>;

  beforeEach(() => {
    ({ root, cleanup } = makeTempRoot());
    scaffoldProject(root, { locale: 'en' });
    restoreCwd = mockCwd(root);
    con = captureConsole();
    exitSpy = mockProcessExit();
  });

  afterEach(() => {
    con.restore();
    exitSpy.mockRestore();
    restoreCwd();
    cleanup();
  });

  /* ---- single-module auto-detect ---- */

  it('ST-S14-01: single module, no arg → auto-launches and marks lifecycle=launched', () => {
    writeProjectYaml(root, {
      modules: [{ id: 'core', name: 'Core', lifecycle: 'initial' }],
    });
    const configPath = join(root, 'logos', 'logos.config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    config.aiTool = 'cursor';
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    launch();

    const yaml = readProjectYaml(root);
    expect(yaml.modules[0].lifecycle).toBe('launched');
    expect(con.logs.join('\n')).toContain('launched');
  });

  it('ST-S14-02: launch regenerates AGENTS.md with enforced change management', () => {
    writeProjectYaml(root, {
      modules: [{ id: 'core', name: 'Core', lifecycle: 'initial' }],
    });
    const configPath = join(root, 'logos', 'logos.config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    config.aiTool = 'cursor';
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    launch();

    const agents = readFileSync(join(root, 'AGENTS.md'), 'utf-8');
    expect(agents).toContain('Change Management (Enforced)');
    expect(agents).toContain('.openlogos-guard');
    expect(agents).not.toContain('Initial Development');
  });

  it('ST-S14-03: launch updates openlogos-policy.mdc for cursor projects', () => {
    writeProjectYaml(root, {
      modules: [{ id: 'core', name: 'Core', lifecycle: 'initial' }],
    });
    const configPath = join(root, 'logos', 'logos.config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    config.aiTool = 'cursor';
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    launch();

    const policyPath = join(root, '.cursor', 'rules', 'openlogos-policy.mdc');
    expect(existsSync(policyPath)).toBe(true);
    const policy = readFileSync(policyPath, 'utf-8');
    expect(policy).toContain('Enforced');
    expect(policy).toContain('.openlogos-guard');
    expect(policy).not.toContain('Initial Development');
  });

  /* ---- explicit module-id ---- */

  it('ST-S14-04: explicit module-id launches that module', () => {
    writeProjectYaml(root, {
      modules: [
        { id: 'core', name: 'Core', lifecycle: 'initial' },
        { id: 'payment', name: 'Payment', lifecycle: 'initial' },
      ],
    });

    launch('core');

    const yaml = readProjectYaml(root);
    expect(yaml.modules.find((m: { id: string }) => m.id === 'core').lifecycle).toBe('launched');
    expect(yaml.modules.find((m: { id: string }) => m.id === 'payment').lifecycle).toBe('initial');
  });

  /* ---- multi-module no-arg error ---- */

  it('ST-S14-05: multi-module, no arg → error exit', () => {
    writeProjectYaml(root, {
      modules: [
        { id: 'core', name: 'Core', lifecycle: 'initial' },
        { id: 'payment', name: 'Payment', lifecycle: 'initial' },
      ],
    });

    expect(() => launch()).toThrow('process.exit(1)');
    expect(con.errors.join('\n')).toContain('module-id');
  });

  /* ---- already launched ---- */

  it('ST-S14-06: already launched module → no-op with message', () => {
    writeProjectYaml(root, {
      modules: [{ id: 'core', name: 'Core', lifecycle: 'launched' }],
    });

    launch('core');

    expect(con.logs.join('\n')).toContain('already');
    const yaml = readProjectYaml(root);
    expect(yaml.modules[0].lifecycle).toBe('launched');
  });

  /* ---- module not found ---- */

  it('ST-S14-07: unknown module-id → error exit', () => {
    writeProjectYaml(root, {
      modules: [{ id: 'core', name: 'Core', lifecycle: 'initial' }],
    });

    expect(() => launch('ghost')).toThrow('process.exit(1)');
    expect(con.errors.join('\n')).toContain('ghost');
  });

  /* ---- uninitialized project ---- */

  it('ST-S14-08: uninitialized project → error exit', () => {
    const emptyRoot = makeTempRoot();
    const restoreEmpty = mockCwd(emptyRoot.root);
    try {
      expect(() => launch()).toThrow('process.exit(1)');
      expect(con.errors.join('\n')).toContain('logos.config.json not found');
    } finally {
      restoreEmpty();
      emptyRoot.cleanup();
    }
  });

  /* ---- zh locale ---- */

  it('ST-S14-09: zh locale outputs Chinese messages', () => {
    scaffoldProject(root, { locale: 'zh' });
    writeProjectYaml(root, {
      modules: [{ id: 'core', name: '核心功能', lifecycle: 'initial' }],
    });
    const configPath = join(root, 'logos', 'logos.config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    config.aiTool = 'cursor';
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    launch();

    expect(con.logs.join('\n')).toContain('已 launch');
  });

  /* ---- old project migration ---- */

  it('ST-S14-10: old config.lifecycle=active, single module → auto-migrates', () => {
    writeProjectYaml(root, {
      modules: [{ id: 'core', name: 'Core', lifecycle: 'initial' }],
    });
    const configPath = join(root, 'logos', 'logos.config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    config.lifecycle = 'active';
    config.aiTool = 'cursor';
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    // After migration, core is already launched, so launch() should be a no-op
    launch();

    const yaml = readProjectYaml(root);
    expect(yaml.modules[0].lifecycle).toBe('launched');
  });

  it('ST-S14-11: old config.lifecycle=active, multi-module → warns user', () => {
    writeProjectYaml(root, {
      modules: [
        { id: 'core', name: 'Core', lifecycle: 'initial' },
        { id: 'payment', name: 'Payment', lifecycle: 'initial' },
      ],
    });
    const configPath = join(root, 'logos', 'logos.config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    config.lifecycle = 'active';
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    // multi-module no-arg still errors even after migration warning
    expect(() => launch()).toThrow('process.exit(1)');
    const allOutput = [...con.logs, ...con.errors].join('\n');
    expect(allOutput).toContain('module-id');
  });

  /* ---- Fix 1: aiTool array support ---- */

  it('ST-S14-12: aiTool array → deploys artifacts for all tools', () => {
    writeProjectYaml(root, {
      modules: [{ id: 'core', name: 'Core', lifecycle: 'initial' }],
    });
    const configPath = join(root, 'logos', 'logos.config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    config.aiTool = ['cursor', 'opencode', 'codex'];
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    launch();

    expect(existsSync(join(root, '.cursor', 'rules', 'openlogos-policy.mdc'))).toBe(true);
    expect(existsSync(join(root, '.opencode', 'plugins', 'openlogos.js'))).toBe(true);
    expect(existsSync(join(root, '.codex-plugin', 'plugin.json'))).toBe(true);
    const yaml = readProjectYaml(root);
    expect(yaml.modules[0].lifecycle).toBe('launched');
  });

  /* ---- Fix 3: migration auto-marked → rules still refreshed ---- */

  it('ST-S14-14: old config.lifecycle=active, single module → migrates and refreshes rules', () => {
    writeProjectYaml(root, {
      modules: [{ id: 'core', name: 'Core', lifecycle: 'initial' }],
    });
    const configPath = join(root, 'logos', 'logos.config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    config.lifecycle = 'active';
    config.aiTool = 'cursor';
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    launch();

    // Rules must be regenerated even though migration already marked module as launched
    const agents = readFileSync(join(root, 'AGENTS.md'), 'utf-8');
    expect(agents).toContain('Change Management (Enforced)');
    const policy = readFileSync(join(root, '.cursor', 'rules', 'openlogos-policy.mdc'), 'utf-8');
    expect(policy).toContain('Enforced');
  });

  /* ---- Fix 5: config.lifecycle removed after launch ---- */

  it('ST-S14-13: launch removes stale config.lifecycle field', () => {
    writeProjectYaml(root, {
      modules: [{ id: 'core', name: 'Core', lifecycle: 'initial' }],
    });
    const configPath = join(root, 'logos', 'logos.config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    config.lifecycle = 'active';
    config.aiTool = 'cursor';
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    launch();

    const updatedConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect('lifecycle' in updatedConfig).toBe(false);
  });
});
