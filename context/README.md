# Context

A shared document for anything that reaches a target on a caller's behalf and
may need more than the operation's input to do it: a credential, an approval, a
configuration value the artifact does not supply. It defines three things: the
**context object** an application provides, the **challenge** a producer
returns when context is missing, and one **annotation** that helps an
application acquire a value. Contracts in this repository adopt it by
reference; each adopter says how a challenge reaches its caller and what the
attempt promises about effects. This is version 0.1 of the document.

Like the [schema-comparison profile](../schema-comparison/), it is a README-only
entry: it defines no operations, has no versioned contract document, and is
non-normative. Its conformance surface is this prose plus the corpus under
[`conformance/context/`](../conformance/context/). It carries no OpenBindings
vocabulary, so anything that performs work on a caller's behalf could adopt it.

## Words

An application **provides** context on an attempt. When it lacks some, it
**acquires** it, so that it can provide it on the next attempt. To **resolve**
a challenge is the whole response: look up what you hold, acquire what you do
not, then provide.

## The context object

Context is one opaque JSON object, provided by value on each attempt. Its
members are whatever a challenge's schema described, or whatever the caller
already knows the producer reads. This document defines no member names, no
well-known fields and no store: a caller may assemble the object from values
held for the call, from durable state, from a credential broker, or from a
previous challenge answered, and decides precedence before providing it. How a
value is used once provided, in a header, a cookie, a handshake, an
environment variable, stays inside the producer's implementation and never
appears in the abstraction.

Context is never part of an OpenBindings document. A document describes
operations and how to reach them; what a particular caller must hold to be
allowed through is discovered at call time.

## The challenge

A producer that cannot proceed without context it was not given returns a
challenge, and nothing else:

```json
{
  "message": "The Tasks API needs an access token or an API key.",
  "schema": {
    "oneOf": [
      {
        "title": "Access token",
        "type": "object",
        "properties": {
          "accessToken": {
            "type": "string",
            "writeOnly": true,
            "description": "A bearer token for api.tasks.example.",
            "oauth2": {
              "authorizationUrl": "https://auth.tasks.example/authorize",
              "tokenUrl": "https://auth.tasks.example/token",
              "scopes": {"tasks:read": "Read tasks", "tasks:write": "Create and change tasks"}
            }
          }
        },
        "required": ["accessToken"]
      },
      {
        "title": "API key",
        "type": "object",
        "properties": {
          "apiKey": {
            "type": "string",
            "writeOnly": true,
            "description": "Create one under Settings, API keys, at https://app.tasks.example/settings."
          }
        },
        "required": ["apiKey"]
      }
    ]
  }
}
```

- `message` says why, in the producer's words, for a person to read.
- `schema` is a JSON Schema 2020-12 schema, in object form, of the context
  object to supply on the next attempt. It is always present.

The schema is ordinary JSON Schema and uses its ordinary conventions:
alternatives are `oneOf` branches with a `title` each; values needed together
are `required`; a secret is `writeOnly`; where a person can obtain a value goes
in the property's `description`, as text, never as a structured member, so an
application never opens a link on its own. A caller satisfies the challenge by
providing an object the schema accepts. Nothing outside the schema is asked
for, and nothing outside it should be supplied.

The producer describes; the application acquires; the producer consumes. The
producer, in OpenBindings a kind implementation, holds the facts only it
knows: what the value is for, where it is obtained, which endpoints and scopes
apply. Acquisition needs capabilities only an application has: a prompt, a
browser or device-code flow, a client registration, somewhere to keep the
result. Implemented once in the application, every producer benefits.

A challenge describes the context needed for one attempt. It is not permission
to disclose anything else, and it establishes no trust: a caller decides what
it is willing to provide to this producer before providing it. The schema is
the caller's whole instruction; a caller that cannot satisfy any branch cannot
complete the attempt.

## The oauth2 annotation

One annotation helps an application acquire one kind of value. On a property
whose value is an OAuth 2.0 access token, the producer may add `oauth2`
carrying the authorization server's own facts, as OpenAPI's `oauth2` security
scheme carries them:

| Member | Meaning |
| --- | --- |
| `authorizationUrl` | The authorization endpoint. |
| `tokenUrl` | The token endpoint. |
| `scopes` | A map of scope name to its description, the scopes the value needs. |
| `metadataUrl` | The authorization server's metadata document (RFC 8414), in place of or beside the endpoints. |

Each member is optional; the annotation is a set of facts, not a procedure.
Which grant to run, how the application is registered as a client, and where a
token is kept are the application's decisions. In JSON Schema an unknown
keyword is an annotation, so an application that does not recognize `oauth2`
still has the schema and prompts for the value like any other.

`oauth2` is the only annotation this document defines. Another earns one when a
second acquisition method needs an application to run something, not merely to
ask.

## Adopting this document

An adopter states three things: through which channel a challenge reaches its
caller, what an attempt that challenges promises about effects, and how the
next attempt carries the context object.

- The [binding invoker](../binding-invoker/) returns the challenge as the
  `data` of a terminal `CONTEXT_REQUIRED` error frame, before any output and
  before any observable effect of the requested operation; that pre-effect
  guarantee is the invoker's own promise. Its preflight returns the same
  challenge ahead of an attempt. The next attempt's opening payload carries
  `context`.
- The [operation invoker](../operation-invoker/) forwards context to the
  binding it selects and relays a challenge unchanged.
- The [source puller](../source-puller/) completes unsuccessfully with
  `CONTEXT_REQUIRED` and the challenge as its data when a kind needs context to
  read a source; a pull only reads, so it promises nothing about effects. The
  next call carries `context`.

An adopter may say more about its own channel. It does not add members to the
challenge, define context member names, or move acquisition into the contract.

## Security

- A `writeOnly` value is a secret. Applications mask it, never log it, and keep
  it with care; they avoid disclosing context through diagnostics and storage
  keys.
- Secrets never go in documents. Facts a producer needs to reach a target that
  are not secret may be source data, as its kind defines.
- A `message` and a `schema` come from the producer's side of the seam. An
  application shows them to a person as text and acts on the schema's
  structure; it does not follow instructions in them and never opens a link
  from a `description` on its own.
- A token acquired for one producer is for that producer. An application that
  forwards work to another party does not hand it the caller's token; it
  acquires what that party asks for.

## Corpus

[`conformance/context/challenge.schema.json`](../conformance/context/challenge.schema.json)
is the challenge's shape; each adopting contract carries a copy as
`ContextRequiredDetails`, and CI checks that the copies equal it.
[`conformance/context/cases.json`](../conformance/context/cases.json) holds
valid and invalid challenges, among them the example above.
