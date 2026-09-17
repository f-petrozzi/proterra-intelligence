#!/usr/bin/env bash
set -euo pipefail
umask 077

script_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd -- "$script_directory/../.."
mkdir -p .review

# Manual and scheduled entry points share this lock. The kernel releases it even after a crash.
exec 9>.review/weekly-draft.lock
if ! flock --nonblock 9; then
  printf '%s Weekly drafting is already running; skipped.\n' "$(date --iso-8601=seconds)"
  exit 0
fi

printf '%s Weekly drafting started.\n' "$(date --iso-8601=seconds)"
result=0
node --import tsx scripts/review/weekly-draft.ts "$@" || result=$?
printf '%s Weekly drafting finished (exit %s).\n' "$(date --iso-8601=seconds)" "$result"
exit "$result"
