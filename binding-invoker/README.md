# Binding Invoker

A binding invoker knows how to invoke bindings whose sources are of specific kinds. Given an OpenBindings interface document, the key of one binding in it, and a way to receive input, it makes the concrete call as the kind of the binding's source defines it and exposes a typed I/O channel for the caller to write inputs and read outputs. A binding's data and its source's data may each be absent or any JSON value; a present null is never converted to absence. No generic location or selector field is required.

The source's kind supplies the meaning, whether written down or defined only
in code. An artifact or protocol authority applies only to the extent that
meaning incorporates it. Where a written definition leaves a case open, an
invoker may complete it locally, but must not present that completion as shared
portable meaning. This contract supplies no new core field for such behavior.

## Adoption and kind support

The [publication boundary](../#publication-boundary) applies. These are voluntarily
adopted operation descriptions; no native SDK or execution architecture is required.
Which kinds an invoker reads is answered by the [kind descriptor](../kind-descriptor/),
whose `listKinds` and `describeKind` an invoker implementation may carry beside
this interface; a kind is supported for invocation when that listing names
`openbindings.binding-invoker.invokeBinding` under it. Kind equality is exact,
and support need not cover every case. An invoker that carries no descriptor
is complete for invocation; a caller that cannot ask learns by attempting.

## Why it's called a *binding* invoker

A binding invoker runs one named binding of a supplied document. `BindingInvocationInput` carries the document as `interface` and the key of the binding to run as `binding`; both are required. The invoker selects no binding and validates no values. A key that names no binding in the document is `ERR_BINDING_NOT_FOUND`. The schema describes the initial payload; its open document schema is not a complete document-conformance check. Admission of malformed documents and requests is implementation policy; it does not make them conformant.

A binding names a `source`; the source's `kind` gives the source's data and the binding's data their meaning. A kind may use a selector, a location, a reference into the document, transformations, or none of these; this interface does not invent their representation. Its peer, the [operation invoker](../operation-invoker/), resolves an operation name or alias, selects among the operation's bindings, and validates values against the operation's schemas.

## What the invoker reads

The invoker reads the binding's data, the data of the source the binding names, and whatever those refer to, as the source's kind defines, and it reads nothing else on the kind's behalf. In particular, it does not read the operation declaration: adaptation that needs an operation's schemas is expressed in binding data, which may refer to them. Data preserves absence versus JSON null. The binding's and the source's other core fields keep their core meanings; x- members are extensions.

The `interface` member is the document itself, carried inline, never a pointer into a store or registry. Because it is a value, the caller may send a smaller document as long as it preserves the binding's meaning. This interface prescribes no slicing algorithm.

Binding invocation exchanges caller-facing values. Context carries runtime
prerequisites. Acquiring what the data refers to, caching, adaptation
implementation and preparation order are private implementation choices.
There is no required binding-invoker component inside another service.

## Context

A binding invocation usually needs more than the operation input: a credential,
an approval, a configuration value the artifact does not supply. All of it is
**context**. Context is opaque to this contract and broader than auth. The
[context document](../context/) defines the context object, the challenge and
the acquisition annotation; this section says how they apply to invocation.

### Context carriage

The caller provides one opaque context object on each attempt, by value. Where
its values came from (the caller, a store, a credential broker, a previous
challenge answered) is outside the contract. A runtime that combines several
sources decides precedence before calling the invoker and supplies the
resulting object. This interface defines no member of the object: its members
are whatever a challenge's schema described or the caller knows the source's
kind reads. How the kind uses a value, in a header, a cookie, a handshake,
stays inside the kind's implementation.

A stateless remote invoker, an in-process invoker with application-managed
credentials, and a runtime backed by a [`document-store`](../document-store/)
can all implement the same interface. None must expose storage to the invoker.

### Interactive acquisition

Interactive acquisition is deliberately outside this contract. An in-process
implementation may accept host callbacks, a remote service may drive a flow
server-side, and a headless caller may use pre-provisioned values. No callback
vocabulary is standardized here because function references and user-interface
capabilities do not cross every implementation boundary. Whatever mechanism is
used, the resulting values enter the next attempt only through `context`.

## Context negotiation (CONTEXT_REQUIRED)

A binding often needs context the caller has not supplied. The OBI document
does not declare it. Instead the invoker discovers the need at call time and
asks for it, so the same mechanism works for every kind and for prerequisites
beyond auth.

When a binding cannot proceed because required context is missing,
`invokeBinding` emits a terminal `error` frame with code `CONTEXT_REQUIRED` and
the context document's challenge as its `data`, **before** any `output` frame
and **before** any observable effect of the requested operation on the target.
That pre-execution guarantee is what makes acquire-and-retry safe for
non-idempotent operations. It is this interface's own promise, not part of the
context document.

The challenge is `{message, schema}`:

- `message` says why, in the binding's words, for a person to read.
- `schema` is a JSON Schema of the context object to supply on the next
  attempt. Alternatives are `oneOf` branches with a `title` each, values
  needed together are `required`, secrets are `writeOnly`, and a property
  `description` says where a person obtains a value. A property may carry the
  context document's `oauth2` annotation, which an application can act on.

The kind holds those facts; the application acquires the values; the kind
consumes them on the next attempt. Nothing outside the schema is asked for.

### Acquire and retry

On `CONTEXT_REQUIRED`, a runtime may:

1. Read the `message` and the `schema`, and pick one branch it can satisfy.
2. Acquire each value by whatever mechanism it owns: look it up, ask a person,
   run the flow an annotation describes.
3. Decide whether to keep what it acquired, under its own policy. The challenge
   makes no claim about reuse.
4. Start a new `invokeBinding` attempt with the context object.

Retry limits and deciding whether another attempt is useful are caller policy.
A binding MAY issue a fresh `CONTEXT_REQUIRED` after supplied context proves
unusable (for example, an expired credential) only when its governing rules can
still guarantee that no output or observable operation side effect occurred. A
native failure status alone does not prove that guarantee. When it cannot prove
the safe boundary, the attempt completes unsuccessfully instead of being
replayed automatically.

### Least privilege

The challenge describes context needed for one attempt. It is not permission to
disclose anything else: supply what the schema asks and nothing else. The
request carries context by value; the interface specifies no private store
access or storage architecture.

For a separate or third-party invoker, a caller decides what it is willing to
provide to that invoker before providing it. That is a host security decision.
The challenge does not establish trust or grant access to a stored profile.

### preflightBinding

`preflightBinding` takes the same input as `invokeBinding`'s opening payload. It tells a binding that an invocation of the same request may follow, and lets it report the challenge it can already identify from the binding's data, its source's data, what those refer to, and the supplied context. The result is the same `{message, schema}` challenge a `CONTEXT_REQUIRED` frame carries, or `null`. It is advisory: it may omit requirements, `null` is always conformant, and the live challenge remains authoritative. Invocation never requires a prior preflight. Context supplied to preflight is supplied for that call alone. Preflight never dispatches the requested operation, consumes its input, emits its outputs, or spends an approval for it; the boundary of the requested operation is the kind's, and anything else a binding does in response is for its kind to require and otherwise the implementation's. Requirements are reported only as the result; an unsuccessful completion means the binding could not answer and carries no prediction, except `ERR_REFUSED`, which means invocation would refuse the same input. Acquiring what the binding's data and its source's data refer to, caching and other preparation are implementation choices under the source's kind. The source's kind governs the boundary of the requested operation; what an implementation does to answer is documented with that implementation.

## Unsuccessful completion

An `error` output frame means that the current invocation did not complete
normally. That structural distinction is the portable contract. It does not
imply a universal ontology for why every present or future kind can
complete unsuccessfully.

`InvocationError` therefore has a deliberately small shape:

- `code` identifies a reason. Only codes named by a rule of this interface or
  its operation-invoker peer or the source's kind have
  portable semantics. Other strings are open implementation or extension
  identifiers; an ordinary caller does not need to interpret them to observe
  unsuccessful completion. Human-readable descriptions of interface-owned
  codes belong to their documentation and local SDK presentation, not the
  interoperable record.
- `data`, when present, is portable JSON data associated with the unsuccessful
  completion. A rule defining `code` may define its structure and semantics;
  otherwise the source's kind may use it to preserve an
  opaque application-authored failure value. `CONTEXT_REQUIRED` uses it for a
  `ContextRequiredDetails` object. Presence is significant: an absent member
  means no portable associated value, while `"data": null` is a present JSON
  null. Statuses, headers, trailers, envelopes, raw debugging bytes, exception
  prose, stacks, and implementation evidence do not belong here unless an
  explicit governing rule makes them application data.

The record has no portable presentation string and no diagnostic escape hatch.
A binding implementation may use protocol-native facts internally to determine
the correct code, application value, and lifecycle, but those facts do not
cross this abstraction boundary. Artifact-specific clients, logs, traces, and
protocol tooling remain the places to inspect them.

The binding-invoker-owned codes are exactly those required by its own
mechanics. Their spellings are reserved and a kind
cannot redefine them with conflicting meaning:

| Code | Meaning |
|---|---|
| `ERR_BINDING_NOT_FOUND` | The requested `binding` key names no binding in the supplied interface. The operation invoker also reports this code, with a broader meaning. |
| `CONTEXT_REQUIRED` | The binding requests the `ContextRequiredDetails` carried in `data`. The attempt produced no operation output and no observable effect of the requested operation. |
| `ERR_FRAME_PROTOCOL` | The caller or peer violated this interface's frame protocol. |
| `ERR_TRANSPORT_CLOSED` | The outer transport closed before a terminal frame arrived. |
| `ERR_CANCELLED` | The caller cancelled the invocation. |
| `ERR_REFUSED` | Unsuccessful completion asserting that **no observable effect of the requested operation occurred**. It makes no claim about whether a protocol request was sent. Whether to trust it or retry remains caller policy. |
| `ERR_EXECUTION_FAILED` | Generic unsuccessful completion when no more specific portable code is owned by a governing rule. It deliberately implies no cause, blame, retry, authentication, or availability semantics, and carries **no dispatch-state claim**: dispatch and effects remain possible. |

The operation-invoker interface and each kind own
the additional codes they explicitly define. Implementations may use further
codes where those authorities are silent, but such codes are implementation
behavior rather than portable contract meaning. Community convergence around
an underdefined case is a reason to tighten the kind's definition, not
to infer a hidden universal taxonomy. This contract assigns additional codes
no portable category, retry disposition, or protocol-status mapping. Retry and side-effect
policy belong to the caller and SDK layer. `ERR_REFUSED` asserts no observable
operation effects; `CONTEXT_REQUIRED` additionally asserts no operation output.
Neither says whether a protocol request was sent. For example, a kind may know
that a remote authentication rejection occurred before any operation effects.
`ERR_EXECUTION_FAILED` asserts no such boundary. These meanings describe the
reported outcome, not a required way of detecting it. Artifact runtimes, protocol-native
clients, logs, and traces may preserve native evidence below the OpenBindings
invocation boundary, but the error frame never carries that evidence and
its local use is an implementation or application decision.

## Capability boundary

Binding invocation runs the one binding the caller names. It selects no
binding, validates no values, and reads nothing on the kind's behalf beyond the
binding's data, its source's data and what those refer to. The source's kind owns
value adaptation. Context storage, acquisition, enrichment, trust and retry policy
are outside this interface. No copy operation, storage architecture or component
boundary is prescribed.

## Frame exchange

The caller sends an open frame carrying the invocation request, followed by input frames and an optional close. close means no further input values; input_closed reports that the invoked binding is no longer accepting input. Repeated close has the same meaning. A caller close is unnecessary when input has already closed or the invocation has ended. The service returns output and input_closed frames followed by one terminal complete or error. complete reports successful completion; error reports unsuccessful completion. No further frames belong to the invocation after its terminal frame. An output value alone does not report success. A late failure does not retract values already delivered or assert that no effects occurred.

Frame schemas describe the messages. Handling malformed frames, late inputs or interrupted transports is implementation policy; ERR_FRAME_PROTOCOL and ERR_TRANSPORT_CLOSED identify those reported failures. The interface does not prescribe parser order, buffer admission, internal terminal-race arbitration, queue draining, polling or handle disposal. ERR_CANCELLED reports cancellation without promising rollback or that external work has stopped.

The operation exchanges frames; it does not return a prescribed native handle.
Rust futures, TypeScript iterators, scheduling, backpressure, queues, connection
pools and cancellation mechanics belong to implementations. Cardinality follows
the named binding's interaction; this interface does not require every provider
to support every streaming pattern. A consumer interprets complete and error as
terminal outcomes; returning the first output alone does not establish success.

## Walkthrough: values and outcomes

This walkthrough defines an illustrative kind, `example.text@1`. A source of
this kind carries no data; a binding's data is a string naming a text function:
`echo` returns its input string, and `length` counts its input string's Unicode
code points. The data refers to nothing else in the document. These choices
belong only to this example.

A document with one source of this kind and two bindings naming it:

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
    },
    "count": {
      "description": "Count Unicode code points in the input string.",
      "input": {
        "type": "string"
      },
      "output": {
        "type": "integer",
        "minimum": 0
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
      "data": "echo"
    },
    "countText": {
      "operation": "count",
      "source": "text",
      "data": "length"
    }
  }
}
```

The arrays below display successive frame values for readability. They are not
array-valued operation inputs or a prescribed transport envelope. The same
values can be exchanged by a library or a remote service; scheduling and
transport are implementation choices.

One possible caller exchange runs `repeatText`. Its opening payload carries the
document above as `interface`, shown here in full:

```json
[
  {
    "kind": "open",
    "input": {
      "interface": {
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
          },
          "count": {
            "description": "Count Unicode code points in the input string.",
            "input": {
              "type": "string"
            },
            "output": {
              "type": "integer",
              "minimum": 0
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
            "data": "echo"
          },
          "countText": {
            "operation": "count",
            "source": "text",
            "data": "length"
          }
        }
      },
      "binding": "repeatText"
    }
  },
  {
    "kind": "input",
    "value": "Hello"
  },
  {
    "kind": "close"
  }
]
```

The invoker reads `repeatText`'s data, `echo`, under the kind of its source
`text`, `example.text@1`. It does not consult `repeat`'s schemas or select
among the document's bindings. Because `echo` refers to nothing else in the
document, a smaller document holding only `repeat`, `text` and `repeatText`
would preserve the binding's meaning equally well. Naming `countText` instead would run the other binding; a key
such as `shoutText`, which names no binding in the document, ends the attempt
with `ERR_BINDING_NOT_FOUND`.

One successful service exchange is:

```json
[
  {
    "kind": "output",
    "value": "Hello"
  },
  {
    "kind": "complete"
  }
]
```

`close` ends caller input; `complete` reports successful invocation completion.
A service could instead report an unsuccessful terminal outcome after an output:

```json
[
  {
    "kind": "output",
    "value": "Hello"
  },
  {
    "kind": "error",
    "error": {
      "code": "ERR_EXECUTION_FAILED"
    }
  }
]
```

The earlier value remains delivered. The terminal error does not assert that
there were no effects, and the interface does not choose the caller's recovery.
Individual frame examples are also included in `invokeBinding.examples` in the
JSON interface.

### A context challenge

A separate protected-service example can finish an attempt with:

```json
{
  "kind": "error",
  "error": {
    "code": "CONTEXT_REQUIRED",
    "data": {
      "message": "The text service needs an access token.",
      "schema": {
        "type": "object",
        "properties": {
          "accessToken": {
            "type": "string",
            "writeOnly": true,
            "description": "A bearer token for the text service."
          }
        },
        "required": ["accessToken"]
      }
    }
  }
}
```

This outcome describes no operation output or effects, and it does not
establish that the service is trustworthy. If the caller chooses to provide a
token, a new attempt's opening payload can include
`"context": {"accessToken": "example-token"}` alongside its interface and
binding key. The token here is a placeholder. Obtaining it, keeping it, and
deciding whether to retry are caller decisions; `writeOnly` says the value is a
secret and nothing about how a caller stores it.

### Reaching the same binding through an operation

The [operation-invoker examples](../operation-invoker/#walkthrough-document-addressing)
open the same document by operation name, binding key or ordered selection,
adding name resolution, binding selection and validation. Both interfaces use
the same subsequent value and terminal meanings; neither prescribes a native
handle or callback API.
