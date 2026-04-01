import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DIRECTORIES = [
  'resources/prd/1-product-requirements',
  'resources/prd/2-product-design/1-feature-specs',
  'resources/prd/2-product-design/2-page-design',
  'resources/prd/3-technical-plan/1-architecture',
  'resources/prd/3-technical-plan/2-scenario-implementation',
  'resources/api',
  'resources/database',
  'resources/scenario',
  'changes',
];

function createLogosConfig(name: string): string {
  return JSON.stringify({
    name,
    description: '',
    documents: {
      prd: {
        label: { en: 'Product Docs', zh: '产品文档' },
        path: './resources/prd',
        pattern: '**/*.{md,html,htm,pdf}',
      },
      api: {
        label: { en: 'API Docs', zh: 'API 文档' },
        path: './resources/api',
        pattern: '**/*.{yaml,yml,json}',
      },
      scenario: {
        label: { en: 'Scenarios', zh: '业务场景' },
        path: './resources/scenario',
        pattern: '**/*.json',
      },
      database: {
        label: { en: 'Database', zh: '数据库' },
        path: './resources/database',
        pattern: '**/*.sql',
      },
    },
  }, null, 2);
}

function createLogosProject(name: string): string {
  return `project:
  name: "${name}"
  description: ""
  methodology: "OpenLogos"

tech_stack: {}

resource_index: []

conventions:
  - "遵循 OpenLogos 三层推进模型（Why → What → How）"
  - "每次变更必须先创建 changes/ 变更提案"
`;
}

function createAgentsMd(name: string): string {
  return `# AI Assistant Instructions

This project follows the **OpenLogos** methodology.
Read \`logos-project.yaml\` first to understand the project resource index.

## Project Context
- Config: \`logos.config.json\`
- Resource Index: \`logos-project.yaml\`

## Methodology Rules
1. Never write code without first completing the design documents
2. Follow the Why → What → How progression
3. All API designs must originate from scenario sequence diagrams
4. All code changes must have corresponding API orchestration tests
5. Use the Delta change workflow for iterations (see changes/ directory)

## Conventions
- 遵循 OpenLogos 三层推进模型（Why → What → How）
- 每次变更必须先创建 changes/ 变更提案
`;
}

export function init(name?: string) {
  const projectName = name || 'my-project';
  const root = process.cwd();

  if (existsSync(join(root, 'logos.config.json'))) {
    console.error('Error: logos.config.json already exists in current directory.');
    console.error('This directory has already been initialized as an OpenLogos project.');
    process.exit(1);
  }

  console.log(`\nCreating OpenLogos project structure...\n`);

  for (const dir of DIRECTORIES) {
    const fullPath = join(root, dir);
    mkdirSync(fullPath, { recursive: true });
    writeFileSync(join(fullPath, '.gitkeep'), '');
    console.log(`  ✓ ${dir}/`);
  }

  writeFileSync(join(root, 'logos.config.json'), createLogosConfig(projectName));
  console.log(`  ✓ logos.config.json`);

  writeFileSync(join(root, 'logos-project.yaml'), createLogosProject(projectName));
  console.log(`  ✓ logos-project.yaml`);

  writeFileSync(join(root, 'AGENTS.md'), createAgentsMd(projectName));
  console.log(`  ✓ AGENTS.md`);

  writeFileSync(join(root, 'CLAUDE.md'), createAgentsMd(projectName));
  console.log(`  ✓ CLAUDE.md`);

  console.log(`
Project initialized. Next steps:
  1. Edit logos.config.json to configure your project
  2. Start with Phase 1: write your requirements document
  3. Run \`openlogos check\` to verify progress
`);
}
