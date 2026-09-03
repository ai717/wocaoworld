#!/usr/bin/env bash
#
# wocao.world 首次部署脚本 —— Debian / Ubuntu，root 执行，幂等可重跑。
#
#   sudo bash deploy/setup.sh
#
# 从当前代码检出目录把应用拷到 /opt/wocao，装好 Node 24 与 Caddy，
# 注册 systemd 单元并跑一次首同步。更新代码请用 deploy/update.sh。

set -euo pipefail

APP_DIR=/opt/wocao
DATA_DIR=$APP_DIR/data
APP_USER=wocao
NODE_MAJOR=24
PORT=3000

log()  { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m !!\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m错误:\033[0m %s\n' "$*" >&2; exit 1; }

SRC_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)

# ---------------------------------------------------------------- 前置检查

[ "$(id -u)" -eq 0 ] || die "请用 root 执行：sudo bash deploy/setup.sh"

. /etc/os-release || die "读不到 /etc/os-release"
case " ${ID-} ${ID_LIKE-} " in
  *debian*|*ubuntu*) ;;
  *) die "本脚本只支持 Debian / Ubuntu（apt）。当前是 ${PRETTY_NAME:-未知发行版}，请手工安装 Node ${NODE_MAJOR}.x 与 Caddy 后，参照本脚本余下步骤操作。" ;;
esac

for f in package.json package-lock.json config.json src public deploy/Caddyfile; do
  [ -e "$SRC_DIR/$f" ] || die "代码目录不完整，缺少 $SRC_DIR/$f"
done

# ---------------------------------------------------------------- 系统依赖

export DEBIAN_FRONTEND=noninteractive

log "更新 apt 并安装基础工具"
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https >/dev/null

log "添加 NodeSource ${NODE_MAJOR}.x 源"
curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" -o /tmp/nodesource_setup.sh \
  || die "下载 NodeSource 安装脚本失败"
bash /tmp/nodesource_setup.sh >/dev/null
rm -f /tmp/nodesource_setup.sh

log "添加 Caddy 官方源"
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg \
  || die "导入 Caddy GPG key 失败"
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  > /etc/apt/sources.list.d/caddy-stable.list \
  || die "写入 Caddy apt 源失败"

log "安装 nodejs 与 caddy"
apt-get update -qq
apt-get install -y -qq "nodejs" caddy >/dev/null

NODE_BIN=$(command -v node || true)
[ -n "$NODE_BIN" ] || die "node 没装上，或不在 PATH 里"
log "node $($NODE_BIN -v) @ $NODE_BIN，npm $(npm -v)"

# node:sqlite 是整个方案的地基，Node 构建里若被裁掉必须在这里就停下
if ! "$NODE_BIN" -e "require('node:sqlite').DatabaseSync" >/dev/null 2>&1; then
  die "这个 node 构建没有 node:sqlite 模块（需要 Node >= 22.5）。请改装 NodeSource 的 ${NODE_MAJOR}.x。"
fi
log "node:sqlite 可用"

# ---------------------------------------------------------------- 服务用户

if id -u "$APP_USER" >/dev/null 2>&1; then
  log "系统用户 $APP_USER 已存在，跳过创建"
else
  log "创建系统用户 $APP_USER（无登录 shell）"
  useradd --system --no-create-home --shell /usr/sbin/nologin "$APP_USER"
fi

# ---------------------------------------------------------------- 代码落地

install -d -m 755 "$APP_DIR"
install -d -m 755 "$DATA_DIR"

if [ "$SRC_DIR" = "$APP_DIR" ]; then
  log "代码已在 $APP_DIR，跳过拷贝"
else
  log "拷贝代码到 $APP_DIR"
  rm -rf "$APP_DIR/src" "$APP_DIR/public"
  cp -a "$SRC_DIR/src" "$SRC_DIR/public" "$APP_DIR/"
  cp -a "$SRC_DIR/package.json" "$SRC_DIR/package-lock.json" "$APP_DIR/"
  # 订阅源清单可能已在服务器上手工改过，绝不覆盖
  if [ -e "$APP_DIR/config.json" ]; then
    warn "$APP_DIR/config.json 已存在，保留服务器上的版本（未覆盖）"
  else
    cp -a "$SRC_DIR/config.json" "$APP_DIR/"
  fi
fi

log "安装生产依赖（npm ci --omit=dev）"
cd "$APP_DIR"
npm ci --omit=dev --no-audit --no-fund

log "收紧文件权限：代码归 root 只读，只有 data/ 归 $APP_USER"
chown -R root:root "$APP_DIR"
chmod -R a+rX "$APP_DIR/src" "$APP_DIR/public" "$APP_DIR/node_modules"
chmod a+r "$APP_DIR/package.json" "$APP_DIR/package-lock.json" "$APP_DIR/config.json"
chown -R "$APP_USER:$APP_USER" "$DATA_DIR"
chmod 750 "$DATA_DIR"

# ---------------------------------------------------------------- systemd

log "安装 systemd 单元"
for unit in wocao-web.service wocao-sync.service wocao-sync.timer; do
  cp -a "$SRC_DIR/deploy/$unit" "/etc/systemd/system/$unit"
  if [ "$NODE_BIN" != /usr/bin/node ]; then
    warn "node 不在 /usr/bin，改写 $unit 的解释器路径为 $NODE_BIN"
    sed -i "s#^ExecStart=/usr/bin/node#ExecStart=${NODE_BIN}#" "/etc/systemd/system/$unit"
  fi
done

log "安装 Caddyfile"
install -d -m 755 /etc/caddy /var/log/caddy
if [ -e /etc/caddy/Caddyfile ] && ! cmp -s "$SRC_DIR/deploy/Caddyfile" /etc/caddy/Caddyfile; then
  backup="/etc/caddy/Caddyfile.bak.$(date +%Y%m%d%H%M%S)"
  cp -a /etc/caddy/Caddyfile "$backup"
  warn "原有 /etc/caddy/Caddyfile 与本次不同，已备份到 $backup"
fi
cp -a "$SRC_DIR/deploy/Caddyfile" /etc/caddy/Caddyfile

log "校验 Caddyfile"
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null \
  || die "Caddyfile 校验失败，请检查 deploy/Caddyfile 里的域名与语法"

log "启动服务"
systemctl daemon-reload
systemctl enable --now wocao-web.service
systemctl enable --now wocao-sync.timer
systemctl enable --now caddy
systemctl restart caddy

# ---------------------------------------------------------------- 首同步与自检

log "立即跑一次同步（首次会抓全量，可能要一两分钟）"
if systemctl start wocao-sync.service; then
  journalctl -u wocao-sync -n 20 --no-pager || true
else
  warn "首次同步失败。站点仍会正常起来，只是暂时没文章。排查：journalctl -u wocao-sync -n 50"
fi

log "本机自检 http://127.0.0.1:${PORT}/"
ok=""
for _ in $(seq 1 20); do
  if curl -fsS -o /dev/null "http://127.0.0.1:${PORT}/"; then ok=1; break; fi
  sleep 0.5
done
if [ -n "$ok" ]; then
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}/")
  log "本地返回 HTTP ${code}"
  [ "$code" = 200 ] || warn "状态码不是 200，检查 journalctl -u wocao-web -n 50"
else
  die "127.0.0.1:${PORT} 连不上。检查：systemctl status wocao-web && journalctl -u wocao-web -n 50"
fi

cat <<EOF

部署完成。接下来：

  1. 确认 DNS：wocao.world 的 A / AAAA 记录已指向本机公网 IP
  2. 放行防火墙（若启用了 ufw）：
       sudo ufw allow OpenSSH
       sudo ufw allow 80/tcp && sudo ufw allow 443/tcp
     注意不要放行 ${PORT} —— Node 只监听回环，对外由 Caddy 代理。
  3. 等 Caddy 签出证书后验证：curl -I https://wocao.world/
     签发过程看日志：journalctl -u caddy -f

常用命令：
  systemctl status wocao-web          # Web 服务状态
  systemctl list-timers wocao-sync    # 下次同步时间
  systemctl start wocao-sync          # 手动强制同步一次
  journalctl -u wocao-web -f          # 实时访问日志
  cd ${APP_DIR} && sudo -u ${APP_USER} npm run stats   # 库内统计
EOF
