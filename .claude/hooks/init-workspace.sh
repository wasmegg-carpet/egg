#!/usr/bin/env bash
# SessionStart hook: install missing dependencies and rebuild stale protobuf bindings.
set -euo pipefail

root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}"
cd "$root/lib"

did_work=0

if [[ ! -d "$root/node_modules" ]]; then
    # `pnpm install` from lib/ installs the whole workspace, not just lib.
    make init >&2
    did_work=1
fi

# Rebuild only when protobuf bindings are stale.
if ! make --question all >/dev/null 2>&1; then
    make all >&2
    did_work=1
fi

if [[ $did_work -eq 1 ]]; then
    echo "Workspace initialized: pnpm workspace installed, lib/ protobuf bindings generated."
fi
