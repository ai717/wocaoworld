import { loadConfig, dataDir } from './config.mjs';
import { openDb, getStats, listSourcesWithCounts } from './db.mjs';

const USAGE = `用法: node src/cli.mjs <command>

  sync    拉取全部订阅源并入库（systemd timer 调用的就是这个）
  stats   打印库内源与文章的统计
  serve   前台启动 Web 服务（等价于 npm start）
`;

function formatTime(ms) {
  return ms ? new Date(ms).toISOString().replace('T', ' ').slice(0, 16) : '—';
}

function stats() {
  const db = openDb();
  try {
    const { sources, posts } = getStats(db);
    console.log(`数据库: ${dataDir()}`);
    console.log(`订阅源: ${sources.active ?? 0} 个启用 / 共 ${sources.total} 个`);
    console.log(`文章:   ${posts.total} 篇`);
    if (posts.total > 0) {
      console.log(`时间跨度: ${formatTime(posts.oldest)} → ${formatTime(posts.newest)}`);
    }
    console.log('');
    for (const s of listSourcesWithCounts(db)) {
      const flag = s.active ? '✓' : '✗';
      console.log(
        `${flag} #${s.id} [${s.mode}] ${s.post_count} 篇  ${s.title ?? s.url}\n` +
          `    ${s.url}\n` +
          `    最近同步: ${formatTime(s.last_fetched_at)}  状态: ${s.last_status ?? '未同步'}`,
      );
    }
  } finally {
    db.close();
  }
}

async function sync() {
  const config = loadConfig();
  const { runSync } = await import('./sync.mjs');
  const db = openDb();
  let failed;
  try {
    failed = await runSync(db, config);
  } finally {
    db.close();
  }
  if (failed > 0) process.exitCode = 1;
}

async function serve() {
  // index.mjs 的顶层代码即启动流程，导入它就等于 npm start
  await import('./index.mjs');
}

const [command] = process.argv.slice(2);

try {
  if (command === 'sync') await sync();
  else if (command === 'stats') stats();
  else if (command === 'serve') await serve();
  else {
    console.error(USAGE);
    process.exitCode = command === undefined ? 1 : 2;
  }
} catch (err) {
  console.error(`错误: ${err.message}`);
  process.exitCode = 1;
}
