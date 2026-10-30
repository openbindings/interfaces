#!/usr/bin/env node
// Contract-boundary regressions for the sources core model. This checks
// artifacts and schema behavior; it is not an invoker or puller implementation.
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
const puller = contracts.get('source-puller');
// The opening payload names one binding of a carried document. A key that names
// no binding is a run-time outcome (ERR_BINDING_NOT_FOUND), not a shape error.
// Data presence lives in the document, on the binding and on its source, so
// each variant is a core document.
const invocationDocument = {
  openbindings: '0.2.0',
  operations: { op: {} },
  sources: { s: { kind: 'example.invocation@1' } },
  bindings: { b: { operation: 'op', source: 's' } },
};
const absent = Symbol('absent');
for (const data of [absent, null, false, 0, '', [], { target: 'native' }]) {
  for (const carrier of ['binding', 'source']) {
    const document = structuredClone(invocationDocument);
    const entry = carrier === 'binding' ? document.bindings.b : document.sources.s;
    if (data !== absent) entry.data = data;
    assert(core(document), JSON.stringify(core.errors));
    accepts(invocation, { interface: document, binding: 'b' });
  }
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
  { interface: invocationDocument, binding: 'b', source: 's' },
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

{
  const check = invoker.operations['openbindings.binding-invoker.checkKindSupport'];
  const list = invoker.operations['openbindings.binding-invoker.listSupportedKinds'];
  assert(check && list);
  const input = compile(invoker, check.input), output = compile(invoker, check.output);
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

const reportSchema = compile(puller, puller.schemas.PullReport);
const additionsSchema = compile(puller, puller.schemas.PullAdditions);
// The guide's complete-pull condition: an exhaustive report with no
// implementation gap. Exclusions, invalid parts, conflicts and lossy additions
// still meet it.
const completePull = (report) => report.exhaustive === true
  && (report.omitted ?? []).every(entry => entry.status !== 'implementation-unsupported');
// Insert additions as the interface describes them: each added key is new to
// its map, added operation keys are new to the identifier namespace, and added
// bindings name the pulled source.
const has = (map, key) => Object.hasOwn(map ?? {}, key);
const MAPS = ['operations', 'schemas', 'bindings'];
function insertAdditions(document, source, additions, label) {
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
      if (map === 'bindings') assert.equal(value.source, source, `${label}: added binding ${key} names the pulled source`);
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
// uses labels are <map>/<key> and name additions; a kept entry is
// self-sufficient: every schema its operation refers to, directly or through a
// used schema, is in the input document or among the used schemas.
function parseUses(uses, label) {
  const used = { operations: new Set(), schemas: new Set(), bindings: new Set() };
  for (const entry of uses ?? []) {
    const slash = entry.indexOf('/');
    assert(slash > 0 && slash < entry.length - 1, `${label}: uses label ${entry} is <map>/<key>`);
    const map = entry.slice(0, slash), key = entry.slice(slash + 1);
    assert(Object.hasOwn(used, map), `${label}: uses label ${entry} names an additions map`);
    assert(!used[map].has(key), `${label}: ${entry} appears once in uses`);
    used[map].add(key);
  }
  return used;
}
function checkUses(document, additions, operation, uses, label) {
  const used = parseUses(uses, label);
  for (const map of MAPS) {
    for (const key of used[map]) assert(has(additions[map], key), `${label}: ${map}/${key} names an addition`);
  }
  for (const value of [operation?.input, operation?.output, ...[...used.schemas].map(key => additions.schemas[key])]) {
    for (const key of schemaReferences(value)) {
      assert(has(document.schemas, key) || used.schemas.has(key), `${label}: #/schemas/${key} is in the input document or in uses`);
    }
  }
}
// Report keys point where the interface says they do.
function checkAttribution(document, source, additions, report, label) {
  const attributed = new Set();
  for (const entry of report.added) {
    assert(has(additions.bindings, entry.binding), `${label}: added entry ${entry.binding} names an added binding`);
    assert(!attributed.has(entry.binding), `${label}: ${entry.binding} appears once in added`);
    attributed.add(entry.binding);
    const binding = additions.bindings[entry.binding];
    assert.equal(binding.operation, entry.operation, `${label}: ${entry.binding} carries the entry's operation`);
    if (entry.reused) {
      assert(has(document.operations, entry.operation) && !has(additions.operations, entry.operation), `${label}: ${entry.binding} reuses an existing operation`);
      checkUses(document, additions, undefined, entry.uses, `${label}: ${entry.binding}`);
    } else {
      assert(has(additions.operations, entry.operation), `${label}: ${entry.binding} names an added operation`);
      checkUses(document, additions, additions.operations[entry.operation], entry.uses, `${label}: ${entry.binding}`);
    }
  }
  for (const key of Object.keys(additions.bindings ?? {})) assert(attributed.has(key), `${label}: added binding ${key} appears in added`);
  const existing = { binding: new Set(), schema: new Set(), source: new Set() };
  for (const entry of report.existing ?? []) {
    const names = ['binding', 'schema', 'source'].filter(name => Object.hasOwn(entry, name));
    assert.equal(names.length, 1, `${label}: an existing entry names exactly one entry`);
    const [name] = names, key = entry[name];
    assert(!existing[name].has(key), `${label}: ${name} ${key} appears once in existing`);
    existing[name].add(key);
    if (name === 'binding') {
      assert(has(document.bindings, key), `${label}: existing names an input binding, ${key}`);
      assert.equal(document.bindings[key].source, source, `${label}: ${key} names the pulled source`);
      if (entry.proposal) checkUses(document, additions, { input: entry.proposal.input, output: entry.proposal.output }, entry.proposal.uses, `${label}: ${key}`);
    } else if (name === 'schema') {
      assert(has(document.schemas, key), `${label}: existing names an input schema, ${key}`);
      assert(!has(additions.schemas, key), `${label}: schema ${key} is not also added`);
    } else {
      assert.equal(key, source, `${label}: the source entry names the pulled source`);
    }
  }
}
let reportCases = 0;
for (const test of read('conformance/pull-report/cases.json').tests) {
  accepts(reportSchema, test.report, test.schemaValid);
  accepts(additionsSchema, test.additions);
  assert(has(test.interface.sources, test.source), `${test.description}: source names a sources entry`);
  insertAdditions(test.interface, test.source, test.additions, test.description);
  if (test.schemaValid) {
    checkAttribution(test.interface, test.source, test.additions, test.report, test.description);
    assert.equal(completePull(test.report), test.completePull, test.description);
  }
  reportCases++;
}
assert(reportCases > 0, 'no pull report cases checked');
const pull = puller.operations['openbindings.source-puller.pullSource'];
const pullInput = compile(puller, pull.input);
const pullResult = compile(puller, pull.output);
// The examples' descriptions say which results are complete pulls.
const exampleComplete = { textTools: true, partialTextTools: false, existingTextTools: true, staleTextTools: true, reusedTextTools: true };
for (const [name, example] of Object.entries(pull.examples)) {
  accepts(pullInput, example.input);
  accepts(pullResult, example.output);
  const { interface: document, source } = example.input;
  const { additions, report } = example.output;
  assert(has(document.sources, source), `${name}: source names a sources entry`);
  insertAdditions(document, source, additions, name);
  checkAttribution(document, source, additions, report, name);
  assert(Object.hasOwn(exampleComplete, name), `${name}: no recorded complete-pull value`);
  assert.equal(completePull(report), exampleComplete[name], name);
}
const minimal = { openbindings: '0.2.0', operations: {}, sources: { api: { kind: 'k' } } };
accepts(pullInput, { interface: minimal, source: 'api' });
accepts(pullInput, { interface: minimal, source: 'api', context: {} });
accepts(pullInput, { interface: minimal, source: 'api', context: { token: 'placeholder' } });
for (const request of [
  { source: 'api' },
  { interface: minimal },
  { interface: null, source: 'api' },
  { interface: minimal, source: '' },
  { interface: minimal, source: ['api'] },
  { interface: minimal, source: null },
  { interface: minimal, kind: 'k' },
  { interface: minimal, source: 'api', kind: 'k' },
  { interface: minimal, source: 'api', sources: ['api'] },
  { interface: minimal, source: 'api', name: 'n' },
  { interface: minimal, source: 'api', context: null },
  { interface: minimal, source: 'api', context: 'token' },
  { sources: [{ source: { kind: 'k' } }] },
]) accepts(pullInput, request, false);
const bare = { exhaustive: true, added: [] };
accepts(pullResult, { additions: {}, report: bare });
for (const result of [{ additions: {} }, { report: bare }, { additions: [], report: bare }]) {
  accepts(pullResult, result, false);
}
// Report shape controls.
const limitation = { code: 'example.unread', message: 'Part of the source was not read.' };
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
const added = compile(puller, puller.schemas.PullAddedEntry);
const addedBinding = { binding: 'b', operation: 'op' };
const loss = { reasonCode: 'example.loss', message: 'A schema is approximated.' };
for (const entry of [
  addedBinding,
  { ...addedBinding, uses: [] },
  { ...addedBinding, uses: ['schemas/S', 'operations/op2', 'bindings/c'] },
  { ...addedBinding, reused: true },
  { ...addedBinding, lossy: loss },
  { ...addedBinding, lossy: { ...loss, details: { construct: 'discriminator' } } },
  { ...addedBinding, 'x-note': 'an implementation extension' },
]) accepts(added, entry);
for (const entry of [
  { operation: 'op' },
  { binding: 'b' },
  { ...addedBinding, binding: '' },
  { ...addedBinding, operation: '' },
  { ...addedBinding, uses: 'schemas/S' },
  { ...addedBinding, uses: [''] },
  { ...addedBinding, uses: { schemas: ['S'] } },
  { ...addedBinding, reused: false },
  { ...addedBinding, reused: 'yes' },
  { ...addedBinding, lossy: { reasonCode: 'example.loss' } },
  { ...addedBinding, lossy: { message: 'A schema is approximated.' } },
  { ...addedBinding, lossy: true },
]) accepts(added, entry, false);
const existing = compile(puller, puller.schemas.PullExistingEntry);
const current = { binding: 'b', status: 'current' };
const stale = { binding: 'b', status: 'stale', change: 'non-breaking' };
const unmatched = { binding: 'b', status: 'unmatched' };
for (const entry of [
  current,
  { ...stale, proposal: { data: { selector: '#/paths/~1users/get' } } },
  { ...stale, proposal: { data: null } },
  { ...stale, change: 'breaking', proposal: { input: {} } },
  { ...stale, change: 'dangerous', proposal: { output: true } },
  { ...stale, proposal: { data: 'echo', output: { $ref: '#/schemas/S' }, uses: ['schemas/S'] } },
  { ...stale, proposal: { data: 'echo' }, reasonCode: 'example.moved', message: 'The target moved.', details: { from: '/a', to: '/b' } },
  { ...stale, proposal: { data: 'echo', 'x-note': 'an implementation extension' } },
  unmatched,
  { ...unmatched, reasonCode: 'example.removed', message: 'The source no longer offers it.', details: { path: '/legacy' } },
  { ...current, 'x-note': 'an implementation extension' },
  { schema: 'S', status: 'current' },
  { schema: 'S', status: 'stale', change: 'non-breaking', proposal: { type: 'object' } },
  { schema: 'S', status: 'stale', change: 'breaking', proposal: false },
  { source: 'api', status: 'current' },
  { source: 'api', status: 'stale', change: 'non-breaking', proposal: { data: { location: 'https://example.com/openapi.json' } } },
  { source: 'api', status: 'stale', change: 'non-breaking', proposal: { data: null } },
]) accepts(existing, entry);
for (const entry of [
  { status: 'current' },
  { binding: 'b' },
  { ...current, binding: '' },
  { ...current, status: 'excluded' },
  { ...current, proposal: { data: 'echo' } },
  { ...current, change: 'non-breaking' },
  { ...current, message: 'm' },
  { binding: 'b', status: 'stale' },
  { binding: 'b', status: 'stale', proposal: { data: 'echo' } },
  stale,
  { ...stale, proposal: {} },
  { ...stale, proposal: null },
  { ...stale, proposal: { uses: ['schemas/S'] } },
  { ...stale, proposal: { operation: {} } },
  { ...stale, proposal: { content: 'echo' } },
  { ...stale, proposal: { data: 'echo' }, change: 'minor' },
  { ...stale, proposal: { data: 'echo', uses: [''] } },
  { ...stale, proposal: { data: 'echo', input: 'string' } },
  { ...unmatched, proposal: { data: 'echo' } },
  { ...unmatched, change: 'breaking' },
  { ...unmatched, reasonCode: '' },
  { binding: 'b', schema: 'S', status: 'current' },
  { binding: 'b', source: 'api', status: 'current' },
  { schema: 'S', status: 'stale', change: 'non-breaking', proposal: 'string' },
  { source: 'api', status: 'stale', change: 'non-breaking', proposal: {} },
  { source: 'api', status: 'stale', change: 'non-breaking', proposal: true },
  { source: 'api', status: 'unmatched', proposal: { data: null } },
]) accepts(existing, entry, false);
const omitted = compile(puller, puller.schemas.PullOmittedEntry);
const omission = { reasonCode: 'example.reason', message: 'Not represented.' };
for (const entry of [
  { status: 'excluded', ...omission, rule: 'example.kind@1 section 4' },
  { status: 'invalid', ...omission },
  { status: 'implementation-unsupported', ...omission, details: { path: '/users' } },
  { status: 'conflict', ...omission, details: { operation: 'getUser' } },
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
console.log(`core-alignment: ${contracts.size} structurally conformant documents, ${compiled} contracts compile; invocation request, presence, support, frame shape, pull and report controls pass`);
