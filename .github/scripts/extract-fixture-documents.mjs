#!/usr/bin/env node
// Extract only declared OBI carriages, never arbitrary JSON inside kind content.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const destination = process.argv[2];
if (!destination) throw new Error('usage: extract-fixture-documents.mjs <output-directory>');
mkdirSync(destination, { recursive: true });
const read = path => JSON.parse(readFileSync(path, 'utf8'));
let count = 0;
function save(label, document) {
  if (!document || typeof document.openbindings !== 'string') {
    throw new Error(`${label}: missing OBI document`);
  }
  writeFileSync(resolve(destination, `${count++}-${label}.json`), JSON.stringify(document, null, 2) + '\n');
}
for (const file of readdirSync('conformance/selection')) {
  if (!file.endsWith('.json') || file === 'fixture.schema.json') continue;
  for (const test of read(`conformance/selection/${file}`).tests) save('selection', test.document);
}
for (const test of read('conformance/synthesis-coverage/cases.json').tests) save('coverage', test.interface);
for (const entry of read('conformance/comparison/manifest.json').files) {
  const fixture = read(`conformance/comparison/${entry.path}`);
  for (const side of ['left', 'right']) save(`comparison-${side}`, fixture[side]);
}
for (const test of read('conformance/composition/cases.json').cases) {
  save('composition-consumer', test.consumer);
  for (const provider of test.providers) save('composition-provider', provider.interface);
}
for (const test of read('conformance/delegate-manager/admission.json').cases) {
  save('admission-provider', test.interface);
  for (const role of test.roles) {
    for (const expected of role.acceptedInterfaces) save('admission-expected', expected);
  }
}
const examples = read('delegate-manager/examples.json');
save('delegate-expected', examples.expectedInterface);
save('delegate-provider', examples.providerInterface);
console.log(`extracted ${count} embedded documents; conformance/delegate-manager/legacy-location-draft.json is an explicitly historical, pre-kind input`);
