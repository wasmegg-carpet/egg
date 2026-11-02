#!/usr/bin/env bash
# Serve dist/ with Netlify redirects, headers and API proxying.
# netlify dev forces max-age=0; test asset caching with netlify deploy --alias <name>.
set -euo pipefail

here=$(realpath $(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd))
port=${1:-8888}

cd "$here"

# dist has stuff committed so need to test for build assets
if [[ ! -s $here/dist/_home/index.html ]]; then
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
