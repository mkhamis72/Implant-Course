#!/usr/bin/env bash
# Verify a feature branch against dev, then ship it to production through the release workflow.
#
#   ./scripts/ship.sh verify [e2e specs…]   typecheck, lint, unit, DB tests (applies pending migrations to DEV), chosen E2E specs
#   ./scripts/ship.sh ship                  push, open a PR, merge it into master, watch release.yml (migrates PROD, then deploys)
#
# Run from web/ in Git Bash, with everything committed. Production only ever changes through the merge.
set -euo pipefail

GH="${GH:-/c/Program Files/GitHub CLI/gh.exe}"
command -v "$GH" >/dev/null 2>&1 || GH=gh
cd "$(dirname "$0")/.."

branch=$(git rev-parse --abbrev-ref HEAD)
if [ "$branch" = master ]; then echo "On master: create a feature branch first." >&2; exit 1; fi
if [ -n "$(git status --porcelain)" ]; then echo "Uncommitted changes: commit or stash them first." >&2; exit 1; fi

case "${1:-}" in
  verify)
    shift
    npx tsc --noEmit
    npm run lint
    npm test
    npm run test:db
    if [ $# -gt 0 ]; then npx playwright test "$@"; else echo "No E2E specs given: skipped (the full run is too long for one go)."; fi
    echo "Verified $branch."
    ;;
  ship)
    previous=$("$GH" run list --workflow release.yml --limit 1 --json databaseId --jq '.[0].databaseId // empty')
    git push -u origin HEAD
    "$GH" pr view --json number >/dev/null 2>&1 || "$GH" pr create --fill --base master
    "$GH" pr merge --merge
    echo "Waiting for the release run to start…"
    run=
    for _ in $(seq 1 30); do
      run=$("$GH" run list --workflow release.yml --limit 1 --json databaseId --jq '.[0].databaseId // empty')
      [ -n "$run" ] && [ "$run" != "$previous" ] && break
      run=
      sleep 5
    done
    if [ -z "$run" ]; then echo "No new release run appeared; check GitHub Actions." >&2; exit 1; fi
    "$GH" run watch "$run" --exit-status --interval 20
    "$GH" run view "$run" --log | grep -E 'Applied:|Database is up to date' || true
    echo "Released $branch to production."
    ;;
  *)
    sed -n '2,7p' "$0" | sed 's/^# \{0,1\}//'
    exit 1
    ;;
esac
