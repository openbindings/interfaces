#!/usr/bin/env bash
# Sync (or check) the vendored copy of the spec meta-schema used by CI.
#
#   .github/scripts/sync-schema.sh          refresh the vendored copy
#   .github/scripts/sync-schema.sh --check  exit 1 if the vendored copy is stale
#
# Source of truth: openbindings.schema.json at the root of the spec repo,
# at SPEC_REF. A sibling checkout (../spec) is refreshed from origin when
# present; otherwise the branch is resolved on GitHub. The schema is read from
# the resolved commit in either case, never a moving branch or working tree.
# CI runs --check.
set -euo pipefail

SPEC_REF="release/0.2"

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
vendored="$repo_root/.github/scripts/openbindings.schema.json"
sibling="$repo_root/../spec"

if git -C "$sibling" rev-parse --git-dir >/dev/null 2>&1; then
  git -C "$sibling" fetch --no-tags origin \
    "+refs/heads/$SPEC_REF:refs/remotes/origin/$SPEC_REF"
  revision=$(git -C "$sibling" rev-parse --verify "refs/remotes/origin/$SPEC_REF^{commit}")
  src="sibling origin/$SPEC_REF at $revision ($sibling)"
  get() { git -C "$sibling" show "$revision:openbindings.schema.json"; }
else
  remote_state=$(git ls-remote --exit-code https://github.com/openbindings/spec.git "refs/heads/$SPEC_REF")
  IFS=$'\t' read -r revision resolved_ref <<< "$remote_state"
  if [[ ! "$revision" =~ ^[0-9a-f]{40}$ ]] || [[ "$resolved_ref" != "refs/heads/$SPEC_REF" ]]; then
    echo "could not resolve exactly one commit for openbindings/spec@$SPEC_REF" >&2
    exit 1
  fi
  src="openbindings/spec@$SPEC_REF at $revision"
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
