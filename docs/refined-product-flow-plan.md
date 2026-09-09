# Contactifier refined product flow

The smart-model training, evaluation, promotion, delivery, rollback, and device-verification process
is maintained in [`model-lifecycle-runbook.md`](./model-lifecycle-runbook.md).

## Product promise

Contactifier should always tell the user the single most important thing to do next.

The core journey is:

1. Scan once.
2. Review only when approval is needed.
3. Confirm the proposed changes.
4. Wait while Contactifier applies and verifies them.
5. See a clear completion state.

Users should not need to understand backups, manifests, journals, transactions, or synchronization
internals to complete this journey.

## Home behavior

### First launch

Home presents one task: **Scan my contacts**.

- Explain briefly that the scan is read-only and stays on the device.
- Ask for contact permission only after the user starts the scan.
- Offer smart matching once, as part of the scan journey: **Use smart matching** or **Continue
  without it**. Scanning must work either way.
- Create and verify the first encrypted restore point as part of the scan.
- Do not show competing cleanup, history, restore, demo, or settings actions in the primary content.

### Returning launches

Do not ask the user to repeat the full first-run scan. Compare the current contact directory with the
latest verified baseline and analyze only contacts that are new or have changed.

Home presents exactly one primary state, using this priority order:

1. Resolve a restore conflict.
2. Recover an interrupted or ambiguous contact change.
3. Approve a prepared contact change.
4. Review new cleanup suggestions.
5. **Everything looks good.**

Lower-priority items remain available in their appropriate tabs but do not compete with the primary
Home action.

## Navigation

- **Home:** the single highest-priority task or the healthy state.
- **Review:** pending suggestions and saved-for-later decisions.
- **History:** completed changes, per-action undo, verified restore points, and point-in-time restore.
- **Settings:** confirmation preferences, privacy information, storage, and advanced recovery tools.

## Waiting and completion states

Every operation that takes noticeable time must say what Contactifier is doing in plain language:

- Looking for changes
- Creating your safety backup
- Applying approved changes
- Checking every change
- Restoring contacts

Progress animation should be calm, native-feeling, accessible, and respect reduced-motion settings.
When work finishes, show the result first and teach only the next useful action.

Example completion:

> Tada — your contacts are clean.
>
> 3 changes were applied and verified. You can undo them anytime from History.

## Point-in-time restore

History displays verified restore points using human-readable dates. Selecting one starts a safe
restore preview.

- Keep contacts created after the selected restore point.
- Re-read current contacts before proposing restoration.
- Show exact contacts and fields that will be restored or recreated.
- Never overwrite a newer change silently; require conflict resolution.
- Apply restore as a new journaled, verified operation.
- Offer undo after a successful restore when safety checks allow it.

## Integrated implementation tickets

ML is part of the matching product, not a separate future experience. The same pipeline has two
execution modes:

- **Smart matching enabled:** deterministic rules generate candidates and an integrity-checked,
  on-device model scores ambiguous candidates.
- **Smart matching unavailable or declined:** the same pipeline completes with deterministic exact
  and conservative similarity rules only.

The user sees one product in both modes. No core task, safety control, restore feature, or approval
flow depends on downloading a model.

### CF-01 — Establish the native product shell and Home state resolver

Create Home, Review, History, and Settings destinations and resolve the single highest-priority Home
state from durable application state.

Acceptance criteria:

- The app opens on Home and presents one primary action or **Everything looks good**.
- Priority is: restore conflict, interrupted operation, prepared approval, new suggestions, healthy.
- Completing an action reveals the next state without restarting the app.
- Tabs preserve state and expose accessible native labels.
- First launch shows Scan as the only primary task.

### CF-02 — Build model consent, download, integrity, and fallback lifecycle

Add a one-time, non-coercive choice to enable private smart matching without blocking the first scan.

Acceptance criteria:

- The user can choose **Use smart matching** or **Continue without it**.
- The explanation says the model finds spelling variations and multi-clue matches, is downloaded,
  integrity checked, and runs on device. It shows the verified artifact size.
- Declining, cancelling, losing connectivity, low storage, download failure, or incompatible hardware
  immediately selects deterministic mode without degrading the core flow.
- The choice is remembered and can be changed in Settings; declined users are not repeatedly nagged.
- Model status is explicit: unavailable, downloading, verifying, ready, failed, or update available.
- A partial or failed artifact is never activated and can be cleaned up safely.
- Contact-derived values are never used to request, select, or download a model.

### CF-03 — Implement the unified duplicate candidate and scoring engine

Build one versioned analysis contract that produces explainable suggestions with or without the
optional model.

Acceptance criteria:

- Deterministic blocking creates a bounded candidate set for at least 10,000 contacts.
- The match matrix records agreement, disagreement, missingness, source reliability, and strong
  negative evidence for supported fields.
- Exact matches are always evaluated independently of model availability.
- When ready, a calibrated, bounded gradient-boosted tree model scores only ambiguous candidates.
- The data-only runtime supports a linear baseline and bounded tree ensembles without executable
  downloaded code.
- Without the model, conservative rules produce a complete valid result and label its capability
  internally without exposing a degraded-sounding experience to the user.
- Every suggestion includes plain-language positive and negative evidence.
- Neither rules nor model output can create or accept a contact change.

### CF-04 — Deliver the one-time baseline scan end to end

Connect permission, contact reading, verified backup, unified analysis, and first Home outcome.

Acceptance criteria:

- Permission is requested only after the user taps Scan.
- The verified baseline contains the information required for later change detection and recovery.
- Deterministic analysis starts regardless of model choice.
- If the model becomes ready during the operation, ambiguous candidates are scored before results are
  finalized; otherwise deterministic results complete without waiting indefinitely.
- Suggestions route to Review; zero suggestions route to **Everything looks good**.
- Failure states preserve contacts and offer exactly one useful recovery action.

### CF-05 — Deliver incremental contact analysis

On later launches, detect directory changes against the verified baseline and analyze only affected
contacts plus the bounded existing contacts needed for candidate comparison.

Acceptance criteria:

- Returning users are not asked to repeat first-run scanning while a valid baseline exists.
- New, updated, deleted, unavailable, and unchanged contacts remain distinguishable.
- Smart mode and deterministic mode use the same incremental input contract.
- Installing or updating a model can rescore stored privacy-safe feature data or schedule one bounded
  re-analysis; it must not create an endless full-scan loop.
- Missing or corrupt baseline state routes to an explicit recovery scan.
- Full rescan remains an advanced recovery action.

### CF-06 — Simplify review, evidence, conflicts, and final approval

Present one suggestion at a time with outcome-focused language and progressively disclosed evidence.

Acceptance criteria:

- Choices use Merge, Keep separate, Apply update, Ignore, and Decide later.
- Exact source values and the proposed result are available before approval.
- The default explanation uses understandable evidence such as matching phone, similar name, or
  conflicting company—not a raw probability.
- Optional details may show calibrated confidence and whether smart matching contributed.
- Ambiguous or conflicting suggestions require individual review and cannot enter bulk approval.
- Model and deterministic suggestions share identical backup, confirmation, and write safeguards.
- The final confirmation summarizes only accepted impact.

### CF-07 — Complete safe mutation, verification, and recovery orchestration

Connect approved suggestions to independent durable transactions with preflight, write-ahead journal,
native execution, verification, compensation, and user-initiated undo.

Acceptance criteria:

- Every accepted change runs independently and has a verified backup.
- Fresh native state is checked immediately before execution.
- Unknown results are reconciled and never blindly retried.
- A failed change rolls back without reversing unrelated successful changes.
- Completion distinguishes verified, rolled back, interrupted/recoverable, and manual review.
- Suggestion origin or model confidence never weakens a safety gate.

### CF-08 — Create native progress, completion, and education states

Use a shared native-feeling experience for model download, scanning, backup, analysis, application,
verification, undo, and restore.

Acceptance criteria:

- Each state describes the user outcome rather than internal implementation.
- Determinate progress appears only when reliable; otherwise use a calm indeterminate state.
- Model download is visually distinct from contact scanning and can fall back cleanly.
- Motion respects reduced-motion settings and progress is announced accessibly without noise.
- Completion shows the result, one primary next action, and only the education relevant at that point.

### CF-09 — Consolidate History, per-action undo, and point-in-time restore

Present completed operations and verified restore points in one chronological History experience.

Acceptance criteria:

- Entries use human-readable dates and outcomes.
- Eligible operations offer per-action undo.
- Restore points offer **Restore contacts from this date** with exact preview.
- Contacts created later are preserved and newer edits become conflicts rather than silent overwrites.
- Restore is a new journaled, verified, recoverable operation.
- Model installation, removal, and updates do not affect the validity of historical recovery data.

### CF-10 — Build evaluation, calibration, and model release controls

Create the labelled dataset, quality gates, integrity metadata, compatibility policy, controlled
activation, and rollback path for every model version.

Acceptance criteria:

- Dataset covers true duplicates, hard negatives, shared business numbers, families, nicknames,
  transliteration, incomplete records, rich fields, and transitive traps.
- Reports include precision, recall, false-merge rate, calibration, candidate recall, latency, memory,
  energy, model size, and segmented scenario results.
- False merges carry substantially higher cost than missed suggestions.
- Thresholds are selected from held-out evaluation data rather than guessed.
- Fellegi-Sunter, calibrated logistic, shallow LightGBM, and shallow XGBoost candidates are compared
  on identical grouped splits; the smallest model satisfying every safety gate wins.
- Runtime scores pass golden conformance tests against the selected training implementation.
- Each artifact is versioned, integrity checked, compatible, auditable, and independently rollbackable.
- The deterministic baseline has its own regression report and remains release-ready.
- No real contact data enters training fixtures, repositories, telemetry, or remote evaluation.

### CF-11 — Certify simulator and safe physical-device behavior

Certify both matching modes and every mutation/recovery path before enabling personal-contact writes.

Acceptance criteria:

- The same fixture corpus runs in deterministic-only and model-enabled modes.
- Suggestion differences are expected, versioned, and explainable; safety behavior is identical.
- Read-only testing on the owner's iPhone cannot reach mutation code paths.
- Physical writes begin on an isolated device and target only dual-marked owned fixtures.
- Full directory comparison proves non-target contacts remain unchanged.
- A build-time gate and runtime gate independently block uncertified physical writes.

### CF-12 — Complete accessibility, resilience, privacy, and production readiness

Run the final cross-platform quality and release pass over the complete product.

Acceptance criteria:

- Core journeys work with VoiceOver, TalkBack, large text, high contrast, and reduced motion.
- Permission changes, restarts, interruption, low storage, download failures, corrupt artifacts, backup
  failures, and unavailable models have tested safe outcomes.
- Neither model mode sends contact-derived inputs, features, probabilities, or decisions off device.
- Performance is verified across small directories and at least 10,000 contacts.
- Release builds expose no developer fixture, certification, or unsafe writer controls.

## Delivery sequence

1. **Foundation:** CF-01, CF-02, and the contracts from CF-03.
2. **First complete read-only product:** CF-03 and CF-04, working in both matching modes.
3. **Returning-user product:** CF-05 and CF-06.
4. **Safe end-to-end changes:** CF-07 and CF-08.
5. **Recovery:** CF-09.
6. **Evidence and device certification:** CF-10 and CF-11.
7. **Production gate:** CF-12.

Research and labelled-data work in CF-10 begins alongside the foundation so model quality is not a
late dependency. Personal-contact writes remain gated until the transaction and recovery foundation
is certified. No ticket may weaken backup, freshness, approval, journaling, verification, rollback,
privacy, or undo requirements.

## Safe iPhone testing plan

The goal is to validate the app on an iPhone without using the owner's real contacts as mutation
test data. No process can honestly promise that data loss is impossible, so testing advances through
strict safety gates and stops immediately when evidence is incomplete.

### Safety rules

- Treat the personal contact directory as read-only until physical-device certification is complete.
- Never test merge, update, delete, undo, or restore against an existing personal contact.
- Never identify disposable contacts using a visible name alone. Require both a visible test marker
  and an independent durable ownership marker created by Contactifier.
- Before every native write, create and cryptographically verify an encrypted Contactifier backup.
- Keep the encrypted artifact and its device-only key separate.
- Re-read every target immediately before writing and stop if its state changed.
- Verify every native result and prepare compensation before reporting success.
- Never broaden a fixture operation to nearby contacts, a whole group, or the whole address book.

### Stage 1 — Automated and simulator certification

Run the full automated suite and all iOS Simulator certification scenarios first.

Required evidence:

- Read, snapshot, backup, restore preview, merge, update, delete, verification, rollback, undo, and
  interruption recovery pass.
- Rich fields, multiple values, groups, dates, addresses, URLs, and photos survive their expected
  round trips.
- Permission changes and app termination at each write phase stop safely.
- The certification report is generated independently from the writer being certified.

Any failure keeps physical-device mutation disabled.

### Stage 2 — Primary iPhone read-only trial

Install a development build on the owner's iPhone with all native writers still disabled.

Test only:

- Permission request and denial flows.
- First baseline scan.
- Encrypted backup creation and verification.
- Incremental detection of new and updated contacts.
- Suggestion review and exact preview.
- App relaunch, backgrounding, large text, VoiceOver, reduced motion, and low-storage messaging.

Acceptance criteria:

- The system contact directory is byte-for-byte logically unchanged after every test session.
- Contact-derived data does not enter application logs, analytics, crash metadata, or network calls.
- The app clearly labels all proposed changes as previews and cannot execute them.

### Stage 3 — Isolated physical-device fixture trial

Prefer a spare iPhone signed into a dedicated test account with no personal contacts. This is the
only recommended environment for the first physical-device write tests.

Contactifier creates a small fixture set containing obvious test names plus independent ownership
markers. The app may mutate only records that pass both ownership checks after a fresh native read.

Run, one scenario at a time:

1. Create one fixture and verify it.
2. Update one fixture and undo it.
3. Merge two fixtures and undo the merge.
4. Delete one fixture and restore it.
5. Restore fixture contacts from a verified point in time.
6. Interrupt each operation before write, after write, and before verification; reconcile safely.
7. Change contact permission during a workflow and confirm the operation stops safely.

After every scenario, compare the entire directory with its pre-test snapshot. Non-fixture contacts
must remain unchanged.

### Stage 4 — Limited fixture trial on the owner's iPhone

Enter this stage only after Stage 3 passes repeatedly and the certification evidence is reviewed.
Use newly created, unmistakable Contactifier test fixtures; do not repurpose personal contacts.

Additional gates:

- The user reviews the exact record identifiers and values before every operation.
- The execution plan refuses every record not proven to be an owned fixture.
- Only one fixture transaction runs at a time.
- Undo is tested immediately after each successful operation.
- Point-in-time restore remains limited to owned fixtures during certification.
- A complete post-test scan proves that personal contacts are unchanged.

### Stage 5 — Production enablement

Real-contact writes remain disabled until all simulator and physical-device evidence is complete,
reviewed, reproducible, and included in a release decision.

Production testing begins with one low-risk, user-selected update. Merge, deletion, bulk approval,
and full-directory restore unlock separately only after their own certification gates pass.

### Immediate stop conditions

Stop testing and disable native writes if any of the following occurs:

- The verified backup cannot be loaded or decrypted.
- Contact permission becomes limited, revoked, or changes unexpectedly.
- A target no longer matches its reviewed before-state.
- Fixture ownership cannot be proven by both markers.
- A write result is ambiguous and cannot be reconciled by a fresh read.
- Verification or compensation fails.
- Any non-target or non-fixture contact changes.
- Available storage is insufficient for a new verified backup and retained recovery data.

## Smart duplicate detection

Smart matching is an integral optional capability inside the unified analysis pipeline. If the user
allows the download and integrity and compatibility checks pass, a compact calibrated boosted-tree
ensemble scores ambiguous candidates on device. If the user declines or the model is unavailable,
the same product continues with deterministic matching. Smart matching improves which suggestions
reach Review; it never changes contacts directly. The detailed decision is recorded in
`docs/smart-matching-model-recommendation.md`.

### Matching pipeline

1. **Normalize safely:** standardize phones, emails, names, organizations, addresses, and other
   supported fields without discarding their original values.
2. **Generate candidates:** use deterministic blocking to compare only plausible pairs, such as
   shared phone suffixes, email components, phonetic name keys, organization, or address locality.
3. **Build a match matrix:** calculate field-level agreement, disagreement, missingness, and source
   reliability for every candidate pair.
4. **Score ambiguous pairs:** use an on-device model to estimate the probability that two records
   represent the same person.
5. **Apply calibrated bands:** route high-confidence candidates to normal Review, uncertain
   candidates to careful comparison, and low-confidence candidates out of the user workflow.
6. **Explain the result:** show the strongest understandable evidence and conflicts, not a probability
   alone.
7. **Require approval:** every merge follows the same preview, backup, confirmation, write,
   verification, and undo path as a deterministic suggestion.

### Proposed match matrix

The model input should distinguish exact, fuzzy, conflicting, and missing values. Initial features
include:

- Exact normalized phone and email matches.
- Phone suffix agreement with country-code compatibility.
- Email username and domain similarity.
- Given, middle, and family-name similarity, including ordering and phonetic similarity.
- Nickname or known-name equivalence from a versioned local dictionary.
- Organization and job-title similarity.
- Postal-address and locality similarity.
- Shared URL or social identifier evidence.
- Contact-source and field-label compatibility.
- Strong negative evidence such as conflicting names paired with a shared business number.
- Missing-field indicators so absence is not treated as disagreement.

Every feature definition, normalization rule, model version, and threshold must be versioned and
covered by regression fixtures.

### Probability and review policy

Threshold values must be selected from labelled evaluation data rather than guessed. The initial
product bands are conceptual:

- **Recommended match:** calibrated evidence is strong enough to show a normal merge suggestion.
- **Needs careful review:** evidence is mixed; highlight conflicts and require individual review.
- **Not suggested:** evidence is too weak; do not consume the user's attention.

The UI may say **Strong match**, **Possible match**, or **Conflicting details**. Raw probability can
appear inside optional details for diagnostics, but it should not be the main user-facing reason.

### Model safety and privacy

- Candidate generation and inference run on the device.
- Contact-derived model inputs never leave the device.
- The model evaluates a bounded candidate set; it never performs unrestricted all-pairs comparison.
- Model output cannot bypass backup, freshness, conflict, authorization, journal, verification, or
  capability gates.
- Exact deterministic rules remain available as a fallback when no compatible model is installed.
- Runtime model packages are versioned and integrity checked before activation.
- A model release is disabled automatically if it fails compatibility or labelled regression gates.

The integrated delivery and acceptance criteria for this capability are defined primarily by CF-02,
CF-03, CF-04, CF-05, CF-06, CF-10, and CF-11. This avoids a separate ML product path and guarantees
that both model-enabled and deterministic-only users receive a complete, safe experience.
