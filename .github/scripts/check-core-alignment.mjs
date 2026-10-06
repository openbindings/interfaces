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
const synthesizer = contracts.get('interface-synthesizer');
const synthesisSource = compile(synthesizer, synthesizer.schemas.SynthesizeInterfaceSource);
const absent = Symbol('absent');
for (const sourceContent of [absent, null, false, 0, '', [], { resource: 'local' }]) {
  for (const bindingContent of [absent, null, false, 0, '', [], { target: 'native' }]) {
    const source = { kind: 'example.carried-values@1' };
    if (sourceContent !== absent) source.content = sourceContent;
    const binding = {};
    if (bindingContent !== absent) binding.content = bindingContent;
    accepts(invocation, { source, binding });
    accepts(target, { sourceRef: 'target', binding });
    accepts(synthesisSource, { name: 's', source });
  }
}
for (const request of [
  { source: { kind: 'k' } },
  { source: { kind: 'k' }, content: null },
  { source: { kind: 'k' }, binding: null },
  { source: { kind: 'k' }, binding: {}, selector: 'legacy' },
  { source: { kind: '' }, binding: {} },
  { source: { kind: 'k' }, binding: { preference: 0.5 } },
  { source: { kind: 'k' }, binding: { deprecated: 'yes' } },
]) accepts(invocation, request, false);
accepts(invocation, { source: { kind: 'k', 'x-source': true }, binding: { operation: 'op', source: 's', 'x-binding': null } });
accepts(target, {}, false);
accepts(target, { sourceRef: 'target' }, false);
accepts(target, { binding: {} }, false);
accepts(synthesisSource, { bindingSpec: 'k', content: {} }, false);
accepts(synthesisSource, { source: { kind: 'k' }, embed: true }, false);

// Open carriers are required by the comparison profile. Unknown-member refusal
// is a behavioral producer/consumer rule, not a schema-validation promise. Keep
// witnesses in a reusable corpus and separately exercise the known namespace.
const carriedCases = read('conformance/carried-values/cases.json');
const sourceKeys = new Set(['kind', 'content', 'description']);
const bindingKeys = new Set(['operation', 'source', 'content', 'idempotent', 'preference', 'description', 'deprecated']);
for (const test of carriedCases.tests) {
  const document = contracts.get(test.interface);
  const validate = compile(document, document.schemas[test.schema]);
  accepts(validate, test.value, test.schemaValid);
  const carrier = test.carrier === 'source' ? test.value.source : test.value.binding;
  const keys = test.carrier === 'source' ? sourceKeys : bindingKeys;
  const allowed = carrier && typeof carrier === 'object' && !Array.isArray(carrier)
    && Object.keys(carrier).every(key => keys.has(key) || key.startsWith('x-'));
  const producerKeysValid = test.schema !== 'BindableTarget' || (!Object.hasOwn(carrier, 'operation') && !Object.hasOwn(carrier, 'source'));
  assert.equal(Boolean(allowed) && test.schemaValid && producerKeysValid, test.allowedByCarriedValuesRule, test.description);
}
for (const name of ['binding-invoker', 'source-inspector', 'interface-synthesizer']) {
  const doc = contracts.get(name);
  assert(doc.description.includes('MUST refuse a call carrying any other member'));
  const check = doc.operations[`openbindings.${name}.checkKindSupport`];
  const list = doc.operations[`openbindings.${name}.listSupportedKinds`];
  assert(check && list);
  assert(check.description.includes("MUST have no side effects"));
  const input = compile(doc, check.input), output = compile(doc, check.output);
  accepts(input, { kinds: [] });
  accepts(input, { kinds: ['acme.private@1', 'acme.private@1'] });
  accepts(input, { kinds: [''] }, false);
  accepts(input, { bindingSpecs: ['k'] }, false);
  accepts(output, [{ kind: 'acme.private@1', supported: true }]);
  accepts(output, [{ kind: 'k', supported: 'partial' }], false);
}
// Literal portable cases remain separate from this small consistency oracle.
for (const test of read('conformance/kind-support/cases.json').tests) {
  const warranted = new Set(test.warranted);
  assert(test.listed.every(kind => warranted.has(kind)), test.description);
  assert.deepEqual(test.expected, [...new Set(test.kinds)].map(kind => ({ kind, supported: warranted.has(kind) })), test.description);
}
const coverageReport = compile(synthesizer, synthesizer.schemas.SynthesisCoverage);
let positiveCoverage = 0;
for (const test of read('conformance/synthesis-coverage/cases.json').tests) {
  if (!test.expected.valid) continue; // Other negatives concern runtime correspondence, not shape.
  const report = { entries: test.entries, exhaustive: test.exhaustive, fullyRepresented: test.expected.fullyRepresented };
  if (test.limitation) report.limitation = test.limitation;
  accepts(coverageReport, report);
  positiveCoverage++;
}
assert(positiveCoverage > 0, 'no positive coverage fixtures checked');
const coverage = compile(synthesizer, synthesizer.schemas.SynthesisCoverageEntry);
const represented = { sourceIndex: 0, sourceRef: 'unit', scope: 'target', status: 'represented', sourceKey: 's', operationKey: 'op', bindingKey: 'b' };
accepts(coverage, represented);
accepts(coverage, { ...represented, 'x-note': 'an implementation extension' });
accepts(coverage, { ...represented, status: 'lossy' }, false);
accepts(coverage, { ...represented, status: 'lossy', reasonCode: 'example.loss', message: 'A projection is incomplete.' });
for (const scope of ['target', 'dependency']) {
  const excluded = { sourceIndex: 0, sourceRef: 'unit', scope, status: 'excluded', reasonCode: 'example.exclusion', message: 'A kind-owned exclusion.' };
  accepts(coverage, excluded, false);
  accepts(coverage, { ...excluded, rule: 'example.kind@1 section 4' });
}
const dependency = { sourceIndex: 0, sourceRef: 'dependency', scope: 'dependency', status: 'represented' };
accepts(coverage, dependency);
accepts(coverage, { ...dependency, bindingKey: 'b' }, false);
accepts(coverage, { ...dependency, status: 'lossy', reasonCode: 'example.loss', message: 'A dependency projection is incomplete.' });
console.log(`core-alignment: ${contracts.size} structurally conformant documents, ${compiled} contracts compile; carrier, presence, support and coverage controls pass`);
