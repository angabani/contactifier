# Contactifier product requirements

This document is the product and engineering requirements baseline for Contactifier. Requirements
are implemented incrementally; inclusion here does not imply that a requirement is complete.

## Product principles

1. Contactifier is read-only by default.
2. Contact-derived data stays on the device and must not enter logs, analytics, or backend requests.
3. No native mutation occurs without a verified encrypted backup, fresh preflight, explicit user
   authorization, durable journal, and post-write verification.
4. Rules and ML may propose changes but must never apply them directly.
5. The user sees the exact source values, intended result, and impact before authorization.
6. Safety claims must be precise and auditable. The product promises guarded, verified, recoverable
   changes rather than claiming that data loss is impossible.

## Contact directory and analysis

- Support contact directories from a few records through at least 10,000 records without unbounded
  native bridge reads or quadratic comparisons.
- Track contacts added, updated, or deleted since the latest matching verified backup.
- Analyze every newly added or changed contact in a subsequent beautification scan.
- Detect exact duplicate phones and emails with conservative normalization.
- Prevent transitive merge chains unless every proposed member shares the required evidence.
- Detect incomplete and empty contacts without automatically deleting them.
- Preserve rich native fields, including names, phones, emails, addresses, organizations, dates,
  URLs, groups, and photos, subject to platform capabilities.
- Display the actual phone numbers and email addresses involved in every suggestion and result.

## Per-change transaction model

- Treat each accepted merge, update, or deletion as an independently identifiable transaction.
- Persist review decisions as `pending`, `accepted`, `rejected`, or `later`. Rejected and later
  decisions do not mutate contacts and therefore require no rollback.
- Execute accepted changes independently so one failure does not roll back unrelated successful
  transactions.
- Because native contact stores do not provide a multi-record database transaction, implement each
  mutation transaction as a durable saga with write-ahead operations and compensations.
- Record a transaction identifier, timestamps, verified backup identifier, exact before-state,
  intended after-state, source identifiers, journal entries, receipts, verification result,
  compensation plan, undo state, and dependencies on later transactions.
- Detect stale contacts again immediately before execution.
- Reconcile an interrupted native write as applied, not applied, or ambiguous. Never blindly retry
  an unknown outcome.
- Verify the native result before reporting completion.
- Roll back confirmed writes in reverse order when execution or verification fails.
- Show clear terminal states: completed, rolled back, interrupted/recoverable, or manual review
  required.

## User-initiated undo

- Offer **Undo** for each successfully completed transaction from the completion screen and activity
  history.
- Implement undo as a new journaled and verified transaction, not an unguarded replay of old calls.
- Preview exactly which contacts and fields will be restored before authorization.
- Re-read affected contacts and confirm they still match the completed transaction's verified
  after-state.
- Refuse to overwrite newer user, sync-provider, or third-party changes; present a conflict preview
  instead.
- Restore an updated survivor and recreate contacts removed by a merge or deletion.
- Verify restored values against the encrypted backup.
- Track transaction dependencies. If a later transaction touched the same contact, require reverse
  dependency order or explicit conflict resolution.
- Preserve unrelated contacts added after the original backup.

## Confirmation preferences

- Default to confirming every native merge, update, deletion, and undo.
- Support `confirm every time`, `remember for this cleanup session`, and an explicit saved preference
  for a change type.
- Allow a confirmation sheet checkbox such as **Don't ask again for merges**.
- Manage persistent confirmation choices in Settings and allow users to reset them.
- Keep deletion confirmation enabled by default and require an explicit Settings change to disable
  it.
- A confirmation must show operation counts, destructive impact, verified-backup availability, and
  the exact native result preview.
- Confirmation preferences never bypass backup, ownership, freshness, journaling, verification, or
  capability gates.

## Native-style contact preview

- Present the intended result using platform-native information architecture.
- On iOS, use Contacts-style avatar/initials, large name, organization summary, action affordances,
  grouped fields, native labels, spacing, separators, typography, and sheet behavior.
- On Android, use the same content model with Material presentation rather than imitating iOS.
- Provide **Sources**, **Merged preview**, and **Changes** modes.
- Show every source contact individually and the exact resulting contact.
- Mark fields as kept, added from another contact, duplicate collapsed, conflicting, or excluded.
- Let the user select which conflicting names and values survive.
- Update the preview immediately as field selections or decorations change.
- Show completion actions including **View contact** and **Undo**.
- The preview is derived from the same immutable transaction payload used by preflight; it must not
  be a separately calculated approximation.

## Per-transaction contact decoration

- Allow an optional decoration for each merge, update, or create-result transaction.
- Support no decoration, honorific, company, designation, group, and custom visible-name tag.
- Store honorifics such as Dr., Mr., Ms., and Prof. in the native structured-name prefix field.
- Store company names in the native company field.
- Store designations in the native job-title field.
- Store group choices as native group membership when the platform adapter supports it.
- Treat a custom visible-name tag as an explicit name transformation, not as an honorific.
- Allow applying a decoration to one transaction, all selected transactions, or a saved future
  default.
- Show a conflict instead of silently replacing an existing prefix, company, designation, or group.
- Warn that custom name tags may affect sorting, search, caller identification, and sync behavior.
- Record original structured fields so undo restores them exactly.
- Apply decorations after merge conflict resolution and before rendering the final confirmation
  preview.

## Backup, privacy, and recovery

- Create and cryptographically verify an encrypted backup before enabling any mutation.
- Keep encryption keys device-only and separate from encrypted contact artifacts.
- Archive and verify photo bytes rather than relying on expiring source URIs.
- Stream large backup and restore datasets in bounded chunks.
- Provide stable restore previews; repeated previews against unchanged inputs must not change.
- Never delete contacts added after the selected backup as part of restore.
- Stop safely when permission is limited, revoked, or changed during a workflow.
- Provide an understandable local activity history without storing contact data in telemetry.

## ML requirements

- Introduce ML only after deterministic native merge, verification, undo, and restore paths are
  certified.
- Use deterministic blocking to generate a small candidate set; never run unrestricted pairwise ML
  comparison across the entire directory.
- Use ML only for ambiguous similarity scoring and field recommendations.
- Display confidence and human-understandable evidence; ML never directly writes contacts.
- Require the same user review and transaction safety gates for ML-originated suggestions.
- Support versioned, integrity-checked runtime model downloads selected for the operating system.
- Prefer Core ML on iOS and LiteRT/TensorFlow Lite on Android behind an application-layer inference
  port, with an optional compatible fallback.
- Run inference offline after download and never upload contact-derived inputs.
- Evaluate every model version against a labelled regression dataset before enabling it.
- Retain a deterministic rules baseline and safe fallback when no compatible model is available.

## Platform certification and trust

- Maintain a disposable iOS Simulator certification dataset covering positive duplicates, negative
  controls, conflicting identities, transitive traps, incomplete contacts, and rich multi-value
  records.
- Mark every fixture visibly and with an independent durable ownership marker.
- Delete fixtures only when both markers prove ownership after a fresh native reread.
- Permit simulator native execution only for fully owned fixture plans.
- Keep production and physical-device writers disabled until all certification evidence is complete.
- Certify create, update, merge, delete, interruption recovery, reconciliation, rollback, user undo,
  permission changes, backup restore, rich-field mapping, and photo round trips.
- Generate an auditable certification result rather than allowing a harness to certify itself.
- Expose customer-facing trust explanations: read-only scanning, on-device processing, verified
  backup, exact preview, explicit approval, post-write verification, and recoverability.

## Delivery sequence

1. Simulator-owned native transaction execution and verification.
2. Independent per-change transactions and durable activity history.
3. User-initiated undo with stale-state and dependency handling.
4. Confirmation policy and Settings controls.
5. Native-style source/result/change preview and conflict selection.
6. Per-transaction decoration and native field mapping.
7. Automated simulator certification report and restore trials.
8. Physical-device certification with disposable contacts.
9. Deterministic candidate expansion and labelled evaluation dataset.
10. Runtime-delivered on-device ML scoring.

