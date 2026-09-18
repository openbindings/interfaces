# Delegate Manager cases

These are portable input/expected-result definitions for the role-scoped,
by-value [Delegate Manager](../../delegate-manager/). They are reference material,
not a second authority or an implementation. No role is an OB capability ID, and
no case depends on an account model, HTTP, a disk layout, or a selection policy.

`admission.json` contains 17 isolated cases. A harness creates an empty manager
with the supplied `roles`, then attempts to enroll `interface` for
`requestedRoles`. `expected.admitted` states whether that attempt succeeds.
Each role's operational qualifications are assumed satisfied; no evidence beyond
the supplied schemas is available to establish compatibility. Unspecified output
therefore cannot prove a required output contract. A rejected attempt leaves the
registry unchanged. Successful attempts preserve the complete supplied OBI and
exact explicit role set, and allocate a fresh opaque identity.

Implementations must consume complete alternatives, not join partial alternatives.
One provider operation may adopt multiple required canonical keys. A similarly
named bare operation cannot displace an exact qualified correspondence. The
runtime application's reuse of that correspondence must be tested separately.

The complete ten-step lifecycle values live in
[`management-example.mjs`](../../delegate-manager/management-example.mjs).
Its `r1` is an illustrative identifier: an implementation harness captures the
ID returned by enrollment and consistently substitutes it for subsequent calls
and expected outputs; it must not expect that literal from a real manager.
Its transcript assumes no concurrent administrator. Concurrency, persistence,
recovery, capacity limits and routing need implementation-specific tests, not a
mock manager in this corpus.

`legacy-location-draft.json` is the immutable previous public draft at interfaces
commit `5970c6ebdcb8ea711c91b97752b80787ac045165`. It supports explicit old/new
comparison; it is not the current manager or an active compatibility promise.

Run `node delegate-manager/verification.mjs` from the repository root to check
artifact schemas, embedded document structure, example shapes and the intended
break against that old fixture. These checks do **not** execute admission,
mutation, invocation, or migrations. A runtime cannot claim conformance merely
because the artifact checker passes.
