#!/usr/bin/env bash
#
# wocao.world 更新脚本 —— 代码变更后重跑，root 执行。
#
#   cd ~/wocao.world && git pull && sudo bash deploy/update.sh
#
# 只更新应用代码与 systemd 单元，不动 Caddy 配置（改 Caddyfile 请单独
# 编辑 /etc/caddy/Caddyfile 后 systemctl reload caddy），也从不覆盖
# 服务器上已存在的 config.json 与 data/。

set -euo pipefail

APP_DIR=/opt/wocao
DATA_DIR=$APP_DIR/data
APP_USER=wocao
PORT=3000

log()  { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m !!\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m错误:\033[0m %s\n' "$*" >&2; exit 1; }

SRC_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)

[ "$(id -u)" -eq 0 ] || die "请用 root 执行：sudo bash deploy/update.sh"
[ -d "$APP_DIR/src" ] || die "$APP_DIR 不像是已部署的应用目录，请先跑 deploy/setup.sh"
[ -e "$SRC_DIR/package-lock.json" ] || die "代码目录不完整，缺少 $SRC_DIR/package-lock.json"
if [ "$SRC_DIR" = "$APP_DIR" ]; then
  warn "代码目录就是 $APP_DIR，原地更新"
fi

NODE_BIN=$(command -v node || true)
[ -n "$NODE_BIN" ] || die "找不到 node"
"$NODE_BIN" -e "require('node:sqlite').DatabaseSync" >/dev/null 2>&1 \
  || die "这个 node 构建没有 node:sqlite 模块（需要 Node >= 22.5）"

log "拷贝代码到 $APP_DIR"
# 只替换代码目录，data/ 与 config.json 一律不碰
rm -rf "$APP_DIR/src" "$APP_DIR/public"
cp -a "$SRC_DIR/src" "$SRC_DIR/public" "$APP_DIR/"
cp -a "$SRC_DIR/package.json" "$SRC_DIR/package-lock.json" "$APP_DIR/"
if ! cmp -s "$SRC_DIR/config.json" "$APP_DIR/config.json" 2>/dev/null; then
  warn "检出目录的 config.json 与服务器上的不同 —— 保留服务器版本。"
  warn "若要更新订阅源，请手工编辑 $APP_DIR/config.json 后再跑一次 systemctl start wocao-sync"
fi

log "安装生产依赖"
cd "$APP_DIR"
npm ci --omit=dev --no-audit --no-fund

log "收紧文件权限"
chown -R root:root "$APP_DIR/src" "$APP_DIR/public" "$APP_DIR/node_modules" \
  "$APP_DIR/package.json" "$APP_DIR/package-lock.json"
chmod -R a+rX "$APP_DIR/src" "$APP_DIR/public" "$APP_DIR/node_modules"
chmod a+r "$APP_DIR/package.json" "$APP_DIR/package-lock.json"
chown -R "$APP_USER:$APP_USER" "$DATA_DIR"

log "更新 systemd 单元"
changed=""
for unit in wocao-web.service wocao-sync.service wocao-sync.timer; do
  src="$SRC_DIR/deploy/$unit"
  dst="/etc/systemd/system/$unit"
  [ -e "$src" ] || continue
  if [ "$NODE_BIN" != /usr/bin/node ]; then
    sed "s#^ExecStart=/usr/bin/node#ExecStart=${NODE_BIN}#" "$src" > "$dst.new"
  else
    cp -a "$src" "$dst.new"
  fi
  if ! cmp -s "$dst.new" "$dst" 2>/dev/null; then
    mv "$dst.new" "$dst"
    changed=1
    log "$unit 已更新"
  else
    rm -f "$dst.new"
  fi
done
[ -n "$changed" ] && systemctl daemon-reload

log "重启 Web 服务"
systemctl restart wocao-web.service

ok=""
for _ in $(seq 1 20); do
  if curl -fsS -o /dev/null "http://127.0.0.1:${PORT}/"; then ok=1; break; fi
  sleep 0.5
done
[ -n "$ok" ] || die "重启后 127.0.0.1:${PORT} 连不上，回滚：systemctl status wocao-web && journalctl -u wocao-web -n 50"
log "本机自检通过（HTTP $(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}/")）"

log "触发一次同步"
systemctl start wocao-sync.service || warn "本次同步失败，详见 journalctl -u wocao-sync -n 50"

log "最近日志"
journalctl -u wocao-web -n 10 --no-pager || true
echo
journalctl -u wocao-sync -n 20 --no-pager || true

cat <<EOF

更新完成。
  systemctl status wocao-web
  cd ${APP_DIR} && sudo -u ${APP_USER} ${NODE_BIN} --no-warnings=ExperimentalWarning src/cli.mjs stats
EOF
