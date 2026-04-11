#!/usr/bin/env bash
# craft-cli installer - one-shot bootstrap for fresh machines.
#
# what it does:
#   1. verifies bun is installed (prints install hint if missing)
#   2. installs dependencies and builds the compiled binary
#   3. symlinks dist/craft -> ~/.local/bin/craft (creates dir if missing)
#   4. optionally symlinks skill/ -> ~/.claude/skills/craft-cli (only if ~/.claude exists)
#   5. prints next-step instructions for `craft setup` and `craft mode`
#
# safe to re-run: binary symlink uses `ln -sf`, skill symlink uses `ln -sfn`
# (the -n guard prevents ln from following an existing symlink-to-directory
# and creating a circular link inside). existing skill DIRECTORIES (not symlinks)
# are preserved and a warning is printed.
#
# usage: ./install.sh            (install)
#        ./install.sh --skill-only  (just re-link the skill, skip build)

set -euo pipefail

# resolve repo root regardless of cwd
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_ROOT"

GREEN='\033[32m'
YELLOW='\033[33m'
RED='\033[31m'
DIM='\033[2m'
BOLD='\033[1m'
RESET='\033[0m'

info()  { printf "${DIM}%s${RESET}\n" "$*"; }
ok()    { printf "${GREEN}✓${RESET} %s\n" "$*"; }
warn()  { printf "${YELLOW}!${RESET} %s\n" "$*"; }
fail()  { printf "${RED}✗${RESET} %s\n" "$*" >&2; exit 1; }

SKILL_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --skill-only) SKILL_ONLY=1 ;;
    -h|--help)
      sed -n '2,/^$/p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) fail "unknown arg: $arg" ;;
  esac
done

# ---------- bun check ----------
if [[ $SKILL_ONLY -eq 0 ]]; then
  if ! command -v bun >/dev/null 2>&1; then
    fail "bun is not installed. install it first:
    curl -fsSL https://bun.sh/install | bash
  then re-run this script."
  fi
  ok "bun $(bun --version)"
fi

# ---------- build ----------
if [[ $SKILL_ONLY -eq 0 ]]; then
  info "installing dependencies…"
  bun install --silent
  ok "deps installed"

  info "building binary…"
  bun run build >/dev/null
  if [[ ! -x "$REPO_ROOT/dist/craft" ]]; then
    fail "build did not produce dist/craft"
  fi
  ok "built $REPO_ROOT/dist/craft"
fi

# ---------- symlink binary ----------
if [[ $SKILL_ONLY -eq 0 ]]; then
  BIN_DIR="${HOME}/.local/bin"
  mkdir -p "$BIN_DIR"
  ln -sf "$REPO_ROOT/dist/craft" "$BIN_DIR/craft"
  ok "linked binary → $BIN_DIR/craft"

  if ! echo ":$PATH:" | grep -q ":$BIN_DIR:"; then
    warn "$BIN_DIR is not in PATH. add this to your shell rc:"
    printf "    ${BOLD}export PATH=\"\$HOME/.local/bin:\$PATH\"${RESET}\n"
  fi
fi

# ---------- symlink skill (optional) ----------
CLAUDE_DIR="${HOME}/.claude"
SKILL_TARGET="$CLAUDE_DIR/skills/craft-cli"
if [[ -d "$CLAUDE_DIR" ]]; then
  mkdir -p "$CLAUDE_DIR/skills"
  if [[ -L "$SKILL_TARGET" ]]; then
    ln -sfn "$REPO_ROOT/skill" "$SKILL_TARGET"
    ok "refreshed skill symlink → $SKILL_TARGET"
  elif [[ -e "$SKILL_TARGET" ]]; then
    warn "$SKILL_TARGET already exists and is not a symlink"
    warn "to switch to the repo-managed skill, back it up and re-run with --skill-only"
    warn "  mv $SKILL_TARGET $SKILL_TARGET.bak && $REPO_ROOT/install.sh --skill-only"
  else
    ln -sfn "$REPO_ROOT/skill" "$SKILL_TARGET"
    ok "linked skill → $SKILL_TARGET"
  fi
else
  info "no ~/.claude directory found - skipping skill install (not a Claude Code host)"
fi

# ---------- next steps ----------
printf "\n${BOLD}next steps${RESET}\n"
printf "  1. ${BOLD}craft setup --url <URL> --key <KEY>${RESET}\n"
printf "     (get URL+key from Craft: Settings → Developer → API for All Docs)\n"
printf "  2. ${BOLD}craft mode api${RESET}\n"
printf "     on Linux / headless / no Craft desktop app. skip this on Mac with Craft installed.\n"
printf "  3. ${BOLD}craft whoami${RESET}\n"
printf "     verify\n"
printf "\nagent docs: ${BOLD}$REPO_ROOT/skill/SKILL.md${RESET}\n"
printf "humans:     ${BOLD}$REPO_ROOT/README.md${RESET}\n"
