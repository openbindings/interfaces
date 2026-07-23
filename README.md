# OpenBindings Interfaces

The **shared, unbound interfaces** published by the OpenBindings project: reusable OBI contracts that independent tools adopt — by operation-name correspondence — to interoperate.

This repository is **not the specification**. The normative specification and its JSON Schema live in [openbindings/spec](https://github.com/openbindings/spec); the interfaces here are ordinary OpenBindings *documents* authored to that specification. They are:

- **Non-normative** — not required by the core spec. A tool conforms to OpenBindings without supporting any of them.
- **Shared contracts** — published so independent implementations can recognize the same capability by a common name.
- **Unbound** — they define operation contracts (operation shapes), not bindings, so they aren't invoked directly. Each is a **compatibility target**: a service corresponds to one by carrying the contract's operation names on its own, independently bound interface, and a tool checks the two for compatibility. One interface can correspond to several contracts at once.

The project publishes these under its own `openbindings.*` operation namespace exactly as any third party would publish theirs under its own; the spec privileges none of them.

## Canonical URLs

Each interface is served at a stable URL on openbindings.com:

    https://openbindings.com/interfaces/<name>/<version>.json

for example `https://openbindings.com/interfaces/document-store/0.1.json`. That URL is where tools fetch the contract and what you point a compatibility check at (`ob compat <url> <candidate>`, `fetchInterface(url)`). An OBI document carries no identity of its own, so the URL is simply how the contract is addressed, and keeping it stable is the whole job (see Immutability). This repository is the source of truth, laid out as `<name>/<version>.json`; the site vendors and serves it at the URL above.

## Immutability

A published version file is **append-only**: once `<name>/<version>.json` is released it is never edited. A breaking change ships as a new version file beside the old one (`0.1.json` → `0.2.json`), never as an edit to a released file. Contract versions have **no patch axis**: any change to a published contract, however small — editorial included — ships as the next version file; there is no in-place `0.1.1`. CI enforces this on pull requests.

This repository has no git tags and no CHANGELOG, by design: the append-only version files are themselves the release history, and the canonical URLs are the release surface. Publishing a new `<version>.json` is the release; a tag or changelog entry would only restate what the version files sitting side by side already record.

> **Pre-launch status:** the project has not yet cut its first release, so the current version files are still working drafts and may be amended in place. The append-only rule (and its CI enforcement) arms at launch.

## Interfaces

Each interface lives in its own directory, with one file per version. The major.minor segment of the filename is the interface's **own contract version** (its `version` field), which is independent of the `openbindings` spec version the file targets: a brand-new contract starts at `0.1.json` even though it is written against spec 0.2.0, while a previously-published contract that takes a breaking change advances to `0.2.json` (see Immutability above).

Interface **names** carry no `openbindings.` prefix: the `name` field is a label, not an identifier, and an OBI carries no identity of its own (a contract is addressed by its canonical URL above). Operation **keys** are fully qualified as `openbindings.<interface>.<operation>` (for example `openbindings.binding-invoker.invokeBinding`); the rationale is in Authoring conventions.

- `software-descriptor/0.2.json` — base software descriptor contract. Defines the canonical `describe` operation and `SoftwareIdentity` schema for self-identifying software. Generic capability.
- `binding-invoker/0.1.json` — binding invoker contract. Defines `listBindingSpecs`, `invokeBinding`, and the `prepareBinding` preflight for components that invoke bindings governed by specific binding specifications (`openbindings.openapi@1`, `openbindings.mcp@1`, and the rest). `invokeBinding` is a typed bidirectional I/O operation: the caller streams `BindingInvokerInputFrame` messages in (`open`, `input`*, `close`) and the service streams `BindingInvokerOutputFrame` messages back (`output`/`input_closed`* terminated by `complete` or `error`). The frame protocol covers unary, server-streaming, client-streaming, and bidirectional bindings under one shape. (A new contract for spec 0.2.0, so its own version starts at 0.1.0; it supersedes the unrelated-by-shape `openbindings.binding-executor` 0.1.0.)
- `operation-invoker/0.1.json` — operation invoker contract. The by-reference peer of `binding-invoker`: `invokeOperation` resolves an operation (or binding) key against an OBI, requires a caller choice when several invocable bindings remain, validates and applies transforms, then performs binding invocation; `prepareOperation` is the preflight. Same frame protocol as `invokeBinding`, with the resolution/validation/transform semantics on top.
- `interface-synthesizer/0.2.json` — interface synthesizer contract. Defines strict OBI synthesis and synthesis with durable, verifiable coverage evidence for components that derive OBIs from existing source artifacts.
- `source-inspector/0.1.json` — source inspector contract. Defines `listBindingSpecs` and `inspectSource` for components that inspect source artifacts and return bindable targets, an exhaustiveness claim, and evidence explaining partial enumeration. (New for spec 0.2.0; first contract version 0.1.0.)
- `document-store/0.1.json` — generic store of named JSON documents (`get`/`set`/`delete` over an opaque key and a whole JSON object, in the document-database sense). Generic capability; a runtime may use one to hold binding context, but the store knows nothing about context. (Replaces the spec-0.1.0 `context-store`, which baked the context meaning into the store.)
- `delegate-manager/0.1.json` — delegate manager contract. The delegator's side of the delegate pattern: `registerDelegate` / `unregisterDelegate` / `listDelegates` / `resolveDelegate` / `setDelegatePreference` for software that keeps a registry of delegates (referenceable OBIs) and routes operations it needs to whichever registered delegate carries them. Application-agnostic — a delegate need correspond to no particular interface, matching is by operation-key correspondence, and what an application does with a resolved delegate is its own policy.

### Prior versions

Contracts published against spec **0.1.0** are **not carried in this repository.** They were published from `openbindings/spec` and remain immutably resolvable at that repository's `v0.1.0` tag, where they were published:

    https://raw.githubusercontent.com/openbindings/spec/v0.1.0/interfaces/openbindings.<name>/0.1.json

(for example `…/openbindings.context-store/0.1.json`). Copying them here would mint a second, never-published URL for a withdrawn contract, so it is deliberately not done. All six are superseded or withdrawn in spec 0.2.0; their lineage:

- `openbindings.binding-executor` → superseded by `binding-invoker` (a new, differently-shaped contract).
- `openbindings.context-store` → replaced by the generic `document-store`.
- `openbindings.host` → withdrawn; its invocation concerns moved into binding-invoker, whose context negotiation requires no particular storage or process architecture.
- `openbindings.http-client` → withdrawn (a generic HTTP capability with no consumer; the SDK's injectable `fetch` covers the browser case).
- `openbindings.interface-synthesizer`, `openbindings.software-descriptor` → continued as the `0.2` files in the cohort above (same names, contract version advanced 0.1 → 0.2).

## Profiles

Alongside the operation contracts above, the repository publishes **semantics profiles**: documented decision procedures the project's tooling implements, published so independent implementations can produce agreeing results. A profile is a README-only entry — it defines no operations, has no versioned `<version>.json` contract document and no canonical contract URL, and is not something an interface *corresponds to*; its conformance surface is prose plus a shared corpus under [`conformance/`](conformance/). Like the contracts, profiles are non-normative: the core spec requires none of them, and conformance to a profile is claimed independently of every other layer.

- `schema-comparison/` — the **Schema Comparison Profile** (identifier `OB-2020-12`, version 0.1): the JSON Schema comparison semantics behind interface compatibility checking (`CheckInterfaceCompatibility` in the SDKs, `ob compat`) — normalization, the fail-closed profile boundary, directional input/output subsumption, and finding suppression. Corpus: [`conformance/comparison/`](conformance/comparison/).

## How these interfaces relate

They compose rather than overlap:

- **source-inspector** and **interface-synthesizer** sit at authoring time: an inspector reports the bindable targets in a raw artifact, and a synthesizer turns an artifact into an OBI.
- **binding-invoker** invokes a binding by value. When required context is absent, it raises `CONTEXT_REQUIRED` before output or effects. A surrounding runtime may resolve the challenge, may persist durable values in a **document-store** or elsewhere, and may start a new attempt. The interface requires no store or process architecture.
- **operation-invoker** is binding-invoker's by-reference peer: hand it an OBI and an operation (or binding) key and it resolves the key, refuses unresolved choice among several invocable bindings, validates and transforms, and performs binding invocation. An implementation may compose an actual binding-invoker component or fuse the same semantics.
- **software-descriptor** is a universal add-on any of the above MAY also implement, so tooling can ask "what is this?" uniformly.
- **delegate-manager** is a registry of delegate candidates — referenceable OBIs — and resolves an operation to records that carry it. Registration is not trust or authorization; verification, filtering, and route-vs-aggregate composition stay with the application.

A service claims correspondence with one of these interfaces by giving the corresponding operation the contract operation's **key** as one of its own operation's identifiers — its key, or an `alias` alongside a different local key (see the spec's Operations section). Those keys are fully qualified (next section), so a single document can correspond to several of these interfaces at once without the adopted names colliding — a service that lists supported binding specifications for binding invocation, interface synthesis, and source inspection carries all three of `openbindings.binding-invoker.listBindingSpecs`, `openbindings.interface-synthesizer.listBindingSpecs`, and `openbindings.source-inspector.listBindingSpecs` on its one local operation. The name is author-asserted; the spec attaches no verification or trust semantics to it.

Correspondence is **per-operation**. Each adopted key is its own claim, and every runtime consumer of correspondence — delegate resolution, operation invocation — matches one operation at a time. Carrying part of a contract is normal: an implementation that adopts only `openbindings.document-store.get` and `.set` is fully usable for those operations; nothing requires carrying a contract's remaining operations to use the ones you have. Checking a whole contract (`ob compat <contract> <candidate>`) is a separate, opt-in assertion that every operation is present and schema-compatible.

## Authoring conventions

These conventions apply to the interfaces published in this directory and are recommended (but not required) for any third party publishing shared interfaces.

### Operation keys are qualified `openbindings.<interface>.<operation>`

Every operation key in these interfaces is `openbindings.` followed by the interface name and the operation's short name: `openbindings.binding-invoker.invokeBinding`, `openbindings.document-store.get`, `openbindings.software-descriptor.describe`, and so on. The short name alone (`invokeBinding`, `get`) is used in prose for readability, but the qualified form is the operation's actual key and the name a corresponding document adopts.

The keys carry the `openbindings.` project prefix deliberately, and it does two things. **Uniqueness:** interface-qualification alone (`binding-invoker.listBindingSpecs`) prevents collisions *within* a single document — a bare `listBindingSpecs` would collide across the three interfaces that define it — but it does not distinguish this project's `document-store` from another publisher's identically-named one, since a bare `document-store.get` from two authors is the same string. The project prefix makes the key globally unique, so `openbindings.document-store.get` never coincides with anyone else's. **Provenance:** an operation key travels apart from its document — adopted into another service's operation identifiers, written to a log, indexed by a registry — and once it has moved, the document's source URL no longer accompanies it. The prefix carries *who minted this contract, and where to find it* inline with the name, which a co-located URL cannot once the string has left home. This is the reverse-DNS bargain (Java packages, MIME `vnd.`): one convention buys uniqueness, attribution, and a discovery pointer, and it privileges no one — every publisher qualifies under its own token, so a third party would write `acme.document-store.get`. The prefix is still author-asserted; the spec attaches no trust semantics to it. The interface **name** carries no prefix because the name is only a label, not an identifier. The spec advises contract authors to choose operation names with a high likelihood of global uniqueness but prescribes no scheme; project-qualification is how this project meets that advice, and third parties may meet it however they like.

Schemas used as operation **outputs** (or nested inside output schemas) SHOULD NOT use `additionalProperties: false`. Published interfaces describe **minimum** requirements: implementations MUST provide at least the listed fields, but they MAY return additional fields beyond those described. Open output schemas allow these interfaces to evolve additively in future versions without breaking strict-compatibility consumers.

Schemas used as operation **inputs** MAY use `additionalProperties: false` when the interface wants to forbid unknown caller arguments (the typical RPC-style case). Strict input validation catches typos in caller code without affecting evolution: adding a field to an input schema in a future version is symmetric to a CALLER change, which is acceptable.

Some interfaces that mirror externally-defined schemas (e.g., OIDC) may use strict field sets where the upstream contract requires them. A closed **wire-protocol enum** is also exempt: when an output schema is a fixed set of frame variants rather than an evolving data shape (as in `binding-invoker`'s `BindingInvokerOutputFrame`), `additionalProperties: false` on each variant is correct — an unknown frame property is a protocol violation, not a forward-compatible addition.

### Schemas are intentionally self-contained per interface

Each interface in this directory is a self-contained document. Schemas are defined locally in each file rather than referenced across files via `$ref`, even when sibling interfaces use the same shape (e.g., `BindingSpecInfo` appears in binding-invoker, interface-synthesizer, and source-inspector).

The OpenBindings spec does not normatively define cross-document `$ref` resolution between these interface files. Self-containment means a tool can read and validate any one interface file without resolving external references.

Shared-named schemas across interface files SHOULD be byte-identical and should be kept in sync manually when changes are made. Drift across interfaces is a quality concern for the OpenBindings project, not a runtime concern for consumers (each interface is checked independently against an implementation).
