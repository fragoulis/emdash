#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "$0")/../.." && pwd)
state="$root/templates/.astro/local-install"
project="$state/site"

fingerprint() {
  cd "$root"
  git ls-files -co --exclude-standard -- packages/core packages/admin packages/create-emdash templates/blog infra/local-install pnpm-lock.yaml |
    LC_ALL=C sort | while IFS= read -r file; do
      if [[ -f "$file" ]]; then sha256sum "$file"; fi
    done | sha256sum | cut -d' ' -f1
}

require_env() {
  [[ -f "$root/.env" ]] || { echo 'Provide the local .env first' >&2; exit 1; }
  for key in NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY CLERK_SECRET_KEY CLERK_BOOTSTRAP_USER_ID; do
    grep -Eq "^${key}=.+" "$root/.env" || { echo "Missing $key in .env" >&2; exit 1; }
  done
}

case "${1:-}" in
  setup)
    require_env
    if [[ -e "$project" ]]; then
      [[ -f "$state/fingerprint" && $(fingerprint) == "$(< "$state/fingerprint")" ]] || {
        echo 'Installation inputs changed. Reset and set up again.' >&2; exit 1;
      }
      echo "Reusing $project"
      exit 0
    fi
    cd "$root"
    pnpm --filter create-emdash build
    EMDASH_KEEP_INSTALL=1 pnpm --filter create-emdash exec vitest run tests/multisite-setup.test.ts
    (
      cd "$project"
      node --env-file="$root/.env" --env-file=.env build.mjs
    )
    fingerprint > "$state/fingerprint"
    echo "Installation ready at $project"
    ;;
  start)
    require_env
    [[ -f "$state/fingerprint" && $(fingerprint) == "$(< "$state/fingerprint")" ]] || {
      echo 'Installation inputs changed. Reset and set up again.' >&2; exit 1;
    }
    [[ -f "$state/postgres-container" && -f "$project/.env" ]] || {
      echo 'Run setup first' >&2; exit 1;
    }
    docker inspect -f '{{.State.Running}}' "$(< "$state/postgres-container")" | grep -qx true || {
      echo 'PostgreSQL stopped. Reset and set up again.' >&2; exit 1;
    }
    cd "$project"
    exec node --env-file="$root/.env" --env-file=.env host.mjs
    ;;
  reset)
    if [[ -f "$state/postgres-container" ]]; then
      docker rm -f "$(< "$state/postgres-container")" >/dev/null || true
    fi
    rm -rf -- "$state"
    ;;
  check)
    cd "$root"
    pnpm --filter create-emdash exec vitest run tests/multisite-setup.test.ts
    ;;
  *)
    echo 'Usage: infra/local-install/run.sh {setup|start|check|reset}' >&2
    exit 2
    ;;
esac
