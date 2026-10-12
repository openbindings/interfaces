# Binding Invoker

A binding invoker knows how to invoke bindings governed by specific kinds. Given an OBI source (`kind` and optional `content`), a binding object, and a way to receive input, it makes the concrete call as the source's kind defines it and exposes a typed I/O channel for the caller to write inputs and read outputs. Source and binding content may each be absent or any JSON value; a present null is never converted to absence. No generic location or selector field is required.

The source's kind supplies the meaning, whether written down or defined only
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

A binding invoker takes `(source, binding)` directly. It invokes **by value**: the caller supplies the two objects without an OBI document or a binding lookup. `BindingInvocationInput` requires both members; a binding without content is `binding: {}`. The schema describes the initial payload; malformed-request handling is implementation policy.

The source's `kind` selects the interpretation of both content values. A kind may use a selector, a location, transformations, or none of these; this interface does not invent their representation. Its peer, the [operation invoker](../operation-invoker/), receives an interface and resolves an operation or binding **by reference**.

## Sources and bindings by value

Sources and bindings are OpenBindings 0.2 values. Their core fields have their core meanings and types; x- members are extensions. Source and binding content preserve absence versus JSON null and are interpreted under the source's exact kind. The open carrier schemas are not complete document-conformance checks. Handling malformed carriers is implementation policy; it does not make those carriers conformant.

Binding invocation interprets the supplied source and binding under their kind
and exchanges caller-facing values. Context carries runtime prerequisites.
The operation declaration and its schemas are not supplied. Loading, caching,
adaptation implementation and preparation order are private implementation choices.
There is no required binding-invoker component inside another service.

## Context

A binding invocation usually needs more than the operation input. Credentials, headers, cookies, environment variables, session state, consent flags, custom invoker-specific values: all of it is **context**. Context is opaque to the contract and broader than auth. Credentials are one common kind, not the whole concept.

### Context carriage and lifecycle

The interface carries one opaque context object on each invocation. Where its values came from — a caller, a credential broker, a durable store, a short-lived session, or a composition of those — is outside the contract. A runtime that combines several sources decides precedence before calling the invoker and supplies the resulting object.

This separation is intentional. A stateless remote invoker, an in-process invoker with application-managed credentials, and a runtime backed by a [`document-store`](../document-store/) can all implement the same interface. None must expose storage to the invoker.

### Targets and context reuse

A `CONTEXT_REQUIRED` challenge reports a **target**: an opaque identifier for the concrete destination or context scope the invoker is about to use. A runtime may use that value to scope resolution or reuse, but key derivation, normalization, persistence, hierarchy, and cross-target sharing are runtime policy rather than this interface's semantics.

The target is an invoker assertion, not self-authenticating proof. A resolver decides what evidence and trust are sufficient before releasing a
reusable secret; the target string alone establishes neither. An in-process
resolver may deliberately treat its co-located invoker as trusted; a delegate
or hosted invoker normally requires an independently derived comparison. This
contract does not pretend that a generic resolver can validate an opaque
identifier without knowing the source's kind.

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

- `target`: the concrete destination or context scope asserted by the invoker. It is opaque to this contract. A runtime may compare it with independently derived information before releasing secrets; how it verifies, normalizes, or keys that value depends on the source's kind and the runtime's trust model.
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

A requirement MAY carry a `name` — the scheme name as the source artifact declares it — which disambiguates two requirements of the same type within one alternative (two ANDed API keys are otherwise indistinguishable) and keys the scheme-scoped credential lookup.

`config.value` is the second standard family. It carries a configuration value a binding needs but the artifact does not supply — a server variable with no default, a channel address a service generates at runtime, a base URL for a document whose only server is the implied `/`. It exists so a missing-but-**resolvable** configuration value becomes a negotiable `CONTEXT_REQUIRED` instead of an ordinary unsuccessful completion caused by source configuration that no runtime can repair. Configuration is not automatically public; its sensitivity follows its meaning. A `config.value` requirement carries:

- `point` — the configuration point the source's kind defines for this value (`server`, `address`, a kind's decode point, …).
- `path` — an RFC 6901 JSON Pointer evaluated from `configuration[point]`. The
  empty pointer denotes the whole point; `/variables/region` denotes a nested
  member, and `/value` denotes a member literally named `value`.
- `description` — human-readable prompt text.
- `schema` (optional) — a standalone JSON Schema in object or Boolean form for
  the addressed value. Its default dialect is JSON Schema 2020-12; a root
  `$schema` can identify another dialect. References follow the applicable JSON
  Schema dialect, including resource boundaries introduced by `$id`. Neither the
  source artifact nor the OBI supplies an implicit reference environment. Absence states no constraint. For example, `enum`
  describes allowed values while `examples` merely suggests values. Evaluation,
  resource acquisition and handling unsupported schemas remain consumer choices.

It resolves into the `configuration` context field at the deterministic address
above. `durable` defaults to `false`; an invoker sets `durable: true` only when
reuse is safe. A runtime that cannot satisfy `config.value` simply cannot
select that alternative, exactly as for any other family.

Runtimes MAY define further families (`approval.user`, `account.link`, ...). An unrecognized `type` is simply unsatisfiable by a runtime that has no way to satisfy it; that alternative cannot be selected. An extension challenge claims that its requirements can be applied faithfully to the selected interaction. Handling an unsupported prerequisite is an implementation choice; it does not make that claim true.

### preflightBinding

`preflightBinding` tells a binding that an invocation of this selection may follow, and lets it report context requirements it can already identify from the source and the supplied context. The result is a `ContextRequiredDetails` in the same shape a `CONTEXT_REQUIRED` challenge carries, or `null`. It is advisory: it may omit requirements, `null` is always conformant, and the live challenge remains authoritative. Invocation never requires a prior preflight. Context supplied to preflight is supplied for that call alone. Preflight never dispatches the requested operation, consumes its input, emits its outputs, or spends an approval for it; the boundary of the requested operation is the kind's, and anything else a binding does in response is for its kind to require and otherwise the implementation's. Requirements are reported only as the result; an unsuccessful completion means the binding could not answer and carries no prediction, except `ERR_REFUSED`, which means invocation would refuse the same input. The source's kind governs the boundary of the requested operation; what an implementation does to answer is documented with that implementation.

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
mechanics. Their spellings are reserved and a source's kind
cannot redefine them with conflicting meaning:

| Code | Meaning |
|---|---|
| `CONTEXT_REQUIRED` | The binding requests the `ContextRequiredDetails` carried in `data`. The attempt produced no operation output and no observable effect of the requested operation. |
| `ERR_FRAME_PROTOCOL` | The caller or peer violated this interface's frame protocol. |
| `ERR_TRANSPORT_CLOSED` | The outer transport closed before a terminal frame arrived. |
| `ERR_CANCELLED` | The caller cancelled the invocation. |
| `ERR_REFUSED` | Unsuccessful completion asserting that **no observable effect of the requested operation occurred**. It makes no claim about whether a protocol request was sent. Whether to trust it or retry remains caller policy. |
| `ERR_EXECUTION_FAILED` | Generic unsuccessful completion when no more specific portable code is owned by a governing rule. It deliberately implies no cause, blame, retry, authentication, or availability semantics, and carries **no dispatch-state claim**: dispatch and effects remain possible. |

The operation-invoker interface and each source's kind own
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

Binding invocation is by value. It neither selects a binding from an OBI nor
interprets an operation declaration it has not received. Kind interpretation owns
value adaptation. Context storage, acquisition, enrichment, trust and retry policy
are outside this interface. No copy operation, storage architecture or component
boundary is prescribed.

## Frame exchange

The caller sends an open frame carrying the invocation request, followed by input frames and an optional close. close means no further input values; input_closed reports that the invoked binding is no longer accepting input. Repeated close has the same meaning. A caller close is unnecessary when input has already closed or the invocation has ended. The service returns output and input_closed frames followed by one terminal complete or error. complete reports successful completion; error reports unsuccessful completion. No further frames belong to the invocation after its terminal frame. An output value alone does not report success. A late failure does not retract values already delivered or assert that no effects occurred.

Frame schemas describe the messages. Handling malformed frames, late inputs or interrupted transports is implementation policy; ERR_FRAME_PROTOCOL and ERR_TRANSPORT_CLOSED identify those reported failures. The interface does not prescribe parser order, buffer admission, internal terminal-race arbitration, queue draining, polling or handle disposal. ERR_CANCELLED reports cancellation without promising rollback or that external work has stopped.

The operation exchanges frames; it does not return a prescribed native handle.
Rust futures, TypeScript iterators, scheduling, backpressure, queues, connection
pools and cancellation mechanics belong to implementations. Cardinality follows
the chosen binding's interaction; this interface does not require every provider
to support every streaming pattern. A consumer interprets complete and error as
terminal outcomes; returning the first output alone does not establish success.

## Walkthrough: values and outcomes

Use the `echo` binding from the [illustrative text example](../source-inspector/#walkthrough-inspect-and-author).
The arrays below display successive frame values for readability. They are not
array-valued operation inputs or a prescribed transport envelope. The same
values can be exchanged by a library or a remote service; scheduling and
transport are implementation choices.

One possible caller exchange is:

```json
[
  {
    "kind": "open",
    "input": {
      "source": {
        "kind": "example.text@1"
      },
      "binding": {
        "content": "echo"
      }
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
`"context": {"bearerToken": "example-token"}` alongside its source and binding.
The token here is a placeholder. Obtaining it, retaining it, and deciding whether
to retry are caller decisions. False `durable` makes no safe-reuse claim and says
nothing about how a caller stores an attempt.

### Addressing the same call through a document

The [operation-invoker examples](../operation-invoker/#walkthrough-document-addressing)
show the other opening payload. Both roles use the same subsequent value and
terminal meanings; neither role prescribes a native handle or callback API.
