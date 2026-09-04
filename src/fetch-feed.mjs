const DEFAULT_USER_AGENT = 'wocao.world/0.2 (feed aggregator)';
const ACCEPT =
  'application/rss+xml, application/atom+xml, application/feed+json, application/xml;q=0.9, text/xml;q=0.9, application/json;q=0.8, */*;q=0.5';

export const TIMEOUT_MS = 15_000;
export const MAX_BYTES = 5 * 1024 * 1024;

function detectCharset(buffer, contentType) {
  const fromHeader = /charset\s*=\s*["']?([\w.-]+)/i.exec(contentType ?? '');
  if (fromHeader) return fromHeader[1];
  // XML 声明里的 encoding，只用 latin1 嗅探前若干字节，不影响正文解码
  const fromXml = /encoding\s*=\s*["']([\w.-]+)["']/i.exec(buffer.subarray(0, 200).toString('latin1'));
  return fromXml ? fromXml[1] : 'utf-8';
}

function decode(buffer, contentType) {
  const charset = detectCharset(buffer, contentType);
  try {
    return new TextDecoder(charset).decode(buffer);
  } catch {
    return new TextDecoder('utf-8').decode(buffer);
  }
}

async function readBodyCapped(res) {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BYTES) {
    throw new Error(`声明体积 ${declared} 字节，超过上限 ${MAX_BYTES}`);
  }

  if (!res.body) return Buffer.alloc(0);

  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      throw new Error(`响应体超过上限 ${MAX_BYTES} 字节，已中断`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, total);
}

/**
 * @returns {Promise<{status:'ok'|'not-modified', text?:string, etag?:string,
 *   lastModified?:string, contentType?:string, finalUrl:string}>}
 */
export async function fetchFeed(url, { etag, lastModified, userAgent = DEFAULT_USER_AGENT } = {}) {
  const headers = { 'user-agent': userAgent, accept: ACCEPT };
  if (etag) headers['if-none-match'] = etag;
  if (lastModified) headers['if-modified-since'] = lastModified;

  const res = await fetch(url, {
    headers,
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  const nextEtag = res.headers.get('etag') ?? undefined;
  const nextLastModified = res.headers.get('last-modified') ?? undefined;
  const contentType = res.headers.get('content-type') ?? undefined;
  const finalUrl = res.url || url;

  if (res.status === 304) {
    return { status: 'not-modified', etag: nextEtag, lastModified: nextLastModified, contentType, finalUrl };
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`.trim());
  }

  const buffer = await readBodyCapped(res);
  if (buffer.byteLength === 0) throw new Error('响应体为空');

  return {
    status: 'ok',
    text: decode(buffer, contentType),
    etag: nextEtag,
    lastModified: nextLastModified,
    contentType,
    finalUrl,
  };
}
