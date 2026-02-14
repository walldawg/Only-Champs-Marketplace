/**
 * phase14_conformanceProof.ts — Minimal proof: BoltOnKitV1 + ConformanceRunner -> PASS/FAIL.
 *
 * Phase 14 Proof:
 * - Uses existing InProcessMockEngineAdapterV1 as a "bolt-on" engine kit
 * - Runs BoltOnConformanceRunnerV1 in-process (dynamic import)
 * - Prints conformance results + SUMMARY
 *
 * Usage:
 *   npx -y tsx src/contracts/gameplay/v1/phase14_conformanceProof.ts
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
    kitId: "KIT_MOCK_ENGINE_001",
    name: "Mock Engine Kit (InProcess)",
    description: "Phase 14 proof kit using the in-process mock adapter.",
    engine: {
      engineCode: "MOCK_ENGINE",
      engineVersion: "0.0.1",
      universeCodes: ["UNIV_TEST"],
      modeCodes: ["ROOKIE"],
    },
    publisher: {
      name: "OnlyChamps (local)",
      contact: "local",
    },
    exports: {
      engineAdapterModule: "./src/contracts/gameplay/v1/InProcessMockEngineAdapterV1.ts",
      engineAdapterExportName: "InProcessMockEngineAdapterV1",
    },
    conformance: {
      entrypoint: {
        runtime: "node",
        command: ["npx", "-y", "tsx", "src/contracts/gameplay/v1/phase14_conformanceProof.ts"],
        notes: "This is the platform-side proof harness, not the kit's own entrypoint.",
      },
    },
    compatibility: {
      requiredContracts: ["EngineAdapterV1", "MatchArtifactV1"],
    },
  };

  const result = await runBoltOnConformanceRunnerV1(kit, {
    baseDir: process.cwd(),
    continueOnFail: true,
    seed: "seed-phase14-proof",
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
