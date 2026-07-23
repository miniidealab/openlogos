/**
 * check-ui-prototype — proposal-ui-ux-first 切片1 富对账 checker。
 *
 * 契约见 spec/proposal-ui-ux-first.md §6.2：对活跃提案的 UI/UX 变更声明与实际交付的
 * 原型文件 / design-system 令牌做「声明 ↔ 产出」双向对账，以退出码表达判定
 * （exit 0 = 通过/节点 done；非 0 = 未通过），fail closed。
 *
 * 判定顺序：
 *   1. ui_impact !== true            → exit 0（when 不满足、无需对账）
 *   2. design_system_mode 非法/缺失  → 非 0（fail closed）
 *   3. 声明页清单校验（basename 合法 + 无重复 + 非空）→ 非 0
 *   4. basename 集合对账（声明 == 产出，缺失/额外均非 0）
 *   5. 逐页文件存在且非空            → 非 0
 *   6. 模式分档：
 *        generated → design-system.json 必须存在且非空对象
 *        fallback  → 必须有非空 reason，且 design-system.json 不得存在
 *   7. 全部通过                       → exit 0
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { readUiUxDeclaration, isValidPrototypeBasename } from '../lib/ui-first.js';
import {
  makeEnvelope,
  makeErrorEnvelope,
  type OutputFormat,
} from '../lib/json-output.js';

const COMMAND = 'check-ui-prototype';
const PROTOTYPE_REL = ['deltas', 'prd', '2-product-design', '2-page-design'];

interface ResolvedProposal {
  slug: string;
  proposalDir: string;
}

/**
 * 解析活跃提案目录：
 *   1. slug 显式给出 → logos/changes/<slug>
 *   2. 否则读 logos/.openlogos-guard 的 activeChange
 *   3. 否则若 logos/changes 下恰有一个非 archive 目录 → 用之
 * 无法唯一确定 → null
 */
export function resolveActiveProposal(root: string, slug: string | undefined): ResolvedProposal | null {
  if (slug && slug.trim()) {
    const s = slug.trim();
    return { slug: s, proposalDir: join(root, 'logos', 'changes', s) };
  }
  // guard
  const guardPath = join(root, 'logos', '.openlogos-guard');
  if (existsSync(guardPath)) {
    try {
      const guard = JSON.parse(readFileSync(guardPath, 'utf-8'));
      const active = typeof guard.activeChange === 'string' ? guard.activeChange.trim() : '';
      if (active) return { slug: active, proposalDir: join(root, 'logos', 'changes', active) };
    } catch {
      /* fall through */
    }
  }
  // 单一非 archive 目录
  const changesDir = join(root, 'logos', 'changes');
  if (existsSync(changesDir)) {
    let dirs: string[] = [];
    try {
      dirs = readdirSync(changesDir, { withFileTypes: true })
        .filter(e => e.isDirectory() && e.name !== 'archive')
        .map(e => e.name);
    } catch {
      dirs = [];
    }
    if (dirs.length === 1) {
      return { slug: dirs[0], proposalDir: join(changesDir, dirs[0]) };
    }
  }
  return null;
}

interface CheckOutcome {
  code: number;
  reason: string;
  data?: Record<string, unknown>;
  errorCode?: string;
}

/**
 * 纯判定（无副作用地对账），返回退出码与原因。
 * S35 前置重构④：本函数为**纯 evaluator（只读）**——`UI_PROTOTYPE_HASHES.json` 的写入归
 * 命令 wrapper（writeUiPrototypeHashes，仅 `check-ui-prototype` 命令路径），change-lint L7 只调本函数。
 */
export function evaluateUiPrototype(proposalDir: string): CheckOutcome {
  const decl = readUiUxDeclaration(proposalDir);

  // 1. when 不满足
  if (decl.ui_impact !== true) {
    return { code: 0, reason: 'ui_impact 非 true，UI/UX 对账节点无需执行（when 不满足）。' };
  }

  // 2. design_system_mode 合法性（fail closed）
  const mode = decl.design_system_mode;
  if (mode !== 'generated' && mode !== 'fallback') {
    return {
      code: 1,
      errorCode: 'design_system_mode_invalid',
      reason: `design_system_mode 缺失或非法（得到 ${JSON.stringify(mode)}），期望 generated | fallback。fail closed。`,
    };
  }

  // 3. 声明页清单校验
  const declared = decl.pages.map(p => p.prototype);
  if (declared.length === 0) {
    return {
      code: 1,
      errorCode: 'no_pages_declared',
      reason: 'UI/UX 变更声明未列出任何原型页（pages 为空），无可交付。fail closed。',
    };
  }
  for (const proto of declared) {
    if (!isValidPrototypeBasename(proto)) {
      const protoStr: string = proto;
      const traversal = protoStr.includes('..');
      return {
        code: 1,
        errorCode: traversal ? 'prototype_path_traversal' : 'prototype_basename_invalid',
        reason: traversal
          ? `声明 prototype ${JSON.stringify(protoStr)} 含 '..' 路径穿越，拒绝。`
          : `声明 prototype ${JSON.stringify(protoStr)} 命名非法（期望 core-NN-<slug>.html）。`,
      };
    }
  }
  // basename 去重
  const seen = new Set<string>();
  const dups = new Set<string>();
  for (const proto of declared) {
    if (seen.has(proto)) dups.add(proto);
    seen.add(proto);
  }
  if (dups.size > 0) {
    return {
      code: 1,
      errorCode: 'prototype_basename_duplicate',
      reason: `声明清单存在重复 basename：${[...dups].join(', ')}。`,
    };
  }

  const declaredSet = seen; // 已去重的声明集合

  // 4. basename 集合对账
  const protoDir = join(proposalDir, ...PROTOTYPE_REL);
  let actual: string[] = [];
  if (existsSync(protoDir)) {
    try {
      actual = readdirSync(protoDir, { withFileTypes: true })
        .filter(e => e.isFile() && e.name.endsWith('.html'))
        .map(e => e.name);
    } catch {
      actual = [];
    }
  }
  const actualSet = new Set(actual);

  const missing = [...declaredSet].filter(b => !actualSet.has(b)).sort();
  const extra = [...actualSet].filter(b => !declaredSet.has(b)).sort();
  if (missing.length > 0) {
    return {
      code: 1,
      errorCode: 'prototype_missing',
      reason: `声明的原型未在页面目录产出：${missing.join(', ')}（目录 ${protoDir}）。`,
      data: { missing },
    };
  }
  if (extra.length > 0) {
    return {
      code: 1,
      errorCode: 'prototype_extra',
      reason: `页面目录存在未声明的原型文件：${extra.join(', ')}。`,
      data: { extra },
    };
  }

  // 5. 逐页非空
  const hashes: Record<string, string> = {};
  for (const proto of declaredSet) {
    const filePath = join(protoDir, proto);
    let size = -1;
    try {
      size = statSync(filePath).size;
    } catch {
      size = -1;
    }
    if (size <= 0) {
      return {
        code: 1,
        errorCode: 'prototype_empty',
        reason: `原型文件 ${proto} ${size < 0 ? '不存在' : '为空（0 字节）'}。`,
      };
    }
    try {
      hashes[proto] = createHash('sha256').update(readFileSync(filePath)).digest('hex');
    } catch {
      /* 哈希为可选产物，失败不阻断 */
    }
  }

  // 6. 模式分档
  const tokenPath = join(proposalDir, 'design-system.json');
  if (mode === 'generated') {
    if (!existsSync(tokenPath)) {
      return {
        code: 1,
        errorCode: 'design_system_missing',
        reason: 'design_system_mode=generated 但 design-system.json 不存在。fail closed。',
      };
    }
    let obj: unknown;
    try {
      obj = JSON.parse(readFileSync(tokenPath, 'utf-8'));
    } catch {
      return {
        code: 1,
        errorCode: 'design_system_invalid',
        reason: 'design-system.json 无法解析为 JSON。fail closed。',
      };
    }
    const nonEmptyObject =
      obj !== null && typeof obj === 'object' && !Array.isArray(obj) && Object.keys(obj as object).length > 0;
    if (!nonEmptyObject) {
      return {
        code: 1,
        errorCode: 'design_system_empty',
        reason: 'design-system.json 为空对象或非对象。fail closed。',
      };
    }
  } else {
    // fallback
    const reason = decl.design_system_fallback_reason;
    if (typeof reason !== 'string' || reason.trim().length === 0) {
      return {
        code: 1,
        errorCode: 'fallback_reason_missing',
        reason: 'design_system_mode=fallback 但缺少非空 design_system_fallback_reason。',
      };
    }
    if (existsSync(tokenPath)) {
      return {
        code: 1,
        errorCode: 'fallback_token_forged',
        reason: 'design_system_mode=fallback 但存在 design-system.json（疑似伪造令牌）。fail closed。',
      };
    }
  }

  return {
    code: 0,
    reason: `UI/UX 对账通过（mode=${mode}，${declaredSet.size} 页）。`,
    data: { mode, pages: [...declaredSet], hashes },
  };
}

/**
 * 产物写入 wrapper（S35 前置重构④）：仅当真正完成逐页对账且 outcome 明确携带 hashes 时写清单
 * （code-r1 F9：`ui_impact !== true` 分支无 data → 不写文件，保持改造前既有行为——不产生空哈希文件）。
 * 仅 check-ui-prototype 命令路径调用。
 */
export function writeUiPrototypeHashes(proposalDir: string, outcome: CheckOutcome): void {
  if (outcome.code !== 0) return;
  const hashes = (outcome.data as { hashes?: Record<string, string> } | undefined)?.hashes;
  if (!hashes) return; // when 不满足（无对账数据）→ 与改造前一致：不落文件
  try {
    writeFileSync(join(proposalDir, 'UI_PROTOTYPE_HASHES.json'), JSON.stringify(hashes, null, 2) + '\n');
  } catch {
    /* 非硬要求 */
  }
}

export function checkUiPrototype(slug: string | undefined, format: OutputFormat = 'text'): void {
  const root = process.cwd();
  const resolved = resolveActiveProposal(root, slug);

  if (!resolved) {
    const msg = '无法定位活跃提案：请显式传入 slug，或确保 guard/单一提案目录可解析。';
    if (format === 'json') {
      console.error(JSON.stringify(makeErrorEnvelope(COMMAND, 'no_active_proposal', msg)));
    } else {
      console.error(msg);
    }
    process.exit(1);
    return;
  }

  if (!existsSync(resolved.proposalDir)) {
    const msg = `提案目录不存在：${resolved.proposalDir}`;
    if (format === 'json') {
      console.error(JSON.stringify(makeErrorEnvelope(COMMAND, 'proposal_dir_missing', msg)));
    } else {
      console.error(msg);
    }
    process.exit(1);
    return;
  }

  const outcome = evaluateUiPrototype(resolved.proposalDir);
  writeUiPrototypeHashes(resolved.proposalDir, outcome);

  if (format === 'json') {
    if (outcome.code === 0) {
      console.log(
        JSON.stringify(
          makeEnvelope(COMMAND, {
            slug: resolved.slug,
            status: 'pass',
            reason: outcome.reason,
            ...(outcome.data ?? {}),
          }),
        ),
      );
    } else {
      console.error(
        JSON.stringify(
          makeErrorEnvelope(COMMAND, outcome.errorCode ?? 'ui_prototype_check_failed', outcome.reason),
        ),
      );
    }
  } else {
    if (outcome.code === 0) {
      console.log(`[check-ui-prototype] PASS (${resolved.slug}): ${outcome.reason}`);
    } else {
      console.error(`[check-ui-prototype] FAIL (${resolved.slug}): ${outcome.reason}`);
    }
  }

  process.exit(outcome.code);
}
