#!/bin/bash
# Safe restart: this script's own cmdline never matches the server pattern.
cd /sdcard/serene-support-chat || exit 1
LOG="$HOME/.serene/serene.log"
mkdir -p "$HOME/.serene"
P=$(ps -eo pid,args | grep "[n]ode server" | awk '{print $1}')
if [ -n "$P" ]; then echo "stopping:$P"; kill $P 2>/dev/null; sleep 2; fi
setsid nohup node server/index.js > "$LOG" 2>&1 < /dev/null &
sleep 4
curl -s -m 5 http://localhost:8787/api/health; echo
