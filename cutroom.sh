#!/bin/sh
# Start Cutroom on macOS or Linux: ./cutroom.sh  (on a Mac you can double-click Cutroom.command)
#
# First run: if Node.js 20.19+ is missing, a private copy is downloaded into .cutroom-runtime/
# (checksum-verified, no admin rights needed), then the app's packages are installed.
# Every run: starts Cutroom and opens it in your browser. Options are passed on (e.g. --port 4000).
set -eu
cd "$(dirname "$0")"
RUNTIME="$PWD/.cutroom-runtime"
NODE_LINE=22

node_ok() {
  command -v node >/dev/null 2>&1 && node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>20||(a===20&&b>=19)?0:1)' 2>/dev/null
}

if ! node_ok; then
  if [ ! -x "$RUNTIME/node/bin/node" ]; then
    echo "Node.js 20.19+ was not found. Downloading a private copy for Cutroom (about 50 MB, one time)…"
    case "$(uname -s)" in
      Darwin) os=darwin ;;
      Linux) os=linux ;;
      *) echo "Unsupported system: $(uname -s). Install Node.js 22 from https://nodejs.org and run this again." >&2; exit 1 ;;
    esac
    case "$(uname -m)" in
      x86_64 | amd64) arch=x64 ;;
      arm64 | aarch64) arch=arm64 ;;
      *) echo "Unsupported processor: $(uname -m). Install Node.js 22 from https://nodejs.org and run this again." >&2; exit 1 ;;
    esac
    base="https://nodejs.org/dist/latest-v$NODE_LINE.x"
    mkdir -p "$RUNTIME"
    sums=$(curl -fsSL "$base/SHASUMS256.txt")
    file=$(printf '%s\n' "$sums" | awk -v suffix="-$os-$arch.tar.gz" '{ n = length($2) - length(suffix) } n > 0 && substr($2, n + 1) == suffix && $2 ~ /^node-v/ { print $2; exit }')
    want=$(printf '%s\n' "$sums" | awk -v f="$file" '$2 == f { print $1 }')
    [ -n "$file" ] && [ -n "$want" ] || { echo "Could not find a Node.js download for $os-$arch." >&2; exit 1; }
    curl -fL --progress-bar -o "$RUNTIME/$file" "$base/$file"
    got=$( (sha256sum "$RUNTIME/$file" 2>/dev/null || shasum -a 256 "$RUNTIME/$file") | awk '{ print $1 }')
    if [ "$got" != "$want" ]; then
      rm -f "$RUNTIME/$file"
      echo "The Node.js download did not match its checksum; nothing was installed. Please try again." >&2
      exit 1
    fi
    rm -rf "$RUNTIME/node"
    mkdir -p "$RUNTIME/node"
    tar -xzf "$RUNTIME/$file" -C "$RUNTIME/node" --strip-components=1
    rm -f "$RUNTIME/$file"
  fi
  PATH="$RUNTIME/node/bin:$PATH"
  export PATH
fi

# install the packages on the first run, and again whenever an update changed them
stamp="node_modules/.cutroom-installed"
if [ ! -f "$stamp" ] || [ package-lock.json -nt "$stamp" ]; then
  echo "Installing Cutroom's packages (first run: a few minutes)…"
  npm ci --no-audit --no-fund || npm install --no-audit --no-fund
  touch "$stamp"
fi

exec node bin/director.mjs start "$@"
