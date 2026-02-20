# Phase 8 Snapshot Validation

Phase 8 is CLI-only deterministic validation. It does not modify routes, schema, migrations, or engine logic.

## Files

- Script: `scripts/phase8_validateDeterminism.ts`
- Baseline snapshot: `data/snapshots/rookie_baseline_v1.json`

## Usage

Validation mode (default):

```bash
npx -y tsx scripts/phase8_validateDeterminism.ts
```

Regenerate baseline snapshot (explicitly gated):

```bash
npx -y tsx scripts/phase8_validateDeterminism.ts --regenerate --confirm true
```

## Output Contract

The script always prints:

- `snapshotPath=...`
- `matchId=...`
- `exitCode=0|1`

Exit behavior:

- `exitCode=0` when the normalized generated snapshot matches the committed baseline (or regenerate succeeds).
- `exitCode=1` when drift is detected or any validation/regeneration error occurs.

## Notes

- Determinism normalization intentionally replaces volatile timestamps with `"<normalized-iso>"`.
- Snapshot artifacts are stored under `data/snapshots/`.
