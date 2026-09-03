import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { dataDir } from './config.mjs';

export const DB_FILE = 'blog.sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sources (
  id              INTEGER PRIMARY KEY,
  url             TEXT UNIQUE NOT NULL,
  title           TEXT,
  site_url        TEXT,
  mode            TEXT NOT NULL DEFAULT 'full',
  active          INTEGER NOT NULL DEFAULT 1,
  etag            TEXT,
  last_modified   TEXT,
  last_fetched_at INTEGER,
  last_status     TEXT
);

CREATE TABLE IF NOT EXISTS posts (
  id           TEXT PRIMARY KEY,
  source_id    INTEGER NOT NULL REFERENCES sources(id),
  guid         TEXT NOT NULL,
  title        TEXT NOT NULL,
  link         TEXT NOT NULL,
  author       TEXT,
  published_at INTEGER NOT NULL,
  fetched_at   INTEGER NOT NULL,
  content_html TEXT,
  summary      TEXT,
  UNIQUE(source_id, guid)
);

CREATE INDEX IF NOT EXISTS idx_posts_published ON posts(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_source    ON posts(source_id, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_link      ON posts(source_id, link);
`;

export function postId(sourceUrl, guid) {
  return createHash('sha256').update(`${sourceUrl}\n${guid}`).digest('hex').slice(0, 12);
}

export function openDb(dir = dataDir()) {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, DB_FILE);
  const db = new DatabaseSync(file);

  // Web 与 sync 是两个进程共用这个库文件，WAL 让读写不互斥。
  const journalMode = db.prepare('PRAGMA journal_mode = WAL').get().journal_mode;
  if (String(journalMode).toLowerCase() !== 'wal') {
    throw new Error(`无法为 ${file} 启用 WAL（当前 ${journalMode}）`);
  }
  db.prepare('PRAGMA busy_timeout = 5000').run();
  db.prepare('PRAGMA synchronous = NORMAL').run();
  db.prepare('PRAGMA foreign_keys = ON').run();
  db.exec(SCHEMA);
  return db;
}

export function reconcileSources(db, configSources) {
  const upsert = db.prepare(`
    INSERT INTO sources (url, mode, active) VALUES (?, ?, 1)
    ON CONFLICT(url) DO UPDATE SET mode = excluded.mode, active = 1
  `);
  for (const source of configSources) upsert.run(source.url, source.mode);

  const deactivate = configSources.length
    ? db.prepare(
        `UPDATE sources SET active = 0
         WHERE active = 1 AND url NOT IN (${configSources.map(() => '?').join(',')})`,
      )
    : db.prepare('UPDATE sources SET active = 0 WHERE active = 1');
  const deactivated = deactivate.run(...configSources.map((s) => s.url)).changes;

  return { deactivated };
}

export function listActiveSources(db) {
  return db.prepare('SELECT * FROM sources WHERE active = 1 ORDER BY id').all();
}

export function markFetch(db, id, { status, etag, lastModified, title, siteUrl }) {
  db.prepare(
    `UPDATE sources SET
       last_fetched_at = ?,
       last_status     = ?,
       etag            = COALESCE(?, etag),
       last_modified   = COALESCE(?, last_modified),
       title           = COALESCE(?, title),
       site_url        = COALESCE(?, site_url)
     WHERE id = ?`,
  ).run(Date.now(), status, etag ?? null, lastModified ?? null, title ?? null, siteUrl ?? null, id);
}

export function findPostByLink(db, sourceId, link) {
  return db
    .prepare('SELECT id FROM posts WHERE source_id = ? AND link = ? LIMIT 1')
    .get(sourceId, link);
}

export function insertPost(db, post) {
  const result = db.prepare(
    `INSERT OR IGNORE INTO posts
       (id, source_id, guid, title, link, author, published_at, fetched_at, content_html, summary)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    post.id,
    post.sourceId,
    post.guid,
    post.title,
    post.link,
    post.author ?? null,
    post.publishedAt,
    post.fetchedAt,
    post.contentHtml ?? null,
    post.summary ?? null,
  );
  return result.changes > 0;
}

export function listPosts(db, { limit, offset = 0, sourceId = null } = {}) {
  const sql = `
    SELECT p.*, s.title AS source_title, s.url AS source_url,
            s.site_url AS source_site, s.mode AS source_mode
    FROM posts p JOIN sources s ON s.id = p.source_id
    ${sourceId === null ? '' : 'WHERE p.source_id = ?'}
    ORDER BY p.published_at DESC, p.id DESC
    LIMIT ? OFFSET ?
  `;
  const params = sourceId === null ? [limit, offset] : [sourceId, limit, offset];
  return db.prepare(sql).all(...params);
}

export function countPosts(db, sourceId = null) {
  const row =
    sourceId === null
      ? db.prepare('SELECT COUNT(*) AS n FROM posts').get()
      : db.prepare('SELECT COUNT(*) AS n FROM posts WHERE source_id = ?').get(sourceId);
  return row.n;
}

export function getPost(db, id) {
  return db.prepare(
    `SELECT p.*, s.title AS source_title, s.url AS source_url,
            s.site_url AS source_site, s.mode AS source_mode
     FROM posts p JOIN sources s ON s.id = p.source_id
     WHERE p.id = ?`,
  ).get(id);
}

export function getSource(db, id) {
  return db.prepare('SELECT * FROM sources WHERE id = ?').get(id);
}

export function listSourcesWithCounts(db) {
  return db.prepare(
    `SELECT s.*, COUNT(p.id) AS post_count,
            MAX(p.published_at) AS latest_at
     FROM sources s LEFT JOIN posts p ON p.source_id = s.id
     GROUP BY s.id
     ORDER BY s.active DESC, s.id`,
  ).all();
}

export function getStats(db) {
  const sources = db
    .prepare('SELECT COUNT(*) AS total, SUM(active) AS active FROM sources')
    .get();
  const posts = db
    .prepare('SELECT COUNT(*) AS total, MIN(published_at) AS oldest, MAX(published_at) AS newest FROM posts')
    .get();
  return { sources, posts };
}
