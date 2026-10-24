# Interface Synthesizer

Derive an OpenBindings interface from sources read under their exact kinds. A
kind can have a written, private or code-only definition. The operations are
offered for voluntary adoption; the [publication boundary](../#publication-boundary)
applies. This description specifies neither a generation algorithm nor an SDK.

## Operations

`listSupportedKinds` is advisory; `checkKindSupport` returns one verdict for each
distinct requested kind in first-occurrence order. Support is specific to synthesis
and does not promise success for every artifact. Kinds use core exact equality.

`synthesizeInterface` returns a document plus coverage evidence describing the
source units considered in the same call. The evidence shows whether the result
is [complete synthesis](#complete-synthesis) or partial synthesis with explicit
gaps. Disclosure does not turn an unsound binding into a faithful one. The
operation does not require the public inspection interface as an intermediate step.

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
the coverage evidence of a successful result still has its stated meaning.

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

## Complete synthesis

Complete synthesis is a condition on the coverage evidence, not a separate
operation or field. A result meets it when `exhaustive` is true and no entry has
status `implementation-unsupported`. It then claims a document representing every
callable target admitted by the kinds of the accepted input sources.

Kind-defined exclusions, invalid units and sound lossy projection do not prevent
complete synthesis. The kind's own rule leaves an excluded unit out, an invalid
unit is not upstream-valid, and a lossy entry is a represented path whose
limitation is disclosed. Every fully represented report meets the condition; a
report with an exclusion or a lossy entry can meet it without being fully
represented.

Callers decide what a result must satisfy. A caller can apply this condition,
require `fullyRepresented`, or apply its own policy to the entries. A result
that falls short of one caller's requirement is still a synthesis result with
explicit gaps, which another caller may use.

## Ownership after synthesis

Editing a generated source, binding or operation creates a new author claim.
For example, replacing embedded content with a location can change the meaning
of source-relative binding content. The caller owns that edit. Coverage describes
the original synthesis observation and does not certify later edits or live drift.

Synthesis does not intentionally change sources or perform their operations.
Idempotency concerns intended effects; it does not require identical bytes,
ordering, internal reports, caches or naming algorithms across implementations.

## Walkthrough: complete and partial synthesis

Continue the [illustrative two-target text example](../source-inspector/#walkthrough-inspect-and-author).
Both results below answer this same request value:

```json
{
  "sources": [
    {
      "name": "text",
      "source": {
        "kind": "example.text@1"
      }
    }
  ],
  "name": "Text tools"
}
```

A synthesizer that represents both admitted targets, `echo` and `length`,
returns a document binding each of them and a report with both entries
`represented`. `exhaustive` and `fullyRepresented` are true, so the result is
complete synthesis. Its JSON interface includes the complete response in
`synthesizeInterface.examples.textTools`. The chosen generated keys are example
choices, not a naming algorithm required by this interface.

A synthesizer that represents only `echo` returns a partial result instead. For
example, it returns the selected OBI from the authoring walkthrough as
`interface`, and this `coverage`:

```json
{
  "entries": [
    {
      "sourceIndex": 0,
      "sourceRef": "echo",
      "scope": "target",
      "status": "represented",
      "sourceKey": "text",
      "operationKey": "repeat",
      "bindingKey": "repeatText"
    },
    {
      "sourceIndex": 0,
      "sourceRef": "length",
      "scope": "target",
      "status": "implementation-unsupported",
      "reasonCode": "example.length-unavailable",
      "message": "This synthesizer does not generate the length target."
    }
  ],
  "exhaustive": true,
  "fullyRepresented": false
}
```

Here `exhaustive` is true because the report accounts for both targets;
`fullyRepresented` is false because one admitted target was not represented.
The `implementation-unsupported` entry means the result is not complete
synthesis. Had a rule of the kind excluded `length`, that entry would instead be
`excluded` with its `rule`, and the result would be complete synthesis while
`fullyRepresented` stayed false. The complete response envelope appears in the
JSON interface's `synthesizeInterface.examples.partialTextTools`.

The caller can use `sourceIndex` with its request to interpret attribution.
This example omits the optional `sourceKeys` and `dependencyKey` fields. A
consumer may preserve the request alongside the result if it needs that history.
This example shows evidence meanings; it does not require constructing reports
this way internally or using inspection as a synthesis stage.
