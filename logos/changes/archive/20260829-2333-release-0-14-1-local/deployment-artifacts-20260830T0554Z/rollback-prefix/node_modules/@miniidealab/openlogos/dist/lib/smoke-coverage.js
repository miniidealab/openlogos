import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
const SMOKE_ID_PATTERN = /\bSMOKE-[A-Za-z0-9-]+-\d{1,3}\b/g;
const RUNNER_NAME_PATTERN = /^smoke-.+\.(?:sh|js|mjs|cjs|ts)$/;
const IGNORED_DIRS = new Set(['.git', 'node_modules', 'dist', 'logos']);
/**
 * 统一 smoke dispatcher 是项目级约定入口；显式配置优先，未配置但入口文件在场时
 * 使用确定性默认值。这样本地 config 未纳入版本控制时，verify/smoke 仍能识别已交付 runner。
 */
export function resolveSmokeCommand(root, configured) {
    if (typeof configured === 'string' && configured.trim())
        return configured.trim();
    return existsSync(join(root, 'scripts', 'run-smoke.js')) ? 'node scripts/run-smoke.js' : null;
}
function uniqueSorted(values) {
    return Array.from(new Set(values)).sort();
}
export function extractSmokeIdsFromContent(content) {
    const tableIds = [];
    for (const line of content.split('\n')) {
        if (!line.trim().startsWith('|'))
            continue;
        const firstCell = line.split('|')[1]?.trim().replace(/^`|`$/g, '') ?? '';
        if (/^SMOKE-[A-Za-z0-9-]+-\d{1,3}$/.test(firstCell))
            tableIds.push(firstCell);
    }
    if (tableIds.length > 0)
        return uniqueSorted(tableIds);
    return uniqueSorted([...content.matchAll(SMOKE_ID_PATTERN)].map(match => match[0]));
}
function readActiveChangeSlug(root) {
    const guardPath = join(root, 'logos', '.openlogos-guard');
    if (!existsSync(guardPath))
        return null;
    try {
        const guard = JSON.parse(readFileSync(guardPath, 'utf-8'));
        return typeof guard.activeChange === 'string' && guard.activeChange.trim()
            ? guard.activeChange.trim()
            : null;
    }
    catch {
        return null;
    }
}
function walkFiles(dir) {
    if (!existsSync(dir))
        return [];
    const out = [];
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        let stat;
        try {
            stat = statSync(full);
        }
        catch {
            continue;
        }
        if (stat.isDirectory()) {
            if (!IGNORED_DIRS.has(entry))
                out.push(...walkFiles(full));
            continue;
        }
        if (stat.isFile())
            out.push(full);
    }
    return out;
}
export function extractChangedSmokeIds(root, slug) {
    const activeSlug = slug ?? readActiveChangeSlug(root);
    if (!activeSlug)
        return [];
    const proposalDir = join(root, 'logos', 'changes', activeSlug);
    const deltaDirs = [
        join(proposalDir, 'deltas', 'test', 'smoke'),
    ];
    const ids = [];
    for (const dir of deltaDirs) {
        for (const file of walkFiles(dir).filter(f => f.endsWith('.md'))) {
            try {
                ids.push(...extractSmokeIdsFromContent(readFileSync(file, 'utf-8')));
            }
            catch {
                // 忽略不可读 delta，后续 smoke/verify 会通过缺覆盖暴露问题。
            }
        }
    }
    return uniqueSorted(ids);
}
export function discoverSmokeRunners(root) {
    const runners = [];
    for (const file of walkFiles(root)) {
        const rel = relative(root, file).replace(/\\/g, '/');
        const parts = rel.split('/');
        if (!parts.includes('scripts'))
            continue;
        if (!RUNNER_NAME_PATTERN.test(basename(file)))
            continue;
        runners.push(rel);
    }
    return uniqueSorted(runners);
}
function commandUsesDispatcher(command) {
    if (!command)
        return false;
    return /(?:^|\s)(?:node\s+)?scripts\/run-smoke\.js(?:\s|$)/.test(command)
        || /(?:^|\s)(?:node\s+)?\.\/scripts\/run-smoke\.js(?:\s|$)/.test(command);
}
function commandReferencesRunner(command, runners) {
    if (!command)
        return false;
    const normalized = command.replace(/\\/g, '/');
    if (commandUsesDispatcher(command))
        return true;
    return runners.some(runner => {
        const base = basename(runner);
        return normalized.includes(runner) || normalized.includes(`scripts/${base}`) || normalized.includes(base);
    });
}
function readResultIds(root, resultPath) {
    const full = join(root, resultPath);
    if (!existsSync(full))
        return [];
    const ids = [];
    for (const line of readFileSync(full, 'utf-8').split('\n')) {
        const trimmed = line.trim();
        if (!trimmed)
            continue;
        try {
            const obj = JSON.parse(trimmed);
            if (typeof obj.id === 'string' && typeof obj.status === 'string')
                ids.push(obj.id);
        }
        catch {
            // 仅跳过坏行；verify/smoke 的 JSONL 解析保持同样容错语义。
        }
    }
    return uniqueSorted(ids);
}
export function checkSmokeCoverage(root, options = {}) {
    const resultPath = options.resultPath ?? 'logos/resources/verify/smoke-results.jsonl';
    const command = options.command ?? null;
    const changedCaseIds = extractChangedSmokeIds(root, options.slug);
    const executedCaseIds = readResultIds(root, resultPath);
    const executedSet = new Set(executedCaseIds);
    const uncoveredCaseIds = changedCaseIds.filter(id => !executedSet.has(id));
    const runners = discoverSmokeRunners(root);
    const diagnostics = [];
    if (changedCaseIds.length > 0) {
        const commandReachable = commandReferencesRunner(command, runners);
        if (!commandReachable) {
            diagnostics.push({
                code: 'smoke_runner_missing',
                message: command
                    ? '当前 smoke.command 未能被静态确认会执行本提案新增 smoke runner。'
                    : '当前提案新增了 smoke 用例，但未配置 smoke.command 执行 smoke runner。',
                case_ids: changedCaseIds,
                command,
                runner_paths: runners,
            });
        }
        if (runners.length > 0 && executedCaseIds.length === 0) {
            diagnostics.push({
                code: 'smoke_reporter_missing',
                message: `已发现 smoke runner，但 ${resultPath} 不存在、为空或没有有效 JSONL 记录。`,
                case_ids: changedCaseIds,
                result_path: resultPath,
                runner_paths: runners,
            });
        }
        if (uncoveredCaseIds.length > 0 && executedCaseIds.length > 0) {
            diagnostics.push({
                code: 'smoke_cases_uncovered',
                message: '本提案新增的 smoke 用例没有对应执行结果。',
                case_ids: uncoveredCaseIds,
                result_path: resultPath,
            });
        }
    }
    return {
        result: diagnostics.length === 0 ? 'PASS' : 'FAIL',
        changed_case_ids: changedCaseIds,
        executed_case_ids: executedCaseIds,
        uncovered_case_ids: uncoveredCaseIds,
        diagnostics,
        runners,
        command,
        result_path: resultPath,
    };
}
//# sourceMappingURL=smoke-coverage.js.map