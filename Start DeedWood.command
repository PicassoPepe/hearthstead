#!/bin/bash
# DeedWood: double-click to start (macOS; on Linux run ./"Start DeedWood.command").
cd "$(dirname "$0")" || exit 1
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  echo
  echo " DeedWood needs Node.js 22 or newer."
  if command -v brew >/dev/null 2>&1; then
    echo " Installing it with Homebrew..."
    brew install node@22 && brew link --overwrite --force node@22 || { echo " Please install the LTS version from https://nodejs.org and try again."; open https://nodejs.org 2>/dev/null; read -r -p " Press Enter to close."; exit 1; }
  else
    echo " Please install the LTS version from https://nodejs.org, then double-click this file again."
    open https://nodejs.org 2>/dev/null
    read -r -p " Press Enter to close."
    exit 1
  fi
fi
echo
echo " Getting DeedWood ready (first time: a few minutes)..."
if command -v corepack >/dev/null 2>&1; then corepack pnpm install --frozen-lockfile; else npx -y pnpm@10.28.0 install --frozen-lockfile; fi || { echo " Installing packages failed. Check your internet connection and try again."; read -r -p " Press Enter to close."; exit 1; }
node scripts/start.mjs
