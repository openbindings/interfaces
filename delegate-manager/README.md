# Delegate Manager

A delegate manager is a registry of **delegates** — referenceable OpenBindings interfaces that a delegating application can route operations to. You hand it a delegate ("here's an OBI to reference"); it resolves that reference, records the operations the delegate carries, and can later tell you which registered delegates carry an operation you need. That is the whole surface: register, unregister, list, resolve, and set selection preference.

This interface standardizes *managing* delegates. It does not standardize *invoking* them (that is the [operation invoker](../operation-invoker/)) or *deciding what to do with them* (that is the application). Those boundaries are the point.

## A delegate is any referenceable OBI

A delegate is **not** required to correspond to any particular interface. It is just an OpenBindings interface document, reachable at some location, that declares operations. A delegate "has" the operation you need when its interface answers to that operation's key — as the key itself, or as an `alias` (the spec's operation-correspondence model, [OBI-T-12](https://github.com/openbindings/spec/blob/main/openbindings.md#103-tool-rules)). Nothing about "capabilities" or "binding specifications" is baked in here; those are vocabularies a *specific* application layers on top.

## Registration takes a snapshot

Registration resolves the location to the delegate's interface document and records a **snapshot** of the operation identifiers it carries. If the location cannot be resolved, registration **fails** — a delegate is its OBI, so an unresolvable reference is nothing to register.

Resolvable is the *only* bar. A delegate that resolves but carries nothing you currently need still registers; it is simply **inert** until a need matches it. Usefulness is evaluated per operation at resolve time, and both your needs and the delegate's snapshot can change. Whether to flag an inert registration is the application's call — inertness is relative to *its* needs, which the registry alone does not know, so an application that warns "nothing here I can delegate to" at registration is describing its own appetite, not enforcing anything this contract says.

The snapshot does not track the delegate afterward. When a delegate changes, **re-register it**: re-registration re-resolves and replaces the record. Whether a manager also refreshes on its own schedule (on a timer, per invocation, never) is its own policy; the contract only guarantees that re-registering forces one. Callers should therefore treat a summary's `operations` as "what the delegate carried when last resolved," not a live view.

A refresh replaces only what was *resolved*. The record holds two kinds of data with two owners: the snapshot (name, operations, `contentHash`) is the **delegate's**, and re-resolution rewrites it; the preferences are the **registrar's**, and no refresh touches them — they persist until the registrar changes them, unless a re-registration explicitly supplies a new initial preference. A manager that wiped your per-operation preference index every time you refreshed a delegate would be destroying your configuration with the delegate's.

**A location is an address, not an identity or trust claim.** The document behind it can change while the location stays the same. A manager may therefore retain the resolved document or record a digest as `contentHash`. The digest is opaque to callers and exists to detect change between observations, not to authenticate the document or prescribe a hashing algorithm. What to do on change — refresh, warn, refuse, or ignore — belongs to the consuming application. A system that matches against one snapshot and invokes a later document should make that drift visible.

## Matching is per operation, not per interface

You match the operations you need, one at a time. "I need a full `binding-invoker`" is just "I need `invokeBinding` *and* `prepareBinding` *and* `listBindingSpecs`" — three per-operation matches. Whole-interface conformance is a convenience over the primitive, not the primitive. `resolveDelegate` takes one operation and returns the delegates that carry it.

## Preference is an index you own

Each delegate carries a **delegate-level preference** (its default for everything it carries) and an optional **per-operation preference index** — both set by you, via `registerDelegate`'s initial value and `setDelegatePreference`. Resolution orders candidates by **effective preference**: the per-operation entry for the requested operation when set, else the delegate-level value, else the neutral baseline. Higher is more preferred; negatives rank below the unset baseline; ties break by the manager's policy. The override shape is this contract's own: a per-operation entry displaces the delegate-level default rather than combining with it, and that is how "delegate X for operation A, delegate Y for operation B" is expressed. (These are registrar-set ranks over delegates, not document author signals; the core spec deliberately defines no selection semantics, and this contract owns its own.)

Two boundaries keep the index honest. Preference is **cleared with `null`** — an override you no longer want is removed, not overwritten with a copy of the current default (a copy silently diverges the moment the default changes). And preference **orders, it does not select**: it governs the order `resolveDelegate` returns candidates in, nothing more. Ordering is the manager's one obligation — it is your own data being reflected back — while what to *do* with the ordered candidates, including ignoring the order, belongs to the selecting application.

## What this contract does not decide: composition

Once you hold the delegates that carry an operation, **what you do with them is your application's policy, and it depends on what the operation means:**

- an *invoke-this-specific-thing* operation is a **route-to-one** — pick the best candidate and call it;
- a *what-can-you-all-do* operation (a `listBindingSpecs`, a catalog) is an **aggregate-across-all** — call every candidate and union the results;
- others may fan out, race, or fall through.

Applications also narrow candidates by criteria of their own that this contract cannot know. An application might, for instance, take the most-preferred candidate *that also supports the binding specification at hand* — a filter that is its own domain logic, layered on the contract's carrier-matching. `resolveDelegate` hands you the carriers in preference order; routing, aggregating, and filtering stay yours.

## Reaching a delegate is ordinary invocation

Resolution hands you delegates; **invoking one is nothing new**. A delegate is an OBI, so a registrar reaches it exactly the way it reaches any interface: ordinary operation invocation through the delegate's *own* bindings. You take the operation you resolved, invoke it against the delegate's interface, and the binding that interface declares for that operation carries the call over whatever transport it names. There is no delegate-specific wire, and none is needed — delegation is a *registry* pattern layered on invocation, not a second invocation mechanism. Invoking is the [operation invoker](../operation-invoker/)'s job, unchanged by the fact that the interface came from a registry.

This holds at every cardinality, streaming included. When a resolved operation streams, the registrar drives it through the ordinary invocation handle, and what rides on the wire is the operation's own **values** — log records, events, domain messages — carried by whatever streaming binding the delegate's OBI declares (`openbindings.asyncapi@1`, for one) the way it carries any other stream. The handle's frames (`open`, `output`, `close`, terminal) are the shape of that stream at the caller boundary, not extra objects layered onto the wire; the transport falls out of the delegate's own bindings, exactly as if you had invoked that OBI directly rather than through the registry. There is no dedicated frame transport to build. (Frame objects ride on the wire only in the one case where the delegate's operation is *itself* a binding-invoker [`invokeBinding`](../binding-invoker/) — there the frames ARE that operation's per-value contract; an ordinary streaming operation carries its ordinary values.)

## Registration is not authorization

A delegate's declared operations are author-asserted; this contract attaches no verification, trust, or authorization semantics to them. Registration records a resolvable candidate. It does not mean the candidate is trusted, permitted for every operation, schema-compatible with a local need, or safe to invoke.

Authentication of the registration surface, delegate verification, operation-scoped authorization, and invocation approval belong to the application or deployment. They may be binary, graded, or policy-driven. The manager's preference fields are caller-owned ordering metadata only and have no security effect.

## What you consume, not what you offer

A program's own OBI describes what it *offers*; its delegate registry describes part of what it *consumes*. The two are independent. A delegated operation may also be one the program exposes — a facade, fulfilling its own surface by reference — or it may never appear on the program's interface at all, registered purely so internal features can use it ("register a delegate that carries `y`, and this feature lights up"). This contract never asks which: `resolveDelegate` matches the caller's needs against what delegates carry, not against what the caller exposes.

## Application-agnostic by design

This is the *delegator's* side of the delegate pattern, published so that **any** delegating application exposes the same registry, not just one tool. A concrete application brings its own operation-needs and its own composition rules — which operations it delegates, which it routes to a single candidate and which it aggregates across all, whether it registers a built-in default as a self-delegate — and none of that policy lives here. Whatever those specifics, the application uses these same five operations unchanged. The contract standardizes *having and finding* delegates; everything layered on top is the application's.

## Operations

| Operation | Purpose |
|---|---|
| `registerDelegate` | Register a referenceable OBI as a delegate: resolve it, snapshot the operations it carries (fails if unresolvable; re-register to refresh) |
| `unregisterDelegate` | Remove a registered delegate (idempotent) |
| `listDelegates` | List every registered delegate, its operations, and its preferences |
| `resolveDelegate` | Given an operation you need, return the delegates that carry it, ordered by effective preference |
| `setDelegatePreference` | Set or clear (`null`) a delegate's preference — the delegate-level default, or one operation's entry in its preference index |

For how these compose with the operation invoker into opportunistic delegation, see the non-normative **delegate pattern** guide on openbindings.com.
