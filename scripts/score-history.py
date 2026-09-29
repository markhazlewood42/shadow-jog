"""
Per-area score history from the scorecard's git history (every commit that touched
docs/quality/scorecard.md), as a markdown table. Run from the project root:
    python scripts/score-history.py
"""
import re
import subprocess
import sys

sys.stdout.reconfigure(encoding='utf-8')
log = subprocess.run(['git', 'log', '--reverse', '--format=%H %s', '--', 'docs/quality/scorecard.md'], capture_output=True, text=True, encoding='utf-8').stdout.splitlines()
by_round = {}
for line in log:
    h, subj = line.split(' ', 1)
    txt = subprocess.run(['git', 'show', f'{h}:docs/quality/scorecard.md'], capture_output=True, text=True, encoding='utf-8').stdout
    for m in re.finditer(r'^\| (\d+) \| ([^|]+) \| ([\d.]+) \| (\d+) \|', txt, re.M):
        area, score, rnd = int(m.group(1)), float(m.group(3)), int(m.group(4))
        by_round.setdefault(rnd, {})[area] = score
names = {1: 'Engine & code', 2: 'Field art', 3: 'Battle presentation', 4: 'UI / UX', 5: 'Combat design', 6: 'Progression & economy', 7: 'Narrative & writing', 8: 'Level design', 9: 'Audio', 10: 'Feel & polish', 11: 'Stability'}
# Carry forward: a table row keeps its last scored round.
rounds = sorted(by_round)
print('rounds seen:', rounds)
table = {a: {} for a in names}
for r in rounds:
    for a, sc in by_round[r].items():
        table[a][r] = sc
hdr = '| Area | ' + ' | '.join(f'R{r}' for r in rounds) + ' |'
print(hdr)
for a, n in names.items():
    print(f'| {n} | ' + ' | '.join(f"{table[a].get(r, '')}" for r in rounds) + ' |')
avgs = []
for r in rounds:
    vals = [table[a][r] for a in names if r in table[a]]
    avgs.append(f'{sum(vals)/len(vals):.2f} ({len(vals)})')
print('| Average | ' + ' | '.join(avgs) + ' |')
