#!/bin/sh
# 双击运行：起一个只监听本机的配置页，并自动打开浏览器
cd "$(dirname "$0")/.." || exit 1
exec node tools/settings-server.mjs
