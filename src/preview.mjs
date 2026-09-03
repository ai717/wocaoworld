import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { distDir } from './config.mjs';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

/**
 * 按 basePath 前缀挂载 dist/，让本地地址与 GitHub Pages 上的路径完全一致，
 * 链接写错在本地就能暴露，而不是推上去才发现。
 */
export function startPreview({ config, port = 4000, host = '127.0.0.1', log = console.log }) {
  const dist = distDir();
  if (!existsSync(dist)) {
    throw new Error(`${dist} 不存在，先跑 npm run build`);
  }
  const basePath = config.site.basePath;

  const server = createServer((req, res) => {
    const notFound = () => {
      const file = path.join(dist, '404.html');
      if (existsSync(file)) {
        const body = readFileSync(file);
        res.writeHead(404, { 'Content-Type': MIME['.html'], 'Content-Length': body.byteLength });
        res.end(body);
        return;
      }
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404\n');
    };

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' });
      res.end();
      return;
    }

    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
      // 非法百分号转义，当成普通字符串处理，后面自然落到 404
      pathname = req.url;
    }

    if (basePath && pathname !== basePath && !pathname.startsWith(`${basePath}/`)) {
      notFound();
      return;
    }
    const rel = pathname.slice(basePath.length).replace(/^\/+/, '');

    // normalize 之后必须仍在 dist/ 内，否则 /../../config.json 能读到任意文件。
    // 先解码再校验，%2f 写法同样落在这里。
    const target0 = path.normalize(path.join(dist, rel));
    if (target0 !== dist && !target0.startsWith(dist + path.sep)) {
      notFound();
      return;
    }

    let target = target0;
    let stat;
    try {
      stat = statSync(target);
    } catch {
      notFound();
      return;
    }

    if (stat.isDirectory()) {
      if (!pathname.endsWith('/')) {
        // GitHub Pages 对无尾斜杠的目录路径会自行跳转，这里保持一致
        res.writeHead(301, { Location: `${pathname}/` });
        res.end();
        return;
      }
      target = path.join(target, 'index.html');
      try {
        stat = statSync(target);
      } catch {
        notFound();
        return;
      }
    }
    if (!stat.isFile()) {
      notFound();
      return;
    }

    const body = readFileSync(target);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(target).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': body.byteLength,
    });
    res.end(body);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      log(`端口 ${port} 已被占用，换一个：npm run preview -- 4100`);
      process.exitCode = 1;
      server.close();
      return;
    }
    throw err;
  });

  server.listen(port, host, () => {
    log(`预览 ${dist}`);
    log(`  http://${host}:${server.address().port}${basePath || ''}/`);
    log('  Ctrl+C 停止');
  });

  return server;
}
