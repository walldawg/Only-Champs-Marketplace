/**
 * LFBO Phase 8A — Catalog Completeness Validator (PASS/FAIL)
 *
 * Usage:
 *   BASE_URL="http://127.0.0.1:3000" npx -y tsx scripts/phase8A_validateCatalogCompleteness.ts
 *
 * Optional:
 *   SET_CODE="griffey" BASE_URL="http://127.0.0.1:3000" npx -y tsx scripts/phase8A_validateCatalogCompleteness.ts
 *
 * What it checks (8A only):
 *  - Every concept has >= 1 version (versionCount > 0)
 *  - No version row drifts (version.conceptKey must match parent conceptKey)
 *  - Type integrity (version.conceptType must match parent concept.type)
 *  - Set isolation (concept.setCode must match requested setCode)
 *  - Summary integrity (summary counts are internally consistent with per-concept scan)
 *
 * Exits:
 *  - code 0: PASS
 *  - code 1: FAIL (prints reasons)
 */

type SummarySet = {
  setCode: string;
  conceptCounts: Record<string, number>;
  versionCounts: Record<string, number>;
};

type SummaryResponse = { sets: SummarySet[] };

type SetCardsResponse = {
  setCode: string;
  filter: { type: string | null };
  paging: { limit: number; offset: number; total: number };
  items: Array<{
    conceptKey: string;
    setCode: string;
    type: string;
    slug: string;
    name: string;
    versionCount: number;
    versions?: Array<{
      versionKey: string;
      conceptKey: string;
      conceptType: string;
      versionCode: string;
      finish: string | null;
      attributes: any;
    }>;
  }>;
};

function mustEnv(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (!v || !v.trim()) throw new Error(`Missing required env var: ${name}`);
  return v.trim();
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} for ${url}\n${txt}`);
  }
  return (await res.json()) as T;
}

function pad(n: number, w = 2): string {
  const s = String(n);
  return s.length >= w ? s : "0".repeat(w - s.length) + s;
}

async function main() {
  const baseUrl = mustEnv("BASE_URL", "http://127.0.0.1:3000").replace(/\/+$/, "");
  const onlySetCode = (process.env.SET_CODE ?? "").trim() || null;

  const failures: string[] = [];
  const warnings: string[] = [];

  // 1) Get summary to know which sets exist
  const summaryUrl = onlySetCode
    ? `${baseUrl}/catalog/summary?setCode=${encodeURIComponent(onlySetCode)}`
    : `${baseUrl}/catalog/summary`;

  const summary = await getJson<SummaryResponse>(summaryUrl);

  if (!summary.sets || summary.sets.length === 0) {
    failures.push(
      onlySetCode
        ? `No sets returned for setCode="${onlySetCode}" from /catalog/summary`
        : `No sets returned from /catalog/summary`
    );
  }

  // Helper to validate one set by scanning all concepts (and versions for integrity)
  async function validateSet(setCode: string) {
    const limit = 200;
    let offset = 0;
    let total = Infinity;

    let scannedConcepts = 0;
    let zeroVersionConcepts: string[] = [];

    // aggregate counts by type based on scan
    const scanConceptCounts: Record<string, number> = {};
    const scanVersionCounts: Record<string, number> = {};

    while (offset < total) {
      const url = `${baseUrl}/catalog/sets/${encodeURIComponent(setCode)}/cards?limit=${limit}&offset=${offset}&includeVersions=true`;
      const page = await getJson<SetCardsResponse>(url);

      if (page.setCode !== setCode) {
        failures.push(
          `[${setCode}] Set mismatch: response.setCode="${page.setCode}" expected "${setCode}"`
        );
        // keep going to gather more failures
      }

      total = page.paging.total;
      for (const c of page.items) {
        scannedConcepts += 1;

        // 8A set isolation
        if (c.setCode !== setCode) {
          failures.push(
            `[${setCode}] Set isolation fail: concept ${c.conceptKey} has setCode="${c.setCode}"`
          );
        }

        // count concepts by type
        scanConceptCounts[c.type] = (scanConceptCounts[c.type] ?? 0) + 1;

        // 8A: Every concept has >= 1 version
        if (!Number.isFinite(c.versionCount) || c.versionCount < 1) {
          zeroVersionConcepts.push(c.conceptKey);
        }

        // 8A: version drift checks (only if versions were included)
        const versions = c.versions ?? [];
        for (const v of versions) {
          // conceptKey integrity
          if (v.conceptKey !== c.conceptKey) {
            failures.push(
              `[${setCode}] Version drift: version ${v.versionKey} has conceptKey="${v.conceptKey}" but parent conceptKey="${c.conceptKey}"`
            );
          }
          // type integrity
          if (v.conceptType !== c.type) {
            failures.push(
              `[${setCode}] Type drift: version ${v.versionKey} has conceptType="${v.conceptType}" but parent concept.type="${c.type}" (conceptKey=${c.conceptKey})`
            );
          }
          scanVersionCounts[v.conceptType] = (scanVersionCounts[v.conceptType] ?? 0) + 1;
        }

        // If includeVersions=true but the returned versions list length doesn't match versionCount,
        // that's not automatically a failure (because versionCount is computed separately), but it
        // would be a strong signal something is off in selection/querying.
        if (versions.length !== c.versionCount) {
          warnings.push(
            `[${setCode}] Warning: concept ${c.conceptKey} versionCount=${c.versionCount} but versions.length=${versions.length} (includeVersions=true)`
          );
        }
      }

      offset += limit;
      // Safety: avoid infinite loops if server returns nonsense totals
      if (offset > 1_000_000) {
        failures.push(`[${setCode}] Paging safety stop: offset exceeded 1,000,000`);
        break;
      }
    }

    if (zeroVersionConcepts.length > 0) {
      failures.push(
        `[${setCode}] Concepts with zero versions (${zeroVersionConcepts.length}): ` +
          zeroVersionConcepts.slice(0, 25).join(", ") +
          (zeroVersionConcepts.length > 25 ? " ..." : "")
      );
    }

    // 8A: Compare scan counts to /catalog/summary counts (soft consistency check)
    const summarySet = summary.sets.find((s) => s.setCode === setCode);
    if (!summarySet) {
      failures.push(`[${setCode}] Missing from /catalog/summary results`);
      return;
    }

    // Concept counts should match by type
    for (const [t, n] of Object.entries(summarySet.conceptCounts ?? {})) {
      const scanned = scanConceptCounts[t] ?? 0;
      if (scanned !== n) {
        failures.push(
          `[${setCode}] Summary conceptCounts mismatch for type=${t}: summary=${n}, scanned=${scanned}`
        );
      }
    }
    // Also catch types present in scan but absent in summary
    for (const [t, scanned] of Object.entries(scanConceptCounts)) {
      const inSummary = summarySet.conceptCounts?.[t] ?? 0;
      if (inSummary === 0 && scanned > 0) {
        failures.push(
          `[${setCode}] Summary missing conceptCounts entry for type=${t}: scanned=${scanned}, summary=${inSummary}`
        );
      }
    }

    // Version counts should match by conceptType
    for (const [t, n] of Object.entries(summarySet.versionCounts ?? {})) {
      const scanned = scanVersionCounts[t] ?? 0;
      if (scanned !== n) {
        failures.push(
          `[${setCode}] Summary versionCounts mismatch for conceptType=${t}: summary=${n}, scanned=${scanned}`
        );
      }
    }
    for (const [t, scanned] of Object.entries(scanVersionCounts)) {
      const inSummary = summarySet.versionCounts?.[t] ?? 0;
      if (inSummary === 0 && scanned > 0) {
        failures.push(
          `[${setCode}] Summary missing versionCounts entry for conceptType=${t}: scanned=${scanned}, summary=${inSummary}`
        );
      }
    }

    // Lightweight report line
    const typeKeys = Array.from(new Set([...Object.keys(scanConceptCounts), ...Object.keys(scanVersionCounts)])).sort();
    const conceptByType = typeKeys.map((t) => `${t}:${scanConceptCounts[t] ?? 0}`).join(" ");
    const versionByType = typeKeys.map((t) => `${t}:${scanVersionCounts[t] ?? 0}`).join(" ");

    console.log(
      `SET ${setCode} | concepts=${scannedConcepts} | conceptCounts=[${conceptByType}] | versionCounts=[${versionByType}]`
    );
  }

  // 2) Validate each set
  const setsToValidate = onlySetCode ? [onlySetCode] : summary.sets.map((s) => s.setCode);

  for (let i = 0; i < setsToValidate.length; i++) {
    const setCode = setsToValidate[i];
    console.log(`\n[${pad(i + 1)}/${pad(setsToValidate.length)}] Validating setCode="${setCode}" ...`);
    try {
      await validateSet(setCode);
    } catch (err: any) {
      failures.push(`[${setCode}] Exception: ${err?.message ?? String(err)}`);
    }
  }

  // 3) Print outcome
  console.log("\n=== LFBO Phase 8A — Catalog Completeness ===");
  if (warnings.length) {
    console.log(`Warnings (${warnings.length}):`);
    for (const w of warnings.slice(0, 50)) console.log(`- ${w}`);
    if (warnings.length > 50) console.log(`- ... (${warnings.length - 50} more)`);
  }

  if (failures.length) {
    console.log(`\nFAIL (${failures.length})`);
    for (const f of failures) console.log(`- ${f}`);
    process.exit(1);
  } else {
    console.log("\nPASS");
    process.exit(0);
  }
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
