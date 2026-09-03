# wocao.world

由 RSS / Atom / JSON Feed 订阅源**自动聚合生成**的极简博客。不写原创，只做搬运与归档：程序定时抓取若干订阅源，把条目镜像成本站文章，每篇都保留原文永久链接与署名。

纯 Node.js 标准库实现，只有 2 个依赖，不需要编译任何原生模块，不需要 Docker。

---

## 架构

两个独立进程共用同一个 SQLite 库，互不阻塞：

```
wocao-sync.service   （systemd timer 每 30 分钟触发，oneshot，跑完即退）
  fetch-feed → parse-feed → sanitize → 写入 SQLite

wocao-web.service    （常驻，只监听 127.0.0.1:3000）
  HTTP 请求 → routes → 查 SQLite → 模板字符串 → HTML

Caddy                （唯一对外入口，自动 HTTPS，反代到 3000）
```

拆成两个 unit 的理由：同步要碰外部网络和不可信 XML，是最容易出问题的环节。拆开之后一次失败的抓取绝不会带下 Web 进程，`journalctl -u wocao-sync` 能直接看到同步历史。

**不用进程内 `setInterval`** —— 调度完全交给 systemd timer，避免两套定时机制互相打架。本机开发时手动 `npm run sync && npm start`。

**按需渲染而非预生成静态文件** —— SQLite 已是唯一事实来源，再落一份 HTML 会引入双状态同步与孤儿页清理问题。模板字符串 + ETag 的开销是微秒级，博客流量完全够用。

## 目录结构

```
├── package.json            # type: module；scripts: start / sync / stats
├── config.json             # 站点信息 + 订阅源清单（唯一内容源入口）
├── public/style.css        # 极简单栏排版，零 JS
├── data/                   # 运行时生成，已 gitignore；blog.sqlite(+wal/shm)
├── src/
│   ├── index.mjs           # Web 进程入口
│   ├── cli.mjs             # 子命令 sync / stats / serve
│   ├── config.mjs          # 读取校验 config.json
│   ├── db.mjs              # node:sqlite 初始化、PRAGMA、建表、全部查询
│   ├── sync.mjs            # 同步编排：源间串行、入库统计、失败隔离
│   ├── fetch-feed.mjs      # 抓取：UA、超时、体积上限、条件请求
│   ├── parse-feed.mjs      # RSS 2.0 / RSS 1.0 / Atom / JSON Feed → 统一结构
│   ├── sanitize.mjs        # 白名单清洗 + 相对链接与图片地址绝对化
│   ├── render.mjs          # 布局与页面模板（纯函数返回字符串）
│   ├── routes.mjs          # URL → 处理函数 分发
│   └── server.mjs          # node:http、ETag、Cache-Control、错误页
└── deploy/
    ├── setup.sh            # VPS 首次部署（一次性，root 执行）
    ├── update.sh           # 拉新代码后重装依赖并重启
    ├── wocao-web.service
    ├── wocao-sync.service
    ├── wocao-sync.timer
    └── Caddyfile
```

## 本机开发

需要 **Node ≥ 22.5**（`node:sqlite` 的起点），推荐 24 LTS。

```bash
npm install
npm run sync     # 抓取全部订阅源入库
npm run stats    # 看库内统计
npm start        # 起 Web，默认 http://127.0.0.1:3000/
```

`npm run sync` 的典型输出：

```
开始同步 4 个订阅源
  = https://simonwillison.net/atom/everything/ 未变更
  + Daring Fireball: 新增 0，跳过 48
  = https://jvns.ca/atom.xml 未变更
  = https://blog.cloudflare.com/rss/ 未变更
同步完成：新增 0 篇，失败 0/4 个源
```

`=` 表示源返回 304（条件请求命中，没重新下载），`+` 表示重新抓取并入库。任何源失败都会以 `!` 标出，并让进程以非零码退出。

可用环境变量：

| 变量 | 默认 | 说明 |
|---|---|---|
| `HOST` | `127.0.0.1` | 监听地址。**生产环境不要改成 0.0.0.0**，对外交给 Caddy |
| `PORT` | `3000` | 监听端口 |
| `BLOG_DATA_DIR` | `<项目>/data` | SQLite 存放目录 |

## 配置

`config.json` 是订阅源的**唯一事实来源**，不提供任何网页端添加入口（这是刻意的功能缺失，见下文「安全边界」）。

```json
{
  "site": {
    "title": "我操世界",
    "description": "一个由订阅源自动聚合生成的博客，不写原创，只做搬运与归档。",
    "url": "https://wocao.world",
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

### `mode` 与版权

| mode | 行为 | 用在哪 |
|---|---|---|
| `full` | 清洗后的正文全文落库，本站可完整阅读 | 明确允许转载、或 CC 协议的源 |
| `excerpt` | **只存摘要**，正文不落库，页面引导读者回原文 | 未明确授权转载的源 |

纯镜像全文有转载版权风险，且搜索引擎会判定重复内容。除 `mode` 之外还有三项缓解已内建：

- 文章页强制显示来源名、原作者、原文永久链接，正文内所有链接指向原站
- `<head>` 输出 `<meta name="robots" content="noindex,follow">`（`noindex: false` 可关）
- 每篇文章的 `<link rel="canonical">` 指向**原文**而非本站

### 改订阅源

改完 `config.json` 后：

- 本机：`npm run sync`
- VPS：`sudo systemctl start wocao-sync`

每轮同步开始时会与 `sources` 表对账：新增的源插入，从 config 移除的源置 `active = 0`。**移除源不会删历史文章**，只是不再抓取、列表页不再显示。

## 页面路由

| 路径 | 内容 |
|---|---|
| `/` | 首页，最新 `postsPerPage` 篇 |
| `/page/<n>` | 分页 |
| `/p/<id>` | 文章页：清洗后正文 + 来源署名 + 原文链接 |
| `/s/<source_id>` | 按来源筛选，`/s/<id>/page/<n>` 翻页 |
| `/sources/` | 订阅源列表、各自同步状态与条目数 |
| `/feed.xml` | 本站聚合输出的 RSS 2.0，让别人能订阅这个聚合站 |
| `/about/` | 说明页，含来源与版权声明 |
| `/style.css` | 静态文件，从 `public/` 读取 |

---

## VPS 部署

### 前置条件

- **Debian 或 Ubuntu**（`setup.sh` 用 apt；Alpine / Arch / RHEL 系需自行改包管理部分）
- **systemd ≥ 245**（unit 里用了 `ProtectKernelLogs`、`ProtectClock` 等指令；更旧的版本会忽略未知指令并告警，仍能启动，只是加固项少一些）
- 域名 A / AAAA 记录已指向 VPS 公网 IP，且 80、443 可从公网访问 —— Caddy 要靠这个签 Let's Encrypt 证书
- 1 GB 内存 / 10 GB 磁盘的最低配即可

### 步骤

```bash
# 1. 把代码放到 VPS 上（任意目录，不要放 /opt/wocao）
git clone <你的仓库地址> ~/wocao.world
cd ~/wocao.world

# 2. 先改配置：站点标题、域名、订阅源
vim config.json
vim deploy/Caddyfile          # 把 wocao.world 换成你的域名

# 3. 部署
sudo bash deploy/setup.sh
```

`setup.sh` 会依次：装 NodeSource 24.x 与 Caddy → 验证 `node:sqlite` 可用 → 建无登录 shell 的系统用户 `wocao` → 拷代码到 `/opt/wocao` → `npm ci --omit=dev` → 收紧权限 → 装三个 systemd 单元与 Caddyfile → `caddy validate` → 启动 → 立即跑一次首同步 → `curl 127.0.0.1:3000` 自检。

脚本**幂等可重跑**，且从不覆盖服务器上已存在的 `config.json`。

### 防火墙

```bash
sudo ufw allow OpenSSH                                  # 先放 SSH，避免把自己锁在外面
sudo ufw allow 80/tcp && sudo ufw allow 443/tcp
sudo ufw status numbered
```

**不要放行 3000。** Node 只监听 `127.0.0.1`，对外一律由 Caddy 代理。确认没有意外暴露：

```bash
ss -ltnp | grep -E ':(80|443|3000)\b'
# 3000 那行的 Local Address 必须是 127.0.0.1:3000，不能是 0.0.0.0:3000
```

### 验证部署

```bash
systemctl status wocao-web              # 应为 active (running)
systemctl list-timers wocao-sync.timer  # 应显示下次触发时间
curl -I http://127.0.0.1:3000/          # HTTP/1.1 200 OK
curl -I https://你的域名/                # 证书签出后应为 200；之前会是 Caddy 的暂时无服务
journalctl -u caddy -f                  # 看证书签发过程
```

Caddy 首次签发通常在 10 秒内完成。若卡住，九成是 DNS 未生效或 80/443 不可达（云厂商安全组也要放行，不只是 ufw）。

## 日常运维

### 更新代码

```bash
cd ~/wocao.world
git pull
sudo bash deploy/update.sh
```

`update.sh` 拷代码 → `npm ci --omit=dev` → 更新 systemd 单元（有变化才 `daemon-reload`）→ 重启 `wocao-web` → 自检 → 触发一次同步 → 打印最近日志。

它**不动 Caddy 配置**，也从不覆盖 `/opt/wocao/config.json` 与 `data/`。改了 Caddyfile 就单独：

```bash
sudo vim /etc/caddy/Caddyfile && sudo caddy validate --config /etc/caddy/Caddyfile && sudo systemctl reload caddy
```

改了 `/opt/wocao/config.json`（增删订阅源）之后跑一次 `sudo systemctl start wocao-sync`。

### 手动同步与查看状态

```bash
sudo systemctl start wocao-sync                              # 强制立即同步
sudo journalctl -u wocao-sync -n 50 --no-pager               # 看这次同步干了什么
cd /opt/wocao && sudo -u wocao npm run stats                  # 库内统计
```

### 日志

```bash
journalctl -u wocao-web -f        # Web 访问日志，每个请求一行：METHOD PATH STATUS 耗时
journalctl -u wocao-sync -f       # 同步日志
journalctl -u caddy -f            # TLS 签发、反代错误
tail -f /var/log/caddy/wocao.world.access.log   # Caddy 访问日志（JSON）
```

### 调整同步频率

```bash
sudo systemctl edit wocao-sync.timer
```

在打开的 override 文件里写：

```ini
[Timer]
OnUnitActiveSec=10min
```

`systemctl edit` 生成的是 drop-in，不会被 `update.sh` 覆盖。别直接改 `/etc/systemd/system/wocao-sync.timer`，那个文件归 `update.sh` 管。

## 备份与恢复

`data/` 里就是全部状态，三个文件：`blog.sqlite`、`blog.sqlite-wal`、`blog.sqlite-shm`。后两个是 WAL 模式的附属文件，属正常现象。

**不要直接 `cp` 正在运行的库文件** —— WAL 未 checkpoint 时拷出来的三个文件可能不一致。用 SQLite 自己的在线备份：

```bash
sudo -u wocao node -e "
const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync('/opt/wocao/data/blog.sqlite');
db.exec(\"VACUUM INTO '/tmp/blog-backup.sqlite'\");
db.close();
"
sudo mv /tmp/blog-backup.sqlite ~/blog-$(date +%F).sqlite
```

`VACUUM INTO` 产出的是一个自包含的普通库文件，不需要 wal/shm。

恢复：

```bash
sudo systemctl stop wocao-web
sudo cp ~/blog-2026-09-02.sqlite /opt/wocao/data/blog.sqlite
sudo rm -f /opt/wocao/data/blog.sqlite-wal /opt/wocao/data/blog.sqlite-shm
sudo chown wocao:wocao /opt/wocao/data/blog.sqlite
sudo systemctl start wocao-web
```

其实**这个站可以不备份**：所有内容都来自公开订阅源，删库重跑一次 `npm run sync` 就能重建，代价只是丢失历史条目（feed 通常只保留最近几十条）。真正不可再生的只有 `config.json`，而它在 git 里。

## 排障

| 症状 | 先看 | 常见原因 |
|---|---|---|
| `wocao-web` 起不来 | `journalctl -u wocao-web -n 50` | 端口被占（`EADDRINUSE`）；`config.json` 有语法错或缺字段——报错信息会直接指出是哪个字段 |
| 页面能开但没文章 | `journalctl -u wocao-sync -n 50` | 首同步还没跑过或全失败；`npm run stats` 看每个源的 `last_status` |
| 某个源一直失败 | `/sources/` 页面的状态列 | 源地址变了、被墙、超时。失败是隔离的，不影响其他源 |
| 同步报网络错但本机能抓 | `systemd-analyze security wocao-sync` | 沙箱限制。先试把 unit 里的 `RestrictAddressFamilies` 加上 `AF_NETLINK`，或临时注释掉 `ProtectSystem=strict` 定位 |
| HTTPS 证书签不出来 | `journalctl -u caddy -f` | DNS 未生效；80/443 被云厂商安全组或 ufw 挡住 |
| 页面样式没了 | `curl -I http://127.0.0.1:3000/style.css` | `/opt/wocao/public/` 权限不对，`chmod -R a+rX /opt/wocao/public` |
| 数据库锁死 `SQLITE_BUSY` | — | 正常情况下不会出现（已开 WAL + `busy_timeout=5000`）。若出现，检查是不是有第三方工具以独占方式打开了库 |

## 安全边界

镜像进来的正文是**他人可控的不可信输入**，直接插入页面就是 XSS。这个项目的安全设计围绕这一点：

1. **XSS** —— `sanitize-html` 白名单清洗，绝不用正则剥标签。允许标签共 56 个；`script` / `iframe` / `style` / `form` / `input` / `object` / `embed` 连同其文本内容一并移除；所有 `on*` 事件属性移除；`javascript:` / `vbscript:` 协议移除；`class` 与 `style` 属性不在白名单里，外部内容无法注入本站样式。标题、作者等文本字段一律经 `esc()` 转义后才进模板，绝不裸插。
2. **SSRF** —— 不提供任何「网页上添加订阅源」的接口，源清单只能由站长改 `config.json`。这是刻意的功能缺失，不是待补的功能。URL 协议限定 http/https，`file://` 之类一律拒绝。
3. **资源上限** —— 单响应体 ≤ 5 MB（流式读取，超限即中断）、超时 15 s、每源每轮最多入库 100 条、单条正文存储 ≤ 200 KB（超限则不落库正文，页面降级为摘要 + 原文链接）。防异常源撑爆内存。
4. **抓取礼仪** —— 真实 UA 与 `Accept`；带上一轮 ETag / `If-Modified-Since`，304 直接跳过；源间**串行**并间隔 1.5 s，不并发轰炸同一台服务器。
5. **失败隔离** —— 单源失败只写 `sources.last_status`，不影响其他源；sync 进程以非零码退出，让 systemd 与 journal 记录到。
6. **进程隔离与最小权限** —— 专用系统用户 `wocao`（无登录 shell），代码归 root 只读、只有 `data/` 归它可写；unit 加 `ProtectSystem=strict`、`ReadWritePaths=/opt/wocao/data`、`ProtectHome`、`PrivateTmp`、`PrivateDevices`、`NoNewPrivileges`、`CapabilityBoundingSet=`、`RestrictAddressFamilies`、`RestrictSUIDSGID` 等。
   > 刻意**没有**加 `MemoryDenyWriteExecute=true` —— V8 的 JIT 需要可写可执行内存，加上之后 Node 直接起不来。`SystemCallFilter` 同理留给运维自行收紧。
7. **Caddy 侧** —— `encode zstd gzip`、自动 HTTPS 与 HTTP→HTTPS 跳转、`header -Server` 隐藏版本号；本站全是 GET，不代理任何写操作。
8. **静态文件** —— `path.normalize` 之后校验目标仍在 `public/` 内，防目录穿越。

### 已验证 / 待验证

**本机（Windows / Node v24）已实测通过：**

- 三种 feed 格式（RSS 2.0 / Atom / JSON Feed，另含 RSS 1.0 RDF）解析，含 CDATA、`content:encoded` 命名空间、Atom `type="xhtml"` 混排内容、单条目非数组、8 种日期格式
- 清洗层对 18 组攻击与排版样本的行为，以及全站 118 篇文章页的危险模式扫描（0 命中）
- 条件请求缓存：第二轮同步全部返回 304、新增 0
- 失败隔离：DNS 失败源与 404 源被记录到 `last_status`，其余源照常同步，进程退出码 1
- WAL 并发：Web 常驻期间并行跑 sync，无 `SQLITE_BUSY`
- 在线备份：Web 进程持有 WAL 库时用 `VACUUM INTO` 导出，产出可独立打开的自包含库文件，118 篇完整
- ETag / 304、Cache-Control、405、404、301、目录穿越拦截
- `deploy/*.sh` 的 `bash -n` 语法检查，以及全部部署物料为 LF 行尾（`.gitattributes` 已锁定）

**本机无法实测、需在 VPS 上验证（不假装通过）：**

- systemd 单元的实际加载、重启策略、各加固指令是否被目标发行版支持
- **SIGTERM / SIGINT 优雅关闭** —— 在 Windows 上无法验证：Node 不会把这两个信号投递给处理器（实测进程自发 `SIGTERM` / `SIGINT` 后直接以退出码 1 终止，`index.mjs` 里的关闭日志从未打印）。请在 VPS 上用 `systemctl stop wocao-web` 验证，预期日志出现「收到 SIGTERM，正在关闭…」后进程干净退出。
  风险可控：SQLite 处于 WAL 模式，即便退化到被 SIGKILL 也不会损坏数据；`wocao-web.service` 已设 `TimeoutStopSec=15`，不会卡在默认的 90 秒。
- Caddy 自动签发 Let's Encrypt 证书（依赖 DNS 已解析 + 80/443 公网可达）
- `setup.sh` 在真实 Debian / Ubuntu 上的端到端执行
- `node:sqlite` 在 VPS 所装 Node 24 构建中的可用性（`setup.sh` 开头有显式检查，不可用会立即停下并说明）

这些物料只能保证语法正确与逻辑自洽，实机行为以部署时的输出为准。

## 依赖

只有两个，均为纯 JS，无需 node-gyp / 编译工具链：

| 包 | 用途 | 为什么不用标准库 |
|---|---|---|
| `fast-xml-parser` | 解析 RSS / Atom | 手写 XML 解析在 CDATA、命名空间、嵌套实体上必然出错 |
| `sanitize-html` | 清洗外部 HTML | 这是安全边界，绝不能自己用正则剥标签 |

其余全用标准库：`node:sqlite`、`node:http`、`node:crypto`、原生 `fetch`。
