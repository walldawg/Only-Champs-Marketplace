/**
 * BoltOnConformanceRunnerV1 — In-process conformance runner for a BoltOnKitV1.
 *
 * Phase 14 Step 2:
 * - Loads an engine adapter module dynamically (no child_process)
 * - Executes a minimal conformance suite against EngineAdapterV1 behaviors
 * - Produces BoltOnConformanceResultV1 (PASS/FAIL/ERROR) with details
 *
 * Scope notes:
 * - EngineConformanceKitV1 is a type-only suite spec. This runner provides a minimal runnable subset.
 * - This is intentionally "proof-level": deterministic checks + basic adapter callability.
 */

import type { JSONObject, IdString } from "./MatchArtifactV1";
import type { BoltOnKitV1, BoltOnConformanceResultV1 } from "./BoltOnKitV1";

type AnyObj = Record<string, any>;

function nowIso(): string {
  return new Date().toISOString();
}

function ok(msg: string) {
  return { ok: true as const, message: msg };
}
function fail(msg: string, extra?: JSONObject) {
  return { ok: false as const, message: msg, extra };
}

function safeString(x: any): string {
  try {
    return String(x);
  } catch {
    return "[unstringifiable]";
  }
}

function isFunction(x: any): x is Function {
  return typeof x === "function";
}

function asPath(baseDir: string | undefined, relOrAbs: string): string {
  if (!baseDir) return relOrAbs;
  // If relOrAbs already looks absolute (unix or windows), don't join.
  if (relOrAbs.startsWith("/") || /^[A-Za-z]:\\/.test(relOrAbs)) return relOrAbs;
  return baseDir.replace(/\/$/, "") + "/" + relOrAbs.replace(/^\.\//, "");
}

/**
 * Load a named export (or default) from a module.
 * Works with both ESM and CJS via tsx.
 */
async function loadExport(modulePath: string, exportName: string): Promise<any> {
  const mod: AnyObj = await import(modulePath);
  if (mod && exportName in mod) return mod[exportName];
  if (mod && mod.default && exportName in mod.default) return mod.default[exportName];
  if (exportName === "default" && mod?.default) return mod.default;
  return undefined;
}

export interface RunBoltOnConformanceOptionsV1 {
  /** Optional base directory for resolving kit export module paths. Defaults to process.cwd(). */
  baseDir?: string;

  /** If true, keep going after test failures and report them all. Default true. */
  continueOnFail?: boolean;

  /** If provided, overrides the deterministic seed used in tests. */
  seed?: string;
}

export interface BoltOnConformanceDetailsV1 {
  kitId: IdString;
  adapterModule: string;
  adapterExport: string;
  tests: Array<{ name: string; ok: boolean; message: string; extra?: JSONObject }>;
}

async function runMinimalSuite(adapter: any, opts: RunBoltOnConformanceOptionsV1): Promise<BoltOnConformanceDetailsV1["tests"]> {
  const tests: BoltOnConformanceDetailsV1["tests"] = [];
  const continueOnFail = opts.continueOnFail !== false;

  // --- Test vector (minimal) ---
  const universeCode = "UNIV_TEST";
  const engineCode = "MOCK_ENGINE"; // conformance doesn't validate these strings; it validates call shape.
  const engineVersion = "0.0.1";
  const modeCode = "ROOKIE";
  const matchId = "M_CONFORMANCE_001";
  const seed = opts.seed ?? "seed-conformance-1";

  const participants = [
    { participantId: "P1" as IdString, extra: { name: "Player One" } as JSONObject },
    { participantId: "P2" as IdString, extra: { name: "Player Two" } as JSONObject },
  ];

  const inputs: JSONObject = {
    participants: participants.map((p) => ({ participantId: p.participantId })),
    conformance: { kind: "phase14" },
  };

  // Helper to record a test
  const record = (name: string, r: { ok: boolean; message: string; extra?: JSONObject }) => {
    tests.push({ name, ok: r.ok, message: r.message, extra: r.extra });
    return r.ok;
  };

  // 1) validateDeck exists and returns {ok:boolean}
  try {
    if (!adapter || !isFunction(adapter.validateDeck)) {
      const stop = record("validateDeck exists", fail("Adapter missing validateDeck()"));
      if (!stop && !continueOnFail) return tests;
    } else {
      const res = await adapter.validateDeck({
        universeCode,
        engineCode,
        engineVersion,
        modeCode,
        deckId: "DECK_CONFORMANCE_001",
        cardVersionKeys: ["CARD_A", "CARD_B"],
        constraints: { conformance: true } as JSONObject,
      });
      const pass = res && typeof res.ok === "boolean";
      const stop = record(
        "validateDeck returns ok:boolean",
        pass ? ok("validateDeck returned an ok:boolean") : fail("validateDeck did not return {ok:boolean}", res as any)
      );
      if (!stop && !continueOnFail) return tests;
    }
  } catch (e: any) {
    const stop = record("validateDeck call", fail("validateDeck threw", { message: safeString(e?.message ?? e) } as JSONObject));
    if (!stop && !continueOnFail) return tests;
  }

  // 2) createMatch/runMatch/produceArtifact pipeline
  let createdState: any = undefined;
  let outputs: any = undefined;

  try {
    if (!adapter || !isFunction(adapter.createMatch)) {
      const stop = record("createMatch exists", fail("Adapter missing createMatch()"));
      if (!stop && !continueOnFail) return tests;
    } else {
      const res = await adapter.createMatch({
        universeCode,
        engineCode,
        engineVersion,
        modeCode,
        matchId,
        participants,
        seed,
        inputs,
      });
      const pass = res && res.ok === true && res.state;
      createdState = res?.state;
      const stop = record("createMatch produces state", pass ? ok("createMatch ok with state") : fail("createMatch did not return ok+state", res as any));
      if (!stop && !continueOnFail) return tests;
    }
  } catch (e: any) {
    const stop = record("createMatch call", fail("createMatch threw", { message: safeString(e?.message ?? e) } as JSONObject));
    if (!stop && !continueOnFail) return tests;
  }

  try {
    if (!adapter || !isFunction(adapter.runMatch)) {
      const stop = record("runMatch exists", fail("Adapter missing runMatch()"));
      if (!stop && !continueOnFail) return tests;
    } else {
      const res = await adapter.runMatch({
        universeCode,
        engineCode,
        engineVersion,
        modeCode,
        matchId,
        seed,
        state: createdState,
        inputs,
      });
      const pass = res && res.ok === true && res.outputs;
      outputs = res?.outputs;
      const stop = record("runMatch produces outputs", pass ? ok("runMatch ok with outputs") : fail("runMatch did not return ok+outputs", res as any));
      if (!stop && !continueOnFail) return tests;
    }
  } catch (e: any) {
    const stop = record("runMatch call", fail("runMatch threw", { message: safeString(e?.message ?? e) } as JSONObject));
    if (!stop && !continueOnFail) return tests;
  }

  // 3) produceArtifact exists and returns deterministicHash + inputsDigest
  let artifact1: any = undefined;
  let artifact2: any = undefined;

  try {
    if (!adapter || !isFunction(adapter.produceArtifact)) {
      const stop = record("produceArtifact exists", fail("Adapter missing produceArtifact()"));
      if (!stop && !continueOnFail) return tests;
    } else {
      artifact1 = await adapter.produceArtifact({
        universeCode,
        engineCode,
        engineVersion,
        modeCode,
        matchId,
        seed,
        participants,
        inputs,
        outputs,
      });

      const pass =
        artifact1 &&
        artifact1.header &&
        artifact1.deterministicHash &&
        typeof artifact1.deterministicHash.value === "string" &&
        artifact1.inputsDigest &&
        typeof artifact1.inputsDigest.value === "string";

      const stop = record(
        "produceArtifact returns required fields",
        pass ? ok("artifact has header + deterministicHash.value + inputsDigest.value") : fail("artifact missing required fields", artifact1 as any)
      );
      if (!stop && !continueOnFail) return tests;
    }
  } catch (e: any) {
    const stop = record("produceArtifact call", fail("produceArtifact threw", { message: safeString(e?.message ?? e) } as JSONObject));
    if (!stop && !continueOnFail) return tests;
  }

  // 4) Determinism check: same inputs -> same deterministicHash
  try {
    artifact2 = await adapter.produceArtifact({
      universeCode,
      engineCode,
      engineVersion,
      modeCode,
      matchId,
      seed,
      participants,
      inputs,
      outputs,
    });

    const pass =
      artifact1?.deterministicHash?.value &&
      artifact2?.deterministicHash?.value &&
      artifact1.deterministicHash.value === artifact2.deterministicHash.value;

    const stop = record(
      "deterministicHash stable for same bundle",
      pass
        ? ok("deterministicHash is stable across repeated produceArtifact")
        : fail("deterministicHash changed across repeated produceArtifact", {
            first: artifact1?.deterministicHash?.value,
            second: artifact2?.deterministicHash?.value,
          } as unknown as JSONObject)
    );
    if (!stop && !continueOnFail) return tests;
  } catch (e: any) {
    const stop = record("determinism check", fail("Determinism check threw", { message: safeString(e?.message ?? e) } as JSONObject));
    if (!stop && !continueOnFail) return tests;
  }

  return tests;
}

/**
 * Run in-process conformance for a kit by dynamically loading the adapter.
 */
export async function runBoltOnConformanceRunnerV1(
  kit: BoltOnKitV1,
  options: RunBoltOnConformanceOptionsV1 = {}
): Promise<BoltOnConformanceResultV1> {
  const baseDir = options.baseDir ?? process.cwd();
  const adapterModulePath = asPath(baseDir, kit.exports.engineAdapterModule);

  const details: BoltOnConformanceDetailsV1 = {
    kitId: kit.kitId,
    adapterModule: adapterModulePath,
    adapterExport: kit.exports.engineAdapterExportName,
    tests: [],
  };

  try {
    const AdapterExport = await loadExport(adapterModulePath, kit.exports.engineAdapterExportName);

    if (!AdapterExport) {
      details.tests.push({
        name: "load adapter export",
        ok: false,
        message: `Export not found: ${kit.exports.engineAdapterExportName}`,
        extra: { module: adapterModulePath } as JSONObject,
      });

      return {
        status: "FAIL",
        ranAt: nowIso(),
        summary: "Adapter export not found",
        details: details as unknown as JSONObject,
      };
    }

    // Instantiate if it's a class/function; otherwise assume it's already an object instance.
    const adapter = isFunction(AdapterExport) ? new (AdapterExport as any)() : AdapterExport;

    details.tests = await runMinimalSuite(adapter, options);

    const failed = details.tests.filter((t) => !t.ok);
    const status: BoltOnConformanceResultV1["status"] = failed.length === 0 ? "PASS" : "FAIL";

    return {
      status,
      ranAt: nowIso(),
      summary: status === "PASS" ? "All minimal conformance tests passed" : `${failed.length} conformance test(s) failed`,
      details: details as unknown as JSONObject,
    };
  } catch (e: any) {
    details.tests.push({
      name: "runner error",
      ok: false,
      message: "Runner threw",
      extra: { message: safeString(e?.message ?? e), stack: safeString(e?.stack ?? "") } as JSONObject,
    });

    return {
      status: "ERROR",
      ranAt: nowIso(),
      summary: "Runner error",
      details: details as unknown as JSONObject,
    };
  }
}

export default runBoltOnConformanceRunnerV1;
