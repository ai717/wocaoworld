import { esc } from './sanitize.mjs';
import { makeUrls } from './urls.mjs';

const urlsOf = (config) => makeUrls(config.site.basePath, config.site.origin);

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

function layout({ config, urls, title, description, active = '', canonical = '', ogType = 'website', head = '', body }) {
  const { site } = config;
  const pageTitle = title ? `${title} · ${site.title}` : site.title;
  const desc = description || site.description;
  const canonicalUrl = canonical || urls.absolute(urls.u('/'));
  return `<!DOCTYPE html>
<html lang="${esc(site.lang)}">
<head>
<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-8TX501TYGH"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());

  gtag('config', 'G-8TX501TYGH');
</script>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(pageTitle)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(canonicalUrl)}">
<link rel="icon" type="image/svg+xml" href="${urls.u('/favicon.svg')}">
<meta property="og:type" content="${ogType}">
<meta property="og:site_name" content="${esc(site.title)}">
<meta property="og:title" content="${esc(pageTitle)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(canonicalUrl)}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${esc(pageTitle)}">
<meta name="twitter:description" content="${esc(desc)}">
${site.noindex ? '<meta name="robots" content="noindex,follow">\n' : '<meta name="robots" content="index,follow">\n'}<link rel="alternate" type="application/rss+xml" title="${esc(site.title)} 聚合输出" href="${urls.u('/feed.xml')}">
<link rel="stylesheet" href="${urls.u('/style.css')}">
${head}</head>
<body>
<a class="skip-link" href="#main">跳到正文</a>
<header class="site-head">
<p class="site-title"><a href="${urls.u('/')}">${esc(site.title)}</a></p>
<p class="site-desc">${esc(site.description)}</p>
<nav class="site-nav">
${navItem(urls.u('/'), '最新', active)}
${navItem(urls.u('/about/'), '关于', active)}
${navItem(urls.u('/feed.xml'), 'RSS', active)}
</nav>
</header>
<main id="main">
${body}
</main>
<footer class="site-foot">
<p>${esc(site.footer || `${site.title} — 本站内容全部转载自各订阅源，版权归原作者与原站所有。`)}</p>
</footer>
</body>
</html>
`;
}

function postMeta(urls, post, lang) {
  const parts = [`<time datetime="${isoDate(post.published_at)}">${formatDate(post.published_at, lang)}</time>`];
  parts.push(`来自 <a href="${urls.sourceUrl(post.source_id)}">${esc(post.source_title ?? '未知来源')}</a>`);
  if (post.author) parts.push(`作者 ${esc(post.author)}`);
  if (post.source_mode === 'excerpt') parts.push('仅摘要');
  return parts.join(' · ');
}

function postCard(urls, post, lang) {
  return `<article class="post-card">
<h2 class="post-card-title"><a href="${urls.postUrl(post.id)}">${esc(post.title)}</a></h2>
<p class="meta"><time datetime="${isoDate(post.published_at)}">${formatDate(post.published_at, lang)}</time></p>
${post.summary ? `<p class="excerpt">${esc(post.summary)}</p>` : ''}
</article>`;
}

export function renderList({ config, posts, page, totalPages, heading, note, active = '最新', base = '' }) {
  const urls = urlsOf(config);
  const lang = config.site.lang;
  // base 为来源筛选页时，翻页必须留在该来源下，否则会跳回全站列表
  const href = (n) => urls.pagedUrl(base || urls.u('/'), n);
  const items = posts.length
    ? posts.map((post) => postCard(urls, post, lang)).join('\n')
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

  const currentPath = page === 1 ? (base || urls.u('/')) : href(page);
  const canonical = urls.absolute(currentPath);

  return layout({ config, urls, title: heading, canonical, active, body });
}

export function renderPost({ config, post }) {
  const urls = urlsOf(config);
  const lang = config.site.lang;
  const canonical = urls.absolute(urls.postUrl(post.id));

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    'headline': post.title,
    'description': post.summary || post.title,
    'url': canonical,
    'datePublished': isoDate(post.published_at),
    'dateModified': isoDate(post.fetched_at || post.published_at),
    'mainEntityOfPage': {
      '@type': 'WebPage',
      '@id': canonical
    },
    'author': {
      '@type': 'Person',
      'name': post.author || post.source_title || config.site.title
    },
    'publisher': {
      '@type': 'Organization',
      'name': config.site.title,
      'url': config.site.url
    }
  };

  const head = `<meta property="article:published_time" content="${isoDate(post.published_at)}">
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
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
${bodyHtml}
<p class="back"><a href="${urls.u('/')}">← 返回最新</a></p>
</article>`;

  return layout({ config, urls, title: post.title, description: post.summary ?? undefined, canonical, ogType: 'article', head, body, active: '' });
}

export function renderSources({ config, sources }) {
  const urls = urlsOf(config);
  const lang = config.site.lang;
  const canonical = urls.absolute(urls.u('/sources/'));
  const rows = sources.map((s) => {
    const status = s.last_status ?? '未同步';
    const ok = status === 'ok' || status === 'not-modified';
    return `<tr>
<td><a href="${urls.sourceUrl(s.id)}">${esc(s.title ?? s.url)}</a>${s.active ? '' : ' <span class="badge">已停用</span>'}</td>
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

  return layout({ config, urls, title: '订阅源', canonical, active: '订阅源', body });
}

export function renderAbout({ config, stats }) {
  const urls = urlsOf(config);
  const { site } = config;
  const canonical = urls.absolute(urls.u('/about/'));
  const body = `<h1 class="list-heading">关于</h1>
<div class="post-body">
<p>${esc(site.description)}</p>
<p>这是一个<strong>自动聚合博客</strong>：程序抓取若干 RSS / Atom / JSON Feed 订阅源，把其中的条目原样镜像成本站文章，全程无人工写作。当前库内有 ${
    stats.posts
  } 篇文章，来自 ${stats.sources} 个订阅源。</p>
<h2>版权说明</h2>
<p>本站不拥有任何文章的版权。每篇文章页都保留了原文永久链接、来源名称与原作者署名，正文内所有链接均指向原站。若你是某篇文章的版权方并希望本站停止镜像，请从 <code>config.json</code> 的源清单中移除对应订阅源，或联系站长处理。</p>
<h2>关于收录</h2>
<p>${
    site.noindex
      ? '本站处于调试维护状态，输出 <code>noindex,follow</code>。'
      : '本站已开放搜索引擎收录，欢迎订阅 RSS 或通过站点地图获取最新内容。'
  }</p>
<h2>技术实现</h2>
<p>纯 Node.js 标准库实现：原生 <code>fetch</code> 抓取、JSON 快照存储、模板字符串渲染，本地构建成静态文件后托管，仅引入 XML 解析与 HTML 清洗两个依赖。所有外部正文经白名单清洗后才入库。</p>
</div>
<p class="back"><a href="${urls.u('/')}">← 返回最新</a></p>`;

  return layout({ config, urls, title: '关于', canonical, active: '关于', body });
}

export function renderNotFound({ config }) {
  const urls = urlsOf(config);
  const body = `<h1 class="list-heading">404 · 页面不存在</h1>
<p class="empty">要找的东西不在这里。</p>
<p class="back"><a href="${urls.u('/')}">← 返回最新</a></p>`;
  return layout({ config, urls, title: '404', body });
}

export function renderFeedXml({ config, posts }) {
  const urls = urlsOf(config);
  const { site } = config;
  const selfUrl = urls.absolute(urls.u('/feed.xml'));
  const items = posts
    .map((post) => {
      const permalink = urls.absolute(urls.postUrl(post.id));
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
