# Operation Invoker

An operation invoker invokes an operation described by an OpenBindings interface document. Given an interface and an operation name or a specific binding key, it resolves that name or key against the document, selects a binding, validates against the operation's declared value contracts, and drives the underlying [binding invoker](../binding-invoker/).

This is a reusable invocation contract, not a requirement of core OpenBindings. Conformance is claimed and versioned independently of core conformance and of every kind definition.

It is the **by-reference** peer of the binding invoker. The binding invoker invokes *by value* (a source and a binding object); the operation invoker invokes *by reference* (an interface plus a name or key it resolves). Both share one frame protocol.

## By value vs by reference

This axis, not "binding vs operation," is the real distinction between the two interfaces:

| | Binding invoker | Operation invoker |
|---|---|---|
| **Addresses by** | `source` + `binding` | `interface` + `operation` name **or** `binding` key |
| **Needs an OBI?** | No | Yes (the key is meaningless without the document) |
| **Knows the schemas?** | No: exchanges caller-facing values and applies kind-defined adaptation | Yes, validates declared input/output contracts |
| **Selects a binding?** | No, it's given one | Yes (when addressed by operation key) |
| **Context** | Consumes supplied context and may challenge for missing requirements | Forwards supplied context and propagates binding challenges |

"Invoke a binding by key" lives here, not in the binding invoker, because **keys need the document**, and the document is this interface's whole premise.

"By reference" names how the call is addressed — a key, resolved against a document — not how the document travels. The `interface` in the open frame is the document itself, carried inline, never a pointer into a store or registry. An interface that is stored nowhere (synthesized mid-pipeline, held only in memory) invokes exactly like a published one.

Because the document is a value, the caller may construct a smaller document before sending it. Such a document must preserve the intended name resolution, binding choices, schema reference environment (including anchors and dynamic scope), and any context the selected kind requires. Removing apparently unused members alone does not prove this: the resulting document must be conformant and preserve the behavior the caller needs. This interface does not prescribe a generic document-slicing algorithm.

## What an operation invoker does

When it receives an `OperationInvocationInput` (carried by the `open` frame), it:

1. **Resolves the name or key.** An `operation` name resolves across the flat key-and-alias namespace (OBI-T-07) to the operation and a selected binding; a `binding` key resolves to that binding, and the operation is derived from it. Bindings are found by the resolved operation key, not the alias used to reach it.
2. **Resolves a binding** (operation-key case). The candidate set is the operation's bindings whose sources have kinds the invoker can act on. The contract follows caller policy and the source's kind without inventing a ranking:
   - an explicit `binding` key is used directly;
   - when `context.configuration.selection` supplies an ordered list, the first invocable listed binding is used;
   - without an effective caller choice, a sole invocable candidate is used;
   - zero candidates fail with `ERR_BINDING_NOT_FOUND`;
   - several candidates fail with `ERR_BINDING_SELECTION_REQUIRED`.

   `preference`, `deprecated`, key order, source order, and implementation registration order do not silently choose among alternatives. An application may apply any policy it owns, then express the result through an explicit binding or ordered selection list.
3. **Validates declared value contracts.** Each input value is checked before forwarding and each successful output value before relaying, where that side declares a schema. Claims follow [OBI-T-08](https://github.com/openbindings/spec/blob/release/0.2/openbindings.md#103-tool-rules): applicable JSON Schema semantics, `format` as annotation where assertion is optional, Unicode pattern semantics, and the OBI reference environment. An established mismatch is `ERR_OPERATION_VALIDATION_FAILED`; a check that cannot give a verdict is `ERR_SCHEMA_UNRESOLVED`. Neither permits forwarding that value as validated. An absent schema states no contract: values on that side are forwarded without a validation claim. Core does not mandate a whole-graph readiness strategy.
4. **Drives the binding invocation,** forwarding the selected source, the full binding object with content presence preserved, and caller context. The binding invoker applies any kind-defined adaptation. The operation invoker preserves the binding invoker's frame ordering and operation-value payloads, subject to step 3's validation. An unsuccessful terminal frame remains unsuccessful; `CONTEXT_REQUIRED` details and opaque application failure data are relayed unchanged without output-schema validation. This layer may terminate with its own resolution or validation failure, but does not apply a second transformation.

## The frame protocol

`invokeOperation` is a typed bidirectional I/O operation. The caller streams `OperationInvokerInputFrame` messages (one `open` carrying the `OperationInvocationInput`, then zero or more `input` frames, then `close`); the invoker streams `OperationInvokerOutputFrame` messages back (zero or more `output` / `input_closed`, then exactly one terminal `complete` or `error`). The same shape covers unary, server-streaming, client-streaming, and bidirectional bindings; cardinality is observed by how the caller drives the frames, not declared.

The frame protocol and **every normative frame rule** are identical to [`binding-invoker.invokeBinding`](../binding-invoker/) — first-frame-`open`, single-`open`, input-after-closure handling, exactly-one-terminal, transport-closure synthesis, discriminator dispatch, `additionalProperties` rejection, and caller-cancellation all apply here unchanged. The operation invoker adds name resolution, binding selection and value-contract validation.

## Context is forwarded, not reinterpreted

The operation invoker forwards the supplied context to the resolved binding invocation. A `CONTEXT_REQUIRED` challenge from that invocation that the implementation does not resolve propagates unchanged, so a caller can resolve the challenge and start a new operation attempt without learning protocol-specific details. Resolution failure is a local runtime failure, not a declined challenge, and an unchanged resolver result does not trigger another attempt.

The contract does not prescribe where resolution runs, what triggers it, or whether context is stored. A monolithic runtime may compose selection, resolution, and protocol invocation in one process; a distributed system may place them in separate services. The observable requirement is the same: the operation layer does not reinterpret binding-specific context and does not broaden the challenge's scope.

`CONTEXT_REQUIRED` is a negotiation signal, and its position is load-bearing: it arrives **before any `output` frame and before any observable operation side effect**, so a new attempt restarts a call that never happened. A binding may re-challenge after supplied context proves unusable only while its governing rules can still prove that boundary; a native failure status is not sufficient evidence by itself. A necessary consequence is that context cannot be renegotiated **mid-stream**: once a streaming invocation has emitted outputs, a new requirement cannot surface as `CONTEXT_REQUIRED` on that same stream. An implementation may refresh expiring context internally; otherwise the invocation ends and a new one begins.

One well-known context field rides through this layer: **`configuration`**, an
object keyed by configuration-point name. This interface defines only its
`selection` point: an array of binding-key strings in caller preference order.
The first listed key that exists, belongs to the resolved operation, and is
read under a source kind the invoker can act on is the caller's
choice. A non-array value, a list containing a non-string, or a list with no
invocable entry supplies no effective choice; the sole-candidate/ambiguity
rules still apply. Kinds may define other configuration points. The authority defining each
point owns its value's meaning and consultation rules.

## Operation-invoker-owned errors

This interface owns only the codes required by its resolution and validation mechanics. Their spellings and meanings are reserved:

| Code | Meaning |
|---|---|
| `ERR_OPERATION_NOT_FOUND` | The requested operation key or alias does not resolve. |
| `ERR_BINDING_NOT_FOUND` | The explicit binding does not exist, or no invocable binding remains for the operation. |
| `ERR_BINDING_SELECTION_REQUIRED` | Multiple invocable bindings remain and the caller supplied no effective choice. |
| `ERR_UNKNOWN_SOURCE` | The selected binding references no source in the supplied interface. |
| `ERR_OPERATION_VALIDATION_FAILED` | An input or output value violates the operation's governing schema. |
| `ERR_SCHEMA_UNRESOLVED` | The complete statically reachable governing schema graph cannot be established, so validation cannot be claimed. |

These outcomes are code-only: this interface defines no `data` for them.
Binding-invoker-owned failures and failures owned by the source kind's defining
document, if any, relay unchanged. Any other implementation code remains non-portable
under this interface; in particular, this list is not a general failure
vocabulary for bindings or protocols.

### preflightOperation

`preflightOperation` resolves the named operation or binding with invocation's selection rules and preflights the selected binding under the [binding-invoker contract](../binding-invoker/README.md#preflightbinding). A resolution failure completes with this interface's own resolution code and is not the binding's answer. Preflight does not pin a later selection.

## What an operation invoker must NOT do

- **Prescribe context storage or resolution architecture.** It forwards context and propagates challenges; composition around that exchange is external.
- **Invent a binding choice.** Several invocable alternatives require an explicit caller-owned choice.
- **Reimplement the wire.** It drives a binding invoker; it does not speak protocols directly.
- **Bake in cardinality.** The signature never declares unary vs streaming; cardinality is observed at the frames.
- **Mutate the caller's input.** Context forwarding and enrichment operate on a copy.

## Relationship to the binding invoker

The operation-invoker semantics compose with the binding-invoker semantics: after resolution, the selected source and binding objects drive invocation, while the operation layer checks declared value contracts. An implementation may layer the two components or fuse them behind one service. The two addressing contracts do not require a particular process architecture.
