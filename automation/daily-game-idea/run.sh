#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${GAME_IDEA_ENV_FILE:-$HOME/.config/supergames/game-idea.env}"
LOCK_FILE="${GAME_IDEA_LOCK_FILE:-/tmp/supergames-daily-game-idea.lock}"

if [[ ! -r "$ENV_FILE" ]]; then
  echo "无法读取环境配置：$ENV_FILE" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "每日游戏创意任务仍在运行，本次跳过。"
  exit 0
fi

NODE_EXECUTABLE="${NODE_BIN:-$(command -v node || true)}"
if [[ -z "$NODE_EXECUTABLE" ]]; then
  echo "找不到 node；请在 $ENV_FILE 中设置 NODE_BIN 的绝对路径。" >&2
  exit 1
fi

cd "${SUPERGAMES_REPO_DIR:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
exec "$NODE_EXECUTABLE" "$SCRIPT_DIR/run.mjs"
