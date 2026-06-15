/**
 * Cloudflare Pages 边缘中间件 —— 自动为中文用户切换到中文站。
 *
 * 优先级（仅作用于英文首页 "/" 的非爬虫请求）：cookie > IP 地理 > 浏览器语言
 *  1. 用户一旦手动切换过语言（带 locale_pref cookie），永远尊重其选择，不再自动跳转。
 *  2. 中国大陆 IP（request.cf.country === 'CN'）→ 302 跳转到 /zh（代表国内核心市场，最强信号）。
 *  3. 否则若浏览器首选语言为中文（Accept-Language 以 zh 开头）→ 302 跳转到 /zh（兜住海外华人）。
 *  4. 爬虫 / 预渲染请求不跳转，保证两种语言都能被搜索引擎独立索引。
 *
 * 该逻辑只在 Cloudflare 边缘运行，本地 `astro dev` / `astro preview` 不会触发，
 * 需在 Pages 预览或生产环境验证（见 smoke SMOKE-core-22）。
 */

function getCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

function isBot(request) {
  const ua = (request.headers.get('User-Agent') || '').toLowerCase();
  if (!ua) return true; // 无 UA 视为非浏览器，不跳转
  return /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|embedly|quora|pinterest|vkshare|whatsapp|telegram|lighthouse|headless/.test(
    ua,
  );
}

// 浏览器首选语言是否为中文：取 Accept-Language 第一项（最高优先级语言）判断。
function prefersChinese(request) {
  const header = request.headers.get('Accept-Language') || '';
  const primary = header.split(',')[0].trim().toLowerCase();
  return primary.startsWith('zh');
}

export async function onRequest(context) {
  const { request, next } = context;
  const url = new URL(request.url);

  // 已有手动语言偏好 → 完全尊重，不自动跳转。
  if (getCookie(request, 'locale_pref')) {
    return next();
  }

  // 仅处理英文首页；其余路径（含 /zh/**、文档、静态资源）一律放行。
  if (url.pathname === '/' && !isBot(request)) {
    const fromCN = request.cf && request.cf.country === 'CN';
    // IP 优先：人在国内直接中文；否则用浏览器语言兜底（海外华人）。
    if (fromCN || prefersChinese(request)) {
      url.pathname = '/zh';
      return Response.redirect(url.toString(), 302);
    }
  }

  return next();
}
