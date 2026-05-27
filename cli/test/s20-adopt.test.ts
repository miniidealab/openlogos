import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, basename } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { makeTempRoot, scaffoldProject, captureConsole, mockCwd, mockProcessExit } from './helpers.js';
import { detectProjectName } from '../src/commands/init.js';
import { adopt } from '../src/commands/adopt.js';
import { next } from '../src/commands/next.js';
import { collectStatusData } from '../src/commands/status.js';
import { launch } from '../src/commands/launch.js';

describe('S20 Unit Tests — adopt', () => {
  let root: string;
  let cleanup: () => void;

  beforeEach(() => {
    ({ root, cleanup } = makeTempRoot());
  });
  afterEach(() => cleanup());

  it('UT-S20-01: 读取 package.json 提取项目名', () => {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'my-app' }));
    const detected = detectProjectName(root);
    expect(detected.name).toBe('my-app');
    expect(detected.source).toBe('package.json');
  });

  it('UT-S20-02: 读取 Cargo.toml 提取项目名', () => {
    writeFileSync(join(root, 'Cargo.toml'), '[package]\nname = "rust-app"\nversion = "0.1.0"\n');
    const detected = detectProjectName(root);
    expect(detected.name).toBe('rust-app');
    expect(detected.source).toBe('Cargo.toml');
  });

  it('UT-S20-03: 无清单文件时目录名兜底', () => {
    const detected = detectProjectName(root);
    expect(detected.name).toBe(basename(root));
    expect(detected.source).toBe('directory');
  });

  it('UT-S20-04: 已初始化项目应拒绝重复接入', async () => {
    scaffoldProject(root, { locale: 'zh' });
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'existing-app' }));
    const restoreCwd = mockCwd(root);
    const con = captureConsole();
    const exitSpy = mockProcessExit();
    try {
      await expect(adopt(undefined, { locale: 'zh', aiTool: 'cursor' })).rejects.toThrow('process.exit(1)');
      expect(con.errors.join('\n')).toContain('该项目已初始化');
    } finally {
      con.restore();
      exitSpy.mockRestore();
      restoreCwd();
    }
  });
});

describe('S20 Scenario Tests — adopt command', () => {
  let root: string;
  let cleanup: () => void;
  let restoreCwd: () => void;
  let con: ReturnType<typeof captureConsole>;
  let exitSpy: ReturnType<typeof mockProcessExit>;

  beforeEach(() => {
    ({ root, cleanup } = makeTempRoot());
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

  it('ST-S20-01: 已有项目完整接入，生成 bootstrap=adopted 与 lifecycle=launched', async () => {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'existing-app' }));

    await adopt(undefined, { locale: 'zh', aiTool: 'cursor' });

    expect(existsSync(join(root, 'logos', 'logos.config.json'))).toBe(true);
    expect(existsSync(join(root, 'logos', 'logos-project.yaml'))).toBe(true);
    expect(existsSync(join(root, 'AGENTS.md'))).toBe(true);
    expect(existsSync(join(root, 'CLAUDE.md'))).toBe(true);

    const yaml = parseYaml(readFileSync(join(root, 'logos', 'logos-project.yaml'), 'utf-8')) as {
      modules?: Array<{ lifecycle?: string; bootstrap?: string }>;
    };
    expect(yaml.modules?.[0].bootstrap).toBe('adopted');
    expect(yaml.modules?.[0].lifecycle).toBe('launched');
    expect(existsSync(join(root, 'logos', 'spec'))).toBe(true);
    expect(existsSync(join(root, 'logos', 'skills'))).toBe(true);
  });

  it('ST-S20-02: adopt 后 next 输出补文档引导', async () => {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'existing-app' }));
    await adopt(undefined, { locale: 'zh', aiTool: 'cursor' });
    con.restore();
    con = captureConsole();

    next();
    const out = con.logs.join('\n');
    expect(out).toContain('openlogos change add-baseline-docs');
  });

  it('ST-S20-03: adopt 后 status 将 Phase 1~3 标记为 skipped', async () => {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'existing-app' }));
    await adopt(undefined, { locale: 'zh', aiTool: 'cursor' });

    const data = collectStatusData(root);
    expect(data.modules?.[0].bootstrap).toBe('adopted');
    expect(data.phases.find(p => p.key === 'phase.1')?.skipped).toBe(true);
    expect(data.phases.find(p => p.key === 'phase.2')?.skipped).toBe(true);
    expect(data.phases.find(p => p.key === 'phase.3-0')?.skipped).toBe(true);
  });

  it('ST-S20-04: adopt 后 launch 可豁免 verify/deploy/smoke 门禁', async () => {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'existing-app' }));
    await adopt(undefined, { locale: 'zh', aiTool: 'cursor' });
    con.restore();
    con = captureConsole();

    launch();
    const out = con.logs.join('\n');
    expect(out).toContain('已 launch');
  });

  it('UT-S20-07 / ST-S20-05: adopt 可识别测试栈时写入 verify.pre_run_command', async () => {
    writeFileSync(join(root, 'package.json'), JSON.stringify({
      name: 'existing-app',
      scripts: { test: 'vitest run' },
    }));

    await adopt(undefined, { locale: 'zh', aiTool: 'cursor' });

    const config = JSON.parse(readFileSync(join(root, 'logos', 'logos.config.json'), 'utf-8'));
    expect(config.verify.pre_run_command).toBe('npm test');
    expect(con.logs.join('\n')).toContain('verify 预跑配置');
  });

  it('UT-S20-08 / ST-S20-EX-02: adopt 无法推断测试命令时输出 TODO', async () => {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'existing-app' }));

    await adopt(undefined, { locale: 'zh', aiTool: 'cursor' });

    const config = JSON.parse(readFileSync(join(root, 'logos', 'logos.config.json'), 'utf-8'));
    expect(config.verify.pre_run_command).toBeUndefined();
    expect(con.logs.join('\n')).toContain('无法推断 verify 预跑配置');
  });

  it('ST-S20-EX-01: 已初始化项目拒绝重复接入', async () => {
    scaffoldProject(root, { locale: 'zh' });
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'existing-app' }));

    await expect(adopt(undefined, { locale: 'zh', aiTool: 'cursor' })).rejects.toThrow('process.exit(1)');
    const allErrors = con.errors.join('\n');
    expect(allErrors).toContain('该项目已初始化');
  });

  it('UT-S20-05: adopt 可在无清单文件时通过目录名兜底', async () => {
    const packagePath = join(root, 'package.json');
    if (existsSync(packagePath)) rmSync(packagePath);

    await adopt(undefined, { locale: 'zh', aiTool: 'cursor' });

    const yaml = parseYaml(readFileSync(join(root, 'logos', 'logos-project.yaml'), 'utf-8')) as {
      modules?: Array<{ lifecycle?: string; bootstrap?: string }>;
      project?: { name?: string };
    };
    expect(yaml.project?.name).toBe(basename(root));
  });

  it('UT-S20-06: adopt 写入 bootstrap=adopted 与 lifecycle=launched', async () => {
    const packagePath = join(root, 'package.json');
    if (existsSync(packagePath)) rmSync(packagePath);

    await adopt(undefined, { locale: 'zh', aiTool: 'cursor' });

    const yaml = parseYaml(readFileSync(join(root, 'logos', 'logos-project.yaml'), 'utf-8')) as {
      modules?: Array<{ lifecycle?: string; bootstrap?: string }>;
    };
    expect(yaml.modules?.[0].bootstrap).toBe('adopted');
    expect(yaml.modules?.[0].lifecycle).toBe('launched');
  });

  it('UT-S20-09 / ST-S20-06: 历史 bootstrap=skipped 兼容为 adopted 接入模式', () => {
    scaffoldProject(root, { locale: 'zh' });
    writeFileSync(join(root, 'logos', 'logos-project.yaml'), stringifyYaml({
      modules: [{ id: 'core', name: '核心功能', lifecycle: 'launched', bootstrap: 'skipped' }],
      deployment_gates: { core: { deployment_required: true, smoke_required: true } },
    }, { lineWidth: 0 }));

    const data = collectStatusData(root);
    expect(data.modules?.[0].bootstrap).toBe('adopted');
    expect(data.phases.find(p => p.key === 'phase.1')?.skipped).toBe(true);

    next();
    expect(con.logs.join('\n')).toContain('openlogos change add-baseline-docs');
  });
});
