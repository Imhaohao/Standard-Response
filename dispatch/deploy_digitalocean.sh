#!/bin/sh
# Creates (or updates) the solver app on DigitalOcean App Platform with SOLVER_TOKEN as an encrypted secret.
# Needs doctl, authenticated with `doctl auth init`. The token never reaches git or the terminal.
set -eu
cd "$(dirname "$0")"
[ -s .solver-token ] || { umask 077; openssl rand -hex 32 > .solver-token; }
spec=$(mktemp)
trap 'rm -f "$spec"' EXIT
cat do-app.yaml > "$spec"
printf '    envs:\n      - key: SOLVER_TOKEN\n        scope: RUN_TIME\n        type: SECRET\n        value: "%s"\n' "$(cat .solver-token)" >> "$spec"
app_id=$(doctl apps list --format ID,Spec.Name --no-header | awk '$2=="rollcall-solver"{print $1}')
if [ -n "$app_id" ]; then
  doctl apps update "$app_id" --spec "$spec" --wait --format ID,DefaultIngress
else
  doctl apps create --spec "$spec" --wait --format ID,DefaultIngress
fi
