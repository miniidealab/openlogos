import type { OutputFormat } from './json-output.js';
export type SandboxMode = 'off' | 'auto' | 'always';
export type SandboxStatus = 'pass' | 'warn' | 'fail' | 'skipped';
export interface NormalizedSandboxConfig {
    mode: SandboxMode;
    root: string;
    denyWorkspaceWrite: boolean;
}
export interface SandboxData {
    mode: SandboxMode;
    root: string;
    isolated: boolean;
    workspace_write_denied: boolean;
    status: SandboxStatus;
    diagnostics: string[];
    suggestions: string[];
    /** 信息级说明通道（additive、可选）：仅承载不影响 status 的说明，如依赖目录豁免提示。 */
    infos?: string[];
}
export interface SandboxCommandResult {
    status: 'pass' | 'fail';
    exit_code?: number;
    duration_ms?: number;
    error?: string;
}
export interface SandboxExecutionResult {
    command: SandboxCommandResult;
    sandbox: SandboxData;
}
export interface RunSandboxedCommandOptions {
    root: string;
    command: string;
    format: OutputFormat;
    sandbox: NormalizedSandboxConfig;
    allowedWritePaths: string[];
}
export interface RuntimeWriteProtection {
    available: boolean;
    kind?: 'sandbox-exec' | 'bwrap';
    reason?: string;
}
export declare const DEPENDENCY_DIR_EXEMPT_INFO = "\u4F9D\u8D56\u76EE\u5F55 node_modules \u4E3A\u6C99\u7BB1\u5185\u4E00\u6B21\u6027\u76EE\u5F55\uFF0C\u4E0D\u53C2\u4E0E\u5199\u5165\u5BA1\u8BA1\uFF0C\u4E0D\u4F1A\u56DE\u6536\u5230\u5DE5\u4F5C\u533A\u3002";
/**
 * 依赖目录豁免匹配（精确路径段边界）：规范化并统一分隔符后，
 * 仅当至少一个完整路径段严格等于 `node_modules` 时命中；
 * 禁止子串 / 前缀 / 后缀匹配（`node_modules-cache`、`my-node_modules`、`node_modules.txt` 均不豁免）。
 */
export declare function isDependencyExemptPath(path: string): boolean;
/**
 * 运行期写保护能力探测（结果按进程缓存）：
 * - macOS: sandbox-exec（实际试跑一次探测，嵌套沙箱环境会自然探测为不可用）
 * - Linux: bubblewrap（bwrap）
 * - 其他平台 / 机制缺失：不可用，由调用方按能力分层处理
 * 设置 OPENLOGOS_SANDBOX_WRITE_PROTECTION=off 可强制视为不可用（测试与逃生口）。
 */
export declare function detectRuntimeWriteProtection(): RuntimeWriteProtection;
export declare function normalizeSandboxConfig(raw: unknown): NormalizedSandboxConfig;
export declare function buildInitialSandboxData(config: NormalizedSandboxConfig): SandboxData;
export declare function runSandboxedCommand(options: RunSandboxedCommandOptions): SandboxExecutionResult;
//# sourceMappingURL=sandbox.d.ts.map