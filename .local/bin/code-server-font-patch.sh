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
#   1. 决定目标目录：本次安装的精确目录 / latest 软链 / $CODE_SERVER_ROOT（见步骤 1）
#   2. 把本机 fonts 下的 Maple Mono NF CN（Regular/Bold）转成 woff2（20MB → ~6MB，
#      省流量）
#   3. 复制到 code-server 的 workbench 目录下 ./fonts/
#   4. 往 workbench.css 追加 @font-face 规则（同源相对路径 ./fonts/...）
#
# ── 什么时候跑 ───────────────────────────────────────────────────────────────
#   安装 / 升级 code-server 之后。因为改的是 mise 装的 code-server 文件，
#   `mise upgrade` 会覆盖掉，需要重跑。config.toml 里给 code-server 配了 tool-level
#   postinstall（只在这个工具真正安装/升级时触发，别的工具安装不会叫它），
#   也可以手动跑本脚本。
#
# ── 环境变量 ─────────────────────────────────────────────────────────────────
#   CODE_SERVER_ROOT        显式指定 code-server 安装根目录。优先级最高（步骤 1）。
#   MISE_TOOL_INSTALL_PATH  mise tool-level postinstall 注入的“本次安装的精确目录”。
#
# ── 用法 ─────────────────────────────────────────────────────────────────────
#   ~/.local/bin/code-server-font-patch.sh
#   然后重启 code-server（或至少刷新浏览器页面）。
#
set -euo pipefail

# ── 常量 ──────────────────────────────────────────────────────────────────────
BACKEND_DIR="github-coder-code-server"          # installs/ 下的目录名（mise 把 backend id 里的 ':' 和 '/' 换成 '-'）
SRC="$HOME/.local/share/fonts"                   # 本机已安装字体的来源
FONT_NAME="Maple Mono NF CN"
CSS_MARKER="CUSTOM WEBFONT: ${FONT_NAME}"        # 幂等标记：已注入就跳过

# ── 1. 决定目标目录（CS = code-server 安装根目录）─────────────────────────────
# 优先级从高到低：
#   1) CODE_SERVER_ROOT          显式指定（手动跑时用）
#   2) MISE_TOOL_INSTALL_PATH    mise tool-level postinstall 注入的本次安装精确目录
#   3) installs/<backend>/latest 浮动软链（手动跑、且上面两个都没给时的兜底）
#
# 为什么 hook 场景必须走第 2 条、不能直接用 latest：postinstall 是在工具文件落地之后、
# mise 重建 floating runtime symlink（latest 及各版本前缀，由
# runtime_symlinks::generated_names_for 生成）之前跑的。此刻 latest 要么还不存在
# （首次安装），要么还指着上一个版本（升级）——照着它打补丁会静默空转或打到旧版本。
# MISE_TOOL_INSTALL_PATH 就是 mise 为这个坑准备的精确目录。
CS="${CODE_SERVER_ROOT:-${MISE_TOOL_INSTALL_PATH:-}}"
[ -n "$CS" ] || CS="$HOME/.local/share/mise/installs/$BACKEND_DIR/latest"
echo "目标目录：$CS" >&2

WB="$CS/lib/vscode/out/vs/code/browser/workbench"   # code-server 服务 workbench.css 的目录
FONTDIR="$WB/fonts"                                  # 字体放这里，与 workbench.css 同源

# workbench 目录不存在 = 这不是 code-server 安装（或路径不对），直接放过，别让 hook 报错
if [ ! -d "$WB" ]; then
  echo "跳过：$CS 下未找到 workbench 目录（code-server 未安装或目标目录不对）" >&2
  exit 0
fi

# ── 2. 转 woff2 ───────────────────────────────────────────────────────────────
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

# ── 3. 注入 @font-face ────────────────────────────────────────────────────────
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
