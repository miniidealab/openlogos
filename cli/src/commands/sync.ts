import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export function sync() {
  const root = process.cwd();
  const configPath = join(root, 'logos.config.json');

  if (!existsSync(configPath)) {
    console.error('Error: logos.config.json not found.');
    console.error('Run `openlogos init` first to initialize the project.');
    process.exit(1);
  }

  console.log('\nSyncing AI instruction files...\n');

  const config = JSON.parse(readFileSync(configPath, 'utf-8'));
  const projectName = config.name || 'Unnamed Project';

  const content = `# AI Assistant Instructions

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
`;

  writeFileSync(join(root, 'AGENTS.md'), content);
  console.log('  ✓ AGENTS.md updated');

  writeFileSync(join(root, 'CLAUDE.md'), content);
  console.log('  ✓ CLAUDE.md updated');

  console.log('\nSync complete.\n');
}
