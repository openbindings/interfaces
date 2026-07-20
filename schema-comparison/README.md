# Schema Comparison Profile

The comparison semantics for deciding whether one JSON Schema can stand in for another — normalization, structural comparison, directional subsumption, and finding suppression — published so independent implementations can produce agreeing verdicts on the same pair of schemas. This is the decision procedure behind interface compatibility checking (which conformant implementations are catalogued under [Reference implementations](#reference-implementations)). Conformance here is claimed and versioned independently of core OpenBindings conformance — the core specification deliberately does not define schema comparison (matching, comparison, and selection are tool-defined per its [Scope principle](https://github.com/openbindings/spec/blob/main/openbindings.md#13-authority-and-deferral)), so declining this profile implies nothing about OBI conformance, and conforming to the spec requires nothing here.

This is a **semantics profile**, not an operation contract: there is no versioned OBI document beside this README, nothing to invoke, and no canonical `<version>.json` URL. What it publishes is a decision procedure. Its conformance surface is the shared corpus in [`../conformance/comparison/`](../conformance/comparison/), which both reference SDKs run unmodified.

**Profile identifier:** `OB-2020-12` (the identifier an implementation stamps on the comparison reports it emits). **Profile version:** 0.1.

## The question the profile answers

Given a **target** schema (the contract — what an interface declares) and a **candidate** schema (the implementation — what a corresponding operation declares), the profile decides, per direction:

- **Input compatibility** — can the candidate stand in for the target as an *input* contract? The target's consumers may send any value the target admits, so the candidate must **accept at least** everything the target accepts (target ⊆ candidate).
- **Output compatibility** — can the candidate stand in for the target as an *output* contract? The target's consumers rely on the target's shape, so the candidate must **produce only** values the target admits (candidate ⊆ target).

It is not a general-purpose subschema checker: it is scoped to a keyword subset it can decide reliably, and it **fails closed** on everything else (see The profile boundary). Comparison is pure and deterministic — no IO, same verdict on every run and every conforming implementation.

## Schema forms and the unspecified rule

Schemas at operation `input`/`output` positions take JSON Schema 2020-12's two forms:

- **Object form** — compared as described below.
- **Boolean form** — mapped to its equivalent object spelling before comparison: `true` becomes `{}` and `false` becomes `{"not": {}}`. `true` therefore behaves exactly like the empty schema (Top). `false` is **discriminating**: `{"not": {}}` uses the `not` keyword, which is outside the profile, so a `false` schema yields an *indeterminate* outcome rather than silently collapsing into Top.
- **Absent** — an operation that omits a schema leaves that contract **unspecified**. Unspecified is not Top: comparison of that slot is *skipped entirely* and reports no finding (see Suppression). Only a *present* schema — including the empty `{}` — is compared.

The empty schema `{}` is **Top** ("admits anything"):

| | Target is Top | Candidate is Top |
|---|---|---|
| **Input** | incompatible unless the candidate is also Top (a constrained candidate cannot accept everything) | compatible (accepts everything) |
| **Output** | compatible (anything the candidate produces is admitted) | incompatible unless the target is also Top (may produce anything) |

## The profile boundary

The profile compares exactly these keywords (**in scope**):

```
$ref  $defs  allOf  oneOf  anyOf
type  enum  const
properties  required  additionalProperties  items
minimum  maximum  exclusiveMinimum  exclusiveMaximum
minLength  maxLength  minItems  maxItems
```

These keywords are **annotations**: they never affect a verdict and are stripped during normalization:

```
title  description  examples  default  deprecated  readOnly  writeOnly
$schema  format  discriminator  nullable*
```

(`format` is treated as an annotation, not a structural constraint. `nullable` is the OpenAPI 3.0 spelling and is handled *structurally* first — converted to a `type` union, below — the annotation listing only catches stray occurrences without a `type`. `$schema` is stripped unconditionally; at the document layer the OBI meta-schema already pins it to 2020-12.)

Keys prefixed `x-` are extensions and are stripped.

**Everything else fails closed.** A schema using any other keyword (`pattern`, `not`, `if`/`then`/`else`, `patternProperties`, `multipleOf`, `uniqueItems`, `prefixItems`, ...) is *outside the profile*: normalization refuses it with an outside-profile error, and the comparison outcome is **indeterminate** — "this profile cannot decide", never "incompatible". Consumers surface indeterminate distinctly, as a verdict alongside compatible and incompatible (the corpus verdict vocabulary carries it).

`items` is compared as 2020-12 `items` only — one schema applied to every element. The tuple form (`prefixItems`) is outside the profile.

## Normalization

Comparison operates on **normalized** schemas. Normalization is deterministic and produces a canonical form; two schemas are structurally identical exactly when their normalized forms serialize to the same [RFC 8785 (JCS)](https://www.rfc-editor.org/rfc/rfc8785) canonical JSON. Steps, in order:

1. **`nullable` conversion** (OpenAPI 3.0 interop). `{"type": "string", "nullable": true}` becomes `{"type": ["null", "string"]}` before anything else — it is structural, so it must survive annotation stripping. A `type` array already containing `"null"` is left as is; `nullable: false` (or `nullable` without a `type`) is stripped.
2. **Profile keyword check.** Any key that is not in scope, not an annotation, and not `x-`-prefixed fails closed (outside profile).
3. **`$ref` inlining.** A `$ref` is resolved and replaced by its (normalized) target, equivalent to inlining. Fragment-only refs (`#/schemas/Foo`) resolve against the containing document root the caller supplies (in OpenBindings use, the interface document — named schemas live in the document's top-level `schemas` map). External refs resolve only if the caller supplies a fetcher, relative refs only against a caller-supplied base; otherwise resolution fails. Reference **cycles** are detected and fail — the profile does not compare recursive schemas.
4. **Stripping.** Annotations, `$defs` (dead weight once refs are inlined), and `x-` extensions are removed.
5. **`allOf` flattening.** Each branch is first normalized in full — these steps apply recursively, so a `$ref` branch is resolved and profile-checked exactly as step 3 requires, and a nested `allOf` inside a branch flattens before its parent merges. The schema's own sibling keywords (everything beside `allOf` that survives stripping) form one additional branch. All normalized branches then merge into a single schema (rules below): the sibling branch first, then the declared branches in order. The order is observable: `enum` intersection preserves the first branch's value order in the canonical form. `oneOf`/`anyOf` in a normalized branch fails closed, whether written inline, carried by a resolved `$ref`, or among the sibling keywords. The merged result is normalized again.
6. **Canonical `type`.** A scalar `type` becomes a one-element array; arrays are deduplicated and sorted.
7. **Canonical `required`.** Deduplicated and sorted.
8. **Recursion.** `properties` values, `additionalProperties` (schema form), and `items` are normalized recursively.
9. **Canonical union ordering.** `oneOf`/`anyOf` variants are normalized, then sorted by their JCS canonical string, making variant order irrelevant.

### `allOf` merge rules

| Keyword | Rule |
|---|---|
| `type` | intersection; `integer` is a subtype of `number` (`number` ∩ `integer` = `integer`); an empty intersection is a schema error |
| `properties` | union of keys; overlapping keys merge recursively |
| `required` | union |
| `additionalProperties` | any branch `false` wins; schema forms merge recursively; schema overrides `true` |
| `enum` | intersection (by JCS value equality); an empty intersection is a schema error |
| `const` | equal values merge; conflicting values are a schema error |
| `items` | recursive merge |
| `minimum` `exclusiveMinimum` `minLength` `minItems` | most restrictive (highest) wins |
| `maximum` `exclusiveMaximum` `maxLength` `maxItems` | most restrictive (lowest) wins |

A **schema error** (unsatisfiable merge) fails the comparison as an error; it is neither a compatible nor an incompatible verdict.

## Directional subsumption

After normalizing both sides, per-keyword rules run in a fixed order; the **first failing rule decides** and supplies the reason. Absent keywords are unconstrained unless a rule below says otherwise.

### Rule order

1. Top rules (empty schema, above)
2. `type`
3. `const` / `enum`
4. object rules (`required`, `properties`, `additionalProperties`) — when either side's type includes `object`
5. array `items` — when either side's type includes `array`
6. numeric bounds — when either side's type includes `number` or `integer`
7. string bounds (`minLength`/`maxLength`) — when either side's type includes `string`
8. array bounds (`minItems`/`maxItems`) — when either side's type includes `array`
9. unions (`oneOf`/`anyOf`)

### Per-keyword rules

**`type`.** A missing `type` means "all types". Input: every type the target allows must be allowed by the candidate. Output: every type the candidate allows must be allowed by the target. `integer` counts as covered by `number` (so an `integer` target with a `number` candidate is input-compatible, and an `integer` candidate with a `number` target is output-compatible — but not the reverses).

**`const` / `enum`.** Values compare by JCS equality. Input: everything the target can send must be accepted — the target's `const`/every `enum` value must be admitted by the candidate's `const`/`enum` (a candidate with neither is unconstrained and accepts it). Output: everything the candidate can produce must be admitted — the candidate's `const`/`enum` values must all fall inside the target's; a candidate with *no* `const`/`enum` where the target has one is incompatible (it may produce values outside).

**Objects.** Input: the candidate's `required` must be a subset of the target's (the candidate may not demand fields the target does not promise); for each property the target declares that the candidate also declares, the property schemas must be input-compatible; a candidate with no schema for a target property treats it as unconstrained (compatible); `additionalProperties` does not restrict input compatibility in v0.1 (see Suppression). Output: the target's `required` must be a subset of the candidate's (the candidate must supply everything the target promises); shared property schemas must be output-compatible; a candidate property the target does not declare is incompatible when the target sets `additionalProperties: false`; when the target's `additionalProperties` is `false`, the candidate's must be *literally* `false` (a schema or absent does not guarantee it); when the target's `additionalProperties` is a schema, the candidate's must be a schema that is output-compatible with it, or `false` (more restrictive is fine) — `true` or absent is incompatible.

**Array `items`.** The `items` schemas compare recursively in the same direction; a side without `items` contributes Top for that slot (so a target with `items` and a candidate without is input-compatible but output-incompatible, via the Top rules).

**Numeric bounds.** `minimum`/`exclusiveMinimum` combine into one effective lower bound (the stricter wins when both are present), likewise `maximum`/`exclusiveMaximum` for the upper. At equal values an exclusive lower bound is *higher* (stricter) than an inclusive one, and an exclusive upper bound is *lower*. Input: the candidate's bounds must be at least as wide as the target's (candidate lower ≤ target lower, candidate upper ≥ target upper); a candidate without a bound is unconstrained (compatible). Output: the candidate's bounds must be at least as narrow (candidate lower ≥ target lower, candidate upper ≤ target upper), and a candidate *missing* a bound the target declares is incompatible.

**String/array bounds.** `minLength`/`maxLength` and `minItems`/`maxItems` follow the same widen-for-input / narrow-for-output shape as numeric bounds, with plain (non-exclusive) comparisons.

**Unions.** `oneOf` and `anyOf` are treated alike for comparison. When both sides are unions — input: every target variant must have some input-compatible candidate variant; output: every candidate variant must have some output-compatible target variant. When only one side is a union, the profile defines no cross-form rule and the pair is incompatible.

## Verdicts and findings

A single directional check returns a **compatibility result**: a boolean plus, on failure, a **reason** string — the first failing rule's diagnostic, prefixed by the deciding keyword and, for nested failures, the path to it:

```
type: candidate does not allow "number"
required: candidate requires "extra" but target does not
properties["count"]: type: candidate does not allow "integer"
items: enum: candidate value "c" not in target enum
additionalProperties: target forbids but candidate allows
```

Reason strings follow these conventions, so independent implementations render them alike:

- **Deciding keyword.** The prefix names the keyword whose constraint rejects the flowing value. In mixed `const`/`enum` pairings that is direction-aware: input failures name the *candidate's* keyword (the target sends, the candidate refuses); output failures name the *target's* (the candidate produces, the target refuses). A candidate extra property rejected by the target's `additionalProperties: false` names the property's own `properties["…"]` path.
- **Values render as JCS.** Interpolated values, counts, and property/`required` member names use RFC 8785 rendering — strings quoted with JSON-string escaping, numbers in ECMAScript form (`100000000`, never `1e+08`).
- **Exclusive bounds are marked** (`minimum: candidate minimum exclusive 0 is greater than target minimum 0`).
- **Unions carry the real key and index** (`anyOf: target variant 1 has no compatible candidate variant`).
- **Deterministic member choice.** When several members fail (types, enum values, `required` names, properties), the reason names the lexicographically first failing member — never map or insertion order.

Reason strings are diagnostics for humans; the verdict is the interoperability surface. Independent implementations are expected to agree on the deciding keyword prefix; the corpus asserts verdicts. The two reference SDKs hold themselves to a stricter bar: every reason string is byte-identical across them, pinned by mirrored alignment tables (`openbindings-go/schemaprofile/reasons_test.go` and `openbindings-ts/packages/sdk/src/schema-profile/reasons.test.ts`) carrying the same fixtures and the same expected strings — a change on one side must land on both. Third-party implementations are held only to the deciding-keyword floor above.

**Interface-level checking** folds directional checks over two documents: for each operation the required interface declares, the provided interface is searched across its flat key+aliases namespace ([OBI-T-12](https://github.com/openbindings/spec/blob/main/openbindings.md#103-tool-rules)); a missing operation is a `missing` issue; for each matched pair with both schemas present, output is checked (provided output must satisfy required output) and input is checked (required input must be acceptable to provided input), yielding `output_incompatible` / `input_incompatible` issues whose detail carries the engine's reason. Issues appear in sorted operation-key order — never the document's declaration order — with the output issue before the input issue for a matched pair.

**Verdict vocabulary and collapse.** Consumers that summarize many per-operation outcomes into one verdict use three values with dominance

```
indeterminate  >  incompatible  >  compatible
```

— any outside-profile outcome makes the summary indeterminate; otherwise any incompatibility makes it incompatible; otherwise it is compatible. A removed operation (present in the target document, unmatched in the candidate) counts as incompatible; an added operation (candidate-only) is compatible.

## Suppression

The profile deliberately reports **no finding** in these situations:

- **Unspecified schemas.** When either side of a pair leaves a slot's schema absent, that slot's comparison is skipped entirely. Unspecified is a statement of "no contract declared", not an empty contract.
- **`additionalProperties` on inputs.** In v0.1 the input direction does not fault `additionalProperties` at all — a candidate that closes its input object (`additionalProperties: false`) against an open target produces no finding.
- **Undeclared candidate properties (input).** A candidate that declares no schema for a property the target declares treats it as unconstrained; no finding.
- **Annotations and extensions.** Differences confined to annotation keywords or `x-` extensions never produce findings (they are stripped before comparison).

Consumer-level *finding suppression* — downgrading a reported finding by rule, with an audit trail — is a consumer policy on top of the report and is outside this profile.

## Conformance corpus

The shared corpus lives at [`../conformance/comparison/`](../conformance/comparison/): a `manifest.json` plus fixture files in four categories (`profile/`, `structural/`, `subsumption/`, `suppression/`), each fixture a pair of embedded OBI documents with an expected verdict. Both reference SDK harnesses run the corpus unmodified (locate convention: `OB_INTERFACES_CORPUS`, else the sibling-checkout path — see [`../conformance/README.md`](../conformance/README.md)). Where this prose and the corpus disagree, the prose governs.

## Reference implementations

- Go SDK: `openbindings-go/schemaprofile` (engine), `CheckInterfaceCompatibility` (interface-level fold)
- TS SDK: `@openbindings/sdk` `src/schema-profile/` (engine), `checkInterfaceCompatibility` (interface-level fold)
- `ob compat`: comparison reports (`ob-comparison-report/v1`) stamped with this profile's identifier, layering a structural walk, graded finding kinds, and suppression rules on the same engine

## Versioning

This is profile version **0.1**, written against OpenBindings spec **0.2.0**. Pre-launch it is a working draft amendable in place, per this repository's convention; after launch, semantic changes ship as a new profile version. The keyword subset is intentionally conservative — widening the profile (e.g., deciding `pattern` containment) is a version bump, never a silent extension.
