import { authorityScan } from './markdown-scan.js';
export const PLAN_PACKAGE_SCHEMA = 'openlogos/plan-package-evaluation@1';
export const PLAN_PACKAGE_CONTRACT_VERSION = '1';
export const PLAN_PACKAGE_CLI_CONTRACT_VERSION = '1.3.0';
export const PLAN_SECTION_REGISTRY = {
    reason: { zh: '变更原因', en: 'Reason' },
    type: { zh: '变更类型', en: 'Change Type' },
    scope: { zh: '变更范围', en: 'Scope' },
    deployment: { zh: '部署影响', en: 'Deployment Impact' },
    summary: { zh: '变更概述', en: 'Summary' },
    clarification: { zh: '决策澄清', en: 'Decision Clarification' },
};
const SECTION_ORDER = Object.keys(PLAN_SECTION_REGISTRY);
const ISSUE_ORDER = [
    'proposal_required_section_missing', 'proposal_required_section_duplicate',
    'proposal_required_section_empty', 'proposal_placeholder_remaining',
    'proposal_change_type_invalid', 'proposal_deployment_fields_invalid',
    'proposal_clarification_invalid', 'tasks_template_remaining',
    'tasks_code_entry_before_spec_complete', 'tasks_code_section_missing',
    'tasks_deployment_conflict',
];
export function detectPlanLocale(content) {
    return /^##\s+(?:Reason|Change Type|Scope|Deployment Impact|Summary|Decision Clarification)\s*$/m.test(content)
        ? 'en' : 'zh';
}
function meaningfulSectionBody(content) {
    return content.replace(/<!--[^]*?-->/g, '').trim();
}
function hasPlaceholder(content) {
    return /\[(?:为什么要做这个变更|需求级\s*\/|列表|用\s*1-3\s*段话概述|Why is this change needed|Requirements\s*\/|list\]|Describe what will change)/i.test(content);
}
function scanSections(content) {
    const lines = content.replace(/\r\n/g, '\n').split('\n');
    const scan = authorityScan(lines);
    const headings = [];
    for (let i = 0; i < lines.length; i++) {
        if (scan.masked[i])
            continue;
        const match = /^ {0,3}##[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/.exec(scan.text[i]);
        if (match)
            headings.push({ line: i, title: match[1].trim() });
    }
    const result = [];
    for (let index = 0; index < headings.length; index++) {
        const heading = headings[index];
        const id = SECTION_ORDER.find(key => Object.values(PLAN_SECTION_REGISTRY[key]).some(title => title === heading.title));
        if (!id)
            continue;
        const end = headings[index + 1]?.line ?? lines.length;
        result.push({ id, title: heading.title, line: heading.line + 1, content: lines.slice(heading.line + 1, end).join('\n') });
    }
    return result;
}
function issue(code, path, message, fixHint, extra = {}) {
    return { code, path, message, fix_hint: fixHint, ...extra };
}
function deploymentFieldsValid(content, locale) {
    const fields = locale === 'zh'
        ? ['是否需要部署', '部署原因', '影响环境', '是否涉及数据迁移', '是否需要回滚预案', '是否需要 smoke']
        : ['Deployment required', 'Deployment reason', 'Affected environments', 'Data migration involved', 'Rollback plan required', 'Smoke required'];
    const values = new Map();
    for (const field of fields) {
        const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        values.set(field, [...content.matchAll(new RegExp(`^-\\s*${escaped}\\s*[:：]\\s*(.*)$`, 'gmi'))].map(row => row[1].trim()));
    }
    if (fields.some(field => values.get(field)?.length !== 1 || !values.get(field)?.[0]))
        return false;
    const booleanFields = [fields[0], fields[3], fields[4], fields[5]];
    return booleanFields.every(field => locale === 'zh'
        ? /^(?:是|否)(?:$|\s*[(（；;])/.test(values.get(field)[0])
        : /^(?:yes|no)(?:$|\s*[(;])/i.test(values.get(field)[0]));
}
export function evaluateProposalStructure(content, path = 'proposal.md', locale = detectPlanLocale(content)) {
    const sections = scanSections(content);
    const issues = [];
    for (const id of SECTION_ORDER) {
        const expected = PLAN_SECTION_REGISTRY[id][locale];
        const found = sections.filter(section => section.id === id && section.title === expected);
        if (found.length === 0) {
            issues.push(issue('proposal_required_section_missing', path, `缺少 canonical 章节：${expected}`, `补充且仅保留一个 \`## ${expected}\` 章节。`, { section_id: id, expected }));
            continue;
        }
        if (found.length > 1) {
            issues.push(issue('proposal_required_section_duplicate', path, `canonical 章节重复：${expected}`, `合并重复内容，仅保留一个 \`## ${expected}\`。`, { section_id: id, line: found[1].line, actual: String(found.length), expected: '1' }));
            continue;
        }
        const section = found[0];
        const body = meaningfulSectionBody(section.content);
        if (!body) {
            issues.push(issue('proposal_required_section_empty', path, `canonical 章节为空：${expected}`, `在 \`## ${expected}\` 下填入真实内容。`, { section_id: id, line: section.line, expected }));
        }
        else if (hasPlaceholder(section.content)) {
            issues.push(issue('proposal_placeholder_remaining', path, `canonical 章节仍含模板占位：${expected}`, '用真实提案内容替换方括号占位文本。', { section_id: id, line: section.line, actual: body.slice(0, 160), expected: '无占位符的真实内容' }));
        }
    }
    const typeSection = sections.find(section => section.id === 'type');
    if (typeSection && meaningfulSectionBody(typeSection.content) && !hasPlaceholder(typeSection.content)) {
        const valid = locale === 'zh' ? /(?:需求级|设计级|接口级|代码级)/.test(typeSection.content)
            : /(?:requirements?|design|interface|code)(?:\s+level)?/i.test(typeSection.content);
        if (!valid)
            issues.push(issue('proposal_change_type_invalid', path, '变更类型不在允许集合中。', '使用需求级/设计级/接口级/代码级（或英文等价值）。', { section_id: 'type', line: typeSection.line, actual: meaningfulSectionBody(typeSection.content), expected: 'requirements|design|interface|code' }));
    }
    const deployment = sections.find(section => section.id === 'deployment');
    if (deployment && meaningfulSectionBody(deployment.content) && !hasPlaceholder(deployment.content) && !deploymentFieldsValid(deployment.content, locale)) {
        issues.push(issue('proposal_deployment_fields_invalid', path, '部署影响字段缺失、重复或布尔值非法。', '按 canonical scaffold 补齐六个部署字段，布尔值使用是/否或 yes/no。', { section_id: 'deployment', line: deployment.line, expected: '六个唯一且合法的部署字段' }));
    }
    return sortCompletionIssues(issues);
}
export function sortCompletionIssues(issues) {
    const unique = new Map();
    for (const item of issues) {
        const key = [item.code, item.path, item.section_id ?? '', item.line ?? 0, item.actual ?? '', item.expected ?? ''].join('\0');
        if (!unique.has(key))
            unique.set(key, item);
    }
    return [...unique.values()].sort((left, right) => ISSUE_ORDER.indexOf(left.code) - ISSUE_ORDER.indexOf(right.code)
        || left.path.localeCompare(right.path) || (left.line ?? 0) - (right.line ?? 0)
        || (left.section_id ?? '').localeCompare(right.section_id ?? '') || left.code.localeCompare(right.code));
}
//# sourceMappingURL=plan-package-contract.js.map