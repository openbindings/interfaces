# Interface Synthesizer

Derive an OpenBindings interface from sources read under their exact kinds. A
kind can have a written, private or code-only definition. The operations are
offered for voluntary adoption; the [publication boundary](../#publication-boundary)
applies. This description specifies neither a generation algorithm nor an SDK.

## Operations

`listSupportedKinds` is advisory; `checkKindSupport` returns one verdict for each
distinct requested kind in first-occurrence order. Support is specific to synthesis
and does not promise success for every artifact. Kinds use core exact equality.

`synthesizeInterface` returns a document representing all callable targets admitted
by the kinds of the accepted input sources. A successful strict result describes
complete synthesis. A partial result is not that result, even if accompanied by a
transient warning. Sound lossy schema projection need not prevent complete
callable coverage. This operation does not require constructing a coverage report.

`synthesizeInterfaceWithCoverage` returns a document plus evidence describing the
source units considered in the same call. It can describe partial synthesis with
explicit gaps. Disclosure does not turn an unsound binding into a faithful one.
Neither operation requires the public inspection interface as an intermediate step.

## Inputs and generated documents

Each source input is `{name?, source}`. Sources have the OpenBindings 0.2 shape;
content remains kind-owned and distinguishes absence from JSON null. Where a
source is emitted, its value is preserved, including extensions and content
presence; a supplied name is its emitted key. The publication does not require
preserving unused input sources, choosing a particular key for an unnamed source,
or a particular deduplication or composition strategy.

`sources` omitted or empty requests a source-free document skeleton. Metadata
inputs describe the requested name, version and description; omitted defaults
are implementation choices. `openbindingsVersion` selects the 0.2 line.
Supported source combinations and failure handling are implementation choices;
the completeness claim of a successful result still has its stated meaning.

Emitted bindings claim faithful invocation paths under their source kinds in the
observed source state. Runtime credentials, configuration and host availability
are separate concerns. The document may also declare unbound operations or
dependency-only operations: the interface adds no rule that every operation
declaration have a binding or dependency.

Operation grouping, naming, aliases, schema projection and reference management
are generation choices under the core and source kind. No one-target/one-operation
algorithm, reference-inlining algorithm or byte-stable ordering is prescribed.
There are no added core authentication or generic transform fields.

## Coverage meaning

Coverage is evidence offered by the producer, not verification of its claim.
`sourceIndex` indexes the request sources; `sourceRef` identifies the source-local
unit. `scope` distinguishes targets, alternatives, dependencies and projections.
A target or alternative is an interaction unit; a projection describes fidelity
of a represented path. The kind supplies the inventory meaning. An implementation
gap is not a kind exclusion.

| Status | Meaning |
| --- | --- |
| `represented` | A represented path or dependency, as identified by the entry. |
| `excluded` | A kind-defined exclusion, identified by its `rule`. |
| `invalid` | A malformed or contradictory source unit. |
| `lossy` | Representation with a disclosed projection limitation. |
| `implementation-unsupported` | An admitted unit this implementation did not represent. |

`exhaustive` describes whether the inventory covers all interaction units in the
accepted sources. When false, `limitation` explains the possible remainder.
`fullyRepresented` additionally says every upstream-valid unit is represented
without exclusion, loss or an implementation gap. Invalid units are not
upstream-valid. These meanings constrain the claim, not how it is computed.
No duplicate-rejection algorithm or internal coverage identity tuple is specified.

Represented or lossy target, alternative and projection entries identify their
emitted source, operation and binding. Dependency entries describe consumption
points rather than binding paths. Optional `dependencyKey` identifies an emitted
dependency for a represented or lossy dependency disposition. The publication
does not impose a one-to-one correspondence between dependencies and source units.

Optional `coverage.sourceKeys` provides one emitted source key per request input,
in request order, when all such inputs have preserved emitted sources. It makes
input attribution available without the original request. Equal inputs may share
a key. Without it, `sourceIndex` still indexes the request; consumers needing
durable attribution can retain that request. Neither optional field is a
prerequisite for using this interface. Consumers choose how to assess evidence,
combine repeated rows, or handle inconsistent results.

A producer that also inspects uses the same source reference for the same
target-scope unit. Cross-producer reference equality is meaningful only where
the kind defines it. These references are not global identities.

## Ownership after synthesis

Editing a generated source, binding or operation creates a new author claim.
For example, replacing embedded content with a location can change the meaning
of source-relative binding content. The caller owns that edit. Coverage describes
the original synthesis observation and does not certify later edits or live drift.

Synthesis does not intentionally change sources or perform their operations.
Idempotency concerns intended effects; it does not require identical bytes,
ordering, internal reports, caches or naming algorithms across implementations.
