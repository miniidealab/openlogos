import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const call = (file, args) => execFileSync(file, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function check(condition, message) {
  if (!condition) throw new Error(message);
}

function identity(tag, commit) {
  check(/^v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?$/.test(tag ?? '') && /^[a-f0-9]{40}$/i.test(commit ?? ''),
    '发布制品需要有效的 tag 和提交');
  return { tag, commit, filename: 'miniidealab-openlogos-' + tag.slice(1) + '.tgz' };
}

export function freezeBundle(dir, tag, commit) {
  const frozen = identity(tag, commit);
  mkdirSync(dir, { recursive: true });
  const archive = join(dir, frozen.filename);
  const notes = join(dir, 'release-notes.md');
  copyFileSync(join('cli', frozen.filename), archive);
  copyFileSync('release-notes.md', notes);
  writeFileSync(join(dir, 'release.json'), JSON.stringify({
    ...frozen, archiveSha256: digest(readFileSync(archive)), notesSha256: digest(readFileSync(notes)),
  }, null, 2) + '\n');
}

export function readBundle(dir, tag, commit) {
  const frozen = JSON.parse(readFileSync(join(dir, 'release.json'), 'utf8'));
  const expected = identity(tag, commit);
  check(frozen.tag === expected.tag && frozen.commit === expected.commit && frozen.filename === expected.filename,
    '发版制品与当前 tag 或提交不符');
  const archive = join(dir, expected.filename);
  const notes = join(dir, 'release-notes.md');
  check(digest(readFileSync(archive)) === frozen.archiveSha256 && digest(readFileSync(notes)) === frozen.notesSha256,
    '发版包或发布说明的 SHA-256 不符');
  return { ...expected, archive, notes, archiveSha256: frozen.archiveSha256 };
}

function existingRelease(repository, tag, command) {
  try {
    return JSON.parse(command('gh', ['api', 'repos/' + repository + '/releases/tags/' + encodeURIComponent(tag)]));
  } catch (error) {
    if (/\bHTTP 404\b/.test(error.stderr ?? '')) return null;
    throw error;
  }
}

export function distributeRelease(dir, tag, commit, repository, command = call) {
  const bundle = readBundle(dir, tag, commit);
  const ref = 'refs/tags/' + tag;
  const refs = new Map(command('git', ['ls-remote', 'origin', ref, ref + '^{}']).trim().split('\n')
    .filter(Boolean).map(line => line.split('\t').reverse()));
  check((refs.get(ref + '^{}') ?? refs.get(ref)) === commit, '远端 tag 与冻结提交不符');
  const release = existingRelease(repository, tag, command);
  if (!release) {
    command('gh', ['release', 'create', tag, '--repo', repository, '--verify-tag', '--title', tag,
      '--notes-file', bundle.notes, '--latest', bundle.archive]);
    return;
  }

  check(release.tag_name === tag && release.draft === false, '已有 GitHub Release 的标识或公开状态不符');
  check(typeof release.body === 'string' && release.body.trimEnd() === readFileSync(bundle.notes, 'utf8').trimEnd(),
    '已有 GitHub Release 的发布说明与冻结说明不符');
  check(release.assets?.some(asset => asset.name === bundle.filename), '已有 GitHub Release 缺少同名制品');
  const download = mkdtempSync(join(tmpdir(), 'openlogos-release-'));
  try {
    command('gh', ['release', 'download', tag, '--repo', repository, '--pattern', bundle.filename, '--dir', download]);
    check(digest(readFileSync(join(download, bundle.filename))) === bundle.archiveSha256, '已有 Release 附件的 SHA-256 不符');
    console.log('已核对并复用现有 GitHub Release ' + tag);
  } finally {
    rmSync(download, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [action, dir] = process.argv.slice(2);
  const tag = process.env.GITHUB_REF_NAME;
  const commit = call('git', ['rev-parse', 'HEAD']).trim();
  check(commit === process.env.GITHUB_SHA, '检出提交与发版事件不符');
  if (action === 'freeze') freezeBundle(dir, tag, commit);
  else if (action === 'distribute') distributeRelease(dir, tag, commit, process.env.GITHUB_REPOSITORY);
  else throw new Error('需要 freeze 或 distribute 操作');
}
