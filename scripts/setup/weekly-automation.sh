#!/usr/bin/env bash

set -uo pipefail

script_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repository_root="$(cd -- "$script_directory/../.." && pwd)"
cd "$repository_root" || exit 1

run_online=false
run_verify=false
initialize_environment=false
node_compatible=false
failures=0
warnings=0

usage() {
  cat <<'USAGE'
Usage: npm run weekly:setup -- [options]

Options:
  --init-env  Create the protected homelab review.env template if it is missing.
  --online    Check GitHub authentication/repository access and Review API health.
  --verify    Run npm ci followed by the complete project verification suite.
  --help      Show this help.

The default command is read-only. It never prints secret values or changes remote state.
USAGE
}

pass() { printf 'PASS  %s\n' "$1"; }
warn() { printf 'WARN  %s\n' "$1"; warnings=$((warnings + 1)); }
fail() { printf 'FAIL  %s\n' "$1"; failures=$((failures + 1)); }

for argument in "$@"; do
  case "$argument" in
    --init-env) initialize_environment=true ;;
    --online) run_online=true ;;
    --verify) run_verify=true ;;
    --help|-h) usage; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$argument" >&2; usage >&2; exit 2 ;;
  esac
done

if command -v getent >/dev/null 2>&1; then
  user_home_directory="$(getent passwd "$(id -u)" | cut -d: -f6)"
else
  user_home_directory="${HOME:-}"
fi
if [ -z "$user_home_directory" ]; then
  fail "Could not determine the current account's home directory."
  user_home_directory="/nonexistent"
fi
review_environment_file="${PROTERRA_REVIEW_ENV_FILE:-$user_home_directory/.config/proterra-intelligence/review.env}"

if $initialize_environment; then
  if [ -e "$review_environment_file" ]; then
    warn "$review_environment_file already exists; it was not overwritten."
  else
    environment_directory="$(dirname -- "$review_environment_file")"
    install -d -m 700 "$environment_directory"
    umask 077
    printf '%s\n' \
      "REVIEW_API_URL=''" \
      "REVIEW_ACCESS_CLIENT_ID=''" \
      "REVIEW_ACCESS_CLIENT_SECRET=''" \
      "REVIEW_SERVICE_KEY=''" > "$review_environment_file"
    chmod 600 "$review_environment_file"
    pass "Created protected template $review_environment_file; fill it using your password manager."
  fi
fi

printf '\nLocal prerequisites\n'

if command -v node >/dev/null 2>&1; then
  node_version="$(node --version 2>/dev/null | sed 's/^v//')"
  node_major="${node_version%%.*}"
  node_remainder="${node_version#*.}"
  node_minor="${node_remainder%%.*}"
  if [[ "$node_major" =~ ^[0-9]+$ && "$node_minor" =~ ^[0-9]+$ ]] \
    && { [ "$node_major" -gt 24 ] || { [ "$node_major" -eq 24 ] && [ "$node_minor" -ge 19 ]; }; }; then
    node_compatible=true
    pass "Node $node_version satisfies the Node 24.19+ requirement."
  else
    fail "Node $node_version is active; install and select Node 24.19.0."
  fi
else
  fail "Node is not installed."
fi

if command -v npm >/dev/null 2>&1; then pass "npm is installed ($(npm --version))."; else fail "npm is not installed."; fi
if command -v git >/dev/null 2>&1; then pass "Git is installed ($(git --version))."; else fail "Git is not installed."; fi
if command -v gh >/dev/null 2>&1; then pass "GitHub CLI is installed ($(gh --version | head -n 1))."; else fail "GitHub CLI (gh) is not installed."; fi
if command -v codex >/dev/null 2>&1; then
  codex_status="$(codex login status 2>&1 || true)"
  if printf '%s' "$codex_status" | grep -qi 'Logged in using ChatGPT'; then
    pass "Codex is authenticated with ChatGPT."
  else
    fail "Codex is not authenticated with ChatGPT; run codex login."
  fi
else
  fail "Codex is not installed."
fi

if [ -n "${OPENAI_API_KEY:-}" ] || [ -n "${CODEX_API_KEY:-}" ]; then
  warn "An API-key environment variable is loaded. The weekly runner strips it, but remove it from this shell to avoid accidental API billing elsewhere."
else
  pass "No OpenAI or Codex API-key override is loaded."
fi

git_author_name="$(git config user.name 2>/dev/null || true)"
git_author_email="$(git config user.email 2>/dev/null || true)"
if [ -n "$git_author_name" ] && [ -n "$git_author_email" ]; then
  pass "Git author name and email are configured."
else
  fail "Git author name and email must both be configured."
fi

printf '\nRepository configuration\n'

if git check-ignore -q docs/weekly-automation-manual-setup.local.md; then
  pass "The local manual setup guide is ignored by Git."
else
  fail "The local manual setup guide is not ignored by Git."
fi

if command -v rg >/dev/null 2>&1; then
  unresolved_placeholders="$(rg -n 'REPLACE_WITH_[A-Z0-9_]+' review-worker/wrangler.jsonc public/_headers 2>/dev/null || true)"
else
  unresolved_placeholders="$(grep -En 'REPLACE_WITH_[A-Z0-9_]+' review-worker/wrangler.jsonc public/_headers 2>/dev/null || true)"
fi
if [ -z "$unresolved_placeholders" ]; then
  pass "Cloudflare deployment configuration contains no unresolved placeholders."
else
  fail "Cloudflare deployment configuration still has unresolved placeholders:"
  printf '%s\n' "$unresolved_placeholders" | sed 's/^/      /'
fi

if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
  warn "The repository has modified or untracked files; review them before the bootstrap commit."
else
  pass "The repository worktree is clean."
fi

printf '\nHomelab secret file\n'

environment_value_present() {
  local requested_key="$1"
  local requested_file="$2"
  awk -v key="$requested_key" '
    $0 ~ "^[[:space:]]*" key "=" {
      value=$0
      sub("^[[:space:]]*" key "=[[:space:]]*", "", value)
      single_quote=sprintf("%c", 39)
      double_quote=sprintf("%c", 34)
      first_character=substr(value, 1, 1)
      last_character=substr(value, length(value), 1)
      if ((first_character == single_quote && last_character == single_quote) \
        || (first_character == double_quote && last_character == double_quote)) {
        value=substr(value, 2, length(value) - 2)
      }
      if (length(value) > 0 && value != "...") found=1
    }
    END { exit(found ? 0 : 1) }
  ' "$requested_file"
}

if [ -f "$review_environment_file" ]; then
  environment_mode="$(stat -c '%a' "$review_environment_file" 2>/dev/null || true)"
  if [ "$environment_mode" = "600" ]; then
    pass "$review_environment_file has mode 600."
  else
    fail "$review_environment_file must have mode 600; current mode is ${environment_mode:-unknown}."
  fi
  for required_key in REVIEW_API_URL REVIEW_ACCESS_CLIENT_ID REVIEW_ACCESS_CLIENT_SECRET REVIEW_SERVICE_KEY; do
    if environment_value_present "$required_key" "$review_environment_file"; then
      pass "$required_key is present in the protected environment file."
    else
      fail "$required_key is missing or blank in the protected environment file."
    fi
  done
else
  fail "$review_environment_file does not exist. Run npm run weekly:setup -- --init-env."
fi

if $run_online; then
  printf '\nOnline read-only checks\n'
  if command -v gh >/dev/null 2>&1; then
    if gh auth status >/dev/null 2>&1; then pass "GitHub CLI authentication is valid."; else fail "GitHub CLI authentication failed."; fi
    if gh repo view f-petrozzi/proterra-intelligence >/dev/null 2>&1; then
      pass "GitHub repository access is valid."
    else
      fail "Could not read f-petrozzi/proterra-intelligence with GitHub CLI."
    fi
  else
    fail "Online GitHub checks require gh."
  fi

  if [ -n "${REVIEW_API_URL:-}" ] && [ -n "${REVIEW_ACCESS_CLIENT_ID:-}" ] \
    && [ -n "${REVIEW_ACCESS_CLIENT_SECRET:-}" ] && command -v curl >/dev/null 2>&1; then
    if curl --fail --silent --show-error --output /dev/null \
      -H "CF-Access-Client-Id: $REVIEW_ACCESS_CLIENT_ID" \
      -H "CF-Access-Client-Secret: $REVIEW_ACCESS_CLIENT_SECRET" \
      "$REVIEW_API_URL/health"; then
      pass "The stable Review API health endpoint accepts the service token."
    else
      fail "The stable Review API health check failed."
    fi
  else
    warn "Review API health was skipped; load review.env and ensure curl is installed."
  fi
fi

if $run_verify; then
  printf '\nProject verification\n'
  if $node_compatible; then
    if npm ci && npm run verify; then pass "Dependencies and the complete verification suite passed."; else fail "npm ci or npm run verify failed."; fi
  else
    fail "Project verification requires Node 24.19+; it was not started."
  fi
fi

printf '\nSummary\n'
printf '%s failure(s), %s warning(s).\n' "$failures" "$warnings"
if [ "$failures" -gt 0 ]; then
  suggested_command="npm run weekly:setup"
  if $run_online || $run_verify; then suggested_command="$suggested_command --"; fi
  if $run_online; then suggested_command="$suggested_command --online"; fi
  if $run_verify; then suggested_command="$suggested_command --verify"; fi
  printf 'Fix the FAIL items, then rerun: %s\n' "$suggested_command"
  exit 1
fi
printf 'Local setup checks passed. Continue with the remaining Cloudflare/GitHub steps in the ignored manual guide.\n'
