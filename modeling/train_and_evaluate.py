#!/usr/bin/env python3
"""Train comparable contact matchers and emit a safety-first evaluation report."""

import argparse
import csv
import hashlib
import json
import math
from pathlib import Path

import lightgbm as lgb
import numpy as np
import xgboost as xgb
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, brier_score_loss, precision_recall_curve, roc_auc_score
from sklearn.pipeline import make_pipeline

from generate_dataset import FEATURES


def split_for(group: str) -> str:
    bucket = int(hashlib.sha256(group.encode()).hexdigest()[:8], 16) % 100
    return "train" if bucket < 70 else "validation" if bucket < 85 else "test"


def load(path: Path):
    rows = list(csv.DictReader(path.open(encoding="utf-8")))
    x = np.array([[np.nan if row[name] == "" else float(row[name]) for name in FEATURES] for row in rows])
    y = np.array([int(row["label"]) for row in rows])
    splits = np.array([split_for(row["identityGroup"]) for row in rows])
    scenarios = np.array([row["scenario"] for row in rows])
    return x, y, splits, scenarios


def threshold_for_precision(y, probability, minimum_precision=0.995):
    precision, recall, thresholds = precision_recall_curve(y, probability)
    eligible = [(thresholds[i], recall[i]) for i in range(len(thresholds)) if precision[i] >= minimum_precision]
    return max(eligible, key=lambda item: item[1])[0] if eligible else 1.0


def metrics(y, probability, threshold):
    predicted = probability >= threshold
    false_merges = int(np.sum((predicted == 1) & (y == 0)))
    proposed = int(np.sum(predicted))
    return {
        "rocAuc": float(roc_auc_score(y, probability)),
        "averagePrecision": float(average_precision_score(y, probability)),
        "brier": float(brier_score_loss(y, probability)),
        "recommendedThreshold": float(threshold),
        "recommendedPrecision": float((proposed - false_merges) / proposed) if proposed else 1.0,
        "recommendedRecall": float(np.sum((predicted == 1) & (y == 1)) / np.sum(y == 1)),
        "falseMerges": false_merges,
    }


def export_lightgbm(model, version: str, calibration):
    dumped = model.booster_.dump_model()
    trees = []
    for tree_info in dumped["tree_info"]:
        nodes = []

        def append_node(source):
            index = len(nodes)
            nodes.append(None)
            if "leaf_value" in source:
                nodes[index] = {"value": float(source["leaf_value"])}
                return index
            left = append_node(source["left_child"])
            right = append_node(source["right_child"])
            nodes[index] = {
                "feature": FEATURES[int(source["split_feature"])],
                "threshold": float(source["threshold"]),
                "left": left,
                "right": right,
                "missing": left if source["default_left"] else right,
            }
            return index

        append_node(tree_info["tree_structure"])
        trees.append(nodes)
    return {
        "schemaVersion": 1,
        "version": version,
        # LightGBM dump leaf values already include learning-rate shrinkage and initial score.
        "baseScore": 0.0,
        "learningRate": 1.0,
        "trees": trees,
        "calibration": {"slope": float(calibration.coef_[0, 0]), "intercept": float(calibration.intercept_[0])},
    }


def score_exported(artifact, vector):
    raw = artifact["baseScore"]
    for nodes in artifact["trees"]:
        index = 0
        while "value" not in nodes[index]:
            node = nodes[index]
            value = vector[FEATURES.index(node["feature"])]
            index = node["missing"] if np.isnan(value) else node["left"] if value <= node["threshold"] else node["right"]
        raw += artifact["learningRate"] * nodes[index]["value"]
    calibration = artifact.get("calibration")
    if calibration:
        raw = calibration["slope"] * raw + calibration["intercept"]
    return 1.0 / (1.0 + math.exp(-raw))


def raw_scores(name, model, values):
    if name == "logistic":
        return model.decision_function(values)
    if name == "lightgbm":
        return model.predict(values, raw_score=True)
    return model.predict(values, output_margin=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", type=Path, default=Path("modeling/output/bootstrap-pairs.csv"))
    parser.add_argument("--output", type=Path, default=Path("modeling/output/evaluation.json"))
    args = parser.parse_args()
    x, y, splits, scenarios = load(args.dataset)
    train, validation, test = splits == "train", splits == "validation", splits == "test"
    candidates = {
        "logistic": make_pipeline(SimpleImputer(strategy="constant", fill_value=-1), LogisticRegression(max_iter=1000, class_weight="balanced")),
        "lightgbm": lgb.LGBMClassifier(n_estimators=64, max_depth=5, num_leaves=20, learning_rate=0.05, verbosity=-1, random_state=7),
        "xgboost": xgb.XGBClassifier(n_estimators=64, max_depth=5, learning_rate=0.05, n_jobs=1, random_state=7),
    }
    report = {"dataset": {"rows": len(y), "features": list(FEATURES), "syntheticBootstrapOnly": True}, "models": {}}
    fitted = {}
    for name, model in candidates.items():
        model.fit(x[train], y[train])
        calibration = LogisticRegression().fit(raw_scores(name, model, x[validation]).reshape(-1, 1), y[validation])
        validation_probability = calibration.predict_proba(raw_scores(name, model, x[validation]).reshape(-1, 1))[:, 1]
        threshold = threshold_for_precision(y[validation], validation_probability)
        test_probability = calibration.predict_proba(raw_scores(name, model, x[test]).reshape(-1, 1))[:, 1]
        result = metrics(y[test], test_probability, threshold)
        result["scenarioFalseMerges"] = {
            scenario: int(np.sum((test_probability[scenarios[test] == scenario] >= threshold) & (y[test][scenarios[test] == scenario] == 0)))
            for scenario in sorted(set(scenarios[test]))
        }
        result["calibration"] = {"slope": float(calibration.coef_[0, 0]), "intercept": float(calibration.intercept_[0])}
        report["models"][name] = result
        fitted[name] = (model, calibration)
    # Bootstrap data validates the pipeline but cannot authorize production promotion.
    report["promotionEligible"] = False
    args.output.parent.mkdir(parents=True, exist_ok=True)
    lightgbm_model, lightgbm_calibration = fitted["lightgbm"]
    artifact = export_lightgbm(lightgbm_model, "bootstrap-lightgbm-v1", lightgbm_calibration)
    artifact_path = args.output.parent / "bootstrap-lightgbm-v1.model"
    artifact_path.write_text(json.dumps(artifact, separators=(",", ":")), encoding="utf-8")
    native_probability = lightgbm_calibration.predict_proba(
        raw_scores("lightgbm", lightgbm_model, x[test]).reshape(-1, 1)
    )[:, 1]
    exported_probability = np.array([score_exported(artifact, vector) for vector in x[test]])
    maximum_error = float(np.max(np.abs(native_probability - exported_probability)))
    if maximum_error > 1e-10:
        raise RuntimeError(f"Exported LightGBM evaluator differs by {maximum_error}")
    report["lightgbmExport"] = {
        "path": str(artifact_path),
        "bytes": artifact_path.stat().st_size,
        "maximumProbabilityError": maximum_error,
        "conformanceRows": int(np.sum(test)),
        "goldenVectors": [
            {
                "features": {name: (None if np.isnan(vector[index]) else float(vector[index])) for index, name in enumerate(FEATURES)},
                "probability": float(probability),
            }
            for vector, probability in list(zip(x[test], native_probability))[:12]
        ],
    }
    args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
