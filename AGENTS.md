# AGENTS.md

由 RSS/Atom/JSON Feed 自动聚合的博客。**本地抓取 → 本地构建 → 推 gh-pages 分支 → GitHub Pages 托管**，线上零计算。

用户面向的所有回复与文档一律用中文。

## 命令

```bash
npm run sync      # 抓订阅源 → data/*.json（增量，走 ETag/Last-Modified）
npm run build     # data/*.json → dist/（先整体清空再重建）
npm run preview   # 按 basePath 前缀挂载 dist/，默认 127.0.0.1:4000，端口可作参数
npm run stats     # 库内统计
npm run deploy    # bash deploy/publish-github.sh，会向远端推送
```

Node ≥ 20.11（`import.meta.dirname`）。只有 `fast-xml-parser` 与 `sanitize-html` 两个依赖，均为纯 JS——**不要引入任何需要 node-gyp/编译工具链的包**，本机没有 Rust 与 MSVC。

## 数据流与模块职责

```
config.json + 订阅源 → sync → data/{sources,posts}.json → build → dist/** → publish-github.sh
                       ↑ fetch-feed → parse-feed → sanitize        ↑ render ← urls
```

| 模块 | 职责 |
|---|---|
| `config.mjs` | 校验 config.json、**派生 basePath**、`dataDir/distDir/publicDir` |
| `urls.mjs` | 站内 URL 的**唯一真值来源** |
| `store.mjs` | JSON 持久化：原子写、稳定 id、guid/link 去重索引 |
| `sync.mjs` | 编排：源间串行、按源存盘、失败隔离 |
| `fetch-feed.mjs` | UA、超时 15s、上限 5MB、条件请求 |
| `parse-feed.mjs` | RSS 2.0 / RSS 1.0 / Atom / JSON Feed → 统一结构 |
| `sanitize.mjs` | 白名单清洗（56 个标签）、链接与图片绝对化、`esc()` |
| `render.mjs` | 纯函数模板，返回字符串 |
| `build.mjs` | 静态站点生成器 |
| `preview.mjs` | 极简静态服务器，仅本地开发 |

## 不可破坏的不变量

改动前先确认没有违反这些。每条都对应一个已经踩过的坑。

**URL / basePath**

1. **站内路径一律走 `urls.mjs` 的 helper，绝不在 `render.mjs` 里硬编码 `/xxx`。** 改造前有约 15 处硬编码，是 basePath 支持的直接阻塞点。
2. **目录型链接一律带尾斜杠**（`/sources/` 而非 `/sources`）。GitHub Pages 没有服务端 301 可依赖。
3. **basePath 来自 `site.url` 的 pathname，绝不能用 `new URL(...).origin`** —— origin 会吞掉路径，而 GitHub Pages 项目站点的 `/repo` 前缀就住在路径里（`config.mjs:50`）。
4. **`urls.absolute(p)` 收的是已带 basePath 的站内路径，闭包里是 `origin`。绝不能把 `site.url` 传进去** —— 那个值本身已含 basePath，会拼出 `/repo/repo/p/id/` 双重前缀。
5. `renderList` 的 `base` 参数由 `build.mjs` 传 `urls.sourceUrl(id)`（已带前缀和尾斜杠）；`/page/` 的拼接只存在于 `pagedUrl` 一处。

**内容安全**

6. **镜像进来的正文是他人可控的不可信输入。** 任何进入页面的外部 HTML 必须经过 `sanitize.mjs`，任何文本字段必须经过 `esc()`。绕过这里就是开 XSS——而静态化之后这些内容会永久躺在公开仓库里。
7. 订阅源清单只能由站长改 `config.json`，**不要添加任何网页端添加入口**（SSRF）。这是刻意的功能缺失。
8. 外部内容不带 `class`/`style` 属性（`ALLOWED_ATTRIBUTES` 里 `'*': []`），防止污染本站排版。

**产物**

9. **`dist/` 构建前整体清空重建**，不要改成增量写——被删掉的文章会留下孤儿目录。
10. **产物里不得嵌入构建时间戳。** 否则每次发布都是全仓 diff，`gh-pages` 分支历史迅速膨胀到无法阅读。页面上的「最近同步」时间来自 `lastFetchedAt`，那是数据不是噪声。
11. **`.nojekyll` 必须生成。** 本站镜像外部正文，真的会出现 Liquid 语法（`dist/p/eb9434a8237c/` 里就有 `{% querystring date=nav.prev_date %}`），不关掉 Jekyll 会解析并改坏内容。

**数据层**

12. **`postId()` 的 sha256 公式不能改**（对 `sourceUrl` + 换行 + `guid` 求 sha256，取前 12 位十六进制）——`/p/<id>/` 是已发布的 URL。源 id 同理，只增不减、永不复用。
13. **写入必须原子**：`*.json.tmp` → `fsync` → `rename`。不要图省事直接 `writeFileSync` 覆盖主文件。
14. **磁盘上的 JSON 用 camelCase，对外返回的行用 snake_case**（`sourceRow()` / `insertPost()` 做转换）。这是为了让 `render.mjs`、`cli.mjs` 的 `row.published_at`、`row.source_title` 这类调用点保持不变，不要"顺手统一"。
15. `saveStore` 由 dirty 标志把关，无变更的同步产生 0 次写入；`sync.mjs` **每个源同步完存盘一次**（不是每条一存，也不是全部结束才存）。
16. `active: false` 的源**仍然会出现在列表页和 `/s/<id>/`**，只是不再抓取，并在 `/sources/` 带「已停用」标记。想让文章消失得手动删 `posts.json` 条目。

## 本机环境陷阱（Windows / Git Bash）

- **Bash 工具拒绝任何含 `//` 的命令**（当成 UNC 路径）。所以 `curl http://…` 写不进去。要发 HTTP 请求就用 Node 脚本；`taskkill` 用单破折号 `-PID`。
- **测目录穿越用 `node:http` 的 `request({ path })`**，它原样发送 path，`/../`、`%2e%2e/`、`..%2f`、反斜杠都能抵达服务端。
- **后台起的 Node 服务用 `TaskStop`（传 background task id）停止**，`kill` 对原生 Windows 进程无效。停完端口只剩 `TIME_WAIT`，无 `LISTENING`。
- Git Bash 的 `/tmp/x` 与 Node 里的 `/tmp/x` 不是同一个位置（后者解析到 `G:\tmp\x`）。临时脚本放在项目目录内，用相对 specifier 导入。

## 工作方式约定

- **不要用浏览器截图自检页面视觉效果**，视觉验收由用户负责。验证一律用 Node 脚本断言 + `node:http`/curl 打本地端口 + 直接读文件。
- 临时验证脚本用 `_` 前缀（如 `_verify-dist.mjs`），**用完删掉，不要提交**，也不要在 `.gitignore` 里为它们开口子。
- **提交时按文件名逐个 `git add`，绝不用 `git add -A`/`git add .`** —— `data/` 与 `dist/` 虽然已 gitignore，但临时脚本没有。
- 写验证脚本时**先让它对已知坏样本自检**。扫描器写错时的「0 命中」和干净站点的「0 命中」看起来一模一样。
- **`deploy/publish-github.sh` 会向远端推送，是对外可见操作。只做 `bash -n` 语法检查，不要替用户执行。**
- 如实区分「已实测」与「无法实测」。GitHub Pages 的真实构建行为、`.nojekyll` 在 Jekyll 管线下的效果、`404.html` 是否被采用、CDN 缓存，本机都验证不了，不要假装通过。

## 当前状态

- `config.json` 的 `site.url` 是**占位值** `https://ai717.github.io/wocao.world`（从 git `user.name` 推的），待用户确认真实 Pages 地址。
- `src/fetch-feed.mjs:1` 的 UA 仍硬编码 `wocao.world/0.1 (+https://wocao.world/about/)`，版本号与联系 URL 都过时；让它跟随 config 需要把 config 传进抓取层，尚未做。
- 4 个源里 3 个是 `full` 模式。发布到公开仓库前需重新评估版权暴露面（详见 README「`mode` 与版权」）。
- `data/` 与 `dist/` 均 gitignore。`data/` 是可重新抓取的本地缓存，但 feed 只保留最近几十条，删掉会丢历史。
