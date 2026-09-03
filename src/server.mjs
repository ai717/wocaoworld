import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { route } from './routes.mjs';
import { renderError } from './render.mjs';

const HTML = 'text/html; charset=utf-8';

function etagOf(body) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
  return `"${buf.byteLength.toString(36)}-${createHash('sha256').update(buf).digest('base64url').slice(0, 22)}"`;
}

/** If-None-Match 可能是 `W/"a", "b"` 这种列表，逐个剥掉弱校验前缀再比。 */
function matches(header, etag) {
  if (!header) return false;
  if (header.trim() === '*') return true;
  return header
    .split(',')
    .map((part) => part.trim().replace(/^W\//i, ''))
    .includes(etag);
}

function send(res, result, req) {
  const body = result.body ?? '';
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
  const etag = result.status >= 200 && result.status < 300 ? etagOf(buf) : null;

  const headers = {
    'Content-Type': result.type ?? HTML,
    'Cache-Control': result.cache ?? 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  };
  if (etag) headers.ETag = etag;
  if (result.location) headers.Location = result.location;
  if (result.allow) headers.Allow = result.allow;

  // Node 对 HEAD 请求自行丢弃响应体，这里照常写即可
  if (etag && matches(req.headers['if-none-match'], etag)) {
    res.writeHead(304, headers);
    res.end();
    return 304;
  }

  headers['Content-Length'] = buf.byteLength;
  res.writeHead(result.status, headers);
  res.end(buf);
  return result.status;
}

export function createBlogServer({ config, db }) {
  return createServer((req, res) => {
    const started = performance.now();
    const url = new URL(req.url, 'http://localhost');
    let status;

    try {
      status = send(res, route({ config, db, method: req.method, pathname: url.pathname }), req);
    } catch (err) {
      // 渲染或查询抛错时页面已经写不出去了，只能给一个最小的错误页
      console.error(`${req.method} ${url.pathname} 处理失败:`, err);
      if (!res.headersSent) {
        try {
          send(res, { status: 500, type: HTML, body: renderError({ config, message: '页面生成失败，请稍后重试。' }), cache: 'no-store' }, req);
        } catch {
          res.writeHead(500, { 'Content-Type': HTML });
          res.end('<h1>500</h1>');
        }
      } else {
        res.destroy();
      }
      status = 500;
    }

    console.log(`${req.method} ${url.pathname} ${status} ${(performance.now() - started).toFixed(1)}ms`);
  });
}
