#!/usr/bin/env bash
# collect-metrics.sh — SSH to each registered project's server, collect
# system + container metrics, and append a JSON line to .metrics.jsonl.
# Designed to run every 5 minutes via launchd.
set -euo pipefail

PROJECTS_DIR="${PROJECTS_DIR:-$HOME/projects}"
MAX_LINES=10000
KEEP_LINES=8640

# Remote script runs on the server via SSH. Single-quoted so nothing expands locally.
REMOTE_SCRIPT='
read _ cu1 cn1 cs1 ci1 cw1 rest < /proc/stat
ct1=$((cu1+cn1+cs1+ci1+cw1))
sleep 1
read _ cu2 cn2 cs2 ci2 cw2 rest < /proc/stat
ct2=$((cu2+cn2+cs2+ci2+cw2))
d_idle=$((ci2-ci1))
d_total=$((ct2-ct1))
if [ "$d_total" -gt 0 ]; then
  cpu_pct=$(( (d_total - d_idle) * 100 / d_total ))
else
  cpu_pct=0
fi

eval "$(free -m | awk "/^Mem:/ {printf \"mem_total=%d mem_used=%d\", \$2, \$3}")"
if [ "$mem_total" -gt 0 ]; then
  mem_pct=$(( mem_used * 100 / mem_total ))
else
  mem_pct=0
fi

eval "$(df -BG / | awk "NR==2 {gsub(/G/,\"\",\$2); gsub(/G/,\"\",\$3); gsub(/%/,\"\",\$5); printf \"disk_total=%s disk_used=%s disk_pct=%s\", \$2, \$3, \$5}")"

eval "$(awk "!/lo:/ && /:/ {gsub(/:/,\"\",\$1); rx+=\$2; tx+=\$10} END {printf \"net_rx=%d net_tx=%d\", rx+0, tx+0}" /proc/net/dev)"

containers="[]"
if command -v docker >/dev/null 2>&1; then
  raw=$(docker stats --no-stream --format "{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}" 2>/dev/null || true)
  if [ -n "$raw" ]; then
    items=""
    while IFS="$(printf "\t")" read -r cname ccpu cmem; do
      [ -z "$cname" ] && continue
      # strip trailing replica number (-1, -2, etc), then take last segment
      stripped=$(echo "$cname" | sed "s/-[0-9]*$//")
      cname_short="${stripped##*-}"
      ccpu_val=$(echo "$ccpu" | tr -d "% ")
      mem_val=$(echo "$cmem" | awk "{v=\$1; gsub(/[A-Za-z]/,\"\",v); u=\$1; gsub(/[0-9.]/,\"\",u); if(u==\"GiB\") printf \"%.0f\",v*1024; else if(u==\"KiB\") printf \"%.0f\",v/1024; else printf \"%.0f\",v+0}")
      rc=$(docker inspect --format "{{.RestartCount}}" "$cname" 2>/dev/null || echo 0)
      items="${items}{\"name\":\"${cname_short}\",\"cpu\":${ccpu_val},\"memMb\":${mem_val},\"restarts\":${rc}},"
    done <<< "$raw"
    if [ -n "$items" ]; then
      containers="[${items%,}]"
    fi
  fi
fi

nginx_4xx=0; nginx_5xx=0
if [ -f /var/log/nginx/access.log ]; then
  eval "$(tail -n 1000 /var/log/nginx/access.log \
    | awk "{c=substr(\$9,1,1); if(c==\"4\") f++; if(c==\"5\") s++} END {printf \"nginx_4xx=%d nginx_5xx=%d\", f+0, s+0}")"
fi

printf "CPU:%d MEM:%d/%d MEMPCT:%d DISK:%s/%s/%s NET:%d/%d NGINX4XX:%d NGINX5XX:%d CONTAINERS:%s\n" \
  "$cpu_pct" "$mem_used" "$mem_total" "$mem_pct" \
  "$disk_pct" "$disk_used" "$disk_total" \
  "$net_rx" "$net_tx" "$nginx_4xx" "$nginx_5xx" "$containers"
'

_truncate() {
  local f="$1"
  if [[ -f "$f" ]] && [[ $(wc -l < "$f") -gt $MAX_LINES ]]; then
    tail -n "$KEEP_LINES" "$f" > "${f}.tmp" && mv "${f}.tmp" "$f"
  fi
}

collect_one() {
  local name="$1" host="$2" key="$3" metrics_file="$4"
  local ts
  ts=$(date +%s)

  local ssh_out
  if ! ssh_out=$(ssh -i "$key" -o BatchMode=yes -o StrictHostKeyChecking=accept-new \
    -o ConnectTimeout=10 "root@${host}" bash <<< "$REMOTE_SCRIPT" 2>/dev/null); then
    printf '{"t":%d,"project":"%s","error":"unreachable"}\n' "$ts" "$name" >> "$metrics_file"
    echo "  ✗ $name ($host): unreachable"
    return 0
  fi

  if [[ -z "$ssh_out" ]] || ! echo "$ssh_out" | grep -q '^CPU:'; then
    printf '{"t":%d,"project":"%s","error":"bad response"}\n' "$ts" "$name" >> "$metrics_file"
    echo "  ✗ $name ($host): bad response"
    return 0
  fi

  local cpu mem_used mem_total mem_pct disk_pct disk_used disk_total net_rx net_tx nginx_4xx nginx_5xx containers
  cpu=$(echo "$ssh_out" | sed -n 's/^CPU:\([0-9]*\).*/\1/p')
  mem_used=$(echo "$ssh_out" | sed -n 's/.*MEM:\([0-9]*\)\/.*/\1/p')
  mem_total=$(echo "$ssh_out" | sed -n 's/.*MEM:[0-9]*\/\([0-9]*\).*/\1/p')
  mem_pct=$(echo "$ssh_out" | sed -n 's/.*MEMPCT:\([0-9]*\).*/\1/p')
  disk_pct=$(echo "$ssh_out" | sed -n 's/.*DISK:\([0-9]*\)\/.*/\1/p')
  disk_used=$(echo "$ssh_out" | sed -n 's/.*DISK:[0-9]*\/\([0-9]*\)\/.*/\1/p')
  disk_total=$(echo "$ssh_out" | sed -n 's/.*DISK:[0-9]*\/[0-9]*\/\([0-9]*\).*/\1/p')
  net_rx=$(echo "$ssh_out" | sed -n 's/.*NET:\([0-9]*\)\/.*/\1/p')
  net_tx=$(echo "$ssh_out" | sed -n 's/.*NET:[0-9]*\/\([0-9]*\).*/\1/p')
  nginx_4xx=$(echo "$ssh_out" | sed -n 's/.*NGINX4XX:\([0-9]*\).*/\1/p')
  nginx_5xx=$(echo "$ssh_out" | sed -n 's/.*NGINX5XX:\([0-9]*\).*/\1/p')
  containers=$(echo "$ssh_out" | sed -n 's/.*CONTAINERS://p')

  printf '{"t":%d,"cpu":%s,"mem":%s,"memUsedMb":%s,"memTotalMb":%s,"disk":%s,"diskUsedGb":"%s","diskTotalGb":"%s","netRxBytes":%s,"netTxBytes":%s,"nginx4xx":%s,"nginx5xx":%s,"containers":%s}\n' \
    "$ts" "${cpu:-0}" "${mem_pct:-0}" "${mem_used:-0}" "${mem_total:-0}" \
    "${disk_pct:-0}" "${disk_used:-0}" "${disk_total:-0}" \
    "${net_rx:-0}" "${net_tx:-0}" "${nginx_4xx:-0}" "${nginx_5xx:-0}" "${containers:-[]}" >> "$metrics_file"

  echo "  ✓ $name ($host): cpu=${cpu:-0}% mem=${mem_pct:-0}% disk=${disk_pct:-0}%"
}

main() {
  echo "==> collect-metrics $(date -u +%Y-%m-%dT%H:%M:%SZ)"

  local count=0
  for config in "$PROJECTS_DIR"/*/.emit-infra.json; do
    [[ -f "$config" ]] || continue

    local project_dir
    project_dir=$(dirname "$config")
    local name host ssh_key_name

    name=$(python3 -c "import json; d=json.load(open('$config')); print(d.get('name',''))" 2>/dev/null || true)
    host=$(python3 -c "import json; d=json.load(open('$config')); print(d.get('serverIp','') or d.get('domain',''))" 2>/dev/null || true)
    ssh_key_name=$(python3 -c "import json; d=json.load(open('$config')); print(d.get('sshKeyName',''))" 2>/dev/null || true)

    if [[ -z "$name" ]] || [[ -z "$host" ]] || [[ -z "$ssh_key_name" ]]; then
      echo "  - ${name:-unknown}: skipped (missing host or sshKeyName)"
      continue
    fi

    local ssh_key="$HOME/.ssh/$ssh_key_name"
    if [[ ! -f "$ssh_key" ]]; then
      echo "  - $name: skipped (SSH key $ssh_key not found)"
      continue
    fi

    local metrics_file="$project_dir/.metrics.jsonl"
    collect_one "$name" "$host" "$ssh_key" "$metrics_file"
    _truncate "$metrics_file"
    count=$((count + 1))
  done

  echo "==> done ($count projects collected)"
}

main "$@"
