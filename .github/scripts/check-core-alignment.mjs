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
accepts(invocation, { source: { kind: 'k' }, binding: { operation: '', source: '' }, context: {} });
accepts(invocation, { source: { kind: 'k' }, binding: {}, context: { custom: [null, false] } });
for (const context of [null, false, '', []]) {
  accepts(invocation, { source: { kind: 'k' }, binding: {}, context }, false);
}
accepts(target, {}, false);
accepts(target, { sourceRef: 'target' }, false);
accepts(target, { binding: {} }, false);
accepts(synthesisSource, { bindingSpec: 'k', content: {} }, false);
accepts(synthesisSource, { source: { kind: 'k' }, embed: true }, false);

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

// Inspection framing is portable into an authored OBI. Exercise the carried
// resource example under different author-assigned keys, without fetching.
for (const framing of inspector.schemas.Operation.examples ?? []) {
  accepts(compile(inspector, inspector.schemas.Operation), framing);
  for (const key of ['echo', 'author.renamed']) {
    const authored = { openbindings: '0.2.0', operations: { [key]: framing } };
    assert(core(authored), JSON.stringify(core.errors));
    const pointer = key.replaceAll('~', '~0').replaceAll('/', '~1');
    // Ajv does not discover resource roots in OBI's non-schema `operations`
    // map. Register this example's explicitly declared resource before lookup.
    const validator = new Ajv2020({ strict: false });
    validator.addSchema(framing.input);
    const validate = validator.compile({
      ...authored, $ref: `#/operations/${pointer}/input`,
    });
    accepts(validate, 'Hello');
    accepts(validate, 42, false);
  }
}

// These are schema shape controls, not a portable runtime trace format.
// Ordering of internal transitions, close/cancel races and malformed-input
// recovery belong to implementation tests, not these value-shape controls.
for (const [role, prefix, request] of [
  ['binding-invoker', 'BindingInvoker', { source: { kind: 'example.invocation@1' }, binding: {} }],
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

// Open carrier schemas do not fully check core field membership. These examples
// distinguish the two facts without prescribing malformed-input handling.
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
  assert.equal(Boolean(allowed) && test.schemaValid && producerKeysValid, test.carrierFieldsValid, test.description);
}
for (const name of ['binding-invoker', 'source-inspector', 'interface-synthesizer']) {
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
const coverageReport = compile(synthesizer, synthesizer.schemas.SynthesisCoverage);
let coverageExamples = 0;
for (const test of read('conformance/synthesis-coverage/cases.json').tests) {
  accepts(coverageReport, test.report, test.schemaValid);
  coverageExamples++;
}
assert(coverageExamples > 0, 'no coverage shape examples checked');
const emptyCoverage = { entries: [], exhaustive: true, fullyRepresented: true };
accepts(coverageReport, emptyCoverage);
for (const sourceKeys of [null, 'api', [null], ['']]) {
  accepts(coverageReport, { ...emptyCoverage, sourceKeys }, false);
}
accepts(coverageReport, { ...emptyCoverage, sourceKeys: [] });
accepts(coverageReport, { ...emptyCoverage, sourceKeys: ['api', 'api'] });
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
accepts(coverage, { ...dependency, dependencyKey: 'jobDone' });
accepts(coverage, dependency);
accepts(coverage, { ...dependency, bindingKey: 'b' }, false);
accepts(coverage, { ...dependency, status: 'lossy', reasonCode: 'example.loss', message: 'A dependency projection is incomplete.' });
console.log(`core-alignment: ${contracts.size} structurally conformant documents, ${compiled} contracts compile; carrier, presence, support, invocation shape and coverage controls pass`);
