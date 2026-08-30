import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const CONTRACT_PATHS = Object.freeze([
  'spec/schema/merge-transaction.schema.json',
  'spec/cli-json-output.md',
]);

export function seedInstalledMergeContract(projectRoot, { candidateBin, fallbackRoot } = {}) {
  const packageRoot = resolveInstalledPackageRoot({ candidateBin, fallbackRoot });
  if (!packageRoot) throw new Error('缺少 merge transaction 契约来源');
  for (const relativePath of CONTRACT_PATHS) {
    const source = join(packageRoot, ...relativePath.split('/'));
    if (!existsSync(source)) throw new Error(`安装态缺少契约资产：${relativePath}`);
    const destination = join(projectRoot, ...relativePath.split('/'));
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, readFileSync(source));
  }
}

export function resolveInstalledPackageRoot({ candidateBin, fallbackRoot } = {}) {
  if (candidateBin) {
    const entry = realpathSync(resolve(candidateBin));
    return dirname(dirname(entry));
  }
  return fallbackRoot ? resolve(fallbackRoot) : null;
}

export async function importInstalledPackageModule(relativePath, options = {}) {
  const packageRoot = resolveInstalledPackageRoot(options);
  if (!packageRoot) throw new Error(`缺少安装态模块来源：${relativePath}`);
  const modulePath = join(packageRoot, ...relativePath.split('/'));
  if (!existsSync(modulePath)) throw new Error(`安装态缺少模块：${relativePath}`);
  return import(`${pathToFileURL(modulePath).href}?smoke=${Date.now()}`);
}
