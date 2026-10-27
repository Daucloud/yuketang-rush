#!/bin/zsh
set -eu
task_root="$(cd "$(dirname "$0")/.." && pwd)"
task_browser="$task_root/.tools/chrome-mac-arm64/Google Chrome for Testing.app"
if [[ ! -d "$task_browser" ]]; then
  print -u2 '找不到项目的 Chrome for Testing；请先安装测试浏览器。不会改用日常 Chrome。'
  exit 1
fi
# Reuse the installed Testing app and its current profile, including the user's login.
# Do not launch another profile or fall back to the user's everyday Chrome.
open -a "$task_browser" "${1:-https://pro.yuketang.cn/}"
