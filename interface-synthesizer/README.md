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

## Synthesis without sources

`sources` is optional, and omitting it is a legitimate call rather than a
malformed one. The result is a valid OBI with no operations, no sources, and
no bindings: the skeleton an author fills in by hand, or extends later by
registering sources against it.

The source-less case is also the one place where `name`, `version`, and
`description` are not overrides. Those fields override what would otherwise
be derived from a source artifact, and with no artifact there is nothing to
derive, so an omitted field has no underlying value behind it. What an
implementation substitutes for those three, and for `openbindingsVersion`, is
implementation-defined and carries no cross-implementation meaning. The
determinism rule below still applies, so the same source-less input yields
the same document every time and a scaffold can be diffed against a
checked-in one. A caller that needs a particular identity supplies the fields
rather than relying on any implementation's placeholder.

## Other extraction conventions

Binding specifications govern **interpretation**, not generation: they define what a bound artifact means — how a `ref` resolves, how an invocation happens — and say nothing about how an OBI is derived from the artifact. Derivation is this contract's domain. The principles below are cross-family; per-family derivation detail belongs to each implementation's own reference documentation.

- **Operations.** Each callable target in the source becomes one operation. The operation key SHOULD be stable across regenerations: derive it from a source-level identifier (OpenAPI `operationId`, gRPC method name, GraphQL field name) rather than from positional ordering.
- **Schemas.** Resolve `$ref` pointers when the source artifact uses them, so the produced OBI is self-contained. Cycle-protect when the artifact permits cyclical type references.
- **Sources.** Echo the input source's `bindingSpec`, `location`, and source description faithfully; use `name` as the output source key and `outputLocation` as the location written to the result. A local-path authoring convenience may normalize that path to the binding specification's invocable address form. When `embed` is true, preserve a complete accepted source representation as `content` or refuse the request — never ignore the directive or construct a partial discovery pin. Co-present input `content` is authoritative and remains the same JSON value in the result.
- **Bindings.** Each binding entry MUST carry a `ref` that the corresponding binding invoker can resolve back to the source artifact, in the ref form the governing binding specification defines (a JSON Pointer under `openbindings.openapi@1`, a fully-qualified method name under `openbindings.grpc@1`).
- **Aliases (optional).** A synthesizer MAY add operation `aliases` to claim correspondence with a shared contract (for example, a well-known operation name a consumer can target across providers). The name is author-asserted and carries no verification semantics.

## Creation-time soundness

Synthesis is a claim that the emitted interface can be realized through the
governing binding specification. Against the artifact, listing, descriptors,
or discovery state observed by a synthesis call, every emitted binding MUST
resolve to its identified target, fall within the binding revision's supported
subset, and admit at least one faithful invocation path when its declared
runtime prerequisites are available. A synthesizer MUST NOT emit an operation
that the corresponding conforming binding invoker is statically guaranteed to
refuse.

The operation set is complete for the callable targets this synthesizer
accepts from the source. If a source contains such a target but the
synthesizer cannot produce a faithful, bindable operation for it, the call MUST
fail rather than silently return a partial interface. This contract currently
returns an OBI directly and has no durable partial-result diagnostic channel;
an implementation-local warning callback is therefore not sufficient notice
that a target was omitted.

A non-fatal warning remains appropriate when an emitted operation is usable
but its schema is necessarily a conservative or lossy projection. Such a
warning MUST NOT mean that the operation is guaranteed to refuse. Missing
credentials, consumer-selected configuration, unavailable peers or host
capabilities, and caller values that fail validation are runtime conditions,
not creation-time synthesis defects.

This is a creation-time invariant, not a temporal-consistency guarantee. A
synthesizer preserves the source's declared embedded-versus-live semantics; it
does not have to embed, hash, refresh, or otherwise pin a mutable artifact or
service. Later artifact or service drift is external lifecycle state. On a
later invocation, the governing binding specification determines how the
current source is interpreted and when drift produces refusal.

## Deterministic output

A synthesizer SHOULD produce byte-stable output for byte-stable input. That means: stable property ordering, stable iteration order over operations, no embedded timestamps, no generated UUIDs. Determinism lets CI compare synthesizer output against checked-in OBIs without spurious diffs.

## Idempotency

`synthesizeInterface` is declared idempotent in the contract. The synthesizer MUST NOT mutate the input source, MUST NOT persist global state, and MUST produce the same OBI for the same input regardless of how many times it is invoked.
