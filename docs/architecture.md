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

## Encrypted backup format

Before analysis is reported as ready, the imported snapshot is encrypted and verified locally.
Backups live under the app documents directory and use a directory-per-backup format:

- Contacts are split into bounded chunks (100 contacts by default).
- Every chunk is independently encrypted with AES-256-GCM and backup/chunk-specific authenticated
  data.
- Every encrypted chunk has a SHA-256 digest; the manifest has an aggregate digest over ordered
  chunk metadata.
- The AES key is stored separately in SecureStore under a backup-specific alias and is restricted
  to the current device.
- A temporary directory is used until every chunk can be hashed, decrypted, parsed, and counted.
  Only verified backups receive a manifest and move to their final directory.
- Incomplete temporary directories and invalid manifests are never listed as restorable backups.

The restore reader yields one decrypted chunk at a time. This allows a future live-contact restore
adapter to reconcile large directories without loading a second complete copy into memory. Live
contact writes remain disabled until that adapter and its source-revision safeguards are complete.

## Restore preview

Restore planning decrypts a selected verified backup and compares it with a fresh source snapshot
using native source contact IDs and semantic field values. It classifies backup records as
unchanged, update, recreate, or unavailable. Contacts added after the backup are never deleted.
When iOS grants limited contact access, absent records are classified as unavailable rather than
missing so the app cannot accidentally duplicate contacts it is unable to see. The preview is
read-only; live restore remains gated on complete photo archival, native write mapping, conflict
confirmation, and post-write verification.

## Mutation regression contract

The reference mutation engine applies accepted update, delete, and merge proposals atomically to
an immutable snapshot. It validates the complete batch before producing a new snapshot, so a
missing, stale, overlapping, foreign-source, or colliding contact prevents every operation in that
batch. Rejected and skipped proposals remain unchanged; pending proposals cannot be applied.

Every successful batch returns a receipt containing the touched and newly created contact IDs.
Rollback accepts only the exact pre-mutation backup identified by that receipt, restores touched
records, removes merge-created records, and preserves unrelated contacts added afterward. The
table-driven regression suite is the contract for future Expo, iOS, Android, and Google contact
writers. Live writers must also add adapter integration tests with injected partial-write failures
and post-write rereads before they can be enabled.
