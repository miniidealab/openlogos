import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseDocument } from 'yaml';
import { authorityScan, isTableDelimiterRow, tableRowCells } from './markdown-scan.js';
import { classifyProposalDeltas } from './delta-classify.js';
export const TEST_CHANGE_SET_SCHEMA = 'openlogos/test-change-set@1';
export const TEST_CHANGE_SET_SOURCE = 'semantic-before-after-diff';
const HASH_RE = /^[0-9a-f]{64}$/;
const PREFIXED_HASH_RE = /^sha256:[0-9a-f]{64}$/;
const TEST_ID_RE = /^(?:(?:UT|ST)-S\d{2}-[A-Za-z0-9]+(?:[-.][A-Za-z0-9]+)*|SMOKE-core-\d+)$/;
const TOP_KEYS = ['schema', 'change', 'module', 'source', 'changed_test_ids', 'removed_test_ids', 'targets', 'sha256'];
const TARGET_KEYS = ['target_path', 'before_sha256', 'after_sha256'];
function sha256(bytes) {
    return createHash('sha256').update(bytes).digest('hex');
}
function asciiSort(values) {
    return [...new Set(values)].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
}
function exactOrderedKeys(value, expected) {
    const keys = Object.keys(value);
    return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}
function asRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value : null;
}
function strictUtf8(bytes, targetPath) {
    const text = bytes.toString('utf8');
    if (!Buffer.from(text, 'utf8').equals(bytes))
        throw new Error(`test-change-set-invalid-utf8：${targetPath}`);
    return text.replace(/\r\n?/g, '\n');
}
/** 只移除外围空白；内部空白、转义与 inline-code 内容均属于语义。 */
function canonicalCell(cell) {
    return cell.trim();
}
function scanTestDefinitionCandidates(targetPath, bytes, allowDuplicateIds, allowAmbiguousRows) {
    const text = strictUtf8(bytes, targetPath);
    const lines = text.split('\n');
    const scan = authorityScan(lines);
    const records = new Map();
    for (let index = 0; index + 1 < lines.length; index++) {
        if (scan.masked[index] || scan.masked[index + 1] || !isTableDelimiterRow(scan.text[index + 1]))
            continue;
        const headers = tableRowCells(scan.text[index]).map(canonicalCell);
        const delimiters = tableRowCells(scan.text[index + 1]);
        if (headers.length < 2 || headers.length !== delimiters.length || headers.some(item => item === ''))
            continue;
        if (new Set(headers).size !== headers.length && !allowAmbiguousRows) {
            throw new Error(`test-change-set-ambiguous-table：${targetPath}:${index + 1}`);
        }
        let row = index + 2;
        while (row < lines.length && !scan.masked[row] && scan.text[row].trim() !== '') {
            const cells = tableRowCells(scan.text[row]).map(canonicalCell);
            const candidate = cells[0] ?? '';
            if (TEST_ID_RE.test(candidate)) {
                if (cells.length !== headers.length) {
                    if (allowAmbiguousRows) {
                        row++;
                        continue;
                    }
                    throw new Error(`test-change-set-ambiguous-table：${targetPath}:${row + 1}`);
                }
                const existing = records.get(candidate) ?? [];
                if (!allowDuplicateIds && existing.length > 0)
                    throw new Error(`test-change-set-duplicate-id：${candidate}`);
                existing.push({
                    target_path: targetPath,
                    column_identity: headers,
                    cell_semantics: cells,
                });
                records.set(candidate, existing);
            }
            row++;
        }
        index = row - 1;
    }
    return records;
}
export function scanTestDefinitions(targetPath, bytes) {
    return new Map([...scanTestDefinitionCandidates(targetPath, bytes, false, false)]
        .map(([id, records]) => [id, records[0]]));
}
function collectBefore(targets) {
    const all = new Map();
    for (const target of targets) {
        if (target.beforeBytes === null)
            continue;
        for (const [id, records] of scanTestDefinitionCandidates(target.targetPath, target.beforeBytes, true, true)) {
            all.set(id, [...(all.get(id) ?? []), ...records]);
        }
    }
    return all;
}
function collectAfter(targets) {
    const all = new Map();
    for (const target of targets) {
        for (const [id, record] of scanTestDefinitions(target.targetPath, target.afterBytes)) {
            if (all.has(id))
                throw new Error(`test-change-set-duplicate-id：after:${id}`);
            all.set(id, record);
        }
    }
    return all;
}
function recordBytes(record) {
    return JSON.stringify({
        target_path: record.target_path,
        column_identity: record.column_identity,
        cell_semantics: record.cell_semantics,
    });
}
function hashPayload(value) {
    return `sha256:${sha256(Buffer.from(JSON.stringify(value), 'utf8'))}`;
}
export function buildTestChangeSet(input) {
    const sortedTargets = [...input.targets].sort((a, b) => a.targetPath < b.targetPath ? -1 : a.targetPath > b.targetPath ? 1 : 0);
    const targetPaths = sortedTargets.map(target => target.targetPath);
    if (new Set(targetPaths).size !== targetPaths.length)
        throw new Error('test-change-set-target-duplicate');
    const before = collectBefore(sortedTargets);
    const after = collectAfter(sortedTargets);
    const changed = [];
    const removed = [];
    for (const [id, record] of after) {
        const oldCandidates = before.get(id) ?? [];
        if (!oldCandidates.some(old => recordBytes(old) === recordBytes(record)))
            changed.push(id);
    }
    for (const id of before.keys())
        if (!after.has(id))
            removed.push(id);
    const payload = {
        schema: TEST_CHANGE_SET_SCHEMA,
        change: input.change,
        module: input.module,
        source: TEST_CHANGE_SET_SOURCE,
        changed_test_ids: asciiSort(changed),
        removed_test_ids: asciiSort(removed),
        targets: sortedTargets.map(target => ({
            target_path: target.targetPath,
            before_sha256: target.beforeBytes === null ? null : sha256(target.beforeBytes),
            after_sha256: sha256(target.afterBytes),
        })),
    };
    const overlap = payload.changed_test_ids.filter(id => payload.removed_test_ids.includes(id));
    if (overlap.length > 0)
        throw new Error(`test-change-set-overlap：${overlap.join('、')}`);
    return { ...payload, sha256: hashPayload(payload) };
}
function invalid(code, message, path) {
    return { valid: false, code, message, path };
}
export function validateTestChangeSet(root, raw, expected) {
    const value = asRecord(raw);
    if (!value || !exactOrderedKeys(value, TOP_KEYS)) {
        return invalid('test-slice-change-set-shape', 'change set 顶层键必须严格且按 canonical 顺序排列', '$.test_change_set');
    }
    if (value.schema !== TEST_CHANGE_SET_SCHEMA) {
        return invalid('test-slice-change-set-schema', `不支持 change set schema：${String(value.schema)}`, '$.test_change_set.schema');
    }
    if (value.change !== expected.change || value.module !== expected.module || value.source !== TEST_CHANGE_SET_SOURCE) {
        return invalid('test-slice-change-set-identity', 'change/module/source 与当前提案身份不一致', '$.test_change_set');
    }
    if (!Array.isArray(value.changed_test_ids) || !Array.isArray(value.removed_test_ids) || !Array.isArray(value.targets)) {
        return invalid('test-slice-change-set-shape', 'C/R/targets 必须为数组', '$.test_change_set');
    }
    const changed = value.changed_test_ids;
    const removed = value.removed_test_ids;
    if ([...changed, ...removed].some(id => typeof id !== 'string' || !TEST_ID_RE.test(id))) {
        return invalid('test-slice-change-set-test-id', 'C/R 含非法测试 ID', '$.test_change_set');
    }
    if (JSON.stringify(changed) !== JSON.stringify(asciiSort(changed))
        || JSON.stringify(removed) !== JSON.stringify(asciiSort(removed))
        || changed.some(id => removed.includes(id))) {
        return invalid('test-slice-change-set-order', 'C/R 必须 ASCII 排序、去重且不相交', '$.test_change_set');
    }
    const targets = [];
    for (let index = 0; index < value.targets.length; index++) {
        const row = asRecord(value.targets[index]);
        if (!row || !exactOrderedKeys(row, TARGET_KEYS)
            || typeof row.target_path !== 'string'
            || !(row.before_sha256 === null || (typeof row.before_sha256 === 'string' && HASH_RE.test(row.before_sha256)))
            || typeof row.after_sha256 !== 'string' || !HASH_RE.test(row.after_sha256)) {
            return invalid('test-slice-change-set-target', 'target identity/hash 字段非法', `$.test_change_set.targets[${index}]`);
        }
        const path = join(root, ...row.target_path.split('/'));
        if (!existsSync(path) || sha256(readFileSync(path)) !== row.after_sha256) {
            return invalid('test-slice-change-set-target-hash', `正式 target 缺失或 after hash 漂移：${row.target_path}`, `$.test_change_set.targets[${index}]`);
        }
        targets.push(row);
    }
    const targetPaths = targets.map(target => target.target_path);
    if (JSON.stringify(targetPaths) !== JSON.stringify(asciiSort(targetPaths))) {
        return invalid('test-slice-change-set-target-order', 'targets 必须按 ASCII 排序且去重', '$.test_change_set.targets');
    }
    if (expected.targetPaths && JSON.stringify(targetPaths) !== JSON.stringify(asciiSort(expected.targetPaths))) {
        return invalid('test-slice-change-set-target-identity', 'targets 与 baseline plan 的 test targets 不一致', '$.test_change_set.targets');
    }
    if (typeof value.sha256 !== 'string' || !PREFIXED_HASH_RE.test(value.sha256)) {
        return invalid('test-slice-change-set-hash', 'change set sha256 格式非法', '$.test_change_set.sha256');
    }
    const payload = {
        schema: TEST_CHANGE_SET_SCHEMA,
        change: value.change,
        module: value.module,
        source: TEST_CHANGE_SET_SOURCE,
        changed_test_ids: changed,
        removed_test_ids: removed,
        targets,
    };
    if (value.sha256 !== hashPayload(payload)) {
        return invalid('test-slice-change-set-hash', 'change set payload hash 不一致', '$.test_change_set.sha256');
    }
    return { valid: true, value: { ...payload, sha256: value.sha256 } };
}
export function readTestChangeSet(root, proposalDir, expected) {
    const markerPath = join(proposalDir, 'SPEC_MERGED');
    if (!existsSync(markerPath))
        return invalid('test-slice-change-set-missing', 'SPEC_MERGED 不存在', 'SPEC_MERGED');
    let marker;
    try {
        const source = readFileSync(markerPath, 'utf8');
        const document = parseDocument(source, { uniqueKeys: true, strict: true, prettyErrors: false });
        if (document.errors.length > 0)
            throw new Error(document.errors.map(error => error.message).join('；'));
        marker = JSON.parse(source);
    }
    catch (error) {
        return invalid('test-slice-change-set-marker', `SPEC_MERGED 无法严格解析：${String(error)}`, 'SPEC_MERGED');
    }
    const record = asRecord(marker);
    if (!record || !('test_change_set' in record)) {
        if (record?.type === 'no_delta_spec_complete'
            && !classifyProposalDeltas(proposalDir).some(entry => entry.mergeDisposition === 'mergeable')) {
            return { valid: true, value: buildTestChangeSet({
                    change: expected.change,
                    module: expected.module,
                    targets: [],
                }) };
        }
        return invalid('test-slice-change-set-missing', 'SPEC_MERGED.test_change_set 缺失', '$.test_change_set');
    }
    return validateTestChangeSet(root, record.test_change_set, expected);
}
//# sourceMappingURL=test-change-set.js.map