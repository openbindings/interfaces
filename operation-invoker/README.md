# Operation Invoker

An operation invoker invokes an operation described by an OpenBindings interface document. Given an interface and a **key** — an operation key, or a specific binding key — it dereferences that key against the document, selects a binding, validates against the operation's schemas, applies its transforms, and drives the underlying [binding invoker](../binding-invoker/).

This is a reusable invocation contract, not a requirement of core OpenBindings. Conformance is claimed and versioned independently of core conformance and of every binding specification.

It is the **by-reference** peer of the binding invoker. The binding invoker invokes *by value* (a self-contained `source + ref`, no document); the operation invoker invokes *by reference* (an interface plus a key it resolves). Both share one frame protocol and bottom out in the same wire engine. They differ only in how the call is addressed.

## By value vs by reference

This axis, not "binding vs operation," is the real distinction between the two interfaces:

| | Binding invoker | Operation invoker |
|---|---|---|
| **Addresses by** | `source` + `ref` (the realization itself) | `interface` + `operation` **or** `binding` key |
| **Needs an OBI?** | No | Yes (the key is meaningless without the document) |
| **Knows the schemas?** | No, values are opaque | Yes, validates input/output, applies transforms |
| **Selects a binding?** | No, it's given one | Yes (when addressed by operation key) |
| **Context** | Consumes supplied context and may challenge for missing requirements | Forwards supplied context and propagates binding challenges |

"Invoke a binding by key" lives here, not in the binding invoker, because **keys need the document**, and the document is this interface's whole premise.

"By reference" names how the call is addressed — a key, resolved against a document — not how the document travels. The `interface` in the open frame is the document itself, carried inline, never a pointer into a store or registry. An interface that is stored nowhere (synthesized mid-pipeline, held only in memory) invokes exactly like a published one.

Because the document is a value, the caller also decides how much of it to send. Nothing requires the full document: a slice that keeps the top-level fields, the operation being invoked, and everything it transitively references — its bindings, their sources, the reachable schemas and transforms — is itself a valid OpenBindings interface, and the key resolves against it to the same binding, the same schemas, the same transforms. A caller invoking one operation of a large document may slice before sending; the invoker has no way to know a fuller document existed. When the invoker is remote, the slice is also a boundary: the far side sees the operation it is performing, not the caller's whole interface.

## What an operation invoker does

When it receives an `OperationInvocationInput` (carried by the `open` frame), it:

1. **Resolves the key.** An `operation` key resolves to the operation and a selected binding; a `binding` key resolves to that binding, and the operation is derived from it.
2. **Resolves a binding** (operation-key case). The candidate set is the operation's bindings whose governing binding specification the invoker can act on. The contract follows caller and artifact authority without inventing a ranking:
   - an explicit `binding` key is used directly;
   - when `context.configuration.selection` supplies an ordered list, the first invocable listed binding is used;
   - without an effective caller choice, a sole invocable candidate is used;
   - zero candidates fail with `ERR_BINDING_NOT_FOUND`;
   - several candidates fail with `ERR_BINDING_SELECTION_REQUIRED`.

   `preference`, `deprecated`, key order, source order, and implementation registration order do not silently choose among alternatives. An application may apply any policy it owns, then express the result through an explicit binding or ordered selection list.
3. **Validates and transforms.** Input values are validated against the operation's input schema, outputs against its output schema (where declared), and the binding's input/output transforms are applied. This is the layer the binding invoker lacks. Validating is a claim, and the claim carries the core's semantics ([OBI-T-16](https://github.com/openbindings/spec/blob/main/openbindings.md#103-tool-rules)): success only against the complete statically reachable schema graph, `format` as annotation, per value — a mismatch is `ERR_VALIDATION_FAILED`, an unresolvable schema graph is reported distinctly, and neither is ever papered over with partial validation.
4. **Drives the binding invocation,** forwarding caller context down. It preserves the binding invoker's *frame sequence* — the same `output` / `input_closed` / terminal shape, one-for-one — but the output *payloads* it relays are the values after the operation's output transform and output-schema validation have run (step 3 is applied to this stream, not bypassed). The frames it may add that the binding did not produce are terminal ones of its own layer: an `ERR_VALIDATION_FAILED` when an output fails the schema claim, and the `CONTEXT_REQUIRED` it passes through unchanged from below. "Relayed" means the envelope and ordering are the binding's; the carried values are this layer's transformed, validated ones.

## The frame protocol

`invokeOperation` is a typed bidirectional I/O operation. The caller streams `OperationInvokerInputFrame` messages (one `open` carrying the `OperationInvocationInput`, then zero or more `input` frames, then `close`); the invoker streams `OperationInvokerOutputFrame` messages back (zero or more `output` / `input_closed`, then exactly one terminal `complete` or `error`). The same shape covers unary, server-streaming, client-streaming, and bidirectional bindings; cardinality is observed by how the caller drives the frames, not declared.

The frame protocol and **every normative frame rule** are identical to [`binding-invoker.invokeBinding`](../binding-invoker/) — first-frame-`open`, single-`open`, input-after-closure handling, exactly-one-terminal, transport-closure synthesis, discriminator dispatch, `additionalProperties` rejection, and caller-cancellation all apply here unchanged. The operation invoker adds the resolution, validation, and transform layer on top of that shared contract.

## Context is forwarded, not reinterpreted

The operation invoker forwards the supplied context to the resolved binding invocation. A `CONTEXT_REQUIRED` error from that invocation propagates unchanged, so a caller can resolve the challenge and start a new operation attempt without learning protocol-specific details.

The contract does not prescribe where resolution runs or whether context is stored. A monolithic runtime may compose selection, resolution, and protocol invocation in one process; a distributed system may place them in separate services. The observable requirement is the same: the operation layer does not reinterpret binding-specific context and does not broaden the challenge's scope.

`CONTEXT_REQUIRED` is a negotiation signal, and its position is load-bearing: it arrives **before any `output` frame and before any side effect**, so a new attempt restarts a call that never happened. A necessary consequence is that context cannot be renegotiated **mid-stream**: once a streaming invocation has emitted outputs, a new requirement cannot surface as `CONTEXT_REQUIRED` on that same stream. An implementation may refresh expiring context internally; otherwise the invocation ends and a new one begins.

One well-known context field rides through this layer: **`configuration`**, an
object keyed by configuration-point name. This interface defines only its
`selection` point: an array of binding-key strings in caller preference order.
The first listed key that exists, belongs to the resolved operation, and is
governed by a binding specification the invoker can act on is the caller's
choice. A non-array value, a list containing a non-string, or a list with no
invocable entry supplies no effective choice; the sole-candidate/ambiguity
rules still apply. Binding specifications may define other configuration
points. Each defining specification owns the value's meaning and consultation
rules.

### prepareOperation (preflight)

`prepareOperation` is the by-reference counterpart to `prepareBinding`: it reports the context invoking an operation would require, without invoking it or causing side effects. It resolves the named `operation` (or `binding`) to a concrete binding and returns that binding's `ContextRequiredDetails`, or `null` when requirements cannot be determined without invoking. Returning `null` is always conformant, so the operation is always implementable. Like `prepareBinding` it is advisory — the reactive `CONTEXT_REQUIRED` from `invokeOperation` is authoritative — and supplying `context` narrows the result to what is still unsatisfied.

## What an operation invoker must NOT do

- **Prescribe context storage or resolution architecture.** It forwards context and propagates challenges; composition around that exchange is external.
- **Invent a binding choice.** Several invocable alternatives require an explicit caller-owned choice.
- **Reimplement the wire.** It drives a binding invoker; it does not speak protocols directly.
- **Bake in cardinality.** The signature never declares unary vs streaming; cardinality is observed at the frames.
- **Mutate the caller's input.** Context forwarding and enrichment operate on a copy.

## Relationship to the binding invoker

The operation-invoker semantics compose with the binding-invoker semantics: after a key resolves to `(source, ref)`, the remaining behavior is binding invocation plus the operation's validation and transforms. An implementation may literally layer the two components or fuse them behind one service. Publishing both interfaces reflects two genuinely different ways to address a call — by value and by reference — not a required process architecture.
