/**
 * `openlogos flow show [--resolved] [--lifecycle <initial|launched>] [--format json]`
 *
 * 只读查看研发流程编排：默认内置 raw flow；--resolved 叠加项目 overlay。
 * 切片 A：不接入 status / next 派生（零行为变更）。规范见 spec/cli-json-output.md §9。
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { makeEnvelope, makeErrorEnvelope } from '../lib/json-output.js';
import type { OutputFormat } from '../lib/json-output.js';
import { readLocale, t } from '../i18n.js';
import { loadFlow, FlowError } from '../lib/flow.js';
import type { Flow, FlowNode, FlowWarning, LoadFlowResult } from '../lib/flow.js';

export interface FlowShowOptions {
  resolved?: boolean;
  lifecycle?: string;
}

/** 归一化 node：补全 resolved 输出字段 skipped/overlay_op 的默认值。 */
function normalizeNode(node: FlowNode): FlowNode {
  return { ...node, skipped: node.skipped ?? false, overlay_op: node.overlay_op ?? null };
}

function normalizeFlow(flow: Flow): Flow {
  return {
    ...flow,
    extends: flow.extends ?? null,
    subflows: flow.subflows.map(s => ({ ...s, nodes: s.nodes.map(normalizeNode) })),
  };
}

function renderText(result: LoadFlowResult, locale: ReturnType<typeof readLocale>): string[] {
  const lines: string[] = [];
  const tag = result.resolved
    ? (result.overlay_applied ? t(locale, 'flow.resolvedApplied') : t(locale, 'flow.resolvedNoOverlay'))
    : t(locale, 'flow.rawBuiltin', { version: result.builtin_version });
  lines.push('');
  lines.push(`Flow: ${result.lifecycle}（${tag}）`);

  for (const w of result.warnings) {
    lines.push(`  ⚠ ${w.code}: ${w.message}`);
  }
  lines.push('');

  for (const sub of result.flow.subflows) {
    const g = sub.gate;
    let gateLabel = 'gate: none';
    if (g && g.type === 'human') {
      const pos = g.position === 'entry' ? ' · entry' : '';
      const sk = g.skippable ? ' (skippable)' : ` (${t(locale, 'flow.notSkippable')})`;
      gateLabel = `gate: human${pos}${sk}`;
    } else if (g && g.type === 'cmd') {
      gateLabel = 'gate: cmd';
    }
    lines.push(`▸ ${sub.name}    ${gateLabel}`);
    for (const node of sub.nodes) {
      const attrs: string[] = [];
      if (node.skill) attrs.push(`skill: ${node.skill}`);
      if (node.for_each) attrs.push(`for_each: ${node.for_each}`);
      if (node.when) attrs.push(`when: ${node.when}`);
      const opMark = node.overlay_op ? `  [${node.overlay_op}]` : '';
      const skipMark = node.skipped ? '  (skipped)' : '';
      const bullet = node.skipped ? '-' : '·';
      lines.push(`    ${bullet} ${node.id.padEnd(20)} ${node.name.padEnd(8)} ${attrs.join('  ')}${skipMark}${opMark}`);
    }
  }
  lines.push('');
  if (!result.resolved) lines.push(t(locale, 'flow.resolvedHint'));
  return lines;
}

export function flowShow(format: OutputFormat = 'text', opts: FlowShowOptions = {}): void {
  const root = process.cwd();
  const locale = readLocale(root);

  if (!existsSync(join(root, 'logos', 'logos.config.json'))) {
    const code = 'PROJECT_NOT_INITIALIZED';
    const msg = 'logos/logos.config.json not found.';
    if (format === 'json') {
      console.error(JSON.stringify(makeErrorEnvelope('flow show', code, msg)));
    } else {
      console.error(`Error: ${msg}`);
      console.error('Run `openlogos init` first to initialize the project.');
    }
    process.exit(1);
  }

  let result: LoadFlowResult;
  try {
    result = loadFlow(root, { resolved: opts.resolved, lifecycle: opts.lifecycle as never });
  } catch (e) {
    if (e instanceof FlowError) {
      if (format === 'json') {
        console.error(JSON.stringify(makeErrorEnvelope('flow show', e.code, e.message)));
      } else {
        console.error(`Error [${e.code}]: ${e.message}`);
      }
      process.exit(1);
      return;
    }
    throw e;
  }

  if (format === 'json') {
    const data = {
      lifecycle: result.lifecycle,
      resolved: result.resolved,
      overlay_applied: result.overlay_applied,
      builtin_version: result.builtin_version,
      warnings: result.warnings as FlowWarning[],
      flow: normalizeFlow(result.flow),
    };
    console.log(JSON.stringify(makeEnvelope('flow show', data)));
    return;
  }

  console.log(renderText(result, locale).join('\n'));
}
