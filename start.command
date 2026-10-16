#!/bin/bash
cd -- "$(dirname -- "$0")" || exit 1

# Finder may start Terminal without loading the user's Node version manager.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null 2>&1 && [ -s "$HOME/.nvm/nvm.sh" ]; then
  . "$HOME/.nvm/nvm.sh"
fi
if ! command -v node >/dev/null 2>&1; then
  printf '请先安装 Node.js 20+，然后重新双击 start.command。\n'
  read -r -p '按回车关闭…' _reply
  exit 1
fi

node scripts/start.mjs "$@"
result=$?
if [ "$result" -ne 0 ]; then
  read -r -p '启动失败，按回车关闭…' _reply
fi
exit "$result"
