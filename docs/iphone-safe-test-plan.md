# Safe iPhone test plan

## Non-negotiable rule

Do not approve a merge, update, delete, Undo, or Restore involving an ordinary contact. The current
build intentionally keeps physical-device native mutation certification locked. Use the iPhone for
read-only product and model validation; use the iOS Simulator for destructive transaction testing.

## Before connecting the iPhone

1. Run `npm run check`.
2. Run an iOS export check.
3. Complete the simulator certification scenarios and generate the durable evidence report.
4. Confirm the app is a development build, not Expo Go.
5. Confirm the test phone has a current independent iCloud/device backup.

## Stage 1 — no Contacts permission

1. Install and launch the app.
2. Confirm Home shows only the first scan action.
3. Open Settings and confirm Smart Matching can be viewed without Contacts permission.
4. Start scanning, deny access, and verify no crash, write, or misleading success screen occurs.

Expected result: the app explains how to grant access and changes no contacts.

## Stage 2 — read-only scan and model paths

1. Grant Contacts access.
2. Start the first scan.
3. Test **Use basic matching** first.
4. Verify an encrypted restore point appears in History.
5. Review suggestions but do not approve or apply them.
6. Enable Smart Matching from Settings.
7. Verify the displayed model size, download animation, integrity verification, and on-device status.
8. Return to Review and confirm eligible suggestions are rescored without another manual scan.
9. Enable airplane mode, relaunch, and confirm the installed model or Basic matching remains usable.

Expected result: scanning, backup creation, model installation, and scoring are read-only.

For deterministic simulator automation only, the development build accepts
`contactifier:///?scan=contactifier-read-only-scan-v1`. The token is ignored in production, Expo Go,
Android, and physical-device builds. It invokes the same read-only scan and verified-backup path as
the Home button.

## Stage 3 — interruption and resource checks

Repeat model download while backgrounding and terminating the app. Also test low network quality,
airplane mode, low storage, Dark Mode, Dynamic Type, VoiceOver, and device rotation lock. A failed
replacement must retain the last-known-good model and never block Basic matching.

## Stage 4 — disposable fixture visibility

Only after the simulator report passes, open the developer certification screen and type the exact
confirmation phrase shown there. Fixture names must begin with `[Contactifier Test]` and contain the
unique ownership URL marker. Create a verified backup that contains those fixtures before any later
physical-write certification work.

Fixture cleanup must reread ownership and delete only when both the exact visible fixture name and
unique marker match. Ambiguous records are retained for inspection, never guessed or deleted.

## Stage 5 — physical writes remain gated

Do not enable physical-device mutations merely because read-only testing passes. Enabling them
requires a separately reviewed writer certification, marker-owned plan enforcement, successful
Undo and point-in-time Restore evidence, permission-revocation evidence, interruption recovery,
photo byte comparison, and explicit release approval.

## Evidence to record

- App version and Git commit
- iPhone model, iOS version, free storage, and permission scope
- Basic and Smart Matching results
- Manifest version, model version, artifact size, and SHA-256
- Download interruption outcomes
- Scan and scoring duration
- Memory, thermal, and battery observations
- Restore-point identifier
- Simulator certification report identifier
- Screenshots containing only synthetic fixture information

Never export screenshots, logs, or reports containing personal contact values.
