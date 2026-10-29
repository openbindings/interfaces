# Interface Synthesizer

Synthesize bindings of one kind into an OpenBindings interface. The result holds
additions to a given document and a report of what synthesis added, how the
document's existing bindings of the kind compare, and what it left out. A kind
can have a written, private or code-only definition. The operations are offered
for voluntary adoption; the [publication boundary](../#publication-boundary)
applies. This description specifies neither a generation algorithm nor an SDK.

## Operations

`listSupportedKinds` is advisory; `checkKindSupport` returns one verdict for each
distinct requested kind in first-occurrence order. Support is specific to synthesis
and does not promise success for every artifact. Kinds use core exact equality.

`synthesizeInterface` takes a document and a kind and returns additions to that
document, plus a report of the same call. The report shows whether the result is
[complete synthesis](#complete-synthesis) or partial synthesis with explicit
gaps. Disclosure does not turn an unsound binding into a faithful one.

## Inputs and sources

A request is `{interface, kind, sources?}`.

`interface` is the document to add to. A new document starts as a minimal
document, plus the `resources` entries holding its sources:

```json
{"openbindings": "0.2.0", "operations": {}}
```

The document carries its own name, version, description and specification
version. `kind` is the kind of the bindings to synthesize.

`sources` lists keys of `resources` entries that the synthesizer reads as
sources. A source is a value that the kind's content holds or refers to, so its
shape is fixed by the kind's content definition: an embedded artifact, a
location, or whatever else the kind defines. A key that names no `resources`
entry fails the call. Without sources, synthesis reads the kind's own
inventory, for a kind that reads no source.

Which existing bindings read a source, and what each one binds, is read from
their content, as the kind defines; only bindings of the requested kind take
part. Supported source combinations and failure handling are otherwise
implementation choices; the report of a successful result still has its stated
meaning.

## Additions

The result is `{additions, report}`. `additions` holds new `schemas`,
`operations`, `dependencies`, `bindings` and `resources` entries; each map is
optional. Every added key is new to the corresponding map of the input
document, and every added operation key is also new to its operation identifier
namespace, which holds operation keys and aliases. Inserting the additions into
the input document gives the synthesized document.

Synthesis adds bindings for what the sources offer that no `current` or `stale`
existing binding already binds. It never adds a second binding for something
already bound: a stale binding gets a proposal, not a duplicate. Each added
binding has the requested kind and realizes an added operation, never an
existing one. Joining an added binding to an existing operation is the caller's
edit.

A dependency has no content, so synthesis cannot recognize the dependencies a
document already has. Synthesizing again into a document adds its dependencies
again, under new keys. A caller that does not want them leaves those `added`
entries out.

Added content and schemas may refer to entries already in the input document,
such as the source entries, and to other additions. Each kind defines how its
content refers to them.

Added bindings claim faithful invocation paths under their kind in the observed
source state. Runtime credentials, configuration and host availability are
separate concerns.

Operation grouping, naming, aliases, schema projection and reference management
are generation choices under the core and the kind. No mapping from what a
source offers to operations, reference-inlining algorithm or byte-stable
ordering is prescribed. There are no added core authentication or generic
transform fields.

Synthesis changes neither the input document nor its sources, and performs none
of their operations. Idempotency concerns intended effects; it does not require
identical bytes, ordering, internal reports, caches or naming algorithms across
implementations.

## Report

The report is `{exhaustive, limitation?, added, existing?, omitted?}`. It is
evidence offered by the producer, not verification of its claim.

`exhaustive` is true when the synthesizer read all of the given sources, or all
of the kind's own inventory when the call names none. When it is false,
`limitation` (`{code, message, details?}`) explains what may be missing and
why.

### Added

`added` has one entry for each added binding and each added dependency, and
each appears exactly once:

```json
{"binding": "getUser.api", "operation": "getUser", "uses": {"schemas": ["User", "Address"]}}
```

- `binding` or `dependency`, exactly one, is the key of the addition.
- `operation` is the key of the added operation the binding realizes or the
  dependency consumes.
- `uses` names every other addition the entry needs, directly or through
  another addition, keyed by additions map name. The lists are closed: here
  `User` refers to `Address`, so both are listed. A caller keeps an entry by
  inserting it, its operation and its uses.
- `lossy` (`{reasonCode, message, details?}`) discloses lost fidelity, such as
  an approximated schema. The addition is still an added path; the loss marks
  what it does not represent exactly.
- `requirements` names runtime prerequisites of an added binding, such as
  credentials or a required codec.

### Existing

`existing` has one entry for each binding of the requested kind already in the
document that reads one of the given sources. Without sources, that is every
binding of that kind. Each entry is `{binding, status, ...}`:

| Status | Meaning |
| --- | --- |
| `current` | The synthesizer would write the binding and its operation unchanged. |
| `stale` | The binding still corresponds to something the synthesizer would bind, but the synthesizer would write it differently now. The entry carries a `proposal`. |
| `unmatched` | Nothing the synthesizer read and would bind corresponds to the binding any more. When `exhaustive` is false, it may correspond to something unread. Optional `reasonCode`, `message` and `details` say why. |

A stale entry's `proposal` is `{content?, operation?, uses?}`. `content` and
`operation` each appear where the synthesizer would write them differently, and
at least one appears: `content` is the content it would write for the binding,
and `operation` is the operation object it would write for the operation the
binding realizes. `uses` names the additions the proposed content and
operation need. A caller refreshes the binding by copying the proposal onto the
existing binding and operation itself.

### Omitted

`omitted` reports what the sources offer that synthesis did not represent. Each
entry is `{status, reasonCode, message, rule?, details?}`:

| Status | Meaning |
| --- | --- |
| `excluded` | Left out under a kind-defined rule, identified by `rule`. |
| `invalid` | A malformed or contradictory part of a source. |
| `implementation-unsupported` | Something the kind admits that this implementation did not represent. |

An implementation gap is not a kind exclusion: an implementation's restriction
of a kind defined elsewhere is `implementation-unsupported`. `details`
describes the omitted item but is not an address; no request names an item by
it.

These meanings constrain the claim, not how it is computed. Consumers choose
how to assess evidence or handle inconsistent results. Comparing details across
producers is meaningful only where the kind defines it.

## Complete synthesis

Complete synthesis is a condition on the report, not a separate operation or
field. A result meets it when `exhaustive` is true and no `omitted` entry is
`implementation-unsupported`. The synthesized document then binds everything
the kind admits from the given sources.

Kind-defined exclusions, invalid parts and lossy additions do not prevent
complete synthesis. The kind's own rule leaves an excluded item out, an invalid
part is not upstream-valid, and a lossy addition is an added path whose loss is
disclosed.

Callers decide what a result must satisfy. A caller can apply this condition,
also require no `omitted` entry and no `lossy` addition, or apply its own
policy to the report. A result that falls short of one caller's requirement is
still a synthesis result with explicit gaps, which another caller may use.

## Using the result

Inspection is synthesis whose result is read and discarded. A caller that only
wants to know what a kind offers reads the report and inserts nothing.

To bind only some of the result, a caller keeps the chosen `added` entries:
it inserts each one, its operation and its uses, and discards the rest.

Synthesizing into an existing document reads as a drift report, from
`existing` and `added`:

- A `current` entry is a binding the document already has, as the synthesizer
  would write it.
- A `stale` entry is a binding the document already has, with a proposal for
  how the synthesizer would write it now.
- An `unmatched` entry is a binding that binds nothing the kind offers now,
  such as a removed or renamed target.
- An added binding is something the sources offer that the document does not
  yet bind.

Added dependencies are not drift: synthesis adds them on every call. To refresh
a stale binding, a caller copies its proposal onto the existing entries and
inserts the additions the proposal's `uses` names. Removing an unmatched binding is
likewise the caller's edit.

Editing an added or existing entry creates a new author claim. The report
describes the synthesis observation and does not certify later edits or live
drift.

## Walkthrough: text tools

This example defines an illustrative kind, `example.text@1`, with two targets:
`echo` returns its input string; `length` counts its Unicode code points. The
kind reads no source, so requests name no `sources`, and binding content names
a target. These choices belong only to this example.

### A new document

The request starts from a minimal document that carries the interface's name:

```json
{
  "interface": {"openbindings": "0.2.0", "name": "Text tools", "operations": {}},
  "kind": "example.text@1"
}
```

A synthesizer that represents both targets returns:

```json
{
  "additions": {
    "operations": {
      "repeat": {
        "description": "Return the input string.",
        "input": {"type": "string"},
        "output": {"type": "string"}
      },
      "count": {
        "description": "Count Unicode code points in the input string.",
        "input": {"type": "string"},
        "output": {"type": "integer", "minimum": 0}
      }
    },
    "bindings": {
      "repeatText": {"operation": "repeat", "kind": "example.text@1", "content": "echo"},
      "countText": {"operation": "count", "kind": "example.text@1", "content": "length"}
    }
  },
  "report": {
    "exhaustive": true,
    "added": [
      {"binding": "repeatText", "operation": "repeat"},
      {"binding": "countText", "operation": "count"}
    ]
  }
}
```

The report is exhaustive and omits nothing, so the result is complete
synthesis. Neither entry has `uses`, because each operation declares its own
schemas. The added keys are example choices, not a naming algorithm required by
this interface. Inserting the additions gives the synthesized document:

```json
{
  "openbindings": "0.2.0",
  "name": "Text tools",
  "operations": {
    "repeat": {
      "description": "Return the input string.",
      "input": {"type": "string"},
      "output": {"type": "string"}
    },
    "count": {
      "description": "Count Unicode code points in the input string.",
      "input": {"type": "string"},
      "output": {"type": "integer", "minimum": 0}
    }
  },
  "bindings": {
    "repeatText": {"operation": "repeat", "kind": "example.text@1", "content": "echo"},
    "countText": {"operation": "count", "kind": "example.text@1", "content": "length"}
  }
}
```

A caller that wants only `echo` keeps the `repeatText` entry: it inserts
`repeatText` and `repeat` and discards `countText` and `count`. The JSON
interface carries this request and result as
`synthesizeInterface.examples.textTools`.

### A partial result

A synthesizer that represents only `echo`, and cannot confirm that the kind
offers no further targets, answers the same request by adding only `repeat` and
`repeatText`, with this report:

```json
{
  "exhaustive": false,
  "limitation": {
    "code": "example.inventory-unconfirmed",
    "message": "This synthesizer cannot confirm the kind's full target list, so further targets may exist."
  },
  "added": [
    {"binding": "repeatText", "operation": "repeat"}
  ],
  "omitted": [
    {
      "status": "implementation-unsupported",
      "reasonCode": "example.length-unavailable",
      "message": "This synthesizer does not generate the length target.",
      "details": {"target": "length"}
    }
  ]
}
```

The non-exhaustive report and the `implementation-unsupported` omission each
mean the result is not complete synthesis. The omission's `details` describe
the target; they are not an address. Had a rule of the kind excluded `length`,
that omission would instead be `excluded` with its `rule`, and an exhaustive
report would then be complete synthesis. The complete response appears in
`synthesizeInterface.examples.partialTextTools`.

### An existing document

This document binds `echo` as `repeatText`. It also has a binding `shoutText`
whose content, `"shout"`, names a target the kind does not offer:

```json
{
  "openbindings": "0.2.0",
  "name": "Text tools",
  "operations": {
    "repeat": {
      "description": "Return the input string.",
      "input": {"type": "string"},
      "output": {"type": "string"}
    },
    "shout": {
      "description": "Return the input string in upper case.",
      "input": {"type": "string"},
      "output": {"type": "string"}
    }
  },
  "bindings": {
    "repeatText": {"operation": "repeat", "kind": "example.text@1", "content": "echo"},
    "shoutText": {"operation": "shout", "kind": "example.text@1", "content": "shout"}
  }
}
```

Synthesis into it adds only `length`:

```json
{
  "additions": {
    "operations": {
      "count": {
        "description": "Count Unicode code points in the input string.",
        "input": {"type": "string"},
        "output": {"type": "integer", "minimum": 0}
      }
    },
    "bindings": {
      "countText": {"operation": "count", "kind": "example.text@1", "content": "length"}
    }
  },
  "report": {
    "exhaustive": true,
    "added": [
      {"binding": "countText", "operation": "count"}
    ],
    "existing": [
      {"binding": "repeatText", "status": "current"},
      {
        "binding": "shoutText",
        "status": "unmatched",
        "reasonCode": "example.unknown-target",
        "message": "The kind offers no shout target."
      }
    ]
  }
}
```

`repeatText` is `current`, so nothing is added for `echo`. `shoutText` is
`unmatched`; keeping, changing or removing it is the caller's decision. The
result is complete synthesis. The JSON interface carries this request and
result as `synthesizeInterface.examples.existingTextTools`.

### A stale binding

Suppose the same document's `repeat` declared no output schema:

```json
{"description": "Return the input string.", "input": {"type": "string"}}
```

A synthesizer that would write `repeat` with its output schema reports
`repeatText` as stale, with a proposed operation:

```json
{
  "binding": "repeatText",
  "status": "stale",
  "proposal": {
    "operation": {
      "description": "Return the input string.",
      "input": {"type": "string"},
      "output": {"type": "string"}
    }
  }
}
```

The content is unchanged, so the proposal has no `content`, and it needs no
additions, so it has no `uses`. Nothing is added for `echo`. To
refresh, the caller copies what it accepts from the proposed operation onto
`repeat`.

These are values exchanged with an implementation that adopts the operation.
The published interface URL describes the operation; it is not an invocation
endpoint and does not choose a provider or transport.

## Adopting one operation

An implementation offering only `synthesizeInterface` can use
`openbindings.interface-synthesizer.synthesizeInterface` as its operation key or
alias. It describes compatible input and output shapes and supplies its own
binding. It need not offer the support queries. For example, a local operation
named `synthesize` can carry:

```json
{"aliases": ["openbindings.interface-synthesizer.synthesizeInterface"]}
```

That fragment is an alias declaration, not a complete operation or OBI.
The shared name is the author's correspondence claim, not proof of behavior.
