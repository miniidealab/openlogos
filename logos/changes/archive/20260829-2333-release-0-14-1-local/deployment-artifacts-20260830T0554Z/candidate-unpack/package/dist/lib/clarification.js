import { parse as parseYaml } from 'yaml';
import { authorityScan } from './markdown-scan.js';
export const CLARIFICATION_SCHEMA = 'openlogos/clarification@1';
export const CLARIFICATION_CATEGORIES = [
    'product',
    'ownership',
    'data',
    'compatibility',
    'security_privacy',
    'deployment',
    'release',
    'external_commitment',
    'acceptance',
];
const CXX_RE = /^C(?:0[1-9]|[1-9]\d+)$/;
const MODE_SET = new Set(['adaptive', 'deep', 'provided']);
const CATEGORY_SET = new Set(CLARIFICATION_CATEGORIES);
const IMPACT_TO_CATEGORY = {
    data: 'data',
    compatibility: 'compatibility',
    security_privacy: 'security_privacy',
    public_release: 'release',
    external_commitment: 'external_commitment',
};
const IMPACT_KEYS = Object.keys(IMPACT_TO_CATEGORY);
const REASON_BY_CATEGORY = {
    data: 'data-clarification-required',
    compatibility: 'compatibility-clarification-required',
    security_privacy: 'security-privacy-clarification-required',
    deployment: 'deployment-clarification-required',
    release: 'release-clarification-required',
    external_commitment: 'external-commitment-clarification-required',
};
function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function nonEmpty(value) {
    return typeof value === 'string' && value.trim().length > 0;
}
function invalidOutput(reason, schema = null, mode = null) {
    return {
        schema,
        mode,
        status: 'invalid',
        required: true,
        required_categories: [],
        unresolved_decisions: 0,
        next_decision_id: null,
        reason,
        next_decision: null,
    };
}
function extractClarificationYaml(content) {
    const lines = content.split(/\r?\n/);
    const scan = authorityScan(lines);
    const headings = [];
    for (let i = 0; i < lines.length; i++) {
        if (scan.masked[i])
            continue;
        const m = scan.text[i].match(/^ {0,3}##[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/);
        if (m && (m[1].trim() === '决策澄清' || m[1].trim() === 'Decision Clarification'))
            headings.push(i);
    }
    if (headings.length === 0)
        return { status: 'missing' };
    if (headings.length > 1)
        return { status: 'duplicate-heading' };
    const start = headings[0] + 1;
    let end = lines.length;
    for (let i = start; i < lines.length; i++) {
        if (!scan.masked[i] && /^ {0,3}#{1,2}(?:[ \t]+|$)/.test(scan.text[i])) {
            end = i;
            break;
        }
    }
    const section = lines.slice(start, end).join('\n');
    const fenced = [...section.matchAll(/(?:^|\n) {0,3}```ya?ml[ \t]*\r?\n([\s\S]*?)\r?\n {0,3}```(?=\n|$)/gi)];
    if (fenced.length === 0)
        return { status: 'invalid' };
    if (fenced.length > 1)
        return { status: 'duplicate-yaml' };
    return { status: 'found', yaml: fenced[0][1] };
}
function isUnscannedImpactReason(value) {
    if (!nonEmpty(value))
        return false;
    const reason = value.trim();
    return reason.startsWith('待 change-writer 按仓库事实确认')
        || reason.startsWith('change-writer must confirm from repository facts');
}
function parseDecision(value, issues, index) {
    if (!isRecord(value)) {
        issues.push(`decisions[${index}] 必须是对象`);
        return null;
    }
    const id = value.id;
    const category = value.category;
    const source = value.source;
    if (!nonEmpty(id) || !CXX_RE.test(id))
        issues.push(`decisions[${index}].id 非法`);
    if (!nonEmpty(category) || !CATEGORY_SET.has(category))
        issues.push(`decisions[${index}].category 非法`);
    if (source !== 'user' && source !== 'policy' && source !== 'repository_fact')
        issues.push(`decisions[${index}].source 非法`);
    for (const key of ['question', 'answer', 'rationale']) {
        if (!nonEmpty(value[key]))
            issues.push(`decisions[${index}].${key} 不能为空`);
    }
    for (const key of ['affects', 'rejected_options']) {
        if (!Array.isArray(value[key]) || !value[key].every(nonEmpty))
            issues.push(`decisions[${index}].${key} 必须是字符串数组`);
    }
    if (!nonEmpty(id) || !CXX_RE.test(id) || !nonEmpty(category) || !CATEGORY_SET.has(category)
        || (source !== 'user' && source !== 'policy' && source !== 'repository_fact'))
        return null;
    return { id, category: category, source };
}
function parseUnresolved(value, issues, index) {
    if (!isRecord(value)) {
        issues.push(`unresolved[${index}] 必须是对象`);
        return null;
    }
    const id = value.id;
    const category = value.category;
    if (!nonEmpty(id) || !CXX_RE.test(id))
        issues.push(`unresolved[${index}].id 非法`);
    if (!nonEmpty(category) || !CATEGORY_SET.has(category))
        issues.push(`unresolved[${index}].category 非法`);
    for (const key of ['question', 'impact', 'recommendation', 'recommendation_reason']) {
        if (!nonEmpty(value[key]))
            issues.push(`unresolved[${index}].${key} 不能为空`);
    }
    const dependsOn = value.depends_on;
    if (!Array.isArray(dependsOn) || !dependsOn.every(v => nonEmpty(v) && CXX_RE.test(v))) {
        issues.push(`unresolved[${index}].depends_on 必须是合法 CXX 数组`);
    }
    const options = value.options;
    if (!Array.isArray(options) || options.length > 2) {
        issues.push(`unresolved[${index}].options 必须是最多两个选项的数组`);
    }
    else {
        options.forEach((option, optionIndex) => {
            if (!isRecord(option) || !nonEmpty(option.id) || !nonEmpty(option.label) || !nonEmpty(option.tradeoff)) {
                issues.push(`unresolved[${index}].options[${optionIndex}] 非法`);
            }
        });
    }
    if (!nonEmpty(id) || !CXX_RE.test(id) || !nonEmpty(category) || !CATEGORY_SET.has(category)
        || !nonEmpty(value.question) || !nonEmpty(value.impact) || !nonEmpty(value.recommendation)
        || !nonEmpty(value.recommendation_reason) || !Array.isArray(dependsOn)
        || !dependsOn.every(v => nonEmpty(v) && CXX_RE.test(v)) || !Array.isArray(options) || options.length > 2
        || !options.every(option => isRecord(option) && nonEmpty(option.id) && nonEmpty(option.label) && nonEmpty(option.tradeoff)))
        return null;
    return {
        id,
        category: category,
        depends_on: [...dependsOn],
        question: value.question,
        impact: value.impact,
        recommendation: value.recommendation,
        recommendation_reason: value.recommendation_reason,
        options: options.map(option => ({
            id: option.id,
            label: option.label,
            tradeoff: option.tradeoff,
        })),
    };
}
function hasCycle(nodes) {
    const unresolvedIds = new Set(nodes.map(node => node.id));
    const edges = new Map(nodes.map(node => [node.id, node.depends_on.filter(id => unresolvedIds.has(id))]));
    const visiting = new Set();
    const visited = new Set();
    const visit = (id) => {
        if (visiting.has(id))
            return true;
        if (visited.has(id))
            return false;
        visiting.add(id);
        for (const dep of edges.get(id) ?? [])
            if (visit(dep))
                return true;
        visiting.delete(id);
        visited.add(id);
        return false;
    };
    return nodes.some(node => visit(node.id));
}
function stableUnresolvedOrder(nodes, decidedIds) {
    const remaining = [...nodes];
    const available = new Set(decidedIds);
    const ordered = [];
    while (remaining.length > 0) {
        const candidates = remaining
            .filter(node => node.depends_on.every(id => available.has(id)))
            .sort((left, right) => {
            const byCategory = CLARIFICATION_CATEGORIES.indexOf(left.category)
                - CLARIFICATION_CATEGORIES.indexOf(right.category);
            if (byCategory !== 0)
                return byCategory;
            return Number(left.id.slice(1)) - Number(right.id.slice(1));
        });
        if (candidates.length === 0)
            return ordered;
        const next = candidates[0];
        ordered.push(next.id);
        available.add(next.id);
        remaining.splice(remaining.findIndex(node => node.id === next.id), 1);
    }
    return ordered;
}
export function validateClarificationOutput(value) {
    const sorted = [...value.required_categories].sort((a, b) => CLARIFICATION_CATEGORIES.indexOf(a) - CLARIFICATION_CATEGORIES.indexOf(b));
    if (new Set(value.required_categories).size !== value.required_categories.length
        || sorted.some((item, index) => item !== value.required_categories[index]))
        return false;
    if (value.next_decision !== null && value.next_decision_id !== value.next_decision.id)
        return false;
    if (value.status === 'complete') {
        return value.schema === CLARIFICATION_SCHEMA && value.mode !== null && !value.required
            && value.required_categories.length === 0 && value.unresolved_decisions === 0
            && value.next_decision_id === null && value.reason === null && value.next_decision === null;
    }
    if (value.status === 'pending') {
        return value.schema === CLARIFICATION_SCHEMA && value.mode !== null && value.required
            && value.required_categories.length > 0 && value.unresolved_decisions > 0
            && value.next_decision_id !== null && value.reason !== null && value.next_decision !== null;
    }
    return value.required && value.required_categories.length === 0 && value.unresolved_decisions === 0
        && value.next_decision_id === null && value.next_decision === null
        && (value.reason === 'clarification-contract-invalid' || value.reason === 'clarification-upgrade-required'
            || value.reason === 'legacy-clarification-backfill-required');
}
export function evaluateProposalClarification(content, deploymentRequired) {
    const extracted = extractClarificationYaml(content);
    if (extracted.status === 'missing') {
        return {
            present: false,
            valid: false,
            issues: ['缺少唯一的「决策澄清 / Decision Clarification」章节'],
            output: invalidOutput('legacy-clarification-backfill-required'),
        };
    }
    if (extracted.status !== 'found' || extracted.yaml === undefined) {
        const issue = extracted.status === 'duplicate-heading'
            ? '决策澄清章节重复'
            : extracted.status === 'duplicate-yaml'
                ? '决策澄清章节必须且只能包含一个 YAML 围栏'
                : '决策澄清章节缺少唯一 YAML 围栏';
        return {
            present: true,
            valid: false,
            issues: [issue],
            output: invalidOutput('clarification-contract-invalid'),
        };
    }
    let raw;
    try {
        raw = parseYaml(extracted.yaml);
    }
    catch {
        raw = null;
    }
    if (!isRecord(raw)) {
        return { present: true, valid: false, issues: ['clarification YAML 无法解析为对象'], output: invalidOutput('clarification-contract-invalid') };
    }
    const schema = nonEmpty(raw.schema) ? raw.schema.trim() : null;
    if (schema !== CLARIFICATION_SCHEMA) {
        if (schema && /^openlogos\/clarification@[1-9]\d*$/.test(schema)) {
            return { present: true, valid: false, issues: [`不支持 clarification schema：${schema}`], output: invalidOutput('clarification-upgrade-required', schema) };
        }
        return { present: true, valid: false, issues: ['clarification.schema 非法'], output: invalidOutput('clarification-contract-invalid') };
    }
    const issues = [];
    const mode = nonEmpty(raw.mode) && MODE_SET.has(raw.mode) ? raw.mode : null;
    if (mode === null)
        issues.push('clarification.mode 非法');
    if (raw.status !== 'pending' && raw.status !== 'complete' && raw.status !== 'invalid')
        issues.push('clarification.status 非法');
    if (!isRecord(raw.impacts))
        issues.push('clarification.impacts 必须是对象');
    const impacts = isRecord(raw.impacts) ? raw.impacts : {};
    if (Object.keys(impacts).length !== IMPACT_KEYS.length || IMPACT_KEYS.some(key => !(key in impacts))) {
        issues.push('clarification.impacts 必须完整且只能包含五类固定影响');
    }
    const requiredFromImpacts = [];
    for (const key of IMPACT_KEYS) {
        const item = impacts[key];
        if (!isRecord(item) || (item.status !== 'none' && item.status !== 'required') || !nonEmpty(item.reason)) {
            issues.push(`clarification.impacts.${key} 非法`);
            continue;
        }
        if (isUnscannedImpactReason(item.reason)) {
            issues.push(`clarification.impacts.${key} 仍是待事实扫描占位理由`);
        }
        if (item.status === 'required')
            requiredFromImpacts.push(IMPACT_TO_CATEGORY[key]);
    }
    if (!Array.isArray(raw.decisions))
        issues.push('clarification.decisions 必须是数组');
    if (!Array.isArray(raw.unresolved))
        issues.push('clarification.unresolved 必须是数组');
    if (!Array.isArray(raw.defaults))
        issues.push('clarification.defaults 必须是数组');
    const decisions = Array.isArray(raw.decisions)
        ? raw.decisions.map((item, index) => parseDecision(item, issues, index)).filter((v) => v !== null)
        : [];
    const unresolved = Array.isArray(raw.unresolved)
        ? raw.unresolved.map((item, index) => parseUnresolved(item, issues, index)).filter((v) => v !== null)
        : [];
    const allIds = [...decisions.map(item => item.id), ...unresolved.map(item => item.id)];
    if (new Set(allIds).size !== allIds.length)
        issues.push('decisions + unresolved 的 CXX 必须全局唯一');
    const allIdSet = new Set(allIds);
    for (const item of unresolved) {
        for (const dep of item.depends_on) {
            if (!allIdSet.has(dep))
                issues.push(`${item.id}.depends_on 引用不存在的 ${dep}`);
            if (dep === item.id)
                issues.push(`${item.id} 不得自依赖`);
        }
    }
    if (hasCycle(unresolved))
        issues.push('unresolved.depends_on 存在循环依赖');
    const stableOrder = stableUnresolvedOrder(unresolved, new Set(decisions.map(item => item.id)));
    if (stableOrder.length === unresolved.length
        && stableOrder.some((id, index) => id !== unresolved[index].id)) {
        issues.push('unresolved 未按固定类别/CXX 稳定拓扑序持久化');
    }
    const available = new Set(decisions.map(item => item.id));
    for (const item of unresolved) {
        if (item.depends_on.some(dep => !available.has(dep)))
            issues.push(`${item.id} 未按稳定拓扑序持久化`);
        available.add(item.id);
    }
    const satisfied = new Set(decisions.filter(item => item.source === 'user').map(item => item.category));
    const triggered = new Set(requiredFromImpacts);
    if (deploymentRequired === true)
        triggered.add('deployment');
    for (const item of unresolved)
        triggered.add(item.category);
    const requiredCategories = CLARIFICATION_CATEGORIES.filter(category => triggered.has(category) && !satisfied.has(category));
    for (const category of requiredCategories) {
        const count = unresolved.filter(item => item.category === category).length;
        if (count !== 1)
            issues.push(`未满足类别 ${category} 必须恰有一个对应 unresolved，实际 ${count}`);
    }
    if (raw.status === 'complete' && unresolved.length > 0)
        issues.push('complete 与非空 unresolved 冲突');
    if (raw.status === 'complete' && requiredCategories.length > 0)
        issues.push('complete 与未满足必选类别冲突');
    if (raw.status === 'pending' && unresolved.length === 0)
        issues.push('pending 必须携带可回答的 unresolved');
    if (raw.status === 'invalid')
        issues.push('proposal 不应主动持久化 status=invalid');
    if (issues.length > 0 || mode === null) {
        return { present: true, valid: false, issues, output: invalidOutput('clarification-contract-invalid', CLARIFICATION_SCHEMA, mode) };
    }
    if (raw.status === 'complete') {
        const output = {
            schema: CLARIFICATION_SCHEMA,
            mode,
            status: 'complete',
            required: false,
            required_categories: [],
            unresolved_decisions: 0,
            next_decision_id: null,
            reason: null,
            next_decision: null,
        };
        return { present: true, valid: validateClarificationOutput(output), issues: [], output };
    }
    const head = unresolved[0];
    const output = {
        schema: CLARIFICATION_SCHEMA,
        mode,
        status: 'pending',
        required: true,
        required_categories: requiredCategories,
        unresolved_decisions: unresolved.length,
        next_decision_id: head.id,
        reason: REASON_BY_CATEGORY[head.category] ?? 'high-impact-user-decision-required',
        next_decision: {
            id: head.id,
            category: head.category,
            question: head.question,
            impact: head.impact,
            recommendation: head.recommendation,
            recommendation_reason: head.recommendation_reason,
            options: head.options,
        },
    };
    if (!validateClarificationOutput(output)) {
        return { present: true, valid: false, issues: ['clarification 输出跨字段一致性校验失败'], output: invalidOutput('clarification-contract-invalid', CLARIFICATION_SCHEMA, mode) };
    }
    return { present: true, valid: true, issues: [], output };
}
//# sourceMappingURL=clarification.js.map