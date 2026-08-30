/**
 * brownfield-adopter 切片1：读侧可信边界的 provenance 数据模型与覆盖率计算。
 *
 * 权威载体 = 逆向产物文档内具名章节 `## 逆向基线来源`（内含 fenced YAML 的 `candidates[]`）。
 * `logos-project.yaml` 仅为派生索引（携 source_hash）。覆盖率永远可从文档 candidates[] 单独重算。
 *
 * 详见规格 core-06-provenance-data-model、feature-specs §2.27、cli-experience §2.22。
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
const SECTION_HEADING = '## 逆向基线来源';
/** F3：规范键格式 `<module>::<12 位十六进制>`。 */
export function isCanonicalKey(key, moduleId) {
    const m = /^([a-z0-9][a-z0-9-]*)::([0-9a-f]{12})$/.exec(key);
    if (!m)
        return false;
    return moduleId === undefined || m[1] === moduleId;
}
export function sha256(content) {
    return createHash('sha256').update(content).digest('hex');
}
/** anchor 规范化：NFKC + 去首尾空白 + 小写 + 折叠内部空白。 */
export function normalizeAnchor(anchor) {
    return anchor.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
}
/** 规范键 key = `<module>::<sha256(normalize(anchor))[:12]>`（hash 形式，slug 只进 anchor/display）。 */
export function candidateKey(moduleId, anchor) {
    return `${moduleId}::${sha256(normalizeAnchor(anchor)).slice(0, 12)}`;
}
/**
 * provenance-scan-canonical-recompute：扫描侧候选采信判据（与写侧 baseline-seed 的 validateSeedCandidate 同强度）。
 * 采信一个候选为该 module 的权威候选 ⇔ 其 `key` **可由 anchor 或任一 alias 重算得出**：
 *   `key === candidateKey(module, anchor)` ∨ `∃ a∈aliases[] : key === candidateKey(module, a)`
 * - **alias-aware**：`aliases[]` 语义是旧 anchor、改名后 `key` 稳定（见 §三 身份继承），故必须容许由旧 anchor 重算，
 *   以保留改名继承 / tombstone / superseded 合法候选；单用当前 anchor 会误杀。
 * - 只认 hash 可重算性、**不认前缀**：格式合法但 hash 失配的幽灵/示例 key（文档/教学示例）不被采信，防其毒化基线。
 * 因 `candidateKey(module, …)` 恒产出 `module::` 前缀，本判据天然蕴含模块归属，无需再单独前缀过滤。
 */
export function isCandidateKeyRecomputable(c, moduleId) {
    if (typeof c.anchor === 'string' && c.anchor !== '' && c.key === candidateKey(moduleId, c.anchor))
        return true;
    return c.aliases.some((a) => c.key === candidateKey(moduleId, a));
}
/** 抽取 `## 逆向基线来源` 章节文本（从该标题到下一个顶层 `## ` 标题或文末）。缺失返回 null。 */
export function extractProvenanceSectionText(markdown) {
    const lines = markdown.split('\n');
    let start = -1;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim() === SECTION_HEADING) {
            start = i;
            break;
        }
    }
    if (start === -1)
        return null;
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
        if (/^##\s+/.test(lines[i]) && !/^###/.test(lines[i])) {
            end = i;
            break;
        }
    }
    return lines.slice(start, end).join('\n').replace(/\s+$/, '');
}
function normalizeCandidate(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        return null;
    const r = raw;
    if (typeof r.key !== 'string' || r.key.trim() === '')
        return null;
    const state = r.state === 'tombstone' ? 'tombstone' : r.state === 'retired' ? 'retired' : 'active';
    const strArray = (v) => Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
    const strOrNull = (v) => (typeof v === 'string' && v !== '' ? v : null);
    return {
        key: r.key,
        anchor: typeof r.anchor === 'string' ? r.anchor : undefined,
        display: typeof r.display === 'string' ? r.display : undefined,
        state,
        verified: r.verified === true,
        aliases: strArray(r.aliases),
        superseded_by: strArray(r.superseded_by),
        confirmed_by: strOrNull(r.confirmed_by),
        evidence: strOrNull(r.evidence),
        confirmed_at: strOrNull(r.confirmed_at),
        retired_by: strOrNull(r.retired_by),
        retire_event_id: strOrNull(r.retire_event_id),
    };
}
/**
 * F3：抽取 `## 逆向基线来源` 章节的**原始（未规范化）** candidates 条目——供 seed 输入做严格 schema 校验。
 * 缺章节返回 null；有章节但无 fenced YAML / 结构非法返回 `{ ok:false, raw:[] }`。
 */
export function extractRawCandidates(markdown) {
    const sectionText = extractProvenanceSectionText(markdown);
    if (sectionText === null)
        return null;
    const fence = sectionText.match(/```ya?ml\s*\n([\s\S]*?)\n```/);
    if (!fence)
        return { ok: false, raw: [] };
    try {
        const doc = parseYaml(fence[1]);
        if (!doc || !Array.isArray(doc.candidates))
            return { ok: false, raw: [] };
        return { ok: true, raw: doc.candidates };
    }
    catch {
        return { ok: false, raw: [] };
    }
}
/**
 * F3：seed 输入候选的**严格** schema 校验（不经宽松规范化）。种子只登记可验证事实，故要求：
 * - `state` **显式**为 `active`（拒绝未知/伪造状态被归一为 active）；
 * - `verified` **显式**为布尔 `false`（拒绝缺失/非布尔被归一为 false）；
 * - `anchor` 为非空字符串（种子必须携带语义锚点）；
 * - `key` 存在且 == `candidateKey(module, anchor)`（重算比对，杜绝 key 与 anchor 脱钩/伪造）。
 * 通过返回 null；否则返回中文原因串。
 */
export function validateSeedCandidate(raw, moduleId) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        return 'candidate 非对象';
    const r = raw;
    if (r.state !== 'active')
        return `state 必须显式为 active（实际 ${JSON.stringify(r.state)}）`;
    if (r.verified !== false)
        return `verified 必须显式为布尔 false（实际 ${JSON.stringify(r.verified)}）`;
    for (const field of ['confirmed_by', 'evidence', 'confirmed_at']) {
        if (r[field] !== undefined && r[field] !== null)
            return `${field} 必须缺失或为 null（确认写回机制已删除）`;
    }
    if (typeof r.anchor !== 'string' || r.anchor.trim() === '')
        return 'anchor 缺失或为空（种子必须携锚点）';
    if (typeof r.key !== 'string' || r.key.trim() === '')
        return 'key 缺失';
    const expected = candidateKey(moduleId, r.anchor);
    if (r.key !== expected)
        return `key 与 anchor 不一致（期望 ${expected}，实际 ${r.key}）`;
    return null;
}
/**
 * 确认机制删除后的写侧归一化：历史 `verified:true`/confirmed_* 只允许被旧文档读侧兼容，
 * 任何重扫、替换或序列化都必须冻结为 false/null，绝不把旧确认状态写回新字节。
 */
function withoutConfirmationWriteback(candidate) {
    return {
        ...candidate,
        verified: false,
        confirmed_by: null,
        evidence: null,
        confirmed_at: null,
    };
}
/** 解析文档内 `## 逆向基线来源` 章节的 candidates[] 与 source_hash。缺章节返回 null。 */
export function parseProvenanceSection(markdown) {
    const sectionText = extractProvenanceSectionText(markdown);
    if (sectionText === null)
        return null;
    const fence = sectionText.match(/```ya?ml\s*\n([\s\S]*?)\n```/);
    let candidates = [];
    let parseOk = true;
    if (!fence) {
        // 有章节标题但无 fenced YAML → 结构非法（F5：不静默当空候选）。
        parseOk = false;
    }
    else {
        try {
            const doc = parseYaml(fence[1]);
            if (!doc || !Array.isArray(doc.candidates)) {
                parseOk = false;
            }
            else {
                const raw = doc.candidates;
                candidates = raw.map(normalizeCandidate).filter((c) => c !== null);
                // 有原始条目但规范化后丢失（缺 key 等）⇒ 结构非法。
                if (candidates.length !== raw.length)
                    parseOk = false;
            }
        }
        catch {
            parseOk = false;
            candidates = [];
        }
    }
    return { candidates, source_hash: sha256(sectionText), parse_ok: parseOk };
}
/**
 * provenance 为派生值（单一可信来源），由 `state` 派生（不再读 `verified`——确认概念已删除，无 human-verified 值）：
 * state∈{active,tombstone} ⇒ reverse-engineered；否则（retired / 章节缺失）⇒ unknown。
 */
export function deriveProvenance(candidate) {
    if (candidate.state === 'active' || candidate.state === 'tombstone')
        return 'reverse-engineered';
    return 'unknown';
}
/** 缺 `## 逆向基线来源` 章节的既有文档 provenance 派生（保守迁移用）。 */
export function classifyDocProvenance(markdown) {
    return extractProvenanceSectionText(markdown) === null ? 'unknown' : 'reverse-engineered';
}
/**
 * tombstone 分母法（纯逆向候选计数）：denominator = active ∪ tombstone（retired 不计入）；
 * 无分子、无 coverage 比值。删除候选转 tombstone 仍计入 denominator ⇒ 计数不因删除而缩小、不虚增。
 */
export function computeCoverage(candidates) {
    // F5：按稳定键去重（同 key 多次出现——含跨文档——只计一次，last-wins）。
    const byKey = new Map();
    for (const c of candidates)
        byKey.set(c.key, c);
    const deduped = [...byKey.values()];
    const active = deduped.filter(c => c.state === 'active');
    const tombstones = deduped.filter(c => c.state === 'tombstone');
    return {
        denominator: active.length + tombstones.length,
        tombstones: tombstones.length,
    };
}
/** 递归列出 logos/resources 下的 .md 文件绝对路径（排除 baseline-seed run 私有 staging/backup）。 */
function listResourceMarkdown(root) {
    const base = join(root, 'logos', 'resources');
    if (!existsSync(base))
        return [];
    return readdirSync(base, { recursive: true })
        .map(f => String(f).replace(/\\/g, '/'))
        .filter(f => f.endsWith('.md'))
        // 排除 run 私有目录（staging/backup 的目标副本不是已合并主文档，不得计入覆盖率）。
        .filter(f => !f.includes('verify/baseline-seed-runs/'))
        .map(f => join(base, f));
}
/** 扫描 logos/resources 下所有含 `## 逆向基线来源` 章节的文档，聚合某模块的候选（只读已合并主文档）。 */
export function scanModuleCandidates(root, moduleId) {
    const perDoc = [];
    const byKey = new Map();
    const keyDoc = new Map(); // key → 首次出现的文档（用于跨文档冲突检测）
    let docCount = 0;
    let parseFailed = false;
    for (const file of listResourceMarkdown(root).sort()) {
        let section = null;
        try {
            section = parseProvenanceSection(readFileSync(file, 'utf-8'));
        }
        catch {
            section = null;
        }
        if (!section)
            continue;
        if (!section.parse_ok) {
            parseFailed = true;
        }
        // provenance-scan-canonical-recompute：采信 = alias-aware canonical 重算（不再仅前缀匹配），排除不可重算的幽灵/示例候选
        const moduleCandidates = section.candidates.filter(c => isCandidateKeyRecomputable(c, moduleId));
        if (moduleCandidates.length === 0 && section.parse_ok)
            continue;
        if (moduleCandidates.length > 0 || !section.parse_ok) {
            docCount += 1;
            perDoc.push(section.source_hash);
        }
        for (const c of moduleCandidates) {
            // F5：同一稳定键出现在【不同文档】= 冲突——不静默 last-wins/报 fresh，标 parse_failed（freshness→unknown）。
            const prev = keyDoc.get(c.key);
            if (prev !== undefined && prev !== file)
                parseFailed = true;
            keyDoc.set(c.key, file);
            byKey.set(c.key, c);
        }
    }
    return { candidates: [...byKey.values()], aggregate_hash: sha256(perDoc.join('|')), doc_count: docCount, parse_failed: parseFailed };
}
/**
 * F4：列出**当前持有**某模块权威候选（key 以 `<module>::` 前缀）的所有资源文档，返回**相对项目根**的 posix 路径
 * （形如 `logos/resources/...`）。commit/begin 用它强制「manifest 目标必须覆盖所有已持有候选的文档」——
 * 否则目标改名/换址后旧文档不进对账、旧候选残留 → 跨文档重复 key → 扫描 parse_failed。
 */
export function listModuleProvenanceDocs(root, moduleId) {
    const base = join(root, 'logos', 'resources');
    const docs = [];
    for (const abs of listResourceMarkdown(root)) {
        let section = null;
        try {
            section = parseProvenanceSection(readFileSync(abs, 'utf-8'));
        }
        catch {
            section = null;
        }
        if (!section)
            continue;
        // provenance-scan-canonical-recompute：只有持有**可重算**候选的文档才算持有本 module 权威候选（排除仅含示例/幽灵候选的文档）
        if (section.candidates.some(c => isCandidateKeyRecomputable(c, moduleId))) {
            const rel = abs.slice(base.length).replace(/^[\\/]/, '').replace(/\\/g, '/');
            docs.push(`logos/resources/${rel}`);
        }
    }
    return docs;
}
/**
 * 构造 next/status 输出的 baseline_coverage 对象。覆盖率只读已合并主文档；
 * 若派生索引 source_hash 与实时聚合 hash 不符 ⇒ freshness=stale（不输出可信精确百分比）。
 */
export function buildBaselineCoverage(root, moduleId, state, indexEntry) {
    const scan = scanModuleCandidates(root, moduleId);
    const cov = computeCoverage(scan.candidates);
    let source = 'documents';
    let freshness = 'fresh';
    if (indexEntry && typeof indexEntry.source_hash === 'string') {
        source = 'derived-index';
        freshness = indexEntry.source_hash === scan.aggregate_hash ? 'fresh' : 'stale';
    }
    // F5：任一权威文档章节解析失败 ⇒ unknown（不静默报 fresh、不输出貌似精确的计数结论）。
    if (scan.parse_failed)
        freshness = 'unknown';
    return {
        state,
        incomplete: state === 'partial',
        denominator: cov.denominator,
        tombstones: cov.tombstones,
        source,
        freshness,
    };
}
/** F4：把候选注册表序列化为 `## 逆向基线来源` 章节文本（确定性、供 commit 落盘）。 */
export function serializeProvenanceSection(candidates) {
    const plain = candidates.map(raw => {
        const c = withoutConfirmationWriteback(raw);
        const o = { key: c.key };
        if (c.anchor)
            o.anchor = c.anchor;
        if (c.display)
            o.display = c.display;
        o.state = c.state;
        o.verified = c.verified;
        o.aliases = c.aliases;
        o.superseded_by = c.superseded_by;
        // confirmed_by/evidence/confirmed_at 仅供旧文档读兼容；确认机制删除后禁止写回这些键。
        o.retired_by = c.retired_by;
        o.retire_event_id = c.retire_event_id;
        return o;
    });
    const yaml = stringifyYaml({ candidates: plain }, { lineWidth: 0 });
    return `${SECTION_HEADING}\n\`\`\`yaml\n${yaml}\`\`\`\n`;
}
/** F4：用给定候选替换文档内 `## 逆向基线来源` 章节（缺则追加）；其余正文保持不变。 */
export function replaceProvenanceSection(markdown, candidates) {
    const serialized = serializeProvenanceSection(candidates);
    const lines = markdown.split('\n');
    let start = -1;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim() === SECTION_HEADING) {
            start = i;
            break;
        }
    }
    if (start === -1) {
        const sep = markdown.endsWith('\n') ? '\n' : '\n\n';
        return markdown + sep + serialized;
    }
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
        if (/^##\s+/.test(lines[i]) && !/^###/.test(lines[i])) {
            end = i;
            break;
        }
    }
    const before = lines.slice(0, start).join('\n');
    const after = lines.slice(end).join('\n');
    return (before ? before + '\n' : '') + serialized + (after ? '\n' + after : '');
}
/**
 * F4：重扫候选继承 + tombstone 对账。以 prior（已合并主文档候选）为基准合并 staged：
 * - 匹配（同 key 或 alias 命中）：继承身份与 alias，但把历史确认残留冻结为 false/null，不写回 confirmed_*。
 * - prior 中在 staged 消失的候选：转 `tombstone` 并同样清除确认残留；`retired` 保持生命周期但不保留确认值。
 * 结果按 key 排序（确定性、幂等）。
 */
export function reconcileCandidates(prior, staged) {
    const priorByKey = new Map();
    const priorByAlias = new Map();
    for (const p of prior) {
        priorByKey.set(p.key, p);
        priorByAlias.set(p.key, p);
        for (const a of p.aliases)
            priorByAlias.set(a, p);
    }
    const result = [];
    const consumed = new Set();
    for (const s of staged) {
        let p = priorByKey.get(s.key) ?? priorByAlias.get(s.key);
        if (!p) {
            for (const a of s.aliases) {
                const hit = priorByKey.get(a) ?? priorByAlias.get(a);
                if (hit) {
                    p = hit;
                    break;
                }
            }
        }
        if (p) {
            consumed.add(p.key);
            result.push(withoutConfirmationWriteback({
                ...s,
                aliases: [...new Set([...s.aliases, ...p.aliases])],
            }));
        }
        else {
            result.push(withoutConfirmationWriteback(s));
        }
    }
    for (const p of prior) {
        if (consumed.has(p.key) || result.some(r => r.key === p.key))
            continue;
        // prior 在 staged 消失：转 tombstone；历史确认残留只读兼容，不进入新序列化结果。
        result.push(withoutConfirmationWriteback(p.state === 'retired' ? p : { ...p, state: 'tombstone' }));
    }
    result.sort((a, b) => a.key.localeCompare(b.key));
    return result;
}
/**
 * F4：**模块级全局**重扫继承 + tombstone 对账（取代逐目标文档独立对账，杜绝跨文档移动产生的重复候选）。
 *
 * 以模块下**所有目标文档**的 prior 候选为全局注册表，按 key、**anchor（含 normalize）**、aliases 三路匹配 staged：
 * - `aliases[]` 权威语义是**旧 anchor**（非旧 key）——故 prior 同时按其 `anchor` 与 `aliases` 建索引，staged 的
 *   `aliases`（旧 anchor）既直接匹配 prior anchor，也经 `candidateKey(module, alias)` 匹配 prior key，保证真实
 *   anchor 重命名可继承身份。
 * - 匹配成功：继承候选身份与 alias（含 prior 旧 anchor），但历史确认残留统一冻结为 false/null，
 *   身份分配到 staged 的**新目标文档**（支持跨文档移动，不在旧文档留 tombstone、不产生跨文档重复 key）。
 * - prior 中在 staged 消失且未被继承的候选：在其**原文档**转 tombstone（retired 原样保留）。
 * 返回 `Map<target_path, 候选[]>`（每文档内按 key 排序，确定性、幂等）。
 */
export function reconcileModuleCandidates(moduleId, priorByDoc, stagedByDoc) {
    const priorEntries = [];
    for (const [doc, cands] of priorByDoc)
        for (const c of cands)
            priorEntries.push({ cand: c, doc });
    const byKey = new Map();
    const byAnchor = new Map();
    for (const e of priorEntries) {
        byKey.set(e.cand.key, e);
        if (e.cand.anchor)
            byAnchor.set(normalizeAnchor(e.cand.anchor), e);
        for (const a of e.cand.aliases)
            byAnchor.set(normalizeAnchor(a), e);
    }
    const result = new Map();
    const resultKeys = new Set();
    const consumed = new Set();
    const push = (doc, c) => {
        const arr = result.get(doc) ?? [];
        arr.push(c);
        result.set(doc, arr);
        resultKeys.add(c.key);
    };
    for (const [doc, cands] of stagedByDoc) {
        for (const s of cands) {
            let hit = byKey.get(s.key);
            if (!hit && s.anchor)
                hit = byAnchor.get(normalizeAnchor(s.anchor));
            if (!hit) {
                for (const a of s.aliases) {
                    hit = byKey.get(a) ?? byAnchor.get(normalizeAnchor(a)) ?? byKey.get(candidateKey(moduleId, a));
                    if (hit)
                        break;
                }
            }
            if (hit && !consumed.has(hit.cand.key)) {
                const p = hit.cand;
                consumed.add(p.key);
                const inheritedAliases = [...s.aliases, ...p.aliases];
                if (p.anchor && p.anchor !== s.anchor)
                    inheritedAliases.push(p.anchor);
                push(doc, withoutConfirmationWriteback({
                    ...s,
                    aliases: [...new Set(inheritedAliases)],
                }));
            }
            else {
                push(doc, withoutConfirmationWriteback(s));
            }
        }
    }
    for (const e of priorEntries) {
        if (consumed.has(e.cand.key) || resultKeys.has(e.cand.key))
            continue;
        push(e.doc, withoutConfirmationWriteback(e.cand.state === 'retired' ? e.cand : { ...e.cand, state: 'tombstone' }));
    }
    for (const [, arr] of result)
        arr.sort((a, b) => a.key.localeCompare(b.key));
    return result;
}
//# sourceMappingURL=baseline-provenance.js.map