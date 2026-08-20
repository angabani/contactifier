# Contactifier

Contactifier is a privacy-first Expo and React Native application for reviewing, backing up, and
beautifying contact directories. Contact-derived data stays on the device. Native contact writes
are intentionally disabled while the write adapter and post-write verification contract are under
development.

## Requirements

- Node.js 22.13.x
- npm
- Xcode for iOS development or Android Studio for Android development

## Development

```bash
npm ci
npm run ios
```

Use `npm start` when an existing development build or Expo Go session is sufficient. Device
contact scanning is available only on iOS and Android.

## Quality checks

```bash
npm run check
```

The same lint, TypeScript, and regression checks run on every GitHub push and pull request.

## Architecture

The application follows feature-first ports and adapters with inward-pointing dependencies:

```text
routes -> features -> application -> domain
                          ^
                          |
                    infrastructure
```

- `src/domain`: immutable contact contracts and pure analysis/planning rules
- `src/application`: use cases and infrastructure-independent ports
- `src/infrastructure`: Expo contact and encrypted-backup adapters
- `src/composition`: production dependency wiring
- `src/features`: screens and interaction state
- `src/app`: Expo Router route entries

Layer boundaries are enforced by ESLint. See `docs/architecture.md` for safety invariants and
backup/write planning details.

## Implemented safety flow

1. Read contacts into an immutable canonical snapshot.
2. Compare with the latest matching verified backup.
3. Create and verify a chunked AES-256-GCM backup.
4. Analyze exact duplicates and conservative quality issues.
5. Require an explicit decision for every proposed change.
6. Re-read targeted contacts and produce a dry-run write plan.
7. Persist encrypted, revision-checked workflow checkpoints and a receipt-backed operation/rollback journal.
8. Resume unfinished reviews only from their exact verified backup after an app restart.
9. Retain only two encrypted revisions per workflow to bound checkpoint storage.
10. Allow confirmed, revision-safe deletion of review progress without deleting its backup.
11. Exercise write-ahead journaling, verification, and rollback through a failure-injectable simulator.
12. Reconcile interrupted writes as applied, not applied, or manual-review-required before rollback.
13. Certify every writer against one shared create/update/delete/reconcile/compensate contract.
14. Require short-lived, workflow-bound capability authorization at the execution boundary.
15. Keep the production native-writer certification registry empty until integration is complete.
16. Reconcile interrupted iOS creates through a unique persisted native marker, never fuzzy matching.
17. Remove create markers through a journaled, idempotent, separately authorized finalization phase.
18. Encrypt and verify photo bytes separately, blocking writes when photo coverage is incomplete.
19. Materialize authenticated photos through scoped private leases for create and rollback recreation.
20. Remove abandoned photo leases at startup without touching current-process writes.
21. Gate the iOS certification checklist to physical-device development builds and real verified backups.

An Expo SDK 57 iOS writer candidate exists for mapping and mocked integration testing only. Its
certification remains disabled, it is not registered in production composition, and the UI cannot
invoke it.

Synthetic demo data is available in the app to exercise merge, update, delete, delta, review, and
dry-run behavior without reading or changing real contacts.
