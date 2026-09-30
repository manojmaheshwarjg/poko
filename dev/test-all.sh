#!/usr/bin/env bash
# Every suite that needs no browser and no model call. One command, one verdict.
cd "$(dirname "$0")/.." || exit 1
status=0
run() {
  local name="$1"; shift
  local out; out="$("$@" 2>&1 | grep -v ExperimentalWarning)"
  local fails; fails=$(printf '%s\n' "$out" | grep -c '^FAIL')
  local total; total=$(printf '%s\n' "$out" | grep -cE '^(ok  |FAIL)')
  if [ "$fails" -eq 0 ] && printf '%s' "$out" | grep -q 'all passing'; then
    printf 'pass  %-12s %3s assertions\n' "$name" "$total"
  else
    printf 'FAIL  %-12s %s of %s failing\n' "$name" "$fails" "$total"
    printf '%s\n' "$out" | grep '^FAIL' | sed 's/^/        /'
    status=1
  fi
}
run matcher   node dev/test-target.js
run placement node dev/test-placement.js
run runner    node dev/test-runner.js
run redaction node dev/test-redact.mjs
run ingest    node dev/test-ingest.mts
run screens   node dev/test-screens.mts
run learn     node dev/test-learn.mts
run mine      node dev/test-mine.mts
run stack     node dev/test-stack.mts
run verify    node dev/test-verify.mts
run use       node dev/test-use.mts
run docs      node dev/test-docs.mts
run links     node dev/test-explore-rules.mjs
run explore   node dev/test-explore.mts
run g9        node dev/test-g9.mts
run decisions node dev/test-decisions.mts
run enroll    node dev/test-enroll.mts
run console   node dev/test-console.mts
echo
for f in core/*.js panel/panel.js eval/*.mjs service/scripts/*.mjs; do
  node --check "$f" >/dev/null 2>&1 || { echo "syntax FAIL $f"; status=1; }
done
(cd service && npx tsc --noEmit) >/dev/null 2>&1 && echo "types  clean" || { echo "types  FAIL"; status=1; }
[ $status -eq 0 ] && echo && echo "all green"
exit $status
