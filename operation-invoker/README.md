# Operation Invoker

An operation invoker invokes an operation described by an OpenBindings interface document. Given an interface and a **key** — an operation key, or a specific binding key — it dereferences that key against the document, selects a binding, validates against the operation's schemas, applies its transforms, and drives the underlying [binding invoker](../binding-invoker/).

This is the contract the project's invocation tooling is written to: implement it when you want your tooling to interoperate at this boundary. Conformance here is claimed and versioned independently of core OpenBindings conformance and of every binding specification — declining this contract implies nothing at those layers, and conforming to them requires nothing here.

It is the **by-reference** peer of the binding invoker. The binding invoker invokes *by value* (a self-contained `source + ref`, no document); the operation invoker invokes *by reference* (an interface plus a key it resolves). Both share one frame protocol and bottom out in the same wire engine. They differ only in how the call is addressed.

## By value vs by reference

This axis, not "binding vs operation," is the real distinction between the two interfaces:

| | Binding invoker | Operation invoker |
|---|---|---|
| **Addresses by** | `source` + `ref` (the realization itself) | `interface` + `operation` **or** `binding` key |
| **Needs an OBI?** | No | Yes (the key is meaningless without the document) |
| **Knows the schemas?** | No, values are opaque | Yes, validates input/output, applies transforms |
| **Selects a binding?** | No, it's given one | Yes (when addressed by operation key) |
| **Context** | Resolves it (target-keyed, from the store) | Forwards it; resolution happens in the binding layer |

"Invoke a binding by key" lives here, not in the binding invoker, because **keys need the document**, and the document is this interface's whole premise.

"By reference" names how the call is addressed — a key, resolved against a document — not how the document travels. The `interface` in the open frame is the document itself, carried inline, never a pointer into a store or registry. An interface that is stored nowhere (synthesized mid-pipeline, held only in memory) invokes exactly like a published one.

Because the document is a value, the caller also decides how much of it to send. Nothing requires the full document: a slice that keeps the top-level fields, the operation being invoked, and everything it transitively references — its bindings, their sources, the reachable schemas and transforms — is itself a valid OpenBindings interface, and the key resolves against it to the same binding, the same schemas, the same transforms. A caller invoking one operation of a large document may slice before sending; the invoker has no way to know a fuller document existed. When the invoker is remote, the slice is also a boundary: the far side sees the operation it is performing, not the caller's whole interface.

## What an operation invoker does

When it receives an `OperationInvocationInput` (carried by the `open` frame), it:

1. **Resolves the key.** An `operation` key resolves to the operation and a selected binding; a `binding` key resolves to that binding, and the operation is derived from it.
2. **Selects a binding** (operation-key case). Selection is **this interface's own configuration point**, with a normative default policy every implementation MUST implement. The candidate set is the operation's bindings whose governing binding specification the invoker can act on (natively or via a delegate); among candidates: non-deprecated rank before deprecated, then higher declared `preference` first — a candidate with no declared preference ranks below every candidate with one — then lexicographic binding key breaks remaining ties. The policy is deterministic to the last step: fix the document, the **supported set**, and the configuration, and every conforming implementation selects the same binding. Note what that determinism is relative to — the supported set (which binding specifications this invoker can act on, natively or via a delegate) is a property of the **deployment**, not of the document, so two conforming implementations with different supported sets may legitimately select different bindings for the same document. Determinism is per deployment; the portable lever across deployments is the configuration override, not the default policy. Consumer configuration MAY override the policy (`context.configuration.selection`, an ordered list of binding keys; the first invocable entry wins, the default policy applying when none is), and an explicit `binding` key bypasses selection entirely.
3. **Validates and transforms.** Input values are validated against the operation's input schema, outputs against its output schema (where declared), and the binding's input/output transforms are applied. This is the layer the binding invoker lacks. Validating is a claim, and the claim carries the core's semantics ([OBI-T-16](https://github.com/openbindings/spec/blob/main/openbindings.md#103-tool-rules)): success only against the complete statically reachable schema graph, `format` as annotation, per value — a mismatch is `ERR_VALIDATION_FAILED`, an unresolvable schema graph is reported distinctly, and neither is ever papered over with partial validation.
4. **Drives the binding invocation,** forwarding caller context down. It preserves the binding invoker's *frame sequence* — the same `output` / `input_closed` / terminal shape, one-for-one — but the output *payloads* it relays are the values after the operation's output transform and output-schema validation have run (step 3 is applied to this stream, not bypassed). The frames it may add that the binding did not produce are terminal ones of its own layer: an `ERR_VALIDATION_FAILED` when an output fails the schema claim, and the `CONTEXT_REQUIRED` it passes through unchanged from below. "Relayed" means the envelope and ordering are the binding's; the carried values are this layer's transformed, validated ones.

## The frame protocol

`invokeOperation` is a typed bidirectional I/O operation. The caller streams `OperationInvokerInputFrame` messages (one `open` carrying the `OperationInvocationInput`, then zero or more `input` frames, then `close`); the invoker streams `OperationInvokerOutputFrame` messages back (zero or more `output` / `input_closed`, then exactly one terminal `complete` or `error`). The same shape covers unary, server-streaming, client-streaming, and bidirectional bindings; cardinality is observed by how the caller drives the frames, not declared.

The frame protocol and **every normative frame rule** are identical to [`binding-invoker.invokeBinding`](../binding-invoker/) — first-frame-`open`, single-`open`, input-after-closure handling, exactly-one-terminal, transport-closure synthesis, discriminator dispatch, `additionalProperties` rejection, and caller-cancellation all apply here unchanged. The operation invoker adds the resolution, validation, and transform layer on top of that shared contract.

## Context is delegated, not owned

The operation invoker does **not** resolve context. This is deliberate and, in fact, forced:

- Context is keyed by the concrete **target** (endpoint), and the target is a property of the *resolved binding*. Until the operation invoker selects a binding, it has no target to key a store lookup on.
- So context resolution necessarily lives at or below the binding boundary. The operation invoker selects a binding, forwards the caller-supplied `context` (a pass-through override) into the binding invocation, and the **binding layer** performs the target-keyed store lookup and stored-under-caller merge.
- A `CONTEXT_REQUIRED` error originating at the binding layer propagates up this operation's output stream **unchanged**. The runtime resolves it and retries against the operation, the same resolve-and-retry contract described in [binding-invoker](../binding-invoker/) — the caller never has to learn which binding was selected.

`CONTEXT_REQUIRED` is a negotiation signal, and its position is load-bearing: it arrives **before any `output` frame and before any side effect**, so resolve-and-retry restarts a call that never happened. A necessary consequence is that context cannot be renegotiated **mid-stream**: once a streaming invocation has emitted outputs, a new requirement (a token that expires an hour into a long WebSocket, a step-up authorization) cannot surface as `CONTEXT_REQUIRED` on that same stream — the pre-side-effect guarantee that makes retry safe for non-idempotent operations is exactly what forbids it. This boundary is deliberate. Credentials that expire during a long-lived invocation are refreshed at the context layer (the resolver renewing a token the invoker already holds), not by re-challenging on a stream already in flight; an invocation that genuinely needs a fresh prerequisite ends and a new one begins.

There is no operation-scoped context. Context shared across an operation's bindings is simply context stored at a common target prefix (the runtime matches targets hierarchically; the store itself stays opaque), inherited by every binding whose target falls under it. The operation layer's only context responsibility is pass-through and caller-precedence.

One well-known context field rides for this layer and below: **`configuration`**, an object keyed by configuration-point name — this interface's `selection` point, and the named points each binding specification defines for its family (for example, a decode point) — carrying per-invocation values consulted at the first tier of each point's consultation order. The values' meanings belong to whichever specification defines the point; this interface only defines the carriage.

### prepareOperation (preflight)

`prepareOperation` is the by-reference counterpart to `prepareBinding`: it reports the context invoking an operation would require, without invoking it or causing side effects. It resolves the named `operation` (or `binding`) to a concrete binding and returns that binding's `ContextRequiredDetails`, or `null` when requirements cannot be determined without invoking. Returning `null` is always conformant, so the operation is always implementable. Like `prepareBinding` it is advisory — the reactive `CONTEXT_REQUIRED` from `invokeOperation` is authoritative — and supplying `context` narrows the result to what is still unsatisfied.

## What an operation invoker must NOT do

- **Resolve or store context itself.** It forwards context to the binding layer, which owns target-keyed resolution. (See above: the target isn't known until a binding is selected.)
- **Reimplement the wire.** It drives a binding invoker; it does not speak protocols directly.
- **Bake in cardinality.** The signature never declares unary vs streaming; cardinality is observed at the frames.
- **Mutate the caller's input.** Context forwarding and enrichment operate on a copy.

## Relationship to the binding invoker

The operation invoker is layered strictly on top of the binding invoker. After it resolves a key to a `(source, ref)` and forwards context, the remaining flow *is* the binding invoker's flow, on the same wire engine. Publishing them as two interfaces reflects two genuinely different ways to address a call — by value and by reference — not two different invocation mechanisms.
