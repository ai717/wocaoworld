import { copyFileSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { distDir, publicDir } from './config.mjs';
import { makeUrls } from './urls.mjs';
import { countPosts, getStats, listPosts, listSourcesWithCounts } from './store.mjs';
import { esc } from './sanitize.mjs';
import {
  renderAbout,
  renderFeedXml,
  renderList,
  renderNotFound,
  renderPost,
  renderSources,
} from './render.mjs';

// 聚合输出给别人订阅用，30 条足够，避免把整个库塞进一个文件
const FEED_LIMIT = 30;

function summarize(stats) {
  return {
    posts: stats.posts.total ?? 0,
    sources: stats.sources.active ?? 0,
    oldest: stats.posts.oldest ?? null,
    newest: stats.posts.newest ?? null,
  };
}

function sourceNote(source, count) {
  const name = esc(source.title ?? source.url);
  return `来自订阅源 <a href="${esc(source.site_url ?? source.url)}" rel="external nofollow noopener noreferrer" target="_blank">${name}</a>${
    source.mode === 'excerpt' ? '（仅摘要模式，正文请回原文阅读）' : '（全文镜像）'
  }。共 ${count} 篇。`;
}

function copyPublic(dist) {
  let n = 0;
  const walk = (dir, rel) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const childRel = path.join(rel, entry.name);
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), childRel);
        continue;
      }
      const target = path.join(dist, childRel);
      mkdirSync(path.dirname(target), { recursive: true });
      copyFileSync(path.join(dir, entry.name), target);
      n += 1;
    }
  };
  walk(publicDir(), '');
  return n;
}

export function runBuild(config, store, log = console.log) {
  const dist = distDir();
  // dist/ 是纯产物，整体重建；增量写会让被删掉的文章留下孤儿目录，越积越多
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(dist, { recursive: true });

  const urls = makeUrls(config.site.basePath, config.site.origin);
  const perPage = config.site.postsPerPage;
  let pages = 0;

  const write = (rel, body) => {
    const target = path.join(dist, rel);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, body);
    pages += 1;
  };

  const total = countPosts(store);
  const totalPages = Math.max(1, Math.ceil(total / perPage));

  for (let page = 1; page <= totalPages; page += 1) {
    const posts = listPosts(store, { limit: perPage, offset: (page - 1) * perPage });
    write(
      page === 1 ? 'index.html' : `page/${page}/index.html`,
      renderList({ config, posts, page, totalPages }),
    );
  }

  for (const post of listPosts(store, { limit: total })) {
    write(`p/${post.id}/index.html`, renderPost({ config, post }));
  }

  const sources = listSourcesWithCounts(store);
  let sourcePages = 0;
  for (const source of sources) {
    const sTotal = source.post_count;
    const sPages = Math.max(1, Math.ceil(sTotal / perPage));
    const heading = source.title ?? source.url;
    const note = sourceNote(source, sTotal);
    // base 必须已带 basePath，renderList 的分页链接会在它后面接 /page/n/
    const base = urls.sourceUrl(source.id);
    for (let page = 1; page <= sPages; page += 1) {
      const posts = listPosts(store, {
        limit: perPage,
        offset: (page - 1) * perPage,
        sourceId: source.id,
      });
      write(
        page === 1 ? `s/${source.id}/index.html` : `s/${source.id}/page/${page}/index.html`,
        renderList({ config, posts, page, totalPages: sPages, heading, note, active: '', base }),
      );
      sourcePages += 1;
    }
  }

  write('sources/index.html', renderSources({ config, sources }));
  write('about/index.html', renderAbout({ config, stats: summarize(getStats(store)) }));
  write('404.html', renderNotFound({ config }));
  write('feed.xml', renderFeedXml({ config, posts: listPosts(store, { limit: FEED_LIMIT }) }));

  // GitHub Pages 默认跑 Jekyll，会对 HTML 做 Liquid 模板处理。本站镜像的是
  // 外部博客正文，完全可能真的出现 {{ }}，必须用一个空文件彻底关掉。
  write('.nojekyll', '');

  const assets = copyPublic(dist);

  log(`构建完成 → ${dist}`);
  log(`  basePath: ${config.site.basePath || '(无)'}`);
  log(`  ${total} 篇文章 / ${sources.length} 个源 / 首页 ${totalPages} 页 / 源页 ${sourcePages} 页`);
  log(`  写出 ${pages} 个页面 + ${assets} 个静态资源`);

  return { dist, files: pages + assets, pages, assets, posts: total, sources: sources.length, totalPages };
}
