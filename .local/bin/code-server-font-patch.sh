#!/usr/bin/env bash
#
# code-server-font-patch.sh — 让手机浏览器里的 code-server 终端用上本机 Nerd Font
#
# ── 它解决什么问题 ───────────────────────────────────────────────────────────
# code-server 的界面是在【客户端浏览器】里渲染的，CSS 的 font-family 找的是
# 浏览器能访问到的字体。你在服务器（本机）装了 Maple Mono NF CN，桌面版 VS Code
# 能看到；但手机浏览器没有这个字体文件，于是回退到系统字体 —— Nerd Font 图标
# 全变豆腐块。
#
# 所以必须把字体【送到浏览器那边】。code-server 本身没有“把服务器字体推给客户端”
# 的功能（官方 issue #1374 / #7557 还开着），只能用 workaround：
#   把字体做成 woff2，放进 code-server 自己的静态目录，再用 @font-face 声明。
# 因为字体和页面同源，CSP 的 `font-src 'self'` 天然放行，无需改 CSP。
#
# ── 它具体做什么 ─────────────────────────────────────────────────────────────
#   1. 把本机 ~/.local/share/fonts 下的 Maple Mono NF CN（Regular/Bold）转成 woff2
#      （20MB → ~6MB，省流量）
#   2. 复制到 code-server 的 workbench 目录下 ./fonts/
#   3. 往 workbench.css 追加 @font-face 规则（同源相对路径 ./fonts/...）
#
# ── 什么时候跑 ───────────────────────────────────────────────────────────────
#   安装 / 升级 code-server 之后。因为改的是 mise 装的 code-server 文件，
#   `mise upgrade` 会覆盖掉，需要重跑。已配置 mise postinstall hook 自动执行
#   （见 ~/.config/mise/config.toml 的 [hooks] 段），也可以手动跑本脚本。
#
# ── 环境变量 ─────────────────────────────────────────────────────────────────
#   CODE_SERVER_ROOT   code-server 安装根目录
#                      默认：~/.local/share/mise/installs/github-coder-code-server/latest
#                      该路径是软链，指向当前实际版本，所以升级后依旧有效。
#
# ── 用法 ─────────────────────────────────────────────────────────────────────
#   ~/.local/bin/code-server-font-patch.sh
#   然后重启 code-server（或至少刷新浏览器页面）。
#
set -euo pipefail

# ── 路径定义 ──────────────────────────────────────────────────────────────────
CS="${CODE_SERVER_ROOT:-$HOME/.local/share/mise/installs/github-coder-code-server/latest}"
WB="$CS/lib/vscode/out/vs/code/browser/workbench"   # code-server 服务 workbench.css 的目录
FONTDIR="$WB/fonts"                                  # 字体放这里，与 workbench.css 同源
SRC="$HOME/.local/share/fonts"                       # 本机已安装字体的来源
FONT_NAME="Maple Mono NF CN"
CSS_MARKER="CUSTOM WEBFONT: ${FONT_NAME}"            # 幂等标记：已注入就跳过

# workbench 目录不存在 = 这次不是 code-server（或还没装好），直接放过，别让 hook 报错
if [ ! -d "$WB" ]; then
  echo "跳过：未找到 workbench 目录 $WB（code-server 未安装或路径不对）" >&2
  exit 0
fi

# ── 1. 转 woff2 ───────────────────────────────────────────────────────────────
# 用 uvx 临时拉起 fonttools + brotli 做压缩，无需全局安装。
# 仅在源字体比产物新时才重转，重复跑很快。
mkdir -p "$FONTDIR"
for w in Regular Bold; do
  ttf="$SRC/MapleMono-NF-CN-$w.ttf"
  out="$FONTDIR/MapleMono-NF-CN-$w.woff2"
  [ -f "$ttf" ] || { echo "缺少字体: $ttf" >&2; exit 1; }
  if [ ! -f "$out" ] || [ "$ttf" -nt "$out" ]; then
    echo "转换 $w ..."
    uvx --with brotli fonttools ttLib.woff2 compress -o "$out" "$ttf" >/dev/null
  fi
done

# ── 2. 注入 @font-face ────────────────────────────────────────────────────────
# font-display: block —— 终端对字体度量敏感，宁可短暂等待也别先渲染成回退字体。
# 若已注入（标记存在），跳过，保证幂等。
if ! grep -q "$CSS_MARKER" "$WB/workbench.css"; then
  cat >> "$WB/workbench.css" <<CSS

/* ::${CSS_MARKER}:: */
@font-face {
  font-family: '${FONT_NAME}';
  src: url('./fonts/MapleMono-NF-CN-Regular.woff2') format('woff2');
  font-weight: 400;
  font-style: normal;
  font-display: block;
}
@font-face {
  font-family: '${FONT_NAME}';
  src: url('./fonts/MapleMono-NF-CN-Bold.woff2') format('woff2');
  font-weight: 700;
  font-style: normal;
  font-display: block;
}
CSS
  echo "已注入 @font-face"
else
  echo "@font-face 已存在，跳过"
fi

echo "完成。重启 code-server 并刷新浏览器即可。"
