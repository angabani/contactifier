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
