import { readFileSync } from 'node:fs';
import path from 'node:path';

export const ROOT = path.resolve(import.meta.dirname, '..');

export const MODES = new Set(['full', 'excerpt']);

export function dataDir() {
  return process.env.BLOG_DATA_DIR
    ? path.resolve(process.env.BLOG_DATA_DIR)
    : path.join(ROOT, 'data');
}

export function distDir() {
  return path.join(ROOT, 'dist');
}

export function publicDir() {
  return path.join(ROOT, 'public');
}

function assertHttpUrl(value, where) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${where} 不是合法 URL: ${JSON.stringify(value)}`);
  }
  // 只允许 http/https。config.json 由站长编辑，但限定协议可避免
  // file:// 之类的地址被当成抓取目标。
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${where} 只支持 http/https，收到 ${parsed.protocol}`);
  }
  return parsed;
}

export function loadConfig(file = path.join(ROOT, 'config.json')) {
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`读取配置 ${file} 失败: ${err.message}`);
  }

  const site = raw.site ?? {};
  if (!site.title) throw new Error('config.json 缺少 site.title');
  const siteUrl = assertHttpUrl(site.url ?? '', 'site.url');
  // 不能用 siteUrl.origin：它会吞掉路径，而 GitHub Pages 项目站点的
  // /repo 前缀就住在路径里。这里把前缀单独提出来当 basePath。
  const basePath = siteUrl.pathname.replace(/\/+$/, '');

  const rawSources = raw.sources ?? [];
  if (!Array.isArray(rawSources)) throw new Error('config.json 的 sources 必须是数组');

  const seen = new Set();
  const sources = rawSources.map((entry, i) => {
    const where = `sources[${i}].url`;
    const parsed = assertHttpUrl(entry?.url ?? '', where);
    const url = parsed.href;
    if (seen.has(url)) throw new Error(`${where} 重复: ${url}`);
    seen.add(url);

    const mode = entry.mode ?? 'full';
    if (!MODES.has(mode)) {
      throw new Error(`sources[${i}].mode 只能是 full 或 excerpt，收到 ${JSON.stringify(mode)}`);
    }
    return { url, mode };
  });

  const postsPerPage = Number(site.postsPerPage ?? 20);
  if (!Number.isInteger(postsPerPage) || postsPerPage < 1 || postsPerPage > 100) {
    throw new Error(`site.postsPerPage 必须是 1-100 的整数，收到 ${JSON.stringify(site.postsPerPage)}`);
  }

  return {
    site: {
      title: String(site.title),
      description: String(site.description ?? ''),
      origin: siteUrl.origin,
      basePath,
      url: `${siteUrl.origin}${basePath}`,
      lang: String(site.lang ?? 'zh-CN'),
      postsPerPage,
      noindex: site.noindex !== false,
    },
    sources,
    file,
  };
}
