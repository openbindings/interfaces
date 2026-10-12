# Source Inspector

Inspect a source under its exact kind before authoring an OBI. The result offers
bindable targets, optional operation framing and completeness information. The
operations are offered for voluntary adoption; the [publication boundary](../#publication-boundary)
applies. No SDK or internal inspection pipeline is prescribed.

## Operations

`listSupportedKinds` returns an advisory list. Listed kinds have positive
`checkKindSupport` answers; absence makes no support claim. `checkKindSupport`
returns one verdict per distinct requested kind, in first-occurrence order.
Support is specific to inspection. True does not promise support for every case.
Kinds retain the core's exact string equality. Capability detection is private.

`inspectSource` returns targets admitted by the source kind. It does not perform
those targets' operations or intentionally change the inspected source.
Source acquisition, enumeration, caching, ordering and recovery are implementation
choices. Inspection and synthesis are independently adoptable capabilities;
neither requires calling or implementing the other.

## Inputs and results

The input source is an OpenBindings 0.2 source value, with kind-owned content and
extensions. Absent content and JSON null differ. The open carrier schema is not
a full core-conformance check. Handling malformed carriers is implementation policy.

Each target has a stable source-local `sourceRef` and a binding fragment. The
reference identifies a target within the observed source; it is not a global
identifier or a locator. If a producer also synthesizes, the same target-scope
unit has the same reference in both products. Cross-producer comparison is
meaningful only where the kind defines it. This interface does not prescribe
duplicate rejection or deduplication, nor require a particular row order.

The binding fragment has no author-assigned `operation` or `source` keys. The
document author adds those keys when constructing a binding. Its other fields
have the core binding meanings, including any idempotence claim and extensions.
Optional `operation` framing describes the same target using the core operation
shape; `operationKey` is a naming suggestion. Missing framing makes no framing
claim. Consumer validation and repair of malformed results are separate choices.

`exhaustive: true` claims that all targets admitted by the kind are reported.
`exhaustive: false` leaves a possible remainder, explained by `limitation`.
Omission of kind-excluded targets does not make an inventory incomplete; an
implementation gap affecting an admitted target does. The flag is a producer
claim, not independent evidence that enumeration was complete.

## Authoring use

A CLI or browser can inspect a source, let its user choose targets and author
bindings with its own operation and source keys. An application can reject
duplicate rows, combine repeated evidence or use another documented policy.
None of those policies is specified by this interface. Replacing source or
binding content afterward creates a new author-owned correspondence claim.

Inspection is idempotent in intended operation effects; it does not guarantee
identical bytes, ordering or an immutable external source between calls.
