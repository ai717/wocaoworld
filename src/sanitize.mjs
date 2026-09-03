import sanitizeHtml from 'sanitize-html';

export const MAX_CONTENT_BYTES = 200 * 1024;
const SUMMARY_LENGTH = 300;

const ALLOWED_TAGS = [
  'p', 'br', 'hr', 'a', 'img', 'figure', 'figcaption',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'blockquote', 'pre', 'code', 'kbd', 'samp', 'var',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'strong', 'b', 'em', 'i', 's', 'del', 'ins', 'u', 'sub', 'sup', 'mark', 'small', 'abbr',
  'span', 'div',
  'table', 'caption', 'colgroup', 'col', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
  'details', 'summary',
  'picture', 'source', 'video', 'audio',
];

const ALLOWED_ATTRIBUTES = {
  // rel/target 由 transformTags 注入，必须在此放行否则会被白名单过滤掉
  a: ['href', 'title', 'name', 'id', 'rel', 'target'],
  img: ['src', 'alt', 'title', 'width', 'height', 'loading', 'referrerpolicy'],
  source: ['src', 'srcset', 'type', 'media', 'width', 'height'],
  video: ['src', 'poster', 'width', 'height', 'controls', 'preload'],
  audio: ['src', 'controls', 'preload'],
  td: ['colspan', 'rowspan'],
  th: ['colspan', 'rowspan', 'scope'],
  col: ['span', 'width'],
  details: ['open'],
  abbr: ['title'],
  '*': [],
};

// class/style 一律不允许：外部 HTML 的样式会污染本站排版，且 style 是 XSS 常见载体
const STRIP_OPTIONS = {
  allowedTags: [],
  allowedAttributes: {},
};

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

function resolveUrl(value, baseUrl) {
  if (!value) return '';
  try {
    return new URL(String(value).trim(), baseUrl).href;
  } catch {
    return '';
  }
}

function plainTextToHtml(text) {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${esc(block).replace(/\n/g, '<br>\n')}</p>`)
    .join('\n');
}

/**
 * 把 feed 正文转成可安全直接插入页面的 HTML。
 * content 是不可信的外部输入，任何绕过这里的路径都等于开 XSS。
 */
export function toSafeHtml(content, { isHtml = false, baseUrl = '' } = {}) {
  const raw = String(content ?? '');
  if (!raw.trim()) return '';
  if (!isHtml) return plainTextToHtml(raw);

  return sanitizeHtml(raw, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRIBUTES,
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: { img: ['http', 'https', 'data'], source: ['http', 'https', 'data'] },
    allowedSchemesToApplyToAttributes: ['href', 'src', 'srcset'],
    allowProtocolRelative: true,
    disallowedTagsMode: 'discard',
    nonTextTags: ['script', 'style', 'textarea', 'noscript', 'iframe', 'object', 'embed', 'template'],
    selfClosing: ['img', 'br', 'hr', 'source'],
    transformTags: {
      a: (tag, attribs) => {
        const href = resolveUrl(attribs.href, baseUrl);
        // 解析不出来的链接直接去掉 href，留下文字，不产出指向本站的假链接
        return {
          tagName: tag,
          attribs: href
            ? { ...attribs, href, rel: 'external nofollow noopener noreferrer', target: '_blank' }
            : { ...attribs, href: undefined, rel: undefined, target: undefined },
        };
      },
      img: (tag, attribs) => ({
        tagName: tag,
        attribs: { ...attribs, src: resolveUrl(attribs.src, baseUrl), loading: 'lazy', referrerpolicy: 'no-referrer' },
      }),
      source: (tag, attribs) => ({
        tagName: tag,
        attribs: { ...attribs, src: resolveUrl(attribs.src, baseUrl), srcset: undefined },
      }),
      // 外部正文里的 h1 会和本站标题重复，统一降级
      h1: 'h2',
    },
    exclusiveFilter: (frame) => frame.tag === 'img' && !frame.attribs?.src,
  });
}

/** 正文清洗后仍超过上限时不做 HTML 截断（会切出半个标签），整段丢弃改用摘要+原文链接 */
export function clampContent(html) {
  if (!html) return { html: '', truncated: false };
  if (Buffer.byteLength(html, 'utf8') <= MAX_CONTENT_BYTES) return { html, truncated: false };
  return { html: '', truncated: true };
}

const BLOCK_CLOSE = /<\/(p|div|li|dt|dd|h[1-6]|blockquote|pre|tr|figcaption|section|article)>/gi;

export function toSummary(html, maxLength = SUMMARY_LENGTH) {
  if (!html) return '';
  // 块级元素之间补一个分隔，否则剥掉标签后相邻段落文本会粘连
  const spaced = String(html).replace(BLOCK_CLOSE, '\n');
  const text = sanitizeHtml(spaced, STRIP_OPTIONS)
    .replace(/[ \t\r\f\v]+/g, ' ')
    .replace(/\s*\n\s*/g, ' ')
    .trim();
  // 中文没有空格分词，不按词边界回退，直接硬切
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}
