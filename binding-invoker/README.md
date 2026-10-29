# Binding Invoker

A binding invoker knows how to invoke bindings governed by specific kinds. Given an OpenBindings interface document, the key of one binding in it, and a way to receive input, it makes the concrete call as the binding's kind defines it and exposes a typed I/O channel for the caller to write inputs and read outputs. Binding content may be absent or any JSON value; a present null is never converted to absence. No generic location or selector field is required.

The binding's kind supplies the meaning, whether written down or defined only
in code. An artifact or protocol authority applies only to the extent that
meaning incorporates it. Where a written definition leaves a case open, an
invoker may complete it locally, but must not present that completion as shared
portable meaning. This contract supplies no new core field for such behavior.

## Adoption and kind support

The [publication boundary](../#publication-boundary) applies. These are voluntarily
adopted operation descriptions; no native SDK or execution architecture is required.
`checkKindSupport` returns one verdict per distinct requested kind, in request
first-occurrence order. Kind equality is exact; support is per job and need not
cover every case. `listSupportedKinds` is advisory and lists positively supported
kinds. Neither query performs the requested binding operation. Detection is private.

## Why it's called a *binding* invoker

A binding invoker runs one named binding of a supplied document. `BindingInvocationInput` carries the document as `interface` and the key of the binding to run as `binding`; both are required. The invoker selects no binding and validates no values. A key that names no binding in the document is `ERR_BINDING_NOT_FOUND`. The schema describes the initial payload; its open document schema is not a complete document-conformance check. Admission of malformed documents and requests is implementation policy; it does not make them conformant.

The binding's `kind` gives its content meaning. A kind may use a selector, a location, a reference into the document, transformations, or none of these; this interface does not invent their representation. Its peer, the [operation invoker](../operation-invoker/), resolves an operation name or alias, selects among the operation's bindings, and validates values against the operation's schemas.

## What the invoker reads

The invoker reads the binding's content and whatever in the document that content refers to, as the binding's kind defines, and it reads nothing else on the kind's behalf. In particular, it does not read the operation declaration: adaptation that needs an operation's schemas is expressed in content, which may refer to them. Content preserves absence versus JSON null. The binding's other core fields keep their core meanings; x- members are extensions.

The `interface` member is the document itself, carried inline, never a pointer into a store or registry. Because it is a value, the caller may send a smaller document as long as it preserves the binding's meaning. This interface prescribes no slicing algorithm.

Binding invocation exchanges caller-facing values. Context carries runtime
prerequisites. Acquiring what content refers to, caching, adaptation
implementation and preparation order are private implementation choices.
There is no required binding-invoker component inside another service.

## Context

A binding invocation usually needs more than the operation input. Credentials, headers, cookies, environment variables, session state, consent flags, custom invoker-specific values: all of it is **context**. Context is opaque to the contract and broader than auth. Credentials are one common kind, not the whole concept.

### Context carriage and lifecycle

The interface carries one opaque context object on each invocation. Where its values came from (a caller, a credential broker, a durable store, a short-lived session, or a composition of those) is outside the contract. A runtime that combines several sources decides precedence before calling the invoker and supplies the resulting object.

This separation is intentional. A stateless remote invoker, an in-process invoker with application-managed credentials, and a runtime backed by a [`document-store`](../document-store/) can all implement the same interface. None must expose storage to the invoker.

### Targets and context reuse

A `CONTEXT_REQUIRED` challenge reports a **target**: an opaque identifier for the concrete destination or context scope the invoker is about to use. A runtime may use that value to scope resolution or reuse, but key derivation, normalization, persistence, hierarchy, and cross-target sharing are runtime policy rather than this interface's semantics.

The target is an invoker assertion, not self-authenticating proof. A resolver decides what evidence and trust are sufficient before releasing a
reusable secret; the target string alone establishes neither. An in-process
resolver may deliberately treat its co-located invoker as trusted; a delegate
or hosted invoker normally requires an independently derived comparison. This
contract does not pretend that a generic resolver can validate an opaque
identifier without knowing the binding's kind.

When deriving storage keys, a runtime should avoid including userinfo and other secret material. Host normalization can also improve reuse across kinds. Those are implementation concerns, not a universal promise that every target is a URL or that every runtime has a store.

### Well-known context fields

Context is an opaque object, but these well-known field names provide cross-invoker interoperability:

| Field | Type | Purpose |
|---|---|---|
| `bearerToken` | `string` | Bearer token (OAuth2, JWT, etc.) |
| `apiKey` | `string` | API key (the single-key convenience) |
| `credentials` | `{ [name]: credential }` | General scheme-scoped credentials keyed by the requirement's artifact-authored `name`: bearer/API-key strings, Basic `{ username, password }`, or OAuth `{ accessToken, refreshToken?, expiresAt?, clientSecret? }` |
| `apiKeys` | `{ [name]: string }` | Historical named-API-key convenience; implementations accept it after `credentials[name]` and before the flat `apiKey` fallback |
| `basic` | `{ username, password }` | HTTP Basic credentials |
| `accessToken` / `refreshToken` / `expiresAt` | `string` | OAuth lifecycle |
| `headers` | `{ [k]: string }` | HTTP headers (per-target) |
| `cookies` | `{ [k]: string }` | HTTP cookies (per-target) |
| `environment` | `{ [k]: string }` | Environment variables (for exec-style invokers) |
| `metadata` | `{ [k]: any }` | Invoker-specific metadata (e.g., gRPC metadata) |
| `configuration` | `{ [point]: any }` | Per-invocation configuration-point values, keyed by point name; each point's defining authority supplies its meaning and consultation rules |

Implementations and callers may add fields for session state, consent, or other kind-specific needs. Fields without a meaning defined by the interface or kind have implementation-specific interpretation; this guide adds no handling policy.

**Security guidance.** Credential fields contain secrets; other context can be
sensitive too. Consumers should avoid disclosure through logs, diagnostics and
storage keys. Secret handling and trust checks are host responsibilities; the
interface describes the values and supplies no security implementation.

### Interactive resolution

Interactive resolution is deliberately outside this contract. An in-process implementation may accept host callbacks, a remote service may drive a flow server-side, and a headless caller may use pre-provisioned values. No callback vocabulary is standardized here because function references and user-interface capabilities do not cross every implementation boundary. Whatever mechanism is used, the resulting values enter the next attempt only through `context`.

## Context negotiation (CONTEXT_REQUIRED)

A binding often needs context the caller has not supplied: credentials, an approval, a configuration value. The OBI document does not declare these. Instead the invoker discovers them at call time and asks for them, so the same mechanism works for every kind and for prerequisites beyond auth.

When a binding cannot proceed because required context is missing, `invokeBinding` emits a terminal `error` frame with code `CONTEXT_REQUIRED` and a `ContextRequiredDetails` payload, **before** any `output` frame and **before** any observable effect of the requested operation on the target. That pre-execution guarantee is what makes resolve-and-retry safe for non-idempotent operations.

`ContextRequiredDetails` carries:

- `target`: the concrete destination or context scope asserted by the invoker. It is opaque to this contract. A runtime may compare it with independently derived information before releasing secrets; how it verifies, normalizes, or keys that value depends on the binding's kind and the runtime's trust model.
- `alternatives`: an **OR** of ways to satisfy the requirement. Each alternative carries `requirements`, an **AND** of `ContextRequirement`s. This OR-of-AND shape expresses real auth semantics a flat preference list cannot, e.g. "OAuth2 **OR** (apiKey **AND** clientCert)".

A `ContextRequirement` names a `type` (the resolver family) plus type-specific fields, and an optional `durable` flag:

- `durable: true`: the producer describes context as suitable for reuse; persistence and keying remain runtime decisions. This is a producer claim about safe reuse, not an instruction to persist a value.
- absent or `durable: false` (the default): the producer describes context as suitable only for the immediate attempt, without a safe-reuse claim. A one-shot user approval and a short-lived challenge response are not durable.

### Resolve and retry

On `CONTEXT_REQUIRED`, a runtime may:

1. Pick one `alternative` whose every `requirement` it can satisfy.
2. Resolve each requirement into context by whatever mechanism it owns.
3. Decide whether to retain or reuse values under its own policy. False or absent
   `durable` provides no safe-reuse claim; retention and reuse are different decisions.
4. Start a new `invokeBinding` attempt with the augmented context.

Retry limits and deciding whether another attempt is useful are caller policy. A binding MAY issue a fresh
`CONTEXT_REQUIRED` after supplied context proves unusable (for example, an
expired credential) only when its governing rules can still guarantee that no
output or observable operation side effect occurred. A native failure status
alone does not prove that guarantee. When it cannot prove the safe boundary,
the attempt completes unsuccessfully instead of being replayed automatically.

### Least privilege

The challenge describes context needed for one alternative. It is not permission
to disclose unrelated secrets. Supplying only the necessary values is recommended
security practice. The request carries context by value; the interface specifies
no private store access or storage architecture.

For a separate or third-party invoker, a caller can limit disclosure to the
chosen alternative and assess the asserted target before supplying context.
Those are host security decisions. The challenge does not establish trust or
grant access to a stored profile.

### Requirement types

`auth.*` is the first standard family and resolves into the well-known credential context fields:

| Requirement type | Resolves to | Typical flow |
|---|---|---|
| `auth.bearer` | `credentials[name]`, otherwise `bearerToken` | Prompt for a token. |
| `auth.oauth2` | `credentials[name]`, otherwise the flat OAuth fields beginning with `accessToken` | Drive the flow named by `grantType` (`authorization_code`, `implicit`, `password`, `client_credentials`) from `authorizeUrl` / `tokenUrl` / `scopes`. |
| `auth.basic` | `credentials[name]`, otherwise `basic` (`{ username, password }`) | Prompt for username and password. |
| `auth.apiKey` | `credentials[name]`, historical `apiKeys[name]`, otherwise `apiKey` | Prompt for a key. |

A requirement MAY carry a `name`, the scheme name as the referenced artifact declares it. It disambiguates two requirements of the same type within one alternative (two ANDed API keys are otherwise indistinguishable) and keys the scheme-scoped credential lookup.

`config.value` is the second standard family. It carries a configuration value a binding needs but the artifact does not supply: a server variable with no default, a channel address a service generates at runtime, a base URL for a document whose only server is the implied `/`. It exists so a missing-but-**resolvable** configuration value becomes a negotiable `CONTEXT_REQUIRED` instead of an ordinary unsuccessful completion caused by artifact configuration that no runtime can repair. Configuration is not automatically public; its sensitivity follows its meaning. A `config.value` requirement carries:

- `point`: the configuration point the binding's kind defines for this value (`server`, `address`, a kind's decode point, …).
- `path`: an RFC 6901 JSON Pointer evaluated from `configuration[point]`. The
  empty pointer denotes the whole point; `/variables/region` denotes a nested
  member, and `/value` denotes a member literally named `value`.
- `description`: human-readable prompt text.
- `schema` (optional): a standalone JSON Schema in object or Boolean form for
  the addressed value. Its default dialect is JSON Schema 2020-12; a root
  `$schema` can identify another dialect. References follow the applicable JSON
  Schema dialect, including resource boundaries introduced by `$id`. Neither the
  referenced artifact nor the OBI supplies an implicit reference environment. Absence states no constraint. For example, `enum`
  describes allowed values while `examples` merely suggests values. Evaluation,
  resource acquisition and handling unsupported schemas remain consumer choices.

It resolves into the `configuration` context field at the deterministic address
above. `durable` defaults to `false`; an invoker sets `durable: true` only when
reuse is safe. A runtime that cannot satisfy `config.value` simply cannot
select that alternative, exactly as for any other family.

Runtimes MAY define further families (`approval.user`, `account.link`, ...). An unrecognized `type` is simply unsatisfiable by a runtime that has no way to satisfy it; that alternative cannot be selected. An extension challenge claims that its requirements can be applied faithfully to the selected interaction. Handling an unsupported prerequisite is an implementation choice; it does not make that claim true.

### preflightBinding

`preflightBinding` takes the same input as `invokeBinding`'s opening payload. It tells a binding that an invocation of the same request may follow, and lets it report context requirements it can already identify from the binding's content, what that content refers to, and the supplied context. The result is a `ContextRequiredDetails` in the same shape a `CONTEXT_REQUIRED` challenge carries, or `null`. It is advisory: it may omit requirements, `null` is always conformant, and the live challenge remains authoritative. Invocation never requires a prior preflight. Context supplied to preflight is supplied for that call alone. Preflight never dispatches the requested operation, consumes its input, emits its outputs, or spends an approval for it; the boundary of the requested operation is the kind's, and anything else a binding does in response is for its kind to require and otherwise the implementation's. Requirements are reported only as the result; an unsuccessful completion means the binding could not answer and carries no prediction, except `ERR_REFUSED`, which means invocation would refuse the same input. Acquiring what the binding's content refers to, caching and other preparation are implementation choices under the binding's kind. The binding's kind governs the boundary of the requested operation; what an implementation does to answer is documented with that implementation.

## Unsuccessful completion

An `error` output frame means that the current invocation did not complete
normally. That structural distinction is the portable contract. It does not
imply a universal ontology for why every present or future kind can
complete unsuccessfully.

`InvocationError` therefore has a deliberately small shape:

- `code` identifies a reason. Only codes named by a rule of this interface or
  its operation-invoker peer or the binding's kind have
  portable semantics. Other strings are open implementation or extension
  identifiers; an ordinary caller does not need to interpret them to observe
  unsuccessful completion. Human-readable descriptions of interface-owned
  codes belong to their documentation and local SDK presentation, not the
  interoperable record.
- `data`, when present, is portable JSON data associated with the unsuccessful
  completion. A rule defining `code` may define its structure and semantics;
  otherwise the binding's kind may use it to preserve an
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
binding's content and what that content refers to. The binding's kind owns
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

This walkthrough defines an illustrative kind, `example.text@1`. Its binding
content is a string naming a text function: `echo` returns its input string, and
`length` counts its input string's Unicode code points. The content refers to
nothing else in the document. These choices belong only to this example.

A document with two bindings of this kind:

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
  "bindings": {
    "repeatText": {
      "operation": "repeat",
      "kind": "example.text@1",
      "content": "echo"
    },
    "countText": {
      "operation": "count",
      "kind": "example.text@1",
      "content": "length"
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
        "bindings": {
          "repeatText": {
            "operation": "repeat",
            "kind": "example.text@1",
            "content": "echo"
          },
          "countText": {
            "operation": "count",
            "kind": "example.text@1",
            "content": "length"
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

The invoker reads `repeatText`'s content, `echo`, under `example.text@1`. It
does not consult `repeat`'s schemas or select among the document's bindings.
Because `echo` refers to nothing else in the document, a smaller document
holding only `repeat` and `repeatText` would preserve the binding's meaning
equally well. Naming `countText` instead would run the other binding; a key
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
      "target": "example:text-service",
      "alternatives": [
        {
          "requirements": [
            {
              "type": "auth.bearer",
              "durable": false
            }
          ]
        }
      ]
    }
  }
}
```

This outcome describes no operation output or effects. It does not establish
that the asserted target is trustworthy. If the caller chooses to trust that
service and supply a token, a new attempt's opening payload can include
`"context": {"bearerToken": "example-token"}` alongside its interface and binding key.
The token here is a placeholder. Obtaining it, retaining it, and deciding whether
to retry are caller decisions. False `durable` makes no safe-reuse claim and says
nothing about how a caller stores an attempt.

### Reaching the same binding through an operation

The [operation-invoker examples](../operation-invoker/#walkthrough-document-addressing)
open the same document by operation name, binding key or ordered selection,
adding name resolution, binding selection and validation. Both interfaces use
the same subsequent value and terminal meanings; neither prescribes a native
handle or callback API.
