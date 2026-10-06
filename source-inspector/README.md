# Source Inspector

A source inspector examines a binding source before an OBI is created. It returns bindable targets that tooling can offer to users, optionally including a suggested operation key and operation framing for each target.

This powers tooling that helps users select which operations to include when authoring an OBI without relying on non-normative selector naming conventions.

## Kind support

`checkKindSupport` is the authoritative support operation for this interface's
job. It accepts `{ "kinds": [...] }` and returns one `{kind, supported}` verdict
per unique input kind, in first-occurrence order. Kinds compare by exact
whole-string equality, without normalization, prefix matching or dereferencing.

True means the implementation knows how to read the kind for its job, whether
that meaning is published, private or defined only in code. It does not promise
that every case is within reach: an unhandled case is refused before work or,
where the operation provides a partial-result route, omitted and disclosed.
False means every call on that kind is refused before work. The result is
deterministic for a given implementation version and configuration. An internal
pattern may compress the supported set but MUST NOT extend it. Future optional
verdict fields may annotate the answer, never qualify the boolean.

`checkKindSupport` MUST have no side effects: it neither acquires nor modifies
source artifacts or performs the interface job.

`listSupportedKinds` is advisory. Every listed kind MUST receive true from this
interface's check; absence from the list says nothing. Support is per job:
invocation, inspection and synthesis can have different answers.

## Sources and bindings by value

The carriers use the OpenBindings 0.2 core types. A source may contain only
`kind`, `content`, `description` and `x-` extensions. A binding may contain only
`operation`, `source`, `content`, `idempotent`, `preference`, `description`,
`deprecated` and `x-` extensions. A wrong core type or any other member MUST be
refused before work. The schemas stay open to preserve extensions; this rule
still rejects a legacy `selector` or `location` instead of treating it as absent
content.

Source and binding content each preserve absence versus present JSON null. A
binding with no members is `{}`. The binding's `operation` and `source` members
are forwarded verbatim; this interface gives them no meaning and neither
forbids nor designs for a kind reading them. Kinds are best served identifying
targets through `content`. Other binding metadata is information, not an
instruction. An implementation acts on exactly the source and binding values
sent to it.

## When to use it

Source inspection is the right primitive when a caller is authoring an OBI from an existing artifact and wants to choose which targets to bind. Typical surfaces:

- An interactive CLI authoring flow that shows the user a checklist of targets to bind.
- A web tool that lets a user pick endpoints from an uploaded OpenAPI spec.
- A code-generation step that needs to enumerate available bindings.

For non-interactive synthesis ("give me an OBI for everything in this spec"), use the [interface synthesizer](../interface-synthesizer/) directly. Inspection is the discovery step that precedes a targeted synthesis.

## Why this is a separate interface

Source inspection could conceptually be folded into the interface synthesizer as an extra operation. It is a separate interface because the capabilities are independently useful: a source inspector does not need to generate full OBIs, and an interface synthesizer does not need to surface targets to users. Splitting them lets a tool depend on exactly the capability it needs, and lets a service author publish an inspector without committing to full OBI generation.

## The `exhaustive` flag

`SourceInspection.exhaustive` tells the consumer whether `targets` is the complete enumeration of targets admitted by the source's kind.

- `exhaustive: true` means the inspector has reported every target that could be bound. A "select all" action in the UI is safe.
- `exhaustive: false` means more admitted targets may exist, for example because enumeration was bounded, part of a live source was inaccessible, or the implementation has a known gap. `limitation` states why; partiality is never silently described as completeness.

Inspectors SHOULD prefer `exhaustive: true` whenever the artifact permits complete enumeration. When it is false, `limitation.code` is stable machine-readable evidence and `limitation.message` is diagnostic prose. A private relevance filter does not justify omitting targets unless its criteria are explicit caller input or an extension understood by both parties.

The inventory boundary matches synthesis: a bindable target is a source interaction the source's kind admits and for which a conforming binding can be formed. Upstream interactions the kind deliberately excludes are not bindable targets; complete upstream coverage, including exclusions, is the interface synthesizer's coverage surface.

## Targets and optional operation framing

Every target requires a stable, source-local `sourceRef` and a `binding` object.
The binding preserves content presence and any permitted authoring metadata; the
inspector MUST NOT include `operation`, `source`, or an unknown non-core,
non-`x-` member in it. Consumers MUST reject a target violating either the
author-key restriction or the allowed binding-member set. The author builds the
entry as `{...target.binding, operation: authorKey, source: sourceKey}` so the
author's keys win. Include a binding `idempotent` claim only where the source
states it. Operation framing never carries that member.

`operation` and the suggested `operationKey` are optional. Missing framing is
not an error; supplied framing MUST be a sound projection of that same target.
An implementation offering both inspection and synthesis uses the same
`sourceRef` for the same target-scope unit. Cross-implementation equality is
promised only where the kind defines those identifiers; a consumer cannot join
two producers' inventories by matching `sourceRef` alone.

Inspection lists admitted targets, not excluded ones. An admitted target the
implementation cannot establish or represent requires `exhaustive: false` and
limitation evidence. Inability to read the source at all refuses the call.
Substituting the source or a binding after inspection makes the edited
correspondence the caller's claim; source-relative binding content may need
translation as well.

## Idempotency

`inspectSource` promises idempotent behavior: inspection does not intentionally
change the source or external state. For the same observed source state and
implementation configuration, targets and ordering are stable. A live
location interpreted from the source's kind-owned content may change between calls; idempotency does not make an external
resource immutable.
