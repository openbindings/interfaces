#!/usr/bin/env node
// Same-named schemas across contracts must stay identical.
//
// The root README's self-containment convention says shared shapes
// (FormatInfo, the context/frame families, ...) are duplicated by hand,
// byte-for-byte, rather than $ref'd across files. This check is what keeps
// "duplicated by design" from decaying into divergence.
//
// Usage: node check-shared-schemas.mjs <file.json> [...]
// Only the newest version file per interface directory is compared
// (an older frozen version may legitimately differ from a newer one).
import { readFileSync } from 'node:fs';
import { dirname, basename } from 'node:path';

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('usage: check-shared-schemas.mjs <file.json> [...]');
  process.exit(2);
}

function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

const byDir = new Map();
for (const f of files) {
  const dir = dirname(f);
  const ver = basename(f, '.json');
  const cur = byDir.get(dir);
  if (!cur || compareVersions(ver, cur.ver) > 0) byDir.set(dir, { f, ver });
}

function sortDeep(v) {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .map((k) => [k, sortDeep(v[k])]),
    );
  }
  return v;
}
const canon = (v) => JSON.stringify(sortDeep(v));

const seen = new Map(); // schema name -> { file, canon }
let failed = false;
const latest = [...byDir.values()].map((e) => e.f).sort();
for (const f of latest) {
  const doc = JSON.parse(readFileSync(f, 'utf8'));
  for (const [name, schema] of Object.entries(doc.schemas ?? {})) {
    const c = canon(schema);
    const prior = seen.get(name);
    if (!prior) {
      seen.set(name, { file: f, canon: c });
    } else if (prior.canon !== c) {
      console.error(
        `shared-schemas: "${name}" diverges between ${prior.file} and ${f}`,
      );
      failed = true;
    }
  }
}

if (failed) process.exit(1);
console.log(
  `shared-schemas: ${seen.size} schema name(s) across ${latest.length} contract(s), no divergence`,
);
