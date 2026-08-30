import type { OutputFormat } from '../lib/json-output.js';
import type { BootstrapMode, YamlDiagnostics } from '../lib/project-yaml.js';
interface DetectModuleInfo {
    id: string;
    name: string;
    lifecycle: 'initial' | 'launched';
    bootstrap?: BootstrapMode;
}
export interface DetectData {
    cli: {
        version: string;
        node_version: string;
    };
    project: {
        name: string;
        locale: string;
        lifecycle: string;
        modules?: DetectModuleInfo[];
        description: string;
        source_roots: {
            src: string[];
            test: string[];
        } | null;
    } | null;
    yaml_diagnostics: YamlDiagnostics | null;
}
export declare function collectDetectData(root: string): DetectData;
export declare function detect(format?: OutputFormat): void;
export {};
//# sourceMappingURL=detect.d.ts.map