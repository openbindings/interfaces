# Interfaces Conformance Corpus

Portable test fixtures for the **published contracts' and profiles'** portable, offline-decidable rules. The corpus currently covers authoritative kind support queries, operation-invoker binding resolution, runtime interface composition, interface-synthesizer coverage evidence, and schema-comparison semantics.

The corpus is reference material. Interface examples illustrate published value
shapes and capability meanings, not required internal implementations or recovery
policies. Separately identified profiles and SDK policies have their own scope.
Passing examples is not proof of a producer's behavioral claims.

## Coverage

| Contract rule family | Coverage |
|---|---|
| binding-invoker / interface-synthesizer: authoritative kind support (exact matching, deduplication, first-occurrence order, strict verdicts, listed-subset warrant) | **Complete** (`kind-support/`). |
| operation-invoker: binding resolution (explicit choice, ordered `selection`, sole-candidate inference, ambiguity refusal, candidate-set formation) | **Complete** (`selection/`, one file per rule-cluster). |
| SDK reference runtime composition policy: correspondence, tri-state contract evidence, hard binding-spec constraints, provider election, and realization ambiguity | **Initial portable decision corpus** (`composition/cases.json`); executed byte-for-byte by the Go and TypeScript SDKs. |
| interface-synthesizer: coverage output shapes, optional attribution and permitted variation | **Shape examples** (`synthesis-coverage/`); no prescribed SDK checker or recovery policy. |
| schema-comparison profile: normalization, the profile boundary (fail-closed keywords, annotations, boolean forms), directional subsumption, suppression, exact values | Legacy cases plus the required JSON-text exact-value pack in `comparison/`. Whole-profile implementation qualification requires both packs against the identified implementation revision. |
| operation-invoker / binding-invoker: frame message shapes and exchange meanings | Schema controls here; buffer, cancellation-race and malformed-input policies are tested by implementations. |
| delegate-manager: role-scoped by-value admission and management transcript | **Initial fixture definitions** (`delegate-manager/`); artifact checks validate structure, not a runtime implementation. |
| Other contracts (binding-invoker resolution, document-store, ...) | Not yet fixtured; candidates as offline-decidable rules are identified. |

## Kind support (`kind-support/`)

Covers the shared `checkKindSupport` semantics in binding-invoker 0.1 and
interface-synthesizer 0.2 and source-inspector 0.1. Each case declares the implementation's exact
`warranted` set, its advisory `listed` subset, the input tokens, and the
ordered verdicts. The fixtures pin empty input, first-occurrence
deduplication, exact-match refusal of prefix-adjacent tokens, strict boolean
answers, and the law `listed ⊆ warranted`.

The fixture's `warranted` array models the kinds the implementation
has actually implemented; it is not a pattern language. A harness compares
tokens by exact string equality. `listed` is deliberately allowed to omit
warranted identifiers because absence from the advisory list carries no
information.

## Binding selection (`selection/`)

Covers the operation-invoker contract's selection rules — its README's "Selects a binding" step and the `invokeOperation` operation's "Binding selection" rule in `operation-invoker/0.1.json`:

- **Candidate set**: the operation's bindings whose sources have kinds the invoker can act on, by exact identifier (`default-supported.json`).
- **Automatic resolution**: a sole invocable candidate is selected; several are refused without consulting preference, deprecation, or ordering metadata (`automatic-resolution.json`).
- **Ordered caller choice**: `selection` selects its first invocable listed binding; a listed key that names no binding of the operation, or a list with no invocable entry, is `ERR_BINDING_NOT_FOUND`, never a fallback (`override-selection.json`).
- **Explicit `binding` key**: bypasses other resolution; unknown key is an error (`explicit-binding.json`).
- **Failure**: no invocable binding uses `ERR_BINDING_NOT_FOUND`; ambiguity uses `ERR_BINDING_SELECTION_REQUIRED`.

### Fixture file format

One file per rule-cluster, validated by [`selection/fixture.schema.json`](selection/fixture.schema.json) (JSON Schema 2020-12; CI validates every fixture against it). Each file:

```json
{
  "cluster": "default-tier",
  "description": "The rule-cluster, byte-faithful to the contract prose.",
  "tests": [
    {
      "description": "specific scenario this case exercises",
      "document": { "openbindings": "0.2.0", "operations": { "getThing": {} }, "...": "..." },
      "operation": "getThing",
      "supported": ["openbindings.openapi-3.1@1", "openbindings.grpc@1"],
      "selection": ["getThing.rpc"],
      "expected": { "binding": "getThing.rpc" }
    }
  ]
}
```

Field semantics:

- `document`: a complete, **valid** OpenBindings interface document, embedded inline. Harnesses run it through their implementation's real document validation before selecting; a document that fails validation is a corpus defect, never an expected outcome.
- `operation`: the operation identifier the invocation addresses (key or alias; core §5.1 defines which operation it identifies).
- `supported`: the notional invoker's supported set — the exact kinds it can act on, natively or via a delegate. The current fixtures use the project's unreleased first-candidate identifiers (`openbindings.openapi-3.1@1`, `openbindings.grpc@1`, `openbindings.usage@1`, ...); an "unsupported" kind is a real candidate identifier absent from this set, never an invented one.
- `selection` (optional): the invocation input's ordered `selection`, a nonempty list of binding keys. Every key must name one of the operation's bindings; the first invocable one wins; a list with no invocable entry is an error, never a fallback. Never present together with `binding`.
- `binding` (optional): the explicit binding key, the wire contract's binding-addressed form. On the wire `operation` and `binding` are mutually exclusive (the operation is *derived* from an explicit binding); the fixture carries the derived operation key alongside so operation-keyed native APIs can drive the same scenario, with the invariant `document.bindings[binding].operation` = the resolved operation (vacuous for unknown-key fixtures).
- `expected`: either `{ "binding": "<key>" }` or `{ "error": true, "kind": "unknown-binding" | "no-candidate" | "ambiguous" }`. `unknown-binding` is a named key (explicit or listed) that names no binding of the operation; `no-candidate` is no invocable binding among those allowed. Both use `ERR_BINDING_NOT_FOUND`; ambiguity uses `ERR_BINDING_SELECTION_REQUIRED`.

### Determinism claim

Resolution is deterministic without imposing a preference policy: explicit caller choice wins, a sole candidate is inferable, and ambiguity is refused. Every fixture therefore has exactly one correct outcome.

## Synthesis coverage (`synthesis-coverage/`)

The `openbindings.interface-synthesis-shape-cases@1` examples carry a report and
its `schemaValid` result. They include absent optional attribution, repeated rows,
unbound operation declarations, additional report fields and malformed field types.
The repository evaluates the report schema; it does not emulate a synthesis
provider or require a consumer to reject any schema failure.

The previous 26 SDK checker cases remain in the Rust SDK as
`openbindings.sdk-synthesis-policy-cases@1`. Their duplicate refusal, exact
dependency correspondence, strict eligibility, source preservation and operation
path checks are SDK policy regressions, not requirements of this interface.

## Runtime composition (`composition/`)

[`composition/cases.json`](composition/cases.json), validated by
[`composition/fixture.schema.json`](composition/fixture.schema.json), pins the
observable decisions of `openbindings.reference-composition@1`. Each case
contains a complete consumer OBI, application-owned provider registrations,
the kinds each provider's runtime supports, one dependency
key, and the expected route-to-one status. Available cases additionally pin the
provider and binding identity; ambiguous cases pin the provider-versus-
realization stage; unavailable cases pin ordered stable assessment codes.

A name or alias correspondence is the provider's compatibility claim (core
§5.1 calls it the correspondence claim). The policy sets a candidate aside only
when the comparison profile proves a contradiction of that claim
(`contract_incompatible`); a differing keyword the profile cannot read leaves
the claim standing, so there is no indeterminate composition state and the
profile's evidence rides the resolved route for inspection.

The policy is an SDK convention rather than a Core specification semantic.
Putting it here prevents the two reference SDKs from drifting while keeping
third-party policies free to make different, explicitly identified decisions.

## Schema comparison (`comparison/`)

This is **comparison-profile conformance**, not general Core or binding-spec
conformance. Any implementer may adopt the profile; a tool not claiming it is
not assessed against this suite. The official SDKs also use selected fixture
inputs for separately named snapshot/value-carriage qualification tests. Those
tests exercise SDK implementation commitments, not new Core requirements.
Neither suite alone qualifies all SDK invocation, storage or transform paths.

The manifest's required `exactValues` entry names `exact-values.json`, validated
by `exact-values.schema.json`. This is a second fixture **carriage**, not a
second profile or precision mode. Each case carries complete OBI documents as
`leftJSON`/`rightJSON` strings and optionally a validation witness as JSON text.
Readers parse the envelope normally, but decode these texts without reducing
numeric tokens before the production comparison/validation call. Sorted
`numberTokens` lists witness the ingress values, excluding digits in strings;
`-0` and `0` may normalize to the same zero. Missing/extra tokens are harness
failures. The `rule` and authored expected verdict/error explain the oracle;
agreement between SDKs is never the oracle. A witness proves the stated point
membership, not general subsumption by itself.

Both the existing manifest cases and the exact-value pack must run for a
whole-profile claim. Explicit refusals on required exact cases are unmet
profile capability, not passing outside-keyword cases. Runtime gaps remain
real test failures; do not skip or round fixtures to obtain a green gate.
`reason` assertions are the official SDKs' extra diagnostic alignment bar;
`leftUnionConstOrder` exercises the profile's authored traversal order. Schema
merge errors are distinct from the three comparison verdicts.

Covers the [schema-comparison profile](../schema-comparison/) (identifier `OB-2020-12`, version 0.1): normalization, the profile boundary, directional subsumption, and suppression. Unlike `selection/`, this corpus is **manifest-indexed**: harnesses iterate [`comparison/manifest.json`](comparison/manifest.json), never the directory.

```json
{
  "conventionVersion": "1.0",
  "profile": "OB-2020-12",
  "exactValues": "exact-values.json",
  "files": [
    { "path": "subsumption/type-sets-input-compatible.json",
      "mode": "subsume", "direction": "input",
      "verdict": "compatible", "findings": [] }
  ]
}
```

Each fixture file embeds a **left** (target/contract) and **right** (candidate) OpenBindings interface document and the expected collapsed verdict:

```json
{
  "version": "1.0",
  "description": "the rule this fixture pins",
  "mode": "subsume",
  "options": { "profile": "OB-2020-12" },
  "left":  { "openbindings": "0.2.0", "operations": { "...": {} } },
  "right": { "openbindings": "0.2.0", "operations": { "...": {} } },
  "expected": { "summary": { "verdict": "compatible" } }
}
```

Field semantics:

- `mode`: `subsume` pairs operations across the two documents (by key, then across the flat key+aliases namespace, core §5.1), runs the profile's directional check on each pair's `direction` schemas, and collapses per-operation verdicts by dominance (`indeterminate` > `incompatible` > `compatible`; a left operation with no pair is incompatible, a right-only operation is compatible). `identical` compares normalized structure using exact instance equality and the profile's schema-union permutation rule (`compatible` asserts identity, `incompatible` asserts difference); no JCS prerequisite applies.
- `direction`: which operation schema slot (`input` or `output`) the fixture compares, carried in the manifest entry.
- Operation schemas may use the **object form**, the **boolean form** (`true`/`false`, compared via their object spellings per the profile), or be **absent** — absent means unspecified, and the slot's comparison is skipped (the profile's suppression rule).
- `verdict` / `expected.summary.verdict`: the outcome a conforming implementation must reach; the two must agree (harnesses check this).
- `findings`: informative labels for the deciding rule families (`type`, `enum`, `outside-profile`, ...); harnesses assert verdicts, not findings.

Fixture categories, one directory per family: `profile/` (the profile boundary: fail-closed keywords, annotations, extensions, boolean `false`), `structural/` (normalization equivalence via identical mode; operation pairing, removal, verdict collapse), `subsumption/` (the directional input/output rules), `suppression/` (situations where the profile deliberately reports no finding).

Two schemas validate the corpus in CI: [`comparison/manifest.schema.json`](comparison/manifest.schema.json) and [`comparison/fixture.schema.json`](comparison/fixture.schema.json); embedded documents are additionally validated against the OBI meta-schema, and manifest/fixture verdict agreement plus path completeness are checked.

One known format limit: fixture format 1.0 expresses exactly three verdicts (`compatible`, `incompatible`, `indeterminate`), so the profile's **schema error** outcome — an unsatisfiable `allOf` merge, which per the profile is neither a compatible nor an incompatible verdict — is not corpus-expressible. That lane is pinned by mirrored unit tests in the two reference SDK suites; a fixture-format bump adding an error verdict is deferred until a second error-semantics rule needs it.

Like selection, every fixture has exactly one correct outcome: the profile is pure and deterministic.

## How implementations locate the corpus

Same convention as the spec corpus: a harness looks for a **sibling checkout** of this repository (`openbindings/interfaces` next to the implementation's own checkout) and skips its corpus suite when absent; the environment variable **`OB_INTERFACES_CORPUS`** overrides the location and points at this `conformance/` directory. Reference harnesses:

- Go SDK: `openbindings-go/selection_corpus_test.go`, `openbindings-go/synthesis_coverage_corpus_test.go`, `openbindings-go/invoke/composition_corpus_test.go`, and `openbindings-go/schemaprofile/conformance_test.go` (sibling path `../interfaces/conformance`)
- TS SDK: `openbindings-ts/packages/sdk/src/selection-corpus.test.ts`, `.../src/synthesis-coverage-corpus.test.ts`, `packages/invoke/src/composition-corpus.test.ts`, and `.../src/schema-profile/conformance.test.ts` (sibling path from the test file)

## Versioning

Selection fixtures are authored against **operation-invoker contract 0.1**, synthesis output examples against **interface-synthesizer contract 0.2**, and comparison fixtures against **schema-comparison profile 0.1**, all against OpenBindings spec **0.2.0** (each fixture document's `openbindings` field). Contract or profile changes that affect the pinned semantics require fixture updates.

## Carried values (`carried-values/`)

Carrier examples distinguish schema acceptance from membership in the core
carrier field set. `carrierFieldsValid` records the latter, not a refusal rule.
The SDK may reject malformed carriers before work; another implementation chooses
its own handling. Such handling does not change core document conformance.

Coverage examples use a fixture-only kind. Its labels and content are examples,
not OpenAPI semantics. Schema checks do not prove source correspondence.
The extractor also validates the embedded OBI document shapes and canonical order.
