#!/usr/bin/env node

import { init } from './commands/init.js';
import { adopt } from './commands/adopt.js';
import { sync } from './commands/sync.js';
import { status } from './commands/status.js';
import { next } from './commands/next.js';
import { change } from './commands/change.js';
import { merge } from './commands/merge.js';
import { archive } from './commands/archive.js';
import { verify } from './commands/verify.js';
import { smoke } from './commands/smoke.js';
import { deployDone } from './commands/deploy-done.js';
import { launch } from './commands/launch.js';
import { detect } from './commands/detect.js';
import { indexCommand } from './commands/index-cmd.js';
import { moduleList, moduleAdd, moduleRename, moduleRemove } from './commands/module.js';
import { flowShow } from './commands/flow.js';
import { watch } from './commands/watch.js';
import { VERSION, parseFormat } from './lib/json-output.js';

export { VERSION } from './lib/json-output.js';
export type { OutputFormat } from './lib/json-output.js';
export type {
  VerifyData,
  VerifyPreRunCommandResult,
  VerifyPreRunData,
  VerifyPreRunMode,
  VerifyPreRunStage,
} from './commands/verify.js';
export type {
  NormalizedVerifyConfig,
  VerifyConfig,
  VerifyPreRunBackfillResult,
} from './lib/verify-config.js';

const HELP = `
openlogos - CLI tool for the OpenLogos methodology

Usage:
  openlogos <command> [options]

Commands:
  init [name]        Initialize a new OpenLogos project structure
                       --locale <en|zh>            Set language (skip prompt)
                       --ai-tool <claude-code|opencode|codex|cursor|other|all>  Set AI tool (skip prompt)
                       --aitool <claude-code|opencode|codex|cursor|other|all>   Alias for --ai-tool
  adopt [name]       Adopt an existing project into OpenLogos
                       --locale <en|zh>            Set language (skip prompt)
                       --ai-tool <claude-code|opencode|codex|cursor|other|all>  Set AI tool (skip prompt)
                       --aitool <claude-code|opencode|codex|cursor|other|all>   Alias for --ai-tool
  sync               Regenerate AI instruction files (AGENTS.md, CLAUDE.md)
  status             Show current project phase and suggest next steps
                       --module <id>               Filter to a specific module
  next               Show the single most actionable next step
                       --module <id>               Filter to a specific module
                       --auto                       Auto-pass skippable human gates (records GATE_AUTO_PASSED)
  watch              Stream live derived dev-flow status (read-only)
                       --module <id>               Filter to a specific module
                       --interval <seconds>        Polling interval (default: 2)
  verify             Verify test results against test case specs
  smoke              Verify deployed environment against smoke test specs
                       --env <name>                 Target environment label
  deploy-done        Mark the active change deployment as completed
                       --env <name>                 Target environment label
  launch             Activate change management for a module after first development cycle
                       launch [module-id]          Specify module (auto-detects if only one exists)
  change <slug>      Create a change proposal for iterative updates
                       --module <id>               Assign proposal to a specific module
  merge <slug>       Generate MERGE_PROMPT.md for AI to execute delta merging
  archive <slug>     Archive a completed change proposal
  detect             Show CLI version and project detection info
  index              Generate an AI-ready prompt to rebuild resource_index with file-content-based desc
  module <sub>       Manage project modules (list / add <name> / rename <old> <new> / remove <name>)
  flow show          Show the dev-flow orchestration (built-in or overlay-resolved)
                       --resolved                   Apply project logos/flow overlay
                       --lifecycle <initial|launched>  Pick which flow (default: inferred)

Options:
  --help, -h         Show this help message
  --version, -v      Show version number
  --format <json>    Output in JSON format (supported: status, next, watch, verify, smoke, deploy-done, detect, flow show)

Examples:
  openlogos init my-saas-project
  openlogos adopt
  openlogos sync
  openlogos status
  openlogos status --format json
  openlogos verify
  openlogos verify --format json
  openlogos smoke --env staging
  openlogos deploy-done --env staging
  openlogos detect --format json
  openlogos change add-remember-me
  openlogos merge add-remember-me
  openlogos archive add-remember-me

Learn more: https://openlogos.ai
`;

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
  const format = parseFormat(args);

  switch (command) {
    case 'init': {
      const initArgs = args.slice(1);
      let initName: string | undefined;
      const initOpts: { locale?: string; aiTool?: string } = {};
      for (let i = 0; i < initArgs.length; i++) {
        if (initArgs[i] === '--locale' && initArgs[i + 1]) {
          initOpts.locale = initArgs[++i];
        } else if ((initArgs[i] === '--ai-tool' || initArgs[i] === '--aitool') && initArgs[i + 1]) {
          initOpts.aiTool = initArgs[++i];
        } else if (!initArgs[i].startsWith('--')) {
          initName = initArgs[i];
        }
      }
      await init(initName, Object.keys(initOpts).length > 0 ? initOpts : undefined);
      break;
    }
    case 'adopt': {
      const adoptArgs = args.slice(1);
      let adoptName: string | undefined;
      const adoptOpts: { locale?: string; aiTool?: string } = {};
      for (let i = 0; i < adoptArgs.length; i++) {
        if (adoptArgs[i] === '--locale' && adoptArgs[i + 1]) {
          adoptOpts.locale = adoptArgs[++i];
        } else if ((adoptArgs[i] === '--ai-tool' || adoptArgs[i] === '--aitool') && adoptArgs[i + 1]) {
          adoptOpts.aiTool = adoptArgs[++i];
        } else if (!adoptArgs[i].startsWith('--')) {
          adoptName = adoptArgs[i];
        }
      }
      await adopt(adoptName, Object.keys(adoptOpts).length > 0 ? adoptOpts : undefined);
      break;
    }
    case 'sync':
      sync();
      break;
    case 'status': {
      const moduleArg = args.includes('--module') ? args[args.indexOf('--module') + 1] : undefined;
      status(format, moduleArg);
      break;
    }
    case 'next': {
      const moduleArg = args.includes('--module') ? args[args.indexOf('--module') + 1] : undefined;
      await next(format, moduleArg, args.includes('--auto'));
      break;
    }
    case 'watch': {
      const moduleArg = args.includes('--module') ? args[args.indexOf('--module') + 1] : undefined;
      const intervalRaw = args.includes('--interval') ? args[args.indexOf('--interval') + 1] : undefined;
      const interval = intervalRaw !== undefined ? Number(intervalRaw) : undefined;
      watch(format, moduleArg, Number.isFinite(interval) ? interval : undefined);
      break;
    }
    case 'verify':
      verify(format);
      break;
    case 'smoke': {
      const envArg = args.includes('--env') ? args[args.indexOf('--env') + 1] : undefined;
      smoke(format, envArg);
      break;
    }
    case 'deploy-done': {
      const envArg = args.includes('--env') ? args[args.indexOf('--env') + 1] : undefined;
      await deployDone(format, envArg);
      break;
    }
    case 'change': {
      const restArgs = args.slice(1).filter(a => !a.startsWith('--'));
      const moduleArg = args.includes('--module') ? args[args.indexOf('--module') + 1] : undefined;
      change(restArgs[0], moduleArg);
      break;
    }
    case 'merge':
      merge(args[1]);
      break;
    case 'launch':
      launch(args[1]);
      break;
    case 'archive':
      archive(args[1]);
      break;
    case 'detect':
      detect(format);
      break;
    case 'index':
      indexCommand();
      break;
    case 'flow': {
      const sub = args[1];
      if (sub === 'show') {
        const resolved = args.includes('--resolved');
        const lifecycle = args.includes('--lifecycle') ? args[args.indexOf('--lifecycle') + 1] : undefined;
        flowShow(format, { resolved, lifecycle });
      } else {
        console.error(`Unknown flow subcommand: ${sub ?? '(none)'}`);
        console.error('Usage: openlogos flow show [--resolved] [--lifecycle <initial|launched>] [--format json]');
        process.exit(1);
      }
      break;
    }
    case 'module': {
      const sub = args[1];
      switch (sub) {
        case 'list': moduleList(format); break;
        case 'add': moduleAdd(args[2]); break;
        case 'rename': moduleRename(args[2], args[3]); break;
        case 'remove': moduleRemove(args[2]); break;
        default:
          console.error(`Unknown module subcommand: ${sub ?? '(none)'}`);
          console.error('Usage: openlogos module <list|add|rename|remove>');
          process.exit(1);
      }
      break;
    }
    default:
      console.error(`Unknown command: ${command}`);
      console.log(HELP);
      process.exit(1);
  }
}

main();
