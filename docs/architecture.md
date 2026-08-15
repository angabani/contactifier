# Contactifier architecture

Contactifier uses a feature-first, ports-and-adapters architecture. The contact domain is pure TypeScript and is intentionally isolated from React, Expo, native APIs, persistence, and network clients.

## Dependency direction

Dependencies point inward:

```text
app routes -> features -> application -> domain
                                ^
                                |
                         infrastructure
```

- `src/app` contains Expo Router routes and layouts. Routes compose feature screens and contain no contact-processing logic.
- `src/features` contains user-facing capabilities such as source selection, analysis, review, apply, and restore.
- `src/application` coordinates domain operations and side effects through ports.
- `src/domain` contains immutable contracts, rules, and pure functions. It must not import React, React Native, Expo, or infrastructure code.
- `src/infrastructure` implements contact sources, encrypted backups, persistence, model delivery, and ML inference.
- `src/composition` connects application ports to infrastructure implementations.
- `modules` contains local Expo modules implemented in Swift and Kotlin.

## Safety invariants

1. A live contact source is never modified before a backup succeeds.
2. Analysis operates on an immutable snapshot, not on live contacts.
3. Rules and ML produce proposed changes; they never apply changes directly.
4. Every proposed change remains reviewable and requires an explicit decision.
5. Apply operations use source identities and revisions to detect stale data.
6. Verification follows every apply operation.
7. Contact-derived data must not enter backend requests, analytics, or logs.
8. Device and Google contacts map to the same canonical domain model.

## State ownership

- React state: component-local interaction state.
- Expo Router: navigation and route parameters.
- XState: the backup-to-verification cleanup workflow.
- SQLite repositories: snapshots, proposals, decisions, and resumable checkpoints.
- Secure storage: encryption keys and authentication tokens.
- TanStack Query: non-contact remote state such as entitlements and model manifests.

Libraries are introduced only when the corresponding layer is implemented.

## First application boundary

`ReadContactSource` coordinates the initial read without knowing how contacts are fetched. It
depends on the `ContactReader`, `Clock`, and `IdGenerator` ports. Expo Contacts and Google People
adapters will implement `ContactReader` in infrastructure and return canonical contacts; the use
case validates their output before exposing an immutable snapshot to analysis features.
