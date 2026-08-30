import type { OutputFormat } from '../lib/json-output.js';
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
export declare class WatchStream {
    private readonly module;
    private readonly format;
    private readonly emit;
    private seq;
    private prevJson;
    constructor(module: string | null, format: OutputFormat, emit: (line: string) => void);
    /** 当前下一个事件将使用的 seq（已输出帧数）。 */
    get nextSeq(): number;
    tick(data: StatusData): boolean;
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
export declare function watch(format?: OutputFormat, moduleId?: string, intervalSec?: number): WatchController | void;
//# sourceMappingURL=watch.d.ts.map