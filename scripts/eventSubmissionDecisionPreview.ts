/**
 * Event Authority v1 — Submission Gating Preview (no routes)
 *
 * Usage (Terminal B):
 *   npx -y tsx scripts/eventSubmissionDecisionPreview.ts --eventId EVT_ADVISORY_TEST --deckId <deckId>
 *
 * Optional:
 *   --baseUrl http://127.0.0.1:3000
 *   --skipValidate                 (simulate validator outage)
 *   --mockErrors <n>               (simulate validator errors; bypasses /validate)
 *   --mockWarnings <n>             (simulate validator warnings; bypasses /validate)
 */

import { getEventById_V1 } from "../src/config/events.v1";
import {
  decideEventSubmissionV1,
  type ValidatorOutputV1,
} from "../src/eventAuthority/submissionDecision.v1";

type Args = {
  eventId: string;
  deckId: string;
  baseUrl: string;
  skipValidate: boolean;
  mockErrors: number;
  mockWarnings: number;
};

function parseArgs(argv: string[]): Args {
  const out: Args = {
    eventId: "",
    deckId: "",
    baseUrl: "http://127.0.0.1:3000",
    skipValidate: false,
    mockErrors: 0,
    mockWarnings: 0,
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--eventId") out.eventId = argv[++i] ?? "";
    else if (a === "--deckId") out.deckId = argv[++i] ?? "";
    else if (a === "--baseUrl") out.baseUrl = argv[++i] ?? out.baseUrl;
    else if (a === "--skipValidate") out.skipValidate = true;
    else if (a === "--mockErrors") out.mockErrors = Number(argv[++i] ?? "0") || 0;
    else if (a === "--mockWarnings")
      out.mockWarnings = Number(argv[++i] ?? "0") || 0;
  }

  if (!out.eventId || !out.deckId) {
    console.error(
      "Missing required args. Example: npx -y tsx scripts/eventSubmissionDecisionPreview.ts --eventId EVT_ADVISORY_TEST --deckId <deckId>",
    );
    process.exit(2);
  }

  if (out.mockErrors < 0 || out.mockWarnings < 0) {
    console.error("--mockErrors and --mockWarnings must be >= 0");
    process.exit(2);
  }

  return out;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status} ${res.statusText} — ${text}`);
  }
  return (await res.json()) as T;
}

function makeMockValidation(mockErrors: number, mockWarnings: number): ValidatorOutputV1 {
  const errors = Array.from({ length: mockErrors }, (_, i) => `MOCK_ERROR_${i + 1}`);
  const warnings = Array.from({ length: mockWarnings }, (_, i) => `MOCK_WARNING_${i + 1}`);
  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const event = getEventById_V1(args.eventId);

  // Deck existence check (no validation yet).
  let deckExists = true;
  try {
    await fetchJson(`${args.baseUrl}/decks/${encodeURIComponent(args.deckId)}`);
  } catch {
    deckExists = false;
  }

  const usingMock = args.mockErrors > 0 || args.mockWarnings > 0;

  let validation: ValidatorOutputV1 | null = null;
  if (usingMock) {
    validation = makeMockValidation(args.mockErrors, args.mockWarnings);
  } else if (!args.skipValidate) {
    try {
      const v = await fetchJson<{
        ok: boolean;
        errors: string[];
        warnings: string[];
      }>(`${args.baseUrl}/decks/${encodeURIComponent(args.deckId)}/validate`);
      validation = {
        ok: v.ok,
        errors: v.errors ?? [],
        warnings: v.warnings ?? [],
      };
    } catch {
      validation = null;
    }
  }

  const decision = decideEventSubmissionV1({
    event,
    deckExists,
    validation,
    nowIso: new Date().toISOString(),
  });

  const out = {
    input: {
      eventId: args.eventId,
      deckId: args.deckId,
      baseUrl: args.baseUrl,
      deckExists,
      validationFetched: usingMock ? false : !args.skipValidate,
      validationPresent: Boolean(validation),
      validationMocked: usingMock,
      mockedErrorCount: usingMock ? args.mockErrors : null,
      mockedWarningCount: usingMock ? args.mockWarnings : null,
      eventFound: Boolean(event),
      eventName: event?.name ?? null,
      eventStatus: event?.status ?? null,
      eventEnforcement: event?.enforcementLevel ?? null,
      killSwitchActive: event?.killSwitchActive ?? null,
    },
    decision,
  };

  console.log(JSON.stringify(out, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
