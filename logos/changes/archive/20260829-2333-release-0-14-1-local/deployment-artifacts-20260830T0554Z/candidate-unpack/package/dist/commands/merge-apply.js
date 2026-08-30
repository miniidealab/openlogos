/**
 * S39 baseline-on-touch 的受控生产 apply 入口。
 *
 * merge-executor 只负责把 Markdown/metadata 的最终字节预计算进严格 manifest；本命令重新执行
 * L9、核对 P==T==D、source/before/final 哈希及元数据登记后，唯一一次调用整批原子事务。
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, unlinkSync, } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep, } from 'node:path';
import { parseDocument } from 'yaml';
import { authorityScan } from '../lib/markdown-scan.js';
import { parseBaselineClosurePlan, } from '../lib/baseline-closure.js';
import { applyBaselineClosureBatch, } from '../lib/baseline-apply.js';
import { runChangeLint, SLUG_STRICT_RE } from '../lib/change-lint.js';
import { buildTestChangeSet, readTestChangeSet, } from '../lib/test-change-set.js';
const MANIFEST_SCHEMA = 'openlogos/baseline-merge-apply@1';
const GENERATED_PROMPT_MARKER = 'MERGE_PROMPT_GENERATED';
const TOP_KEYS = new Set(['schema', 'slug', 'prepared_targets', 'metadata_targets']);
const TARGET_KEYS = new Set([
    'delta_path', 'target_path', 'mode', 'source_sha256', 'before_sha256', 'content_base64', 'sha256',
]);
const METADATA_KEYS = new Set(['target_path', 'mode', 'before_sha256', 'content_base64', 'sha256']);
const HASH_RE = /^[0-9a-f]{64}$/;
function asRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value : null;
}
function exactKeys(value, expected) {
    const keys = Object.keys(value);
    return keys.length === expected.size && keys.every(key => expected.has(key));
}
function sha(bytes) {
    return createHash('sha256').update(bytes).digest('hex');
}
function canonicalBase64(value) {
    if (typeof value !== 'string' || value.length === 0 || value.length > 30_000_000
        || value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))
        return null;
    const decoded = Buffer.from(value, 'base64');
    return decoded.toString('base64') === value ? decoded : null;
}
function contained(candidate, base) {
    return candidate === base || candidate.startsWith(`${base}${sep}`);
}
function cleanupGeneratedPrompt(proposalDir) {
    const marker = join(proposalDir, GENERATED_PROMPT_MARKER);
    if (!existsSync(marker))
        return;
    for (const path of [join(proposalDir, 'MERGE_PROMPT.md'), marker]) {
        if (existsSync(path))
            unlinkSync(path);
    }
}
function fail(proposalDir, message) {
    if (proposalDir)
        cleanupGeneratedPrompt(proposalDir);
    console.error(`Error: baseline closure apply 失败：${message}`);
    console.error('  已拒绝/清除可执行 MERGE_PROMPT；未留下 SPEC_MERGED、counter、index 或半新 resources。');
    process.exit(1);
    throw new Error('unreachable');
}
function readStrictJson(path) {
    const source = readFileSync(path, 'utf-8');
    // JSON.parse 会接受重复 key；先由 YAML 1.2 duplicate-aware parser 拦截，再执行 JSON 严格语法。
    const doc = parseDocument(source, { uniqueKeys: true, strict: true, prettyErrors: false });
    if (doc.errors.length > 0)
        throw new Error(`manifest 重复 key/结构解析失败：${doc.errors.map(e => e.message).join('；')}`);
    return JSON.parse(source);
}
function parseManifest(raw) {
    const top = asRecord(raw);
    if (!top || !exactKeys(top, TOP_KEYS) || top.schema !== MANIFEST_SCHEMA || typeof top.slug !== 'string'
        || !Array.isArray(top.prepared_targets) || !Array.isArray(top.metadata_targets)) {
        throw new Error(`manifest 必须严格符合 ${MANIFEST_SCHEMA}`);
    }
    const prepared = top.prepared_targets.map((item, index) => {
        const value = asRecord(item);
        if (!value || !exactKeys(value, TARGET_KEYS)
            || typeof value.delta_path !== 'string' || typeof value.target_path !== 'string'
            || !['CREATE', 'MODIFY'].includes(String(value.mode))
            || typeof value.source_sha256 !== 'string' || !HASH_RE.test(value.source_sha256)
            || !(value.before_sha256 === null || (typeof value.before_sha256 === 'string' && HASH_RE.test(value.before_sha256)))
            || typeof value.content_base64 !== 'string' || typeof value.sha256 !== 'string' || !HASH_RE.test(value.sha256)) {
            throw new Error(`prepared_targets[${index}] 字段或类型不合法`);
        }
        return value;
    });
    const metadata = top.metadata_targets.map((item, index) => {
        const value = asRecord(item);
        if (!value || !exactKeys(value, METADATA_KEYS)
            || value.target_path !== 'logos/logos-project.yaml' || value.mode !== 'MODIFY'
            || typeof value.before_sha256 !== 'string' || !HASH_RE.test(value.before_sha256)
            || typeof value.content_base64 !== 'string' || typeof value.sha256 !== 'string' || !HASH_RE.test(value.sha256)) {
            throw new Error(`metadata_targets[${index}] 字段、类型或白名单目标不合法`);
        }
        return value;
    });
    return {
        schema: MANIFEST_SCHEMA,
        slug: top.slug,
        prepared_targets: prepared,
        metadata_targets: metadata,
    };
}
function currentHash(path) {
    return existsSync(path) ? sha(readFileSync(path)) : null;
}
function markdownControlMarker(content) {
    const lines = content.split(/\r?\n/);
    const scan = authorityScan(lines);
    for (let i = 0; i < lines.length; i++) {
        if (!scan.masked[i] && /^##\s+(?:REMOVED-ITEMS|ADDED|MODIFIED|REMOVED)\b/.test(scan.text[i].trim())) {
            return scan.text[i].trim();
        }
    }
    return null;
}
function isNonMarkdownTarget(target) {
    const path = target.targetPath ?? '';
    return (target.category === 'api' && /\.(?:ya?ml|json)$/i.test(path))
        || (target.category === 'database' && /\.sql$/i.test(path));
}
function validateMetadata(bytes, plan) {
    const text = bytes.toString('utf-8');
    if (!Buffer.from(text, 'utf-8').equals(bytes))
        return 'logos-project.yaml 最终字节不是合法 UTF-8';
    const doc = parseDocument(text, { uniqueKeys: true, strict: true, prettyErrors: false });
    if (doc.errors.length > 0)
        return `logos-project.yaml 严格解析失败：${doc.errors.map(e => e.message).join('；')}`;
    let raw;
    try {
        raw = doc.toJS({ maxAliasCount: 100 });
    }
    catch (e) {
        return `logos-project.yaml 转换失败：${String(e)}`;
    }
    const root = asRecord(raw);
    if (!root)
        return 'logos-project.yaml 根必须是对象';
    const created = plan.targets.filter(target => target.mode === 'CREATE' && target.targetPath !== null);
    const resourceIndex = Array.isArray(root.resource_index) ? root.resource_index : [];
    const indexed = new Set(resourceIndex.map(item => asRecord(item)?.path).filter((path) => typeof path === 'string'));
    const missingIndex = created.map(target => target.targetPath).filter(path => !indexed.has(path));
    if (missingIndex.length > 0)
        return `resource_index 未登记 CREATE 目标：${missingIndex.join('、')}`;
    const scenarioCreates = created.filter(target => target.category === 'scenario');
    if (scenarioCreates.length > 0) {
        const scenarios = Array.isArray(root.scenarios) ? root.scenarios : [];
        const ids = new Set(scenarios.map(item => asRecord(item)?.id).filter((id) => typeof id === 'string'));
        const required = [...new Set(scenarioCreates.flatMap(target => target.scenarioIds))];
        const missing = required.filter(id => !ids.has(id));
        if (missing.length > 0)
            return `scenarios[] 未登记 CREATE 场景：${missing.join('、')}`;
        const max = Math.max(0, ...[...ids].filter(id => /^S[0-9]+$/.test(id)).map(id => Number(id.slice(1))));
        const counter = asRecord(root.scenario_counter)?.next_id;
        if (!Number.isInteger(counter) || Number(counter) <= max)
            return `scenario_counter.next_id 必须大于最终最大场景号 S${max}`;
    }
    const createdDecisionIds = created.filter(target => target.category === 'decision')
        .flatMap(target => /(?:^|\/)\w+-D([0-9]+)-/.exec(target.targetPath)?.[1] ?? [])
        .map(Number);
    if (createdDecisionIds.length > 0) {
        const max = Math.max(...createdDecisionIds);
        const counter = asRecord(root.decision_counter)?.next_id;
        if (!Number.isInteger(counter) || Number(counter) <= max)
            return `decision_counter.next_id 必须大于本批最大决策号 D${max}`;
    }
    return null;
}
function preparedInput(root, proposalDir, target, entry) {
    if (entry.delta_path !== target.deltaPath || entry.target_path !== target.targetPath || entry.mode !== target.mode) {
        throw new Error(`prepared target 与闭包计划不一致：${entry.target_path}`);
    }
    const deltaBytes = readFileSync(join(proposalDir, ...entry.delta_path.split('/')));
    if (sha(deltaBytes) !== entry.source_sha256)
        throw new Error(`delta source_sha256 漂移：${entry.delta_path}`);
    const before = currentHash(join(root, ...entry.target_path.split('/')));
    if (before !== entry.before_sha256)
        throw new Error(`目标 before_sha256 漂移：${entry.target_path}`);
    if ((entry.mode === 'CREATE' && before !== null) || (entry.mode === 'MODIFY' && before === null)) {
        throw new Error(`${entry.mode} 与目标磁盘事实不一致：${entry.target_path}`);
    }
    const finalBytes = canonicalBase64(entry.content_base64);
    if (!finalBytes || sha(finalBytes) !== entry.sha256)
        throw new Error(`最终字节 base64/sha256 不一致：${entry.target_path}`);
    if (entry.target_path.endsWith('.md')) {
        const text = finalBytes.toString('utf-8');
        if (!Buffer.from(text, 'utf-8').equals(finalBytes))
            throw new Error(`Markdown 最终字节不是合法 UTF-8：${entry.target_path}`);
        const marker = markdownControlMarker(text);
        if (marker)
            throw new Error(`Markdown 控制 marker 泄漏到最终目标：${entry.target_path}（${marker}）`);
    }
    return { kind: 'prepared', targetPath: entry.target_path, mode: entry.mode, bytes: finalBytes };
}
export function mergeApply(slug, manifestArg) {
    // 0.14.0 breaking cutover：外部 manifest writer 已删除。仅保留测试进程内的历史回归开关，
    // 不随安装态 CLI 启用，也不能由公开命令降级打开。
    if (!(process.env.NODE_ENV === 'test' && process.env.OPENLOGOS_INTERNAL_LEGACY_MERGE_APPLY === '1')) {
        console.error('Error: legacy_manifest_rejected：0.14.0 不再接受 MERGE_APPLY_MANIFEST.json。');
        console.error('  请使用 `openlogos merge <slug>` 与 `openlogos merge transaction status|seal|apply|recover`。');
        process.exit(1);
    }
    const root = process.cwd();
    if (!existsSync(join(root, 'logos', 'logos.config.json')))
        fail(null, 'logos/logos.config.json 不存在');
    if (!slug || !SLUG_STRICT_RE.test(slug))
        fail(null, '缺少或非法的提案 slug');
    const proposalDir = join(root, 'logos', 'changes', slug);
    if (!existsSync(proposalDir))
        fail(null, `提案不存在：${slug}`);
    if (!manifestArg)
        fail(proposalDir, '缺少 --manifest <path>');
    const guardPath = join(root, 'logos', '.openlogos-guard');
    let active = '';
    let activeModule = 'core';
    try {
        const guard = JSON.parse(readFileSync(guardPath, 'utf-8'));
        active = guard.activeChange ?? '';
        if (typeof guard.module === 'string' && guard.module.trim())
            activeModule = guard.module.trim();
    }
    catch { /* 统一在下一行拒绝 */ }
    if (active !== slug)
        fail(proposalDir, `active guard=${active || '<missing>'} 与 ${slug} 不一致`);
    if (!existsSync(join(proposalDir, 'MERGE_PROMPT.md')) || !existsSync(join(proposalDir, GENERATED_PROMPT_MARKER))) {
        fail(proposalDir, '必须先由 openlogos merge 生成受控 MERGE_PROMPT');
    }
    if (existsSync(join(proposalDir, 'SPEC_MERGED')))
        fail(proposalDir, 'SPEC_MERGED 已存在，拒绝重复 apply');
    const manifestPath = isAbsolute(manifestArg) ? resolve(manifestArg) : resolve(root, manifestArg);
    try {
        if (!contained(realpathSync(manifestPath), realpathSync(proposalDir)))
            fail(proposalDir, 'manifest 必须位于当前提案目录内');
    }
    catch {
        fail(proposalDir, 'manifest 不存在或无法安全解析');
    }
    const lint = runChangeLint(root, proposalDir, slug);
    if (!lint.ok)
        fail(proposalDir, `change-lint 无法完成（${lint.errorCode}）：${lint.message}`);
    if (lint.violations.length > 0 || lint.baseline_closure?.stage !== 'spec') {
        const details = lint.violations.slice(0, 5).map(v => `[${v.code}] ${v.path}: ${v.message}`).join('；');
        fail(proposalDir, `L1-L9 未全过或闭包未进入 spec（violations=${lint.violations.length}${details ? `；${details}` : ''}）`);
    }
    const proposalContent = readFileSync(join(proposalDir, 'proposal.md'), 'utf-8');
    const parsed = parseBaselineClosurePlan(root, proposalDir, proposalContent, `logos/changes/${slug}/proposal.md`);
    if (!parsed.plan || parsed.violations.length > 0)
        fail(proposalDir, 'on-touch-v1 计划无法严格解析');
    const plan = parsed.plan;
    let manifest;
    try {
        manifest = parseManifest(readStrictJson(manifestPath));
    }
    catch (e) {
        fail(proposalDir, String(e));
    }
    if (manifest.slug !== slug)
        fail(proposalDir, `manifest slug=${manifest.slug} 与 ${slug} 不一致`);
    const preparedByTarget = new Map();
    for (const entry of manifest.prepared_targets) {
        if (preparedByTarget.has(entry.target_path))
            fail(proposalDir, `manifest target 重复：${entry.target_path}`);
        preparedByTarget.set(entry.target_path, entry);
    }
    const inputs = [];
    const testTargets = [];
    try {
        for (const target of plan.targets.filter(item => item.targetPath !== null)) {
            if (isNonMarkdownTarget(target)) {
                if (preparedByTarget.has(target.targetPath))
                    throw new Error(`API/DB 目标不得由 prepared bytes 绕过 validator：${target.targetPath}`);
                inputs.push({
                    kind: 'non-markdown', deltaPath: target.deltaPath, mode: target.mode,
                    deltaBytes: readFileSync(join(proposalDir, ...target.deltaPath.split('/'))),
                });
            }
            else {
                const entry = preparedByTarget.get(target.targetPath);
                if (!entry)
                    throw new Error(`manifest 缺计划目标：${target.targetPath}`);
                const input = preparedInput(root, proposalDir, target, entry);
                inputs.push(input);
                if (target.category === 'test' && input.kind === 'prepared') {
                    testTargets.push({
                        targetPath: entry.target_path,
                        beforeBytes: entry.before_sha256 === null ? null : readFileSync(join(root, ...entry.target_path.split('/'))),
                        afterBytes: Buffer.isBuffer(input.bytes) ? Buffer.from(input.bytes) : Buffer.from(input.bytes),
                    });
                }
                preparedByTarget.delete(target.targetPath);
            }
        }
        if (preparedByTarget.size > 0)
            throw new Error(`manifest 含未规划目标：${[...preparedByTarget.keys()].join('、')}`);
        const created = plan.targets.some(target => target.mode === 'CREATE' && target.targetPath !== null);
        if (manifest.metadata_targets.length !== (created ? 1 : 0)) {
            throw new Error(created ? '含 CREATE 的批次必须且只能提供一份 logos-project.yaml 元数据最终态' : '无 CREATE 的批次禁止无依据改写元数据');
        }
        if (created) {
            const metadata = manifest.metadata_targets[0];
            const current = readFileSync(join(root, metadata.target_path));
            if (sha(current) !== metadata.before_sha256)
                throw new Error('logos-project.yaml before_sha256 漂移');
            const bytes = canonicalBase64(metadata.content_base64);
            if (!bytes || sha(bytes) !== metadata.sha256)
                throw new Error('logos-project.yaml base64/sha256 不一致');
            const metadataProblem = validateMetadata(bytes, plan);
            if (metadataProblem)
                throw new Error(metadataProblem);
            inputs.push({ kind: 'prepared', targetPath: metadata.target_path, mode: 'MODIFY', bytes });
        }
    }
    catch (e) {
        fail(proposalDir, String(e));
    }
    let testChangeSet;
    try {
        testChangeSet = buildTestChangeSet({ change: slug, module: activeModule, targets: testTargets });
    }
    catch (error) {
        fail(proposalDir, String(error));
    }
    const marker = Buffer.from(`${JSON.stringify({
        type: 'baseline_closure_spec_complete', policy: 'on-touch-v1', slug,
        manifest_sha256: sha(readFileSync(manifestPath)), completed_at: new Date().toISOString(),
        test_change_set: testChangeSet,
    }, null, 2)}\n`);
    inputs.push({
        kind: 'prepared', targetPath: relative(root, join(proposalDir, 'SPEC_MERGED')).replace(/\\/g, '/'),
        mode: 'CREATE', bytes: marker,
    });
    const faultTarget = process.env.NODE_ENV === 'test' ? process.env.OPENLOGOS_TEST_MERGE_APPLY_FAIL_AFTER : undefined;
    const result = applyBaselineClosureBatch(root, proposalDir, inputs, {
        afterWrite(targetPath) {
            if (faultTarget && targetPath === faultTarget)
                throw new Error(`test fault after ${targetPath}`);
        },
        validateCommitted() {
            if (faultTarget === 'post-read')
                throw new Error('test fault at post-read');
            const check = readTestChangeSet(root, proposalDir, {
                change: slug,
                module: activeModule,
                targetPaths: testTargets.map(target => target.targetPath),
            });
            if (!check.valid)
                throw new Error(`${check.code}：${check.message}`);
        },
    });
    if (!result.ok)
        fail(proposalDir, `${result.error}（rolled_back=${result.rolled_back}）`);
    console.log(`✓ baseline closure 原子 apply 完成：${result.applied.length} 个目标（含元数据/marker）`);
}
//# sourceMappingURL=merge-apply.js.map