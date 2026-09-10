# iOS Simulator verification — 2026-09-05

## Environment

- Simulator: iPhone 17
- Runtime: iOS 26.5
- App: development build, bundle `com.ag.contactifier`
- Dataset: version 5 certification fixtures
- Personal contacts used: none
- Contact mutations approved during this pass: none

## Observed evidence

- Native debug build succeeded and installed.
- Certification harness initially remained locked without full Contacts permission.
- Simulator-only Contacts permission was granted.
- Seed token created 17 marker-owned `[Contactifier Test]` fixtures.
- Read-only scan processed 23 contacts in the isolated simulator contact store.
- Encrypted backup completed and produced a 23-contact verified restore point.
- Review resolved to 7 actionable changes after overlap deduplication.
- Saved review reopened at `1 of 7` with exact fixture values and required conflict choices.
- History displayed the verified restore point with a Restore preview action.
- The 108 KB bootstrap tree model was delivered through the development-only local inbox.
- Local delivery computed and preserved SHA-256
  `0febb9f5cef449433141ee666b3d378e1c84548f4086d2b992fa86db1d1bb7e8` through activation.
- Settings reported “Finds harder duplicates privately on this device” with Smart matching enabled.
- A product-path regression used the activated model format on an Ada Lovelace/Lovalace typo pair:
  Basic matching produced no review item, while the trained model produced one pending, explainable
  `ml` merge suggestion. It did not approve or execute that suggestion.
- The final automated suite passed: 42 suites and 224 tests.
- Lint, TypeScript, Git whitespace checks, and iOS export passed.

## Defects discovered and corrected

1. A new parity snapshot could hide a saved non-empty review because resume selection required an
   exact snapshot ID. Review now prioritizes persisted non-empty workflows and empty analyses no
   longer create workflows.
2. Home could say “Everything looks good” while also showing Resume. Saved review is now a formal
   higher-priority Home state, and the competing result/scan-again cards are hidden.
3. The completion popup counted overlapping exact, quality, and matrix results, reporting 16 when
   only 7 actionable changes existed. It now counts the deduplicated generated change set.
4. Expo's original destination `File` handle retained pre-copy metadata for a local model, causing
   the size gate to reject a correct copy. Activation now reopens the destination handle before
   enforcing size and SHA-256 checks.

## Not covered in this pass

- No suggestion was approved, so no native mutation, completion, Undo, or Restore transaction ran.
- HTTPS transport was not exercised because no approved model host is configured. The equivalent
  local copy, size check, SHA-256 verification, activation, and model-ready UI path were exercised.
- Physical iPhone testing was not performed.

The remaining Simulator gates are successful mutation plus Undo, lost-write response recovery,
marker-finalization recovery, photo-byte verification, and permission-change evidence.

## Recovery certification continuation — 2026-09-06

- Fixture dataset v6 adds one dual-marked contact containing a repeated normalized phone value,
  providing a deterministic single-operation cleanup transaction.
- The dataset contained 18 ownership-recorded fixtures and six unrelated Simulator contacts.
- A fresh read-only scan processed and backed up all 24 contacts and produced eight suggestions.
- The certification helper accepted one cleanup update, deferred the other seven suggestions, and
  created a one-operation preflight with reverse compensation.
- A forced post-write verification failure was injected for workflow
  `ad094de3-1b4d-45a0-8879-cdae6641dd58`.
- Reverse compensation completed and the native result was verified as rolled back.
- No physical-device contact store was involved.

## Lost native-response continuation — 2026-09-09

- A fresh version 6 fixture rotation, read-only scan, verified backup, and one-operation preflight
  were created in the isolated iPhone 17 Simulator.
- The native update was deliberately applied while its response was discarded for workflow
  `45c45d13-c763-4a52-868d-26e628f8bac6`.
- The durable journal recorded `write-outcome-unknown`; recovery reread the native contact instead
  of retrying the mutation.
- Reconciliation identified that the write had landed, created the correct compensation subset,
  restored the original contact, and finished in `rolled-back` with cause `reconciled-write`.
- The harness displayed: “reconciled the applied native write without retry and completed
  compensation.” No physical-device contact store was involved.

## Still requiring certification

- Successful production-path mutation followed by a separately journaled Undo.
- Lost marker-finalization response using a one-operation create/recreation preflight.
- Photo SHA-256 comparison after recreation/restoration.
- Permission revocation proof. A guarded non-writing Simulator launch path is implemented, but the
  current pass did not record durable evidence.
- Physical-iPhone read-only validation and HTTPS model delivery require their actual target device
  and production hosting configuration.

## Snapshot compatibility hardening — 2026-09-10

- Repeated fixture certification exposed older resumable reviews whose change-set snapshot differed
  from the newest active scan.
- Review now selects a persisted workflow only when it matches the active device snapshot; older
  history remains preserved instead of being used for a new preflight.
- Development-only automatic preparation additionally requires the workflow and hydrated scan to
  have the exact same snapshot ID.
- Preflight failures now display their precise safety rejection instead of collapsing every cause
  into a generic “contact or backup changed” message.
- A Simulator permission-revocation probe was attempted. The authorization harness reported
  `full-access-required`, and no writer ran, but durable permission evidence was not recorded because
  no compatible ownership-verified preflight was available. Simulator Contacts permission was
  restored immediately afterward.

## Completion, finalization, photo, and permission certification — 2026-09-10

- Added a development-only completion suite that is hard-locked to iOS Simulator and contacts with
  Contactifier certification ownership markers.
- The suite deleted the owned `photo-a` fixture in completed workflow
  `c2a86be9-5e4f-407e-aab9-55db23982c5a` and restored it through the separate journaled Undo workflow
  `90244677-9c5d-40a5-b54e-b166030e89b6`.
- Undo recreation removed its reconciliation marker, deliberately lost the native finalization
  response, then resumed finalization idempotently under a fresh authorization and completed.
- The restored native photo bytes matched the authenticated backup asset at SHA-256
  `31ae3a734a4db027da80549a9e3287c03f6e737e30cd14c7f27dee8503fa248a`.
- A separate owned, unexecuted preflight `ae5ab36a-7d9a-4225-824d-6cfdc63298c1` was retained for
  permission certification. Simulator Contacts permission was revoked and the authorization gate
  rejected execution solely with `full-access-required`; revision 1 and zero journal entries were
  unchanged. Durable evidence was saved, and Contacts permission was restored immediately.
- Certification reporting now validates permission and photo evidence against each evidence item's
  own persisted workflow and backup. Independent safety scenarios no longer need to share an
  unrelated selected backup ID.

## Full durable-evidence certification — 2026-09-10

- The final clean-baseline run completed mutation workflow
  `34eb4856-8c37-49a0-a421-9fe550f221fb`, separate Undo workflow
  `8c3d28e6-0323-415e-a323-d55a26e30d3c`, and rich merge workflow
  `d65a9b86-2f53-4858-bc92-d296f4474136`.
- The rich verified backup `f52d8e63-1562-4cfc-9465-ee5071fe78ca` was restored through two
  independently journaled transactions. A safely rolled-back child is retried only from a fresh
  native snapshot; already completed children are never replayed.
- Restore preparation now preserves the current canonical identity when a previously recreated
  native contact is updated from an older backup identity. A regression test covers this case.
- The generated report displayed `CERTIFIED`; all nine scenarios passed from durable workflow,
  permission, backup, native verification, and photo-hash evidence.
- Simulator Contacts permission was left restored. No physical-device contact store was involved.
