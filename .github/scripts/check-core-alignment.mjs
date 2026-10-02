#!/usr/bin/env node
// Contract-boundary regressions for the kind/content core model. This checks
// artifacts and schema behavior; it is not an invoker implementation.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (name) => JSON.parse(readFileSync(resolve(root, name), 'utf8'));
const require = createRequire(import.meta.url);
let Ajv2020;
try { Ajv2020 = require('ajv/dist/2020.js'); }
catch {
  const globalRoot = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim();
  Ajv2020 = createRequire(resolve(globalRoot, 'ajv-cli/package.json'))('ajv/dist/2020.js');
}
const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
const core = ajv.compile(read('.github/scripts/openbindings.schema.json'));
const contracts = new Map();
for (const entry of readdirSync(root, { withFileTypes: true })) {
  if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
  for (const file of readdirSync(resolve(root, entry.name))) {
    if (!/^\d.*\.json$/.test(file)) continue;
    const doc = read(`${entry.name}/${file}`);
    assert(core(doc), `${entry.name}/${file}: ${JSON.stringify(core.errors)}`);
    for (const operation of Object.values(doc.operations)) {
      assert(!Object.hasOwn(operation, 'idempotent'), 'idempotent belongs to a binding');
    }
    contracts.set(entry.name, doc);
  }
}

// Rehouse this corpus's embedded schemas for Ajv; never transform carried
// example/const/enum values, which may themselves contain a $ref member.
function rehouse(schema) {
  if (typeof schema === 'boolean') return schema;
  const out = { ...schema };
  if (typeof out.$ref === 'string' && out.$ref.startsWith('#/schemas/')) {
    out.$ref = '#/$defs/' + out.$ref.slice('#/schemas/'.length);
  }
  for (const key of ['$defs', 'properties', 'patternProperties', 'dependentSchemas']) {
    if (out[key]) out[key] = Object.fromEntries(Object.entries(out[key]).map(([k,v]) => [k,rehouse(v)]));
  }
  for (const key of ['allOf', 'anyOf', 'oneOf', 'prefixItems']) {
    if (out[key]) out[key] = out[key].map(rehouse);
  }
  for (const key of ['items', 'additionalProperties', 'contains', 'not', 'if', 'then', 'else', 'unevaluatedItems', 'unevaluatedProperties']) {
    if (Object.hasOwn(out, key)) out[key] = rehouse(out[key]);
  }
  return out;
}
function compile(document, schema) {
  const definitions = Object.fromEntries(Object.entries(document.schemas ?? {}).map(([k,v]) => [k,rehouse(v)]));
  return ajv.compile({ $schema: 'https://json-schema.org/draft/2020-12/schema', $defs: definitions, allOf: [rehouse(schema)] });
}
function accepts(validate, value, expected = true) {
  assert.equal(validate(value), expected, `${JSON.stringify(value)}: ${JSON.stringify(validate.errors)}`);
}
let compiled = 0;
for (const doc of contracts.values()) {
  for (const operation of Object.values(doc.operations)) {
    for (const side of ['input', 'output']) {
      if (Object.hasOwn(operation, side)) { compile(doc, operation[side]); compiled++; }
    }
  }
}

const invoker = contracts.get('binding-invoker');
const invocation = compile(invoker, invoker.schemas.BindingInvocationInput);
const inspector = contracts.get('source-inspector');
const target = compile(inspector, inspector.schemas.BindableTarget);
const absent = Symbol('absent');
for (const sourceContent of [absent, null, false, 0, '', [], { location: 'https://example.invalid/artifact' }]) {
  for (const bindingContent of [absent, null, false, 0, '', [], { selector: 'target' }]) {
    const source = { kind: 'example.test@1' };
    if (sourceContent !== absent) source.content = sourceContent;
    const request = { source }, found = {};
    if (bindingContent !== absent) request.content = found.content = bindingContent;
    accepts(invocation, request);
    accepts(target, found);
  }
}
accepts(invocation, { source: { bindingSpec: 'example.test@1', location: 'https://example.invalid' }, selector: 'old' }, false);
accepts(invocation, { source: { kind: 'example.test@1' }, selector: 'old' }, false);
accepts(invocation, { source: { kind: '' } }, false);
accepts(target, { selector: 'old' }, false);

const synthesizer = contracts.get('interface-synthesizer');
const coverage = compile(synthesizer, synthesizer.schemas.SynthesisCoverageEntry);
const represented = { sourceIndex: 0, sourceRef: 'unit', scope: 'target', status: 'represented', sourceKey: 's', operationKey: 'op', bindingKey: 'b' };
for (const content of [absent, null, false, 0, '', [], { selector: 'target' }]) {
  const entry = { ...represented };
  if (content !== absent) entry.bindingContent = content;
  accepts(coverage, entry);
}
const dependency = { sourceIndex: 0, sourceRef: 'dependency', scope: 'dependency', status: 'represented' };
accepts(coverage, dependency);
accepts(coverage, { ...dependency, bindingContent: null }, false);
accepts(coverage, { ...represented, bindingSelector: 'old' }, false);
accepts(coverage, { ...represented, status: 'lossy' }, false);
accepts(coverage, { ...represented, status: 'lossy', reasonCode: 'example.loss', message: 'A projection is incomplete.' });
console.log(`core-alignment: ${contracts.size} conformant structural documents, ${compiled} contracts compile; kind/content boundary controls pass`);
