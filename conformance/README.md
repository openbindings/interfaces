# Interfaces Conformance Corpus

Portable test fixtures for the **published contracts' and profiles'** portable, offline-decidable rules. The corpus currently covers operation-invoker binding resolution, interface-synthesizer coverage evidence, and schema-comparison semantics.

The corpus is reference material, not part of any contract: each contract's prose (its README and versioned contract document) is the sole source of conformance, where prose and corpus disagree the prose governs, and a rule without fixtures is no less binding. This mirrors the stance of the spec repository's corpus (`openbindings/spec/conformance`), whose conventions this corpus follows.

## Coverage

| Contract rule family | Coverage |
|---|---|
| operation-invoker: binding resolution (explicit choice, ordered `context.configuration.selection`, sole-candidate inference, ambiguity refusal, candidate-set formation) | **Complete** (`selection/`, one file per rule-cluster). |
| interface-synthesizer: coverage evidence links and derived `fullyRepresented` state | **Complete for format-neutral invariants** (`synthesis-coverage/`); family inventories live in the spec synthesis corpus. |
| schema-comparison profile: normalization, the profile boundary (fail-closed keywords, annotations, boolean forms), directional subsumption, suppression | **Complete** (`comparison/`, manifest-indexed fixtures in four categories). |
| operation-invoker / binding-invoker: frame protocol (first-frame-`open`, single-`open`, input-after-closure, exactly-one-terminal, transport-closure synthesis, discriminator dispatch, `additionalProperties` rejection) | **Deferred by doctrine.** The frame rules are runtime-shaped: fixtures would need a portable frame-sequence format (frames in, frames out, over a live bidirectional channel). Per the same second-implementation doctrine the spec corpus applies to its runtime-shaped tool rules, that format is designed only once a second independent implementation exists to keep it from encoding one implementation's shape — today the frame lanes have one server implementation (ob) and one client (the Go SDK). Behavioral coverage lives in the reference implementations' own suites. |
| Other contracts (binding-invoker resolution, delegate-manager, document-store, ...) | Not yet fixtured; candidates as offline-decidable rules are identified. |

## Binding selection (`selection/`)

Covers the operation-invoker contract's selection rules — its README's "Selects a binding" step and the `invokeOperation` operation's "Binding selection" rule in `operation-invoker/0.1.json`:

- **Candidate set**: the operation's bindings whose governing binding specification the invoker can act on, by exact identifier (`default-supported.json`).
- **Automatic resolution**: a sole invocable candidate is selected; several are refused without consulting preference, deprecation, or ordering metadata (`automatic-resolution.json`).
- **Ordered caller choice**: `context.configuration.selection` selects its first invocable listed binding; an ineffective list does not authorize an invented fallback (`override-selection.json`).
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
      "supported": ["openbindings.openapi@1", "openbindings.grpc@1"],
      "selection": ["getThing.rpc"],
      "binding": "getThing.rpc",
      "expected": { "binding": "getThing.rpc" }
    }
  ]
}
```

Field semantics:

- `document`: a complete, **valid** OpenBindings interface document, embedded inline. Harnesses run it through their implementation's real document validation before selecting; a document that fails validation is a corpus defect, never an expected outcome.
- `operation`: the operation identifier the invocation addresses (key or alias, resolved per OBI-T-12).
- `supported`: the notional invoker's supported set — the exact binding-specification identifiers it can act on, natively or via a delegate. Fixtures use only published identifiers (`openbindings.openapi@1`, `openbindings.grpc@1`, `openbindings.usage@1`, ...); an "unsupported" specification is a published identifier absent from this set, never an invented one.
- `selection` (optional): the ordered `context.configuration.selection` caller choice. Absent or empty makes no choice; if no listed entry is invocable, sole-candidate/ambiguity resolution still applies.
- `binding` (optional): the explicit binding key, the wire contract's binding-addressed form. On the wire `operation` and `binding` are mutually exclusive (the operation is *derived* from an explicit binding); the fixture carries the derived operation key alongside so operation-keyed native APIs can drive the same scenario, with the invariant `document.bindings[binding].operation` = the resolved operation (vacuous for unknown-key fixtures).
- `expected`: either `{ "binding": "<key>" }` or `{ "error": true, "kind": "unknown-binding" | "no-candidate" | "ambiguous" }`. The first two errors use `ERR_BINDING_NOT_FOUND`; ambiguity uses `ERR_BINDING_SELECTION_REQUIRED`.

### Determinism claim

Resolution is deterministic without imposing a preference policy: explicit caller choice wins, a sole candidate is inferable, and ambiguity is refused. Every fixture therefore has exactly one correct outcome.

## Synthesis coverage (`synthesis-coverage/`)

Covers the format-neutral invariants of the interface-synthesizer contract's `synthesizeInterfaceWithCoverage` operation:

- represented evidence names an operation, binding, source, and binding ref that agree with one another in the emitted OBI;
- non-represented evidence carries a stable reason code and explanation;
- `fullyRepresented` is derived rather than asserted: it is true only for exhaustive evidence with no upstream-valid exclusion, lossy projection, or implementation gap;
- non-exhaustive evidence never claims full representation.

[`synthesis-coverage/cases.json`](synthesis-coverage/cases.json) is validated by [`synthesis-coverage/fixture.schema.json`](synthesis-coverage/fixture.schema.json). The corpus does not define a binding family's interaction inventory. That inventory and its representation/exclusion rules belong to the governing binding specification and are exercised by the spec repository's synthesis scenarios.

Coverage evidence is a portable audit record, not a proof that consumers must trust. A consumer may independently inspect the source and compare it with the emitted OBI; the evidence makes that verification easier and makes omissions explicit.

## Schema comparison (`comparison/`)

Covers the [schema-comparison profile](../schema-comparison/) (identifier `OB-2020-12`, version 0.1): normalization, the profile boundary, directional subsumption, and suppression. Unlike `selection/`, this corpus is **manifest-indexed**: harnesses iterate [`comparison/manifest.json`](comparison/manifest.json), never the directory.

```json
{
  "conventionVersion": "1.0",
  "profile": "OB-2020-12",
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

- `mode`: `subsume` pairs operations across the two documents (by key, then across the flat key+aliases namespace, OBI-T-12), runs the profile's directional check on each pair's `direction` schemas, and collapses per-operation verdicts by dominance (`indeterminate` > `incompatible` > `compatible`; a left operation with no pair is incompatible, a right-only operation is compatible). `identical` normalizes both sides' schemas per paired operation and compares RFC 8785 canonical strings (`compatible` asserts identity, `incompatible` asserts difference).
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

- Go SDK: `openbindings-go/selection_corpus_test.go`, `openbindings-go/synthesis_coverage_corpus_test.go`, and `openbindings-go/schemaprofile/conformance_test.go` (sibling path `../interfaces/conformance`)
- TS SDK: `openbindings-ts/packages/sdk/src/selection-corpus.test.ts`, `.../src/synthesis-coverage-corpus.test.ts`, and `.../src/schema-profile/conformance.test.ts` (sibling path from the test file)

## Versioning

Selection fixtures are authored against **operation-invoker contract 0.1**, synthesis-coverage fixtures against **interface-synthesizer contract 0.2**, and comparison fixtures against **schema-comparison profile 0.1**, all against OpenBindings spec **0.2.0** (each fixture document's `openbindings` field). Contract or profile changes that affect the pinned semantics require fixture updates.
