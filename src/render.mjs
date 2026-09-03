import { esc } from './sanitize.mjs';

const postUrl = (id) => `/p/${id}`;
const sourceUrl = (id) => `/s/${id}`;
const pageUrl = (page) => (page <= 1 ? '/' : `/page/${page}`);

function absoluteUrl(siteUrl, path) {
  return `${siteUrl}${path}`;
}

const dateFmt = new Map();
function formatter(lang, options) {
  const key = `${lang}|${JSON.stringify(options)}`;
  let fmt = dateFmt.get(key);
  if (!fmt) {
    try {
      fmt = new Intl.DateTimeFormat(lang, options);
    } catch {
      fmt = new Intl.DateTimeFormat('en-CA', options);
    }
    dateFmt.set(key, fmt);
  }
  return fmt;
}

function formatDate(ms, lang) {
  if (!ms) return '';
  return formatter(lang, { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'UTC' }).format(ms);
}

function formatDateTime(ms, lang) {
  if (!ms) return '';
  return formatter(lang, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
    hour12: false,
  }).format(ms);
}

function isoDate(ms) {
  return ms ? new Date(ms).toISOString() : '';
}

function rfc822(ms) {
  return ms ? new Date(ms).toUTCString() : '';
}

function navItem(href, label, active) {
  return active === label
    ? `<a href="${href}" aria-current="page">${label}</a>`
    : `<a href="${href}">${label}</a>`;
}

function layout({ config, title, description, active = '', head = '', body }) {
  const { site } = config;
  const pageTitle = title ? `${title} · ${site.title}` : site.title;
  const desc = description || site.description;
  return `<!DOCTYPE html>
<html lang="${esc(site.lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(pageTitle)}</title>
<meta name="description" content="${esc(desc)}">
${site.noindex ? '<meta name="robots" content="noindex,follow">\n' : ''}<link rel="alternate" type="application/rss+xml" title="${esc(site.title)} 聚合输出" href="/feed.xml">
<link rel="stylesheet" href="/style.css">
${head}</head>
<body>
<a class="skip-link" href="#main">跳到正文</a>
<header class="site-head">
<p class="site-title"><a href="/">${esc(site.title)}</a></p>
<p class="site-desc">${esc(site.description)}</p>
<nav class="site-nav">
${navItem('/', '最新', active)}
${navItem('/sources/', '订阅源', active)}
${navItem('/about/', '关于', active)}
${navItem('/feed.xml', 'RSS', active)}
</nav>
</header>
<main id="main">
${body}
</main>
<footer class="site-foot">
<p>${esc(site.title)} — 本站内容全部转载自各订阅源，版权归原作者与原站所有。</p>
</footer>
</body>
</html>
`;
}

function postMeta(post, lang) {
  const parts = [`<time datetime="${isoDate(post.published_at)}">${formatDate(post.published_at, lang)}</time>`];
  parts.push(`来自 <a href="${sourceUrl(post.source_id)}">${esc(post.source_title ?? '未知来源')}</a>`);
  if (post.author) parts.push(`作者 ${esc(post.author)}`);
  if (post.source_mode === 'excerpt') parts.push('仅摘要');
  return parts.join(' · ');
}

function postCard(post, lang) {
  return `<article class="post-card">
<h2 class="post-card-title"><a href="${postUrl(post.id)}">${esc(post.title)}</a></h2>
<p class="meta">${postMeta(post, lang)}</p>
${post.summary ? `<p class="excerpt">${esc(post.summary)}</p>` : ''}
</article>`;
}

export function renderList({ config, posts, page, totalPages, heading, note, active = '最新', base = '' }) {
  const lang = config.site.lang;
  // base 为来源筛选页时，翻页必须留在该来源下，否则会跳回全站列表
  const href = (n) => (base ? (n <= 1 ? base : `${base}/page/${n}`) : pageUrl(n));
  const items = posts.length
    ? posts.map((post) => postCard(post, lang)).join('\n')
    : '<p class="empty">还没有文章。先跑一次 <code>npm run sync</code>。</p>';

  const pager =
    totalPages > 1
      ? `<nav class="pagination" aria-label="分页">
${page > 1 ? `<a href="${href(page - 1)}" rel="prev">← 上一页</a>` : '<span class="disabled">← 上一页</span>'}
<span class="page-indicator">第 ${page} / ${totalPages} 页</span>
${page < totalPages ? `<a href="${href(page + 1)}" rel="next">下一页 →</a>` : '<span class="disabled">下一页 →</span>'}
</nav>`
      : '';

  const body = `${heading ? `<h1 class="list-heading">${esc(heading)}</h1>` : ''}
${note ? `<p class="note">${note}</p>` : ''}
${items}
${pager}`;

  return layout({ config, title: heading, active, body });
}

export function renderPost({ config, post }) {
  const lang = config.site.lang;
  const original = esc(post.link);
  // 镜像页的 canonical 指向原文，这是给搜索引擎的正确信号
  const head = `<link rel="canonical" href="${original}">
`;
  const bodyHtml = post.content_html
    ? `<div class="post-body">${post.content_html}</div>`
    : `<div class="post-body">
<p class="notice">本站未保存这篇的正文${post.source_mode === 'excerpt' ? '（该订阅源配置为仅摘要模式）' : '（正文过长已省略）'}${
        post.summary ? '，以下是摘要：' : '。'
      }</p>
${post.summary ? `<blockquote class="excerpt-block"><p>${esc(post.summary)}</p></blockquote>` : ''}
</div>`;

  const body = `<article>
<h1 class="post-title">${esc(post.title)}</h1>
<p class="meta">${postMeta(post, lang)}</p>
<p class="meta origin">原文发布于 <a href="${original}" rel="external nofollow noopener noreferrer" target="_blank">${esc(
    new URL(post.link).hostname,
  )}</a></p>
${bodyHtml}
<footer class="post-foot">
<p>转载自 <a href="${original}" rel="external nofollow noopener noreferrer" target="_blank">${esc(
    post.source_title ?? post.link,
  )}</a>${post.author ? `，原作者 ${esc(post.author)}` : ''}。内容版权归原作者与原站所有，本站仅作归档与索引。</p>
<p class="back"><a href="/">← 返回最新</a></p>
</footer>
</article>`;

  return layout({ config, title: post.title, description: post.summary ?? undefined, head, body, active: '' });
}

export function renderSources({ config, sources }) {
  const lang = config.site.lang;
  const rows = sources.map((s) => {
    const status = s.last_status ?? '未同步';
    const ok = status === 'ok' || status === 'not-modified';
    return `<tr>
<td><a href="${sourceUrl(s.id)}">${esc(s.title ?? s.url)}</a>${s.active ? '' : ' <span class="badge">已停用</span>'}</td>
<td class="num">${s.post_count}</td>
<td>${esc(s.mode === 'excerpt' ? '仅摘要' : '全文')}</td>
<td>${s.last_fetched_at ? `<time datetime="${isoDate(s.last_fetched_at)}">${formatDateTime(s.last_fetched_at, lang)}</time>` : '—'}</td>
<td class="status ${ok ? 'ok' : 'bad'}">${esc(status)}</td>
</tr>`;
  });

  const body = `<h1 class="list-heading">订阅源</h1>
<p class="note">本站不生产内容，全部文章来自下列订阅源。源清单由 <code>config.json</code> 维护，不提供网页端添加入口。</p>
<div class="table-wrap">
<table class="sources">
<thead><tr><th scope="col">来源</th><th scope="col" class="num">文章</th><th scope="col">模式</th><th scope="col">最近同步</th><th scope="col">状态</th></tr></thead>
<tbody>
${rows.join('\n') || '<tr><td colspan="5">尚未配置任何订阅源。</td></tr>'}
</tbody>
</table>
</div>`;

  return layout({ config, title: '订阅源', active: '订阅源', body });
}

export function renderAbout({ config, stats }) {
  const { site } = config;
  const body = `<h1 class="list-heading">关于</h1>
<div class="post-body">
<p>${esc(site.description)}</p>
<p>这是一个<strong>自动聚合博客</strong>：程序定时抓取若干 RSS / Atom / JSON Feed 订阅源，把其中的条目原样镜像成本站文章，全程无人工写作。当前库内有 ${
    stats.posts
  } 篇文章，来自 ${stats.sources} 个订阅源。</p>
<h2>版权说明</h2>
<p>本站不拥有任何文章的版权。每篇文章页都保留了原文永久链接、来源名称与原作者署名，正文内所有链接均指向原站。若你是某篇文章的版权方并希望本站停止镜像，请从 <code>config.json</code> 的源清单中移除对应订阅源，或联系站长处理。</p>
<h2>关于收录</h2>
<p>${
    site.noindex
      ? '本站默认输出 <code>noindex,follow</code>，并在每篇镜像文章的 <code>&lt;link rel="canonical"&gt;</code> 中指向原文，避免与原创站点争抢搜索排名。'
      : '本站允许搜索引擎收录，但每篇镜像文章的 canonical 仍指向原文。'
  }</p>
<h2>技术实现</h2>
<p>纯 Node.js 标准库实现：内置 <code>node:sqlite</code> 存储、原生 <code>fetch</code> 抓取、模板字符串渲染，仅引入 XML 解析与 HTML 清洗两个依赖。所有外部正文经白名单清洗后才入库。</p>
</div>
<p class="back"><a href="/">← 返回最新</a></p>`;

  return layout({ config, title: '关于', active: '关于', body });
}

export function renderNotFound({ config }) {
  const body = `<h1 class="list-heading">404 · 页面不存在</h1>
<p class="empty">要找的东西不在这里。</p>
<p class="back"><a href="/">← 返回最新</a></p>`;
  return layout({ config, title: '404', body });
}

export function renderError({ config, message }) {
  const body = `<h1 class="list-heading">500 · 服务器错误</h1>
<p class="empty">${esc(message)}</p>
<p class="back"><a href="/">← 返回最新</a></p>`;
  return layout({ config, title: '错误', body });
}

export function renderFeedXml({ config, posts }) {
  const { site } = config;
  const selfUrl = absoluteUrl(site.url, '/feed.xml');
  const items = posts
    .map((post) => {
      const permalink = absoluteUrl(site.url, postUrl(post.id));
      const description = esc(
        `${post.summary ?? ''}\n\n原文链接: ${post.link}\n转载自: ${post.source_title ?? post.link}`,
      );
      return `    <item>
      <title>${esc(post.title)}</title>
      <link>${esc(permalink)}</link>
      <guid isPermaLink="false">${esc(post.id)}</guid>
      <pubDate>${rfc822(post.published_at)}</pubDate>
      <description>${description}</description>
    </item>`;
    })
    .join('\n');

  const lastBuild = posts.length ? rfc822(posts[0].fetched_at ?? posts[0].published_at) : rfc822(Date.now());

  return `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${esc(site.title)}</title>
    <link>${esc(site.url)}</link>
    <description>${esc(site.description)}</description>
    <language>${esc(site.lang)}</language>
    <atom:link href="${esc(selfUrl)}" rel="self" type="application/rss+xml"/>
    <lastBuildDate>${lastBuild}</lastBuildDate>
${items}
  </channel>
</rss>
`;
}
