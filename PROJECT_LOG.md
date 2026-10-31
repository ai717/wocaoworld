# PROJECT_LOG

## 2026-11-01 · Google 验证、Google Analytics 接入与深度 SEO 优化

### 做了什么

1. **Google Search Console 网站所有权验证**：
   - 将验证文件 `google866db18e376db9e8.html` 放入 `public/` 目录，构建时自动打包到 `dist/` 根目录。
   - 探测线上 `https://wocao.world/google866db18e376db9e8.html` 返回 200 OK，验证已生效。
2. **Google Analytics (GA4) 接入**：
   - 在 `src/render.mjs` 的通用 `layout` 模板 `<head>` 中嵌入 Google Analytics (gtag.js: `G-8TX501TYGH`) 统计代码，覆盖首页、分页、文章详情、关于、归档等全站页面。
3. **深度 SEO 优化**：
   - **解除全站索引封锁**：修改 `config.json` 将 `"noindex": false`，`robots.txt` 输出 `Allow: /` 并自动引用 Sitemap，页面 meta 输出 `index,follow`。
   - **规范化 Canonical 标签**：将文章详情页 canonical 从原来的“指向外部源站链接”改为指向“本站自身永久链接”（`https://wocao.world/p/<id>/`），解决此前 Google 判定为重复内容而不予收录的问题；保留正文底部的原作者出处与版权引用。
   - **注入 Schema.org (JSON-LD) 结构化数据**：文章页自动生成 `BlogPosting` 富媒体卡片摘要（包含标题、发布/更新时间、作者、发布机构、URL）。
   - **完善社交分享元数据**：文章页动态输出 `og:type="article"`、`article:published_time`、`og:url`、`twitter:title`、`twitter:description` 等。
   - **标准网站地图 (Sitemap)**：升级 `src/build.mjs`，为 `sitemap.xml` 生成标准 `changefreq`、`priority` 与文章 `lastmod`。
4. **CI/CD 自动化完善**：
   - 在 `.github/workflows/sync.yml` 中添加 `push: branches: [main]` 触发，本地向 `main` 分支推送后自动构建并发布到 `gh-pages`。

### 修改文件

`config.json`、`src/render.mjs`、`src/build.mjs`、`public/google866db18e376db9e8.html`、`google866db18e376db9e8.html`、`.github/workflows/sync.yml`、`PROJECT_LOG.md`。

### 关键实现与遇到的问题

- **远端并发推送冲突**：云端 GitHub Actions 定时抓取后会自动将最新数据（`data/*.json`）推回 `main` 分支。本地推送时若落后，使用 `git pull --rebase origin main` 平滑合并后推送，未产生冲突。
- **旧站 521 与 GSC 报错排查**：诊断了用户原域名 `wocao.club` 的 GSC 5xx 报警，实测为 Cloudflare 回源失败（HTTP 521），明确了 301 重定向到 `wocao.world` 的迁移方案。

---

## 2026-10-12 · GitHub Actions 云端定时抓取与发布

### 做了什么

- 增加 GitHub Actions 工作流（`.github/workflows/sync.yml`），每 4 小时在海外 Runner 定时同步 Feed，彻底规避境内网络对部分源站的 GFW 阻断与 ECONNRESET。
- 自动化流水线自动将变更后的 `data/*.json` 提交推回 `main` 分支（带 `[skip ci]`），保障历史文章在云端与本地持久化累积。
- 构建静态产物自动通过 `peaceiris/actions-gh-pages` 部署到 `gh-pages`，保留 `CNAME` 与 `.nojekyll`。
- `config.mjs` 增加对 `GITHUB_ACTIONS` 环境变量的识别：云端直连免代理，本地支持代理配置。
- 本地 CMS 增加网络代理可视化设置与「拉取云端数据」按钮。

### 修改文件

`.github/workflows/sync.yml`、`src/config.mjs`、`src/cms.mjs`、`config.json`、`.gitignore`、`AGENTS.md`、`PROJECT_LOG.md`。

---

## 2026-09-04 · 本地 CMS、统一服务与自定义域名

### 做了什么

- 新增本地 CMS（`127.0.0.1:65354/cms/`）：支持站点设置、源管理、同步、构建、预览与发布。
- 完善 SEO 元数据、favicon、`robots.txt`、`sitemap.xml`，构建自动写出自定义域名 `CNAME`。
- 增加中文编码探测与 GB18030 回退，优化抓取健壮性。

---

## 2026-09-03 · 架构改造（静态站点 + GitHub Pages）

### 决策与改造

- 放弃原 VPS 常驻 Node + SQLite 方案，重构为纯前端静态生成器：`sync`（抓取并写入 JSON）→ `build`（静态化 HTML 到 `dist/`）→ `deploy`（推送 `gh-pages` 分支）。
- 建立不可破坏的不变量：站内路径全部走 `urls.mjs` helper、构建前清空 `dist/`、生成 `.nojekyll`、保持文章 ID sha256 算法稳定。
