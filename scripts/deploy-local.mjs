#!/usr/bin/env node
/**
 * 本仓 test 环境（本机 npm 全局安装态）的部署脚本。
 *
 * 由 `openlogos deploy --env test` 以 script 方式在请求 commit 的隔离工作树中执行（spec/environments.md §11.3），
 * 不经 shell、只依赖 Node 内置模块。步骤与失败处置的权威定义见部署方案
 * 「本机测试环境脚本部署（scripts/deploy-local.mjs）」第四～六节：
 *
 *   ① 输入校验 → ② 冻结当前全局 → ③ 回滚制品 → ④ 回滚制品隔离试装 → ⑤ 构建候选 → ⑥ 候选隔离试装
 *   → ⑦ 全局安装 → ⑧ 全局复核 → ⑨ 写回执
 *
 * ①～⑥ 失败时不触碰全局；进入 ⑦ 之前记下「全局将被改动」，此后 ⑦⑧⑨ 任一失败都回装回滚制品并按 ④ 的判据复核。
 * 回执写在主工作树 logos/.openlogos-runtime/local-install/last-deploy.json（隔离工作树会在脚本结束后被 CLI 删除）。
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  accessSync, constants, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync,
  renameSync, rmSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, isAbsolute, join, relative } from 'node:path';
import { gunzipSync } from 'node:zlib';

const PACKAGE_NAME = '@miniidealab/openlogos';
const BIN_NAME = 'openlogos';
const ENTRY_REL = 'dist/index.js';
const RUNTIME_REL = 'logos/.openlogos-runtime/local-install';
const RECEIPT_NAME = 'last-deploy.json';
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';

/** 某一步失败：携带步骤编号与面向人的原因。 */
class StepError extends Error {
  constructor(step, message) {
    super(message);
    this.step = step;
  }
}

const log = (step, message) => process.stdout.write(`[deploy-local] ${step} ${message}\n`);
const warn = message => process.stderr.write(`[deploy-local] ${message}\n`);
const sha256 = buf => createHash('sha256').update(buf).digest('hex');
const sha256File = file => sha256(readFileSync(file));

/** 摘要：取输出末尾若干行，避免把整段 npm 日志塞进回执。 */
function tail(text, lines = 6) {
  return String(text ?? '').trim().split('\n').slice(-lines).join(' | ');
}

function run(step, command, args, options = {}) {
  const r = spawnSync(command, args, { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024, ...options });
  if (r.error) throw new StepError(step, `${command} ${args.join(' ')} 无法执行：${r.error.message}`);
  if (r.status !== 0) {
    throw new StepError(step, `${command} ${args.join(' ')} 退出码 ${r.status}：${tail(r.stderr || r.stdout)}`);
  }
  return r.stdout;
}

/** 等价于 `command -v openlogos`：按当前 PATH 顺序找第一个可执行文件；找不到返回 null。 */
function resolveCommand(name) {
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, name);
    try {
      if (!statSync(candidate).isFile()) continue;
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // 不存在或不可执行，继续找
    }
  }
  return null;
}

function versionOf(step, entry) {
  return run(step, entry, ['--version']).trim();
}

function isInside(child, parent) {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/** 全局（或隔离）prefix 下的包目录与入口。 */
function layout(prefix) {
  const pkgDir = join(prefix, 'lib', 'node_modules', ...PACKAGE_NAME.split('/'));
  return { pkgDir, entryFile: join(pkgDir, ENTRY_REL), bin: join(prefix, 'bin', BIN_NAME) };
}

/**
 * 读 .tgz 中的若干文件（ustar + pax 长路径），只用 zlib，不依赖 tar 命令。
 * 返回 Map<路径, Buffer>。
 */
function readTarball(file, wanted) {
  const data = gunzipSync(readFileSync(file));
  const found = new Map();
  let offset = 0;
  let paxPath = null;
  while (offset + 512 <= data.length) {
    const header = data.subarray(offset, offset + 512);
    if (header.every(b => b === 0)) break;
    const field = (start, len) => header.subarray(start, start + len).toString('utf-8').replace(/\0.*$/s, '');
    const size = parseInt(field(124, 12).trim() || '0', 8);
    const type = field(156, 1);
    const prefix = field(345, 155);
    const name = paxPath ?? (prefix ? `${prefix}/${field(0, 100)}` : field(0, 100));
    const body = data.subarray(offset + 512, offset + 512 + size);
    if (type === 'x') {
      const match = /\d+ path=([^\n]*)\n/.exec(body.toString('utf-8'));
      paxPath = match ? match[1] : null;
    } else {
      if ((type === '0' || type === '' || type === '\0') && wanted.includes(name)) found.set(name, Buffer.from(body));
      paxPath = null;
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return found;
}

/** 在一次性目录执行 npm pack，返回唯一产出的 tarball 路径；产出不是恰好一个时报错。 */
function packInto(step, cwd, extraArgs) {
  const dest = mkdtempSync(join(tmpdir(), 'deploy-local-pack-'));
  run(step, NPM, ['pack', ...extraArgs, '--pack-destination', dest], { cwd });
  const tgz = readdirSync(dest).filter(f => f.endsWith('.tgz'));
  if (tgz.length !== 1) {
    rmSync(dest, { recursive: true, force: true });
    throw new StepError(step, `npm pack 应恰好产出 1 个 tarball，实际 ${tgz.length} 个`);
  }
  return { file: join(dest, tgz[0]), dir: dest };
}

/** 在一次性 prefix 中安装 tarball，返回该 prefix 下的版本与入口哈希。 */
function trialInstall(step, tarball, scratch) {
  const prefix = mkdtempSync(join(tmpdir(), 'deploy-local-prefix-'));
  scratch.push(prefix);
  run(step, NPM, ['install', '-g', '--prefix', prefix, tarball]);
  const { bin, entryFile } = layout(prefix);
  if (!existsSync(bin)) throw new StepError(step, `隔离安装后入口不存在：${bin}`);
  return { version: versionOf(step, bin), entrySha: existsSync(entryFile) ? sha256File(entryFile) : null };
}

/** 主工作树根：git common dir 的上级目录（在隔离工作树中执行时也指向主仓）。 */
function mainWorktreeRoot(cwd) {
  const out = run('①', 'git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd }).trim();
  return dirname(out);
}

/** 原子写回执：同目录临时文件写入后 rename；失败时删除临时文件并抛出。 */
function writeReceipt(dir, deployId, receipt) {
  mkdirSync(dir, { recursive: true });
  const target = join(dir, RECEIPT_NAME);
  const tmp = join(dir, `.${RECEIPT_NAME}.${deployId}.tmp`);
  try {
    writeFileSync(tmp, `${JSON.stringify(receipt, null, 2)}\n`);
    renameSync(tmp, target);
  } catch (error) {
    try {
      if (existsSync(tmp) && statSync(tmp).isFile()) unlinkSync(tmp);
    } catch {
      // 清理临时文件失败不掩盖原错误
    }
    throw error;
  }
}

/** 读当前全局状态：prefix、包是否已装、PATH 解析到的入口与版本、入口哈希。 */
function readGlobal(step) {
  const prefix = run(step, NPM, ['prefix', '-g']).trim();
  const { pkgDir, entryFile } = layout(prefix);
  const installed = existsSync(join(pkgDir, 'package.json'));
  if (!installed) return { prefix, pkgDir, installed: false, version: null, entrySha: null, entry: null };
  const entry = resolveCommand(BIN_NAME);
  if (!entry) throw new StepError(step, `全局包存在（${pkgDir}）但 PATH 中解析不到 ${BIN_NAME}`);
  return {
    prefix, pkgDir, installed: true, entry,
    version: versionOf(step, entry),
    entrySha: existsSync(entryFile) ? sha256File(entryFile) : null,
  };
}

/** ⑧ / 回装复核共用：重新解析入口，核对 realpath、版本、package.json 与入口哈希。 */
function verifyGlobal(step, prefix, expectVersion, expectEntrySha) {
  const entry = resolveCommand(BIN_NAME);
  if (!entry) throw new StepError(step, `PATH 中解析不到 ${BIN_NAME}`);
  const real = realpathSync(entry);
  const realPrefix = realpathSync(prefix);
  if (!isInside(real, realPrefix)) throw new StepError(step, `入口 ${real} 不在 npm prefix -g（${realPrefix}）之下`);
  const version = versionOf(step, entry);
  if (version !== expectVersion) throw new StepError(step, `--version 为 ${version}，期望 ${expectVersion}`);
  const { pkgDir, entryFile } = layout(prefix);
  const pkgVersion = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf-8')).version;
  if (pkgVersion !== expectVersion) throw new StepError(step, `全局 package.json 版本为 ${pkgVersion}，期望 ${expectVersion}`);
  const entrySha = existsSync(entryFile) ? sha256File(entryFile) : null;
  if (entrySha !== expectEntrySha) throw new StepError(step, `全局 ${ENTRY_REL} 的 SHA-256 为 ${entrySha}，期望 ${expectEntrySha}`);
  return real;
}

/** 全局已被改动后的恢复：有回滚制品则回装并复核，否则只给出人工命令。 */
function restore(state) {
  if (!state.rollback) {
    return { restored: false, error: '无回滚制品（部署前未全局安装），不自动卸载', manual: `npm uninstall -g ${PACKAGE_NAME}` };
  }
  const manual = `npm install -g ${state.rollback.path}`;
  try {
    run('回装', NPM, ['install', '-g', state.rollback.path]);
    verifyGlobal('回装复核', state.prefix, state.previousVersion, state.previousEntrySha);
    return { restored: true, error: null, manual };
  } catch (error) {
    return { restored: false, error: `${error.step ?? '回装'}：${error.message}`, manual };
  }
}

function main() {
  const cwd = process.cwd();
  const env = process.env;

  // ① 输入校验：失败时运行态目录未必可定位，不写回执
  const missing = ['OPENLOGOS_DEPLOY_ENV', 'OPENLOGOS_DEPLOY_REF', 'OPENLOGOS_DEPLOY_ID'].filter(k => !env[k]);
  if (missing.length > 0) {
    warn(`失败步骤：① 缺少环境变量 ${missing.join('、')}（本脚本应由 openlogos deploy 执行）`);
    return 2;
  }
  const deployId = env.OPENLOGOS_DEPLOY_ID;
  const ref = env.OPENLOGOS_DEPLOY_REF;
  let head;
  let runtimeDir;
  try {
    head = run('①', 'git', ['rev-parse', 'HEAD'], { cwd }).trim();
    runtimeDir = join(mainWorktreeRoot(cwd), RUNTIME_REL);
  } catch (error) {
    warn(`失败步骤：① ${error.message}`);
    return 2;
  }
  if (head !== ref) {
    warn(`失败步骤：① 当前工作树 HEAD ${head} 不等于请求 commit ${ref}`);
    return 2;
  }
  log('①', `输入校验通过：environment=${env.OPENLOGOS_DEPLOY_ENV} ref=${ref} deploy_id=${deployId}`);

  const receipt = {
    deploy_id: deployId,
    environment: env.OPENLOGOS_DEPLOY_ENV,
    ref,
    candidate_version: null,
    candidate_tarball: null,
    candidate_entry_sha256: null,
    prefix: null,
    entry_realpath: null,
    previous_version: null,
    previous_entry_sha256: null,
    rollback_artifact: null,
    result: 'failed',
    failed_step: null,
    restored: false,
    restore_error: null,
    recorded_at: null,
  };
  const scratch = [];
  const state = { prefix: null, rollback: null, previousVersion: null, previousEntrySha: null };
  let globalTouched = false;
  let current = '②';

  try {
    // ② 冻结当前全局
    current = '②';
    const before = readGlobal('②');
    state.prefix = before.prefix;
    state.previousVersion = before.version;
    state.previousEntrySha = before.entrySha;
    Object.assign(receipt, { prefix: before.prefix, previous_version: before.version, previous_entry_sha256: before.entrySha });
    log('②', before.installed
      ? `当前全局：${before.version}（${realpathSync(before.entry)}）`
      : `当前全局未安装 ${PACKAGE_NAME}`);

    // ③ 回滚制品（取自全局安装目录，禁止从工作树打包）；④ 隔离试装验证
    if (before.installed) {
      current = '③';
      const packed = packInto('③', before.pkgDir, ['--ignore-scripts']);
      scratch.push(packed.dir);
      const rollbackPath = join(runtimeDir, 'rollback', `${deployId}.tgz`);
      mkdirSync(dirname(rollbackPath), { recursive: true });
      copyFileSync(packed.file, rollbackPath);
      if (statSync(rollbackPath).size === 0) throw new StepError('③', `回滚制品为空：${rollbackPath}`);
      state.rollback = { path: rollbackPath, sha256: sha256File(rollbackPath) };
      receipt.rollback_artifact = state.rollback;
      log('③', `回滚制品：${rollbackPath}（sha256 ${state.rollback.sha256}）`);

      current = '④';
      const trial = trialInstall('④', rollbackPath, scratch);
      if (trial.version !== before.version) throw new StepError('④', `回滚制品隔离试装 --version 为 ${trial.version}，期望 ${before.version}`);
      if (trial.entrySha !== before.entrySha) throw new StepError('④', `回滚制品隔离试装 ${ENTRY_REL} 的 SHA-256 与当前全局不一致`);
      log('④', '回滚制品隔离试装通过');
    } else {
      log('③', '未全局安装，回滚制品为 null，跳过 ④');
    }

    // ⑤ 构建候选
    current = '⑤';
    const cliDir = join(cwd, 'cli');
    const declared = JSON.parse(readFileSync(join(cliDir, 'package.json'), 'utf-8')).version;
    run('⑤', NPM, ['ci'], { cwd: cliDir });
    const candidatePacked = packInto('⑤', cliDir, []);
    scratch.push(candidatePacked.dir);
    const candidatePath = join(runtimeDir, 'candidates', `${deployId}.tgz`);
    mkdirSync(dirname(candidatePath), { recursive: true });
    copyFileSync(candidatePacked.file, candidatePath);
    const files = readTarball(candidatePath, ['package/package.json', `package/${ENTRY_REL}`]);
    const pkgJson = files.get('package/package.json');
    const entryBuf = files.get(`package/${ENTRY_REL}`);
    if (!pkgJson || !entryBuf) throw new StepError('⑤', `候选包缺少 package.json 或 ${ENTRY_REL}`);
    const candidateVersion = JSON.parse(pkgJson.toString('utf-8')).version;
    if (candidateVersion !== declared) throw new StepError('⑤', `候选包版本 ${candidateVersion} 不等于 cli/package.json 的 ${declared}`);
    const candidateEntrySha = sha256(entryBuf);
    Object.assign(receipt, {
      candidate_version: candidateVersion,
      candidate_tarball: { path: candidatePath, sha256: sha256File(candidatePath) },
      candidate_entry_sha256: candidateEntrySha,
    });
    log('⑤', `候选：${candidateVersion}（${candidatePath}）`);

    // ⑥ 候选隔离试装
    current = '⑥';
    const candidateTrial = trialInstall('⑥', candidatePath, scratch);
    if (candidateTrial.version !== candidateVersion) {
      throw new StepError('⑥', `候选隔离试装 --version 为 ${candidateTrial.version}，期望 ${candidateVersion}`);
    }
    log('⑥', '候选隔离试装通过');

    // ⑦ 全局安装：从这里开始全局可能已被改动
    current = '⑦';
    globalTouched = true;
    run('⑦', NPM, ['install', '-g', candidatePath]);
    log('⑦', '已全局安装候选');

    // ⑧ 全局复核
    current = '⑧';
    receipt.entry_realpath = verifyGlobal('⑧', state.prefix, candidateVersion, candidateEntrySha);
    log('⑧', `全局复核通过：${receipt.entry_realpath}`);

    // ⑨ 写回执
    current = '⑨';
    receipt.result = 'done';
    receipt.recorded_at = new Date().toISOString();
    try {
      writeReceipt(runtimeDir, deployId, receipt);
    } catch (error) {
      receipt.result = 'failed';
      throw new StepError('⑨', `回执写入失败：${error.message}`);
    }
    log('⑨', `回执：${join(runtimeDir, RECEIPT_NAME)}`);
    return 0;
  } catch (error) {
    const step = error instanceof StepError ? error.step : current;
    receipt.result = 'failed';
    receipt.failed_step = step;
    warn(`失败步骤：${step} ${error.message}`);
    let manual = null;
    if (globalTouched) {
      const outcome = restore(state);
      receipt.restored = outcome.restored;
      receipt.restore_error = outcome.error;
      manual = outcome.manual;
      warn(`恢复结果：${outcome.restored ? `已回装并复核通过（${state.previousVersion}）` : `未恢复：${outcome.error}`}`);
      warn(`回滚制品：${state.rollback ? state.rollback.path : '无回滚制品'}`);
      warn(`人工恢复命令：${manual}`);
    } else {
      warn('全局未被改动');
    }
    receipt.recorded_at = new Date().toISOString();
    try {
      writeReceipt(runtimeDir, deployId, { ...receipt, manual_recovery: manual });
    } catch (writeError) {
      warn(`回执写不出：${writeError.message}（恢复信息以上述 stderr 为准）`);
    }
    return 1;
  } finally {
    // 尽力清理：逐目录捕获，失败只告警不改结论（code r1 F1）。finally 中抛出的异常会覆盖上面已确定的返回值、
    // 绕过 catch 中的恢复分支——换包成功并写了 done 回执后，若因清理失败非零退出，CLI 会记 failed，
    // 造成「全局为新版、回执 done、账本 failed」的版本事实不一致。
    for (const dir of scratch) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch (error) {
        warn(`临时目录清理失败（不影响部署结论，可手动删除）：${dir}：${error.message}`);
      }
    }
  }
}

process.exitCode = main();
