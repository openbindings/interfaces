# Operation Invoker

An operation invoker invokes an operation described by an OpenBindings interface document. Given an interface and a **key** — an operation key, or a specific binding key — it dereferences that key against the document, selects a binding, validates against the operation's schemas, applies its transforms, and drives the underlying [binding invoker](../binding-invoker/).

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

## What an operation invoker does

When it receives an `OperationInvocationInput` (carried by the `open` frame), it:

1. **Resolves the key.** An `operation` key resolves to the operation and a selected binding; a `binding` key resolves to that binding, and the operation is derived from it.
2. **Selects a binding** (operation-key case). Selection is implementation policy: the invoker MUST select deterministically and SHOULD prefer the operation's highest-priority binding *among the formats it can actually invoke* (natively or via a delegate). A binding whose format it cannot invoke is not selectable. This is consistent with the spec not privileging any implementation: the contract does not mandate *which* binding, only that selection is deterministic and a supported binding is chosen when one exists.
3. **Validates and transforms.** Input values are validated against the operation's input schema, outputs against its output schema (where declared), and the binding's input/output transforms are applied. This is the layer the binding invoker lacks.
4. **Drives the binding invocation,** forwarding caller context down, and relays its frames back to the caller unchanged.

## The frame protocol

`invokeOperation` is a typed bidirectional I/O operation. The caller streams `OperationInvokerInputFrame` messages (one `open` carrying the `OperationInvocationInput`, then zero or more `input` frames, then `close`); the invoker streams `OperationInvokerOutputFrame` messages back (zero or more `output` / `input_closed`, then exactly one terminal `complete` or `error`). The same shape covers unary, server-streaming, client-streaming, and bidirectional bindings; cardinality is observed by how the caller drives the frames, not declared.

The frame protocol and **every normative frame rule** are identical to [`binding-invoker.invokeBinding`](../binding-invoker/) — first-frame-`open`, single-`open`, input-after-closure handling, exactly-one-terminal, transport-closure synthesis, discriminator dispatch, and `additionalProperties` rejection all apply here unchanged. The operation invoker adds the resolution, validation, and transform layer on top of that shared contract.

## Context is delegated, not owned

The operation invoker does **not** resolve context. This is deliberate and, in fact, forced:

- Context is keyed by the concrete **target** (endpoint), and the target is a property of the *resolved binding*. Until the operation invoker selects a binding, it has no target to key a store lookup on.
- So context resolution necessarily lives at or below the binding boundary. The operation invoker selects a binding, forwards the caller-supplied `context` (a pass-through override) into the binding invocation, and the **binding layer** performs the target-keyed store lookup and stored-under-caller merge.
- A `CONTEXT_REQUIRED` error originating at the binding layer propagates up this operation's output stream **unchanged**. The runtime resolves it and retries against the operation, the same resolve-and-retry contract described in [binding-invoker](../binding-invoker/) — the caller never has to learn which binding was selected.

There is no operation-scoped context. Context shared across an operation's bindings is simply context stored at a common target prefix (the store matches targets hierarchically), inherited by every binding whose target falls under it. The operation layer's only context responsibility is pass-through and caller-precedence.

### prepareOperation (preflight)

`prepareOperation` is the by-reference counterpart to `prepareBinding`: it reports the context invoking an operation would require, without invoking it or causing side effects. It resolves the named `operation` (or `binding`) to a concrete binding and returns that binding's `ContextRequiredDetails`, or `null` when requirements cannot be determined without invoking. Returning `null` is always conformant, so the operation is always satisfiable. Like `prepareBinding` it is advisory — the reactive `CONTEXT_REQUIRED` from `invokeOperation` is authoritative — and supplying `context` narrows the result to what is still unsatisfied.

## What an operation invoker must NOT do

- **Resolve or store context itself.** It forwards context to the binding layer, which owns target-keyed resolution. (See above: the target isn't known until a binding is selected.)
- **Reimplement the wire.** It drives a binding invoker; it does not speak protocols directly.
- **Bake in cardinality.** The signature never declares unary vs streaming; cardinality is observed at the frames.
- **Mutate the caller's input.** Context forwarding and enrichment operate on a copy.

## Relationship to the binding invoker

The operation invoker is layered strictly on top of the binding invoker. After it resolves a key to a `(source, ref)` and forwards context, the remaining flow *is* the binding invoker's flow, on the same wire engine. Publishing them as two interfaces reflects two genuinely different ways to address a call — by value and by reference — not two different execution mechanisms.
