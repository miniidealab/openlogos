#!/usr/bin/env node

import { init } from './commands/init.js';
import { sync } from './commands/sync.js';
import { status } from './commands/status.js';
import { change } from './commands/change.js';
import { merge } from './commands/merge.js';
import { archive } from './commands/archive.js';
import { verify } from './commands/verify.js';
import { launch } from './commands/launch.js';

const HELP = `
openlogos - CLI tool for the OpenLogos methodology

Usage:
  openlogos <command> [options]

Commands:
  init [name]        Initialize a new OpenLogos project structure
                       --locale <en|zh>            Set language (skip prompt)
                       --ai-tool <claude-code|opencode|cursor|other>  Set AI tool (skip prompt)
  sync               Regenerate AI instruction files (AGENTS.md, CLAUDE.md)
  status             Show current project phase and suggest next steps
  verify             Verify test results against test case specs
  launch             Activate change management after first development cycle
  change <slug>      Create a change proposal for iterative updates
  merge <slug>       Generate MERGE_PROMPT.md for AI to execute delta merging
  archive <slug>     Archive a completed change proposal

Options:
  --help, -h         Show this help message
  --version, -v      Show version number

Examples:
  openlogos init my-saas-project
  openlogos sync
  openlogos status
  openlogos verify
  openlogos change add-remember-me
  openlogos merge add-remember-me
  openlogos archive add-remember-me

Learn more: https://openlogos.ai
`;

const VERSION = '0.5.6';

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(HELP);
    process.exit(0);
  }

  if (args.includes('--version') || args.includes('-v')) {
    console.log(VERSION);
    process.exit(0);
  }

  const command = args[0];

  switch (command) {
    case 'init': {
      const initArgs = args.slice(1);
      let initName: string | undefined;
      const initOpts: { locale?: string; aiTool?: string } = {};
      for (let i = 0; i < initArgs.length; i++) {
        if (initArgs[i] === '--locale' && initArgs[i + 1]) {
          initOpts.locale = initArgs[++i];
        } else if (initArgs[i] === '--ai-tool' && initArgs[i + 1]) {
          initOpts.aiTool = initArgs[++i];
        } else if (!initArgs[i].startsWith('--')) {
          initName = initArgs[i];
        }
      }
      await init(initName, Object.keys(initOpts).length > 0 ? initOpts : undefined);
      break;
    }
    case 'sync':
      sync();
      break;
    case 'status':
      status();
      break;
    case 'verify':
      verify();
      break;
    case 'change':
      change(args[1]);
      break;
    case 'merge':
      merge(args[1]);
      break;
    case 'launch':
      launch();
      break;
    case 'archive':
      archive(args[1]);
      break;
    default:
      console.error(`Unknown command: ${command}`);
      console.log(HELP);
      process.exit(1);
  }
}

main();
