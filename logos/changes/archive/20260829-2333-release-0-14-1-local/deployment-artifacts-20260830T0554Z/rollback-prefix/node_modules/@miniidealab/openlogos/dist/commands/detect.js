import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { VERSION, makeEnvelope } from '../lib/json-output.js';
import { readProjectYaml, isAdoptedBootstrap } from '../lib/project-yaml.js';
export function collectDetectData(root) {
    const configPath = join(root, 'logos', 'logos.config.json');
    let project = null;
    let yamlDiagnostics = null;
    if (existsSync(configPath)) {
        try {
            const config = JSON.parse(readFileSync(configPath, 'utf-8'));
            // Derive lifecycle from modules
            let lifecycle = 'initial';
            const projectYaml = readProjectYaml(root);
            yamlDiagnostics = projectYaml.yaml_diagnostics;
            const modules = projectYaml.data?.modules?.map(m => ({
                id: m.id,
                name: m.name,
                lifecycle: m.lifecycle === 'launched' ? 'launched' : 'initial',
                ...(isAdoptedBootstrap(m.bootstrap) ? { bootstrap: 'adopted' } : {}),
            }));
            if (modules?.some(m => m.lifecycle === 'launched')) {
                lifecycle = 'launched';
            }
            project = {
                name: config.name ?? '',
                locale: config.locale ?? 'en',
                lifecycle,
                ...(modules !== undefined ? { modules } : {}),
                description: config.description ?? '',
                source_roots: config.sourceRoots ?? null,
            };
        }
        catch { /* ignore malformed config */ }
    }
    return {
        cli: {
            version: VERSION,
            node_version: process.version,
        },
        project,
        yaml_diagnostics: yamlDiagnostics,
    };
}
export function detect(format = 'text') {
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
    }
    else {
        console.log(`📁 No OpenLogos project found in current directory.`);
    }
    console.log('');
}
//# sourceMappingURL=detect.js.map