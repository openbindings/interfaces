# Source Puller

Pull one source of an OpenBindings interface document into the document. The
result holds additions to the document and a report of what the pull added, how
the entries the source already accounts for compare, and what it left out. A
kind can have a written, private or code-only definition. The operation is
offered for voluntary adoption; the [publication boundary](../#publication-boundary)
applies. This description specifies neither a projection algorithm nor an SDK.

## The operation

`pullSource` takes a document and the key of one of its sources and returns
additions to that document, plus a report of the same call. The report shows
whether the result is a [complete pull](#complete-pull) or a partial pull with
explicit gaps. Disclosure does not turn an unsound binding into a faithful one.

One source per call, as `invokeBinding` takes one binding. Sources are
independent; a caller that wants several pulled calls once per source.

## Request

A request is `{interface, source, context?}`.

`interface` is the document to add to. A new document starts as a minimal
document plus the source to pull:

```json
{"openbindings": "0.2.0", "operations": {}, "sources": {"api": {"kind": "example.openapi@1", "data": {"...": "..."}}}}
```

The document carries its own name, version, description and specification
version. `source` is the key of the `sources` entry to pull; a key that names no
`sources` entry fails the call.

`context` carries values the source's kind needs to read the source, as the
[context document](../context/) defines: an opaque object whose members a
challenge described. A pull that cannot proceed without a value it was not
given completes unsuccessfully with `CONTEXT_REQUIRED` and the challenge,
`{message, schema}`, as its data, exactly as an invocation would; a later call
carries the values the schema described. A pull performs none of the
source's operations and promises nothing about effects. Reading a source may
still run what its data names, such as starting a server to list its tools; a
kind whose pull does so says so in the [kind descriptor's](../kind-descriptor/)
`pull` disclosure, and an application asks before running it.

## What the puller reads

The puller reads the source's data under the source's kind, and whatever that
data refers to as the kind defines. What the data means, whether the kind
reads something outside the document that the data names, and what it does
when it cannot, are the kind's definition alone. This interface exchanges
documents and keys and says nothing about it. A document that embeds a
description and a document that names one at a URL are both sources; which
forms a kind offers, and what each means, is the kind's.

Which existing bindings the source accounts for is read from the document:
those that name the pulled source. What each one binds is read from its data,
as the kind defines. Only bindings naming the pulled source take part.

## Additions

The result is `{additions, report}`. `additions` holds new `operations`,
`schemas` and `bindings` entries; each map is optional. Every added key is new
to the corresponding map of the input document, and every added operation key
is also new to its operation identifier namespace, which holds operation keys
and aliases. Every added binding names the pulled source. Inserting the
additions into the input document gives the pulled document.

A pull adds bindings for what the source offers that no `current`, `stale`
or `unassessed` binding of that source already binds. It never adds a second
binding for something already bound: a stale binding gets a proposal, and an
unassessed one is left as it is, never duplicated.

An added binding realizes an added operation, with one exception. When the
source offers an operation whose key already identifies an operation of the
document, as its key or one of its aliases (an alias identifies an operation
exactly as its key does, core §5.1), the puller compares the offered `input`
and `output` with the existing operation's. Equal under the
[schema-comparison profile's](../schema-comparison/) identical mode, the added
binding realizes the existing operation, naming its own key, and its report
entry says `reused`: one operation, several bindings, arrived at by pulling
several sources. Different, the item is `omitted` as a `conflict` and the
author decides. A comparison that cannot finish (a reference cycle, a reference
it cannot resolve, an unsatisfiable merge) decides neither: the item is
`omitted` as `implementation-unsupported`, and an entry already there whose
comparison cannot finish is `unassessed`. The author decides a conflict: bind the source to the existing operation by hand, adapting in
binding data as the kind defines, or add it under another key. The comparison
is the puller's and is the same for every kind; the kind projects from its
source alone and reads nothing in the document to choose a name or a shape.

Added schemas and binding data may refer to entries already in the input
document and to other additions. Each kind defines how its data refers to them.
An addition never claims the author's shape: an item that needs a `schemas`
entry, or another operation's `input` or `output`, that the document holds
with another shape than the source's is `omitted` as a `conflict` too, and so
is an item whose additions would declare again an identifier the document
declares, a `$id` or a plain name (core §7.2).

Added bindings claim faithful invocation paths under their source's kind in
the observed source state. Runtime context, configuration and host
availability are separate concerns.

Operation grouping, naming, aliases, schema projection and reference management
are projection choices under the core and the kind. No mapping from what a
source offers to operations, reference-inlining algorithm or byte-stable
ordering is prescribed. There are no added core authentication or generic
transform fields.

A pull changes neither the input document nor the source, and performs none of
the source's operations. Idempotency concerns intended effects; it does not
require identical bytes, ordering, internal reports, caches or naming
algorithms across implementations.

## Report

The report is `{exhaustive, limitation?, added, existing?, omitted?}`. It is
evidence offered by the producer, not verification of its claim.

`exhaustive` is true when the puller read the whole source. When it is false,
`limitation` (`{code, message, details?}`) explains what may be missing and
why; an exhaustive report carries none.

### Added

`added` has one entry for each added binding, and each appears exactly once:

```json
{"binding": "getUser.api", "operation": "getUser", "uses": ["schemas/User", "schemas/Address"]}
```

- `binding` is the key of the added binding.
- `operation` is the key of the operation the binding realizes: an added
  operation, or an existing one when `reused` is present.
- `reused`, when present, is `true`: the operation already existed and the
  puller bound the source to it because the offered input and output equal the
  existing ones.
- `uses` names every other addition the entry needs, directly or through
  another addition, as `<map>/<key>` labels: `schemas/User`,
  `operations/getUser`, `bindings/getUser.api`. The list is closed: here `User`
  refers to `Address`, so both are listed. A caller keeps an entry by inserting
  it, its operation when that operation is added, and everything the list
  names.
- `lossy` (`{reasonCode, message, details?}`) discloses lost fidelity, such as
  an approximated schema. The addition is still an added path; the loss marks
  what it does not represent exactly.

### Existing

`existing` has one entry for each entry of the input document that the pulled
source accounts for: each binding naming the source, each schema the source
offers under a key the document already has, and, when the kind has something
to report about it, the source entry itself. Exactly one of `binding`,
`schema` or `source` names the entry, and each entry is
`{status, change?, proposal?, ...}`:

| Status | Meaning |
| --- | --- |
| `current` | The puller would write the entry unchanged. |
| `stale` | The entry still corresponds to something the source offers, but the puller would write it differently now. The entry carries a `proposal` and a `change`. |
| `unmatched` | Nothing the puller read and would write corresponds to the entry any more. When `exhaustive` is false, it may correspond to something unread. Optional `reasonCode`, `message` and `details` say why. |
| `unassessed` | The entry corresponds to something the source offers, but the puller could not judge it, as when it cannot represent that item. `reasonCode` and `message` say why. |

"Unchanged" is judged as the [schema-comparison profile's](../schema-comparison/)
identical mode compares schemas, so a difference only in what the profile
strips as annotations (a description, a default, a format) never makes an
entry stale: annotations are the author's. A reference spelled the same in the
entry and in what the puller would write counts as the same when its target is
something the source offers, a `schemas` entry under that key or another
operation's `input` or `output`, so a change behind it is reported once, at its
target. Binding data and source data compare as JSON values.

A proposal carries only what the kind owns. For a binding it is
`{data?, input?, output?, remove?, uses?}`: `data` is the binding data the
puller would write, `input` and `output` are the schemas it would write for the
operation the binding realizes, each appearing where the puller would write it
differently, `remove` names what it would no longer write (`data`, `input` or
`output`, each at most once and never also carried), at least one of the four
appears, and `uses` names the additions the proposal needs. The operation's
`description`, and the binding's `preference` and `idempotent` (core §5.3), are
the author's and are never in a proposal, so applying one cannot touch them.
For a schema the proposal is `{schema, uses?}`: the schema the puller would
write and the additions it needs. For the source it is `{data}` or
`{remove: ["data"]}`, and only a kind whose definition lets it refresh its own
source data ever proposes one; the interface takes no stance on what a kind's
data means.

`change` is the kind's judgment of the proposal's effect on a caller of the
affected operation: `breaking` (a caller that satisfied the old input or relied
on the old output may fail), `dangerous` (a caller may fail depending on how it
was written) or `non-breaking` (no caller is affected). A kind that cannot
classify a change says `dangerous`. A `non-breaking` stale entry still
realizes its operation as core §5.3 states realization, so the author may
decline its proposal without breaking the binding's claim; the entry stays
`stale`, and the drift stays reported. For a schema several operations reach, as
the input of one and the output of another, the label is the most severe
across them. The label lets an agent or a policy decide without diffing
schemas itself; it is not an instruction to apply.

A caller applies a proposal by copying what it carries onto the existing
entry, removing what its `remove` names, and inserting the additions its `uses`
names. An endpoint that stops returning a body is a stale binding whose
proposal is `{"remove": ["output"]}`, a `breaking` change.

### Omitted

`omitted` reports what the source offers that the pull did not represent. Each
entry is `{status, reasonCode, message, rule?, item?, existing?, offered?,
through?, details?}`:

| Status | Meaning |
| --- | --- |
| `excluded` | Left out under a kind-defined rule, identified by `rule`. |
| `invalid` | A malformed or contradictory part of the source. |
| `implementation-unsupported` | Something the kind admits that this implementation did not represent. |
| `conflict` | The item needs something the document already holds with another shape: an operation under a key or alias the document has whose input or output differ from the item's, a `schemas` entry under the key the item refers to, another operation's input or output the item refers to, or an identifier, a `$id` or a plain name, that its additions would declare again. The author decides. |

- `item` labels the item left out as `<map>/<key>`, the way `uses` labels an
  addition: `operations/<key>` with the key the source offers, or
  `schemas/<key>`. It is present whenever the omitted part has a key.
- `existing`, on a conflict and required there, labels what the document
  holds that differs: `operations/<key>` by the operation's own key, even when
  the item offers it under an alias, or `schemas/<key>`, the entry that
  declares the identifier when that is what clashes.
- `offered`, on a conflict and required there, is the item's version of what
  `existing` labels: for an operation, an object carrying the offered `input`
  and `output`, each absent where the item offers none; for a `schemas` entry,
  the schema the item needs under that key.
- `through`, on a conflict, names what `existing` and `offered` differ
  through when the two read the same: `schemas/<key>` for a `schemas` entry,
  `operations/<key>/input` or `operations/<key>/output` for another
  operation's input or output.
- `identifier`, on a conflict over an identifier, is the `$id` or plain name
  the item's additions would declare again; `existing` then labels the entry
  that declares it.

An implementation gap is not a kind exclusion: an implementation's restriction
of a kind defined elsewhere is `implementation-unsupported`. `details`
describes the omitted item further but is not an address; no request names an
item by it.

These meanings constrain the claim, not how it is computed. Consumers choose
how to assess evidence or handle inconsistent results. Comparing details across
producers is meaningful only where the kind defines it.

## Complete pull

A complete pull is a condition on the report, not a separate operation or
field. A result meets it when `exhaustive` is true, no `omitted` entry is
`implementation-unsupported` and no `existing` entry is `unassessed`. The
pulled document then binds everything the kind admits from the source, apart
from what the author has to decide.

Kind-defined exclusions, invalid parts, conflicts and lossy additions do not
prevent a complete pull. The kind's own rule leaves an excluded item out, an
invalid part is not upstream-valid, a conflict is the author's call, and a
lossy addition is an added path whose loss is disclosed.

Callers decide what a result must satisfy. A caller can apply this condition,
also require no `omitted` entry and no `lossy` addition, or apply its own
policy to the report. A result that falls short of one caller's requirement is
still a pull result with explicit gaps, which another caller may use.

## Using the result

Inspection is a pull whose result is read and discarded. A caller that only
wants to know what a source offers reads the report and inserts nothing.

To bind only some of the result, a caller keeps the chosen `added` entries: it
inserts each one, its operation when that operation is added, and what its
`uses` names, and discards the rest.

Pulling into a document that already names the source reads as a drift report,
from `existing` and `added`:

- A `current` entry is one the document already has, as the puller would write
  it.
- A `stale` entry is one the document already has, with a proposal for how the
  puller would write it now and the class of the change.
- An `unmatched` entry is a binding that binds nothing the source offers now,
  such as a removed or renamed target.
- An `unassessed` entry is one the puller could not judge; the source still
  offers what it corresponds to, so it is no reason to remove the entry.
- An added binding is something the source offers that the document does not
  yet bind.

Applying a proposal and removing an unmatched binding are the caller's edits.
Editing an added or existing entry creates a new author claim. The report
describes the pull's observation and does not certify later edits or live
drift.

## Walkthrough: text tools

This example defines an illustrative kind, `example.text@1`, with two targets:
`echo` returns its input string; `length` counts its Unicode code points. A
source of this kind carries no data, since the kind's inventory is fixed, and
binding data names a target. These choices belong only to this example.

### A new document

The request starts from a minimal document that carries the interface's name
and the source:

```json
{
  "interface": {
    "openbindings": "0.2.0",
    "name": "Text tools",
    "operations": {},
    "sources": {"text": {"kind": "example.text@1"}}
  },
  "source": "text"
}
```

A puller that represents both targets returns:

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
      "repeatText": {"operation": "repeat", "source": "text", "data": "echo"},
      "countText": {"operation": "count", "source": "text", "data": "length"}
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

The report is exhaustive and omits nothing, so the result is a complete pull.
Neither entry has `uses`, because each operation declares its own schemas. The
added keys are example choices, not a naming algorithm required by this
interface. Inserting the additions gives the pulled document:

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
  "sources": {"text": {"kind": "example.text@1"}},
  "bindings": {
    "repeatText": {"operation": "repeat", "source": "text", "data": "echo"},
    "countText": {"operation": "count", "source": "text", "data": "length"}
  }
}
```

A caller that wants only `echo` keeps the `repeatText` entry: it inserts
`repeatText` and `repeat` and discards `countText` and `count`. The JSON
interface carries this request and result as `pullSource.examples.textTools`.

### A partial result

A puller that represents only `echo`, and cannot confirm that the kind offers
no further targets, answers the same request by adding only `repeat` and
`repeatText`, with this report:

```json
{
  "exhaustive": false,
  "limitation": {
    "code": "example.inventory-unconfirmed",
    "message": "This puller cannot confirm the kind's full target list, so further targets may exist."
  },
  "added": [
    {"binding": "repeatText", "operation": "repeat"}
  ],
  "omitted": [
    {
      "status": "implementation-unsupported",
      "reasonCode": "example.length-unavailable",
      "message": "This puller does not generate the length target.",
      "details": {"target": "length"}
    }
  ]
}
```

The non-exhaustive report and the `implementation-unsupported` omission each
mean the result is not a complete pull. The omission's `details` describe the
target; they are not an address. Had a rule of the kind excluded `length`, that
omission would instead be `excluded` with its `rule`, and an exhaustive report
would then be a complete pull. The complete response appears in
`pullSource.examples.partialTextTools`.

### An existing document

This document binds `echo` as `repeatText`. It also has a binding `shoutText`
whose data, `"shout"`, names a target the kind does not offer:

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
  "sources": {"text": {"kind": "example.text@1"}},
  "bindings": {
    "repeatText": {"operation": "repeat", "source": "text", "data": "echo"},
    "shoutText": {"operation": "shout", "source": "text", "data": "shout"}
  }
}
```

Pulling `text` into it adds only `length`:

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
      "countText": {"operation": "count", "source": "text", "data": "length"}
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
result is a complete pull. The JSON interface carries this request and result
as `pullSource.examples.existingTextTools`.

### A stale binding

Suppose a document binding both targets declared no output schema for
`repeat`:

```json
{"description": "Return the input string.", "input": {"type": "string"}}
```

A puller that would write `repeat` with its output schema reports `repeatText`
as stale, with a proposal carrying only the output and the kind's judgment of
the change:

```json
{
  "binding": "repeatText",
  "status": "stale",
  "change": "non-breaking",
  "message": "The operation declares no output schema; the kind would declare a string.",
  "proposal": {"output": {"type": "string"}}
}
```

The binding data is unchanged, so the proposal has no `data`, and it needs no
additions, so it has no `uses`. Nothing is added for `echo`. To apply, the
caller copies the proposed output onto `repeat`. Had the document declared an
output the kind would no longer declare, the proposal would instead be
`{"remove": ["output"]}`, and the caller would delete `repeat`'s output. The complete response, with
`countText` current beside it, appears in `pullSource.examples.staleTextTools`.

### A reused operation

A document whose `repeat` is already realized through another source of the
same kind, `legacy`, gains a second source `text`. Pulling `text` offers
`repeat` with the same input and output as the existing operation, so the pull
binds `text` to it and says so, adding no second operation; `count` is new:

```json
{
  "exhaustive": true,
  "added": [
    {"binding": "repeatText", "operation": "repeat", "reused": true},
    {"binding": "countText", "operation": "count"}
  ]
}
```

Had the offered `repeat` differed in shape, the entry would instead be
`omitted` as a `conflict`, and the author would bind `text` to `repeat` by hand
or add it under another key. The complete response appears in
`pullSource.examples.reusedTextTools`.

These are values exchanged with an implementation that adopts the operation.
The published interface URL describes the operation; it is not an invocation
endpoint and does not choose a provider or transport.

## Adopting the operation

An implementation offering `pullSource` can use
`openbindings.source-puller.pullSource` as its operation key or alias. It
describes compatible input and output shapes and supplies its own binding. For
example, a local operation named `pull` can carry:

```json
{"aliases": ["openbindings.source-puller.pullSource"]}
```

That fragment is an alias declaration, not a complete operation or OBI. The
shared name is the author's correspondence claim, not proof of behavior. Which
kinds an implementation can pull is not queryable through this interface.
