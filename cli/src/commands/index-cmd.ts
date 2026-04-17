import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { readLocale } from '../i18n.js';

// ---------------------------------------------------------------------------
// 文件扫描工具
// ---------------------------------------------------------------------------

function listFilesRecursive(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const results: string[] = [];
  function scan(current: string) {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      try {
        const stat = statSync(full);
        if (stat.isDirectory()) {
          scan(full);
        } else if (stat.isFile() && !entry.endsWith('.gitkeep')) {
          results.push(full);
        }
      } catch { /* skip inaccessible */ }
    }
  }
  scan(dir);
  return results;
}

/** 从 glob 模式中提取允许的扩展名集合，例如 "**\/*.{md,json}" → ["md","json"] */
function extractExtensions(pattern: string): Set<string> {
  const braceMatch = pattern.match(/\*\.\{([^}]+)\}$/);
  if (braceMatch) {
    return new Set(braceMatch[1].split(',').map(e => e.trim()));
  }
  const singleMatch = pattern.match(/\*\.(\w+)$/);
  if (singleMatch) {
    return new Set([singleMatch[1]]);
  }
  return new Set();
}

function matchesPattern(filePath: string, pattern: string): boolean {
  const ext = extname(filePath).slice(1).toLowerCase();
  const allowed = extractExtensions(pattern);
  return allowed.size === 0 || allowed.has(ext);
}

// ---------------------------------------------------------------------------
// 文件内容读取（前 N 行）
// ---------------------------------------------------------------------------

function readFirstNLines(filePath: string, n: number): string {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const truncated = lines.slice(0, n);
    const suffix = lines.length > n ? `\n... (truncated, ${lines.length - n} more lines)` : '';
    return truncated.join('\n') + suffix;
  } catch {
    return '(unable to read file)';
  }
}

// ---------------------------------------------------------------------------
// 主命令
// ---------------------------------------------------------------------------

interface FileEntry {
  relPath: string;
  content: string;
}

export function indexCommand() {
  const root = process.cwd();
  const configPath = join(root, 'logos', 'logos.config.json');

  if (!existsSync(configPath)) {
    console.error('Error: logos/logos.config.json not found.');
    console.error('Run `openlogos init` first to initialize the project.');
    process.exit(1);
  }

  const yamlPath = join(root, 'logos', 'logos-project.yaml');
  if (!existsSync(yamlPath)) {
    console.error('Error: logos/logos-project.yaml not found.');
    process.exit(1);
  }

  console.log('\nScanning project files for index generation...\n');

  const config = JSON.parse(readFileSync(configPath, 'utf-8'));
  const documents: Record<string, { path: string; pattern: string }> = config.documents || {};
  const locale = readLocale(root);

  const files: FileEntry[] = [];

  // 1. 扫描 logos.config.json 中的 documents（排除 changes）
  for (const [key, doc] of Object.entries(documents)) {
    if (key === 'changes') continue;

    // path 是相对于 logos/ 目录的，如 "./resources/prd"
    const absDir = join(root, 'logos', doc.path.replace(/^\.\//, ''));
    const allFiles = listFilesRecursive(absDir);

    for (const absFile of allFiles) {
      if (!matchesPattern(absFile, doc.pattern)) continue;
      const relPath = relative(root, absFile).replace(/\\/g, '/');
      const content = readFirstNLines(absFile, 80);
      files.push({ relPath, content });
    }
  }

  // 2. 扫描 spec/ 目录（.md 和 .json）
  const specDir = join(root, 'spec');
  for (const absFile of listFilesRecursive(specDir)) {
    const ext = extname(absFile).slice(1).toLowerCase();
    if (ext !== 'md' && ext !== 'json') continue;
    const relPath = relative(root, absFile).replace(/\\/g, '/');
    const content = readFirstNLines(absFile, 80);
    files.push({ relPath, content });
  }

  // 3. 扫描 skills/*/SKILL.md
  const skillsDir = join(root, 'skills');
  if (existsSync(skillsDir)) {
    for (const entry of readdirSync(skillsDir)) {
      const skillMd = join(skillsDir, entry, 'SKILL.md');
      if (existsSync(skillMd) && statSync(skillMd).isFile()) {
        const relPath = `skills/${entry}/SKILL.md`;
        const content = readFirstNLines(skillMd, 80);
        files.push({ relPath, content });
      }
    }
  }

  if (files.length === 0) {
    console.log('No files found to index. Make sure project documents exist in logos/resources/.\n');
    return;
  }

  console.log(`  Found ${files.length} files to index.`);

  // 读取当前 logos-project.yaml 全文（供 AI 参考）
  const currentYaml = readFileSync(yamlPath, 'utf-8');

  // 生成 Prompt
  const prompt = buildPrompt(files, currentYaml, locale);
  const promptPath = join(root, 'logos', 'index-prompt.md');
  writeFileSync(promptPath, prompt);

  console.log(`  ✓ Generated: logos/index-prompt.md\n`);
  console.log('Next step:');
  console.log('  Tell your AI assistant: "Read logos/index-prompt.md and execute the instructions"\n');
  console.log('  The AI will read each file\'s content and directly update logos/logos-project.yaml\n');
}

// ---------------------------------------------------------------------------
// Prompt 生成
// ---------------------------------------------------------------------------

function buildPrompt(files: FileEntry[], currentYaml: string, locale: string): string {
  const isZh = locale === 'zh';

  const header = isZh
    ? `# OpenLogos Index 更新任务

## 任务说明

请阅读下方各文件的内容摘要，然后**直接更新** \`logos/logos-project.yaml\` 的 \`resource_index\` 字段。

**规则：**
- 对于 \`resource_index\` 中**已有**的条目：评估 desc 是否足够详细，如可改善则优化
- 对于**未收录**的文件：添加新条目，desc 要详细说明文件内容和 AI 应在何时读取它
- desc 语言：**中文**，长度 30-80 字，说明「文件包含什么」以及「AI 在什么场景下必须读取」
- 格式：\`- path: <相对路径>\\n  desc: <描述>\`

## 当前 logos-project.yaml 内容

\`\`\`yaml
${currentYaml}
\`\`\`

## 待分析的文件（共 ${files.length} 个）

`
    : `# OpenLogos Index Update Task

## Instructions

Read the file content summaries below, then **directly update** \`logos/logos-project.yaml\`'s \`resource_index\` field.

**Rules:**
- For entries **already in** \`resource_index\`: evaluate if desc is detailed enough; improve if possible
- For **missing** files: add new entries with detailed desc explaining what the file contains and when AI should read it
- desc language: **English**, 30-80 words, covering "what the file contains" and "when AI must read it"
- Format: \`- path: <relative-path>\\n  desc: <description>\`

## Current logos-project.yaml

\`\`\`yaml
${currentYaml}
\`\`\`

## Files to Analyze (${files.length} total)

`;

  let body = '';
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    body += `### ${i + 1}. \`${f.relPath}\`\n\n`;
    body += '```\n';
    body += f.content;
    body += '\n```\n\n';
  }

  const footer = isZh
    ? `## 执行要求

1. 逐个分析上方每个文件的内容
2. 为每个文件生成或优化 desc（中文，30-80 字）
3. **直接修改** \`logos/logos-project.yaml\` 的 \`resource_index\` 字段
4. 保持 YAML 格式正确（缩进 2 空格）
5. 完成后报告：新增 N 条，优化 M 条，跳过 K 条
`
    : `## Execution Requirements

1. Analyze each file's content above
2. Generate or improve desc for each file (English, 30-80 words)
3. **Directly edit** \`logos/logos-project.yaml\`'s \`resource_index\` field
4. Maintain correct YAML format (2-space indent)
5. After completion, report: added N, improved M, skipped K
`;

  return header + body + footer;
}
