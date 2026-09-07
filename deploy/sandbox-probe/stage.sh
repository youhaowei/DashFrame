#!/bin/sh
# Assemble the disposable probe's build context and print its path.
#
# The probe is deployed from its OWN context rather than from the repository
# root, so that the root `railway.toml` — which names the application's start
# command and restart policy — cannot apply to it. A probe that inherited the
# application's start command would fail to start; one that inherited
# ON_FAILURE would retry a legitimate negative result.
#
# The context mirrors the repository layout, so the Dockerfile's COPY paths are
# the real repository-relative paths and the staged files are byte-identical to
# the committed ones. Every staged file's SHA-256 is printed to stderr so the
# deployed artifact can be tied to an exact source revision.
#
# Usage:  context=$(deploy/sandbox-probe/stage.sh)
#         (cd "$context" && railway up --service <disposable probe service>)
set -eu

here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
root=$(CDPATH= cd -- "$here/../.." && pwd)
out=${1:-$(mktemp -d "${TMPDIR:-/tmp}/dashframe-sandbox-probe-XXXXXX")}

mkdir -p "$out/scripts" "$out/packages/engine-server/scripts" "$out/deploy/sandbox-probe"

cp "$here/Dockerfile" "$out/Dockerfile"
cp "$here/railway.toml" "$out/railway.toml"
cp "$here/package.json" "$out/deploy/sandbox-probe/package.json"
cp "$root/scripts/sandbox-probe.ts" "$out/scripts/sandbox-probe.ts"
cp "$root/packages/engine-server/scripts/sandbox-duck-child.ts" \
  "$out/packages/engine-server/scripts/sandbox-duck-child.ts"

echo "staged probe context: $out" >&2
echo "source revision: $(cd "$root" && git rev-parse HEAD 2>/dev/null || echo unknown)" >&2
echo "file hashes (sha256):" >&2
(cd "$out" && find . -type f | sort | xargs sha256sum) >&2

echo "$out"
