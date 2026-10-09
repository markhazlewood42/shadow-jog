#!/bin/bash
# Regenerate every piece of quality evidence the reviewers read (docs/quality/evidence/ and
# docs/screenshots/). About 25 minutes. Run from the project root:
#   bash scripts/evidence.sh
# Don't edit src/ while it runs: Vite hot-reloads and the Playwright runs die.
# A one-line-per-step summary goes to evidence.log in the project root (gitignored) and is
# printed at the end: every line should read exit=0.
cd "$(dirname "$0")/.." || exit 1
EV=docs/quality/evidence
LOG=evidence.log
: > $LOG
npx vitest run --silent=false > $EV/unit-tests.txt 2>&1; echo "unit exit=$?" >> $LOG
npx tsc --noEmit -p . > $EV/typecheck.txt 2>&1; echo "tsc exit=$?" >> $EV/typecheck.txt; tail -1 $EV/typecheck.txt >> $LOG
npm run build > /dev/null 2>&1 && { echo "Bundle budget, from \`npm run build && node scripts/bundle-budget.mjs\` (the same gate CI runs on every push)."; echo; node scripts/bundle-budget.mjs; echo "exit=$?"; } > $EV/bundle.txt 2>&1
tail -1 $EV/bundle.txt | sed 's/^/bundle /' >> $LOG
npx biome lint > $EV/lint.txt 2>&1; echo "biome exit=$?" >> $EV/lint.txt; tail -1 $EV/lint.txt >> $LOG
npx playwright test e2e/economy.spec.ts e2e/gameover.spec.ts e2e/playthrough.spec.ts e2e/prod.spec.ts e2e/playtest.spec.ts e2e/chaos.spec.ts --reporter=line > $EV/e2e-playthrough.txt 2>&1; echo "e2e exit=$?" >> $LOG
tail -3 $EV/e2e-playthrough.txt >> $LOG
{ echo "perf evidence: $(date +%F), commit $(git rev-parse --short HEAD), game size 640x360"; npx playwright test e2e/perf.spec.ts --reporter=line; echo "gpu exit=$?"; echo '--- software canvas (PW_NOGPU=1, as CI) ---'; PW_NOGPU=1 npx playwright test e2e/perf.spec.ts --reporter=line; echo "software exit=$?"; } > $EV/perf.txt 2>&1
grep -E "exit=" $EV/perf.txt >> $LOG
npx playwright test e2e/shots.spec.ts --reporter=line > shots.log 2>&1; echo "shots exit=$?" >> $LOG
tail -2 shots.log >> $LOG; rm -f shots.log
npx playwright test e2e/audio-evidence.spec.ts --reporter=line > audio.log 2>&1; echo "audio exit=$?" >> $LOG
rm -f audio.log
echo DONE >> $LOG
cat $LOG
# ci-engines.txt comes from CI, not from here: after a green run on GitHub,
#   gh run view <run-id> --log | (filter lines with ✓ ✘ passed failed) > docs/quality/evidence/ci-engines.txt
# (see docs/quality/GRADING.md, "Running a verification round").
