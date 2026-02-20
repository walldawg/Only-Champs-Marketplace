# Phase 7 Canonical JSON Importer (CLI)

Script: `scripts/phase7_importCanonicalJson.ts`

Purpose:
- Ingest strict Canonical JSON payloads into `CardConcept` + `CardVersion` via upsert.
- Default mode is dry-run (plan only, no DB writes).
- Execute mode requires explicit `--confirm true`.
- Every run writes a report JSON file to `data/import_reports/`.
- This repo uses `DATABASE_URL="file:./prisma/dev.db"` in root `.env`.

## Required input shape

Top-level payload:
- `setCode: string`
- `concepts: CanonicalConcept[]`

Each concept:
- `type: HERO | PLAY | HOTDOG`
- `slug: string`
- `name?: string`
- `meta?: object`
- `versions: CanonicalVersion[]`

Each version:
- `versionCode: string`
- `finish?: NONFOIL | FOIL`
- `attributes?: object`
- `requirements?: object`

## Commands

Dry-run (default):

```bash
DATABASE_URL="file:./prisma/dev.db" npx -y tsx scripts/phase7_importCanonicalJson.ts \
  --input data/samples/canonical_json_sample_v1.json
```

Execute:

```bash
DATABASE_URL="file:./prisma/dev.db" npx -y tsx scripts/phase7_importCanonicalJson.ts \
  --input data/samples/canonical_json_sample_v1.json \
  --execute \
  --confirm true
```

Optional explicit dry-run flag:

```bash
DATABASE_URL="file:./prisma/dev.db" npx -y tsx scripts/phase7_importCanonicalJson.ts \
  --input data/samples/canonical_json_sample_v1.json \
  --dry-run true
```

Show latest report file:

```bash
REPORT="$(ls -1t data/import_reports/*.json | head -n 1)"
echo "$REPORT"
sed -n '1,160p' "$REPORT"
```

## Report output

Each run writes one report file under:
- `data/import_reports/`

Report includes:
- `reportId`, `startedAt`, `finishedAt`, `mode`, `importerKey`
- `inputSummary`
- `counts` (`created`, `updated`, `skipped`)
- `warnings[]`, `errors[]`, `sample[]`
