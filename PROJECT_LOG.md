# PROJECT_LOG

开发轮次记录，最新在上。只记**做了什么、为什么这么决定、遗留了什么**——
规则与不变量见 `AGENTS.md`，使用说明见 `README.md`，此处不重复。

---

## 2026-09-03 · 改造为本地构建的静态站点，发布到 GitHub Pages

提交 `1435d3d`（基线 `b93c77a`）。25 个文件，+908/−1193。

### 做了什么

放弃「VPS 上跑两个 Node 进程 + SQLite 按需渲染」，改为本地 `sync → build → deploy` 三段手动流水线，线上只剩 GitHub Pages 静态托管。

四项已确认的方向选择及其后果：

| 维度 | 选择 | 关键后果 |
|---|---|---|
| 发布目标 | 只发 GitHub Pages | 必须支持 basePath 子路径前缀；无服务端 301；VPS 物料全部作废 |
| 内容库 | JSON 快照，弃 SQLite | Node 门槛从 ≥22.5 降到 ≥20.11；原子写/去重索引/自增 id 都要自己实现 |
| 运行时服务 | 删掉，改构建 + 极简预览 | URL 只剩一套真值，不再维护「路由表 vs 产物表」 |
| 发布方式 | 本地构建 + 推送脚本 | 不引入 CI；内容更新不再自动 |

**一个有利的意外**：选 JSON 快照时预估的代价是「CI 每次都得全量重抓」，但发布方式定的是本地构建，`data/` 照样能持久保存 ETag 与已见链接集合，增量同步能力完全保留，那个代价不成立。

### 修改文件

- **新增** `src/store.mjs`、`src/urls.mjs`、`src/build.mjs`、`src/preview.mjs`、`deploy/publish-github.sh`
- **修改** `src/config.mjs`、`src/render.mjs`、`src/sync.mjs`、`src/cli.mjs`、`package.json`、`package-lock.json`、`.gitignore`、`.gitattributes`、`config.json`、`README.md`
- **删除** `src/db.mjs`、`src/routes.mjs`、`src/server.mjs`、`src/index.mjs`、`deploy/{setup.sh, update.sh, Caddyfile, wocao-web.service, wocao-sync.service, wocao-sync.timer}`

### 关键实现方式

- **`store.mjs` 刻意沿用 `db.mjs` 的函数名与签名**，让 `sync.mjs`/`cli.mjs` 的改动退化成机械替换。磁盘上存 camelCase、对外返回 snake_case 行，`render.mjs` 的调用点一行没动。
- **118 篇文章从 SQLite 一次性迁移到 JSON**（临时脚本，未进仓库），迁移后逐字段比对两个后端的全部 API 输出，再写盘重开比一次。这样能拿真实内容验证新管线，也省去对 4 个公开源的一次全量重抓。`data/blog.sqlite` 已删除。
- **黄金样本回归**：趁 `server.mjs`/`routes.mjs` 还在，先用旧的按需渲染抓下 134 个页面，重构完再逐文件 diff。这是证明「15 处硬编码收口 + 尾斜杠」没有改变输出的唯一硬证据。
- **`urls.mjs` 的 `absolute()` 闭包收的是 `origin` 而不是 `site.url`**，见下「问题 2」。
- **preview 按 basePath 前缀挂载 `dist/`**，让本地 URL 与线上完全一致，链接写错在本地就暴露。

### 遇到的问题

1. **`config.mjs` 把 `site.url` 规范化成了 `origin`，会吞掉路径部分。** 站长写 `https://user.github.io/wocao.world/` 加载后只剩 `https://user.github.io`，feed 的 self/permalink/channel link 全错。这是 GitHub Pages 项目站点的直接阻塞点，改为单独派生 basePath。
2. **批准方案里的 `absoluteUrl(site.url, postUrl(id))` 会拼出双重前缀。** `site.url` 本身已含 basePath，`postUrl` 返回的又带 basePath，结果是 `…/wocao.world/wocao.world/p/id/`。实施时改成 `makeUrls(basePath, origin)` + 单参数 `absolute(p)`，并**故意从 `absoluteUrl` 改名为 `absolute`**，让漏改的两参数调用点直接报错而不是静默拼错。
3. **方案给的 `site.url` 占位值 `https://<你的用户名>.github.io/…` 会让程序崩。** `<`/`>` 是非法 host 码点，过不了 `assertHttpUrl`。改填语法合法的 `https://ai717.github.io/wocao.world`（从 git `user.name` 推的）。
4. **链接扫描器把镜像正文里的示例代码误报成相对链接。** `<pre><code>` 与行内 `<code>` 里装着转义后的 `&lt;img src="whatever.jpg"&gt;`，那是文本不是属性。修法是先整块剔除代码块再扫，同时**断言代码块内不含任何活标签**——有就说明清洗漏了，仍然要报。第一版只剔 `<pre>` 剩 4 处误报，扩到 `<code>` 才归零。
5. **`set -o pipefail` 下 `find dist/p | wc -l` 会中断发布脚本。** `find` 对不存在的目录返回非零。改用 `shopt -s nullglob` + glob 数组计数。
6. **第一版黄金样本 diff 产出 141 个差异桶，全是噪声。** 按「差异形状」聚合时被作者名变化淹没。重写成只归一化「刻意添加的尾斜杠」这一种预期差异、其余原样打印，才看清真实结果。
7. **旧 README 关于「移除源后列表页不再显示」的说法是错的。** 查了基线里的 `db.mjs`：`listPosts` 与 `listSourcesWithCounts` 都没有 `WHERE active = 1`。`active` 只决定抓不抓，不决定显不显示。新 README 已改成实际行为。
8. **`package-lock.json` 的 version 没跟着 `package.json` 升到 0.2.0。** `npm install --package-lock-only --offline` 修掉，只有 3 行版本号变化，无依赖漂移。

### 验证结果（本机 Windows / Node v24，全部实测）

迁移保真（4 源 118 篇逐字段一致）· JSON 往返一致 · 条件请求存活（迁移后首轮即有 2 源 304，第二轮 4 源全部未变更）· 黄金样本 134 页中 133 页只差刻意加的尾斜杠、`/about/` 只差 2 行刻意改的说明文字 · basePath 两种取值下各 3073 个链接全部合规、0 个漏前缀的根绝对路径 · 产物 138 个文件与独立推导的期望集合完全吻合 · 连续两次构建逐字节相同 · 删一篇文章后对应 `dist/p/<id>/` 消失、恢复后重现 · XSS 复扫 136 文件 968KB 0 命中（扫描器先对恶意样本自检 17/17 规则会响）· feed 回灌 30 条全部字段齐全且链接指向真实存在的页面 · preview 11 种路由 + 6 组分页目标 + 4 组 301 + 4 组 404 + 11 种目录穿越写法 + HEAD/405 全绿 · 发布脚本 `bash -n` 通过、LF 行尾、可执行位已设。

**未验证**（本机做不到，不假装通过）：`gh-pages` 实际推送与 GitHub Pages 构建（**发布脚本本身也从未执行过**，它会向远端推送）、无尾斜杠路径的真实跳转行为、`.nojekyll` 在真实 Jekyll 管线下的效果、`404.html` 是否被采用、CDN 缓存表现。

### 遗留

- `config.json` 的 `site.url` 是占位值，待用户确认真实 Pages 地址。
- `src/fetch-feed.mjs:1` 的 UA 硬编码 `wocao.world/0.1 (+https://wocao.world/about/)`，版本号与联系 URL 都过时。让它跟随 config 需要把 config 传进抓取层，属于计划外改动，未做。
- 4 个源里 3 个是 `full` 模式，发布到公开仓库前需重新评估版权暴露面。README 已写明，未擅自改用户的 config。
- 临时验证脚本（黄金样本 diff、XSS 扫描、feed 回灌、preview 路由、dist 校验）按计划**用完即删，未进仓库**。日后要做回归验证需重写；关键断言口径已记录在本节「验证结果」里。

---

## 2026-09-03 · 改造前基线（VPS 常驻服务 + SQLite 按需渲染）

提交 `b93c77a`。

这套在上一轮已完整实现并端到端验证通过：4 源 118 篇、18 条路由形态、XSS 扫描 0 命中、WAL 并发无冲突、`VACUUM INTO` 在线备份可用。架构是 `wocao-web.service`（常驻，只监听 127.0.0.1:3000）+ `wocao-sync.service`（systemd timer 每 30 分钟触发）共用一个 SQLite 库，Caddy 作唯一对外入口。

之所以先提交这一份：改造要删掉 `db/routes/server/index` 四个模块与全部 VPS 部署物料，而**这个目录当时还不是 git 仓库，删除不可回滚**。

上述文件在下一轮全部删除，但仍可从 `b93c77a` 取回。旧 README 的 VPS/systemd/Caddy/宝塔 章节亦已随 `1435d3d` 移除，需要时查该提交。
