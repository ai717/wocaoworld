import { XMLParser, XMLBuilder } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  cdataPropName: '__cdata',
  parseTagValue: false,
  trimValues: true,
  processEntities: true,
  htmlEntities: true,
});

const builder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  cdataPropName: '__cdata',
  format: false,
});

// preserveOrder 模式保留混排文本与子元素的先后顺序，普通模式会丢失，
// 因此 Atom 的 type="xhtml" 正文必须走这一套单独再解析一次。
const orderedParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  preserveOrder: true,
  trimValues: false,
  processEntities: true,
  htmlEntities: true,
  cdataPropName: '__cdata',
});

const orderedBuilder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  preserveOrder: true,
  format: false,
  trimValues: false,
  processEntities: true,
});

const LOOKS_LIKE_HTML = /<\/?[a-zA-Z][^>]*>/;

export function toArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

export function textOf(value) {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) return value.map(textOf).join('');
  if (typeof value === 'object') {
    if (value.__cdata !== undefined) return textOf(value.__cdata);
    if (value['#text'] !== undefined) return textOf(value['#text']);
    return '';
  }
  return String(value).trim();
}

function serializeNode(node) {
  if (node === undefined || node === null) return '';
  if (typeof node !== 'object') return String(node);
  const text = textOf(node);
  if (text) return text;
  const { '@_xmlns': _ns, ...rest } = node;
  try {
    return builder.build(rest);
  } catch {
    return '';
  }
}

function collectOrdered(nodes, tag, out = []) {
  if (!Array.isArray(nodes)) return out;
  for (const node of nodes) {
    if (node && typeof node === 'object') {
      if (Array.isArray(node[tag])) out.push(node[tag]);
      for (const value of Object.values(node)) collectOrdered(value, tag, out);
    }
  }
  return out;
}

function orderedNode(children, tag) {
  return children?.find((c) => Array.isArray(c?.[tag]));
}

function orderedText(children) {
  return (children ?? []).map((c) => c?.['#text'] ?? '').join('').trim();
}

const HAS_XHTML = /type\s*=\s*["']xhtml["']/i;

/**
 * 只对显式声明 type="xhtml" 的 content 重建 HTML。收进别的条目会被 XMLBuilder
 * 二次转义实体（&lt;p&gt; 变成字面文本），并让纯文本条目被误判成 HTML。
 * @returns {Map<string,string>|null} entry id → 忠实还原的 HTML
 */
function buildXhtmlMap(rawText) {
  if (!HAS_XHTML.test(rawText)) return null;
  let tree;
  try {
    tree = orderedParser.parse(rawText);
  } catch {
    return null;
  }
  const map = new Map();
  for (const entry of collectOrdered(tree, 'entry')) {
    const id = orderedText(orderedNode(entry, 'id')?.id);
    const node = orderedNode(entry, 'content');
    if (!id || !node) continue;
    if (String(node[':@']?.['@_type'] ?? '').toLowerCase() !== 'xhtml') continue;
    const html = orderedBuilder.build(node.content);
    if (html) map.set(id, html);
  }
  return map.size ? map : null;
}

export function parseDate(value, fallback = null) {
  const s = textOf(value);
  if (!s) return fallback;
  if (/^\d{10}$/.test(s)) return Number(s) * 1000;
  if (/^\d{13}$/.test(s)) return Number(s);
  const ms = Date.parse(s);
  return Number.isNaN(ms) ? fallback : ms;
}

function absolutize(value, base) {
  const s = textOf(value);
  if (!s) return '';
  try {
    return new URL(s, base).href;
  } catch {
    return '';
  }
}

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

/**
 * kind 缺省时按内容嗅探。Atom 规范默认是 text，但现实中大量 feed 省略 type
 * 却塞 HTML，所以以「看起来有没有标签」为准，两种情况都交给后续清洗兜底。
 */
function contentKind(rawType, rawText) {
  const type = textOf(rawType).toLowerCase();
  if (type === 'html' || type === 'xhtml') return 'html';
  if (type === 'text') return 'text';
  return LOOKS_LIKE_HTML.test(rawText) ? 'html' : 'text';
}

function authorOf(node) {
  if (!node) return '';
  if (typeof node === 'string') return node.trim();
  return textOf(node.name) || textOf(node['foaf:name']) || textOf(node.email);
}

function makeItem({ guid, title, link, author, publishedAt, content, baseUrl, kind }) {
  const resolvedLink = absolutize(link, baseUrl);
  const resolvedGuid = textOf(guid) || resolvedLink;
  if (!resolvedGuid) return null;

  const body = typeof content === 'string' ? content : serializeNode(content);
  const declaredType = content !== null && typeof content === 'object' ? content['@_type'] : undefined;

  return {
    guid: resolvedGuid,
    title: textOf(title) || '(无标题)',
    link: resolvedLink || (/^https?:\/\//i.test(resolvedGuid) ? resolvedGuid : ''),
    author: textOf(author),
    publishedAt,
    content: body,
    contentIsHtml: (kind ?? contentKind(declaredType, body)) === 'html',
  };
}

function fromRssItems(items, channel, feedUrl) {
  const meta = {
    title: textOf(channel?.title) || textOf(channel?.['dc:title']),
    siteUrl: absolutize(channel?.link, feedUrl) || originOf(feedUrl),
    description: textOf(channel?.description),
  };
  const parsed = toArray(items).map((item) =>
    makeItem({
      guid: item.guid ?? item['atom:id'] ?? item.link,
      title: item.title ?? item['dc:title'],
      link: item.link,
      author: authorOf(item['dc:creator'] ?? item.author ?? item['dc:contributor']),
      publishedAt: parseDate(item.pubDate ?? item['dc:date'] ?? item.published, null),
      content: item['content:encoded'] ?? item.description ?? item['dc:description'] ?? '',
      baseUrl: feedUrl,
    }),
  );
  return { meta, items: parsed.filter(Boolean) };
}

function fromAtom(feed, feedUrl, rawText) {
  const links = toArray(feed.link);
  const homeLink =
    links.find((l) => l && typeof l === 'object' && l['@_rel'] === 'alternate' && l['@_href'])?.['@_href'] ??
    links.find((l) => l && typeof l === 'object' && l['@_href'])?.['@_href'];

  const meta = {
    title: textOf(feed.title),
    siteUrl: absolutize(homeLink, feedUrl) || originOf(feedUrl),
    description: textOf(feed.subtitle),
  };

  const entries = toArray(feed.entry);
  const xhtmlMap = buildXhtmlMap(rawText);

  const items = entries.map((entry) => {
    const entryLinks = toArray(entry.link);
    const href =
      entryLinks.find((l) => l && typeof l === 'object' && l['@_rel'] === 'alternate' && l['@_href'])?.['@_href'] ??
      entryLinks.find((l) => l && typeof l === 'object' && l['@_href'])?.['@_href'] ??
      entryLinks.map(textOf).find(Boolean) ??
      '';

    const mapped = textOf(entry.id) ? xhtmlMap?.get(textOf(entry.id)) : undefined;

    return makeItem({
      guid: entry.id,
      title: entry.title,
      link: href,
      author: authorOf(entry.author ?? toArray(entry.contributor)[0]) || authorOf(feed.author),
      publishedAt:
        parseDate(entry.published, null) ?? parseDate(entry.updated, null) ?? parseDate(entry.created, null),
      content: mapped || entry.content || entry.summary,
      baseUrl: feedUrl,
      kind: mapped ? 'html' : undefined,
    });
  });

  return { meta, items: items.filter(Boolean) };
}

function fromJsonFeed(doc, feedUrl) {
  const meta = {
    title: textOf(doc.title),
    siteUrl: absolutize(doc.home_page_url, feedUrl) || originOf(feedUrl),
    description: textOf(doc.description),
  };
  const items = toArray(doc.items).map((item) =>
    makeItem({
      guid: item.id ?? item.url,
      title: item.title,
      link: item.url ?? item.id,
      author: authorOf(toArray(item.authors)[0] ?? item.author),
      publishedAt: parseDate(item.date_published ?? item.date_modified, null),
      content: String(item.content_html ?? item.content_text ?? item.summary ?? ''),
      baseUrl: feedUrl,
      kind: item.content_html != null ? 'html' : 'text',
    }),
  );
  return { meta, items: items.filter(Boolean) };
}

export function parseFeed(text, feedUrl) {
  const body = text.replace(/^\uFEFF/, '').trim();
  if (!body) throw new Error('feed 内容为空');

  if (body.startsWith('{')) {
    let doc;
    try {
      doc = JSON.parse(body);
    } catch (err) {
      throw new Error(`JSON Feed 解析失败: ${err.message}`);
    }
    if (!Array.isArray(doc.items)) throw new Error('JSON Feed 缺少 items 数组');
    return fromJsonFeed(doc, feedUrl);
  }

  let doc;
  try {
    doc = parser.parse(body);
  } catch (err) {
    throw new Error(`XML 解析失败: ${err.message}`);
  }

  if (doc.rss?.channel) return fromRssItems(doc.rss.channel.item, doc.rss.channel, feedUrl);
  if (doc.feed) return fromAtom(doc.feed, feedUrl, body);
  if (doc['rdf:RDF']) return fromRssItems(doc['rdf:RDF'].item, doc['rdf:RDF'].channel, feedUrl);
  // 有的站点把 RSS 直接放在 <channel> 根下
  if (doc.channel) return fromRssItems(doc.channel.item, doc.channel, feedUrl);

  const root = Object.keys(doc).find((k) => k !== '?xml');
  throw new Error(`无法识别的 feed 格式${root ? `（根元素 ${root}）` : ''}`);
}
