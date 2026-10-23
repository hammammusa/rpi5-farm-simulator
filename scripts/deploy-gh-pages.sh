#!/usr/bin/env bash
# Fallback deployment without GitHub Actions: build with the Pages base path and
# push dist/ to the gh-pages branch (Pages source: "Deploy from a branch" → gh-pages).
set -euo pipefail
repo_name="${1:-$(basename -s .git "$(git config --get remote.origin.url)")}"
BASE_PATH="/${repo_name}/" npm run build
touch dist/.nojekyll
tmp="$(mktemp -d)"
cp -r dist/. "$tmp/"
cd "$tmp"
git init -q -b gh-pages
git add -A
git -c user.name="${GIT_AUTHOR_NAME:-deploy}" -c user.email="${GIT_AUTHOR_EMAIL:-deploy@localhost}" commit -qm "Deploy $(date -u +%Y-%m-%dT%H:%M:%SZ)"
git push -f "$(cd - >/dev/null && git config --get remote.origin.url)" gh-pages:gh-pages
echo "pushed gh-pages for /${repo_name}/"
