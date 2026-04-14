import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { VERSION, makeEnvelope } from '../lib/json-output.js';
import type { OutputFormat } from '../lib/json-output.js';

export interface DetectData {
  cli: {
    version: string;
    node_version: string;
  };
  project: {
    name: string;
    locale: string;
    lifecycle: string;
    description: string;
    source_roots: { src: string[]; test: string[] } | null;
  } | null;
}

export function collectDetectData(root: string): DetectData {
  const configPath = join(root, 'logos', 'logos.config.json');

  let project: DetectData['project'] = null;
  if (existsSync(configPath)) {
    try {
      const config = JSON.parse(readFileSync(configPath, 'utf-8'));
      project = {
        name: config.name ?? '',
        locale: config.locale ?? 'en',
        lifecycle: config.lifecycle ?? 'initial',
        description: config.description ?? '',
        source_roots: config.sourceRoots ?? null,
      };
    } catch { /* ignore malformed config */ }
  }

  return {
    cli: {
      version: VERSION,
      node_version: process.version,
    },
    project,
  };
}

export function detect(format: OutputFormat = 'text') {
  const root = process.cwd();
  const data = collectDetectData(root);

  if (format === 'json') {
    console.log(JSON.stringify(makeEnvelope('detect', data)));
    return;
  }

  // Human-readable output
  console.log(`\nOpenLogos CLI v${data.cli.version}`);
  console.log(`Node.js ${data.cli.node_version}\n`);

  if (data.project) {
    console.log(`📁 Project detected:`);
    console.log(`   Name:        ${data.project.name}`);
    console.log(`   Locale:      ${data.project.locale}`);
    console.log(`   Lifecycle:   ${data.project.lifecycle}`);
    if (data.project.description) {
      console.log(`   Description: ${data.project.description}`);
    }
    if (data.project.source_roots) {
      console.log(`   Source roots: src=${data.project.source_roots.src.join(',')} test=${data.project.source_roots.test.join(',')}`);
    }
  } else {
    console.log(`📁 No OpenLogos project found in current directory.`);
  }
  console.log('');
}
