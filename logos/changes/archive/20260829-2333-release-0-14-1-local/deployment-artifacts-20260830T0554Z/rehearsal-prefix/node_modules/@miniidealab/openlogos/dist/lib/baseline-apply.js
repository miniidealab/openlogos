/**
 * S39 baseline-on-touch：merge-executor 可复用的整批落盘事务原语。
 *
 * - non-Markdown API/DB delta 先经 baseline-closure 唯一 validator 剥离与预检；
 * - Markdown 最终字节、counter、index 与 SPEC_MERGED 作为 prepared writes 加入同一事务；
 * - 所有存在性/哈希事实先验证，随后 journal + staging + backup 提交；
 * - 任一步失败或崩溃后统一回滚为全旧，绝不留下部分目标或 marker。
 */
import { createHash } from 'node:crypto';
import { closeSync, copyFileSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmdirSync, rmSync, unlinkSync, writeFileSync, } from 'node:fs';
import { dirname, isAbsolute, join, posix, relative, sep } from 'node:path';
import { resolveCanonicalMergeTarget, validateAndStripNonMarkdownDelta, } from './baseline-closure.js';
export const BASELINE_CLOSURE_APPLY_JOURNAL = 'BASELINE_CLOSURE_APPLY_JOURNAL.json';
const APPLY_TXN_DIR = '.baseline-closure-apply-txn';
function hashBytes(bytes) {
    return createHash('sha256').update(bytes).digest('hex');
}
function hashFile(path) {
    return hashBytes(readFileSync(path));
}
function contained(candidate, base) {
    return candidate === base || candidate.startsWith(base.endsWith(sep) ? base : `${base}${sep}`);
}
function canonicalRootTarget(root, raw) {
    if (!raw || isAbsolute(raw) || raw.includes('\0') || raw.includes('\n') || raw.includes('\r'))
        return null;
    const slash = raw.replace(/\\/g, '/');
    if (slash.split('/').includes('..'))
        return null;
    const normalized = posix.normalize(slash).replace(/^\.\//, '');
    if (!normalized || normalized === '.' || normalized.startsWith('../'))
        return null;
    const abs = join(root, ...normalized.split('/'));
    let rootReal;
    try {
        rootReal = realpathSync(root);
    }
    catch {
        return null;
    }
    // 已存在的任一祖先若为 symlink，拒绝由事务写侧跟随；同时验证真实 containment。
    let cursor = existsSync(abs) ? abs : dirname(abs);
    while (!existsSync(cursor) && cursor !== dirname(cursor))
        cursor = dirname(cursor);
    try {
        let component = abs;
        while (contained(component, root) && component !== root) {
            if (existsSync(component) && lstatSync(component).isSymbolicLink())
                return null;
            component = dirname(component);
        }
        if (!contained(realpathSync(cursor), rootReal))
            return null;
    }
    catch {
        return null;
    }
    return { path: normalized, abs };
}
function proposalIsContained(root, proposalDir) {
    const rel = relative(root, proposalDir);
    if (!rel || rel.startsWith('..') || isAbsolute(rel))
        return false;
    try {
        return contained(realpathSync(proposalDir), realpathSync(root));
    }
    catch {
        return false;
    }
}
function fsyncFile(path) {
    const fd = openSync(path, 'r');
    try {
        fsyncSync(fd);
    }
    finally {
        closeSync(fd);
    }
}
function writeDurable(path, bytes) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytes);
    fsyncFile(path);
}
function journalPath(proposalDir) {
    return join(proposalDir, BASELINE_CLOSURE_APPLY_JOURNAL);
}
function txnDir(proposalDir) {
    return join(proposalDir, APPLY_TXN_DIR);
}
function writeJournal(proposalDir, journal) {
    const path = journalPath(proposalDir);
    const temp = `${path}.tmp`;
    writeDurable(temp, Buffer.from(`${JSON.stringify(journal, null, 2)}\n`));
    renameSync(temp, path);
    fsyncFile(path);
}
function parseJournal(proposalDir) {
    const path = journalPath(proposalDir);
    if (!existsSync(path))
        return null;
    let raw;
    try {
        raw = JSON.parse(readFileSync(path, 'utf-8'));
    }
    catch {
        return null;
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        return null;
    const j = raw;
    if (j.schema !== 'openlogos/baseline-closure-apply@1'
        || !['prepared', 'committing', 'committed', 'rolling_back'].includes(String(j.phase))
        || !Array.isArray(j.entries) || !Array.isArray(j.created_dirs))
        return null;
    return j;
}
function removePrivateArtifacts(proposalDir) {
    const jp = journalPath(proposalDir);
    if (existsSync(jp))
        unlinkSync(jp);
    const td = txnDir(proposalDir);
    if (existsSync(td))
        rmSync(td, { recursive: true, force: true });
    const temp = `${jp}.tmp`;
    if (existsSync(temp))
        unlinkSync(temp);
}
function existingHash(path) {
    if (!existsSync(path))
        return null;
    const st = lstatSync(path);
    if (!st.isFile() || st.isSymbolicLink())
        throw new Error(`目标不是普通文件：${path}`);
    return hashFile(path);
}
function missingParentDirs(root, targetAbs) {
    const dirs = [];
    let cursor = dirname(targetAbs);
    while (cursor !== root && contained(cursor, root) && !existsSync(cursor)) {
        dirs.push(relative(root, cursor).replace(/\\/g, '/'));
        cursor = dirname(cursor);
    }
    return dirs.reverse();
}
function prepareInputs(root, proposalDir, inputs) {
    const writes = [];
    const seen = new Set();
    for (const input of inputs) {
        let targetPath;
        let targetAbs;
        let payload;
        if (input.kind === 'non-markdown') {
            const resolved = resolveCanonicalMergeTarget(root, proposalDir, input.deltaPath);
            if (!resolved || !['api', 'database'].includes(resolved.semanticCategory ?? '')) {
                return { error: `non-Markdown delta 路径无法映射为 API/DB canonical target：${input.deltaPath}` };
            }
            targetPath = resolved.targetPath;
            targetAbs = join(root, ...targetPath.split('/'));
            const raw = Buffer.isBuffer(input.deltaBytes) ? input.deltaBytes : Buffer.from(input.deltaBytes);
            const newline = raw.indexOf(0x0a);
            if (newline < 0)
                return { error: `${input.deltaPath} 缺首行行结束符` };
            const decoded = raw.toString('utf-8');
            if (!Buffer.from(decoded, 'utf-8').equals(raw))
                return { error: `${input.deltaPath} 不是合法 UTF-8` };
            const checked = validateAndStripNonMarkdownDelta(decoded, input.mode, targetPath, { root });
            if (!checked.ok || checked.payload === undefined)
                return { error: `${input.deltaPath}：${checked.message}` };
            // validator 只删除首行及唯一换行；直接切原 Buffer，保证 payload 字节零格式化。
            payload = raw.subarray(newline + 1);
            if (checked.payload !== payload.toString('utf-8'))
                return { error: `${input.deltaPath} payload 剥离结果不确定` };
        }
        else {
            const resolved = canonicalRootTarget(root, input.targetPath);
            if (!resolved)
                return { error: `prepared target 非法或越界：${input.targetPath}` };
            targetPath = resolved.path;
            targetAbs = resolved.abs;
            payload = Buffer.isBuffer(input.bytes) ? Buffer.from(input.bytes) : Buffer.from(input.bytes);
            if (payload.length === 0)
                return { error: `prepared target payload 为空：${targetPath}` };
        }
        const key = process.platform === 'win32' ? targetPath.toLocaleLowerCase('en-US') : targetPath;
        if (seen.has(key))
            return { error: `canonical target 重复：${targetPath}` };
        seen.add(key);
        let oldSha256;
        try {
            oldSha256 = existingHash(targetAbs);
        }
        catch (e) {
            return { error: String(e) };
        }
        if (input.mode === 'CREATE' && oldSha256 !== null)
            return { error: `CREATE 目标已存在：${targetPath}` };
        if (input.mode === 'MODIFY' && oldSha256 === null)
            return { error: `MODIFY 目标不存在：${targetPath}` };
        writes.push({
            targetPath, targetAbs, mode: input.mode, payload,
            newSha256: hashBytes(payload), oldSha256, kind: input.kind,
        });
    }
    // 提交边界 marker 永远最后写；同批其余顺序保持稳定。
    writes.sort((a, b) => Number(a.targetPath.endsWith('/SPEC_MERGED')) - Number(b.targetPath.endsWith('/SPEC_MERGED')));
    return { writes };
}
function validateJournalPaths(root, proposalDir, journal) {
    const td = txnDir(proposalDir);
    const seen = new Set();
    for (const e of journal.entries) {
        const target = canonicalRootTarget(root, e.target_path);
        if (!target || seen.has(target.path))
            return `journal target 非法/重复：${e.target_path}`;
        seen.add(target.path);
        if (!/^[0-9a-f]{64}$/.test(e.new_sha256)
            || (e.old_sha256 !== null && !/^[0-9a-f]{64}$/.test(e.old_sha256)))
            return `journal hash 非法：${e.target_path}`;
        for (const privatePath of [e.staged_path, ...(e.backup_path ? [e.backup_path] : [])]) {
            const abs = join(proposalDir, ...privatePath.split('/'));
            if (!contained(abs, td))
                return `journal 私有路径越界：${privatePath}`;
        }
    }
    for (const dir of journal.created_dirs)
        if (!canonicalRootTarget(root, dir))
            return `journal created_dir 越界：${dir}`;
    return null;
}
function restoreBackup(targetAbs, backupAbs) {
    const temp = `${targetAbs}.baseline-rollback-${process.pid}`;
    copyFileSync(backupAbs, temp);
    fsyncFile(temp);
    renameSync(temp, targetAbs);
    fsyncFile(targetAbs);
}
/**
 * 恢复上次崩溃事务。prepared/committing 一律回滚全旧；committed 只验证全新后清理私有材料。
 */
export function recoverBaselineClosureApply(root, proposalDir) {
    if (!proposalIsContained(root, proposalDir))
        return { ok: false, error: 'proposalDir 越界或不可解析' };
    const jp = journalPath(proposalDir);
    if (!existsSync(jp)) {
        // 无 journal 的私有 staging 不含权威写入，可确定性清理。
        const td = txnDir(proposalDir);
        if (existsSync(td))
            rmSync(td, { recursive: true, force: true });
        return { ok: true, recovered: 'none' };
    }
    const journal = parseJournal(proposalDir);
    if (!journal)
        return { ok: false, error: 'baseline closure apply journal 损坏或 schema 非法' };
    const pathProblem = validateJournalPaths(root, proposalDir, journal);
    if (pathProblem)
        return { ok: false, error: pathProblem };
    const states = [];
    for (const e of journal.entries) {
        const targetAbs = join(root, ...e.target_path.split('/'));
        let current;
        try {
            current = existingHash(targetAbs);
        }
        catch (error) {
            return { ok: false, error: String(error) };
        }
        if (current === e.new_sha256)
            states.push('new');
        else if (current === e.old_sha256 && e.old_sha256 !== null)
            states.push('old');
        else if (current === null && e.old_sha256 === null)
            states.push('absent');
        else
            return { ok: false, error: `目标处于 journal 之外的未知字节态：${e.target_path}` };
    }
    if (journal.phase === 'committed') {
        if (states.some(s => s !== 'new'))
            return { ok: false, error: 'committed journal 的目标未全部处于新字节态' };
        removePrivateArtifacts(proposalDir);
        return { ok: true, recovered: 'committed' };
    }
    // 先验证所有所需 backup，再开始任何恢复写，避免把不可恢复事务进一步改坏。
    for (let i = 0; i < journal.entries.length; i++) {
        const e = journal.entries[i];
        if (states[i] !== 'new' || e.old_sha256 === null)
            continue;
        if (!e.backup_path)
            return { ok: false, error: `缺 backup：${e.target_path}` };
        const backupAbs = join(proposalDir, ...e.backup_path.split('/'));
        if (!existsSync(backupAbs) || hashFile(backupAbs) !== e.old_sha256) {
            return { ok: false, error: `backup 缺失或哈希不符：${e.target_path}` };
        }
    }
    journal.phase = 'rolling_back';
    try {
        writeJournal(proposalDir, journal);
    }
    catch (e) {
        return { ok: false, error: `无法持久化 rollback intent：${String(e)}` };
    }
    try {
        for (let i = journal.entries.length - 1; i >= 0; i--) {
            const e = journal.entries[i];
            if (states[i] !== 'new')
                continue;
            const targetAbs = join(root, ...e.target_path.split('/'));
            if (e.old_sha256 === null) {
                if (existsSync(targetAbs))
                    unlinkSync(targetAbs);
            }
            else {
                restoreBackup(targetAbs, join(proposalDir, ...e.backup_path.split('/')));
            }
            e.applied = false;
            writeJournal(proposalDir, journal);
        }
        for (const rel of [...journal.created_dirs].reverse()) {
            const abs = join(root, ...rel.split('/'));
            if (existsSync(abs)) {
                try {
                    rmdirSync(abs);
                }
                catch { /* 非空/并发创建则保留安全目录 */ }
            }
        }
        removePrivateArtifacts(proposalDir);
        return { ok: true, recovered: 'rolled_back' };
    }
    catch (e) {
        return { ok: false, error: `整批回滚未完成：${String(e)}` };
    }
}
/**
 * 应用一个 baseline-on-touch 批次。所有输入先完成预检；成功才写，失败返回前尝试恢复全旧。
 */
export function applyBaselineClosureBatch(root, proposalDir, inputs, hook = {}) {
    if (inputs.length === 0)
        return { ok: false, error: 'apply 批次为空', rolled_back: true };
    const recovered = recoverBaselineClosureApply(root, proposalDir);
    if (!recovered.ok)
        return { ok: false, error: recovered.error, rolled_back: false };
    const prepared = prepareInputs(root, proposalDir, inputs);
    if (!prepared.writes)
        return { ok: false, error: prepared.error ?? 'apply preflight 失败', rolled_back: true };
    const td = txnDir(proposalDir);
    const createdDirs = [...new Set(prepared.writes.flatMap(w => missingParentDirs(root, w.targetAbs)))];
    const entries = [];
    try {
        mkdirSync(join(td, 'staging'), { recursive: true });
        mkdirSync(join(td, 'backup'), { recursive: true });
        for (let i = 0; i < prepared.writes.length; i++) {
            const w = prepared.writes[i];
            const stagedRel = `${APPLY_TXN_DIR}/staging/${i}.new`;
            const backupRel = w.oldSha256 === null ? null : `${APPLY_TXN_DIR}/backup/${i}.old`;
            writeDurable(join(proposalDir, ...stagedRel.split('/')), w.payload);
            if (backupRel) {
                const backupAbs = join(proposalDir, ...backupRel.split('/'));
                copyFileSync(w.targetAbs, backupAbs);
                fsyncFile(backupAbs);
                if (hashFile(backupAbs) !== w.oldSha256)
                    throw new Error(`backup 哈希漂移：${w.targetPath}`);
            }
            entries.push({
                target_path: w.targetPath, mode: w.mode, kind: w.kind,
                old_sha256: w.oldSha256, new_sha256: w.newSha256,
                staged_path: stagedRel, backup_path: backupRel, applied: false,
            });
        }
    }
    catch (e) {
        if (existsSync(td))
            rmSync(td, { recursive: true, force: true });
        return { ok: false, error: `无法准备私有 staging/backup：${String(e)}`, rolled_back: true };
    }
    const journal = {
        schema: 'openlogos/baseline-closure-apply@1', phase: 'prepared', entries, created_dirs: createdDirs,
    };
    try {
        writeJournal(proposalDir, journal);
        journal.phase = 'committing';
        writeJournal(proposalDir, journal);
        for (const rel of createdDirs)
            mkdirSync(join(root, ...rel.split('/')));
        for (let i = 0; i < prepared.writes.length; i++) {
            const w = prepared.writes[i];
            // preflight 与 rename 之间再次按 old hash/不存在事实对账，拒绝 TOCTOU 覆盖。
            const current = existingHash(w.targetAbs);
            if (current !== w.oldSha256)
                throw new Error(`${w.mode} 目标在提交前发生漂移：${w.targetPath}`);
            const stagedAbs = join(proposalDir, ...journal.entries[i].staged_path.split('/'));
            renameSync(stagedAbs, w.targetAbs);
            fsyncFile(w.targetAbs);
            if (hashFile(w.targetAbs) !== w.newSha256)
                throw new Error(`目标后置哈希不一致：${w.targetPath}`);
            if (w.kind === 'non-markdown' && /^## (?:ADDED|MODIFIED) — /m.test(readFileSync(w.targetAbs, 'utf-8'))) {
                throw new Error(`控制 marker 泄漏：${w.targetPath}`);
            }
            journal.entries[i].applied = true;
            writeJournal(proposalDir, journal);
            hook.afterWrite?.(w.targetPath, i);
        }
        hook.validateCommitted?.();
        journal.phase = 'committed';
        writeJournal(proposalDir, journal);
        const applied = prepared.writes.map(w => ({ target_path: w.targetPath, mode: w.mode, sha256: w.newSha256 }));
        removePrivateArtifacts(proposalDir);
        return { ok: true, applied };
    }
    catch (e) {
        const rollback = recoverBaselineClosureApply(root, proposalDir);
        return {
            ok: false,
            error: `${String(e)}${rollback.ok ? '' : `；回滚失败：${rollback.error}`}`,
            rolled_back: rollback.ok && rollback.recovered === 'rolled_back',
        };
    }
}
//# sourceMappingURL=baseline-apply.js.map