# Contactifier model development

The complete training, promotion, delivery, rollback, and physical-device procedure is documented
in [`docs/model-lifecycle-runbook.md`](../docs/model-lifecycle-runbook.md).

This pipeline never reads device contacts. It starts with deterministic synthetic feature vectors
covering positive variations and high-risk negative traps.

```sh
python3 -m venv .venv
.venv/bin/pip install -r modeling/requirements.txt
.venv/bin/python modeling/generate_dataset.py
.venv/bin/python modeling/train_and_evaluate.py
```

Identity groups are assigned deterministically to 70/15/15 train, validation, and test partitions,
preventing the same synthetic identity from crossing splits. Threshold selection prioritizes at
least 99.5% validation precision, and the report records false merges by scenario.

The generated dataset is a pipeline bootstrap, not production evidence. `promotionEligible` remains
false until reviewed contact-domain fixtures, supported-locale coverage, calibration, mobile
conformance, latency, memory, and energy gates are added.
