# Carried values

These cases separate structural schema acceptance from the contracts' behavioral
refusal rule. The Source and Binding schemas remain open for extension carriage
within OB-2020-12; their openness does not license unknown non-x- members.

An invoker implementation should replay refusal cases and assert ERR_REFUSED
before work, including before dispatch; preflight refuses without work too.
The repository check verifies schema/namespace expectations only. It is not a
substitute for testing a running implementation. Inspector/synthesizer refusal
and inspector producer obligations need corresponding implementation tests.

## Harness kind

`example.carried-values@1` is fixture-only. It admits every JSON content value and
absence, reads no external resources, and designates one target `target`. Its
invocation returns the input unchanged; its inspector produces that target with
`binding: {}`; synthesis records the supplied source unchanged and emits that
binding. All three jobs can truthfully answer kind support. These simple meanings
keep kind interpretation from masking carrier refusal. A runtime adapter records
whether kind work was entered: every refused case must stop before that entry,
preflight included. Producer fixtures are checked on returned target bindings.
The repository tests only schema and rule consistency; they do not instantiate
this harness runtime or claim to observe its side effects.
