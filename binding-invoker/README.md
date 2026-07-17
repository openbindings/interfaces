# Binding Invoker

A binding invoker knows how to invoke bindings governed by specific binding specifications. Given a source (bindingSpec + location/content), a ref within that source, and a way to receive input, it makes the protocol-specific call — as the source's governing binding specification defines it — and exposes a typed I/O channel for the caller to write inputs and read outputs.

This is the core capability that makes OpenBindings protocol-agnostic. The developer calls a typed operation. The SDK finds the binding. The invoker handles the protocol. The developer never writes protocol-specific code.

## Why it's called a *binding* invoker

A binding invoker takes a `(source, ref)` directly — not an OBI document, and not a binding key. It invokes **by value**: you hand it the entire realization, and it needs no interface document to act. So, strictly, it isn't handed "a binding" in the document sense; it's handed a binding's invocable essence (the operation label and key that an OBI binding entry adds are discovery metadata the wire never needs).

The name still fits, and is the clearest available, for one reason: the `(bindingSpec, ref)` pattern only exists *because* OpenBindings defines sources and bindings. Outside the OpenBindings model you would not address a call as "a ref into a declared source," so naming it for that model is exactly right. Its peer — the one that takes an interface and a *key*, resolving an operation or a binding **by reference** — is the [operation invoker](../operation-invoker/).

## What an invoker does

When a binding invoker receives a `BindingInvocationInput`, it follows this lifecycle:

1. **Artifact loading.** Loads and caches the source artifact from the source's `location` or `content`, per its governing binding specification's carriage rules.
2. **Context resolution.** Reads stored context from the runtime's store, merges with per-call context. Per-call values take precedence. The invoker MUST operate on a copy; it MUST NOT mutate the caller's input.
3. **Context application.** Applies credentials, headers, cookies, and other context to the wire per the governing binding specification's published wire-application rules (each family's credentials section pins where each scheme's credential rides).
4. **Invocation.** Interprets the ref within the source artifact per the binding specification, maps writes to the interaction, makes the call, emits outputs back through the `Invocation` handle.
5. **Context negotiation.** If the binding cannot proceed because required context is missing, it fails with `CONTEXT_REQUIRED` enumerating what to satisfy; the runtime resolves the requirements into context, stores durable results, and retries.

## Context

A binding invocation usually needs more than the operation input. Credentials, headers, cookies, environment variables, session state, consent flags, custom invoker-specific values: all of it is **context**. Context is opaque to the contract and broader than auth. Credentials are one common kind, not the whole concept.

### Stored vs per-call

Context divides by lifecycle, not by content:

| | Stored context | Per-call context |
|---|---|---|
| **Lifecycle** | Persistent across calls | Single invocation |
| **Origin** | Resolved by the invoker (auth flows, manual configuration) | Supplied by the caller at invocation time |
| **Held by** | The runtime's store | The caller's `invokeBinding` input |

Both have the same shape. At invocation time the invoker loads stored context for the target, then layers per-call context on top.

### Targets, keys, and cross-invoker sharing

The invoker does not key or store context. It reports the **target** it is addressing (in the `CONTEXT_REQUIRED` challenge's `target`); the runtime derives a storage key from that target and reads/writes context under it. The runtime's convention is to **normalize to the API's host** (so `https://api.example.com` and `wss://api.example.com` resolve to `api.example.com`), which gives **cross-invoker sharing**: an OpenAPI invoker and an AsyncAPI invoker addressing the same service produce targets the runtime keys identically, so credentials resolved through one are available to the other. That keying is the runtime's policy, not the invoker's and not the store's.

The store itself is a generic [`document-store`](../document-store/) — `get` / `set` / `delete` over an opaque key and a whole JSON object. Its backend (in-memory, on-disk, OS keychain, hosted vault) and any management surface (listing, inspection, rotation, audit) are implementation-defined and outside that contract.

### Well-known context fields

Context is an opaque object, but for cross-invoker interoperability invokers SHOULD use well-known field names:

| Field | Type | Purpose |
|---|---|---|
| `bearerToken` | `string` | Bearer token (OAuth2, JWT, etc.) |
| `apiKey` | `string` | API key (the single-key convenience) |
| `apiKeys` | `{ [name]: string }` | Scheme-scoped API keys, keyed by the requirement's `name` (the artifact's scheme name) — for the alternative that ANDs several API keys; a scheme looks up its named entry first, then falls back to `apiKey` |
| `basic` | `{ username, password }` | HTTP Basic credentials |
| `accessToken` / `refreshToken` / `expiresAt` | `string` | OAuth lifecycle |
| `headers` | `{ [k]: string }` | HTTP headers (per-target) |
| `cookies` | `{ [k]: string }` | HTTP cookies (per-target) |
| `environment` | `{ [k]: string }` | Environment variables (for exec-style invokers) |
| `metadata` | `{ [k]: any }` | Invoker-specific metadata (e.g., gRPC metadata) |

Invokers can store anything else alongside (CSRF tokens, session IDs, consent flags), but the well-known fields are what make sharing across invokers actually work. The convention is extensible: new fields are adopted through ecosystem usage, no spec change needed.

### Platform callbacks

When stored context is insufficient and an **in-process** invoker needs interactive resolution, it can ask its host through **platform callbacks**: interactive functions the host supplies at construction. This is a convention, not part of the contract — live function references cannot cross a wire, so the contract carries no callbacks; it is an affordance a code-module implementation may surface so the host performs the interaction while the invoker stays protocol-focused.

The conventional callback seam covers the interactions auth flows need:

| Callback | Purpose | Example uses |
|---|---|---|
| `prompt` | Display a message, collect text input | API key entry, password, custom tokens |
| `browserRedirect` | Open a URL, capture the redirect callback | OAuth2, SAML, any browser-based auth |
| `confirmation` | Display a message, wait for yes/no | Terms of service, consent screens |
| `fileSelect` | Let the user pick a file | Client certificates, key files |

A host supplies whichever of these its environment can perform. If a callback the invoker needs is not provided, the invoker returns an error rather than blocking; a headless environment relies on pre-configured stored context instead.

Wire-form implementations cannot receive callbacks across the wire at all. They either drive auth flows server-side themselves, or expect callers to pre-resolve credentials before invoking.

## Context negotiation (CONTEXT_REQUIRED)

A binding often needs context the caller has not supplied: credentials, an approval, a configuration value. The OBI document does not declare these. Instead the invoker discovers them at call time and asks for them, so the same mechanism works for every binding family and for prerequisites beyond auth.

When a binding cannot proceed because required context is missing, `invokeBinding` emits a terminal `error` frame with code `CONTEXT_REQUIRED` and a `ContextRequiredDetails` payload, **before** any `output` frame and **before** any observable side effect on the target. That pre-execution guarantee is what makes resolve-and-retry safe for non-idempotent operations.

`ContextRequiredDetails` carries:

- `target`: the target the binding addresses — typically its endpoint URL or host. The runtime derives a storage key from it (the host-normalized convention described above) to locate and store resolved context; the invoker reports the target and neither keys nor stores. The target is **asserted by the invoker**, which is a trust boundary when the invoker is not fully trusted (a delegate, a hosted or third-party invoker): a misreporting invoker could name one host's target to obtain another's stored credentials. The runtime holds the source independently in both paths, so **where it can derive the source's authoritative target** — a concrete server URL, a fixed host — it validates the asserted target against that before provisioning, and refuses a mismatch. Where it cannot (an inline artifact whose servers only a family processor can read, a templated or multi-server host), the derivation needs family knowledge the runtime may lack; there it does not silently trust the assertion — it treats the invoker as untrusted for credential provisioning (delegating the target derivation to a component that can perform it, or withholding durable credentials and provisioning only non-secret per-call context). The same taint extends to per-call secrets: it likewise does not forward caller-supplied per-call credentials (`bearerToken`, `apiKey`, and the like) to an invoker whose target it could not verify — a per-call secret the caller attached trusting the *declared* target would otherwise ride to an unverified destination. The bound holds by what the runtime enforces, never by trusting the invoker's word for where it points.
- `alternatives`: an **OR** of ways to satisfy the requirement. Each alternative carries `requirements`, an **AND** of `ContextRequirement`s. This OR-of-AND shape expresses real auth semantics a flat preference list cannot, e.g. "OAuth2 **OR** (apiKey **AND** clientCert)".

A `ContextRequirement` names a `type` (the resolver family) plus type-specific fields, and an optional `durable` flag:

- `durable: true` (default): resolved context MAY be persisted, keyed from `target`, and reused for later invocations. Credentials are durable.
- `durable: false`: must be satisfied fresh for every invocation and MUST NOT be persisted. A one-shot user approval is not durable.

### Resolve and retry

On `CONTEXT_REQUIRED`, the runtime:

1. Picks one `alternative` whose every `requirement` it has a resolver for.
2. Resolves each requirement into context (prompt, browser flow, approval UI, config lookup, etc.).
3. Persists durable results in its store, under a key derived from `target`; never persists non-durable ones.
4. Retries `invokeBinding` with the augmented context.

The runtime SHOULD bound retries and MUST NOT loop: an invoker should not re-challenge for context it was just supplied. If supplied context proves insufficient, it returns a different error so the loop terminates.

### Least privilege

A `CONTEXT_REQUIRED` challenge is a **scope, not a hint**. It bounds what the invoker may receive: the runtime provisions only the context that satisfies the **one selected alternative** (the credentials it names plus non-secret configuration like headers, cookies, and env), and never other stored credentials. The invoker never gets raw access to the store (no enumeration, no arbitrary reads); it sees only this scoped resolution.

This matters most when the invoker is a **separate or third-party service**, such as a delegate or a hosted invoker: it receives only the context its own challenge requires, never the caller's full stored profile. Two runtime-enforced limits produce that bound together — the per-challenge field scoping here (*which fields* for a target) and the target validation under `ContextRequiredDetails` (*which target* at all). Both are the provisioning runtime's responsibility, since only it holds the store and the trust relationship; the bound is a property of what the runtime provisions, not of the invoker's good behavior.

### Requirement types

`auth.*` is the first standard family and resolves into the well-known credential context fields:

| Requirement type | Resolves to | Typical flow |
|---|---|---|
| `auth.bearer` | `bearerToken` | Prompt for a token. |
| `auth.oauth2` | `accessToken` | Drive the flow named by `grantType` (`authorization_code`, `implicit`, `password`, `client_credentials`) from `authorizeUrl` / `tokenUrl` / `scopes`. |
| `auth.basic` | `basic` (`{ username, password }`) | Prompt for username and password. |
| `auth.apiKey` | `apiKey`, or `apiKeys[name]` when the requirement carries a `name` | Prompt for a key. |

A requirement MAY carry a `name` — the scheme name as the source artifact declares it — which disambiguates two requirements of the same type within one alternative (two ANDed API keys are otherwise indistinguishable) and keys the scheme-scoped credential lookup.

Runtimes MAY define further families (`approval.user`, `config.value`, `account.link`, ...). An unrecognized `type` is simply unsatisfiable by a runtime with no resolver for it; that alternative cannot be selected. The same holds in the other direction: an invoker whose artifact declares a scheme it cannot itself apply still SURFACES the requirement, with a type derived from the artifact's scheme (e.g. `auth.http.digest`) — the alternative stays discoverable (a runtime with a resolver for that family could satisfy it), and a document whose every alternative is unmappable produces a readable challenge instead of an unauthenticated dispatch and a blind 401. SDKs provide a resolver registry so applications register `(type -> resolver)` and the retry loop dispatches by `type`.

### prepareBinding (preflight)

`prepareBinding` lets a tool ask for a binding's requirements **before** invoking, returning a `ContextRequiredDetails` (or `null` when none are known statically). The operation is always implementable — returning `null` is the conformant answer whenever requirements cannot be determined without invoking, so no capability prevents a service from carrying it (correspondence remains per-operation, as for every contract operation). It is advisory: a target may only reveal requirements via a live `CONTEXT_REQUIRED`, so the reactive challenge is authoritative. Supplying `context` on the input narrows the result to what is still unsatisfied. This gives good UX (prompt for auth before the user acts) without putting auth metadata in the OBI document.

## Standard error codes

Binding invokers use standard error codes so the operation invoker and application code can handle failures without knowing the protocol underneath. Codes are SCREAMING_SNAKE_CASE strings carried in `InvocationError.code`. Two things about a failure are **normative**; the specific code string is mostly not.

**What is normative: the classification.** Every `InvocationError` carries a `category` — one of a fixed, closed set (closed for this interface's major version; a later major MAY add members, and a consumer that meets an unknown category treats it as `permanent`) — and, where retry is even in question, an `effects` marker (below). The category is the interop surface: an application, or the operation invoker, branches on it without knowing which binding family or which specific code produced the failure. A third party may mint any specific code it likes, but it MUST place that code in one of these categories, and consumers MAY rely on the category being present and accurate.

| `category` | Meaning for the consumer | Consumer's move |
|---|---|---|
| `context` | Required context is missing; this is the resolve-and-retry hinge, not a failure | The runtime resolves the requirement and retries |
| `auth` | Supplied credentials were rejected or insufficient | Re-credential, then retry — never retry with the same credentials |
| `cancelled` | The caller ended the invocation (`cancel()` / `AbortSignal`); not a failure of the call | Nothing; the same request may be issued fresh |
| `transient` | A lower-layer condition that may clear on its own (transport dropped, connect failed, timed out) | Retry — but see `effects`: only auto-retry when the call's side effects cannot have taken hold |
| `service` | The target was reached and returned an error of its own | Application decides from the target's own signal (preserved in `details`) |
| `validation` | Input or output does not match the declared schema, or the schema graph could not be resolved | Fix the value or the document; do not retry as-is |
| `protocol` | The frame sequence or the invocation contract was violated | Fix the caller; do not retry |
| `permanent` | A terminal failure that will not clear by retrying the same request | Do not retry |

**What is also normative where retry is even in question: the `effects` marker — because a category alone cannot say retry-is-safe.** Only `context` carries a pre-execution guarantee (the challenge is raised before any side effect); a `transient` failure can happen *after* the call was dispatched — a POST that was sent before the transport dropped, a timeout after the server began work — so "transient ⇒ retry" is unsafe for a non-idempotent operation. Where retry is even considered — the `transient` and `service` categories — an `InvocationError` therefore also carries `effects`, the invoker's honest report of **whether the call's side effects may have taken hold**:

- `effects: none` — the call's side effects provably did not take hold: the connection failed before send; the server definitively refused before executing (e.g. a 429/503 or an auth rejection whose response proves non-execution); or a challenge was raised pre-dispatch. Safe to retry (or backoff-retry).
- `effects: possible` — the call may have taken effect: it was dispatched, then the transport dropped or it timed out before a conclusive response. Auto-retry is **not** safe for a non-idempotent operation; surface it, or retry only when the operation is known idempotent.
- `effects: definite` — the call took effect: a success or partial output was seen, or the server signaled it acted. Retry is a re-invocation the caller must reason about.

For the categories where the disposition is fixed by the category itself — `context`, `cancelled`, `auth`, `validation`, `protocol`, `permanent` — retry is not a question `effects` decides, so the marker is `none` (or simply not consulted) and MAY be omitted. An `InvocationError` that omits `effects` is treated as `possible`: a consumer never auto-retries it, and never infers `none` from silence.

The safe automatic-retry rule a runtime may rely on is exactly: **`effects: none`, or any failure on an operation the caller independently knows to be idempotent.** `context` (resolve-and-retry) and `cancelled` are their own dispositions. This is the same pre-side-effect reasoning the context hinge already applies, made explicit for the retry path so `category` never invites an unsafe repeat.

**What is also normative: a small set of named codes.** A code named by a rule of this contract or its operation-invoker peer is normative where named — `CONTEXT_REQUIRED` (category `context`), `ERR_PROTOCOL`, `ERR_TRANSPORT_CLOSED`, `ERR_CANCELLED`, `ERR_VALIDATION_FAILED`, and `ERR_BINDING_NOT_FOUND` at the operation layer. These specific strings are guaranteed. Everything else in the registry below is a recommended convention — a stable spelling for a category member, useful but not something a conformant consumer may require. The **Class** column marks the split; the **Category** column is the normative axis to branch on. (`CONTEXT_REQUIRED` keeps its prefix-less spelling for historical reasons; read it as a negotiation signal in the `context` category, not an error — the invocation pauses rather than fails.)

| Code | Class | Category | Meaning | Retryable? |
|------|-------|----------|---------|------------|
| `CONTEXT_REQUIRED` | Normative | context | Required context (credentials, approval, config) is missing; `details` is a `ContextRequiredDetails` | Yes, after resolving the requirements |
| `ERR_PROTOCOL` | Normative | protocol | The frame sequence violated the frame protocol (e.g., `input` before `open`, second `open`) | No |
| `ERR_TRANSPORT_CLOSED` | Normative | transient | Underlying transport closed without a terminal frame | Only if `effects: none` |
| `ERR_CANCELLED` | Normative | cancelled | Operation was cancelled by the caller (via `cancel()` or `AbortSignal`) | N/A — issue a fresh call if wanted |
| `ERR_VALIDATION_FAILED` | Normative | validation | Input or output does not match the declared schema (the interface's validation promise; core [OBI-T-16](https://github.com/openbindings/spec/blob/main/openbindings.md#103-tool-rules) governs the claim) | No |
| `ERR_BINDING_NOT_FOUND` | Normative | permanent | Requested binding is not defined on the interface | No |
| `ERR_AUTH_REQUIRED` | Convention | auth | Supplied credentials were rejected (e.g. HTTP 401 with context present) | Not with same credentials |
| `ERR_PERMISSION_DENIED` | Convention | auth | Authenticated but not authorized (HTTP 403) | Not with same credentials |
| `ERR_INVALID_REF` | Convention | permanent | Ref is malformed or cannot be parsed | No |
| `ERR_REF_NOT_FOUND` | Convention | permanent | Ref is syntactically valid but does not resolve in the source | No |
| `ERR_SCHEMA_UNRESOLVED` | Convention | validation | The governing schema graph could not be fully resolved — distinct from a mismatch, per [OBI-T-16](https://github.com/openbindings/spec/blob/main/openbindings.md#103-tool-rules); validation never proceeds partially | No |
| `ERR_SOURCE_LOAD_FAILED` | Convention | permanent | Could not load or parse the binding source | No |
| `ERR_SOURCE_CONFIG_ERROR` | Convention | permanent | Source loaded but missing required config (no server URL, etc.) | No |
| `ERR_CONNECT_FAILED` | Convention | transient | Could not establish connection to the service | Yes (`effects: none` — never dispatched) |
| `ERR_EXECUTION_FAILED` | Convention | service | Call was made but the service returned an error | Per the service (status in `details`) |
| `ERR_RESPONSE_ERROR` | Convention | service | Got a response but could not process it | No |
| `ERR_STREAM_ERROR` | Convention | transient | Error during streaming after initial connection | Only if `effects: none` |
| `ERR_TIMEOUT` | Convention | transient | Operation timed out | Only if `effects: none` (usually `possible`) |
| `ERR_OPERATION_NOT_FOUND` | Convention | permanent | Requested operation matches no key or alias on the interface | No |
| `ERR_UNKNOWN_SOURCE` | Convention | permanent | A binding references a source not present in the interface | No |
| `ERR_TRANSFORM_ERROR` | Convention | validation | Transform evaluation failed | No |
| `ERR_INPUT_CLOSED` | Convention | protocol | Caller wrote after the input side was closed (by caller or binding) | No |
| `ERR_INVOCATION_CLOSED` | Convention | protocol | Caller wrote after the invocation reached a terminal state | No |
| `ERR_TOO_MANY_INPUTS` | Convention | protocol | Caller wrote more inputs than the binding accepts | No |
| `ERR_MISSING_INPUT` | Convention | protocol | A required input message never arrived before the input side closed | No |
| `ERR_ALREADY_CONSUMED` | Convention | protocol | The output sequence was acquired a second time (single-consumer), or a second concurrent input reader appeared | No |
| `ERR_EXPECTED_SINGLE` | Convention | protocol | A single-output convenience (`Single` / `single`) observed zero outputs, or a second output where exactly one was expected | No |
| `ERR_TYPE_MISMATCH` | Convention | validation | Typed adapter received a value not matching the declared output type | No |
| `ERR_EVENT_LIMIT_EXCEEDED` | Convention | permanent | An operation-graph execution exceeded the maximum number of events permitted | No |
| `ERR_OPERATION_GRAPH_EXIT` | Convention | service | An operation-graph exit node terminated execution with an error; `details` carries the event that reached the exit | No |
| `ERR_UNSUPPORTED_FORMAT_VERSION` | Convention | permanent | A binding source declares a format version the invoker refuses (higher major, or higher minor while pre-1.0) | No |
| `ERR_RUNTIME` | Convention | permanent | Catch-all for unexpected implementation errors | No |

Third-party binding invokers MAY define additional codes; each MUST fall in one of the normative categories, and consumers SHOULD handle unknown code *strings* gracefully by falling back to the category. This is what lets an application re-authenticate on every `auth`, auto-retry a `transient` **whose `effects` is `none`**, and give up on every `permanent` — without a table of every code any invoker might emit, and without repeating a call the target may already have observed.

**Transport status mapping.** When a binding speaks a protocol that carries its own error status, an implementation maps that status onto these codes and categories. Two implementations that agree on the category for a given status is the point, so the HTTP mapping is pinned rather than left to taste: **401** → `ERR_AUTH_REQUIRED` (`auth`); **403** → `ERR_PERMISSION_DENIED` (`auth`); **408**, **429**, **502**, **503**, **504** → `transient`; every other **4xx** → `service` (the request reached the server and was refused on its merits — do not blind-retry); **500** and every other **5xx** → `service`. The numeric status is preserved on the error's `details` so callers can still branch on 404, 422, 429, and the like; `effects` is set from how far the exchange got — a request the server provably refused before executing (a 429 or 503 whose response proves non-execution) is `effects: none`, so a backoff-retry is licensed, while a 5xx returned after the request may already have executed is `effects: possible`. Families whose protocol has no HTTP status (gRPC and its native status space, for instance) map their own codes onto the registry and categories by the same principle; that per-family mapping is fixed by the family's binding specification, not left per-implementation, so the resulting `category` is deterministic, not just present.

## What a binding invoker must NOT do

- **Understand operations.** It does not know what `getMenu` means. It invokes a binding ref within a source.
- **Select bindings.** That is the operation invoker's job. The binding invoker invokes what it is given.
- **Manage application state.** The invoker does not accumulate state that affects the semantics of subsequent calls. Transport-level state (document caches, connection pools, session caches) is acceptable as internal optimization, but the caller should get the same result whether the invoker reuses a connection or opens a fresh one. Application-level state (credentials, preferences) lives in the runtime's store.
- **Handle transforms.** Input and output transforms are applied by the operation invoker, not the binding invoker.
- **Mutate the caller's input.** Context merging and enrichment MUST operate on a copy.
- **Over-reach for context.** It receives only the context the challenge scoped and applies only what the operation requires (e.g. the security scheme the call declares). It does not read the runtime's store directly, accumulate other targets' credentials, or forward more than a delegate's own challenge requires.

## Cardinality reach depends on the binding family

The binding-invoker interface exposes a bidirectional I/O contract through `invokeBinding`. An implementation can only honor the full contract if its chosen binding family's wire can carry bidirectional message streams. This is a property of the family, not a property of the interface.

| Binding category (examples) | Unary | Server-streaming | Client-streaming | Bidirectional |
|-----------------------------|-------|------------------|------------------|---------------|
| In-process code module (`node-module`, `go-package`) | Yes | Yes | Yes | Yes |
| stdio / subprocess (`usage`, `stdio`) | Yes | Yes | Yes | Yes |
| WebSocket-based (`asyncapi-ws`) | Yes | Yes | Yes | Yes |
| HTTP/2 streaming (`grpc`, `connect`) | Yes | Yes | Yes | Yes |
| HTTP/1.1 + SSE (`openapi` with SSE response) | Yes | Yes | No | No |
| HTTP/1.1 request/response only (`openapi` plain REST) | Yes | No | No | No |

An implementation backed by an HTTP/1.1 binding can only invoke underlying bindings whose cardinality the wire can carry; it cannot proxy a bidi binding. This is fundamental, not a current implementation gap. Implementation authors who want to honor the full contract pick a binding family whose wire supports bidirectional streams. Implementation authors with a constrained binding should document which cardinalities they can carry.

## Why `invokeBinding` returns an `Invocation` handle

`invokeBinding` returns an `Invocation` handle: a typed I/O pair (write side + read side) scoped to one operation invocation, plus lifecycle controls (`close`, `cancel`, terminal state). This shape unifies every cardinality the OpenBindings spec permits (unary, server-streaming, client-streaming, bidirectional) under one signature.

When this invoker is reached remotely — as a delegate or hosted service rather than an in-process module — that same handle *is* the frame protocol: its frames are carried as the ordinary streaming values of whatever binding the invoker's OBI declares for `invokeBinding`, so no dedicated frame transport exists; any published streaming binding specification (`openbindings.asyncapi@1`, for one) can carry them.

### The design question

A central design question is whether operations should be modeled as request-response (one input, one output) or as bidirectional streams (zero-or-more inputs, zero-or-more outputs). REST is request-response. SSE and WebSocket receive are server-streaming. File upload protocols are client-streaming. WebSocket bidi and gRPC bidi are full bidirectional. The interface needs to support all of them.

### Alternatives considered

**1. Separate unary and streaming interfaces.** An `invokeBinding` for request-response and `subscribeBinding` for streams. Rejected: forces the caller to know which pattern an operation uses before calling it. That is protocol knowledge leaking through the abstraction. A developer switching a binding from OpenAPI to gRPC should not have to change their calling code.

**2. Single-value return for unary, stream for streaming.** Different return types per operation. Rejected: creates two code paths and the caller must know which to use. Same leak as (1).

**3. Single input + output stream.** Earlier OpenBindings SDKs shipped this: `invokeBinding(input) -> stream of outputs`. It covers unary and server-streaming cleanly. But client-streaming (caller sends N messages) and bidirectional (interleaved sends and receives) cannot be expressed. The earlier SDK acknowledged this gap and skipped gRPC client-streaming / bidi during interface synthesis.

**4. Handle with write + outputs + lifecycle (chosen).** `invokeBinding(input) -> Invocation<I, O>`. The handle exposes:

- `write(input)`: write one input message to the binding's channel (synchronous handoff to a buffer; does not claim transport dispatch).
- `close()`: graceful half-close, signal no more input.
- `cancel()`: abort the whole invocation.
- Output access: iterate `outputs` in TypeScript or call `Read(ctx)` in Go.
- `closed`: terminal-state signal.

The caller drives the handle however the operation demands. Cardinality emerges from how the caller drives it, not from a declared signature.

### How each cardinality looks under the handle

- **Unary** (REST GET, gRPC unary): caller writes one input; binding closes input from its side; output yields one value; close. Caller code: `await call.write(x); for await (const o of call.outputs) return o;`
- **Server-streaming** (SSE, gRPC server-stream): caller writes one input; binding closes input; output yields many values until done. Same caller pattern as unary; the loop just runs more.
- **Client-streaming** (file upload, gRPC client-stream): caller writes many inputs then calls `close()`; binding aggregates, produces one output. Caller owns `close()` because only the caller knows when they are done writing.
- **Bidirectional** (WebSocket, gRPC bidi): caller writes inputs in one async task; reads outputs in another; calls `close()` when done writing. Both sides flow concurrently.
- **No-input** (HTTP GET with no params, "ping"): binding closes its input side immediately; caller never touches input; just iterates outputs.
- **Fire-and-forget**: write one input; close; `closed` resolves. No iteration needed.

The caller's pattern adapts per operation, but the SDK signature is the same. Cardinality is observed at the call site, not declared in types.

### Connection pooling is a binding-specification library concern

Different protocols handle connection reuse differently. HTTP's `http.Client` pools TCP connections automatically. gRPC's `ClientConn` cache multiplexes RPCs on one HTTP/2 connection. MCP's session pool shares one JSON-RPC session across tool calls. AsyncAPI WebSocket pools share one socket across operations on the same channel. This is protocol-specific knowledge that belongs in each binding specification's implementation library. The contract stays clean: `invokeBinding(input) -> Invocation`. That library decides whether to open a new connection or reuse one and routes each invocation's I/O through the appropriate transport.
