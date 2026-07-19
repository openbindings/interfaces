# Interfaces Conformance Corpus

Portable test fixtures for the **published contracts' and profiles'** portable, offline-decidable rules. Today that is two rule families: the [operation-invoker](../operation-invoker/) contract's **binding selection** (`conformance/selection/`) and the [schema-comparison](../schema-comparison/) profile's **comparison semantics** (`conformance/comparison/`).

The corpus is reference material, not part of any contract: each contract's prose (its README and versioned contract document) is the sole source of conformance, where prose and corpus disagree the prose governs, and a rule without fixtures is no less binding. This mirrors the stance of the spec repository's corpus (`openbindings/spec/conformance`), whose conventions this corpus follows.

## Coverage

| Contract rule family | Coverage |
|---|---|
| operation-invoker: binding selection (default policy, `context.configuration.selection` override, explicit-`binding` bypass, candidate-set formation, no-candidate failure) | **Complete** (`selection/`, one file per rule-cluster). |
| schema-comparison profile: normalization, the profile boundary (fail-closed keywords, annotations, boolean forms), directional subsumption, suppression | **Complete** (`comparison/`, manifest-indexed fixtures in four categories). |
| operation-invoker / binding-invoker: frame protocol (first-frame-`open`, single-`open`, input-after-closure, exactly-one-terminal, transport-closure synthesis, discriminator dispatch, `additionalProperties` rejection) | **Deferred by doctrine.** The frame rules are runtime-shaped: fixtures would need a portable frame-sequence format (frames in, frames out, over a live bidirectional channel). Per the same second-implementation doctrine the spec corpus applies to its runtime-shaped tool rules, that format is designed only once a second independent implementation exists to keep it from encoding one implementation's shape — today the frame lanes have one server implementation (ob) and one client (the Go SDK). Behavioral coverage lives in the reference implementations' own suites. |
| Other contracts (binding-invoker resolution, delegate-manager, document-store, ...) | Not yet fixtured; candidates as offline-decidable rules are identified. |

## Binding selection (`selection/`)

Covers the operation-invoker contract's selection rules — its README's "Selects a binding" step and the `invokeOperation` operation's "Binding selection" rule in `operation-invoker/0.1.json`:

- **Candidate set**: the operation's bindings whose governing binding specification the invoker can act on, by exact identifier (`default-supported.json`).
- **Default policy**, deterministic to the last step: non-deprecated before deprecated (`default-tier.json`) → higher declared `preference` first, undeclared below every declared value (`default-preference.json`) → lexicographic binding key (`default-tiebreak.json`).
- **Consumer override**: `context.configuration.selection`, an ordered list of binding keys, first invocable entry wins, default policy when none is (`override-selection.json`).
- **Explicit `binding` key**: bypasses selection entirely; unknown key is an error (`explicit-binding.json`).
- **Failure**: when no invocable binding exists, the contract requires a terminal error with code `ERR_BINDING_NOT_FOUND`.

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
- `selection` (optional): the `context.configuration.selection` consumer override. Absent means no override configured; `[]` configures an override with no invocable entry (falls through to the default policy).
- `binding` (optional): the explicit binding key, the wire contract's binding-addressed form. On the wire `operation` and `binding` are mutually exclusive (the operation is *derived* from an explicit binding); the fixture carries the derived operation key alongside so operation-keyed native APIs can drive the same scenario, with the invariant `document.bindings[binding].operation` = the resolved operation (vacuous for unknown-key fixtures).
- `expected`: either `{ "binding": "<key>" }` (the selected binding key) or `{ "error": true, "kind": "unknown-binding" | "no-candidate" }`. Both error kinds surface as a terminal error with code `ERR_BINDING_NOT_FOUND` (a contract-named, normative-where-named code); `kind` records which rule failed, for harness reporting.

Binding keys in fixtures are ASCII, where byte order, Unicode code-point order, and UTF-16 code-unit order coincide, so "lexicographic" is unambiguous across host languages.

### Determinism claim

The contract's policy is deterministic: the same document, the same supported set, and the same configuration select the same binding on every conforming implementation. Every fixture in this corpus therefore has exactly one correct outcome — there are no implementation-defined results to allow for.

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

- Go SDK: `openbindings-go/selection_corpus_test.go` and `openbindings-go/schemaprofile/conformance_test.go` (sibling path `../interfaces/conformance`)
- TS SDK: `openbindings-ts/packages/sdk/src/selection-corpus.test.ts` and `.../src/schema-profile/conformance.test.ts` (sibling path from the test file)

## Versioning

Selection fixtures are authored against **operation-invoker contract 0.1**, comparison fixtures against **schema-comparison profile 0.1**, both against OpenBindings spec **0.2.0** (each fixture document's `openbindings` field). Contract or profile changes that affect the pinned semantics require fixture updates.
