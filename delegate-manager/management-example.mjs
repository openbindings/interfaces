// Data transcript for the README's worked management sequence.
// No manager is implemented, no operation is invoked, and no provider is fetched.
// P and E below are actual OBI objects reused to keep the transcript readable;
// they are never strings or locator fields in the operation inputs/results.
import { readFileSync } from 'node:fs';

const examples = JSON.parse(readFileSync(new URL('./examples.json', import.meta.url), 'utf8'));
const E = examples.expectedInterface;
const P = examples.providerInterface;
const r1 = { id: 'r1', interface: P, roles: ['A', 'B'], rolePreferences: {} };
const preferred = { ...r1, rolePreferences: { A: 20, B: 0 } };
const reenrolled = { ...r1, roles: ['B', 'C'], rolePreferences: { B: 0 } };
const cleared = { ...reenrolled, rolePreferences: {} };

const roles = [
  { id: 'A', purpose: 'context storage' },
  { id: 'B', purpose: 'secrets storage' },
  { id: 'C', purpose: 'template storage' },
].map(({ id, purpose }) => ({
  id,
  description: `Illustrative ${purpose} responsibility. Admission requires separately established role configuration and operational qualifications. Registrations are candidates, not active storage assignments. In this example preferences inform new namespace assignments, with ties resolved by explicit administrator choice; existing assignments keep their provider. No built-in fallback is configured. Provider replacement requires explicit cutover; missing or unavailable assigned providers fail the workload rather than reroute it.`,
  acceptedInterfaces: [E],
}));

export const managementExample = [
  {
    step: 'discover',
    operation: 'openbindings.delegate-manager.listRoles',
    output: { roles },
  },
  {
    step: 'enroll',
    operation: 'openbindings.delegate-manager.registerDelegate',
    input: { interface: P, roles: ['A', 'B'] },
    output: r1,
  },
  {
    step: 'preferA',
    operation: 'openbindings.delegate-manager.setDelegatePreference',
    input: { id: 'r1', role: 'A', preference: 20 },
    output: null,
  },
  {
    step: 'zeroB',
    operation: 'openbindings.delegate-manager.setDelegatePreference',
    input: { id: 'r1', role: 'B', preference: 0 },
    output: null,
  },
  {
    step: 'inspectPreferences',
    operation: 'openbindings.delegate-manager.listDelegates',
    input: {},
    output: { delegates: [preferred] },
  },
  {
    step: 'reenroll',
    operation: 'openbindings.delegate-manager.registerDelegate',
    input: { id: 'r1', interface: P, roles: ['B', 'C'] },
    output: reenrolled,
  },
  {
    step: 'clearB',
    operation: 'openbindings.delegate-manager.setDelegatePreference',
    input: { id: 'r1', role: 'B', preference: null },
    output: null,
  },
  {
    step: 'inspectB',
    operation: 'openbindings.delegate-manager.listDelegates',
    input: { role: 'B' },
    output: { delegates: [cleared] },
  },
  {
    step: 'remove',
    operation: 'openbindings.delegate-manager.unregisterDelegate',
    input: { id: 'r1' },
    output: null,
  },
  {
    step: 'inspectEmpty',
    operation: 'openbindings.delegate-manager.listDelegates',
    input: {},
    output: { delegates: [] },
  },
];
