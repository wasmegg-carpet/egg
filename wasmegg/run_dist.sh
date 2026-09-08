#!/usr/bin/env bash
# Serve dist/ the way Netlify serves it in production, applying netlify.toml,
# dist/_redirects and dist/_headers. A plain static server drops the /_home
# rewrite, the proto-explorer SPA fallback and the /api/* auxbrain proxy, so
# most of the site 404s under one.
#
# Caveat: netlify dev forces cache-control: max-age=0, so the immutable asset
# caching netlify-headers-expander writes into dist/_headers is not testable
# here; use `netlify deploy --alias <name>` for that.
set -euo pipefail

here=$(realpath $(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd))
port=${1:-8888}

cd "$here"

# `set -e` already aborts on a failed build, so there is nothing to check afterwards.
if [[ ! -d $here/dist ]]; then
    make fastbuild -j2
fi

# The devcontainer preinstalls netlify-cli; fall back to npx elsewhere.
if command -v netlify >/dev/null; then
    netlify=(netlify)
else
    netlify=(npx --yes netlify-cli@latest)
fi

exec "${netlify[@]}" dev \
    --dir dist \
    --port "$port" \
    --offline \
    --no-open \
    --skip-gitignore
