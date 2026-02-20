import fs from "node:fs/promises";
import path from "node:path";
import { InProcessMockEngineAdapterV1 } from "../src/contracts/gameplay/v1/InProcessMockEngineAdapterV1";
import type { JSONObject } from "../src/contracts/gameplay/v1/MatchArtifactV1";

type Args = {
  regenerate: boolean;
  confirm: boolean;
};

type SnapshotDoc = {
  snapshotVersion: "rookie_baseline_v1";
  generatedFrom: {
    universeCode: string;
    engineCode: string;
    engineVersion: string;
    modeCode: string;
  };
  matchId: string;
  artifact: unknown;
};

const SNAPSHOT_RELATIVE_PATH = path.join("data", "snapshots", "rookie_baseline_v1.json");
const MATCH_ID = "MATCH_PHASE8_ROOKIE_BASELINE_001";

function getArgValue(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  if (i === -1) return undefined;
  const next = argv[i + 1];
  if (!next || next.startsWith("--")) return "";
  return next;
}

function parseBool(v: string | undefined, fallback: boolean): boolean {
  if (v == null || v === "") return fallback;
  const normalized = v.trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  throw new Error(`Invalid boolean value: ${v}`);
}

function parseArgs(argv: string[]): Args {
  const regenerate = argv.includes("--regenerate");
  const confirm = parseBool(getArgValue(argv, "--confirm"), false);
  if (regenerate && !confirm) {
    throw new Error("--regenerate requires --confirm true");
  }
  return { regenerate, confirm };
}

function sortObjectKeysDeep(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => sortObjectKeysDeep(item));
  const input = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(input).sort()) {
    out[key] = sortObjectKeysDeep(input[key]);
  }
  return out;
}

function normalizeArtifact(artifact: any): unknown {
  const placements = Array.isArray(artifact?.result?.placements)
    ? artifact.result.placements.map((p: any) => ({
        participantId: p?.participantId ?? null,
        placement: p?.placement ?? null,
      }))
    : [];

  placements.sort((a: any, b: any) => {
    const pa = Number(a.placement ?? 0);
    const pb = Number(b.placement ?? 0);
    if (pa !== pb) return pa - pb;
    return String(a.participantId ?? "").localeCompare(String(b.participantId ?? ""));
  });

  const participants = Array.isArray(artifact?.participants)
    ? artifact.participants
        .map((p: any) => ({
          participantId: p?.participantId ?? null,
          role: p?.role ?? null,
          extra: p?.extra ?? null,
        }))
        .sort((a: any, b: any) => String(a.participantId ?? "").localeCompare(String(b.participantId ?? "")))
    : [];

  const timeline = Array.isArray(artifact?.timeline)
    ? artifact.timeline
        .map((event: any) => ({
          ...event,
          at: "<normalized-iso>",
        }))
        .sort((a: any, b: any) => Number(a?.idx ?? 0) - Number(b?.idx ?? 0))
    : [];

  const normalized = {
    header: {
      ...artifact?.header,
      startedAt: "<normalized-iso>",
      completedAt: "<normalized-iso>",
    },
    participants,
    seed: artifact?.seed ?? null,
    inputsDigest: artifact?.inputsDigest ?? null,
    timeline,
    result: {
      winnerParticipantId: artifact?.result?.winnerParticipantId ?? null,
      placements,
      scoresByParticipantId: artifact?.result?.scoresByParticipantId ?? {},
      outcomeFlags: Array.isArray(artifact?.result?.outcomeFlags)
        ? [...artifact.result.outcomeFlags].sort()
        : [],
      scoringSummary: artifact?.result?.scoringSummary ?? {},
    },
    deterministicHash: artifact?.deterministicHash ?? null,
    replay: artifact?.replay ?? null,
    platformMeta: artifact?.platformMeta ?? null,
  };

  return sortObjectKeysDeep(normalized);
}

async function runDeterministicMatch(): Promise<{ matchId: string; snapshot: SnapshotDoc }> {
  const adapter = new InProcessMockEngineAdapterV1();

  const universeCode = "UNIV_TEST";
  const engineCode = "MOCK_ENGINE";
  const engineVersion = "0.0.1";
  const modeCode = "ROOKIE";
  const seed = "seed-phase8-rookie-baseline-001";

  const participants = [
    { participantId: "P1", extra: { name: "Player One" } as JSONObject },
    { participantId: "P2", extra: { name: "Player Two" } as JSONObject },
  ];

  const inputs: JSONObject = {
    participants: participants.map((p) => ({ participantId: p.participantId })),
    proof: {
      phase: "phase8",
      kind: "determinism-snapshot",
      version: 1,
    },
  };

  const init = await adapter.createMatch({
    universeCode,
    engineCode,
    engineVersion,
    modeCode,
    matchId: MATCH_ID,
    participants,
    seed,
    inputs,
  });
  if (!init.ok || init.state == null) {
    throw new Error("createMatch failed while generating deterministic snapshot");
  }

  const run = await adapter.runMatch({
    universeCode,
    engineCode,
    engineVersion,
    modeCode,
    matchId: MATCH_ID,
    seed,
    state: init.state,
    inputs,
  });
  if (!run.ok || run.outputs == null) {
    throw new Error("runMatch failed while generating deterministic snapshot");
  }

  const artifact = await adapter.produceArtifact({
    universeCode,
    engineCode,
    engineVersion,
    modeCode,
    matchId: MATCH_ID,
    seed,
    participants,
    inputs,
    outputs: run.outputs,
  });

  const snapshot: SnapshotDoc = {
    snapshotVersion: "rookie_baseline_v1",
    generatedFrom: {
      universeCode,
      engineCode,
      engineVersion,
      modeCode,
    },
    matchId: artifact.header.matchId,
    artifact: normalizeArtifact(artifact),
  };

  return { matchId: artifact.header.matchId, snapshot: sortObjectKeysDeep(snapshot) as SnapshotDoc };
}

function toStableJson(value: unknown): string {
  return `${JSON.stringify(sortObjectKeysDeep(value), null, 2)}\n`;
}

async function main() {
  let matchId = MATCH_ID;
  let exitCode = 1;
  const snapshotPath = path.resolve(process.cwd(), SNAPSHOT_RELATIVE_PATH);

  try {
    const args = parseArgs(process.argv.slice(2));
    const { matchId: computedMatchId, snapshot } = await runDeterministicMatch();
    matchId = computedMatchId;
    const next = toStableJson(snapshot);

    if (args.regenerate) {
      await fs.mkdir(path.dirname(snapshotPath), { recursive: true });
      await fs.writeFile(snapshotPath, next, "utf8");
      exitCode = 0;
    } else {
      let baseline: string;
      try {
        baseline = await fs.readFile(snapshotPath, "utf8");
      } catch {
        throw new Error(`Snapshot file not found at ${snapshotPath}. Run with --regenerate --confirm true first.`);
      }
      if (baseline.trimEnd() === next.trimEnd()) {
        exitCode = 0;
      } else {
        console.error("DRIFT_DETECTED: normalized snapshot differs from committed baseline.");
        exitCode = 1;
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(message);
    exitCode = 1;
  }

  console.log(`snapshotPath=${SNAPSHOT_RELATIVE_PATH}`);
  console.log(`matchId=${matchId}`);
  console.log(`exitCode=${exitCode}`);
  process.exitCode = exitCode;
}

void main();
