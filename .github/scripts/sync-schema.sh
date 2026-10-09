#!/usr/bin/env bash
# Sync (or check) the vendored copy of the spec meta-schema used by CI.
#
#   .github/scripts/sync-schema.sh          refresh the vendored copy
#   .github/scripts/sync-schema.sh --check  exit 1 if the vendored copy is stale
#
# Source of truth: openbindings.schema.json at the root of the spec repo,
# at SPEC_REVISION. A sibling checkout may supply that exact object;
# otherwise its bytes are fetched by full SHA. Adopting a new specification
# requires deliberately updating this pin and the vendored schema together.
# CI runs --check.
set -euo pipefail

SPEC_REVISION="2f7d754dc2da374058cd517064c17e50f7d95d99"

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
vendored="$repo_root/.github/scripts/openbindings.schema.json"
sibling="$repo_root/../spec"

revision="$SPEC_REVISION"
if [[ ! "$revision" =~ ^[0-9a-f]{40}$ ]]; then
  echo "SPEC_REVISION must be a full commit SHA" >&2
  exit 1
fi
if git -C "$sibling" cat-file -e "$revision:openbindings.schema.json" 2>/dev/null; then
  src="sibling at $revision ($sibling)"
  get() { git -C "$sibling" show "$revision:openbindings.schema.json"; }
else
  src="openbindings/spec@$revision"
  get() { curl -fsSL "https://raw.githubusercontent.com/openbindings/spec/$revision/openbindings.schema.json"; }
fi

echo "resolved schema source: $src"

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
