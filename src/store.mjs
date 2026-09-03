import { readFileSync, mkdirSync, renameSync, openSync, writeSync, fsyncSync, closeSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { dataDir } from './config.mjs';

export const SOURCES_FILE = 'sources.json';
export const POSTS_FILE = 'posts.json';

// 磁盘上的 JSON 用 camelCase，但对外返回的行用 snake_case ——
// render.mjs 与 cli.mjs 读的是 row.published_at / row.source_title 这类列名。
function sourceRow(s) {
  return {
    id: s.id,
    url: s.url,
    title: s.title ?? null,
    site_url: s.siteUrl ?? null,
    mode: s.mode,
    active: s.active ? 1 : 0,
    etag: s.etag ?? null,
    last_modified: s.lastModified ?? null,
    last_fetched_at: s.lastFetchedAt ?? null,
    last_status: s.lastStatus ?? null,
  };
}

function postRow(p, s) {
  return {
    id: p.id,
    source_id: p.sourceId,
    guid: p.guid,
    title: p.title,
    link: p.link,
    author: p.author ?? null,
    published_at: p.publishedAt,
    fetched_at: p.fetchedAt,
    content_html: p.contentHtml ?? null,
    summary: p.summary ?? null,
    source_title: s.title ?? null,
    source_url: s.url ?? null,
    source_site: s.siteUrl ?? null,
    source_mode: s.mode ?? null,
  };
}

function readJson(file, fallback) {
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw new Error(`读取 ${file} 失败: ${err.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`解析 ${file} 失败: ${err.message}`);
  }
}

// SQLite 的崩溃安全性没了，只能自己补：写 tmp → fsync → rename。
// rename 在同一文件系统上是原子的，中途崩溃只会留下 tmp 文件。
function atomicWriteJson(file, value) {
  const tmp = `${file}.tmp`;
  const fd = openSync(tmp, 'w');
  try {
    writeSync(fd, `${JSON.stringify(value, null, 2)}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, file);
}

export function postId(sourceUrl, guid) {
  return createHash('sha256').update(`${sourceUrl}\n${guid}`).digest('hex').slice(0, 12);
}

export function openStore(dir = dataDir()) {
  mkdirSync(dir, { recursive: true });
  const sourcesFile = path.join(dir, SOURCES_FILE);
  const postsFile = path.join(dir, POSTS_FILE);

  const sourcesDoc = readJson(sourcesFile, { nextId: 1, items: [] });
  const posts = readJson(postsFile, []);
  const items = sourcesDoc.items;
  if (!Array.isArray(items) || !Array.isArray(posts)) {
    throw new Error(`${sourcesFile} 与 ${postsFile} 的结构不是预期的 { nextId, items[] } / []`);
  }

  // /s/<id> 是已发布的 URL，id 必须跨轮次稳定，所以只增不减。
  // 取下限为 max(id)+1，防止手改文件把 nextId 弄小后发出重复 id。
  let maxId = 0;
  for (const s of items) if (s.id > maxId) maxId = s.id;
  const nextId = Math.max(Number(sourcesDoc.nextId) || 1, maxId + 1);

  // 复刻 UNIQUE(source_id, guid) 与 findPostByLink 的查询，加载时一次建好
  const guidIndex = new Set();
  const linkIndex = new Map();
  for (const p of posts) {
    guidIndex.add(`${p.sourceId}\n${p.guid}`);
    linkIndex.set(`${p.sourceId}\n${p.link}`, p.id);
  }

  const store = {
    dir,
    sourcesFile,
    postsFile,
    nextId,
    sources: items,
    posts,
    sourcesDirty: false,
    postsDirty: false,
    guidIndex,
    linkIndex,
  };
  store.close = () => saveStore(store);
  return store;
}

export function saveStore(store) {
  if (store.sourcesDirty) {
    atomicWriteJson(store.sourcesFile, { nextId: store.nextId, items: store.sources });
    store.sourcesDirty = false;
  }
  if (store.postsDirty) {
    atomicWriteJson(store.postsFile, store.posts);
    store.postsDirty = false;
  }
}

export function reconcileSources(store, configSources) {
  const byUrl = new Map(store.sources.map((s) => [s.url, s]));

  for (const source of configSources) {
    const existing = byUrl.get(source.url);
    if (existing) {
      if (existing.mode !== source.mode || !existing.active) {
        existing.mode = source.mode;
        existing.active = true;
        store.sourcesDirty = true;
      }
      continue;
    }
    const created = {
      id: store.nextId++,
      url: source.url,
      title: null,
      siteUrl: null,
      mode: source.mode,
      active: true,
      etag: null,
      lastModified: null,
      lastFetchedAt: null,
      lastStatus: null,
    };
    store.sources.push(created);
    byUrl.set(created.url, created);
    store.sourcesDirty = true;
  }

  const wanted = new Set(configSources.map((s) => s.url));
  let deactivated = 0;
  for (const s of store.sources) {
    if (s.active && !wanted.has(s.url)) {
      s.active = false;
      deactivated += 1;
      store.sourcesDirty = true;
    }
  }

  return { deactivated };
}

export function listActiveSources(store) {
  return store.sources
    .filter((s) => s.active)
    .sort((a, b) => a.id - b.id)
    .map(sourceRow);
}

export function markFetch(store, id, { status, etag, lastModified, title, siteUrl }) {
  const s = store.sources.find((x) => x.id === id);
  if (!s) return;
  s.lastFetchedAt = Date.now();
  s.lastStatus = status;
  // SQL 里这几个字段是 COALESCE(?, col)：没拿到新值就保留旧值
  if (etag != null) s.etag = etag;
  if (lastModified != null) s.lastModified = lastModified;
  if (title != null) s.title = title;
  if (siteUrl != null) s.siteUrl = siteUrl;
  store.sourcesDirty = true;
}

export function findPostByLink(store, sourceId, link) {
  const id = store.linkIndex.get(`${sourceId}\n${link}`);
  return id === undefined ? undefined : { id };
}

export function insertPost(store, post) {
  const guidKey = `${post.sourceId}\n${post.guid}`;
  if (store.guidIndex.has(guidKey)) return false;

  store.posts.push({
    id: post.id,
    sourceId: post.sourceId,
    guid: post.guid,
    title: post.title,
    link: post.link,
    author: post.author ?? null,
    publishedAt: post.publishedAt,
    fetchedAt: post.fetchedAt,
    contentHtml: post.contentHtml ?? null,
    summary: post.summary ?? null,
  });
  store.guidIndex.add(guidKey);
  store.linkIndex.set(`${post.sourceId}\n${post.link}`, post.id);
  store.postsDirty = true;
  return true;
}

// 排序与 SQL 的 ORDER BY published_at DESC, id DESC 一致；
// id 是 sha256 前缀，按二进制字典序比。
function byNewest(a, b) {
  if (a.published_at !== b.published_at) return b.published_at - a.published_at;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

function joinSources(store) {
  return new Map(store.sources.map((s) => [s.id, s]));
}

export function listPosts(store, { limit, offset = 0, sourceId = null } = {}) {
  const byId = joinSources(store);
  const rows = [];
  for (const p of store.posts) {
    const s = byId.get(p.sourceId);
    if (!s) continue; // 源行不存在的文章不出现在列表里，与 INNER JOIN 一致
    if (sourceId !== null && p.sourceId !== sourceId) continue;
    rows.push(postRow(p, s));
  }
  rows.sort(byNewest);
  return rows.slice(offset, limit == null ? rows.length : offset + limit);
}

export function countPosts(store, sourceId = null) {
  if (sourceId === null) return store.posts.length;
  let n = 0;
  for (const p of store.posts) if (p.sourceId === sourceId) n += 1;
  return n;
}

export function getPost(store, id) {
  const p = store.posts.find((x) => x.id === id);
  if (!p) return undefined;
  const s = store.sources.find((x) => x.id === p.sourceId);
  return s ? postRow(p, s) : undefined;
}

export function getSource(store, id) {
  const s = store.sources.find((x) => x.id === id);
  return s ? sourceRow(s) : undefined;
}

export function listSourcesWithCounts(store) {
  return [...store.sources]
    .sort((a, b) => Number(b.active) - Number(a.active) || a.id - b.id)
    .map((s) => {
      let postCount = 0;
      let latestAt = null;
      for (const p of store.posts) {
        if (p.sourceId !== s.id) continue;
        postCount += 1;
        if (latestAt === null || p.publishedAt > latestAt) latestAt = p.publishedAt;
      }
      return { ...sourceRow(s), post_count: postCount, latest_at: latestAt };
    });
}

export function getStats(store) {
  let active = 0;
  for (const s of store.sources) if (s.active) active += 1;

  let oldest = null;
  let newest = null;
  for (const p of store.posts) {
    if (oldest === null || p.publishedAt < oldest) oldest = p.publishedAt;
    if (newest === null || p.publishedAt > newest) newest = p.publishedAt;
  }

  return {
    sources: { total: store.sources.length, active },
    posts: { total: store.posts.length, oldest, newest },
  };
}
