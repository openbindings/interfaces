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

### Schema references in framing

Carried input and output schemas have the core schema and reference meanings
that they will have in an authored OBI. The inspection response and source
artifact supply no implicit schema resource or additional schema map. Portable
framing identifies needed resources within the carried schemas or through
absolute schema URIs; it does not rely on unspecified members of a future OBI.
Framing is optional when those reference meanings cannot be supplied. This adds
no inlining, bundling, validation or resource-acquisition procedure.

For example, this operation fragment carries a schema resource whose reference
keeps its meaning when the author places the operation into an OBI:

```json
{
  "input": {
    "$id": "urn:example:text-input",
    "$defs": {"Text": {"type": "string"}},
    "$ref": "#/$defs/Text"
  }
}
```

The reference is local to the resource named by `$id`. Without that `$id`, the
same fragment would address the eventual OBI root, not the `input` schema.
Likewise, `#/schemas/Request` without a declaring resource cannot stand in for
an uncarried schema from the source artifact. The resource identifier here is
illustrative; composition and resource acquisition remain author and consumer
choices. The JSON interface includes this fragment in `schemas.Operation.examples`.

## Authoring use

A CLI or browser can inspect a source, let its user choose targets and author
bindings with its own operation and source keys. An application can reject
duplicate rows, combine repeated evidence or use another documented policy.
None of those policies is specified by this interface. Replacing source or
binding content afterward creates a new author-owned correspondence claim.

Inspection is idempotent in intended operation effects; it does not guarantee
identical bytes, ordering or an immutable external source between calls.

## Walkthrough: inspect and author

This example defines an illustrative kind, `example.text@1`, with two targets:
`echo` returns its input string; `length` counts its Unicode code points. Source
content is absent and binding content names a target. These choices belong only
to this example. The JSON interface also carries this request and result in
`inspectSource.examples.textTargets`.

An `inspectSource` input value is:

```json
{
  "source": {
    "kind": "example.text@1"
  }
}
```

One possible result is:

```json
{
  "targets": [
    {
      "sourceRef": "echo",
      "binding": {
        "content": "echo"
      },
      "operationKey": "repeat",
      "operation": {
        "description": "Return the input string.",
        "input": {
          "type": "string"
        },
        "output": {
          "type": "string"
        }
      }
    },
    {
      "sourceRef": "length",
      "binding": {
        "content": "length"
      },
      "operationKey": "count",
      "operation": {
        "description": "Count Unicode code points in the input string.",
        "input": {
          "type": "string"
        },
        "output": {
          "type": "integer",
          "minimum": 0
        }
      }
    }
  ],
  "exhaustive": true
}
```

The author chooses `echo`, keeps its operation framing, and supplies document
keys. Here the author chooses `repeat`, `text` and `repeatText`:

```json
{
  "openbindings": "0.2.0",
  "name": "Text tools",
  "operations": {
    "repeat": {
      "description": "Return the input string.",
      "input": {
        "type": "string"
      },
      "output": {
        "type": "string"
      }
    }
  },
  "sources": {
    "text": {
      "kind": "example.text@1"
    }
  },
  "bindings": {
    "repeatText": {
      "operation": "repeat",
      "source": "text",
      "content": "echo"
    }
  }
}
```

The inspector's binding fragment became a document binding by adding `operation`
and `source`. No meaning was inferred from the spelling of `sourceRef`; it is
not a generic binding locator. Naming and target selection are author choices.

This authoring step is not a call to the synthesizer with a selection filter.
The synthesis input has no such filter. The [synthesis continuation](../interface-synthesizer/#walkthrough-strict-and-partial-synthesis)
shows whole-source strict synthesis and an explicitly partial result. The
[invocation walkthrough](../binding-invoker/#walkthrough-values-and-outcomes)
uses the selected binding.

These are values exchanged with an implementation that adopts the operation.
The published interface URL describes the operation; it is not an invocation
endpoint and does not choose a provider or transport.

### Adopting one operation

An implementation offering only `inspectSource` can use
`openbindings.source-inspector.inspectSource` as its operation key or alias.
It describes compatible input and output shapes and supplies its own binding.
It need not offer synthesis, support queries, or the remaining operations.
For example, a local operation named `inspect` can carry:

```json
{"aliases": ["openbindings.source-inspector.inspectSource"]}
```

That fragment is an alias declaration, not a complete operation or OBI.
The shared name is the author's correspondence claim, not proof of behavior.
