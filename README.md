# wocao.world

由 RSS / Atom / JSON Feed 订阅源**自动聚合生成**的极简博客。不写原创，只做搬运与归档：程序抓取若干订阅源，把条目镜像成本站文章，每篇都保留原文永久链接与署名。

**本地抓取、本地构建、发布到 GitHub Pages。** 线上没有任何计算，只有静态文件。纯 Node.js 标准库实现，只有 2 个依赖，不编译任何原生模块，不需要 Docker，不需要服务器。

---

## 架构

```
本地                                     GitHub
────                                     ──────
npm run sync     抓订阅源 → data/*.json
npm run build    读 JSON  → dist/**（约 140 个文件）
npm run deploy   把 dist/ 推到 gh-pages 分支  →  GitHub Pages CDN  →  读者
```

三段都是手动触发，**没有定时任务**。这是相对旧方案（VPS 上 systemd timer 每 30 分钟自动抓一次）最实质的行为变化：内容更新取决于你什么时候跑命令。想自动化就自己挂 cron / 任务计划，或者加一条 GitHub Actions——但那要求把抓取搬上 CI，每轮都得全量重抓，因为 `data/` 不在仓库里。

**为什么不留运行时服务。** 静态化之后 ETag / 304 缓存协商、gzip、HTTPS 全部由 GitHub Pages CDN 负责，本地不需要实现；同时 URL 只剩一套真值（构建产物），不再有「路由表说的」和「实际生成的」两份需要互相对齐。

**为什么用 JSON 快照而不是 SQLite。** 旧方案依赖 `node:sqlite`，把 Node 版本硬钉在 ≥ 22.5，而且该模块在部分构建里不可用。换成两个 JSON 文件之后 Node 门槛降到 ≥ 20.11，仓库里也不再有二进制文件。代价是原子写、id 分配、去重索引都要自己实现——都在 `src/store.mjs` 里，见下文。

**增量同步能力保留。** `data/sources.json` 持久保存每个源的 ETag / Last-Modified，`data/posts.json` 保存已入库的 guid 与链接集合。只要 `data/` 目录还在，第二轮同步就是条件请求，源返回 304 直接跳过。

## 目录结构

```
├── package.json            # type: module；scripts: sync / build / preview / stats / deploy
├── config.json             # 站点信息 + 订阅源清单（唯一内容源入口）
├── public/style.css        # 极简单栏排版，零 JS，构建时原样拷进 dist/
├── data/                   # 同步产物，已 gitignore：sources.json + posts.json
├── dist/                   # 构建产物，已 gitignore，可随时删掉重建
├── src/
│   ├── cli.mjs             # 子命令 sync / build / preview / stats
│   ├── config.mjs          # 读取校验 config.json，派生 basePath
│   ├── urls.mjs            # 站内 URL 的唯一真值来源（含 basePath 前缀与尾斜杠）
│   ├── store.mjs           # JSON 持久化：原子写、稳定 id、去重索引
│   ├── sync.mjs            # 同步编排：源间串行、按源存盘、失败隔离
│   ├── fetch-feed.mjs      # 抓取：UA、超时、体积上限、条件请求
│   ├── parse-feed.mjs      # RSS 2.0 / RSS 1.0 / Atom / JSON Feed → 统一结构
│   ├── sanitize.mjs        # 白名单清洗 + 相对链接与图片地址绝对化
│   ├── render.mjs          # 布局与页面模板（纯函数返回字符串）
│   ├── build.mjs           # 静态站点生成器：清空 dist → 渲染全部页面 → 拷静态资源
│   └── preview.mjs         # 极简静态服务器，按 basePath 前缀挂载 dist/
└── deploy/
    └── publish-github.sh   # 把 dist/ 推到 gh-pages 分支
```

## 本机开发

需要 **Node ≥ 20.11**（`import.meta.dirname` 的起点）。

```bash
npm install
npm run sync      # 抓取全部订阅源 → data/*.json
npm run build     # 构建 → dist/
npm run preview   # 本地预览，默认 http://127.0.0.1:4000/<basePath>/
npm run stats     # 看库内统计

# Windows 一键启动（双击根目录 start-local.cmd）
# 以 65354 端口同时打开前台预览与 CMS；再次双击会先重启旧服务（不会自动构建）
```

`npm run sync` 的典型输出：

```
开始同步 4 个订阅源
  = https://simonwillison.net/atom/everything/ 未变更
  + Daring Fireball: 新增 1，跳过 47
  = https://jvns.ca/atom.xml 未变更
  = https://blog.cloudflare.com/rss/ 未变更
同步完成：新增 1 篇，失败 0/4 个源
```

`=` 表示源返回 304（条件请求命中，没重新下载），`+` 表示重新抓取并入库，`!` 表示该源失败。任何源失败都会让进程以非零码退出，但不影响其他源。

`npm run build` 的典型输出：

```
构建完成 → G:\...\wocao.world\dist
  basePath: /wocao.world
  119 篇文章 / 4 个源 / 首页 6 页 / 源页 7 页
  写出 137 个页面 + 1 个静态资源
```

`preview` 只监听 `127.0.0.1`，端口可作为参数传入（`npm run preview -- 8080`）。它**按 basePath 前缀挂载** `dist/`——basePath 是 `/wocao.world` 时本地地址就是 `http://127.0.0.1:4000/wocao.world/`，与线上路径完全一致，链接写错在本地就能发现，不用推上去才看见。

可用环境变量：

| 变量 | 默认 | 说明 |
|---|---|---|
| `BLOG_DATA_DIR` | `<项目>/data` | JSON 快照存放目录 |

## 配置

`config.json` 是订阅源的**唯一事实来源**，不提供任何网页端添加入口（这是刻意的功能缺失，见「安全边界」）。

```json
{
  "site": {
    "title": "我操世界",
    "description": "一个由订阅源自动聚合生成的博客，不写原创，只做搬运与归档。",
    "url": "https://ai717.github.io/wocao.world",
    "lang": "zh-CN",
    "postsPerPage": 20,
    "noindex": true
  },
  "sources": [
    { "url": "https://simonwillison.net/atom/everything/", "mode": "full" },
    { "url": "https://blog.cloudflare.com/rss/",           "mode": "excerpt" }
  ]
}
```

### `site.url` 决定 basePath

`site.url` 必须与站点**实际对外的地址完全一致**，路径部分会被自动提取成 basePath：

| `site.url` | 派生 basePath | 场景 |
|---|---|---|
| `https://ai717.github.io/wocao.world` | `/wocao.world` | GitHub Pages 项目站点（仓库名即路径） |
| `https://ai717.github.io` | `''` | GitHub Pages 用户站点（`<user>.github.io` 仓库） |
| `https://wocao.world` | `''` | 自定义域名 |

同一份代码三种形态都能构建，换域名只需要改这一个字段再重新 `build`。填错的症状很具体：站内链接全部 404，或者 feed 里的 `<link rel="self">` 指向不存在的地址。

> 这里刻意不用 `new URL(...).origin`——`origin` 会吞掉路径，而 GitHub Pages 项目站点的 `/repo` 前缀就住在路径里。

### `mode` 与版权

| mode | 行为 | 用在哪 |
|---|---|---|
| `full` | 清洗后的正文全文落盘并构建进 `dist/`，本站可完整阅读 | 明确允许转载、或 CC 协议的源 |
| `excerpt` | **只存摘要**，正文不落盘，页面引导读者回原文 | 未明确授权转载的源 |

> ⚠️ **改 `mode` 不会回溯已入库的文章。** `mode` 只在新条目入库那一刻决定是否存正文（`sync.mjs` 的 `storeFullText`），已经躺在 `data/posts.json` 里的正文**不会自动消失**，照旧渲染进 `dist/`。把源从 `full` 改成 `excerpt` 之后，必须再把它已入库的历史正文清掉才真的生效。这一步不可逆——feed 通常只保留最近几十条，删掉的历史抓不回来——**动手前先备份 `data/`**。

除 `mode` 之外还有三项缓解已内建：

- 文章页强制显示来源名、原作者、原文永久链接，正文内所有链接指向原站
- `<head>` 输出 `<meta name="robots" content="noindex,follow">`（`noindex: false` 可关）
- 每篇文章的 `<link rel="canonical">` 指向**原文**而非本站

> ⚠️ **发布到公开 GitHub 仓库会新增一个暴露面。** `gh-pages` 分支上的全部 HTML 任何人都能直接 clone 和爬取，`noindex` 只约束搜索引擎的**索引**行为，挡不住仓库内容公开可读。所以：**未明确允许转载的源，应该配 `excerpt` 而不是 `full`**，让正文根本不进产物。当前 `config.json` 里 4 个源**全部是 `excerpt`**，产物中不含任何第三方正文。若日后把某个源改回 `full`，上面那条「改 mode 不回溯」的陷阱与这个公开暴露面会同时生效。

### 改订阅源

改完 `config.json` 后跑 `npm run sync && npm run build`。

每轮同步开始时会与 `data/sources.json` 对账：新增的源分配 id 并插入，从 config 移除的源置 `active: false`。

**移除源不会删历史文章**，而且它已经入库的文章**仍然会出现在首页列表和 `/s/<id>/` 页面上**——`active` 只影响「还抓不抓」，不影响「显不显示」。可见的变化只有两处：`npm run sync` 跳过它，以及 `/sources/` 列表里它排到末尾并带一个「已停用」标记。想让文章彻底消失，得手动从 `data/posts.json` 里删掉对应条目再重新构建。

源的 id 只增不减且永不复用，因为 `/s/<id>/` 是已经发布出去的 URL。

## 构建产物

```
dist/
├── index.html                    首页第 1 页
├── page/<n>/index.html           n = 2..totalPages
├── p/<id>/index.html             每篇文章一个目录，id 是 12 位 sha256 前缀
├── s/<id>/index.html             每个源第 1 页
├── s/<id>/page/<n>/index.html    源内分页
├── sources/index.html            订阅源列表与同步状态
├── about/index.html              说明页，含来源与版权声明
├── 404.html                      GitHub Pages 对未命中路径服务这个
├── .nojekyll                     空文件，关掉 Jekyll
├── feed.xml                      本站聚合输出的 RSS 2.0，最新 30 条
└── style.css                     从 public/ 原样拷贝
```

三个设计决定：

1. **`.nojekyll` 不是可选的。** GitHub Pages 默认跑 Jekyll，会对 HTML 做 Liquid 模板处理。本站镜像的是**外部博客正文**，真的会出现 `{{ }}` 与 `{% %}`（现有文章里就有一篇含 `{% querystring date=nav.prev_date %}`），Jekyll 会尝试解析并可能改坏内容。一个空文件彻底关掉它。
2. **构建前先清空 `dist/`。** 否则删掉的文章会留下孤儿目录，越积越多。`dist/` 是纯产物，整体重建是唯一正确做法。
3. **产物可重现，页面里不嵌构建时间戳。** 否则每次发布都是全仓 diff，`gh-pages` 分支历史迅速膨胀到无法阅读。源页面上的「最近同步」时间来自 `lastFetchedAt`，只在真正同步过时才变——那是数据不是噪声。

所有站内链接一律**带尾斜杠**（`/sources/` 而不是 `/sources`）。GitHub Pages 对存在 `dir/index.html` 的无尾斜杠路径会自行跳转，但没有服务端 301 可以依赖，从源头规避比依赖它可靠。

## 发布到 GitHub Pages

### 一次性准备

1. 在 GitHub 上建一个仓库，把本地目录推上去：
   ```bash
   git remote add origin <你的仓库地址>
   git push -u origin main
   ```
2. 仓库 **Settings → Pages → Build and deployment**，Source 选 **Deploy from a branch**，Branch 选 **`gh-pages`** 与 **`/ (root)`**，Save。（分支还不存在也没关系，第一次发布会创建它。）
3. 把 `config.json` 的 `site.url` 改成 Pages 实际会用的地址，形如 `https://<用户名>.github.io/<仓库名>`，然后 `npm run build`。

> 免费账户的 Pages 要求仓库是 **public**。私有仓库需要 GitHub Pro / Team。而 public 意味着上面那条版权提示生效。

### 日常发布

```bash
npm run sync      # 抓新内容（可跳过，只改模板时不必抓）
npm run build     # 重建 dist/
npm run deploy    # 推 dist/ 到 gh-pages 分支
```

`npm run deploy` 就是 `bash deploy/publish-github.sh`。它会：检查前置条件（`dist/` 完整、是 git 仓库、有 `origin`）→ 在临时目录里浅 clone 已有的 `gh-pages` 分支，或新建一个孤儿分支 → **清空分支内容**（保留 `.git`）→ `cp -r dist/.` 进去 → `git add -A` → 无变更则直接退出并提示 → 提交（消息带文章数与源数）→ 推送 → 清理临时目录。

用临时 clone 而不是 `git worktree`：worktree 会在主仓库留下注册状态，异常退出后需要手工清理，对一个发布脚本来说是不必要的复杂度。

**这个脚本会向远端推送，是对外可见的操作。** 推送后 GitHub Pages 重新生效通常要一两分钟，可在仓库的 **Actions** 页看 `pages build and deployment` 工作流。

## 数据与备份

`data/` 里就是全部状态，两个 JSON 文件，分开存以便 diff 可读：

| 文件 | 内容 |
|---|---|
| `sources.json` | `{ nextId, items[] }`：订阅源注册表 + 每个源的 ETag / Last-Modified / 最近同步状态。易变、小 |
| `posts.json` | 文章数组：`id` / `sourceId` / `guid` / `title` / `link` / `author` / `publishedAt` / `fetchedAt` / `contentHtml` / `summary` |

**写入是原子的**：先写 `*.json.tmp` → `fsync` → `rename` 覆盖。rename 在同一文件系统上是原子的，中途崩溃只会留下一个 tmp 文件，不会写坏主文件。存盘时机是**每个源同步完一次**——每条一存会把同一个文件重写上百遍，全部结束才存则中途崩溃丢掉整轮，按源存盘把损失上限压到一个批次。

**其实这个站可以不备份。** 所有内容都来自公开订阅源，删掉 `data/` 重跑一次 `npm run sync` 就能重建，代价只是丢失历史条目（feed 通常只保留最近几十条，抓不回来）。真正不可再生的只有 `config.json`，而它在 git 里。

`data/` 默认被 gitignore。如果你确实想把内容快照纳入版本管理以便 diff，从 `.gitignore` 里删掉 `data/` 那一行即可——但那意味着数 MB 的第三方全文进入公开仓库历史，与上面的版权顾虑直接冲突，**不建议**。

## 排障

| 症状 | 先看 | 常见原因 |
|---|---|---|
| `npm run sync` 报配置错 | 报错信息本身 | `config.json` 语法错、缺 `site.title`、`site.url` 不是合法 http(s) URL、`mode` 拼错、源地址重复。报错会直接指出是哪个字段 |
| 页面能开但没文章 | `npm run stats` | 首同步还没跑过或全失败；看每个源的「状态」列 |
| 某个源一直失败 | `/sources/` 页面的状态列 | 源地址变了、被墙、超时、返回非 feed 内容。失败是隔离的，不影响其他源 |
| 第二轮同步仍然全量重抓 | `data/sources.json` | 该源不返回 ETag / Last-Modified（有些源就是不给），只能每次重抓；只要 guid 没变就不会重复入库 |
| `npm run preview` 报 dist 不存在 | — | 先跑 `npm run build` |
| 预览时全部链接 404 | `config.json` 的 `site.url` | basePath 与实际挂载路径不一致。preview 会打印它认为的根地址，对照一下 |
| 线上样式没了 | `dist/style.css` 是否存在 | `public/` 下没有该文件；或 `gh-pages` 分支推送不完整 |
| 线上页面内容被改坏、含 Liquid 报错 | `dist/.nojekyll` 是否存在 | 少了它 GitHub Pages 会跑 Jekyll 解析镜像正文里的 `{{ }}` |
| 发布脚本说「无需发布」 | — | `dist/` 与线上 `gh-pages` 内容一致，这是正常结果不是错误 |
| 端口被占 `EADDRINUSE` | — | 换一个端口：`npm run preview -- 8080` |

## 安全边界

镜像进来的正文是**他人可控的不可信输入**，直接插入页面就是 XSS。这个项目的安全设计围绕这一点：

1. **XSS** —— `sanitize-html` 白名单清洗，绝不用正则剥标签。允许标签共 56 个；`script` / `style` / `textarea` / `noscript` / `iframe` / `object` / `embed` / `template` 连同其文本内容一并移除；所有 `on*` 事件属性移除；`javascript:` / `vbscript:` 协议移除；`class` 与 `style` 属性根本不在白名单里，外部内容无法注入本站样式。标题、作者等文本字段一律经 `esc()` 转义后才进模板，绝不裸插。**静态化之后这些内容会永久躺在公开仓库里，这一层比运行时更重要。**
2. **SSRF** —— 不提供任何「网页上添加订阅源」的接口，源清单只能由站长改 `config.json`。这是刻意的功能缺失，不是待补的功能。URL 协议限定 http/https，`file://` 之类一律拒绝。
3. **资源上限** —— 单响应体 ≤ 5 MB（流式读取，超限即中断）、超时 15 s、每源每轮最多入库 100 条、单条正文存储 ≤ 200 KB（超限则不落盘正文，页面降级为摘要 + 原文链接）。防异常源撑爆内存和仓库。
4. **抓取礼仪** —— 真实 UA 与 `Accept`；带上一轮 ETag / `If-Modified-Since`，304 直接跳过；源间**串行**并间隔 1.5 s，不并发轰炸同一台服务器。
5. **失败隔离** —— 单源失败只写 `sources.json` 的 `lastStatus`，不影响其他源；sync 进程以非零码退出。
6. **本地预览的目录穿越防护** —— 先 `decodeURIComponent` 再 `path.normalize`，然后校验目标仍在 `dist/` 内。裸 `../`、`%2e%2e/`、`..%2f`、反斜杠四类写法都测过，一律 404 且不泄漏 `config.json` / `data/` / `package.json`。
7. **发布脚本不碰主分支** —— 全部 git 操作发生在临时目录里的 `gh-pages` 克隆上，主仓库的工作区与当前分支不受影响。

### 已验证 / 待验证

**本机（Windows / Node v24）已实测通过：**

- **SQLite → JSON 迁移保真**：4 个源 / 118 篇文章，`getStats`、`listSourcesWithCounts`、`listActiveSources`、全量 `listPosts`、每源分页 `listPosts`、全部 118 次 `getPost` 与 `findPostByLink`、4 次不存在的查询——两个后端逐字段一致
- **JSON 往返**：写盘后重新打开再比一次，仍一致；ETag / Last-Modified 状态在 JSON 里存活；只读一轮后 dirty 标志为 false，不产生无谓写入
- **条件请求**：迁移后第一轮同步即有 2 个源返回 304，证明从 SQLite 导出的 ETag 被正确读回并作为条件头发出；第二轮 4 个源全部「未变更，新增 0」
- **渲染层重构无回归**：重构前抓下 134 个页面的黄金样本，重构后逐文件 diff——133 个只差刻意加的尾斜杠，1 个（`/about/`）只差 2 行刻意改的说明文字，0 个缺失
- **basePath 全覆盖**：分别以 `/wocao.world` 和 `''` 各构建一次，扫描 `dist/` 里全部 3073 个 `href`/`src`，站内 1681 个全部带正确前缀，**0 个漏前缀的根绝对路径**，目录型链接全部带尾斜杠
- **产物文件集合**：独立于 `build.mjs` 重新推导一遍期望集合，与实际 138 个文件完全吻合（两种 basePath 下均如此）；`dist/style.css` 与 `public/style.css` 字节一致（8578 字节）
- **可重现性**：连续构建两次，138 个文件逐字节相同
- **孤儿清理**：从 `posts.json` 删掉一篇再构建，对应 `dist/p/<id>/` 消失；恢复后重新出现
- **XSS 复扫**：`dist/` 下 136 个 HTML/XML 文件（968 KB），17 条危险模式 0 命中。扫描器先对一段已知恶意样本自检，确认 17 条规则全部会响，再开始扫——写错的扫描器「0 命中」和干净的站点看起来一模一样
- **feed 回灌**：用项目自己的 `parseFeed` 解析 `dist/feed.xml`，30 条全部有 guid / link / title / pubDate，link 全部是带 basePath 的绝对文章地址且指向的页面真实存在，description 全部是纯文本（摘要已剥净标签）并保留指向外部原始出处的「原文链接」
- **preview 全路由**：11 种路由形态 200 且 content-type 正确；6 组分页链接的 prev/next 目标逐个断言（含源内翻页必须留在该源下）；4 组无尾斜杠路径 301 到带斜杠版本；4 组不存在路径返回 404 且响应体是 404 页面；basePath 之外的路径一律 404（basePath 为空时反过来，根路径一律 200）；11 种目录穿越写法全部 404 无泄漏；HEAD 返回 200 且无响应体；POST 返回 405 且带 `Allow: GET, HEAD`
- `deploy/publish-github.sh` 的 `bash -n` 语法检查通过，LF 行尾（`.gitattributes` 已锁定），可执行位已设

**本机无法实测、需你实际发布后验证（不假装通过）：**

- `gh-pages` 分支推送后 GitHub Pages 的实际构建与生效（依赖你的仓库与 Pages 设置）——**发布脚本本身也从未被执行过**，它会向远端推送，属于对外可见操作
- GitHub Pages 对无尾斜杠目录路径的跳转行为（本地 preview 是照它的行为实现的，不是反过来）
- `.nojekyll` 在真实 Jekyll 管线下的效果
- `404.html` 是否被正确用于未命中路径
- 线上 CDN 的缓存表现

## 依赖

只有两个，均为纯 JS，无需 node-gyp / 编译工具链：

| 包 | 用途 | 为什么不用标准库 |
|---|---|---|
| `fast-xml-parser` | 解析 RSS / Atom | 手写 XML 解析在 CDATA、命名空间、嵌套实体上必然出错 |
| `sanitize-html` | 清洗外部 HTML | 这是安全边界，绝不能自己用正则剥标签 |

其余全用标准库：`node:fs`、`node:http`、`node:crypto`、原生 `fetch`。
