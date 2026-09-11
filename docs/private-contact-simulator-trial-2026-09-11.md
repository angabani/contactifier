# Private contact-copy Simulator trial — 2026-09-11

## Privacy boundary

- Source export remained local and was ignored by Git through the repository-wide `*.vcf` rule.
- No contact names, phone numbers, email addresses, or other field values were recorded in this
  report, committed, uploaded, or used for model training.
- The trial ran on the separately created `Contactifier Private Trial` iPhone 17 Simulator.
- The physical iPhone contact store was not accessed by Contactifier and no native write was
  approved or executed.

## Import and baseline

- The source contained 1,395 balanced vCard 3.0 records, matching the iPhone's reported All
  Contacts count.
- The isolated Simulator reported 1,401 contacts: 1,395 imported copies plus six pre-existing
  Simulator sample contacts.

## Real-directory compatibility defect and correction

- Native enumeration reached the large directory but mapping aborted on a legacy yearless contact
  date represented by Expo with a non-integer year sentinel.
- The Expo adapter now normalizes non-integer and zero year sentinels to a yearless date. If a
  native date remains invalid, only that malformed date field is omitted; the contact and all its
  other fields remain available to the scan and backup pipeline.
- Domain validation remains strict after the native-boundary normalization.

## Deterministic read-only result

- Full-access scan and encrypted backup completed for all 1,401 contacts.
- Verified backup totals: 1,401 contacts across 15 chunks, 161 encrypted photo assets, and a
  4,280,961-byte authenticated artifact.
- Deterministic analysis produced 43 review suggestions.
- Zero suggestions were approved, ignored, or applied. No contact write ran.

## Hosted bootstrap model comparison

- The Cloudflare-hosted model was freshly downloaded and activated against the same in-memory
  1,401-contact snapshot.
- The on-device artifact was 110,834 bytes and its SHA-256 was
  `0febb9f5cef449433141ee666b3d378e1c84548f4086d2b992fa86db1d1bb7e8`, matching the hosted
  manifest.
- Model mode evaluated 251 bounded match-matrix candidates and produced 71 review suggestions,
  compared with 43 suggestions from the deterministic first scan.
- No candidate values were logged or exported. Zero suggestions were approved or applied.
- These counts demonstrate that the model path operates at realistic directory scale; they do not
  establish suggestion quality. The synthetic bootstrap model remains blocked from production
  promotion until representative labeled evaluation passes the lifecycle gates.
