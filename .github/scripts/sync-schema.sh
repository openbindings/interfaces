#!/usr/bin/env bash
# Sync (or check) the vendored copy of the spec meta-schema used by CI.
#
#   .github/scripts/sync-schema.sh          refresh the vendored copy
#   .github/scripts/sync-schema.sh --check  exit 1 if the vendored copy is stale
#
# Source of truth: openbindings.schema.json at the root of the spec repo,
# at SPEC_REF. A sibling checkout (../spec) is preferred when present;
# otherwise the file is fetched from GitHub. CI runs --check.
set -euo pipefail

SPEC_REF="main"

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
vendored="$repo_root/.github/scripts/openbindings.schema.json"
sibling="$repo_root/../spec/openbindings.schema.json"

if [ -f "$sibling" ]; then
  src="sibling checkout ($sibling)"
  get() { cat "$sibling"; }
else
  src="openbindings/spec@$SPEC_REF"
  get() { curl -fsSL "https://raw.githubusercontent.com/openbindings/spec/$SPEC_REF/openbindings.schema.json"; }
fi

if [ "${1:-}" = "--check" ]; then
  if get | diff -u "$vendored" - >/dev/null; then
    echo "vendored schema is current (against $src)"
  else
    echo "vendored schema is stale against $src; run .github/scripts/sync-schema.sh" >&2
    get | diff -u "$vendored" - >&2 || true
    exit 1
  fi
else
  get > "$vendored"
  echo "vendored schema refreshed from $src"
fi
