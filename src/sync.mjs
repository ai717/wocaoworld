import { fetchFeed } from './fetch-feed.mjs';
import { parseFeed } from './parse-feed.mjs';
import { toSafeHtml, toSummary, clampContent } from './sanitize.mjs';
import {
  reconcileSources,
  listActiveSources,
  markFetch,
  findPostByLink,
  insertPost,
  postId,
} from './db.mjs';

export const MAX_ITEMS_PER_SOURCE = 100;
const SOURCE_DELAY_MS = 1500;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function syncSource(db, source, log) {
  const started = Date.now();
  try {
    const res = await fetchFeed(source.url, {
      etag: source.etag ?? undefined,
      lastModified: source.last_modified ?? undefined,
    });

    if (res.status === 'not-modified') {
      markFetch(db, source.id, {
        status: 'not-modified',
        etag: res.etag,
        lastModified: res.lastModified,
      });
      log(`  = ${source.url} 未变更`);
      return { added: 0, skipped: 0, failed: false };
    }

    const feed = parseFeed(res.text, res.finalUrl);
    markFetch(db, source.id, {
      status: 'ok',
      etag: res.etag,
      lastModified: res.lastModified,
      title: feed.meta.title || null,
      siteUrl: feed.meta.siteUrl || null,
    });

    const storeFullText = source.mode === 'full';
    let added = 0;
    let skipped = 0;
    let truncated = 0;

    for (const item of feed.items.slice(0, MAX_ITEMS_PER_SOURCE)) {
      // 镜像站必须能把读者导回原文，没有永久链接的条目直接跳过
      if (!item.link) {
        skipped += 1;
        continue;
      }
      if (findPostByLink(db, source.id, item.link)) {
        skipped += 1;
        continue;
      }

      // 正文里的相对地址以文章永久链接为基准，而不是 feed 地址
      const safeHtml = toSafeHtml(item.content, {
        isHtml: item.contentIsHtml,
        baseUrl: item.link,
      });
      const summary = toSummary(safeHtml);
      const clamped = clampContent(safeHtml);
      if (clamped.truncated) truncated += 1;

      const inserted = insertPost(db, {
        id: postId(source.url, item.guid),
        sourceId: source.id,
        guid: item.guid,
        title: item.title,
        link: item.link,
        author: item.author || null,
        publishedAt: item.publishedAt ?? Date.now(),
        fetchedAt: started,
        contentHtml: storeFullText && !clamped.truncated ? clamped.html : null,
        summary: summary || null,
      });
      if (inserted) added += 1;
      else skipped += 1;
    }

    const label = feed.meta.title || source.url;
    const notes = [
      `${label}: 新增 ${added}`,
      `跳过 ${skipped}`,
      feed.items.length > MAX_ITEMS_PER_SOURCE ? `源内共 ${feed.items.length} 条仅取前 ${MAX_ITEMS_PER_SOURCE}` : null,
      truncated ? `${truncated} 篇正文超长已省略` : null,
      storeFullText ? null : 'excerpt 模式只存摘要',
    ].filter(Boolean);
    log(`  + ${notes.join('，')}`);
    return { added, skipped, failed: false };
  } catch (err) {
    markFetch(db, source.id, { status: `失败: ${err.message}` });
    log(`  ! ${source.url} → ${err.message}`);
    return { added: 0, skipped: 0, failed: true };
  }
}

/** @returns {Promise<number>} 失败的源数量，>0 时调用方应以非零码退出 */
export async function runSync(db, config, log = console.log) {
  const { deactivated } = reconcileSources(db, config.sources);
  const sources = listActiveSources(db);
  log(
    `开始同步 ${sources.length} 个订阅源` +
      (deactivated ? `（本次停用 ${deactivated} 个已从 config 移除的源）` : ''),
  );

  let addedTotal = 0;
  let failed = 0;
  for (const [index, source] of sources.entries()) {
    // 源之间串行并留间隔，避免同时打满对方服务器
    if (index > 0) await sleep(SOURCE_DELAY_MS);
    const result = await syncSource(db, source, log);
    addedTotal += result.added;
    if (result.failed) failed += 1;
  }

  log(`同步完成：新增 ${addedTotal} 篇，失败 ${failed}/${sources.length} 个源`);
  return failed;
}
