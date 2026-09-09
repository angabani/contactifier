# Smart matching model lifecycle runbook

## Purpose and safety boundary

This runbook covers the complete path from privacy-safe match examples to an optional on-device
model update. Smart matching ranks duplicate suggestions; it does not synchronize iCloud, Google,
Exchange, or other providers. It never receives permission to modify contacts. All merges still go
through backup, review, explicit approval, verified native writes, History, and Undo.

Never use a person's address book as training data. The checked-in bootstrap generator creates
feature vectors only and reads no device contacts. Any future reviewed dataset must be consented,
de-identified, access-controlled, documented, and approved under the project's privacy policy.

## Components

| Component | Responsibility |
| --- | --- |
| `modeling/generate_dataset.py` | Produces deterministic privacy-safe bootstrap examples. |
| `modeling/train_and_evaluate.py` | Splits identities, trains candidates, calibrates probabilities, evaluates safety, and exports LightGBM. |
| `modeling/requirements.txt` | Pins the isolated offline training toolchain. These packages are not app dependencies. |
| `contactifier-tree-ensemble-v1` | Strict data-only mobile artifact format. |
| Runtime model catalog | Resolves the currently offered model from one stable HTTPS manifest URL. |
| Artifact store | Downloads, checks size and SHA-256, validates structure, and atomically activates a model. |
| Basic matching | Conservative deterministic fallback when consent is declined or no model is usable. |

## 1. Prepare the training environment

From the repository root:

```sh
python3 -m venv .venv
.venv/bin/pip install -r modeling/requirements.txt
```

On Apple silicon, LightGBM also requires OpenMP:

```sh
brew install libomp
```

The `.venv` directory and `modeling/output` are ignored by Git. No Python ML package is shipped in
the iOS or Android application.

## 2. Generate bootstrap data

```sh
.venv/bin/python modeling/generate_dataset.py
```

The default run writes 3,000 rows to `modeling/output/bootstrap-pairs.csv`, using a fixed seed for
reproducibility. Covered positive scenarios include exact phone, country-code variation, email
variation, reordered names, phonetic names, and multiple weak clues. High-risk negatives include
shared households, shared businesses, common names, generic inboxes, conflicting country codes,
and unrelated contacts.

Each example has a unique `identityGroup`. A SHA-256-derived assignment keeps groups separated
across 70% training, 15% validation, and 15% test partitions.

To create a smaller pipeline smoke test:

```sh
.venv/bin/python modeling/generate_dataset.py --per-scenario 20
```

## 3. Train, calibrate, evaluate, and export

```sh
.venv/bin/python modeling/train_and_evaluate.py
```

The pipeline compares:

1. Logistic regression baseline.
2. Shallow LightGBM.
3. Shallow XGBoost.

Every candidate receives sigmoid calibration fitted only on the validation partition. The
recommended threshold is selected for at least 99.5% validation precision, favoring recall only
after the precision requirement is satisfied. The test report includes ROC AUC, average precision,
Brier score, recommended precision and recall, total false merges, and false merges per scenario.

Outputs:

- `modeling/output/evaluation.json`
- `modeling/output/bootstrap-lightgbm-v1.model`

The exporter converts LightGBM nodes into `contactifier-tree-ensemble-v1`, including missing-value
branches and calibration parameters. It then evaluates every held-out row with an independent
implementation and fails if probabilities differ by more than `1e-10`.

## 4. Understand the bootstrap result

The checked-in fixture records the current pipeline baseline:

- 3,000 synthetic rows.
- 467 held-out conformance rows.
- Approximately 108 KB exported artifact.
- Zero probability difference between LightGBM and the exported evaluator.

This proves pipeline and runtime compatibility only. Synthetic examples are deliberately separable,
so perfect bootstrap metrics do not establish real-world quality. The report always sets
`promotionEligible` to `false`; do not publish `bootstrap-lightgbm-v1.model` as a production model.

## 5. Verify mobile conformance

The checked-in golden fixture is evaluated by the actual TypeScript runtime:

```sh
npm test -- --runInBand __tests__/trained-model-conformance-test.ts
```

Before any release, also run:

```sh
npm run check
npx expo export --platform ios --output-dir /private/tmp/contactifier-ios-model-check
```

The runtime rejects unknown formats, malformed nodes, cycles, excessive depth, excessive tree/node
counts, non-finite values, oversized artifacts, size mismatches, and SHA-256 mismatches.

## 6. Production promotion gates

A candidate may be proposed for production only after all gates have recorded evidence:

- Reviewed contact-domain evaluation data independent of the bootstrap generator.
- No identity leakage across train, validation, and test.
- Locale and script coverage for every claimed supported market.
- Explicit family, coworker, switchboard, generic inbox, recycled-number, sparse-record, and
  transitive-merge traps.
- Candidate-generation recall measured separately from classifier recall.
- False-merge ceiling met with confidence intervals, not only a point estimate.
- Probability calibration and reliability plots reviewed.
- Recommended and Careful-review thresholds approved from held-out results.
- Golden mobile conformance passed.
- Physical iPhone latency, memory, thermal, battery, offline, interruption, and low-storage checks.
- Product, privacy, and release owner sign-off recorded against the evaluation report identifier.

The chosen model is the smallest calibrated candidate satisfying the safety ceiling. A higher AUC
does not override a worse false-merge result. Logistic regression remains a valid winner if the
reviewed data does not demonstrate a meaningful and safe GBDT advantage.

## 7. Package and publish

Use an immutable version for every distinct artifact. Compute metadata without opening contact data:

```sh
.venv/bin/python -c "from pathlib import Path; import hashlib; p=Path('candidate.model'); b=p.read_bytes(); print('sizeInBytes=',len(b)); print('sha256=',hashlib.sha256(b).hexdigest())"
```

Publishing order matters:

1. Upload the immutable model artifact to the approved HTTPS host.
2. Download it independently and confirm byte size and SHA-256.
3. Confirm its evaluation-report identifier and compatibility versions.
4. Update the stable manifest atomically only after the artifact is reachable.
5. Test fresh consent, existing-consent upgrade, offline launch, and interrupted download.
6. Roll out gradually if the hosting platform supports staged manifest audiences.

Manifest example:

```json
{
  "active": {
    "version": "contacts-gbdt-2026-09-05",
    "format": "contactifier-tree-ensemble-v1",
    "url": "https://models.example.com/contacts-gbdt-2026-09-05.model",
    "sha256": "replace-with-the-verified-64-character-sha256",
    "sizeInBytes": 110834
  }
}
```

The app is configured once with:

```sh
EXPO_PUBLIC_SMART_MODEL_MANIFEST_URL=https://models.example.com/contactifier/manifest.json
```

Users who previously consented receive a verified replacement automatically. Users who declined
remain on Basic matching and are not repeatedly prompted. A model that becomes ready after a Basic
scan rescores eligible pairs without another contact scan.

## 8. Rollback and incident response

To roll back, atomically point the manifest to the last approved immutable artifact and version. The
app keeps its last-known-good active model until a replacement fully verifies, so network or corrupt
download failures do not remove the working model.

To stop new delivery immediately, serve `{}` as the manifest. Existing installed models remain
usable. If an installed model must be retired for safety, publish a known-safe replacement; a future
signed revocation mechanism is required before remote forced removal should be supported.

For an incident, preserve the manifest revision, artifact digest, evaluation report, affected app
versions, timestamps, and reproduction fixture. Never collect a user's contacts for diagnosis.

## 9. Safe physical-iPhone verification

Use a dedicated test account/device or the app's namespaced certification fixtures. Before testing:

1. Confirm iCloud Contacts backup/sync status independently.
2. Create an encrypted Contactifier restore point.
3. Run read-only scan and model download tests first.
4. Verify airplane-mode fallback uses Basic matching or the installed last-known-good model.
5. Interrupt downloads and background/terminate the app during verification.
6. Apply changes only to `[Contactifier Test]` fixtures.
7. Verify History, Undo, and point-in-time Restore before testing personal data.

Model scoring itself is read-only. Never approve a merge against real contacts merely to test the
model path.

## Release record

For every candidate, record: version, format, Git commit, dataset revision, feature schema, split
seed, dependency lock, metrics, thresholds, artifact size, SHA-256, conformance result, iPhone model
and iOS version, reviewer, approval date, manifest revision, rollout time, and rollback target.
