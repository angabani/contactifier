# Smart model delivery

For the end-to-end operational process and production promotion gates, see
[`model-lifecycle-runbook.md`](./model-lifecycle-runbook.md).

Set `EXPO_PUBLIC_SMART_MODEL_MANIFEST_URL` to a stable HTTPS endpoint. The app resolves this
manifest at runtime after consent, so publishing a new active artifact does not require an app
release.

```json
{
  "active": {
    "version": "contacts-gbdt-2026-09-04",
    "format": "contactifier-tree-ensemble-v1",
    "url": "https://models.example.com/contacts-gbdt-2026-09-04.model",
    "sha256": "64-lowercase-or-uppercase-hex-characters",
    "sizeInBytes": 48231
  }
}
```

Supported formats are `contactifier-tree-ensemble-v1` and `contactifier-linear-v1`. To promote a
model, upload its immutable content-addressed artifact first, verify its digest, and then atomically
replace the manifest. Increment `version` for every artifact change. Returning `{}` disables new
model delivery while installed models remain usable.

For local builds without a manifest, the legacy environment variables remain supported:
`EXPO_PUBLIC_SMART_MODEL_VERSION`, `EXPO_PUBLIC_SMART_MODEL_FORMAT`,
`EXPO_PUBLIC_SMART_MODEL_URL`, `EXPO_PUBLIC_SMART_MODEL_SHA256`, and
`EXPO_PUBLIC_SMART_MODEL_SIZE_BYTES`.

The app downloads to a temporary file, enforces size limits, verifies SHA-256, validates the bounded
data-only model structure, and only then switches active metadata. A failed replacement leaves the
previous model file and activation record intact.

## Hosted bootstrap download test

The Cloudflare Pages test catalog is available at
`https://contactifier.pages.dev/manifest.json`. Set the following in the ignored `.env.local` file
to exercise the real HTTPS consent, download, verification, and activation flow in development:

```dotenv
EXPO_PUBLIC_SMART_MODEL_MANIFEST_URL=https://contactifier.pages.dev/manifest.json
```

The currently published `bootstrap-lightgbm-v1` artifact is trained only on synthetic fixtures. It
validates delivery and runtime compatibility, but its evaluation report has
`promotionEligible: false`; do not configure this catalog in a release build until a model trained
and evaluated on an approved representative dataset passes the promotion gates in the lifecycle
runbook.

## Local simulator delivery before HTTPS hosting

Development iOS Simulator builds look for `Documents/contactifier-model-inbox/local.model` only when
no HTTPS manifest is configured. The app reads the model version and format, calculates its size and
SHA-256 on-device, and then sends it through the same temporary copy, verification, validation, and
atomic activation path as a remote artifact.

The exact deep-link token `contactifier:///?smartModel=contactifier-local-model-v1` grants consent and
starts activation for automated simulator verification. Both the local inbox and token are disabled
in production, Expo Go, Android, and physical-device builds.
