#!/usr/bin/env node

import { parseArgs } from 'node:util';
import { init } from './commands/init.js';
import { sync } from './commands/sync.js';

const HELP = `
openlogos - CLI tool for the OpenLogos methodology

Usage:
  openlogos <command> [options]

Commands:
  init [name]     Initialize a new OpenLogos project structure
  sync            Regenerate AI instruction files (AGENTS.md, CLAUDE.md)

Options:
  --help, -h      Show this help message
  --version, -v   Show version number

Examples:
  openlogos init my-saas-project
  openlogos sync

Learn more: https://openlogos.ai
`;

const VERSION = '0.1.0';

function main() {
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
    case 'init':
      init(args[1]);
      break;
    case 'sync':
      sync();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      console.log(HELP);
      process.exit(1);
  }
}

main();
