# Interface Synthesizer

An interface synthesizer produces an OBI from sources read under their exact
kinds. Source content may contain an OpenAPI document, descriptor set or another
representation; the kind decides how to read it, including any incorporated
artifact authority. A kind may instead be private or defined only in code.

This is what powers OBI synthesis from a raw source artifact: source-driven authoring (register a source, then pull it to derive operations and bindings), on-the-fly synthesis when a consumer is handed a spec it has no OBI for, and any tool that needs to bootstrap OBI adoption from existing specs.

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

## Two synthesis surfaces

This interface exposes two forms of the same derivation:

- `synthesizeInterface` is the convenient strict surface. It returns the OBI
  directly and never uses a transient diagnostic to excuse an omitted target
  that the source's kind admits.
- `synthesizeInterfaceWithCoverage` returns the OBI together with durable,
  machine-readable dispositions for the source interactions considered by that
  same call and an explicit exhaustiveness claim. It may return a sound partial
  OBI when every omission is accounted for; it never turns disclosure into
  permission to emit an unsound binding.

The coverage form is substrate, not an API registry or crawler. It defines the
evidence such products can consume without defining discovery, storage,
ranking, trust, health checking, or invocation policy.

## Authentication is not extracted

An OBI document carries no authentication or `security` section, so a synthesizer does not extract credentials, security schemes, or auth requirements into the OBI. Authentication is a runtime prerequisite, not interface metadata: the binding invoker may negotiate it at call time via a `CONTEXT_REQUIRED` challenge (see the [`binding-invoker`](../binding-invoker/) interface).

A source artifact's security declarations are not extracted as core OBI authentication fields. They can remain in the unchanged source content when the kind carries an embedded artifact, and can inform runtime prerequisites.

## Multi-source composition is implementation-defined

The input's `sources` is an array, but how many sources one call composes
into the resulting OBI is the implementer's capability decision — a
service-level synthesizer may merge many artifacts; a single-kind one
legitimately handles a single artifact. What no implementation may do is
answer for a subset silently: an implementation that does not compose all
supplied sources MUST refuse the multi-source input rather than synthesize
from some and drop the rest.

## Synthesis without sources

`sources` is optional, and omitting it is a legitimate call rather than a
malformed one. The result is a valid OBI with no operations, no sources, and
no bindings: the skeleton an author fills in by hand, or extends later by
registering sources against it.

The source-less case is also the one place where `name`, `version`, and
`description` are not overrides. Those fields override what would otherwise
be derived from a source artifact, and with no artifact there is nothing to
derive, so an omitted field has no underlying value behind it. What an
implementation substitutes for those three, is
implementation-defined and carries no cross-implementation meaning. The
determinism rule below still applies, so the same source-less input yields
the same document every time and a scaffold can be diffed against a
checked-in one. A caller that needs a particular identity supplies the fields
rather than relying on any implementation's placeholder.

## Other extraction conventions

A source's kind governs **interpretation and faithful correspondence**, including what its content means and the soundness of an OBI derived from it. That does not make this Synthesizer interface, its generation strategy, or its reporting product a prerequisite for interpreting the kind. This optional contract separately defines its own derivation and reporting promises. The principles below apply across kinds; strategy detail belongs to each implementation's own reference documentation, subject to the source's kind.

- **Operations.** Each callable target in the source becomes one operation. The operation key SHOULD be stable across regenerations: derive it from a source-level identifier (OpenAPI `operationId`, gRPC method name, GraphQL field name) rather than from positional ordering.
- **Schemas.** Resolve `$ref` pointers when the source artifact uses them, so the produced OBI is self-contained. Cycle-protect when the artifact permits cyclical type references.
- **Sources.** Each input is `{name?, source}`. The emitted source is exactly the supplied source, including extensions and content presence. When supplied, `name` is its key; otherwise naming is the synthesizer's choice. The same source is interpreted and emitted; there is no separate read-versus-record control.
- **Bindings.** Each binding's kind-owned `content`, or its absence, MUST identify a target the corresponding binding invoker can realize. A selector is used only where that kind defines one, inside its own content representation. No core `selector`, `inputTransform`, `outputTransform` or document `transforms` member is emitted. Any required adaptation is expressed under the kind's definition.
- **Aliases (optional).** A synthesizer MAY add operation `aliases` to claim correspondence with a shared contract (for example, a well-known operation name a consumer can target across providers). The name is author-asserted and carries no verification semantics.

## Source substitution after synthesis

To read embedded content but record an address, supply a known `name`, synthesize,
and replace `result.sources[name].content` afterward. To record no content,
delete the member; setting null records a different source. The synthesizer's
soundness and coverage evidence describe the original supplied form. The caller
owns the edited document and must preserve or translate affected bindings:
changing source representation can change the meaning of source-relative
binding content. A remote synthesizer acts only on what it is sent.

An explicit `openbindingsVersion` MUST name the 0.2 line. Other lines are refused;
omission still targets the 0.2 line. No input source content is normalized or replaced by this
interface's own artifact-carriage convention.

## Creation-time soundness

Synthesis is a claim that the emitted interface can be realized through the
source's kind. Against the artifact, listing, descriptors,
or discovery state observed by a synthesis call, every emitted binding MUST
resolve to its identified target, fall within the kind's supported
subset, and admit at least one faithful invocation path when its declared
runtime prerequisites are available. A synthesizer MUST NOT emit an operation
that the corresponding conforming binding invoker is statically guaranteed to
refuse.

For `synthesizeInterface`, the operation set is complete for the callable
targets the source's kind admits in every source input the call
accepts. An implementation may refuse an unsupported artifact or source
representation as a whole; after accepting one, it cannot redefine individual
admitted targets as outside its accepted subset. If it cannot produce a
faithful, bindable operation for one of them, the call MUST fail rather than
silently return a partial interface. A transient warning is not sufficient
notice that an admitted target was omitted.

A wholly unreadable source MUST be refused. If only part of its inventory can
be established, the coverage surface MAY return a sound partial interface with
`exhaustive: false` and limitation evidence explaining the unknown remainder.
Every established admitted unit that cannot be represented is disclosed as
`implementation-unsupported`; established exclusions and invalid units keep
their actual dispositions. Strict synthesis MUST refuse when it cannot establish
and faithfully represent the complete admitted inventory.

A non-fatal warning remains appropriate when an emitted operation is usable
but its schema is necessarily a conservative or lossy projection. Such a
warning MUST NOT mean that the operation is guaranteed to refuse. Missing
credentials, consumer-selected configuration, unavailable peers or host
capabilities, and caller values that fail validation are runtime conditions,
not creation-time synthesis defects.

## Coverage accounting

Soundness and coverage are independent:

- **Soundness:** every invocation admitted by an emitted OBI operation has a
  faithful path through the kind's interpretation to the source interaction.
- **Coverage:** every upstream interaction or independently selectable
  alternative observed in the source has a recorded disposition, and every
  one admitted by the kind is represented.

`synthesizeInterfaceWithCoverage` returns one disposition for every
**interaction unit** in the inventory it claims to have enumerated. A unit is an addressable target
or an independently selectable alternative whose omission would remove a
source-permitted invocation path. A request media alternative is a unit; a
parameter's incorporated serialization keyword is behavior of its parent unit,
not a separate unit. Implementations document the inventory defined by each kind and
MUST NOT choose a coarser unit merely to hide loss. A report MAY additionally
carry `projection` entries for schema or semantic fidelity concerns attached
to represented units; those entries make loss measurable without pretending
that each projection is another independently invocable upstream operation.

Each disposition is one of:

- **`represented`** — the emitted OBI contains the named operation and binding
  path. Runtime prerequisites such as credentials or a required codec are
  carried separately and do not make the unit unrepresented.
- **`excluded`** — the kind explicitly excludes this upstream-valid unit. The
  disposition identifies the kind-owned rule in its defining document or code,
  with enough revision information to locate it, and explains the boundary.
- **`invalid`** — the source unit is malformed or internally contradictory
  under the kind or an authority it incorporates.
  Whole-artifact failures may still terminate the call before a report can be
  produced.
- **`lossy`** — the invocation path is represented, but the emitted OBI
  framing cannot express part of the source contract exactly. This is durable
  disclosure of a projection gap, not permission to emit a binding that is
  statically guaranteed to refuse.
- **`implementation-unsupported`** — the kind admits the unit but
  this synthesizer cannot represent it. This is an implementation gap, never a
  kind-defined exclusion. A reference implementation has no such
  disposition at release.

`exhaustive: true` means every interaction unit in every accepted input source,
as defined by the kind, has
exactly one disposition. It does not merely mean "everything the
implementation happened to notice." If the implementation cannot establish
that claim, it reports `exhaustive: false` and includes a machine-readable
`limitation` explaining what may be missing and why. A false flag without that
evidence would disclose uncertainty without making it actionable.

`fullyRepresented: true` additionally means every upstream-valid unit is
represented without a lossy or unsupported disposition; the value is derived
from the entries and MUST NOT contradict them. Exclusion can therefore be
honest and exhaustive without being described as full upstream coverage.

A represented or lossy target, alternative or projection entry identifies the
emitted source, operation and binding by key. The binding is read from the
emitted interface; coverage does not duplicate its content. A dependency entry
carries no emitted source, operation or binding key. Every emitted dependency
has exactly one represented or lossy dependency-scope entry.

`sourceRef` identifies the unit within its input source. An implementation that
also inspects uses the same identifier for a target-scope unit in both products;
across implementations they agree only when the kind defines them. Alternative
units have their own identifiers.

An `excluded` entry MUST supply `rule` identifying the kind-owned exclusion,
with enough revision information to locate its defining document or code. An
implementation's restriction of a kind defined elsewhere is
`implementation-unsupported`, not a kind exclusion. Other non-represented
entries also identify the unit, with stable reason codes and explanatory prose.
An exhaustive report accounts for the complete declared inventory, including
excluded and invalid units, alternatives and dependencies.

The coverage report is evidence, not proof: a consumer may independently
compare the source, report, and OBI, and an untrusted synthesizer can still make
a false claim. The report is part of the operation result, not a callback. It remains
available when the OBI is persisted or handed to another process. A warning
callback MAY provide immediate authoring feedback, but it is not coverage
evidence.

This is a creation-time invariant, not a temporal-consistency guarantee. A
synthesizer preserves the source's declared embedded-versus-live semantics; it
does not have to embed, hash, refresh, or otherwise pin a mutable artifact or
service. Later artifact or service drift is external lifecycle state. On a
later invocation, the source's kind determines how the
current source is interpreted and when drift produces refusal.

## Deterministic output

A synthesizer SHOULD produce byte-stable output for byte-stable input. That means: stable property ordering, stable iteration order over operations, no embedded timestamps, no generated UUIDs. Determinism lets CI compare synthesizer output against checked-in OBIs without spurious diffs.

## Idempotency

Both synthesis operations promise idempotent behavior: calling them does not intentionally
change source or external state. For embedded content, the same input and
implementation configuration produce the same semantic result. A live
`location` may resolve to different content over time; idempotency does not
pretend a mutable external resource is frozen. Deterministic ordering applies
to each observed source state.
