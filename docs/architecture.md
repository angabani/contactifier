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
- Domain state machine: the backup-to-verification cleanup workflow and its legal transitions.
- Encrypted file repositories: reviewed changes, dry-run plans, and resumable operation journals.
- Secure storage: encryption keys and authentication tokens.
- TanStack Query: non-contact remote state such as entitlements and model manifests.

Libraries are introduced only when the corresponding layer is implemented.

## Resumable cleanup workflow

The cleanup aggregate owns the reviewed change set, verified backup identity, prepared write plan,
phase, and append-only operation journal. Legal transitions are enforced in the domain rather than
being inferred from screens. Every successful native operation and compensation must be journaled
before the executor proceeds; verification cannot begin until every prepared operation is recorded.

Workflow checkpoints use optimistic revisions, so a stale screen or retry cannot overwrite newer
progress. Each revision is serialized, split into bounded 256 KiB chunks, and encrypted with
AES-256-GCM using revision/chunk-specific authenticated data. The key remains in device-only
SecureStore. Revisions are immutable directories and the commit metadata is written last; an app
termination during persistence leaves an ignored temporary directory and the previous revision
resumable. The plaintext commit contains only workflow identity, phase, revision, timestamps, and
encrypted chunk integrity metadata—not contact data.

On startup, the home screen lists only unfinished workflow metadata. Resume succeeds only when the
workflow's exact backup id, snapshot id, and contact source resolve to a verified encrypted backup.
That backup reconstructs the reviewed snapshot; a new live source read is still required by
preflight before any prepared operation can be considered current.

After a revision commits, the repository retains the newest two committed revisions and removes
older revision directories plus abandoned temporary directories. Pruning is best-effort and never
changes the result of a successful checkpoint: if cleanup fails, the committed revision remains
authoritative and cleanup retries after a later save. Keeping two revisions bounds repeated-review
storage while preserving the immediately preceding encrypted recovery point.

Users may explicitly discard an unfinished review. Discard is revision-checked under the same
repository serialization boundary as checkpoint saves, and is forbidden while apply, verification,
or rollback may be active. It removes the workflow directory first and then its SecureStore key;
the verified contact backup is owned by a separate repository and is never part of this deletion.
An idempotent retry cleans up a key left behind if key deletion previously failed.

## Simulated write executor

The application defines platform-neutral writer and verifier ports; no Expo/native implementation is
wired into production composition. The executor persists a write-ahead `started` journal entry
before invoking each simulated mutation, then persists a source-contact receipt after confirmed
success. Only a writer error that explicitly guarantees no mutation occurred permits automatic
rollback of earlier operations. An ambiguous error stops in a recoverable failed state because
guessing could duplicate or destroy a contact.

After all writes, an independent verifier must approve the prepared plan before completion. A
definite write rejection or verification failure compensates confirmed writes in the plan's exact
reverse order, journaling a typed receipt for every compensation. A recreation receipt stores the
replacement native identifier because operating systems are not required to preserve the deleted
record's identifier. Injected simulator failures cover successful apply,
partial failure, verification failure, rollback, and unknown-outcome behavior without exposing a
real device write path.

Unknown outcomes are handled by a separate reconciliation port, never by retrying the write. It
compares the affected live record with the operation's reviewed before/after states and returns one
of three explicit results. Confirmed applied outcomes receive a reconstructed receipt and are
compensated; confirmed not-applied outcomes require no compensation; both finish by rolling back
the rest of the confirmed batch. If live state matches neither side, the journal records
`ambiguous`, the workflow becomes non-recoverable `manual-review-required`, and automation stops.
Every `started` journal entry must therefore end as applied-and-compensated or confirmed
not-applied before a workflow may claim `rolled-back`.

Create operations carry a deterministic, workflow-plan-scoped `contactifier://write/...` URL
marker that is persisted before execution and written atomically with the new native contact. If
the process loses the create response, the iOS reconciler pages through the address book and
accepts the write only when exactly one marker match also has the intended semantic contact data.
No match is definitely not applied; duplicate or modified matches are ambiguous. Expo SDK 57
offers neither caller-assigned contact identifiers nor native idempotency keys, so ordinary
name/phone matching is intentionally prohibited.

After post-write verification, the workflow enters `finalizing`. Each create records
`finalization-started` before removing its marker and `finalized` with the native identifier and
removed marker afterward. Marker removal rereads the exact created contact, rejects semantic
changes, and is idempotent: an absent marker on the otherwise expected contact is already
finalized. A lost response leaves `finalization-outcome-unknown`; recovery requires a fresh,
workflow-bound capability authorization and resumes only unfinished finalizations. The workflow
cannot become `completed` until every create has a validated finalization receipt.

## Writer adapter certification

Every contact writer must run the shared adapter contract rather than maintaining a platform-only
interpretation of safety. The contract covers create, update, delete, stable source-identity
receipts, complete-plan verification, applied/not-applied reconciliation, exact compensation, and
definite rejection of missing or semantically stale targets. The in-memory simulator is the first
certified implementation. Passing this contract is necessary but not sufficient for production:
each native adapter must also pass platform integration tests for permission changes, process
interruption, limited access, native field mapping, and post-write rereads before its capability
flag may be enabled.

## Write capability gate

Certification is enforced at the executor boundary rather than trusted to screen visibility. A
writer receives a short-lived authorization only when its adapter is enabled, every required
evidence flag is certified, the runtime platform matches, full contact access is present, the exact
verified backup and fresh preflight snapshot match, and the user explicitly confirmed. The token is
bound to the adapter id, workflow id, and prepared change set and expires after five minutes. A
stale workflow still fails repository compare-and-swap before any write-ahead operation can run.

The production native-certification registry is intentionally empty. The simulator has its own
certification for tests, but that certification cannot authorize a differently identified writer
or a native platform. Adding a native adapter class alone therefore cannot make device writes
reachable; certification registration, runtime prerequisites, and executor authorization are all
independent required gates.

## iOS writer candidate

The iOS candidate uses the Expo SDK 57 `Contact` class API (`Contact.create`, instance `patch`,
`delete`, and `getDetails`); deprecated async mutation functions are not used because SDK 57 makes
them throw at runtime. It requires iOS plus full contact-library access before every operation,
rereads and semantically compares the reviewed before-state before update/delete, uses partial
patches to preserve unsupported native fields, and performs post-write rereads. Notes are omitted
because iOS requires a separate contacts-notes entitlement. Existing photos are preserved by
updates until photo backup and restoration are complete.

The adapter is deliberately disabled with every certification evidence flag false and is absent
from the production registry. Known blockers are real-device photo round-trip and interruption
tests and passing the shared adapter contract on iOS. Mocked tests cover field
mapping, marker-based create reconciliation and idempotent finalization, native write and
compensation identifiers, full-access enforcement, exact before-state checks, and disabled
certification; they do not constitute native certification.

## iOS certification harness

The certification route is a development-build control plane, not a production feature. Its
policy requires a debug build, physical iOS device, non–Expo Go runtime, full contact access, an
exact destructive-test confirmation phrase, and a backup identifier returned by the verified
backup repository. The home-screen entry point is omitted unless the immutable environment checks
pass, and the route repeats every check so a direct deep link cannot arm it. Opening a locked route
does not request permissions or load backups.

The harness lists separate evidence scenarios for backup/restore, merge, write interruption,
marker-finalization interruption, rollback, permission changes, and photo round-trip. All remain
explicitly pending; the screen cannot mutate contacts and does not change the empty production
registry or the disabled iOS certification record. Native scenario actions will be added one at a
time and restricted to disposable fixture contacts.

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

Photo URIs are not treated as backups. Every contact photo is read as bytes and stored as a
separate AES-256-GCM asset bound to its contact and photo index. The manifest records ciphertext
and plaintext sizes and SHA-256 hashes, the artifact integrity root authenticates both contact
chunks and photo assets, and verification decrypts every photo before commit. Schema-1 manifests
without `photoAssets` retain their legacy aggregate-hash algorithm. Write preflight fails closed
with `photo-backup-incomplete` whenever an accepted change touches a photographed contact whose
verified manifest does not cover every photo.

Native reads assign each photo a stable canonical asset identity which survives merge planning.
The materializer validates the manifest integrity root, decrypts only requested assets into a
unique cache-directory lease, revalidates ciphertext and plaintext hashes, and maps local URIs by
asset identity. A `try/finally` application scope releases the lease after success or failure. A
writer decorator applies that scope only to create and recreate compensation—the operations that
must submit image bytes—keeping encryption and filesystem concerns outside the iOS writer. Cache
lease URIs are never serialized into workflows or backups. Lease directories include a
process-session owner. Startup cleanup removes legacy and previous-session entries while preserving
concurrent leases owned by the current process; first materialization repeats the guard when the
store is used outside normal composition.

The restore reader yields one decrypted chunk at a time. This allows a future live-contact restore
adapter to reconcile large directories without loading a second complete copy into memory. Live
contact writes remain disabled until that adapter and its source-revision safeguards are complete.

Device contacts are requested from Expo Contacts in bounded 500-record pages. Domain snapshots
still represent the complete visible directory, while pagination prevents one unbounded native
bridge response for large 5k–10k contact sources.

## Restore preview

Restore planning decrypts a selected verified backup and compares it with a fresh source snapshot
using native source contact IDs and semantic field values. It classifies backup records as
unchanged, update, recreate, or unavailable. Contacts added after the backup are never deleted.
When iOS grants limited contact access, absent records are classified as unavailable rather than
missing so the app cannot accidentally duplicate contacts it is unable to see. The preview is
read-only; live restore remains gated on complete photo archival, native write mapping, conflict
confirmation, authenticated photo materialization, and post-write verification.

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

## Contact write preflight

Accepted proposals are translated into a platform-neutral dry-run plan before any native writer is
allowed to run. Preflight requires the exact verified backup associated with the analyzed snapshot,
full contact access, and a fresh source read whose targeted contacts still match their reviewed
before-states. Creates and updates are ordered before deletes. Every operation has a reverse-order
compensation step so an executor can select the correct rollback subset after a partial failure.
The current UI exposes this plan and its impact counts but contains no path that executes native
contact writes.

## Duplicate safety bounds

Exact-match pair expansion is capped so a widely shared household or business value cannot produce
unbounded quadratic output. Merge proposals require a common exact normalized identifier across
the proposed group; transitive chains using different identifiers are not merged together. Groups
are capped at ten contacts per proposal and additional records remain available for a later scan.
These safeguards favor repeated, reviewable work over a single high-impact merge.
