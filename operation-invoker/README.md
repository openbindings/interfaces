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

## Publication boundary

These operations are offered for voluntary adoption under the
[publication boundary](../#publication-boundary). The document carrier is not a
conformance certificate. Admission of partially invalid documents, validation
preparation timing, caching, recovery and error precedence on malformed requests
are implementation policy. The described name resolution still follows the core.

## What an operation invoker does

The operation describes the following capability. These points describe the
caller-facing meaning, not a required execution pipeline:

1. **Resolves the name or key.** An `operation` name resolves across the flat key-and-alias namespace (core §5.1) to the operation and a selected binding; a `binding` key resolves to that binding, and the operation is derived from it. Bindings are found by the resolved operation key, not the alias used to reach it.
2. **Resolves a binding** (operation-key case). The candidate set is the operation's bindings whose sources have kinds the invoker can act on. The contract follows caller policy and the source's kind without inventing a ranking:
   - an explicit `binding` key is used directly;
   - when the caller supplies an ordered `selection`, the first listed binding the invoker can act on is used. The list passes over only what the invoker cannot act on, the one fact a caller may not know. Every listed key must name one of the operation's bindings, and the list never falls back to a binding it does not name: a key that names no binding of the operation, or a list with none the invoker can act on, fails with `ERR_BINDING_NOT_FOUND`;
   - without `binding` or `selection`, a sole invocable candidate is used;
   - zero candidates fail with `ERR_BINDING_NOT_FOUND`;
   - several candidates fail with `ERR_BINDING_SELECTION_REQUIRED`.

   `preference`, `deprecated`, key order, source order, and implementation registration order do not silently choose among alternatives. An application may apply any policy it owns, then express the result through an explicit binding or an ordered selection.
3. **Validates declared value contracts.** Each input value is checked before forwarding and each successful output value before relaying, where that side declares a schema. Validity follows [core §5.2](https://github.com/openbindings/spec/blob/release/0.2/openbindings.md#52-schemas): JSON Schema 2020-12, `format` as annotation where assertion is optional, ECMA-262 patterns with Unicode semantics, and the OBI reference environment. An established mismatch is `ERR_OPERATION_VALIDATION_FAILED`; a check that cannot give a verdict is `ERR_SCHEMA_UNRESOLVED`. Neither permits forwarding that value as validated. An absent schema states no contract: values on that side are forwarded without a validation claim. No whole-graph readiness check is required.
4. **Drives the binding invocation,** forwarding the selected source, the full binding object with content presence preserved, and caller context. The binding invoker applies any kind-defined adaptation. The operation invoker preserves the binding invoker's frame ordering and operation-value payloads, subject to step 3's validation. An unsuccessful terminal frame remains unsuccessful; `CONTEXT_REQUIRED` details and opaque application failure data are relayed unchanged without output-schema validation. This layer may terminate with its own resolution or validation failure, but does not apply a second transformation.

## The frame exchange

`invokeOperation` exchanges the input and output frames declared in its schemas.
Their meanings match [binding invocation](../binding-invoker/#frame-exchange):
open introduces a request, input/output carry values, close/input_closed describe
input closure, and complete/error describe the terminal outcome. An output alone
does not establish success; a later failure does not retract delivered values.
No native handle, queue, polling model, cancellation race algorithm or disposal
mechanism is prescribed. An interruption does not promise rollback.

## Context is forwarded, not reinterpreted

The operation invoker forwards the supplied context to the resolved binding invocation. A `CONTEXT_REQUIRED` challenge from that invocation that the implementation does not resolve propagates unchanged, so a caller can resolve the challenge and start a new operation attempt without learning protocol-specific details. Resolution strategy and deciding whether to make another attempt are caller policy.

The contract does not prescribe where resolution runs, what triggers it, or whether context is stored. A monolithic runtime may compose selection, resolution, and protocol invocation in one process; a distributed system may place them in separate services. The observable requirement is the same: the operation layer does not reinterpret binding-specific context and does not broaden the challenge's scope.

`CONTEXT_REQUIRED` is a negotiation signal, and its position is load-bearing: it arrives **before any `output` frame and before any observable operation side effect**, so a new attempt follows one that reported no operation output or effects. This does not claim that no protocol request was sent. A binding may re-challenge after supplied context proves unusable only while its governing rules can still prove that boundary; a native failure status is not sufficient evidence by itself. A necessary consequence is that context cannot be renegotiated **mid-stream**: once a streaming invocation has emitted outputs, a new requirement cannot surface as `CONTEXT_REQUIRED` on that same stream. An implementation may refresh expiring context internally; otherwise the invocation ends and a new one begins.

One well-known context field rides through this layer: **`configuration`**, an
object keyed by configuration-point name. This interface defines no
configuration point; kinds define them, and the authority defining each point
owns its value's meaning and consultation rules. Choosing a binding is not
configuration: it is the caller's instruction for one call, carried by
`binding` or `selection` in the invocation input.

## Operation-invoker-owned errors

This interface owns only the codes required by its resolution and validation mechanics. Their spellings and meanings are reserved:

| Code | Meaning |
|---|---|
| `ERR_OPERATION_NOT_FOUND` | The requested operation name cannot be resolved. |
| `ERR_BINDING_NOT_FOUND` | The explicit binding, or a key in `selection`, names no binding of the operation, or no invocable binding remains among those allowed. |
| `ERR_BINDING_SELECTION_REQUIRED` | Multiple invocable bindings remain and the caller supplied neither `binding` nor `selection`. |
| `ERR_UNKNOWN_SOURCE` | The selected binding references no source in the supplied interface. |
| `ERR_OPERATION_VALIDATION_FAILED` | An input or output value violates the operation's governing schema. |
| `ERR_SCHEMA_UNRESOLVED` | A schema check on a value cannot give a verdict, so that value cannot be forwarded as validated. |

These outcomes are code-only: this interface defines no `data` for them.
Binding-invoker-owned failures and failures owned by the source kind's defining
document, if any, relay unchanged. Any other implementation code remains non-portable
under this interface; in particular, this list is not a general failure
vocabulary for bindings or protocols.

### preflightOperation

`preflightOperation` resolves the named operation or binding with invocation's selection rules and preflights the selected binding under the [binding-invoker contract](../binding-invoker/README.md#preflightbinding). A resolution failure completes with this interface's own resolution code and is not the binding's answer. Preflight does not pin a later selection.

## Capability boundary

Context retains its kind-defined meaning. Caller binding selection is not
replaced by a private ranking. The operation adds no generic value transform.
It describes the caller-facing exchange, not a required component topology,
copy strategy, context store, schema compiler or network implementation.

## Relationship to the binding invoker

The operation-invoker semantics compose with the binding-invoker semantics: after resolution, the selected source and binding objects drive invocation, while the operation layer checks declared value contracts. An implementation may layer the two components or fuse them behind one service. The two addressing contracts do not require a particular process architecture.

## Walkthrough: document addressing

Take the complete OBI from the [text authoring walkthrough](../source-inspector/#walkthrough-inspect-and-author).
The opening payload carries that document as `interface`, together with one of
these addressing choices (shown here as payload fragments):

```json
{"operation": "repeat"}
```

```json
{"binding": "repeatText"}
```

```json
{"operation": "repeat", "selection": ["repeatText"]}
```

Use one choice per invocation. `binding` stands alone; `selection` accompanies
`operation`. The JSON interface includes complete opening frames, with the inline
OBI, in `invokeOperation.examples`. It does not require a document registry.

The caller can then exchange the `input`, `close`, `output` and terminal values
from the [binding-invocation walkthrough](../binding-invoker/#walkthrough-values-and-outcomes).
Here the operation declares string input and output contracts. A validity
mismatch is described by `ERR_OPERATION_VALIDATION_FAILED`; inability to decide
validity by `ERR_SCHEMA_UNRESOLVED`. Those meanings do not prescribe a schema
compiler, validation preparation order, or caching strategy.

A missing binding choice, a context challenge, and an unsuccessful operation
outcome are different reported facts. The consumer chooses what to do with them;
these examples specify no automatic fallback or retry loop.
