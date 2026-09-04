import { loadConfig, dataDir } from './config.mjs';
import { openStore, getStats, listSourcesWithCounts } from './store.mjs';

const USAGE = `用法: node src/cli.mjs <command>

  sync     拉取全部订阅源，写入 data/*.json
  build    把库里的内容构建成 dist/ 静态站点
  preview  在本地按 basePath 前缀预览 dist/（可选端口，默认 4000）
  cms      启动本地 CMS（随机端口）
  stats    打印库内源与文章的统计
`;

function formatTime(ms) {
  return ms ? new Date(ms).toISOString().replace('T', ' ').slice(0, 16) : '—';
}

function stats() {
  const store = openStore();
  const { sources, posts } = getStats(store);
  console.log(`数据目录: ${dataDir()}`);
  console.log(`订阅源: ${sources.active ?? 0} 个启用 / 共 ${sources.total} 个`);
  console.log(`文章:   ${posts.total} 篇`);
  if (posts.total > 0) {
    console.log(`时间跨度: ${formatTime(posts.oldest)} → ${formatTime(posts.newest)}`);
  }
  console.log('');
  for (const s of listSourcesWithCounts(store)) {
    const flag = s.active ? '✓' : '✗';
    console.log(
      `${flag} #${s.id} [${s.mode}] ${s.post_count} 篇  ${s.title ?? s.url}\n` +
        `    ${s.url}\n` +
        `    最近同步: ${formatTime(s.last_fetched_at)}  状态: ${s.last_status ?? '未同步'}`,
    );
  }
}

async function sync() {
  const config = loadConfig();
  const { runSync } = await import('./sync.mjs');
  const store = openStore();
  let failed;
  try {
    failed = await runSync(store, config);
  } finally {
    store.close();
  }
  if (failed > 0) process.exitCode = 1;
}

async function build() {
  const config = loadConfig();
  const { runBuild } = await import('./build.mjs');
  runBuild(config, openStore());
}

async function preview() {
  const config = loadConfig();
  const { startPreview } = await import('./preview.mjs');
  const raw = process.argv[3];
  const port = Number(raw ?? 4000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`端口必须是 1-65535 的整数，收到 ${JSON.stringify(raw)}`);
  }
  startPreview({ config, port });
}

async function cms() {
  const { startCms } = await import('./cms.mjs');
  const raw = process.argv[3];
  const port = raw === undefined ? 65354 : Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`端口必须是 1-65535 的整数，收到 ${JSON.stringify(raw)}`);
  }
  startCms({ port });
}

const [command] = process.argv.slice(2);

try {
  if (command === 'sync') await sync();
  else if (command === 'build') await build();
  else if (command === 'preview') await preview();
  else if (command === 'cms') await cms();
  else if (command === 'stats') stats();
  else {
    console.error(USAGE);
    process.exitCode = command === undefined ? 1 : 2;
  }
} catch (err) {
  console.error(`错误: ${err.message}`);
  process.exitCode = 1;
}
