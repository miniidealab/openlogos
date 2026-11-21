/**
 * `openlogos knowledge <apply|index|check>`（knowledge-direct-intake，功能规格 §2.103.2；JSON 契约见
 * `spec/cli-json-output.md`「`openlogos knowledge` 命令组」）。
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { makeEnvelope, type OutputFormat } from '../lib/json-output.js';
import { runKnowledgeApply, runKnowledgeCheck, runKnowledgeIndex, type KnowledgeIssue } from '../lib/knowledge-apply.js';
import { runKnowledgeList, runKnowledgeRefs, runKnowledgeShow } from '../lib/knowledge-lookup.js';

const USAGE = [
  'Usage:',
  '  openlogos knowledge apply <候选目录> [--init-tags] [--format json]',
  '  openlogos knowledge apply --init-tags [--format json]',
  '  openlogos knowledge apply --recover [--format json]',
  '  openlogos knowledge index [--format json]',
  '  openlogos knowledge check [--format json]',
  '  openlogos knowledge list [--module <m>] [--tag <t>] [--format json]',
  '  openlogos knowledge show <KXX> [--format json]',
  '  openlogos knowledge refs <KXX|KXX-Rn> [--format json]',
].join('\n');

function printIssues(title: string, list: KnowledgeIssue[], write: (line: string) => void): void {
  if (list.length === 0) return;
  write(title);
  for (const i of list) {
    write(`  - [${i.code}] ${i.path ?? '（无具体文件）'}：${i.message}`);
    if (i.fix_hint) write(`      修复：${i.fix_hint}`);
  }
}

export function knowledgeCommand(args: string[], format: OutputFormat = 'text'): void {
  const json = format === 'json';
  const root = process.cwd();
  const sub = args[0];
  const rest = args.slice(1).filter(a => a !== '--format' && a !== 'json');
  if (!existsSync(join(root, 'logos', 'logos.config.json'))) {
    console.error('Error: logos/logos.config.json not found. 请在项目根执行 openlogos knowledge。');
    process.exit(2);
  }
  if (sub === 'apply') {
    const initTags = rest.includes('--init-tags');
    const recover = rest.includes('--recover');
    const positional = rest.filter(a => !a.startsWith('--'));
    const unknownFlag = rest.find(a => a.startsWith('--') && a !== '--init-tags' && a !== '--recover');
    if (unknownFlag || positional.length > 1 || (recover && (initTags || positional.length > 0))) {
      console.error(`Error: 参数不合法${unknownFlag ? `：${unknownFlag}` : ''}\n${USAGE}`);
      process.exit(2);
    }
    const report = runKnowledgeApply(root, { candidateDir: positional[0] ?? null, initTags, recover });
    const { exitCode, ...data } = report;
    if (json) {
      console.log(JSON.stringify(makeEnvelope('knowledge apply', data)));
    } else {
      const label: Record<string, string> = {
        applied: '✓ 已录入', rejected: '✗ 录入被拒绝（未写入任何文件）', unchanged: '✓ 无变化', write_failed: '✗ 写入失败', recovered: '✓ 已恢复上一次中断的录入事务',
      };
      console.log(label[report.result] ?? report.result);
      for (const w of report.written) console.log(`  → ${w}`);
      console.log(`  标签表：${report.tag_state_before} → ${report.tag_state_after}`);
      if (report.result === 'write_failed') console.log(`  回滚：${report.rolled_back ? '已整批回滚' : '未完成（运行 openlogos knowledge apply --recover）'}`);
      printIssues('错误：', report.errors, l => console.error(l));
      printIssues('提示：', report.warnings, l => console.log(l));
    }
    if (exitCode !== 0) process.exit(exitCode);
    return;
  }
  if (sub === 'index') {
    const report = runKnowledgeIndex(root);
    const { exitCode, ...data } = report;
    if (json) console.log(JSON.stringify(makeEnvelope('knowledge index', data)));
    else {
      console.log(report.result === 'written' ? `✓ 已生成 ${report.path}（${report.entries} 个条目）` : report.result === 'unchanged' ? `✓ ${report.path} 已是最新` : `✗ 未生成 ${report.path}`);
      printIssues('错误：', report.errors, l => console.error(l));
    }
    if (exitCode !== 0) process.exit(exitCode);
    return;
  }
  if (sub === 'check') {
    const result = runKnowledgeCheck(root);
    if ('busy' in result) return lookupFail('knowledge check', result.errors, 1, json);
    const report = result;
    const { exitCode, ...data } = report;
    if (json) console.log(JSON.stringify(makeEnvelope('knowledge check', data)));
    else {
      console.log(`企业知识：${report.entries} 个条目；标签表 ${report.tag_state}；HEAD 辅助比较 ${report.head_compare === 'ok' ? '已执行' : '不可用（非 git 项目）'}`);
      printIssues('错误：', report.errors, l => console.log(l));
      printIssues('提示：', report.warnings, l => console.log(l));
      if (report.errors.length === 0) console.log('✓ 知识检查通过');
    }
    if (exitCode !== 0) process.exit(exitCode);
    return;
  }
  if (sub === 'list') {
    const opt = (name: string): string | null | undefined => {
      const i = rest.indexOf(name);
      if (i < 0) return null;
      const v = rest[i + 1];
      return v === undefined || v.startsWith('--') ? undefined : v;
    };
    const module = opt('--module');
    const tag = opt('--tag');
    if (module === undefined || tag === undefined) {
      console.error(`Error: --module / --tag 缺少取值\n${USAGE}`);
      process.exit(2);
    }
    const r = runKnowledgeList(root, { module, tag });
    if (!r.ok) return lookupFail('knowledge list', r.errors, r.exitCode, json);
    if (json) console.log(JSON.stringify(makeEnvelope('knowledge list', r.data)));
    else {
      console.log(`企业知识（标签表 ${r.data.tag_state}）：${r.data.entries.length} 条`);
      for (const e of r.data.entries) {
        console.log(`  ${e.id ?? '—'}  ${e.title ?? '—'}  [${String(e.scope)}${e.module ? `/${String(e.module)}` : ''}] tags=${e.tags.join('、')} status=${String(e.status)}${e.valid ? '' : ' 无效'}${e.origin === 'delta' ? ' （本提案 delta）' : ''}`);
      }
    }
    return;
  }
  if (sub === 'show' || sub === 'refs') {
    const positional = rest.filter(a => !a.startsWith('--'));
    if (positional.length !== 1) {
      console.error(`Error: 需要一个编号参数\n${USAGE}`);
      process.exit(2);
    }
    if (sub === 'show') {
      const r = runKnowledgeShow(root, positional[0]);
      if (!r.ok) return lookupFail('knowledge show', r.errors, r.exitCode, json);
      if (json) console.log(JSON.stringify(makeEnvelope('knowledge show', r.data)));
      else console.log(r.data.content);
      return;
    }
    const r = runKnowledgeRefs(root, positional[0]);
    if (!r.ok) return lookupFail('knowledge refs', r.errors, r.exitCode, json);
    if (json) console.log(JSON.stringify(makeEnvelope('knowledge refs', r.data)));
    else {
      console.log(`${r.data.query}（${r.data.target_status}）被 ${r.data.refs.length} 处引用`);
      for (const x of r.data.refs) console.log(`  ${x.scenario_path}:${x.line}  ${x.ref}（${x.level === 'rule' ? '规则级' : '条目级'}）  作用位置：${x.location}  例外：${x.exception}${x.origin === 'delta' ? ' （本提案 delta）' : ''}`);
    }
    return;
  }
  console.error(`Error: 未知子命令 ${sub ?? '（空）'}\n${USAGE}`);
  process.exit(2);
}

function lookupFail(command: string, errors: KnowledgeIssue[], exitCode: 1 | 2, json: boolean): never {
  if (json) console.log(JSON.stringify(makeEnvelope(command, { errors })));
  else printIssues('错误：', errors, l => console.error(l));
  process.exit(exitCode);
}
