#!/usr/bin/env node
// Offline artifact checks only. This is NOT a Delegate Manager implementation.
// Uses an installed Ajv 8, either resolvable locally or supplied by ajv-cli.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { managementExample } from './management-example.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const read = (path) => JSON.parse(readFileSync(path, 'utf8'));
const document = read(resolve(here, '0.1.json'));
const examples = read(resolve(here, 'examples.json'));
// Immutable pre-migration input: replacing the canonical file must not turn
// old/new comparison into a comparison of the new document with itself.
const original = read(resolve(root, 'conformance/delegate-manager/legacy-location-draft.json'));
const coreSchema = read(resolve(root, '.github/scripts/openbindings.schema.json'));
const require = createRequire(import.meta.url);
let Ajv2020;
try {
  Ajv2020 = require('ajv/dist/2020.js');
} catch {
  const globalRoot = execFileSync('npm', ['root', '--global'], { encoding: 'utf8' }).trim();
  assert(isAbsolute(globalRoot), 'npm must return an absolute global package directory');
  Ajv2020 = createRequire(resolve(globalRoot, 'ajv-cli/package.json'))('ajv/dist/2020.js');
}
const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
const validateOBI = ajv.compile(coreSchema);
let checks = 0;
function check(name, body) {
  body();
  checks++;
  console.log(`ok ${checks} - ${name}`);
}
function valid(validator, value) {
  assert.equal(validator(value), true, JSON.stringify(validator.errors));
}
function invalid(validator, value) {
  assert.equal(validator(value), false, 'expected schema refusal');
}
// The OBI schema graph uses #/schemas. Rehouse that graph only in the temporary
// validation wrapper, never in the actual interface or in any carried value.
function schemaForAjv(value) {
  if (Array.isArray(value)) return value.map(schemaForAjv);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [
      key,
      key === '$ref' && typeof child === 'string' && child.startsWith('#/schemas/')
        ? '#/$defs/' + child.slice('#/schemas/'.length)
        : schemaForAjv(child),
    ]));
  }
  return value;
}
function compile(schema) {
  return ajv.compile({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $defs: schemaForAjv(document.schemas),
    ...schemaForAjv(schema),
  });
}
const op = (name) => document.operations[`openbindings.delegate-manager.${name}`];
const register = compile(op('registerDelegate').input);
const registration = compile(op('registerDelegate').output);
const rolesOutput = compile(op('listRoles').output);
const listInput = compile(op('listDelegates').input);
const listOutput = compile(op('listDelegates').output);
const setPreference = compile(op('setDelegatePreference').input);
const setPreferenceOutput = compile(op('setDelegatePreference').output);
const preferences = compile(document.schemas.DelegateRolePreferences);
const unregister = compile(op('unregisterDelegate').input);
const unregisterOutput = compile(op('unregisterDelegate').output);

const role = {
  id: 'contextStorage',
  description: 'Example application-owned context-storage role; no live implementation.',
  acceptedInterfaces: [examples.expectedInterface],
};
const secondRole = { ...role, id: 'secretsStorage' };
const request = {
  interface: examples.providerInterface,
  roles: [role.id, secondRole.id],
};
const record = { id: 'example-registration-1', ...request, rolePreferences: {} };

// These explicitly test structural prose obligations omitted from the generic
// OpenBindingsInterface carrier. They do not simulate admission or selection.
function expectedInterfaceIsWellFormed(value) {
  return validateOBI(value) && Object.keys(value.operations).length > 0
    && Object.keys(value.bindings ?? {}).length === 0
    && Object.keys(value.dependencies ?? {}).length === 0;
}
function roleSetIsWellFormed(roles) {
  return Array.isArray(roles) && roles.length > 0
    && roles.every((id) => typeof id === 'string' && id.length > 0)
    && new Set(roles).size === roles.length;
}
function preferenceMapIsWellFormed(value, roles) {
  return preferences(value)
    && Object.entries(value).every(([role, preference]) =>
      roles.includes(role) && Number.isFinite(preference));
}

check('complete draft conforms to the Core document schema', () => valid(validateOBI, document));
check('first-version label, with independent Core version', () => {
  assert.equal(document.version, '0.1.0');
  assert.equal(document.openbindings, '0.2.0');
});
check('exact five-operation surface', () => assert.deepEqual(
  Object.keys(document.operations).sort(),
  ['listRoles', 'registerDelegate', 'listDelegates', 'setDelegatePreference', 'unregisterDelegate']
    .map((name) => `openbindings.delegate-manager.${name}`).sort(),
));
check('unbound manager introduces no consumption dependency', () => {
  assert.equal(Object.keys(document.bindings ?? {}).length, 0);
  assert.equal(Object.keys(document.dependencies ?? {}).length, 0);
});
check('OBI carrier agrees with the current invocation interface', () => {
  const invoker = read(resolve(root, 'operation-invoker/0.1.json'));
  assert.deepEqual(document.schemas.OpenBindingsInterface, invoker.schemas.OpenBindingsInterface);
});
check('expected example is a valid unbound OBI', () => {
  valid(validateOBI, examples.expectedInterface);
  assert(expectedInterfaceIsWellFormed(examples.expectedInterface));
});
check('provider example is a valid bound OBI value', () => {
  valid(validateOBI, examples.providerInterface);
  assert.equal(Object.keys(examples.providerInterface.bindings).length, 3);
});
check('empty role catalogue', () => valid(rolesOutput, { roles: [] }));
check('two roles carry actual expected interfaces', () => valid(rolesOutput, { roles: [role, secondRole] }));
check('role rejects empty accepted-interface array', () => invalid(rolesOutput, {
  roles: [{ ...role, acceptedInterfaces: [] }],
}));
check('role rejects locator in place of expected interface', () => invalid(rolesOutput, {
  roles: [{ ...role, acceptedInterfaces: ['https://example.invalid/obi.json'] }],
}));
check('role rejects missing description', () => invalid(rolesOutput, {
  roles: [{ id: role.id, acceptedInterfaces: role.acceptedInterfaces }],
}));
check('expected interface prose check refuses empty operation set', () => assert.equal(
  expectedInterfaceIsWellFormed({ openbindings: '0.2.0', operations: {} }), false,
));
check('expected interface prose check refuses provider bindings', () => assert.equal(
  expectedInterfaceIsWellFormed(examples.providerInterface), false,
));
check('expected interface prose check refuses consumption declarations', () => assert.equal(
  expectedInterfaceIsWellFormed({
    ...examples.expectedInterface,
    dependencies: { read: { operation: 'openbindings.document-store.get' } },
  }), false,
));
check('one interface may enroll in multiple roles', () => valid(register, request));
check('known-ID re-enrollment has the same complete input shape', () => valid(register, { id: record.id, ...request }));
check('new enrollment can carry independent role preferences atomically', () => valid(register, {
  ...request, rolePreferences: { contextStorage: 20, secretsStorage: -10.5 },
}));
check('re-enrollment may omit the preference map', () => valid(register, { id: record.id, ...request }));
check('re-enrollment accepts an explicit empty preference map', () => valid(register, {
  id: record.id, ...request, rolePreferences: {},
}));
check('global registration preference is rejected', () => invalid(register, { ...request, preference: 20 }));
check('null is not a whole preference map', () => invalid(register, { ...request, rolePreferences: null }));
check('null preference entries are rejected; omit an entry in a full map', () => invalid(register, {
  ...request, rolePreferences: { contextStorage: null },
}));
check('string preference entries are rejected', () => invalid(register, {
  ...request, rolePreferences: { contextStorage: 'high' },
}));
check('preference-map prose check permits distinct enrolled role values', () => assert(
  preferenceMapIsWellFormed({ contextStorage: 20, secretsStorage: -10.5 }, request.roles),
));
check('preference-map prose check rejects unrequested roles', () => assert.equal(
  preferenceMapIsWellFormed({ invocation: 100 }, request.roles), false,
));
check('preference-map prose check rejects non-finite in-memory values', () => {
  for (const value of [Infinity, -Infinity, NaN]) {
    assert.equal(preferenceMapIsWellFormed({ contextStorage: value }, request.roles), false);
  }
});
check('old locator/preference request is rejected', () => invalid(register, {
  location: 'https://example.invalid/obi.json', preference: 1,
}));
check('contract field is not part of the new input', () => invalid(register, { ...request, contract: 'documentStore' }));
check('location field is not part of the new input', () => invalid(register, { ...request, location: 'https://example.invalid' }));
check('supplied interface is an object, not a string locator', () => invalid(register, { ...request, interface: 'https://example.invalid/obi.json' }));
check('missing interface is rejected', () => invalid(register, { roles: request.roles }));
check('missing roles are rejected', () => invalid(register, { interface: request.interface }));
check('empty roles are rejected', () => invalid(register, { ...request, roles: [] }));
check('empty role identifier is rejected', () => invalid(register, { ...request, roles: [''] }));
check('old singular-role input is rejected', () => invalid(register, { interface: request.interface, role: role.id }));
check('role-set prose check rejects duplicates', () => assert.equal(roleSetIsWellFormed([role.id, role.id]), false));
check('role-set prose check accepts reordered distinct roles', () => assert(roleSetIsWellFormed([...request.roles].reverse())));
check('registration output contains actual interface and memberships', () => valid(registration, record));
check('registration output is extensible', () => valid(registration, { ...record, diagnostic: 'example only' }));
check('registration output requires its complete explicit preference map', () => invalid(registration, {
  id: record.id, ...request,
}));
check('explicit zero and absent entries are both representable without conflation', () => {
  valid(registration, record);
  valid(registration, { ...record, rolePreferences: { contextStorage: 0 } });
});
check('old summary is not a new registration', () => invalid(registration, {
  location: 'https://example.invalid/obi.json', operations: ['example.read'],
}));
check('unfiltered list input', () => valid(listInput, {}));
check('role-filtered list input', () => valid(listInput, { role: role.id }));
check('unknown list filter input is rejected', () => invalid(listInput, { operation: 'example.read' }));
check('empty registration list', () => valid(listOutput, { delegates: [] }));
check('five candidates in one role are representable', () => valid(listOutput, {
  delegates: Array.from({ length: 5 }, (_, index) => ({ ...record, id: `example-${index}`, roles: [role.id] })),
}));
check('same document can have two independent registration identities', () => valid(listOutput, {
  delegates: [record, { ...record, id: 'example-registration-2', roles: [role.id] }],
}));
check('opposite preferences across two roles remain independently representable', () => valid(listOutput, {
  delegates: [
    { ...record, rolePreferences: { contextStorage: 20, secretsStorage: 0 } },
    { ...record, id: 'example-registration-2', rolePreferences: { contextStorage: 10, secretsStorage: 30 } },
  ],
}));
check('setting a preference requires registration, role, and number or null', () => {
  for (const preference of [20, 0, -10.5, null]) {
    valid(setPreference, { id: record.id, role: role.id, preference });
  }
});
check('set preference rejects missing required fields', () => {
  const input = { id: record.id, role: role.id, preference: 1 };
  for (const key of ['id', 'role', 'preference']) {
    invalid(setPreference, Object.fromEntries(Object.entries(input).filter(([name]) => name !== key)));
  }
});
check('set preference rejects empty identifiers', () => {
  invalid(setPreference, { id: '', role: role.id, preference: 1 });
  invalid(setPreference, { id: record.id, role: '', preference: 1 });
});
check('set preference rejects old location and per-operation targeting', () => {
  invalid(setPreference, { location: 'https://example.invalid/obi.json', preference: 1 });
  invalid(setPreference, { id: record.id, role: role.id, operation: 'example.read', preference: 1 });
});
check('set preference rejects non-numeric non-null values', () => {
  for (const preference of ['high', true, {}, []]) {
    invalid(setPreference, { id: record.id, role: role.id, preference });
  }
});
check('successful preference mutation returns null', () => valid(setPreferenceOutput, null));
check('preference output rejects invented selection decision', () => invalid(setPreferenceOutput, { selected: record.id }));
check('removal is ID-addressed', () => valid(unregister, { id: record.id }));
check('old location-addressed removal is rejected', () => invalid(unregister, { location: 'https://example.invalid/obi.json' }));
check('successful removal returns null', () => valid(unregisterOutput, null));
check('removal output rejects invented success object', () => invalid(unregisterOutput, { removed: true }));
check('reads, preference setting, and removal claim idempotence; enrollment does not', () => {
  assert.equal(op('listRoles').idempotent, true);
  assert.equal(op('listDelegates').idempotent, true);
  assert.equal(op('unregisterDelegate').idempotent, true);
  assert.equal(op('setDelegatePreference').idempotent, true);
  assert.equal(op('registerDelegate').idempotent, undefined);
});
check('baseline still has its locator-based input', () => assert(
  original.operations['openbindings.delegate-manager.registerDelegate'].input.properties.location,
));

// Validate the documented transcript's actual inputs/results and its explicit
// expected snapshots. This checks the example, NOT a manager state machine.
const exampleStep = (name) => {
  const step = managementExample.find((entry) => entry.step === name);
  assert(step, `missing management example step ${name}`);
  return step;
};
check('management example has a unique, ordered ten-step lifecycle', () => assert.deepEqual(
  managementExample.map((step) => step.step),
  ['discover', 'enroll', 'preferA', 'zeroB', 'inspectPreferences', 'reenroll', 'clearB', 'inspectB', 'remove', 'inspectEmpty'],
));
for (const step of managementExample) {
  check(`management example ${step.step}: input and output conform to the operation`, () => {
    const operation = document.operations[step.operation];
    assert(operation, `unknown operation ${step.operation}`);
    if (Object.hasOwn(step, 'input')) {
      assert(Object.hasOwn(operation, 'input'));
      valid(compile(operation.input), step.input);
    } else {
      assert.equal(step.step, 'discover');
    }
    valid(compile(operation.output), step.output);
  });
}
check('management role discovery carries actual complete unbound expected OBIs', () => {
  const discovered = exampleStep('discover').output.roles;
  assert.deepEqual(discovered.map((entry) => entry.id), ['A', 'B', 'C']);
  for (const entry of discovered) {
    assert.deepEqual(entry.acceptedInterfaces, [examples.expectedInterface]);
    assert(expectedInterfaceIsWellFormed(entry.acceptedInterfaces[0]));
  }
});
check('management enrollment retains the full supplied provider OBI and starts with no explicit preferences', () => {
  const { input, output } = exampleStep('enroll');
  valid(validateOBI, input.interface);
  assert.deepEqual(input.interface, examples.providerInterface);
  assert.deepEqual(output, { id: 'r1', ...input, rolePreferences: {} });
});
check('management inspection retains explicitly supplied zero alongside a different role preference', () => {
  const inspected = exampleStep('inspectPreferences').output.delegates[0];
  const a = exampleStep('preferA').input;
  const b = exampleStep('zeroB').input;
  assert.equal(b.preference, 0);
  assert.deepEqual(inspected.rolePreferences, { [a.role]: a.preference, [b.role]: b.preference });
  assert(Object.hasOwn(inspected.rolePreferences, 'B'));
});
check('management re-enrollment preserves only retained-role preferences when the map is omitted', () => {
  const before = exampleStep('inspectPreferences').output.delegates[0];
  const { input, output } = exampleStep('reenroll');
  assert.equal(Object.hasOwn(input, 'rolePreferences'), false);
  assert.deepEqual(input.roles, ['B', 'C']);
  assert.equal(output.id, before.id);
  assert.deepEqual(output.interface, before.interface);
  assert.deepEqual(output.roles, input.roles);
  const retained = Object.fromEntries(Object.entries(before.rolePreferences)
    .filter(([role]) => input.roles.includes(role)));
  assert.deepEqual(output.rolePreferences, retained);
  assert.deepEqual(output.rolePreferences, { B: 0 });
  assert.equal(Object.hasOwn(output.rolePreferences, 'A'), false);
  assert.equal(Object.hasOwn(output.rolePreferences, 'C'), false);
});
check('management clear and role-filtered listing preserve all memberships and the OBI', () => {
  assert.deepEqual(exampleStep('clearB').input, { id: 'r1', role: 'B', preference: null });
  const before = exampleStep('reenroll').output;
  const inspected = exampleStep('inspectB').output.delegates[0];
  assert.deepEqual(inspected, { ...before, rolePreferences: {} });
  assert(inspected.roles.includes(exampleStep('inspectB').input.role));
});
check('management removal is followed by an empty registration list', () => {
  assert.deepEqual(exampleStep('remove').input, { id: 'r1' });
  assert.deepEqual(exampleStep('inspectEmpty').output, { delegates: [] });
});
check('all management registration snapshots obey role-set and preference-map prose constraints', () => {
  for (const step of managementExample) {
    const records = step.operation.endsWith('.registerDelegate')
      ? [step.output] : (step.output?.delegates ?? []);
    for (const entry of records) {
      assert(roleSetIsWellFormed(entry.roles));
      assert(preferenceMapIsWellFormed(entry.rolePreferences, entry.roles));
      assert.deepEqual(entry.interface, examples.providerInterface);
    }
  }
});

const admission = read(resolve(root, 'conformance/delegate-manager/admission.json'));
const admissionSchema = ajv.compile(read(resolve(root, 'conformance/delegate-manager/fixture.schema.json')));
check('portable admission fixture structure and unique case IDs', () => {
  valid(admissionSchema, admission);
  assert.equal(new Set(admission.cases.map((test) => test.id)).size, admission.cases.length);
});
for (const test of admission.cases) {
  check(`admission case ${test.id}: complete valid embedded OBIs and role expectations`, () => {
    valid(validateOBI, test.interface);
    for (const expectedRole of test.roles) {
      for (const expectedInterface of expectedRole.acceptedInterfaces) {
        assert(expectedInterfaceIsWellFormed(expectedInterface));
      }
    }
  });
}
console.log(`PASS: ${checks} artifact/schema/example checks. No runtime admission, selection, mutation, or invocation was exercised.`);
