# Kind Descriptor

Describe the kinds an implementation reads: which kinds, for which operations,
what each kind's source data and binding data look like, and whether a
proposed source entry works under a kind. The implementation that reads a kind
is the authority on its shapes, whether the kind is defined in writing,
privately or only in code. The operations are offered for voluntary adoption;
the [publication boundary](../#publication-boundary) applies.

## Why it exists

A pull presupposes a source entry in the document, and writing one by hand
needs two things an author often lacks: the kind's exact name
(`example.openapi@1`, not "OpenAPI") and that kind's data shape. The convenient
path is tooling fed by the kind implementation itself. This interface is that
feed. It is also the home for the question the invocation and pull contracts
used to answer separately: which kinds does this implementation read, and for
what.

A kind reads exactly two shapes, its source data and its binding data, and no
interface asks it to read anything else. This interface describes those two
shapes; it does not add a third. Recognizing a kind from raw bytes or a URL is
deliberately not an operation here: its input would be a third shape, and the
convenience it buys is one question, which kind to use, answered by
`listKinds`.

## Operations

`listKinds` returns the kinds this implementation reads, each with the
operations it performs under the kind. `describeKind` returns one kind's
description, those operations, what its check does, and the schemas of its
source data and binding data. `checkSource` takes a proposed source entry and
returns the entry the kind stands behind. The first two are capability queries
and perform nothing under any kind; the third reads what the kind needs to
read and is disclosed by `describeKind`.

## Support is per operation

A kind is never supported in the abstract. An implementation reads a kind for
particular operations: it may invoke bindings of the kind, pull sources of the
kind, check entries of the kind, or any subset. `supports` therefore names
operations by their keys:

```json
{
  "kind": "example.openapi@1",
  "supports": [
    "openbindings.binding-invoker.invokeBinding",
    "openbindings.source-puller.pullSource",
    "openbindings.kind-descriptor.checkSource"
  ]
}
```

Listing a key is this implementation's claim for this kind and that operation;
absence makes no claim. A third party's operation may appear by its own key.
An implementation that invokes a kind without describing it is complete for
invocation; a caller that cannot ask learns by attempting. A catalog that
describes kinds and performs nothing under them may also carry this interface
alone, with empty `supports`.

## describeKind

The description is a brief overview of the kind, which may link its written
definition if one exists. `sourceData` is the schema of a `sources` entry's
`data` under the kind; `bindingData` is the schema of a binding's `data`.
Either may be absent: sources of a kind may carry no data, as a kind with a
fixed inventory has none to carry, and bindings of a kind may carry none.

The schemas are written to be filled. A kind author uses `oneOf` branches with
a `title` each for alternative forms, `required` for what must be given,
`description` for what a value is and where it comes from, `default` and
`enum` where they apply. An application renders the schema as prompts; an
agent fills it as it fills any schema; a value the schema accepts is valid
data for the kind. This is the same collector the context document's
challenge uses, so one schema-driven prompt serves both. Form-friendly schemas
(flat objects, titled branches) are a recommendation to kind authors, not a
rule. Which forms a kind offers, and what each means, is the kind's
definition: a kind may let a source embed a document, reference one at a URL,
or both, and the interface takes no stance.

`check` says what this implementation's `checkSource` does for the kind, in
one sentence a person reads and one boolean an application acts on:
`executes` is true when the check runs something the source data names, such
as starting a command, and false when it only reads. An application asks
before running a check that executes, showing the sentence. An absent `check`
means this implementation does not check entries of the kind.

## checkSource

The input is a proposed source entry, `{kind, data?, context?}`. The output is
the entry the kind stands behind: the data completed as the kind defines, for
example fetched and embedded, defaults filled or normalized, with a
description the kind derives from what it read. The output's `kind` equals the
input's. Every form the input can take is valid source data under the kind's
schema; the check completes the forms that ask for completion and returns the
others as they are.

An application records what the check returns and never interprets the data
itself. What the kind consults to check an entry, including anything outside
the document that the data names, is the kind's definition, disclosed through
`describeKind`.

A kind that needs values it was not given, as when a description sits behind
sign-in, completes unsuccessfully with `CONTEXT_REQUIRED` and the
[context document's](../context/) challenge, `{message, schema}`, as its data;
a later call supplies the values as `context`. An entry the kind rejects
completes unsuccessfully with a message a person can read and a code the kind
or the implementation defines; this interface owns no code for it. A kind this
implementation does not check completes unsuccessfully. Checking changes no
document and performs none of the source's operations.

## Walkthrough: text tools

The illustrative kind `example.text@1` has a fixed inventory of two targets,
`echo` and `length`. Its sources carry no data; a binding's data names a
target. An implementation that invokes, pulls and checks it lists it:

```json
{
  "kind": "example.text@1",
  "description": "A fixed set of text functions.",
  "supports": [
    "openbindings.binding-invoker.invokeBinding",
    "openbindings.source-puller.pullSource",
    "openbindings.kind-descriptor.checkSource"
  ]
}
```

Describing it returns no `sourceData`, a `bindingData` schema that is a string
enumerating the two targets, and a check that reads nothing:

```json
{
  "kind": "example.text@1",
  "description": "A fixed set of text functions: echo returns its input string and length counts its Unicode code points. Each becomes an operation; a binding's data names the function.",
  "supports": ["openbindings.binding-invoker.invokeBinding", "openbindings.source-puller.pullSource", "openbindings.kind-descriptor.checkSource"],
  "check": {"description": "Confirms the kind is known and derives the source's description. Reads nothing.", "executes": false},
  "bindingData": {"type": "string", "title": "The text function", "enum": ["echo", "length"]}
}
```

Checking `{"kind": "example.text@1"}` returns
`{"kind": "example.text@1", "description": "Text tools"}`, which an application
writes into the document's `sources` under the key the author chose. A pull of
that source then adds the two operations and their bindings. The JSON
interface carries these values as `listKinds.examples.builtIn`,
`describeKind.examples.textTools` and `checkSource.examples.textSource`.

### A kind with a document

`describeKind.examples.openapi` describes an illustrative OpenAPI kind whose
source schema offers three forms as titled `oneOf` branches: reference the
document at a URL, embed the document fetched from a URL, or embed a document
you have. An application shows the three titles as a menu and prompts for the
chosen branch's members without knowing what any of them mean.
`checkSource.examples.openapiFetch` shows the fetch form completed into the
embedded form, the URL not kept; `checkSource.examples.openapiReference` shows
the reference form returned as it is, with a description derived from what the
check read at the origin. That this kind treats an embedded document as the
source and never re-fetches it is the kind's definition, stated in its
description; another kind may define its data differently.

## Adopting the operations

An implementation that reads kinds carries this interface beside the
[binding invoker](../binding-invoker/) and the [source puller](../source-puller/)
it implements, using `openbindings.kind-descriptor.listKinds`,
`openbindings.kind-descriptor.describeKind` and
`openbindings.kind-descriptor.checkSource` as operation keys or aliases. For
example, a local operation named `kinds` can carry:

```json
{"aliases": ["openbindings.kind-descriptor.listKinds"]}
```

That fragment is an alias declaration, not a complete operation or OBI. The
shared name is the author's correspondence claim, not proof of behavior.
Correspondence is per operation: an implementation may carry `listKinds` and
`describeKind` without `checkSource`, and its descriptions then carry no
`check`.
