# Interface Synthesizer

An interface synthesizer produces an OBI from a source artifact governed by a binding specification. Given a source artifact (an OpenAPI document, an AsyncAPI document, a protobuf descriptor set, or anything else a supported binding specification governs), it extracts operations, schemas, sources, and bindings into an OpenBindings interface document.

This is what powers OBI synthesis from a raw source artifact: source-driven authoring (register a source, then pull it to derive operations and bindings), on-the-fly synthesis when a consumer is handed a spec it has no OBI for, and any tool that needs to bootstrap OBI adoption from existing specs.

## Authentication is not extracted

An OBI document carries no authentication or `security` section, so a synthesizer does not extract credentials, security schemes, or auth requirements into the OBI. Authentication is a runtime prerequisite, not interface metadata: the binding invoker negotiates it at call time via a `CONTEXT_REQUIRED` challenge, resolved into the runtime's store (see the [`binding-invoker`](../binding-invoker/) interface).

A source artifact's security metadata (for example OpenAPI's `securitySchemes`) is therefore not mapped into the document. At most it can inform what the invoker asks for at invocation time; it is never baked into the static OBI.

## Multi-source composition is implementation-defined

The input's `sources` is an array, but how many sources one call composes
into the resulting OBI is the implementer's capability decision — a
service-level synthesizer may merge many artifacts; a single-family one
legitimately handles a single artifact. What no implementation may do is
answer for a subset silently: an implementation that does not compose
SHOULD refuse a multi-source input loudly rather than synthesize from the
first source and drop the rest.

## Other extraction conventions

Binding specifications govern **interpretation**, not generation: they define what a bound artifact means — how a `ref` resolves, how an invocation happens — and say nothing about how an OBI is derived from the artifact. Derivation is this contract's domain. The principles below are cross-family; per-family derivation detail belongs to each implementation's own reference documentation.

- **Operations.** Each callable target in the source becomes one operation. The operation key SHOULD be stable across regenerations: derive it from a source-level identifier (OpenAPI `operationId`, gRPC method name, GraphQL field name) rather than from positional ordering.
- **Schemas.** Resolve `$ref` pointers when the source artifact uses them, so the produced OBI is self-contained. Cycle-protect when the artifact permits cyclical type references.
- **Sources.** Echo the input source's `bindingSpec`, `location`, and (when requested) `content`/`outputLocation` faithfully. Do not normalize URLs or rewrite locations unless explicitly asked.
- **Bindings.** Each binding entry MUST carry a `ref` that the corresponding binding invoker can resolve back to the source artifact, in the ref form the governing binding specification defines (a JSON Pointer under `openbindings.openapi@1`, a fully-qualified method name under `openbindings.grpc@1`).
- **Aliases (optional).** A synthesizer MAY add operation `aliases` to claim correspondence with a shared contract (for example, a well-known operation name a consumer can target across providers). The name is author-asserted and carries no verification semantics.

## Deterministic output

A synthesizer SHOULD produce byte-stable output for byte-stable input. That means: stable property ordering, stable iteration order over operations, no embedded timestamps, no generated UUIDs. Determinism lets CI compare synthesizer output against checked-in OBIs without spurious diffs.

## Idempotency

`synthesizeInterface` is declared idempotent in the contract. The synthesizer MUST NOT mutate the input source, MUST NOT persist global state, and MUST produce the same OBI for the same input regardless of how many times it is invoked.
