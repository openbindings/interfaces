# Delegate Manager

A delegate manager is a registry of **delegates** — referenceable OpenBindings interfaces that a delegating application can route operations to. You hand it a delegate ("here's an OBI to reference"); it resolves that reference, records the operations the delegate carries, and can later tell you which registered delegates satisfy an operation you need. That is the whole surface: register, unregister, list, resolve, and set selection preference.

This interface standardizes *managing* delegates. It does not standardize *invoking* them (that is the [operation invoker](../operation-invoker/)) or *deciding what to do with them* (that is the application). Those boundaries are the point.

## A delegate is any referenceable OBI

A delegate is **not** required to satisfy any particular interface. It is just an OpenBindings interface document, reachable at some location, that declares operations. A delegate "has" the operation you need when its interface answers to that operation's key — as the key itself, or as an `alias` (the spec's operation-correspondence model, OBI-T-12). Nothing about "capabilities" or "formats" is baked in here; those are vocabularies a *specific* application layers on top.

## Registration takes a snapshot

Registration resolves the location to the delegate's interface document and records a **snapshot** of the operation identifiers it carries. If the location cannot be resolved, registration **fails** — a delegate is its OBI, so an unresolvable reference is nothing to register.

Resolvable is the *only* bar. A delegate that resolves but carries nothing you currently need still registers; it is simply **inert** until a need matches it. Usefulness is evaluated per operation at resolve time, and both your needs and the delegate's snapshot can change. Whether to flag an inert registration is the application's call — inertness is relative to *its* needs, which the registry alone does not know. (The OpenBindings CLI, whose needs are three format operations, warns "no delegatable capability" at registration; that is ob describing its own appetite, not this contract.)

The snapshot does not track the delegate afterward. When a delegate changes, **re-register it**: re-registration re-resolves and replaces the record. Whether a manager also refreshes on its own schedule (on a timer, per invocation, never) is its own policy; the contract only guarantees that re-registering forces one. Callers should therefore treat a summary's `operations` as "what the delegate carried when last resolved," not a live view.

A refresh replaces only what was *resolved*. The record holds two kinds of data with two owners: the snapshot (name, operations, `contentHash`) is the **delegate's**, and re-resolution rewrites it; the preferences are the **registrar's**, and no refresh touches them — they persist until the registrar changes them, unless a re-registration explicitly supplies a new initial preference. A manager that wiped your per-operation preference index every time you refreshed a delegate would be destroying your configuration with the delegate's.

**A location is an address, not a trust anchor.** The document behind it can change wholesale — a local file rewritten in place, a URL that starts serving something else — while the location stays the same. So the snapshot SHOULD pin the content it resolved, and pinning takes either form: **retain** the resolved document and use it, or **record a digest** (`contentHash`) and verify it whenever the location is resolved again. The digest is opaque to callers — compare it for equality, don't recompute it; the algorithm is the manager's choice (hashing the RFC 8785 canonical form pins content rather than serialization accidents, and an algorithm prefix like `sha256:` helps tooling that wants independent verification). A mismatch means the delegate changed since it was trusted; whether the manager fails, warns, or auto-refreshes is its policy, but the safe default is an explicit re-registration — and in all cases a manager should **match and invoke against the same resolved document**. Matching against the snapshot and then invoking a freshly-resolved (changed) document is how you run code nobody trusted. This is the same drift discipline OpenBindings tooling already applies to binding sources.

## Matching is per operation, not per interface

You match the operations you need, one at a time. "I need a full `binding-invoker`" is just "I need `invokeBinding` *and* `prepareBinding` *and* `listFormats`" — three per-operation matches. Whole-interface conformance is a convenience over the primitive, not the primitive. `resolveDelegate` takes one operation and returns the delegates that carry it.

## Preference is an index you own

Each delegate carries a **delegate-level preference** (its default for everything it carries) and an optional **per-operation preference index** — both set by you, via `registerDelegate`'s initial value and `setDelegatePreference`. Resolution orders candidates by **effective preference**: the per-operation entry for the requested operation when set, else the delegate-level value, else the neutral baseline. Higher is more preferred; negatives rank below the unset baseline; ties break by the manager's policy. This mirrors the spec's binding-selection semantics (OBI-T-09) — a per-operation entry overrides the delegate default the way a binding's preference overrides its source's — and it is how "delegate X for operation A, delegate Y for operation B" is expressed.

Two boundaries keep the index honest. Preference is **cleared with `null`** — an override you no longer want is removed, not overwritten with a copy of the current default (a copy silently diverges the moment the default changes). And preference **orders, it does not select**: it governs the order `resolveDelegate` returns candidates in, nothing more. Ordering is the manager's one obligation — it is your own data being reflected back — while what to *do* with the ordered candidates, including ignoring the order, belongs to the selecting application.

## What this contract does not decide: composition

Once you hold the delegates that carry an operation, **what you do with them is your application's policy, and it depends on what the operation means:**

- an *invoke-this-specific-thing* operation is a **route-to-one** — pick the best candidate and call it;
- a *what-can-you-all-do* operation (a `listFormats`, a catalog) is an **aggregate-across-all** — call every candidate and union the results;
- others may fan out, race, or fall through.

Applications also narrow candidates by criteria of their own that this contract cannot know. The OpenBindings CLI, for example, takes the most-preferred candidate *that also supports the binding format at hand* — the format filter is its domain logic, layered on the contract's carrier-matching. `resolveDelegate` hands you the carriers in preference order; routing, aggregating, and filtering stay yours.

## Trust is the registering party's

Registering a delegate **is** the trust decision. A delegate's declared operations are author-asserted — the contract attaches no verification semantics to them, exactly as the spec attaches none to operation correspondence in general. You register delegates whose authors you trust, and you protect the registration surface accordingly: if you don't want arbitrary parties registering delegates into a piece of software, keep its manager local, authenticate it, or both. A manager MAY additionally verify whatever it likes at registration (schema compatibility for the operations it cares about, reachability probes); that diligence is its own, not this contract's.

Trust here is deliberately **binary** — registered or not — which is why the contract has no per-operation veto ("X may inspect but never invoke"). A veto is a selection rule, and selection belongs to the application doing the selecting: the registry stores ranking advice, never bans. An application that wants operation-scoped restrictions enforces them where it selects, and a manager MAY expose such controls as extensions beyond this contract; if ecosystem usage converges on a shape, a future version can standardize it.

## What you consume, not what you offer

A program's own OBI describes what it *offers*; its delegate registry describes part of what it *consumes*. The two are independent. A delegated operation may also be one the program exposes — a facade, fulfilling its own surface by reference — or it may never appear on the program's interface at all, registered purely so internal features can use it ("register a delegate that carries `y`, and this feature lights up"). This contract never asks which: `resolveDelegate` matches the caller's needs against what delegates carry, not against what the caller exposes.

## Application-agnostic by design

This is the *delegator's* side of the delegate pattern, published so any delegating application exposes the same registry — not just the OpenBindings reference tooling. That tooling is one instance: its needs happen to be the three format operations (`invokeBinding`, `synthesizeInterface`, `inspectSource`); it registers itself as a delegate and prefers its own; it aggregates `listFormats` while routing the rest. None of that policy lives here. A different application, with entirely different operation-needs and its own composition rules, uses these same five operations unchanged.

## Operations

| Operation | Purpose |
|---|---|
| `registerDelegate` | Register a referenceable OBI as a delegate: resolve it, snapshot the operations it carries (fails if unresolvable; re-register to refresh) |
| `unregisterDelegate` | Remove a registered delegate (idempotent) |
| `listDelegates` | List every registered delegate, its operations, and its preferences |
| `resolveDelegate` | Given an operation you need, return the delegates that carry it, ordered by effective preference |
| `setDelegatePreference` | Set or clear (`null`) a delegate's preference — the delegate-level default, or one operation's entry in its preference index |

For how these compose with the operation invoker into opportunistic delegation, see the non-normative **delegate pattern** guide on openbindings.com.
