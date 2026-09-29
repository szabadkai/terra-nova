#!/bin/sh
# The NAT lab's scenarios, one after the other. Build the page first (npm run build): the lab serves dist/.
#   scripts/nettest/run.sh [minutes] [scenario ...]   scenarios: cone sym-cone sym-sym sym-sym-turn cone-slow
cd "$(dirname "$0")"
MIN=${1:-1}; shift
[ $# -eq 0 ] && set -- cone sym-cone sym-sym sym-sym-turn cone-slow
docker compose build -q || exit 1
docker compose up -d web turn >/dev/null
for S in "$@"; do
  export MINUTES=$MIN CODE=$(head -c 600 /dev/urandom | tr -dc 'A-HJ-NP-Z' | head -c 6) NAT_A=cone NAT_B=cone ICE=stun:172.30.0.20:3478 POLICY= NETEM_A= NETEM_B=
  case $S in
    cone) ;;
    sym-cone) NAT_A=symmetric ;;
    sym-sym) NAT_A=symmetric NAT_B=symmetric ;;
    sym-sym-turn) NAT_A=symmetric NAT_B=symmetric ICE=stun:172.30.0.20:3478,turn:tn:tn@172.30.0.20:3478 ;;
    turn-only) ICE=turn:tn:tn@172.30.0.20:3478 POLICY=relay ;;
    cone-slow) NETEM_A="delay 60ms 15ms loss 1%" NETEM_B="delay 60ms 15ms loss 1%" ;;
    *) echo "unknown scenario $S"; continue ;;
  esac
  rm -f out/host.json out/guest.json
  echo "=== $S: NAT $NAT_A / $NAT_B, ice $ICE ${POLICY:+policy $POLICY} ${NETEM_A:+netem '$NETEM_A'}"
  # (the TURN server afresh each time: its allocations outlive a scenario and would use up its ports)
  docker compose up -d --force-recreate turn routerA routerB clientA clientB 2>&1 | grep -i "error" 
  docker compose wait clientA clientB >/dev/null 2>&1
  docker compose logs --no-log-prefix clientA clientB 2>&1 | grep -E "ice: state|Hosting:|Connected to|path:|in the game|min:|PASS|FAIL|finished first|page error" | sort | uniq
  docker compose rm -sf routerA routerB clientA clientB >/dev/null 2>&1
  node -e '
    const fs = require("fs"); const r = {}; for (const k of ["host", "guest"]) { try { r[k] = JSON.parse(fs.readFileSync(`out/${k}.json`)); } catch {} }
    const h = r.host, p = h?.path?.[0];
    console.log(`--- ${process.argv[1]}: ${h?.ok && r.guest?.ok ? "PASS" : "FAIL"}; connected in ${h?.connectSeconds ?? "-"} s via ${p ? `${p.local} <-> ${p.remote}, rtt ${p.rtt} ms` : "no path"}; delay ${h?.samples?.at(-1)?.host?.delay ?? "-"} turns; ${h?.commands?.length ?? 0} commands; errors: ${[...(h?.errors ?? []), ...(r.guest?.errors ?? [])].join("; ") || "none"}`);
    fs.copyFileSync("out/host.json", `out/${process.argv[1]}-host.json`); if (r.guest) fs.copyFileSync("out/guest.json", `out/${process.argv[1]}-guest.json`);
  ' "$S" 2>/dev/null
done
docker compose down >/dev/null 2>&1
