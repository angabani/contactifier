#!/usr/bin/env python3
"""Generate privacy-safe bootstrap match vectors. No personal contacts are read."""

import argparse
import csv
import random
from pathlib import Path

FEATURES = (
    "email", "emailLocalPart", "emailDomain", "phone", "phoneSuffix", "phoneCountry",
    "name", "givenName", "familyName", "nameOrder", "phoneticName", "nickname",
    "organization", "address", "sameSource",
)


def clipped(rng: random.Random, center: float, spread: float = 0.08) -> float:
    return max(0.0, min(1.0, rng.gauss(center, spread)))


def row(rng: random.Random, group: str, scenario: str, label: int) -> dict[str, object]:
    values: dict[str, object] = {feature: "" for feature in FEATURES}
    values["identityGroup"] = group
    values["scenario"] = scenario
    values["label"] = label
    values["sameSource"] = rng.choice((0.0, 1.0))

    if label:
        values["name"] = clipped(rng, 0.90)
        values["givenName"] = clipped(rng, 0.91)
        values["familyName"] = clipped(rng, 0.94)
        if scenario == "exact-phone":
            values.update(phone=1.0, phoneSuffix=1.0, phoneCountry=1.0)
        elif scenario == "country-code-variation":
            values.update(phone=0.0, phoneSuffix=1.0, phoneCountry=1.0)
        elif scenario == "email-variation":
            values.update(email=0.0, emailLocalPart=clipped(rng, 0.88), emailDomain=1.0)
        elif scenario == "reordered-name":
            values.update(name=clipped(rng, 0.82), givenName=0.1, familyName=0.1, nameOrder=clipped(rng, 0.95))
        elif scenario == "phonetic-name":
            values.update(name=clipped(rng, 0.65), phoneticName=clipped(rng, 0.96))
        elif scenario == "multi-clue":
            values.update(organization=clipped(rng, 0.82), address=clipped(rng, 0.78), nickname=clipped(rng, 0.8))
    else:
        values["name"] = clipped(rng, 0.20, 0.15)
        values["givenName"] = clipped(rng, 0.18, 0.15)
        values["familyName"] = clipped(rng, 0.20, 0.15)
        if scenario == "shared-household":
            values.update(phoneSuffix=1.0, phoneCountry=1.0, address=clipped(rng, 0.95))
        elif scenario == "shared-business":
            values.update(phone=1.0, phoneSuffix=1.0, phoneCountry=1.0, emailDomain=1.0, organization=1.0)
        elif scenario == "common-name":
            values.update(name=clipped(rng, 0.97), givenName=clipped(rng, 0.98), familyName=clipped(rng, 0.98))
        elif scenario == "generic-inbox":
            values.update(emailLocalPart=1.0, emailDomain=0.0, organization=clipped(rng, 0.25))
        elif scenario == "conflicting-country":
            values.update(phoneSuffix=1.0, phoneCountry=0.0, name=clipped(rng, 0.55))
    return values


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=Path("modeling/output/bootstrap-pairs.csv"))
    parser.add_argument("--per-scenario", type=int, default=250)
    parser.add_argument("--seed", type=int, default=20260905)
    args = parser.parse_args()
    positive = ("exact-phone", "country-code-variation", "email-variation", "reordered-name", "phonetic-name", "multi-clue")
    negative = ("shared-household", "shared-business", "common-name", "generic-inbox", "conflicting-country", "unrelated")
    rng = random.Random(args.seed)
    rows = []
    for label, scenarios in ((1, positive), (0, negative)):
        for scenario in scenarios:
            for index in range(args.per_scenario):
                rows.append(row(rng, f"synthetic-{label}-{scenario}-{index}", scenario, label))
    rng.shuffle(rows)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=("identityGroup", "scenario", "label", *FEATURES))
        writer.writeheader()
        writer.writerows(rows)
    print(f"Wrote {len(rows)} privacy-safe rows to {args.output}")


if __name__ == "__main__":
    main()
