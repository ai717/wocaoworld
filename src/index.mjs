import { loadConfig, dataDir } from './config.mjs';
import { openDb } from './db.mjs';
import { createBlogServer } from './server.mjs';

// 只绑回环地址：对外暴露一律交给 Caddy，绝不让 Node 直接监听公网网卡。
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 3000);

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  console.error(`PORT 必须是 1-65535 的整数，收到 ${JSON.stringify(process.env.PORT)}`);
  process.exit(1);
}

const config = loadConfig();
const db = openDb();
const server = createBlogServer({ config, db });

server.on('error', (err) => {
  console.error(`HTTP 服务出错: ${err.message}`);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`${config.site.title} 已启动: http://${HOST}:${PORT}/`);
  console.log(`数据库: ${dataDir()}`);
});

let closing = false;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (closing) return;
    closing = true;
    console.log(`收到 ${signal}，正在关闭…`);
    server.close(() => {
      db.close();
      process.exit(0);
    });
    // 长连接挂住时不要无限等，systemd 的 TimeoutStopSec 之外自己兜底
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
