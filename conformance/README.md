# Interfaces Conformance Corpus

Portable test fixtures for the **published interface contracts'** portable, offline-decidable rules. Today that is one rule family: the [operation-invoker](../operation-invoker/) contract's **binding selection** (`conformance/selection/`).

The corpus is reference material, not part of any contract: each contract's prose (its README and versioned contract document) is the sole source of conformance, where prose and corpus disagree the prose governs, and a rule without fixtures is no less binding. This mirrors the stance of the spec repository's corpus (`openbindings/spec/conformance`), whose conventions this corpus follows.

## Coverage

| Contract rule family | Coverage |
|---|---|
| operation-invoker: binding selection (default policy, `context.configuration.selection` override, explicit-`binding` bypass, candidate-set formation, no-candidate failure) | **Complete** (`selection/`, one file per rule-cluster). |
| operation-invoker / binding-invoker: frame protocol (first-frame-`open`, single-`open`, input-after-closure, exactly-one-terminal, transport-closure synthesis, discriminator dispatch, `additionalProperties` rejection) | **Deferred by doctrine.** The frame rules are runtime-shaped: fixtures would need a portable frame-sequence format (frames in, frames out, over a live bidirectional channel). Per the same second-implementation doctrine the spec corpus applies to its runtime-shaped tool rules, that format is designed only once a second independent implementation exists to keep it from encoding one implementation's shape — today the frame lanes have one server implementation (ob) and one client (the Go SDK). Behavioral coverage lives in the reference implementations' own suites. |
| Other contracts (binding-invoker resolution, delegate-manager, key-value-store, ...) | Not yet fixtured; candidates as offline-decidable rules are identified. |

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

## How implementations locate the corpus

Same convention as the spec corpus: a harness looks for a **sibling checkout** of this repository (`openbindings/interfaces` next to the implementation's own checkout) and skips its corpus suite when absent; the environment variable **`OB_INTERFACES_CORPUS`** overrides the location and points at this `conformance/` directory. Reference harnesses:

- Go SDK: `openbindings-go/selection_corpus_test.go` (sibling path `../interfaces/conformance`)
- TS SDK: `openbindings-ts/packages/sdk/src/selection-corpus.test.ts` (sibling path `../../../../interfaces/conformance` from the test file)

## Versioning

Fixtures are authored against **operation-invoker contract 0.1** and OpenBindings spec **0.2.0** (each fixture document's `openbindings` field). Contract changes that affect selection semantics require fixture updates.
