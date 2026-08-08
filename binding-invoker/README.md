# Binding Invoker

A binding invoker knows how to invoke bindings governed by specific binding specifications. Given a source (bindingSpec + location/content), a ref within that source, and a way to receive input, it makes the protocol-specific call — as the source's governing binding specification defines it — and exposes a typed I/O channel for the caller to write inputs and read outputs.

This is the protocol boundary in the OpenBindings model: callers exchange operation values while the invoker interprets the binding artifact and performs the concrete interaction.

## Why it's called a *binding* invoker

A binding invoker takes a `(source, ref)` directly — not an OBI document, and not a binding key. It invokes **by value**: you hand it the entire realization, and it needs no interface document to act. So, strictly, it isn't handed "a binding" in the document sense; it's handed a binding's invocable essence (the operation label and key that an OBI binding entry adds are discovery metadata the wire never needs).

The name still fits, and is the clearest available, for one reason: the `(bindingSpec, ref)` pattern only exists *because* OpenBindings defines sources and bindings. Outside the OpenBindings model you would not address a call as "a ref into a declared source," so naming it for that model is exactly right. Its peer — the one that takes an interface and a *key*, resolving an operation or a binding **by reference** — is the [operation invoker](../operation-invoker/).

## What an invoker does

When a binding invoker receives a `BindingInvocationInput`, it follows this lifecycle:

1. **Artifact interpretation.** Resolves the source artifact from `location` or `content`, per its governing binding specification's carriage rules. Loading and caching strategy are implementation details.
2. **Context consumption.** Reads the context supplied for this invocation without mutating the caller's input. The contract neither requires nor exposes a context store.
3. **Context application.** Applies credentials, headers, cookies, and other context to the interaction exactly as the governing binding specification defines.
4. **Invocation.** Interprets the ref within the source artifact, maps writes to the concrete interaction, and emits outputs through the invocation handle.
5. **Context negotiation.** If the binding cannot proceed because required context is missing, emits `CONTEXT_REQUIRED` before output or effects. A surrounding runtime may resolve the requirements and start a new attempt with augmented context.

## Context

A binding invocation usually needs more than the operation input. Credentials, headers, cookies, environment variables, session state, consent flags, custom invoker-specific values: all of it is **context**. Context is opaque to the contract and broader than auth. Credentials are one common kind, not the whole concept.

### Context carriage and lifecycle

The interface carries one opaque context object on each invocation. Where its values came from — a caller, a credential broker, a durable store, a short-lived session, or a composition of those — is outside the contract. A runtime that combines several sources decides precedence before calling the invoker and supplies the resulting object.

This separation is intentional. A stateless remote invoker, an in-process invoker with application-managed credentials, and a runtime backed by a [`document-store`](../document-store/) can all implement the same interface. None must expose storage to the invoker.

### Targets and context reuse

A `CONTEXT_REQUIRED` challenge reports a **target**: an opaque identifier for the concrete destination or context scope the invoker is about to use. A runtime may use that value to scope resolution or reuse, but key derivation, normalization, persistence, hierarchy, and cross-target sharing are runtime policy rather than this interface's semantics.

When a runtime does derive storage keys from network locations, excluding userinfo and other secret material is a security requirement. Host normalization can also improve reuse across binding families. Those are implementation concerns, not a universal promise that every target is a URL or that every runtime has a store.

### Well-known context fields

Context is an opaque object, but these well-known field names provide cross-invoker interoperability:

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
| `configuration` | `{ [point]: any }` | Per-invocation configuration-point values, keyed by point name (the operation-invoker's `selection` point; a family's decode point; …); consulted at the first tier of each point's order |

Implementations and callers may add fields for session state, consent, or other family-specific needs. Consumers ignore fields they do not understand unless the governing binding specification says otherwise.

**Context confidentiality.** Bearer and OAuth tokens, API keys, and the password inside `basic` are always secret. Other fields are not inherently non-secret: headers, cookies, environment values, metadata, and configuration can also contain secrets according to their meaning. A runtime MUST protect values classified as secret by their requirement family, governing binding specification, or application policy; it must not expose them in diagnostics or derived keys. Structural redaction may retain non-secret names such as an API-key scheme name, but never the secret value.

### Interactive resolution

Interactive resolution is deliberately outside this contract. An in-process implementation may accept host callbacks, a remote service may drive a flow server-side, and a headless caller may use pre-provisioned values. No callback vocabulary is standardized here because function references and user-interface capabilities do not cross every implementation boundary. Whatever mechanism is used, the resulting values enter the next attempt only through `context`.

## Context negotiation (CONTEXT_REQUIRED)

A binding often needs context the caller has not supplied: credentials, an approval, a configuration value. The OBI document does not declare these. Instead the invoker discovers them at call time and asks for them, so the same mechanism works for every binding family and for prerequisites beyond auth.

When a binding cannot proceed because required context is missing, `invokeBinding` emits a terminal `error` frame with code `CONTEXT_REQUIRED` and a `ContextRequiredDetails` payload, **before** any `output` frame and **before** any observable side effect on the target. That pre-execution guarantee is what makes resolve-and-retry safe for non-idempotent operations.

`ContextRequiredDetails` carries:

- `target`: the concrete destination or context scope asserted by the invoker. It is opaque to this contract. A runtime may compare it with independently derived information before releasing secrets; how it verifies, normalizes, or keys that value depends on the binding family and the runtime's trust model.
- `alternatives`: an **OR** of ways to satisfy the requirement. Each alternative carries `requirements`, an **AND** of `ContextRequirement`s. This OR-of-AND shape expresses real auth semantics a flat preference list cannot, e.g. "OAuth2 **OR** (apiKey **AND** clientCert)".

A `ContextRequirement` names a `type` (the resolver family) plus type-specific fields, and an optional `durable` flag:

- `durable: true` (default): resolved context MAY be persisted, keyed from `target`, and reused for later invocations. This is permission, not a claim that every credential or other value should be stored.
- `durable: false`: must be satisfied fresh for every invocation and MUST NOT be persisted. A one-shot user approval is not durable.

### Resolve and retry

On `CONTEXT_REQUIRED`, a runtime may:

1. Pick one `alternative` whose every `requirement` it can satisfy.
2. Resolve each requirement into context by whatever mechanism it owns.
3. Persist durable results according to its own storage policy; never persist non-durable ones.
4. Start a new `invokeBinding` attempt with the augmented context.

If it retries, the runtime bounds attempts. An invoker does not repeat the same challenge when the supplied context already satisfies it; if the supplied value is rejected, it reports the applicable authentication, validation, or permanent error.

### Least privilege

A `CONTEXT_REQUIRED` challenge is a **scope, not a hint**. When resolving it, the runtime provisions only the context needed to satisfy the **one selected alternative**, and never unrelated stored credentials or configuration. Any resolved value may be sensitive according to its requirement family, binding specification, or application policy. The invoker never gets raw access to a caller's store (no enumeration, no arbitrary reads); it sees only the context supplied by value for this attempt.

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

`config.value` is the second standard family. It carries a configuration value a binding needs but the artifact does not supply — a server variable with no default, a channel address a service generates at runtime, a base URL for a document whose only server is the implied `/`. It exists so a missing-but-**resolvable** configuration value becomes a negotiable `CONTEXT_REQUIRED` instead of an ordinary unsuccessful completion caused by source configuration that no runtime can repair. Configuration is not automatically public; its sensitivity follows its meaning. A `config.value` requirement carries:

- `point` — the binding-specification configuration point the value belongs to (`server`, `address`, a family's decode point, …).
- `key` — the specific value needed within that point (a server-variable name; `address` for a whole channel address).
- `description` — human-readable prompt text.
- `choices` (optional) — values declared by the source artifact, for a runtime to render as a picker. Whether an off-list value is valid is decided by the governing binding specification: a closed artifact enum is enforced; an advisory list remains advisory.

It resolves into the `configuration` context field under its `point`; the **shape** of the value carried there is the invoker's own (configuration carriage is implementation surface, not contract), so this family names *what is needed*, not the resolved value's structure. `durable` defaults to `true`, which permits but does not require reuse; an invoker sets `durable: false` when the resolved value must be fresh for each attempt. A runtime that cannot satisfy `config.value` simply cannot select that alternative, exactly as for any other family.

Runtimes MAY define further families (`approval.user`, `account.link`, ...). An unrecognized `type` is simply unsatisfiable by a runtime that has no way to satisfy it; that alternative cannot be selected. An invoker may surface an artifact-defined scheme as an extension requirement only when it knows how the resulting context will be applied faithfully. If the invoker cannot represent or apply a prerequisite, it refuses before dispatch rather than emitting a satisfiable-looking challenge or attempting the interaction without it.

### prepareBinding (preflight)

`prepareBinding` lets a tool ask for a binding's requirements **before** invoking, returning a `ContextRequiredDetails` (or `null` when none are known statically). The operation is always implementable — returning `null` is the conformant answer whenever requirements cannot be determined without invoking, so no capability prevents a service from carrying it (correspondence remains per-operation, as for every contract operation). It is advisory: a target may only reveal requirements via a live `CONTEXT_REQUIRED`, so the reactive challenge is authoritative. Supplying `context` on the input narrows the result to what is still unsatisfied. This gives good UX (prompt for auth before the user acts) without putting auth metadata in the OBI document.

## Unsuccessful completion

An `error` output frame means that the current invocation did not complete
normally. That structural distinction is the portable contract. It does not
imply a universal ontology for why every present or future binding family can
complete unsuccessfully.

`InvocationError` therefore has a deliberately small shape:

- `code` identifies a reason. Only codes named by a rule of this interface or
  its operation-invoker peer have portable semantics. Other strings are open
  implementation or extension identifiers; an ordinary caller does not need
  to interpret them to observe unsuccessful completion.
- `message` is a human-readable, protocol-independent presentation. It may
  preserve failure prose supplied by the application author when the governing
  binding can identify that prose without its protocol container. Otherwise it
  MUST NOT restate a native status line, frame, process result, or other raw
  protocol evidence; that material belongs in `diagnostics`.
- `details` carries either portable structured data defined by a named
  interface code or an opaque JSON failure value that the governing binding
  rules identify as application-authored. In this revision,
  `CONTEXT_REQUIRED` uses it for `ContextRequiredDetails`. Application failure
  values have only the meaning their author gave them; admitting one does not
  create a universal failure vocabulary. Raw statuses, headers, trailers,
  envelopes, bytes, and implementation evidence do not belong here merely
  because a binding observed them.
- `diagnostics`, when present, is an explicit expert escape hatch for
  binding-native or implementation evidence. It may reveal the selected
  binding and MUST NOT be required for correct ordinary use.

The interface-owned codes are exactly those required by its own mechanics:

| Code | Meaning |
|---|---|
| `CONTEXT_REQUIRED` | The binding needs the `ContextRequiredDetails` carried in `details` before dispatch. |
| `ERR_PROTOCOL` | The caller or peer violated this interface's frame protocol. |
| `ERR_TRANSPORT_CLOSED` | The outer transport closed before a terminal frame arrived. |
| `ERR_CANCELLED` | The caller cancelled the invocation. |
| `ERR_VALIDATION_FAILED` | The operation-invoker's declared value-validation claim failed. |
| `ERR_BINDING_NOT_FOUND` | The requested operation has no invocable binding. |
| `ERR_BINDING_SELECTION_REQUIRED` | Several invocable bindings remain and the caller supplied no choice. |

Implementations may use additional codes for local failures or a binding's
unsuccessful completion, but this contract assigns those codes no portable
category, retry disposition, or protocol-status mapping. Retry and side-effect
policy belong to the caller and SDK layer. A diagnostic surface may preserve
an HTTP response, gRPC status, process result, or other native evidence, but
the error frame never requires that evidence and ordinary application behavior
never branches on it.

## What a binding invoker must NOT do

- **Understand operations.** It does not know what `getMenu` means. It invokes a binding ref within a source.
- **Select bindings.** That is the operation invoker's job. The binding invoker invokes what it is given.
- **Require a particular state architecture.** The contract supplies context by value and exposes no context store. Caches, pools, sessions, credential brokers, and persistence remain implementation choices so long as their observable behavior honors the contract.
- **Handle transforms.** Input and output transforms are applied by the operation invoker, not the binding invoker.
- **Mutate the caller's input.** Context merging and enrichment MUST operate on a copy.
- **Over-reach for context.** It receives only the context the challenge scoped and applies only what the operation requires (e.g. the security scheme the call declares). It does not read the runtime's store directly, accumulate other targets' credentials, or forward more than a delegate's own challenge requires.

## Cardinality reach depends on the binding family

The binding-invoker interface exposes a bidirectional I/O contract through `invokeBinding`. An implementation can only honor the full contract if its chosen binding family's wire can carry bidirectional message streams. This is a property of the family, not a property of the interface.

| Binding category (examples) | Unary | Server-streaming | Client-streaming | Bidirectional |
|-----------------------------|-------|------------------|------------------|---------------|
| In-process code module (`node-module`, `go-package`) | Yes | Yes | Yes | Yes |
| stdio / subprocess (`usage`) | Yes | No | No | No |
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
