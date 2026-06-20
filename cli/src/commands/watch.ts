import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { makeEnvelope, makeErrorEnvelope } from '../lib/json-output.js';
import { FlowError } from '../lib/flow.js';
import type { OutputFormat } from '../lib/json-output.js';
import { collectStatusData } from './status.js';
import type { StatusData } from './status.js';

/**
 * 切片 C：`openlogos watch` —— `status` 的实时版。
 *
 * 轮询 `collectStatusData`（与 status 同一派生源），把一次性快照变成实时流：
 * - 启动先输出一次初始快照（seq=0, event="snapshot"）；
 * - 之后仅在派生 data 变化时输出一条（event="change", seq 递增）；
 * - 变化判定 = 相邻两次 data 深比较（JSON 等价）；
 * - 只读：不写文件、不推进状态、无写副作用；
 * - Ctrl-C / SIGINT 优雅退出。
 *
 * 契约见 spec/cli-json-output.md §10。
 */

export interface WatchPayload {
  seq: number;
  event: 'snapshot' | 'change';
  module: string | null;
  status: StatusData;
}

/** 纯流式状态机：tick(data) 在「首帧或 data 变化」时输出一条，返回是否输出。可独立单测。 */
export class WatchStream {
  private seq = 0;
  private prevJson: string | null = null;

  constructor(
    private readonly module: string | null,
    private readonly format: OutputFormat,
    private readonly emit: (line: string) => void,
  ) {}

  /** 当前下一个事件将使用的 seq（已输出帧数）。 */
  get nextSeq(): number {
    return this.seq;
  }

  tick(data: StatusData): boolean {
    const json = JSON.stringify(data);
    const isFirst = this.prevJson === null;
    if (!isFirst && json === this.prevJson) return false; // data 深比较相等 → 不输出

    const payload: WatchPayload = {
      seq: this.seq,
      event: isFirst ? 'snapshot' : 'change',
      module: this.module,
      status: data,
    };
    this.emit(this.format === 'json' ? JSON.stringify(makeEnvelope('watch', payload)) : renderText(payload));
    this.prevJson = json;
    this.seq++;
    return true;
  }
}

/** 文本模式：清屏后渲染一小段摘要（实时重渲染）。 */
function renderText(p: WatchPayload): string {
  const lines: string[] = [];
  lines.push('\x1b[2J\x1b[H'); // 清屏 + 光标回原点
  lines.push(`● openlogos watch  [seq=${p.seq} ${p.event}${p.module ? ` module=${p.module}` : ''}]`);
  const mods = p.status.modules ?? [];
  if (mods.length > 0) {
    for (const m of mods) {
      const ac = m.active_change ? ` · ${m.active_change.slug} (${m.active_change.proposal_step})` : '';
      lines.push(`  - ${m.id} [${m.lifecycle}]${ac}`);
    }
  } else {
    lines.push(`  phase: ${p.status.current_phase ?? '(n/a)'}`);
  }
  return lines.join('\n');
}

export interface WatchController {
  intervalMs: number;
  stop: () => void;
  sigint: () => void;
  nextSeq: () => number;
}

/**
 * 启动 watch。返回控制器（便于测试与显式停止）：
 * - 同步输出初始快照后，启动 setInterval 轮询；
 * - sigint() 等价用户 Ctrl-C：清理轮询并以 0 码优雅退出。
 */
export function watch(format: OutputFormat = 'text', moduleId?: string, intervalSec?: number): WatchController | void {
  const root = process.cwd();
  const configPath = join(root, 'logos', 'logos.config.json');

  if (!existsSync(configPath)) {
    if (format === 'json') {
      console.error(JSON.stringify(makeErrorEnvelope(
        'watch', 'PROJECT_NOT_INITIALIZED', 'logos/logos.config.json not found.',
      )));
    } else {
      console.error('Error: logos/logos.config.json not found.');
      console.error('Run `openlogos init` first to initialize the project.');
    }
    process.exit(1);
    return; // 未初始化：不进入轮询（process.exit 在测试中被 mock 为抛错，这里兜底返回）
  }

  const intervalMs = Math.max(1, intervalSec ?? 2) * 1000;
  const stream = new WatchStream(moduleId ?? null, format, line => console.log(line));

  // M2 切片 1a：派生抛 FlowError（如 launched builtin skip/reorder、overlay-add 谓词非法）时，
  // 输出错误信封并**不进入 / 停止轮询**（不在错误流上空转）。
  const tickOrFail = (timer?: ReturnType<typeof setInterval>): boolean => {
    try {
      stream.tick(collectStatusData(root, moduleId));
      return true;
    } catch (e) {
      if (e instanceof FlowError) {
        if (format === 'json') {
          console.error(JSON.stringify(makeErrorEnvelope('watch', e.code, e.message)));
        } else {
          console.error(`✖ flow 配置错误（${e.code}）：${e.message}`);
        }
        if (timer) clearInterval(timer);
        process.exit(1);
        return false;
      }
      throw e;
    }
  };

  // 启动先输出一次初始快照（无需等变化）；失败则不进入轮询
  if (!tickOrFail()) return;

  const timer = setInterval(() => {
    tickOrFail(timer);
  }, intervalMs);
  // 让定时器不阻止进程在其它退出路径下结束（CLI 常驻由事件循环保持）
  if (typeof timer.unref === 'function') timer.unref();

  const stop = () => {
    clearInterval(timer);
    process.removeListener('SIGINT', sigint);
  };
  const sigint = () => {
    stop();
    process.exit(0); // 优雅退出，无写副作用
  };
  process.on('SIGINT', sigint);

  return { intervalMs, stop, sigint, nextSeq: () => stream.nextSeq };
}
