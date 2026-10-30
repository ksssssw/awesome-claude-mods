#!/usr/bin/env bash
# Checks every mod the way CI does: the marketplace and each mod validate, the tests pass,
# versions agree, and nothing that must stay private is in the tree.
#
#   scripts/check.sh            the working tree
#   scripts/check.sh --history  also every commit's diff and message (run before pushing)
#   SKIP_TESTS=1 scripts/check.sh   validate only, where `claude plugin test` cannot run
#
# Strings that must never be published can be listed one regex per line in
# ~/.config/awesome-claude-mods/forbidden.txt (or $FORBIDDEN_FILE); that file stays outside the repo.
set -euo pipefail

cd "$(dirname "$0")/.."
failed=0
fail() { echo "FAIL: $*"; failed=1; }

echo "== marketplace"
claude plugin validate . || fail "marketplace does not validate"

# The template must stay a working mod too, so a copy of it starts green
for mod in mods/*/ template/; do
  mod=${mod%/}
  name=$(basename "$mod")
  echo "== $name"
  claude plugin validate "$mod" --profile directory || fail "$name does not validate"
  if [ "${SKIP_TESTS:-0}" != 1 ]; then
    claude plugin test "$mod" || fail "$name tests fail"
  fi
  [ "$mod" = template ] && continue
  own=$(node -p "require('./$mod/.claude-plugin/plugin.json').version")
  listed=$(node -p "(require('./.claude-plugin/marketplace.json').plugins.find(p => p.name === '$name') || {}).version")
  [ "$own" = "$listed" ] || fail "$name: plugin.json says $own, marketplace.json says $listed"
done

echo "== private strings"
patterns='/Users/|/home/[a-z]|[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.(com|net|org|io|co\.kr)'
forbidden=${FORBIDDEN_FILE:-$HOME/.config/awesome-claude-mods/forbidden.txt}
if [ -f "$forbidden" ]; then
  extra=$(grep -v '^\s*\(#\|$\)' "$forbidden" | paste -sd '|' -)
  [ -n "$extra" ] && patterns="$patterns|$extra"
fi
# The noreply address and the license's own wording are expected
allow='users\.noreply\.github\.com|noreply@anthropic\.com'
if git grep --untracked -n -I -i -E "$patterns" -- . ':!scripts/check.sh' | grep -v -i -E "$allow"; then
  fail "private strings in the tree (above)"
fi
if [ "${1:-}" = "--history" ]; then
  if git log -p --format='%H %an <%ae> %cn <%ce>%n%B' | grep -i -E "$patterns" | grep -v -i -E "$allow"; then
    fail "private strings in the history (above)"
  fi
fi

[ "$failed" = 0 ] && echo "All checks passed." || exit 1
