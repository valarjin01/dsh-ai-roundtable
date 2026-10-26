#!/bin/sh
# 双击运行：粘贴 token → 自动发布到 GitHub
cd "$(dirname "$0")/.." || exit 1
echo "────────────────────────────────────────"
echo "  发布 dsh-ai-roundtable 到 GitHub"
echo "────────────────────────────────────────"
echo ""
echo "没有 token？打开："
echo "  https://github.com/settings/personal-access-tokens/new"
echo "  权限勾选：Contents (Read/Write) + Administration (Read/Write)"
echo ""
printf "粘贴 token（输入时不会显示）: "
stty -echo 2>/dev/null
read TOKEN
stty echo 2>/dev/null
echo ""
if [ -z "$TOKEN" ]; then
  echo "没有输入 token，已取消。"
else
  GITHUB_TOKEN="$TOKEN" node scripts/publish-github.mjs
fi
echo ""
printf "按回车关闭窗口…"
read _
