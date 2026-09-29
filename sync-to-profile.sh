#!/bin/sh
# 把源码同步进 desktop profile 的 pnpm 副本（file: 依赖是复制不是链接），
# 然后用 plugin_manager 开关一次 quota-float 强制模块图重组（或手动刷新页面）。
set -e
SRC="$(cd "$(dirname "$0")" && pwd)"
DST="$HOME/.dsh/profiles/desktop/node_modules/dsh-quota-float"
[ -d "$DST" ] || { echo "profile 副本不存在：$DST"; exit 1; }
install "$SRC/lib/client.js" "$DST/lib/client.js"
# index.js 与 profile 副本可能同 inode（pnpm 部分硬链），cp 会报 identical；用 install 覆盖即可
install "$SRC/lib/index.js" "$DST/lib/index.js" 2>/dev/null || true
cp "$SRC/cordis.patch.yml" "$SRC/package.json" "$DST/" 2>/dev/null || true
echo "synced -> $DST"
echo "如页面未自动热更新：DSH 会话内让 agent 执行 plugin_manager set_plugin include:quota-float 关/开各一次，或刷新页面（⌘R）。"
