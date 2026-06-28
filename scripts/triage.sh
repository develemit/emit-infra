#!/usr/bin/env bash
# triage.sh <project-name> — structured diagnostic snapshot for Claude Code sessions
set -euo pipefail

R='\033[0;31m'; Y='\033[0;33m'; G='\033[0;32m'; B='\033[1m'; NC='\033[0m'

if [[ $# -lt 1 ]]; then
  printf "Usage: %s <project-name>\n" "$(basename "$0")" >&2; exit 1
fi

PROJECT="$1"
DIR="$HOME/projects/$PROJECT"

if [[ ! -d "$DIR" ]]; then
  printf "${R}error:${NC} project directory not found: %s\n" "$DIR" >&2; exit 1
fi
if [[ ! -f "$DIR/.emit-infra.json" ]]; then
  printf "${R}error:${NC} no .emit-infra.json in %s\n" "$DIR" >&2; exit 1
fi

now=$(date +%s)
HBAR="━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

py() { python3 -c "$1" 2>/dev/null || true; }

age_str() {
  local s="$1"
  if (( s < 120 ));      then printf "%ds ago" "$s"
  elif (( s < 7200 ));   then printf "%dm ago" "$(( s / 60 ))"
  elif (( s < 172800 )); then printf "%dh ago" "$(( s / 3600 ))"
  else                        printf "%dd ago" "$(( s / 86400 ))"
  fi
}

sec() { printf "\n${B}── %s${NC}\n" "$1"; }

# ── Header ──────────────────────────────────────────────────────────────────
printf "${B}━━━ %s triage %s${NC}\n" "$PROJECT" "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
domain=$(py "import json; d=json.load(open('$DIR/.emit-infra.json')); print(d.get('domain','—'))")
repo=$(py "import json; d=json.load(open('$DIR/.emit-infra.json')); g=d.get('github',{}); print(g.get('repo','—') if isinstance(g,dict) else '—')")
printf "  %-9s %s\n" "Domain" "${domain:-—}"
printf "  %-9s %s\n" "Repo" "${repo:-—}"

# ── Current status ───────────────────────────────────────────────────────────
sec "Current status"
for pair in "CI:.ci-status.json" "Deploy:.deploy-status.json"; do
  label="${pair%%:*}"
  file="$DIR/${pair#*:}"
  if [[ -f "$file" ]]; then
    python3 - "$file" "$now" "$label" <<'PYEOF'
import json, sys, datetime
fpath, now, label = sys.argv[1], int(sys.argv[2]), sys.argv[3]
d = json.load(open(fpath))
status = d.get('status', '—')
sha = (d.get('sha') or '—')[:7]
branch = d.get('branch') or '—'
comp = d.get('completedAt') or ''
age = '—'
if comp:
    ts = int(datetime.datetime.fromisoformat(comp.replace('Z','+00:00')).timestamp())
    s = now - ts
    if s < 120: age = f"{s}s ago"
    elif s < 7200: age = f"{s//60}m ago"
    elif s < 172800: age = f"{s//3600}h ago"
    else: age = f"{s//86400}d ago"
print(f"  {label:<9} {status:<12} {sha}  {branch}  ({age})")
PYEOF
  fi
done

# ── Last 5 deploys ──────────────────────────────────────────────────────────
sec "Last 5 deploys"
DFILE="$DIR/.deploy-history.jsonl"
if [[ -f "$DFILE" ]]; then
  python3 - "$DFILE" "$now" <<'PYEOF'
import json, sys, datetime
lines = open(sys.argv[1]).readlines()
now = int(sys.argv[2])
parsed = []
for l in lines:
    try: parsed.append(json.loads(l))
    except: pass
for d in reversed(parsed[-5:]):
    status = d.get('status','?')
    sha = (d.get('sha') or '?')[:7]
    branch = (d.get('branch') or '?')[:20]
    dur = d.get('durationSec', 0)
    msg = (d.get('message') or '')[:40]
    comp = d.get('completedAt','')
    age = '—'
    if comp:
        ts = int(datetime.datetime.fromisoformat(comp.replace('Z','+00:00')).timestamp())
        s = now - ts
        if s < 7200: age = f"{s//60}m ago"
        elif s < 172800: age = f"{s//3600}h ago"
        else: age = f"{s//86400}d ago"
    icon = '✓' if status != 'failure' else '✗'
    dur_s = f"{dur//60}m{dur%60:02d}s" if dur else '—'
    msg_s = f' "{msg}"' if msg else ''
    print(f"  {icon} {sha}  {branch:<22} {dur_s:<8}{msg_s:<43} {age}")
PYEOF
else
  printf "  no deploy history\n"
fi

# ── CI health ───────────────────────────────────────────────────────────────
sec "CI health (last 20 runs)"
CIFILE="$DIR/.ci-history.jsonl"
if [[ -f "$CIFILE" ]]; then
  python3 - "$CIFILE" <<'PYEOF'
import json, sys
lines = open(sys.argv[1]).readlines()[-20:]
parsed = [json.loads(l) for l in lines if l.strip()]
total = len(parsed)
if total == 0:
    print("  no runs"); sys.exit()
passes = sum(1 for d in parsed if d.get('status') != 'failure')
avg = sum(d.get('durationSec',0) for d in parsed) / total
pct = int(passes / total * 100)
avg_s = f"{int(avg)//60}m{int(avg)%60:02d}s"
R = '\033[0;31m'; Y = '\033[0;33m'; NC = '\033[0m'
col = R if pct < 70 else (Y if pct < 90 else '')
print(f"  Pass rate  {passes}/{total} ({col}{pct}%{NC})   Avg  {avg_s}")
PYEOF
else
  printf "  no CI history\n"
fi

# ── Latest metrics ──────────────────────────────────────────────────────────
sec "Latest metrics"
MFILE="$DIR/.metrics.jsonl"
if [[ -f "$MFILE" ]]; then
  python3 - "$MFILE" "$now" <<'PYEOF'
import json, sys
mfile, now = sys.argv[1], int(sys.argv[2])
cutoff = now - 48 * 3600
last = None; points = []
with open(mfile) as f:
    for line in f:
        line = line.strip()
        if not line: continue
        try:
            d = json.loads(line)
            if 'error' in d: continue
            last = d
            if d.get('t', 0) >= cutoff:
                points.append(d)
        except: pass

if not last:
    print("  no metrics"); sys.exit()

def slope(pts, key):
    n = len(pts)
    if n < 5: return 0.0
    sX = sum(p['t'] for p in pts)
    sY = sum(p.get(key,0) for p in pts)
    sXY = sum(p['t']*p.get(key,0) for p in pts)
    sX2 = sum(p['t']**2 for p in pts)
    d = n*sX2 - sX**2
    return 0.0 if d == 0 else (n*sXY - sX*sY) / d * 86400

R = '\033[0;31m'; Y = '\033[0;33m'; NC = '\033[0m'
cpu = last.get('cpu', 0)
mem = last.get('mem', 0)
disk = last.get('disk', 0)
n4 = last.get('nginx4xx', 0)
n5 = last.get('nginx5xx', 0)

mr = slope(points, 'mem')
dr = slope(points, 'disk')
mp = (100-mem)/mr if mr > 0 else None
dp = (100-disk)/dr if dr > 0 else None

mt = f" (+{mr:.1f}%/day → full ~{int(mp)}d)" if mp else ""
dt = f" (+{dr:.1f}%/day → full ~{int(dp)}d)" if dp else ""
mc = R if mem > 85 else (Y if mem > 75 else '')
dc = R if disk > 80 else (Y if disk > 75 else '')
n5c = R if n5 > 0 else ''

print(f"  CPU  {cpu}%   Mem  {mc}{mem}%{NC}{mt}")
print(f"  Disk  {dc}{disk}%{NC}{dt}")
print(f"  Nginx  4xx: {n4}   5xx: {n5c}{n5}{NC}")
PYEOF
else
  printf "  no metrics file\n"
fi

# ── Containers ───────────────────────────────────────────────────────────────
sec "Containers"
if [[ -f "$MFILE" ]]; then
  python3 - "$MFILE" <<'PYEOF'
import json, sys
last = None
with open(sys.argv[1]) as f:
    for line in f:
        line = line.strip()
        if not line: continue
        try:
            d = json.loads(line)
            if 'error' not in d: last = d
        except: pass
if not last:
    print("  no data"); sys.exit()
R = '\033[0;31m'; NC = '\033[0m'
for c in last.get('containers', []):
    name = c.get('name','?')
    cpu = c.get('cpu', 0)
    mem = c.get('memMb', 0)
    r = c.get('restarts', 0)
    rc = R if r > 0 else ''
    flag = f"  {R}← restarts > 0{NC}" if r > 0 else ''
    print(f"  {name:<18} cpu={cpu:.0f}%  mem={mem:.0f}MB  {rc}restarts={r}{NC}{flag}")
PYEOF
fi

# ── Backup ───────────────────────────────────────────────────────────────────
sec "Backup"
BFILE="$DIR/.backup-status.json"
if [[ -f "$BFILE" ]]; then
  python3 - "$BFILE" "$now" <<'PYEOF'
import json, sys, datetime
d = json.load(open(sys.argv[1]))
now = int(sys.argv[2])
last_run = d.get('lastRun','')
status = d.get('status','?')
age = '—'; age_h = 0
if last_run:
    ts = int(datetime.datetime.fromisoformat(last_run.replace('Z','+00:00')).timestamp())
    s = now - ts
    age_h = s / 3600
    if s < 7200: age = f"{s//60}m ago"
    elif s < 172800: age = f"{s//3600}h ago"
    else: age = f"{s//86400}d ago"
R = '\033[0;31m'; Y = '\033[0;33m'; NC = '\033[0m'
col = R if age_h > 49 else (Y if age_h > 25 else '')
print(f"  Last run  {last_run}  ({col}{age}{NC})  status: {status}")
PYEOF
else
  printf "  no backup status\n"
fi

printf "\n${B}%s${NC}\n" "$HBAR"
