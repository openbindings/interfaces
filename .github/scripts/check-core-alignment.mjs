#!/usr/bin/env node
// Contract-boundary regressions for the kind/content core model. This checks
// artifacts and schema behavior; it is not an invoker implementation.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (name) => JSON.parse(readFileSync(resolve(root, name), 'utf8'));
const require = createRequire(resolve(root, '.github/package.json'));
const Ajv2020 = require('ajv/dist/2020.js');
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
const synthesizer = contracts.get('interface-synthesizer');
// The opening payload names one binding of a carried document. A key that names
// no binding is a run-time outcome (ERR_BINDING_NOT_FOUND), not a shape error.
// Content presence lives in the document, so each variant is a core document.
const invocationDocument = {
  openbindings: '0.2.0',
  operations: { op: {} },
  bindings: { b: { operation: 'op', kind: 'example.invocation@1' } },
};
const absent = Symbol('absent');
for (const content of [absent, null, false, 0, '', [], { target: 'native' }]) {
  const document = structuredClone(invocationDocument);
  if (content !== absent) document.bindings.b.content = content;
  assert(core(document), JSON.stringify(core.errors));
  accepts(invocation, { interface: document, binding: 'b' });
}
accepts(invocation, { interface: invocationDocument, binding: 'missing' });
accepts(invocation, { interface: invocationDocument, binding: 'b', context: {} });
accepts(invocation, { interface: invocationDocument, binding: 'b', context: { custom: [null, false] } });
for (const request of [
  { interface: invocationDocument },
  { binding: 'b' },
  { interface: null, binding: 'b' },
  { interface: invocationDocument, binding: '' },
  { interface: invocationDocument, binding: {} },
  { interface: invocationDocument, binding: null },
  { interface: invocationDocument, binding: 'b', operation: 'op' },
  { interface: invocationDocument, binding: 'b', selection: ['b'] },
  { source: { kind: 'k' }, binding: {} },
]) accepts(invocation, request, false);
for (const context of [null, false, '', []]) {
  accepts(invocation, { interface: invocationDocument, binding: 'b', context }, false);
}
const preflightInput = compile(invoker, invoker.operations['openbindings.binding-invoker.preflightBinding'].input);
accepts(preflightInput, { interface: invocationDocument, binding: 'b' });
accepts(preflightInput, { source: { kind: 'k' }, binding: {} }, false);

// Addressing describes one of three shapes. This says nothing about how a
// provider handles a request outside those shapes.
const operationInvoker = contracts.get('operation-invoker');
const operationRequest = compile(operationInvoker, operationInvoker.schemas.OperationInvocationInput);
for (const addressedByOperation of [false, true]) {
  for (const addressedByBinding of [false, true]) {
    for (const hasSelection of [false, true]) {
      const request = { interface: { openbindings: '0.2.0', operations: {} } };
      if (addressedByOperation) request.operation = 'echo';
      if (addressedByBinding) request.binding = 'echoBinding';
      if (hasSelection) request.selection = ['echoBinding'];
      accepts(operationRequest, request,
        (addressedByOperation && !addressedByBinding) ||
        (addressedByBinding && !addressedByOperation && !hasSelection));
    }
  }
}

// Examples are operation values, not required implementation traces. Check
// the same public schemas a reader uses, including the OBI values they carry.
let exampleValues = 0;
for (const doc of contracts.values()) {
  for (const operation of Object.values(doc.operations)) {
    for (const example of Object.values(operation.examples ?? {})) {
      for (const side of ['input', 'output']) {
        if (!Object.hasOwn(example, side) || !Object.hasOwn(operation, side)) continue;
        accepts(compile(doc, operation[side]), example[side]);
        exampleValues++;
        const value = example[side];
        for (const candidate of [value, value?.interface, value?.input?.interface]) {
          if (candidate && Object.hasOwn(candidate, 'openbindings')) {
            assert(core(candidate), JSON.stringify(core.errors));
          }
        }
      }
    }
  }
}
assert(exampleValues > 0, 'no public operation examples checked');

// These are schema shape controls, not a portable runtime trace format.
// Ordering of internal transitions, close/cancel races and malformed-input
// recovery belong to implementation tests, not these value-shape controls.
for (const [role, prefix, request] of [
  ['binding-invoker', 'BindingInvoker', { interface: { openbindings: '0.2.0', operations: {} }, binding: 'echoBinding' }],
  ['operation-invoker', 'OperationInvoker', { interface: { openbindings: '0.2.0' }, operation: 'echo' }],
]) {
  const document = contracts.get(role);
  const requirement = compile(document, document.schemas.ContextRequirement);
  const challenge = compile(document, document.schemas.ContextRequiredDetails);
  const failure = compile(document, document.schemas.InvocationError);
  const inputFrame = compile(document, document.schemas[`${prefix}InputFrame`]);
  const outputFrame = compile(document, document.schemas[`${prefix}OutputFrame`]);
  const preflight = compile(document, document.operations[`openbindings.${role}.preflight${prefix === 'BindingInvoker' ? 'Binding' : 'Operation'}`].output);
  const custom = { type: 'example.custom', familyValue: { exact: null } };
  const details = { target: '', alternatives: [{ requirements: [custom] }] };

  for (const value of [custom, { ...custom, name: 'custom' }, { ...custom, durable: false }, { ...custom, durable: true }]) {
    accepts(requirement, value);
  }
  for (const value of [{}, { type: '' }, { ...custom, name: '' }, { ...custom, durable: null }, { ...custom, durable: 'true' }]) {
    accepts(requirement, value, false);
  }
  const config = { type: 'config.value', point: 'server', path: '', description: 'A value' };
  accepts(requirement, config);
  for (const schema of [{ type: 'string' }, { enum: ['a', 'b'] }, {}, true, false]) {
    accepts(requirement, { ...config, schema });
  }
  for (const schema of [null, [], 'string', 1]) {
    accepts(requirement, { ...config, schema }, false);
  }
  for (const value of [{ ...config, point: null }, { ...config, path: false }, { ...config, description: 1 }]) {
    accepts(requirement, value, false);
  }
  accepts(challenge, details); // An opaque target may be empty; family fields stay open.
  accepts(preflight, null);
  accepts(preflight, details);
  for (const value of [
    null, {}, { ...details, target: null }, { ...details, extra: true },
    { ...details, alternatives: [] },
    { ...details, alternatives: [{ requirements: [] }] },
    { ...details, alternatives: [{ requirements: [custom], extra: true }] },
    { ...details, alternatives: [{ requirements: [{ type: '' }] }] },
  ]) {
    accepts(challenge, value, false);
    if (value !== null) accepts(preflight, value, false);
  }
  accepts(failure, { code: 'example.application-failure' });
  for (const data of [null, false, 0, '', [], { application: 'value' }]) {
    accepts(failure, { code: 'example.application-failure', data });
  }
  for (const value of [{}, { code: '' }, { code: null }, { code: 'ERR_EXECUTION_FAILED', message: 'extra' }]) {
    accepts(failure, value, false);
  }
  for (const frame of [{ kind: 'open', input: request }, { kind: 'input', value: null }, { kind: 'close' }]) {
    accepts(inputFrame, frame);
    accepts(inputFrame, { ...frame, extra: true }, false);
  }
  for (const frame of [null, [], {}, { kind: 'unknown' }, { kind: 'open' }, { kind: 'open', input: null }, { kind: 'input' }, { kind: 'close', value: null }]) {
    accepts(inputFrame, frame, false);
  }
  for (const frame of [
    { kind: 'output', value: null }, { kind: 'input_closed' }, { kind: 'complete' },
    { kind: 'error', error: { code: 'example.application-failure', data: null } },
  ]) {
    accepts(outputFrame, frame);
    accepts(outputFrame, { ...frame, extra: true }, false);
  }
  for (const frame of [null, [], {}, { kind: 'unknown' }, { kind: 'output' }, { kind: 'complete', value: null }, { kind: 'error' }, { kind: 'error', error: { code: '' } }]) {
    accepts(outputFrame, frame, false);
  }
}

for (const name of ['binding-invoker', 'interface-synthesizer']) {
  const doc = contracts.get(name);
  const check = doc.operations[`openbindings.${name}.checkKindSupport`];
  const list = doc.operations[`openbindings.${name}.listSupportedKinds`];
  assert(check && list);
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
const reportSchema = compile(synthesizer, synthesizer.schemas.SynthesisReport);
const additionsSchema = compile(synthesizer, synthesizer.schemas.SynthesisAdditions);
// The guide's complete-synthesis condition: an exhaustive report with no
// implementation gap. Exclusions, invalid parts and lossy additions still meet it.
const completeSynthesis = (report) => report.exhaustive === true
  && (report.omitted ?? []).every(entry => entry.status !== 'implementation-unsupported');
// Insert additions as the interface describes them: each added key is new to
// its map, and added operation keys are new to the identifier namespace.
const has = (map, key) => Object.hasOwn(map ?? {}, key);
const MAPS = ['schemas', 'operations', 'dependencies', 'bindings', 'resources'];
function insertAdditions(document, additions, label) {
  const identifiers = new Set();
  for (const [key, operation] of Object.entries(document.operations ?? {})) {
    identifiers.add(key);
    for (const alias of operation.aliases ?? []) identifiers.add(alias);
  }
  const merged = structuredClone(document);
  for (const map of MAPS) {
    for (const [key, value] of Object.entries(additions[map] ?? {})) {
      assert(!has(document[map], key), `${label}: added ${map} key ${key} is not new`);
      if (map === 'operations') assert(!identifiers.has(key), `${label}: added operation key ${key} is an existing identifier`);
      merged[map] = { ...(merged[map] ?? {}), [key]: value };
    }
  }
  assert(core(merged), `${label}: ${JSON.stringify(core.errors)}`);
  return merged;
}
// The schemas keys named by "#/schemas/" references anywhere in a JSON value.
function schemaReferences(value, found = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) schemaReferences(item, found);
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (key === '$ref' && typeof child === 'string' && child.startsWith('#/schemas/')) {
        found.add(child.slice('#/schemas/'.length).split('/')[0].replaceAll('~1', '/').replaceAll('~0', '~'));
      } else {
        schemaReferences(child, found);
      }
    }
  }
  return found;
}
// uses keys name additions, and a kept entry is self-sufficient: every schema
// its operation refers to, directly or through a used schema, is in the input
// document or in uses.schemas.
function checkUses(document, additions, operation, uses, label) {
  for (const map of MAPS) {
    for (const key of uses?.[map] ?? []) assert(has(additions[map], key), `${label}: uses.${map} names an addition, ${key}`);
  }
  const used = new Set(uses?.schemas ?? []);
  for (const value of [operation?.input, operation?.output, ...[...used].map(key => additions.schemas[key])]) {
    for (const key of schemaReferences(value)) {
      assert(has(document.schemas, key) || used.has(key), `${label}: #/schemas/${key} is in the input document or in uses.schemas`);
    }
  }
}
// Report keys point where the interface says they do.
function checkAttribution(document, additions, report, label) {
  const attributed = { bindings: new Set(), dependencies: new Set() };
  for (const entry of report.added) {
    const [map, key] = Object.hasOwn(entry, 'binding') ? ['bindings', entry.binding] : ['dependencies', entry.dependency];
    assert(has(additions[map], key), `${label}: added entry ${key} names an added ${map} entry`);
    assert(!attributed[map].has(key), `${label}: ${key} appears once in added`);
    attributed[map].add(key);
    assert(has(additions.operations, entry.operation), `${label}: ${key} names an added operation`);
    assert.equal(additions[map][key].operation, entry.operation, `${label}: ${key} carries the entry's operation`);
    checkUses(document, additions, additions.operations[entry.operation], entry.uses, `${label}: ${key}`);
  }
  for (const map of ['bindings', 'dependencies']) {
    for (const key of Object.keys(additions[map] ?? {})) assert(attributed[map].has(key), `${label}: added ${map} key ${key} appears in added`);
  }
  const existing = new Set();
  for (const entry of report.existing ?? []) {
    assert(has(document.bindings, entry.binding), `${label}: existing names an input binding, ${entry.binding}`);
    assert(!existing.has(entry.binding), `${label}: ${entry.binding} appears once in existing`);
    existing.add(entry.binding);
    checkUses(document, additions, entry.proposal?.operation, entry.proposal?.uses, `${label}: ${entry.binding}`);
  }
}
let reportCases = 0;
for (const test of read('conformance/synthesis-report/cases.json').tests) {
  accepts(reportSchema, test.report, test.schemaValid);
  accepts(additionsSchema, test.additions);
  insertAdditions(test.interface, test.additions, test.description);
  if (test.schemaValid) {
    checkAttribution(test.interface, test.additions, test.report, test.description);
    assert.equal(completeSynthesis(test.report), test.completeSynthesis, test.description);
  }
  reportCases++;
}
assert(reportCases > 0, 'no synthesis report cases checked');
const synthesis = synthesizer.operations['openbindings.interface-synthesizer.synthesizeInterface'];
const synthesisInput = compile(synthesizer, synthesis.input);
const synthesisResult = compile(synthesizer, synthesis.output);
// The examples' descriptions say which results are complete synthesis.
const exampleComplete = { textTools: true, partialTextTools: false, existingTextTools: true };
for (const [name, example] of Object.entries(synthesis.examples)) {
  accepts(synthesisInput, example.input);
  accepts(synthesisResult, example.output);
  const { interface: document, kind } = example.input;
  const { additions, report } = example.output;
  insertAdditions(document, additions, name);
  checkAttribution(document, additions, report, name);
  assert(Object.hasOwn(exampleComplete, name), `${name}: no recorded complete-synthesis value`);
  assert.equal(completeSynthesis(report), exampleComplete[name], name);
  for (const binding of Object.values(additions.bindings ?? {})) {
    assert.equal(binding.kind, kind, `${name}: added bindings carry the requested kind`);
  }
  for (const entry of report.existing ?? []) {
    assert.equal(document.bindings[entry.binding].kind, kind, `${name}: existing entries name bindings of the requested kind`);
  }
}
const minimal = { openbindings: '0.2.0', operations: {} };
accepts(synthesisInput, { interface: minimal, kind: 'example.text@1' });
accepts(synthesisInput, { interface: minimal, kind: 'k', sources: [] });
accepts(synthesisInput, { interface: minimal, kind: 'k', sources: ['api', 'events'] });
for (const request of [
  { kind: 'k' },
  { interface: minimal },
  { interface: minimal, kind: '' },
  { interface: minimal, kind: 'k', sources: [''] },
  { interface: minimal, kind: 'k', sources: 'api' },
  { interface: minimal, kind: 'k', name: 'n' },
  { interface: minimal, kind: 'k', version: '1.0' },
  { interface: minimal, kind: 'k', description: 'd' },
  { interface: minimal, kind: 'k', openbindingsVersion: '0.2.0' },
  { sources: [{ source: { kind: 'k' } }] },
]) accepts(synthesisInput, request, false);
const bare = { exhaustive: true, added: [] };
accepts(synthesisResult, { additions: {}, report: bare });
for (const result of [{ additions: {} }, { report: bare }, { additions: [], report: bare }]) {
  accepts(synthesisResult, result, false);
}
// Report shape controls.
const limitation = { code: 'example.unread', message: 'Part of a source was not read.' };
accepts(reportSchema, bare);
accepts(reportSchema, { ...bare, 'x-note': 'an implementation extension' });
accepts(reportSchema, { ...bare, existing: [], omitted: [] });
accepts(reportSchema, { ...bare, exhaustive: false, limitation });
accepts(reportSchema, { ...bare, exhaustive: false, limitation: { ...limitation, details: { unread: ['#/components'] } } });
for (const report of [
  { added: [] },
  { exhaustive: true },
  { ...bare, exhaustive: 'true' },
  { ...bare, exhaustive: false },
  { ...bare, exhaustive: false, limitation: { code: '', message: 'm' } },
  { ...bare, exhaustive: false, limitation: { code: 'c' } },
  { ...bare, added: {} },
  { ...bare, existing: [null] },
  { ...bare, omitted: {} },
]) accepts(reportSchema, report, false);
const added = compile(synthesizer, synthesizer.schemas.SynthesisAddedEntry);
const addedBinding = { binding: 'b', operation: 'op' };
const addedDependency = { dependency: 'd', operation: 'op' };
const loss = { reasonCode: 'example.loss', message: 'A schema is approximated.' };
for (const entry of [
  addedBinding,
  addedDependency,
  { ...addedBinding, uses: {} },
  { ...addedBinding, uses: { schemas: ['S'], operations: [], dependencies: ['d'], bindings: ['c'], resources: ['r'] } },
  { ...addedBinding, lossy: loss },
  { ...addedBinding, lossy: { ...loss, details: { construct: 'discriminator' } } },
  { ...addedBinding, requirements: ['example.api-key'] },
  { ...addedDependency, uses: { schemas: ['S'] }, lossy: loss },
  { ...addedBinding, 'x-note': 'an implementation extension' },
]) accepts(added, entry);
for (const entry of [
  { operation: 'op' },
  { binding: 'b' },
  { ...addedBinding, dependency: 'd' },
  { ...addedBinding, dependency: 'd', requirements: ['example.api-key'] },
  { ...addedDependency, requirements: ['example.api-key'] },
  { ...addedBinding, binding: '' },
  { ...addedBinding, operation: '' },
  { ...addedBinding, uses: { schemas: 'S' } },
  { ...addedBinding, uses: { schemas: [''] } },
  { ...addedBinding, lossy: { reasonCode: 'example.loss' } },
  { ...addedBinding, lossy: { message: 'A schema is approximated.' } },
  { ...addedBinding, lossy: true },
  { ...addedBinding, requirements: [''] },
]) accepts(added, entry, false);
const existing = compile(synthesizer, synthesizer.schemas.SynthesisExistingEntry);
const current = { binding: 'b', status: 'current' };
const stale = { binding: 'b', status: 'stale' };
const unmatched = { binding: 'b', status: 'unmatched' };
for (const entry of [
  current,
  { ...stale, proposal: { content: { selector: '#/paths/~1users/get' } } },
  { ...stale, proposal: { content: null } },
  { ...stale, proposal: { operation: {} } },
  { ...stale, proposal: { content: 'echo', operation: { output: { $ref: '#/schemas/S' } }, uses: { schemas: ['S'] } } },
  { ...stale, proposal: { content: 'echo', 'x-note': 'an implementation extension' } },
  unmatched,
  { ...unmatched, reasonCode: 'example.removed', message: 'The source no longer offers it.', details: { path: '/legacy' } },
  { ...current, 'x-note': 'an implementation extension' },
]) accepts(existing, entry);
for (const entry of [
  { status: 'current' },
  { binding: 'b' },
  { ...current, binding: '' },
  { ...current, status: 'excluded' },
  { ...current, proposal: { content: 'echo' } },
  { ...current, message: 'm' },
  stale,
  { ...stale, proposal: {} },
  { ...stale, content: 'echo', operation: {} },
  { ...stale, proposal: null },
  { ...stale, proposal: { uses: { schemas: ['S'] } } },
  { ...stale, proposal: { operation: 'op' } },
  { ...stale, proposal: { content: 'echo', uses: { schemas: [''] } } },
  { ...stale, proposal: { content: 'echo' }, reasonCode: 'example.changed' },
  { ...unmatched, proposal: { content: 'echo' } },
  { ...unmatched, reasonCode: '' },
]) accepts(existing, entry, false);
const omitted = compile(synthesizer, synthesizer.schemas.SynthesisOmittedEntry);
const omission = { reasonCode: 'example.reason', message: 'Not represented.' };
for (const entry of [
  { status: 'excluded', ...omission, rule: 'example.kind@1 section 4' },
  { status: 'invalid', ...omission },
  { status: 'implementation-unsupported', ...omission, details: { path: '/users' } },
  { status: 'invalid', ...omission, 'x-note': 'an implementation extension' },
]) accepts(omitted, entry);
for (const entry of [
  { status: 'excluded', ...omission },
  { status: 'excluded', ...omission, rule: '' },
  { status: 'invalid', message: 'Not represented.' },
  { status: 'invalid', reasonCode: 'example.reason' },
  { status: 'invalid', ...omission, reasonCode: '' },
  { status: 'invalid', ...omission, details: [] },
  { ...omission },
  { status: 'lossy', ...omission },
  { status: 'stale', ...omission },
]) accepts(omitted, entry, false);
console.log(`core-alignment: ${contracts.size} structurally conformant documents, ${compiled} contracts compile; invocation request, presence, support, frame shape, synthesis and report controls pass`);
