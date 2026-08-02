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
import { moduleList, moduleAdd, moduleRename, moduleRemove, moduleSetProductType } from './commands/module.js';
import { featureList } from './commands/feature.js';
import { featureBackfill } from './commands/feature-backfill.js';
import { checkUiPrototype } from './commands/check-ui-prototype.js';
import { changeLint } from './commands/change-lint.js';
import { checkUiHashMatchCommand } from './commands/check-ui-hash-match.js';
import { flowShow } from './commands/flow.js';
import { baselineSeedBegin, baselineSeedCommit, baselineSeedStatus } from './commands/baseline-seed.js';
import { watch } from './commands/watch.js';
import { impact } from './commands/impact.js';
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
  baseline-seed      Commit reverse-engineered baseline seed state (brownfield-adopter)
                       begin  --module <id> --manifest <path>   Freeze logical plan + create staging
                       commit --module <id> --run-id <id>       Validate staged bytes + atomic commit
                       status --module <id>                     Read run/staging progress
  launch             Activate change management for a module after first development cycle
                       launch [module-id]          Specify module (auto-detects if only one exists)
  change <slug>      Create a change proposal for iterative updates
                       --module <id>               Assign proposal to a specific module
  change-lint [--slug <slug>]   检查活跃提案的计划产物（proposal/tasks/deltas）是否交付合格（只读）
  merge <slug>       Generate MERGE_PROMPT.md for AI to execute delta merging
  archive <slug>     Archive a completed change proposal
  detect             Show CLI version and project detection info
  index              Generate an AI-ready prompt to rebuild resource_index with file-content-based desc
  module <sub>       Manage project modules (list / add <name> / rename <old> <new> / remove <name>)
  feature list       List feature groups per module (read-only)
                       --module <id>               Filter to a specific module
  feature-backfill   Generate an AI prompt to backfill feature groups (does not modify yaml)
                       --module <id>               Scope scenarios to a specific module
  flow show          Show the dev-flow orchestration (built-in or overlay-resolved)
                       --resolved                   Apply project logos/flow overlay
                       --lifecycle <initial|launched>  Pick which flow (default: inferred)
  impact             Classify a git change range as lifecycle-only bookkeeping (read-only, for CI)
                       --base <rev> --head <rev>   Git range mode (safe revision resolution)
                       --stdin                      Read \`git diff --no-relative --name-status -z\` bytes from stdin
                       --prefix <dir/>              Project prefix for --stdin mode (monorepo)

Options:
  --help, -h         Show this help message
  --version, -v      Show version number
  --format <json>    Output in JSON format (supported: status, next, watch, verify, smoke, deploy-done, detect, flow show, feature list, feature-backfill, change-lint, impact)

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

/**
 * 取值选项集合：全局 help/version 分派必须位置感知——这些选项的下一个 token 是选项值，
 * 不参与全局 --help/-h/--version/-v 判定。否则 `impact --base --help` 会在命令级
 * 词法拒绝（IMPACT_INPUT_INVALID，S36 三层防线第一层）之前提前 exit 0，架空硬拒绝。
 */
const VALUE_OPTIONS = new Set([
  '--locale', '--ai-tool', '--aitool', '--module', '--interval', '--env',
  '--manifest', '--run-id', '--slug', '--lifecycle', '--format',
  '--base', '--head', '--prefix',
]);

/** 剔除取值选项的值位 token，仅保留可参与全局选项判定的 token。 */
function nonValueTokens(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (VALUE_OPTIONS.has(args[i])) { i++; continue; }
    out.push(args[i]);
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const globalTokens = nonValueTokens(args);

  if (args.length === 0 || globalTokens.includes('--help') || globalTokens.includes('-h')) {
    console.log(HELP);
    process.exit(0);
  }

  if (globalTokens.includes('--version') || globalTokens.includes('-v')) {
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
    case 'baseline-seed': {
      const sub = args[1];
      const moduleArg = args.includes('--module') ? args[args.indexOf('--module') + 1] : undefined;
      const manifestArg = args.includes('--manifest') ? args[args.indexOf('--manifest') + 1] : undefined;
      const runIdArg = args.includes('--run-id') ? args[args.indexOf('--run-id') + 1] : undefined;
      switch (sub) {
        case 'begin': baselineSeedBegin(moduleArg, manifestArg, format); break;
        case 'commit': baselineSeedCommit(moduleArg, runIdArg, format); break;
        case 'status': baselineSeedStatus(moduleArg, format); break;
        default:
          console.error(`Unknown baseline-seed subcommand: ${sub ?? '(none)'}`);
          console.error('Usage: openlogos baseline-seed <begin|commit|status> --module <id> [--manifest <path>] [--run-id <id>] [--format json]');
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
        case 'set-product-type': moduleSetProductType(args[2], args[3], format); break;
        default:
          console.error(`Unknown module subcommand: ${sub ?? '(none)'}`);
          console.error('Usage: openlogos module <list|add|rename|remove|set-product-type>');
          process.exit(1);
      }
      break;
    }
    case 'feature': {
      const sub = args[1];
      const moduleArg = args.includes('--module') ? args[args.indexOf('--module') + 1] : undefined;
      switch (sub) {
        case 'list': featureList(format, moduleArg); break;
        default:
          console.error(`Unknown feature subcommand: ${sub ?? '(none)'}`);
          console.error('Usage: openlogos feature list [--module <id>] [--format json]');
          process.exit(1);
      }
      break;
    }
    case 'feature-backfill': {
      const moduleArg = args.includes('--module') ? args[args.indexOf('--module') + 1] : undefined;
      featureBackfill(format, moduleArg);
      break;
    }
    case 'change-lint': {
      // code-r1 F8：区分「未传 --slug」（undefined → 允许 guard 回退）与「传了 flag 但缺值/值是另一 option」
      // （'' → 命令层按显式空值硬拒 slug_invalid，绝不回退 guard 对错误目标返回成功）。
      let slugArg: string | undefined;
      if (args.includes('--slug')) {
        const v = args[args.indexOf('--slug') + 1];
        slugArg = (v === undefined || v.startsWith('--')) ? '' : v;
      }
      changeLint(slugArg, format);
      break;
    }
    case 'impact': {
      impact(args.slice(1), format);
      break;
    }
    case 'check-ui-prototype': {
      const slugArg = args.slice(1).find(a => !a.startsWith('--'));
      checkUiPrototype(slugArg, format);
      break;
    }
    case 'check-ui-hash-match': {
      const slugArg = args.slice(1).find(a => !a.startsWith('--'));
      checkUiHashMatchCommand(slugArg, format);
      break;
    }
    default:
      console.error(`Unknown command: ${command}`);
      console.log(HELP);
      process.exit(1);
  }
}

main();
