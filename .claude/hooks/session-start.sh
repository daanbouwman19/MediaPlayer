#!/bin/bash
# SessionStart hook: make sure the session runs on the Node major this project
# targets (see .nvmrc / package.json "engines") and that dependencies exist.
#
# Remote Claude Code containers ship an older Node on PATH (e.g. /opt/node22),
# which does not satisfy engines ">=24.0.0", so provision Node 24 here and
# prepend it to PATH for the rest of the session via $CLAUDE_ENV_FILE.
set -euo pipefail

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
REQUIRED_MAJOR="$(tr -dc '0-9' <"$PROJECT_DIR/.nvmrc" 2>/dev/null || true)"
REQUIRED_MAJOR="${REQUIRED_MAJOR:-24}"

log() { echo "[session-start] $*"; }

node_major() {
  local version
  version="$(node -v 2>/dev/null)" || return 1
  version="${version#v}"
  echo "${version%%.*}"
}

# nvm is preinstalled in the remote containers (NVM_DIR defaults to /opt/nvm).
install_via_nvm() {
  local nvm_dir="${NVM_DIR:-/opt/nvm}"
  [ -s "$nvm_dir/nvm.sh" ] || return 1
  export NVM_DIR="$nvm_dir"
  # shellcheck disable=SC1091
  . "$nvm_dir/nvm.sh" >/dev/null 2>&1 || return 1
  nvm install "$REQUIRED_MAJOR" >/dev/null 2>&1 || return 1
  nvm alias default "$REQUIRED_MAJOR" >/dev/null 2>&1 || true
  local node_path
  node_path="$(nvm which "$REQUIRED_MAJOR" 2>/dev/null)" || return 1
  dirname "$node_path"
}

# Fallback for containers without nvm: unpack the official Linux tarball.
install_via_tarball() {
  local dest="$HOME/.local/share/node$REQUIRED_MAJOR"
  if [ -x "$dest/bin/node" ]; then
    echo "$dest/bin"
    return 0
  fi
  [ "$(uname -s)" = "Linux" ] || return 1
  local arch
  case "$(uname -m)" in
    x86_64) arch="x64" ;;
    aarch64 | arm64) arch="arm64" ;;
    *) return 1 ;;
  esac
  local base="https://nodejs.org/dist/latest-v$REQUIRED_MAJOR.x"
  local tarball
  tarball="$(curl -fsSL "$base/" |
    grep -o "node-v$REQUIRED_MAJOR\.[0-9.]*-linux-$arch\.tar\.xz" |
    head -n 1)" || return 1
  [ -n "$tarball" ] || return 1
  mkdir -p "$dest"
  curl -fsSL "$base/$tarball" | tar -xJ -C "$dest" --strip-components=1 || return 1
  echo "$dest/bin"
}

current_major="$(node_major || echo 0)"
if [ "$current_major" -ge "$REQUIRED_MAJOR" ]; then
  log "Node $(node -v) already satisfies >=$REQUIRED_MAJOR"
else
  log "Node $(node -v 2>/dev/null || echo 'not found') is too old, provisioning Node $REQUIRED_MAJOR"
  node_bin="$(install_via_nvm || install_via_tarball || true)"
  if [ -n "${node_bin:-}" ] && [ -x "$node_bin/node" ]; then
    export PATH="$node_bin:$PATH"
    hash -r 2>/dev/null || true
    if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
      echo "export PATH=\"$node_bin:\$PATH\"" >>"$CLAUDE_ENV_FILE"
    fi
    log "Now using Node $(node -v) (npm $(npm -v)) from $node_bin"
  else
    log "WARNING: could not provision Node $REQUIRED_MAJOR, continuing with $(node -v 2>/dev/null || echo 'no node')"
  fi
fi

# Install dependencies so tests, linters and typechecks can run. npm install
# (not ci) keeps the container's cached node_modules useful across sessions.
cd "$PROJECT_DIR"
log "Installing dependencies with npm $(npm -v)"
npm install --no-audit --no-fund

# electron has no postinstall script: node_modules/electron/index.js downloads
# the ~220MB binary lazily on the first require(). On a cold container that
# happens inside a test and blows past vitest's 10s timeout, so pay for it here.
if [ -f node_modules/electron/index.js ]; then
  log "Ensuring the Electron binary is downloaded"
  node -e "require('electron')" >/dev/null 2>&1 ||
    log "WARNING: could not prefetch the Electron binary"
fi

log "Dependencies ready"
