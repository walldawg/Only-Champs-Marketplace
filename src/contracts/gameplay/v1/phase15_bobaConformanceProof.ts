/**
 * phase15_bobaConformanceProof.ts — Proof: BoBAEngineAdapterV1 passes BoltOnConformanceRunnerV1.
 *
 * Phase 15 Step 3 (LOGIC):
 * - No assumptions about external tooling beyond tsx being available (already used in prior proofs)
 * - Constructs a BoltOnKitV1 pointing at BoBAEngineAdapterV1 module export
 * - Runs runBoltOnConformanceRunnerV1 in-process
 * - Prints SUMMARY: status=PASS/FAIL tests=X
 *
 * Usage:
 *   npx -y tsx src/contracts/gameplay/v1/phase15_bobaConformanceProof.ts
 */

import { runBoltOnConformanceRunnerV1 } from "./BoltOnConformanceRunnerV1";
import type { BoltOnKitV1 } from "./BoltOnKitV1";

function logJson(label: string, obj: unknown) {
  // eslint-disable-next-line no-console
  console.log(`\n== ${label} ==\n${JSON.stringify(obj, null, 2)}`);
}

async function main() {
  const kit: BoltOnKitV1 = {
    kitVersion: "BoltOnKitV1",
    kitId: "KIT_BOBA_CORE_001",
    name: "BoBA Core Engine Kit (Stub Adapter)",
    description: "Phase 15 conformance proof kit for BoBAEngineAdapterV1 (stub).",
    engine: {
      engineCode: "BOBA_CORE",
      engineVersion: "0.1.0",
      universeCodes: ["BOBA"],
      modeCodes: ["ROOKIE", "SCORED"],
    },
    publisher: {
      name: "OnlyChamps (local)",
      contact: "local",
    },
    exports: {
      engineAdapterModule: "./src/contracts/gameplay/v1/BoBAEngineAdapterV1.ts",
      engineAdapterExportName: "BoBAEngineAdapterV1",
      engineManifestModule: "./src/contracts/gameplay/v1/BoBAEngineManifestV1.ts",
      engineManifestExportName: "BoBAEngineManifestV1",
    },
    conformance: {
      entrypoint: {
        runtime: "node",
        command: ["npx", "-y", "tsx", "src/contracts/gameplay/v1/phase15_bobaConformanceProof.ts"],
        notes: "Platform-side proof harness for BoBA conformance.",
      },
    },
    compatibility: {
      requiredContracts: ["EngineAdapterV1", "MatchArtifactV1", "EngineManifestV1"],
      minPlatformVersion: "phase15",
    },
    extra: {
      note: "Phase 15 Step 3: conformance proof only.",
    },
  };

  const result = await runBoltOnConformanceRunnerV1(kit, {
    baseDir: process.cwd(),
    continueOnFail: true,
    seed: "seed-phase15-boba-proof",
  });

  logJson("Conformance result", result);

  const tests = (result.details as any)?.tests ?? [];
  // eslint-disable-next-line no-console
  console.log(`\nSUMMARY: status=${result.status} tests=${tests.length}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exitCode = 1;
});
