export interface CmdRunResult {
    exitCode: number | null;
    timedOut: boolean;
}
/** shell 进程本身无法启动（child_process `'error'` 事件）→ 上层转 FLOW_CMD_SPAWN_FAILED。 */
export declare class CmdSpawnError extends Error {
    errno: string;
    command: string;
    constructor(errno: string, command: string);
}
export interface RunFlowCmdOpts {
    /** 仅内部测试用：注入 shell 路径（如不可执行路径以稳定触发 'error'）；默认 true。 */
    shell?: string | boolean;
}
/**
 * 执行 cmd 命令。exit 0 → done 信号；非 0 / 超时 → 未 done。shell 起不来 → reject(CmdSpawnError)。
 */
export declare function runFlowCmd(command: string, cwd: string, timeoutSec: number, opts?: RunFlowCmdOpts): Promise<CmdRunResult>;
//# sourceMappingURL=flow-cmd.d.ts.map