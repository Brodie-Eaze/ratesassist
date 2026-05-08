#!/usr/bin/env bash
# RatesAssist ship-readiness gate.
# Runs every gate fail-fast. Print a coloured summary at the end.

set -e
set -o pipefail

# ANSI colours (only when stdout is a tty)
if [ -t 1 ]; then
  RED=$'\033[0;31m'
  GREEN=$'\033[0;32m'
  YELLOW=$'\033[0;33m'
  BLUE=$'\033[0;34m'
  BOLD=$'\033[1m'
  RESET=$'\033[0m'
else
  RED=""; GREEN=""; YELLOW=""; BLUE=""; BOLD=""; RESET=""
fi

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

CHECKS=()
RESULTS=()

record_pass() {
  CHECKS+=("$1")
  RESULTS+=("pass")
}

record_warn() {
  CHECKS+=("$1")
  RESULTS+=("warn:$2")
}

fail() {
  local name="$1"; shift
  local msg="$*"
  CHECKS+=("$name")
  RESULTS+=("fail")
  echo
  echo "${RED}${BOLD}========================================${RESET}"
  echo "${RED}${BOLD}  SHIP-CHECK FAILED: ${name}${RESET}"
  echo "${RED}${BOLD}========================================${RESET}"
  if [ -n "$msg" ]; then
    echo "${RED}${msg}${RESET}"
  fi
  print_summary
  exit 1
}

step() {
  echo
  echo "${BLUE}${BOLD}==> ${1}${RESET}"
}

print_summary() {
  echo
  echo "${BOLD}Ship-check summary${RESET}"
  echo "------------------"
  local i=0
  while [ $i -lt ${#CHECKS[@]} ]; do
    local name="${CHECKS[$i]}"
    local result="${RESULTS[$i]}"
    case "$result" in
      pass)
        echo "  ${GREEN}PASS${RESET}  $name"
        ;;
      warn:*)
        echo "  ${YELLOW}WARN${RESET}  $name  (${result#warn:})"
        ;;
      fail)
        echo "  ${RED}FAIL${RESET}  $name"
        ;;
    esac
    i=$((i + 1))
  done
}

# --- 1. Typecheck every workspace -------------------------------------------
step "1/7  Typecheck (all workspaces)"
if ! npm run typecheck --workspaces --if-present; then
  fail "typecheck" "One or more workspaces failed to typecheck."
fi
record_pass "typecheck (all workspaces)"

# --- 2. Run tests ------------------------------------------------------------
step "2/7  Tests"
if ! npm test; then
  fail "tests" "One or more tests failed."
fi
record_pass "tests"

# --- 3. Build adapter-demo MCP server ---------------------------------------
step "3/7  Build @ratesassist/adapter-demo (MCP server)"
if ! npm run build --workspace=@ratesassist/adapter-demo; then
  fail "build adapter-demo" "MCP server bundle failed to build."
fi
record_pass "build @ratesassist/adapter-demo"

# --- 4. Next.js production build --------------------------------------------
step "4/7  Build apps/web (Next.js production)"
if ! npm run build --workspace=apps/web; then
  fail "build apps/web" "Next.js production build failed (TS/lint blocking errors)."
fi
record_pass "build apps/web"

# --- 5. Production-deps audit -----------------------------------------------
step "5/7  npm audit (production deps only)"
AUDIT_OUTPUT="$(npm audit --omit=dev --json 2>/dev/null || true)"

extract_count() {
  # $1 = severity key
  printf '%s' "$AUDIT_OUTPUT" | node -e "
    let data = '';
    process.stdin.on('data', c => data += c);
    process.stdin.on('end', () => {
      try {
        const j = JSON.parse(data);
        const v = (j && j.metadata && j.metadata.vulnerabilities) || {};
        process.stdout.write(String(v['$1'] || 0));
      } catch (e) { process.stdout.write('0'); }
    });
  "
}

CRITICAL="$(extract_count critical)"
HIGH="$(extract_count high)"
MODERATE="$(extract_count moderate)"
LOW="$(extract_count low)"

echo "  critical=$CRITICAL  high=$HIGH  moderate=$MODERATE  low=$LOW"

# Pre-pilot allow-list: Next.js 14.2.35 DoS CVEs are documented in
# internal/SECURITY-FOLLOWUPS.md (SEC-005) and tracked for Phase 6 upgrade.
# These are tolerated until the system is publicly reachable.
ALLOWED_HIGH=1
ALLOWED_CRITICAL=0

if [ "${CRITICAL:-0}" -gt "$ALLOWED_CRITICAL" ] || [ "${HIGH:-0}" -gt "$ALLOWED_HIGH" ]; then
  echo "${RED}High/critical vulnerabilities exceed allow-list:${RESET}"
  npm audit --omit=dev || true
  fail "npm audit" "High/critical vulnerabilities exceed pre-pilot allow-list (high=$HIGH/$ALLOWED_HIGH critical=$CRITICAL/$ALLOWED_CRITICAL)."
fi

if [ "${HIGH:-0}" -gt 0 ] || [ "${MODERATE:-0}" -gt 0 ]; then
  echo "${YELLOW}Vulnerabilities present (within allow-list, non-blocking):${RESET}"
  npm audit --omit=dev || true
  record_warn "npm audit (prod)" "high=$HIGH moderate=$MODERATE (deferred → Phase 6)"
else
  record_pass "npm audit (prod)"
fi

# --- 6. MCP wiring guardrails (apps/web/lib/tools.ts) -----------------------
step "6/7  MCP client wiring guardrails"
TOOLS_FILE="apps/web/lib/tools.ts"

if [ ! -f "$TOOLS_FILE" ]; then
  fail "mcp wiring" "$TOOLS_FILE does not exist."
fi

check_forbidden() {
  local pattern="$1"
  local label="$2"
  local count
  count="$(grep -E -c "$pattern" "$TOOLS_FILE" || true)"
  if [ "${count:-0}" -gt 0 ]; then
    echo "${RED}Forbidden pattern '${label}' found ${count} time(s) in ${TOOLS_FILE}:${RESET}"
    grep -nE "$pattern" "$TOOLS_FILE" || true
    fail "mcp wiring" "Phase 1B regression: forbidden pattern '$label' present."
  fi
}

check_forbidden 'import.*recovery-engine' 'import.*recovery-engine'
check_forbidden 'import.*spatial'         'import.*spatial'
check_forbidden 'from.*identity'          'from.*identity'

# HANDLERS local map must not exist
if grep -E -nq '(^|[^A-Za-z_])HANDLERS([^A-Za-z_]|$)' "$TOOLS_FILE"; then
  echo "${RED}Forbidden 'HANDLERS' map found in ${TOOLS_FILE}:${RESET}"
  grep -nE '(^|[^A-Za-z_])HANDLERS([^A-Za-z_]|$)' "$TOOLS_FILE" || true
  fail "mcp wiring" "Phase 1B regression: 'HANDLERS' local map present in apps/web/lib/tools.ts."
fi

record_pass "mcp wiring guardrails"

# --- 7. Done -----------------------------------------------------------------
step "7/7  All gates passed"

echo
echo "${GREEN}${BOLD}========================================${RESET}"
echo "${GREEN}${BOLD}  SHIP-CHECK PASSED — ready to ship${RESET}"
echo "${GREEN}${BOLD}========================================${RESET}"
print_summary
exit 0
