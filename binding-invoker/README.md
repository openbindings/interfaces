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

The store itself is a generic [`key-value-store`](../key-value-store/) — `get` / `set` / `delete` over an opaque key and opaque value. Its backend (in-memory, on-disk, OS keychain, hosted vault) and any management surface (listing, inspection, rotation, audit) are implementation-defined and outside that contract.

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

When stored context is insufficient and the invoker needs interactive resolution, it asks the runtime through **platform callbacks**: functions the SDK injects at construction. The contract does not carry callbacks (live function references cannot cross a wire); they are an SDK affordance for code-module implementations.

| Callback | Purpose | Example uses |
|---|---|---|
| `prompt` | Display a message, collect text input | API key entry, password, custom tokens |
| `browserRedirect` | Open a URL, capture the redirect callback | OAuth2, SAML, any browser-based auth |
| `confirmation` | Display a message, wait for yes/no | Terms of service, consent screens |
| `fileSelect` | Let the user pick a file | Client certificates, key files |

The SDKs define this callback seam; hosts supply their own functions (pre-built bundles for common platforms are a planned SDK affordance, not yet shipped). If a callback the invoker needs is not provided, the invoker returns an error rather than blocking; headless environments rely on pre-configured stored context.

Wire-form implementations cannot receive callbacks across the wire. They either drive auth flows server-side themselves, or expect callers to pre-resolve credentials before invoking.

## Context negotiation (CONTEXT_REQUIRED)

A binding often needs context the caller has not supplied: credentials, an approval, a configuration value. The OBI document does not declare these. Instead the invoker discovers them at call time and asks for them, so the same mechanism works for every binding family and for prerequisites beyond auth.

When a binding cannot proceed because required context is missing, `invokeBinding` emits a terminal `error` frame with code `CONTEXT_REQUIRED` and a `ContextRequiredDetails` payload, **before** any `output` frame and **before** any observable side effect on the target. That pre-execution guarantee is what makes resolve-and-retry safe for non-idempotent operations.

`ContextRequiredDetails` carries:

- `target`: the target the binding addresses — typically its endpoint URL or host. The runtime derives a storage key from it (the host-normalized convention described above) to locate and store resolved context; the invoker reports the target and neither keys nor stores.
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

This matters most when the invoker is a **separate or third-party service**, such as a delegate or a hosted invoker: it receives only the context its own challenge requires, never the caller's full stored profile. A misbehaving invoker is then bounded by construction, not by good manners.

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

Binding invokers SHOULD use standard error codes to enable protocol-agnostic error handling by the operation invoker and application code. Codes are SCREAMING_SNAKE_CASE strings carried in `InvocationError.code`. **A code named by a rule of this contract or its operation-invoker peer is normative where named** — `CONTEXT_REQUIRED` (the resolve-and-retry hinge), `ERR_PROTOCOL`, `ERR_TRANSPORT_CLOSED`, `ERR_CANCELLED`, `ERR_VALIDATION_FAILED`, and `ERR_BINDING_NOT_FOUND` at the operation layer. The rest of the registry is recommended convention:

| Code | Meaning | Retryable? |
|------|---------|------------|
| `CONTEXT_REQUIRED` | Required context (credentials, approval, config) is missing; `details` is a `ContextRequiredDetails` | Yes, after resolving the requirements |
| `ERR_AUTH_REQUIRED` | Supplied credentials were rejected (e.g. HTTP 401 with context present) | Not with same credentials |
| `ERR_PERMISSION_DENIED` | Authenticated but not authorized (HTTP 403) | Not with same credentials |
| `ERR_INVALID_REF` | Ref is malformed or cannot be parsed | No |
| `ERR_REF_NOT_FOUND` | Ref is syntactically valid but does not resolve in the source | No |
| `ERR_VALIDATION_FAILED` | Input or output does not match the declared schema (the interface's validation promise; core OBI-T-16 governs the claim) | No |
| `ERR_SCHEMA_UNRESOLVED` | The governing schema graph could not be fully resolved — distinct from a mismatch, per OBI-T-16; validation never proceeds partially | No |
| `ERR_SOURCE_LOAD_FAILED` | Could not load or parse the binding source | No |
| `ERR_SOURCE_CONFIG_ERROR` | Source loaded but missing required config (no server URL, etc.) | No |
| `ERR_CONNECT_FAILED` | Could not establish connection to the service | Maybe (transient) |
| `ERR_EXECUTION_FAILED` | Call was made but the service returned an error | Depends |
| `ERR_RESPONSE_ERROR` | Got a response but could not process it | No |
| `ERR_STREAM_ERROR` | Error during streaming after initial connection | Depends |
| `ERR_TIMEOUT` | Operation timed out | Maybe (transient) |
| `ERR_CANCELLED` | Operation was cancelled by the caller (via `cancel()` or `AbortSignal`) | No |
| `ERR_BINDING_NOT_FOUND` | Requested binding is not defined on the interface | No |
| `ERR_TRANSFORM_ERROR` | Transform evaluation failed | No |
| `ERR_INPUT_CLOSED` | Caller wrote after the input side was closed (by caller or binding) | No |
| `ERR_INVOCATION_CLOSED` | Caller wrote after the invocation reached a terminal state | No |
| `ERR_TOO_MANY_INPUTS` | Caller wrote more inputs than the binding accepts | No |
| `ERR_PROTOCOL` | The frame sequence violated the frame protocol (e.g., `input` before `open`, second `open`) | No |
| `ERR_TYPE_MISMATCH` | Typed adapter received a value not matching the declared output type | No |
| `ERR_TRANSPORT_CLOSED` | Underlying transport closed without a terminal frame | Maybe (transient) |
| `ERR_RUNTIME` | Catch-all for unexpected implementation errors | No |

Beyond the contract-named codes above, these are conventions. Third-party binding invokers MAY define additional codes. Implementations that consume error codes SHOULD handle unknown codes gracefully.

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
