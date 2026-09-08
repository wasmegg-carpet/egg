#!/usr/bin/env bash
# SessionStart hook. Fresh worktrees have no node_modules and no generated
# protobuf bindings, so anything an agent tries first — type-check, dev server,
# a grep through lib/proto — fails in a way that looks like a code problem.
# Both steps are no-ops once satisfied, so this stays cheap on later sessions.
set -euo pipefail

root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}"
cd "$root/lib"

did_work=0

if [[ ! -d "$root/node_modules" ]]; then
    # `pnpm install` from lib/ installs the whole workspace, not just lib.
    make init >&2
    did_work=1
fi

# `make -q` reports whether protobuf/*.proto is newer than the generated
# output, which is what makes this safe to run on every session start.
if ! make --question all >/dev/null 2>&1; then
    make all >&2
    did_work=1
fi

if [[ $did_work -eq 1 ]]; then
    echo "Workspace initialized: pnpm workspace installed, lib/ protobuf bindings generated."
fi
