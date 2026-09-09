# Smart matching model recommendation

Implementation and release operations are documented in
[`model-lifecycle-runbook.md`](./model-lifecycle-runbook.md).

## Decision

Use a **small calibrated gradient-boosted decision tree ensemble** over Contactifier's versioned
match matrix. Train LightGBM and XGBoost candidates offline, calibrate their output on held-out
contact-pair data, and promote the smallest model that satisfies the false-merge safety ceiling.
Export the winner to a strict, data-only Contactifier tree format for runtime download and on-device
inference.

Keep the existing linear probability model as a development baseline and emergency compatibility
fallback. Do not use a BERT/transformer matcher in the first production version.

This recommendation must still win against the baselines on the labelled evaluation dataset. The
algorithm should not be selected by intuition alone.

## Why boosted trees fit this use case

Contact matching is structured record linkage. The evidence is a small, sparse matrix: phone and
email agreement, name similarity, nickname compatibility, organization, address, missingness,
source reliability, and strong conflicts.

A boosted tree can learn nonlinear interactions directly:

- Exact personal email plus a similar name can be strong evidence.
- A shared office phone without compatible names should remain weak evidence.
- A phone suffix match matters only when country codes are compatible.
- Missing organization data is not disagreement.
- A strong identity conflict can outweigh several weak similarities.

The Fellegi-Sunter record-linkage framework also supports match, non-match, and possible-match
outcomes. This maps naturally to Contactifier's Recommended, Careful review, and Not suggested
bands.

## Model-family comparison

### Calibrated logistic regression

- Extremely small, auditable, and already supported by the current runtime format.
- Useful as a baseline and emergency fallback.
- Additive unless interactions are manually engineered, so it can miss important evidence
  combinations.

### Gradient-boosted trees — recommended

- Well suited to small tabular feature matrices.
- Learn thresholds, interactions, conflicts, and missing-value behavior.
- Fast CPU inference with a small downloadable artifact.
- Feature contributions can be translated into understandable evidence.
- A strict tree format avoids downloaded executable code and a large neural runtime.

Raw scores must be calibrated. The exporter and device evaluator must pass golden conformance tests
against the training implementation.

### Transformer entity matcher such as Ditto

- Published work shows strong results for text-rich entity-matching benchmarks.
- It has a much larger download, tokenizer, memory, startup, and inference footprint.
- Phone contacts contain short structured values rather than product descriptions or documents.
- It is harder to explain and certify for an extremely low false-merge rate.
- Benchmark success does not establish safety on private, multilingual contact data.

Do not ship a transformer in version one. Reconsider it only if boosted trees miss a measured,
valuable class of matches and a compact quantized student proves a material contact-specific gain.

## Runtime package

The downloaded package contains data only:

- Schema, model, and required match-matrix versions.
- Ordered feature names.
- Bounded decision-tree nodes and leaves.
- Calibration parameters and evaluated policy thresholds.
- Evaluation-report identifier and minimum compatible app version.
- Declared byte size and SHA-256 supplied by trusted configuration.

The app downloads to a temporary file after consent, checks size and SHA-256, validates every tree
limit and numeric field, and activates atomically. The previous working model remains available until
activation succeeds. Any failure immediately returns to deterministic matching.

ONNX Runtime Mobile is a valid future option if a neural model becomes justified. It supports iOS,
Android, React Native, and device accelerators, but its runtime footprint is unnecessary for this
small tree ensemble.

## Matching with and without the model

### Smart matching enabled

1. Deterministic normalization and blocking generate bounded candidate pairs.
2. Exact evidence remains in the match matrix.
3. The downloaded tree ensemble scores ambiguous candidates offline.
4. Calibration produces an evaluated probability estimate.
5. Policy assigns Recommended, Careful review, or Not suggested.
6. Review shows strong evidence and conflicts—not merely a percentage.
7. The user explicitly approves every merge.

### Smart matching declined or unavailable

1. The same normalization and bounded blocking run.
2. Exact phone/email matches and conservative deterministic similarity rules produce suggestions.
3. Uncertain pairs are omitted rather than guessed.
4. Review, backup, approval, application, verification, History, Undo, and Restore remain identical.

Describe this as **Basic matching**, not broken or unsafe matching.

## Consent experience

Ask once after the user starts the first scan and before any network download:

> Find more likely duplicates
>
> Catches typos, similar names, and matches that need several clues. The model runs only on this
> device. Your contacts are never uploaded.

Primary action: **Download smart matching**
Secondary action: **Use basic matching**

Show the actual download size from verified artifact metadata. Basic scanning begins either way. If
accepted, download and deterministic analysis may run concurrently. If the model verifies in time,
use it immediately; otherwise finish promptly with basic results and rescore eligible candidates
when the model becomes ready. Do not show a second completion popup—new smart suggestions become the
highest-priority Home action.

Remember a decline and do not ask repeatedly. Settings offers **Enable smart matching** later.

## Honest benefits

- Find duplicates with spelling variations or reordered names.
- Combine weak clues that basic rules cannot safely use alone.
- Better separate shared household or business details from true duplicates.
- Rank the most likely duplicates first.
- Reduce missed duplicates while keeping every merge under user control.

Do not say the model “syncs contacts better.” Contactifier does not control iCloud, Google, Exchange,
or provider synchronization. Say **Find more likely duplicates** or **Improve smart cleanup
suggestions**.

## Training and evaluation

Build versioned synthetic and hand-authored pairs covering exact matches, typos, initials, reordered
names, nicknames, transliteration, diacritics, country-code variation, email aliases, families,
coworkers, shared switchboards, generic inboxes, sparse records, missing fields, conflicts,
transitive traps, and supported locales. Do not train on personal device contacts.

Compare on identical identity-grouped train/validation/test splits:

1. Fellegi-Sunter-style probabilistic baseline.
2. Calibrated logistic regression.
3. Shallow LightGBM ensemble.
4. Shallow XGBoost ensemble.

Promotion requires acceptable false-merge rate, precision/recall by scenario and locale,
calibration, candidate recall, unseen-identity performance, latency, memory, energy, artifact size,
and stability under missing or commonly shared fields. False merges carry substantially more cost
than missed suggestions. Numeric thresholds remain unset until held-out evaluation.

## Required engineering changes

1. Extend the data-only parser from linear models to bounded tree ensembles.
2. Expand the matrix with phone country/suffix compatibility, email components, structured name
   parts, phonetic/transliteration signals, source reliability, and missing indicators.
3. Add offline training, calibration, export, and evaluation scripts.
4. Add golden tests comparing exported runtime scores with LightGBM/XGBoost scores.
5. Show benefit copy and verified artifact size in the consent sheet.
6. Run deterministic analysis and download concurrently.
7. Rescore eligible candidates after a newly verified model becomes ready.
8. Certify both matching modes on simulator and physical-device fixtures.
