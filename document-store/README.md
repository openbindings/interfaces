# Document Store

A generic store of named JSON documents: `get`, `set`, and `delete` whole JSON objects by opaque key.

"Document" here is used in the **document-database** sense — any JSON object, keyed and stored whole. It is *not* specifically an OpenBindings document (though an OBI, being a JSON object, is a perfectly valid thing to store). The key is an opaque string and the document is any JSON object; the interface prescribes neither a key-derivation scheme nor a schema for the object beyond "it is a JSON object." That is the whole point — it is the minimum surface that lets independent stores of keyed JSON be interchangeable.

## Operations

- `openbindings.document-store.get` — retrieve the document for a key; returns `null` if there is no entry.
- `openbindings.document-store.set` — store a document for a key, replacing any existing document in full.
- `openbindings.document-store.delete` — remove the entry for a key; idempotent (deleting a missing key succeeds).

## Positioning: an optional at-rest companion

This interface is **not required by any implementation**. Context negotiation is defined in flight by the [`binding-invoker`](../binding-invoker/) contract: what "context" means, how a `CONTEXT_REQUIRED` challenge is resolved, and which fields a context object carries all live there. A document store is simply where context-shaped state can **durably live at rest** when you want the storage seam to be *substitutable* — a shared credential service, a delegate-managed store, an on-disk file, an OS keychain — rather than baked into one tool. An implementation that keeps its context in a private, non-substitutable place corresponds to no store contract at all and is none the worse for it.

Like every interface in this catalog it is **non-normative**: the core spec requires it of no one, and conformance is claimed independently of every other layer (an implementation may carry `get`/`set` alone and be fully usable for those; checking a whole contract with `ob compat <contract> <candidate>` is a separate, opt-in assertion).

## Using it as a context store

A **context store** is this interface used with **target-URL keys**, holding the context objects that `binding-invoker` defines. The store itself never learns that: it sees an opaque key and an opaque JSON object. Everything domain-specific about that pairing —

- what a context object contains (the `bearerToken` / `apiKey` / `basic` / `headers` / … well-known field conventions), and
- how a storage key is derived from a target (e.g. normalizing to `host[:port]` so families sharing a host share context)

— belongs to the [`binding-invoker`](../binding-invoker/) contract and the runtime that resolves its challenges, **not** to this store. See binding-invoker's *Context* section for that field taxonomy. When a binding raises a `CONTEXT_REQUIRED` challenge, the runtime resolves it and persists durable results in a store like this one, keyed by the target it reports.

Confidentiality is likewise a **deployment-boundary** concern, not a property of this contract: whether documents are encrypted, access-controlled, or redacted on read depends on where the store runs and who can reach it. By contract, `get` returns what `set` stored — with one pinned edge: storing `null` is equivalent to `delete`, so `get`'s `null` uniformly means "no entry" and never an entry holding null.

## Generally reusable

Nothing here is OpenBindings-specific. Any ecosystem participant can use a document store for its own keyed JSON state — configuration blobs, cached artifacts, session records, or OBIs themselves — without touching the context loop at all. The context-store pairing above is one application of a deliberately generic contract, not its definition.

## Not prescribed

Listing keys, inspection, rotation, auditing, TTL/expiry, and scoping are all outside this contract. An implementation that wants a richer management surface exposes those as its own additional operations; a binding invoker's runtime needs only `get`/`set`/`delete`.
