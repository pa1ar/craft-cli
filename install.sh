#!/usr/bin/env bash
# craft-cli installer - one-shot bootstrap for fresh machines.
#
# what it does:
#   1. verifies bun is installed (prints install hint if missing)
#   2. installs dependencies and builds the compiled binary
#   3. symlinks dist/craft -> ~/.local/bin/craft (creates dir if missing)
#   4. optionally links the bundled skill into an explicitly selected skills directory
#   5. prints next-step instructions for connection, read source, and skill registration
#
# safe to re-run: binary symlink uses `ln -sf`, skill symlink uses `ln -sfn`
# (the -n guard prevents ln from following an existing symlink-to-directory
# and creating a circular link inside). existing skill DIRECTORIES (not symlinks)
# are preserved and a warning is printed.
#
# usage: ./install.sh                           (install binary)
#        ./install.sh --skill-dir PATH          (also link PATH/craft-cli)
#        ./install.sh --skill-only --skill-dir PATH  (link skill, skip build)
# Install a checkout of a public release tag for normal use; main is development.

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
SKILL_DIR=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --skill-only) SKILL_ONLY=1; shift ;;
    --skill-dir)
      [[ $# -ge 2 && -n "$2" && "$2" != --* ]] || fail "--skill-dir requires a directory path"
      SKILL_DIR="$2"
      shift 2
      ;;
    -h|--help)
      sed -n '2,/^$/p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) fail "unknown arg: $1" ;;
  esac
done
if [[ $SKILL_ONLY -eq 1 && -z "$SKILL_DIR" ]]; then
  fail "--skill-only requires --skill-dir PATH; choose the canonical or harness skills directory"
fi

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
  if ! "$REPO_ROOT/dist/craft" --help >/dev/null; then
    fail "built binary could not be executed"
  fi
  ok "built and verified $REPO_ROOT/dist/craft"
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

# ---------- skill symlink (explicit destination only) ----------
if [[ -n "$SKILL_DIR" ]]; then
  mkdir -p "$SKILL_DIR"
  SKILL_DIR="$(cd "$SKILL_DIR" && pwd)"
  SKILL_TARGET="$SKILL_DIR/craft-cli"
  if [[ -L "$SKILL_TARGET" ]]; then
    ln -sfn "$REPO_ROOT/skill" "$SKILL_TARGET"
    ok "refreshed skill symlink → $SKILL_TARGET"
  elif [[ -e "$SKILL_TARGET" ]]; then
    warn "$SKILL_TARGET already exists and is not a symlink"
    warn "to switch to the bundled skill, back it up before re-linking"
    warn "preserve it, review release compatibility, then re-run with --skill-only --skill-dir \"$SKILL_DIR\""
  else
    ln -sfn "$REPO_ROOT/skill" "$SKILL_TARGET"
    ok "linked skill → $SKILL_TARGET"
  fi
else
  info "skill not linked; use --skill-dir PATH after choosing the canonical or harness skills directory"
fi

# ---------- next steps ----------
printf "\n${BOLD}next steps${RESET}\n"
printf "  1. ${BOLD}craft setup --url <URL> --key <KEY>${RESET}\n"
printf "     only if no working connection exists; get URL+key from Craft → Connections\n"
printf "  2. ${BOLD}craft source auto${RESET}\n"
printf "     on macOS with Craft Desktop; use source api on Linux / headless hosts\n"
printf "  3. ${BOLD}command -v craft && craft doctor --json${RESET}\n"
printf "     verify PATH, connection, source and local availability\n"
printf "\nagent docs: ${BOLD}$REPO_ROOT/skill/SKILL.md${RESET}\n"
printf "register:   ${BOLD}use the user's canonical skill location, or this harness's user-skill directory${RESET}\n"
printf "humans:     ${BOLD}$REPO_ROOT/README.md${RESET}\n"
