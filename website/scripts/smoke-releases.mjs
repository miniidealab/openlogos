import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { RELEASE_SUMMARY_FALLBACK_MESSAGE } from '../src/lib/releases-summary.mjs';

const ROOT = process.cwd();
const RESULT_PATH = resolve(ROOT, '../logos/resources/verify/smoke-results.jsonl');
const DIST_DIR = resolve(ROOT, 'dist');
const RELEASE_DATA_PATH = resolve(ROOT, 'src/data/releases.json');
const GITHUB_LATEST_RELEASE_API = 'https://api.github.com/repos/miniidealab/openlogos/releases/latest';
const GITHUB_TIMEOUT_MS = 15000;
const WEBSITE_SMOKE_IDS = new Set([
  'SMOKE-core-03',
  'SMOKE-core-07',
  'SMOKE-core-08',
  'SMOKE-core-15',
  'SMOKE-core-21',
  'SMOKE-core-22',
  'SMOKE-core-23',
  'SMOKE-core-24',
]);

function removePreviousWebsiteResults() {
  mkdirSync(dirname(RESULT_PATH), { recursive: true });
  if (!existsSync(RESULT_PATH)) {
    writeFileSync(RESULT_PATH, '');
    return;
  }
  const kept = readFileSync(RESULT_PATH, 'utf-8')
    .split('\n')
    .filter((line) => {
      if (!line.trim()) return false;
      try {
        const item = JSON.parse(line);
        return !WEBSITE_SMOKE_IDS.has(item.id);
      } catch {
        return true;
      }
    });
  writeFileSync(RESULT_PATH, kept.length > 0 ? `${kept.join('\n')}\n` : '');
}

function report(id, status, scenario, error) {
  mkdirSync(dirname(RESULT_PATH), { recursive: true });
  const line = {
    id,
    status,
    timestamp: new Date().toISOString(),
    scenario,
  };
  if (error) line.error = error;
  appendFileSync(RESULT_PATH, `${JSON.stringify(line)}\n`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readHtml(path) {
  return readFileSync(resolve(DIST_DIR, path), 'utf-8');
}

// 递归收集指定扩展名的文件（用于扫描打包后的 CSS 产物）。
function walkByExt(dir, ext, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walkByExt(full, ext, files);
    else if (entry.endsWith(ext)) files.push(full);
  }
  return files;
}

function readReleaseData() {
  return JSON.parse(readFileSync(RELEASE_DATA_PATH, 'utf-8'));
}

function normalizeVersion(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/^v/, '');
  return normalized.length > 0 ? normalized : null;
}

async function fetchLatestReleaseTag() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GITHUB_TIMEOUT_MS);
  try {
    const response = await fetch(GITHUB_LATEST_RELEASE_API, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'openlogos-smoke-releases',
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`GitHub latest release API returned ${response.status}`);
    }
    const payload = await response.json();
    const tag = typeof payload.tag_name === 'string' ? payload.tag_name : '';
    const version = normalizeVersion(tag);
    if (!version) {
      throw new Error('GitHub latest release API missing tag_name');
    }
    return {
      tag,
      version,
      url: typeof payload.html_url === 'string' ? payload.html_url : null,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function run() {
  removePreviousWebsiteResults();
  const releaseData = readReleaseData();
  const latestVersionText = `v${releaseData.latestVersion}`;
  const versionCountText = String(releaseData.versionCount);

  try {
    const index = readHtml('index.html');
    assert(index.includes('/releases'), 'Home page missing releases link');
    assert(index.includes('Release Feed'), 'Home page missing release feed section');
    assert(index.includes(latestVersionText), 'Home page missing latest release version');
    assert(index.includes(versionCountText), 'Home page missing release count');
    report('SMOKE-core-08', 'pass', 'home page links to releases');
  } catch (error) {
    report('SMOKE-core-08', 'fail', 'home page links to releases', String(error));
    throw error;
  }

  try {
    const releases = readHtml('releases/index.html');
    const versions = Array.isArray(releaseData.versions) ? releaseData.versions : [];
    const versionsWithEnglishValue = versions.filter((item) => item.valueSummaryEn?.length > 0);
    const versionsWithEnglishFix = versions.filter((item) => item.fixSummaryEn?.length > 0);
    const versionsWithChineseOriginal = versions.filter((item) => item.valueSummary?.length > 0 || item.fixSummary?.length > 0);
    const fallbackVersions = versions.filter((item) => item.summarySource === 'fallback');
    assert(releases.includes('OpenLogos Releases'), 'Release page missing title');
    assert(releases.includes('npm install -g @miniidealab/openlogos'), 'Release page missing install command');
    assert(releases.includes(latestVersionText), 'Release page missing latest version');
    assert(releases.includes('versions'), 'Release page missing version count label');
    assert(releases.includes(versionCountText), 'Release page missing version count value');
    assert(versionsWithEnglishValue.length > 0, 'Release data missing English value summaries');
    assert(versionsWithEnglishFix.length > 0, 'Release data missing English fix summaries');
    assert(versionsWithChineseOriginal.length > 0, 'Release data missing Chinese original summaries');
    assert(fallbackVersions.length > 0, 'Release data missing fallback summary markers');
    assert(releases.includes('What changed'), 'Release page missing value summary heading');
    assert(releases.includes('What got fixed'), 'Release page missing fix summary heading');
    assert(releases.includes('Chinese original'), 'Release page missing Chinese original disclosure');
    assert(releases.includes(versionsWithEnglishValue[0].valueSummaryEn[0]), 'Release page missing rendered English value summary');
    assert(releases.includes(versionsWithEnglishFix[0].fixSummaryEn[0]), 'Release page missing rendered English fix summary');
    assert(releases.includes(RELEASE_SUMMARY_FALLBACK_MESSAGE), 'Release page missing fixed fallback summary text');
    assert(releases.includes('CHANGELOG'), 'Release page missing changelog links');
    report('SMOKE-core-07', 'pass', 'release page shows bilingual version summaries');
  } catch (error) {
    report('SMOKE-core-07', 'fail', 'release page shows bilingual version summaries', String(error));
    throw error;
  }

  try {
    const releases = readHtml('releases/index.html');
    assert(releases.includes('GitHub Release'), 'Release page missing external links');
    assert(releases.includes('maintained bilingual release data'), 'Release page missing bilingual source explanation');
    assert(releases.includes('structured CHANGELOG extraction'), 'Release page missing Chinese original source explanation');
    report('SMOKE-core-03', 'pass', 'website build includes release history page');
  } catch (error) {
    report('SMOKE-core-03', 'fail', 'website build includes release history page', String(error));
    throw error;
  }

  try {
    // SMOKE-core-21: Chinese (zh) routes build and the language switcher is wired up.
    const zhHome = readHtml('zh/index.html');
    assert(zhHome.includes('lang="zh"'), 'Chinese home page missing lang="zh"');
    assert(zhHome.includes('/zh/getting-started'), 'Chinese home page missing zh-prefixed docs link');
    assert(zhHome.includes('langSwitcher'), 'Chinese home page missing language switcher');
    assert(zhHome.includes('示例项目'), 'Chinese home page missing polished tour nav label');
    assert(zhHome.includes('版本日志'), 'Chinese home page missing polished release nav label');
    assert(zhHome.includes('一上来就写代码，指望 AI 猜中意图'), 'Chinese home page missing polished problem copy');

    const zhTour = readHtml('zh/tour/index.html');
    assert(zhTour.includes('一套方法论、两款 AI 工具、两个真实项目'), 'Chinese tour page missing single-line hero copy');

    const zhFlowtask = readHtml('zh/tour/flowtask/index.html');
    assert(zhFlowtask.includes('部署与 smoke 门禁'), 'Chinese FlowTask page missing deployment and smoke section');
    assert(zhFlowtask.includes('DEPLOY_DONE'), 'Chinese FlowTask page missing deploy-done status');
    assert(zhFlowtask.includes('SMOKE_PASS'), 'Chinese FlowTask page missing smoke status');

    const zhMoneyLog = readHtml('zh/tour/money-log/index.html');
    assert(zhMoneyLog.includes('部署与 smoke 门禁'), 'Chinese Money-Log page missing deployment and smoke section');
    assert(zhMoneyLog.includes('DEPLOY_DONE'), 'Chinese Money-Log page missing deploy-done status');
    assert(zhMoneyLog.includes('SMOKE_PASS'), 'Chinese Money-Log page missing smoke status');

    const zhDocs = readHtml('zh/getting-started/index.html');
    assert(zhDocs.includes('lang="zh-CN"'), 'Chinese docs page missing lang="zh-CN"');

    const zhCli = readHtml('zh/cli/index.html');
    assert(zhCli.includes('lang="zh-CN"'), 'Chinese CLI docs page missing lang="zh-CN"');

    const enHome = readHtml('index.html');
    assert(enHome.includes('langSwitcher'), 'English home page missing language switcher');
    assert(enHome.includes('简体中文'), 'English home page missing Chinese language option');

    report('SMOKE-core-21', 'pass', 'website Chinese routes and language switcher are available');
  } catch (error) {
    report('SMOKE-core-21', 'fail', 'website Chinese routes and language switcher are available', String(error));
    throw error;
  }

  try {
    // SMOKE-core-22: the auto-locale edge middleware and cookie wiring are in place.
    // The IP-based redirect itself only runs at the Cloudflare edge; here we assert the
    // shippable artifacts exist so a regression (deleted middleware / unwired cookie) is caught.
    const middleware = readFileSync(resolve(ROOT, 'functions/_middleware.js'), 'utf-8');
    assert(middleware.includes('locale_pref'), 'Edge middleware missing locale_pref cookie gate');
    assert(middleware.includes("country === 'CN'") || middleware.includes('country==="CN"'),
      'Edge middleware missing CN country check');
    assert(middleware.includes('Accept-Language'), 'Edge middleware missing browser-language fallback');
    assert(middleware.includes('/zh'), 'Edge middleware missing /zh redirect target');

    const enHome = readHtml('index.html');
    assert(enHome.includes('locale_pref'), 'Home page language switcher not writing locale_pref cookie');
    assert(enHome.includes('data-locale'), 'Home page language options missing data-locale wiring');

    report('SMOKE-core-22', 'pass', 'auto-locale edge middleware and cookie persistence are wired');
  } catch (error) {
    report('SMOKE-core-22', 'fail', 'auto-locale edge middleware and cookie persistence are wired', String(error));
    throw error;
  }

  try {
    // SMOKE-core-23: subset Chinese web fonts are produced and @font-face is injected.
    const weights = ['400', '500', '600', '700', '900'];
    for (const w of weights) {
      const fontPath = resolve(DIST_DIR, `fonts/NotoSansSC-${w}.subset.woff2`);
      assert(existsSync(fontPath), `Subset font missing for weight ${w}: ${fontPath}`);
      const sizeKb = statSync(fontPath).size / 1024;
      // 子集后单字重应在合理区间：远小于原始 ~10MB，又不为空（裁剪正常）。
      assert(sizeKb > 20 && sizeKb < 2048, `Subset font weight ${w} size out of range: ${sizeKb.toFixed(0)} KB`);
    }
    // Astro 会把 <style is:global> 与 custom.css 打包成 dist/_astro 下的外部 CSS，
    // 因此 @font-face 出现在打包后的 CSS（而非 HTML）中。扫描全部 CSS 产物校验注入。
    const cssFiles = walkByExt(DIST_DIR, '.css');
    const cssBlob = cssFiles.map((f) => readFileSync(f, 'utf-8')).join('\n');
    assert(cssBlob.includes('Noto Sans SC'), 'Bundled CSS missing Noto Sans SC @font-face family');
    assert(cssBlob.includes('NotoSansSC-400.subset.woff2'), 'Bundled CSS missing subset @font-face src');
    assert(/unicode-range/i.test(cssBlob), 'Bundled CSS missing unicode-range gating for CJK font');

    report('SMOKE-core-23', 'pass', 'subset Chinese web fonts produced and @font-face injected');
  } catch (error) {
    report('SMOKE-core-23', 'fail', 'subset Chinese web fonts produced and @font-face injected', String(error));
    throw error;
  }

  try {
    // SMOKE-core-24: Mermaid syntax safety rules are visible in all affected Skill docs.
    const enArchitecture = readHtml('skills/architecture-designer/index.html');
    const enScenario = readHtml('skills/scenario-architect/index.html');
    const enDeployment = readHtml('skills/deployment-designer/index.html');
    const zhArchitecture = readHtml('zh/skills/architecture-designer/index.html');
    const zhScenario = readHtml('zh/skills/scenario-architect/index.html');
    const zhDeployment = readHtml('zh/skills/deployment-designer/index.html');

    assert(enArchitecture.includes('Mermaid Syntax Safety'), 'English architecture page missing Mermaid syntax heading');
    assert(enArchitecture.includes('ID[&quot;label&quot;]') || enArchitecture.includes('ID["label"]'), 'English architecture page missing ID["label"] rule');
    assert(enArchitecture.includes('PROXY[/voice/api proxy]'), 'English architecture page missing unsafe PROXY example');
    assert(enArchitecture.includes('subgraph &quot;Name&quot;') || enArchitecture.includes('subgraph "Name"'), 'English architecture page missing subgraph "Name" rule');

    assert(zhArchitecture.includes('Mermaid 语法安全'), 'Chinese architecture page missing Mermaid syntax heading');
    assert(zhArchitecture.includes('ID[&quot;标签文本&quot;]') || zhArchitecture.includes('ID["标签文本"]'), 'Chinese architecture page missing ID["标签文本"] rule');
    assert(zhArchitecture.includes('PROXY[/voice/api 代理]'), 'Chinese architecture page missing unsafe PROXY example');
    assert(zhArchitecture.includes('subgraph &quot;名称&quot;') || zhArchitecture.includes('subgraph "名称"'), 'Chinese architecture page missing subgraph "名称" rule');

    assert(enDeployment.includes('ID[&quot;label&quot;]') || enDeployment.includes('ID["label"]'), 'English deployment page missing ID["label"] rule');
    assert(enDeployment.includes('subgraph &quot;Staging Environment&quot;') || enDeployment.includes('subgraph "Staging Environment"'), 'English deployment page missing subgraph "Staging Environment" rule');
    assert(enDeployment.includes('PROXY[/voice/api proxy]'), 'English deployment page missing unsafe PROXY example');

    assert(zhDeployment.includes('ID[&quot;标签文本&quot;]') || zhDeployment.includes('ID["标签文本"]'), 'Chinese deployment page missing ID["标签文本"] rule');
    assert(zhDeployment.includes('subgraph &quot;预发环境&quot;') || zhDeployment.includes('subgraph "预发环境"'), 'Chinese deployment page missing subgraph "预发环境" rule');
    assert(zhDeployment.includes('PROXY[/voice/api 代理]'), 'Chinese deployment page missing unsafe PROXY example');

    assert(enScenario.includes('Every arrow message must stay on one line'), 'English scenario page missing one-line arrow rule');
    assert(enScenario.includes('Step Narratives'), 'English scenario page missing Step Narratives reference');
    assert(enScenario.includes('multi-line JSON'), 'English scenario page missing complex content guidance');

    assert(zhScenario.includes('每条箭头消息必须保持单行'), 'Chinese scenario page missing one-line arrow rule');
    assert(zhScenario.includes('步骤叙述'), 'Chinese scenario page missing step narrative reference');
    assert(zhScenario.includes('多行 JSON'), 'Chinese scenario page missing complex content guidance');

    report('SMOKE-core-24', 'pass', 'Mermaid syntax safety rules are rendered on Skill docs pages');
  } catch (error) {
    report('SMOKE-core-24', 'fail', 'Mermaid syntax safety rules are rendered on Skill docs pages', String(error));
    throw error;
  }

  try {
    const latestTag = await fetchLatestReleaseTag();
    assert(
      releaseData.latestVersion === latestTag.version,
      `Release latestVersion mismatch: site=${releaseData.latestVersion}, tag=${latestTag.tag}`,
    );
    report(
      'SMOKE-core-15',
      'pass',
      `tag release sync: latest=${releaseData.latestVersion}, tag=${latestTag.tag}, release=${latestTag.url ?? 'n/a'}`,
    );
  } catch (error) {
    report('SMOKE-core-15', 'fail', 'tag release latest version matches website release', String(error));
    throw error;
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
