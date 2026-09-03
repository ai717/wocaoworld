import path from 'node:path';
import { readFileSync, statSync } from 'node:fs';
import { ROOT } from './config.mjs';
import { countPosts, getPost, getSource, getStats, listPosts, listSourcesWithCounts } from './db.mjs';
import { esc } from './sanitize.mjs';
import {
  renderAbout,
  renderFeedXml,
  renderList,
  renderNotFound,
  renderPost,
  renderSources,
} from './render.mjs';

const PUBLIC_DIR = path.join(ROOT, 'public');
const HTML = 'text/html; charset=utf-8';
const XML = 'application/rss+xml; charset=utf-8';

// 聚合输出给别人订阅用，30 条足够，避免把整个库塞进一个响应
const FEED_LIMIT = 30;

// 页面数据每 30 分钟才随 sync 变化，短缓存 + ETag 足够
const CACHE_HTML = 'public, max-age=60';
const CACHE_FEED = 'public, max-age=300';
const CACHE_STATIC = 'public, max-age=86400';

const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const html = (status, body, cache = CACHE_HTML) => ({ status, type: HTML, body, cache });
const redirect = (location, status = 301) => ({ status, type: HTML, body: '', cache: 'no-store', location });

function decode(pathname) {
  try {
    return decodeURIComponent(pathname);
  } catch {
    // 非法百分号转义，当成普通字符串处理，后面自然落到 404
    return pathname;
  }
}

/**
 * public/ 下的静态文件。normalize 之后必须仍在 public/ 内，
 * 否则 /../../etc/passwd 这类路径能读到任意文件。
 */
function serveStatic(pathname) {
  const rel = pathname.replace(/^\/+/, '');
  const target = path.normalize(path.join(PUBLIC_DIR, rel));
  if (target !== PUBLIC_DIR && !target.startsWith(PUBLIC_DIR + path.sep)) return null;

  let stat;
  try {
    stat = statSync(target);
  } catch {
    return null;
  }
  if (!stat.isFile()) return null;

  return {
    status: 200,
    type: MIME[path.extname(target).toLowerCase()] ?? 'application/octet-stream',
    body: readFileSync(target),
    cache: CACHE_STATIC,
  };
}

function listPage({ config, db, page, sourceId = null, heading, note, active = '最新', base = '' }) {
  const perPage = config.site.postsPerPage;
  const total = countPosts(db, sourceId);
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  // 超界页夹回最后一页而不是 404：库里条目减少时旧链接依然可读
  const current = Math.min(Math.max(1, page), totalPages);
  const posts = listPosts(db, { limit: perPage, offset: (current - 1) * perPage, sourceId });

  return html(
    200,
    renderList({ config, posts, page: current, totalPages, heading, note, active, base }),
  );
}

function sourcePage(config, db, sourceId, page) {
  const source = getSource(db, sourceId);
  if (!source) return null;

  const base = `/s/${source.id}`;
  const name = esc(source.title ?? source.url);
  const note = `来自订阅源 <a href="${esc(source.site_url ?? source.url)}" rel="external nofollow noopener noreferrer" target="_blank">${name}</a>${
    source.mode === 'excerpt' ? '（仅摘要模式，正文请回原文阅读）' : '（全文镜像）'
  }。共 ${countPosts(db, source.id)} 篇。`;

  return listPage({
    config,
    db,
    page,
    sourceId: source.id,
    heading: source.title ?? source.url,
    note,
    active: '',
    base,
  });
}

/**
 * @returns {{status:number, type:string, body:string|Buffer, cache:string, location?:string}}
 */
export function route({ config, db, method, pathname }) {
  if (method !== 'GET' && method !== 'HEAD') {
    return { ...html(405, ''), allow: 'GET, HEAD' };
  }

  const p = decode(pathname);

  if (p === '/' || p === '/index.html') return listPage({ config, db, page: 1 });

  let m = /^\/page\/(\d+)\/?$/.exec(p);
  if (m) return listPage({ config, db, page: Number(m[1]) });

  m = /^\/p\/([A-Za-z0-9_-]{4,32})\/?$/.exec(p);
  if (m) {
    const post = getPost(db, m[1]);
    if (!post) return html(404, renderNotFound({ config }));
    return html(200, renderPost({ config, post }));
  }

  m = /^\/s\/(\d+)(?:\/page\/(\d+))?\/?$/.exec(p);
  if (m) {
    const result = sourcePage(config, db, Number(m[1]), m[2] ? Number(m[2]) : 1);
    return result ?? html(404, renderNotFound({ config }));
  }

  if (p === '/sources') return redirect('/sources/');
  if (p === '/sources/') {
    return html(200, renderSources({ config, sources: listSourcesWithCounts(db) }));
  }

  if (p === '/about') return redirect('/about/');
  if (p === '/about/') return html(200, renderAbout({ config, stats: summarize(getStats(db)) }));

  if (p === '/feed.xml' || p === '/rss.xml' || p === '/index.xml') {
    const posts = listPosts(db, { limit: FEED_LIMIT });
    return { ...html(200, renderFeedXml({ config, posts }), CACHE_FEED), type: XML };
  }

  const file = serveStatic(p);
  if (file) return file;

  return html(404, renderNotFound({ config }));
}

function summarize(stats) {
  return {
    posts: stats.posts.total ?? 0,
    sources: stats.sources.active ?? 0,
    oldest: stats.posts.oldest ?? null,
    newest: stats.posts.newest ?? null,
  };
}
