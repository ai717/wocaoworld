#!/usr/bin/env bash
# 把 dist/ 发布到 GitHub Pages 的 gh-pages 分支。
#
# 前置条件：
#   1. 本目录是 git 仓库，且 origin 指向你的 GitHub 仓库
#   2. 仓库 Settings → Pages 已选 Deploy from a branch → gh-pages → / (root)
#   3. 已经跑过 npm run build
#
# 这个脚本会向远端推送，是对外可见的操作。
set -euo pipefail

cd "$(dirname "$0")/.."

fail() {
  echo "错误: $*" >&2
  exit 1
}

BRANCH=gh-pages

[ -d dist ] || fail "dist/ 不存在，先跑 npm run build"
[ -f dist/index.html ] || fail "dist/index.html 不存在，dist/ 不是完整的构建产物"
# 少了它 GitHub Pages 会跑 Jekyll，对镜像正文里的 {{ }} 与 {% %} 做 Liquid 解析
[ -f dist/.nojekyll ] || fail "dist/.nojekyll 缺失，构建产物不完整，请重新 npm run build"

git rev-parse --git-dir >/dev/null 2>&1 || fail "当前目录不是 git 仓库"
remote_url=$(git remote get-url origin 2>/dev/null) ||
  fail "没有 origin 远端，先执行 git remote add origin <你的仓库地址>"

# 用 glob 而不是 find|wc：pipefail 下 find 对不存在的目录返回非零会直接中断脚本
shopt -s nullglob
post_dirs=(dist/p/*/)
source_dirs=(dist/s/*/)
shopt -u nullglob
posts=${#post_dirs[@]}
sources=${#source_dirs[@]}

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
work="$tmp/repo"

# 用临时 clone 而不是 git worktree：worktree 会在主仓库留下注册状态，
# 异常退出后需要手工清理，对一个发布脚本来说是不必要的复杂度。
if git ls-remote --exit-code --heads origin "$BRANCH" >/dev/null 2>&1; then
  echo "拉取远端已有的 $BRANCH 分支…"
  git clone --quiet --depth 1 --branch "$BRANCH" --single-branch "$remote_url" "$work"
else
  echo "远端还没有 $BRANCH 分支，新建孤儿分支"
  mkdir -p "$work"
  git -C "$work" init --quiet
  git -C "$work" checkout --quiet --orphan "$BRANCH"
  git -C "$work" remote add origin "$remote_url"
fi

# 清空旧内容但保留 .git，这样被删掉的文章不会在分支上留下孤儿目录
find "$work" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +

# 注意是 dist/. 而不是 dist，否则 .nojekyll 这类点文件不会被带上
cp -r dist/. "$work"/

git -C "$work" add -A

if git -C "$work" rev-parse --verify HEAD >/dev/null 2>&1 &&
  git -C "$work" diff --cached --quiet; then
  echo "dist/ 与线上 $BRANCH 内容一致，无需发布"
  exit 0
fi

git -C "$work" commit --quiet -m "发布静态站点：${posts} 篇文章 / ${sources} 个源"
git -C "$work" push --quiet origin "$BRANCH"

echo "已推送到 $BRANCH：${posts} 篇文章 / ${sources} 个源"
echo "GitHub Pages 重新生效通常要一两分钟。"
