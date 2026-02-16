// src/server/decks.ui.routes.ts
// Layer 7 (UI): Read-only Deck Viewer surfaces.
// Features:
//  - Advisory validation (local catalog/type rules)
//  - Collapsible errors/warnings
//  - ModeRuleBinding validation dropdown (Mode -> RuleSet)
//  - Run Match link (GET) that triggers POST /engine/matches/run internally and shows stored matchId.
// NOTE: Uses GET to avoid needing formbody middleware. No new dependencies.
// No schema changes.

import type { FastifyInstance } from "fastify";
import { PrismaClient } from "@prisma/client";
import { validateDecksForModeRuleSet } from "./engineValidation.gateway";

declare global {
  // eslint-disable-next-line no-var
  var __prisma__: PrismaClient | undefined;
}

const prisma =
  global.__prisma__ ??
  new PrismaClient({
    log: ["error", "warn"],
  });

if (process.env.NODE_ENV !== "production") global.__prisma__ = prisma;

function esc(v: any): string {
  const s = String(v ?? "");
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function prettyJson(obj: any): string {
  try {
    return JSON.stringify(obj, null, 2);
  } catch {
    return String(obj ?? "");
  }
}


function layout(title: string, body: string) {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(title)}</title>
    <style>
      body { font-family: Arial, sans-serif; padding: 20px; line-height: 1.35; }
      table { border-collapse: collapse; width: 100%; margin-top: 12px; }
      th, td { border: 1px solid #ddd; padding: 8px; }
      th { background-color: #f2f2f2; text-align: left; }
      a { text-decoration: none; color: #0077cc; }
      a:hover { text-decoration: underline; }
      .meta { color: #444; margin: 6px 0 0; }
      .box { border: 1px solid #ddd; padding: 12px; border-radius: 10px; margin-top: 14px; background: #fff; }
      .ok { color: #0a7a28; font-weight: bold; }
      .bad { color: #b00020; font-weight: bold; }
      ul { margin: 8px 0 0 18px; }
      code { background: #f6f8fa; padding: 2px 4px; border-radius: 6px; }
      .row { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 8px; }
      .pill { display: inline-block; padding: 3px 10px; border: 1px solid #ddd; border-radius: 999px; background: #fafafa; font-size: 12px; }
      details { margin-top: 10px; border: 1px solid #eee; border-radius: 10px; padding: 8px 10px; background: #fbfbfb; }
      summary { cursor: pointer; font-weight: bold; }
      details[open] { background: #fff; border-color: #ddd; }
      .muted { color: #666; font-weight: normal; }
      .formRow { display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-top:10px; }
      select { padding: 6px 8px; border:1px solid #ccc; border-radius:8px; background:#fff; }
      .subtle { font-size: 12px; color: #555; margin-top: 6px; }
      .kv { margin-top: 8px; }
      .kv div { margin-top: 4px; }
      .linkBtn { display:inline-block; padding:8px 12px; border:1px solid #0a66c2; border-radius:10px; }
    </style>
  </head>
  <body>
    ${body}
  </body>
</html>`;
}

type Validation = {
  ok: boolean;
  errors: string[];
  warnings: string[];
  summary: { totalCards: number; heroes: number; plays: number; hotdogs: number };
};

async function validateDeckAdvisory(deckId: string): Promise<Validation | null> {
  const deck = await prisma.deck.findUnique({
    where: { id: deckId },
    select: {
      id: true,
      cards: { select: { versionKey: true, qty: true } },
    },
  });

  if (!deck) return null;

  const versionKeys = deck.cards.map((c) => c.versionKey);
  const versions = versionKeys.length
    ? await prisma.cardVersion.findMany({
        where: { versionKey: { in: versionKeys } },
        select: { versionKey: true, conceptType: true },
      })
    : [];

  const byKey = new Map(versions.map((v) => [v.versionKey, v]));
  const totalCards = deck.cards.reduce((sum, c) => sum + c.qty, 0);

  let heroes = 0;
  let plays = 0;
  let hotdogs = 0;

  for (const c of deck.cards) {
    const v = byKey.get(c.versionKey);
    if (!v) continue;
    if (v.conceptType === "HERO") heroes += c.qty;
    else if (v.conceptType === "PLAY") plays += c.qty;
    else if (v.conceptType === "HOTDOG") hotdogs += c.qty;
  }

  const errors: string[] = [];
  const warnings: string[] = [];

  if (hotdogs > 0 && heroes < 1) {
    errors.push("HOTDOG gate: deck contains HOTDOG but has zero HERO cards (requires at least 1 HERO).");
  }

  const missingCatalog = deck.cards.map((c) => c.versionKey).filter((vk) => !byKey.has(vk));
  if (missingCatalog.length > 0) {
    warnings.push(`Catalog missing ${missingCatalog.length} referenced versionKey(s); type counts may be incomplete.`);
  }

  const ok = errors.length === 0;

  return { ok, errors, warnings, summary: { totalCards, heroes, plays, hotdogs } };
}

function renderModeValidationBlock(result: any) {
  const ok = !!result.ok;
  const skipped = !!result.skipped;
  const ruleSet = result.ruleSet ?? null;
  const errors = Array.isArray(result.errors) ? result.errors : [];

  const allMessages: string[] = [];
  for (const e of errors) {
    const msgs = Array.isArray(e?.messages) ? e.messages : [];
    for (const m of msgs) allMessages.push(String(m));
  }

  return `
    <div class="box">
      <div>Mode Validation: <span class="${ok ? "ok" : "bad"}">${ok ? "PASS" : "FAIL"}</span> <span class="muted">(modeKey: ${esc(result.modeKey)})</span></div>
      <div class="subtle">
        ${skipped ? "No Mode → RuleSet binding found. Validation skipped (non-breaking pass)." : "Validated using Mode → RuleSet binding."}
      </div>

      <div class="kv">
        <div><strong>RuleSet:</strong> ${ruleSet ? `<code>${esc(ruleSet.key)}@${esc(ruleSet.version)}</code> <span class="muted">(${esc(ruleSet.status)})</span>` : "<span class=\"muted\">-</span>"}</div>
        <div><strong>Issues:</strong> ${allMessages.length}</div>
      </div>

      ${
        allMessages.length
          ? `<details open>
              <summary>Issues <span class="muted">(${allMessages.length})</span></summary>
              <ul>${allMessages.map((m) => `<li>${esc(m)}</li>`).join("")}</ul>
            </details>`
          : `<p class="meta" style="margin-top:10px;">No issues reported by ruleset validation.</p>`
      }
    </div>
  `;
}

export async function registerDecksUiRoutes(app: FastifyInstance) {
// GET /ui/matches/:matchId

// -----------------------------
// UI: Latest Matches (read-only)
// -----------------------------
app.get("/ui/matches", async (req, reply) => {
  const q = (req.query ?? {}) as Record<string, unknown>;
  const deckId =
    typeof q.deckId === "string" && q.deckId.trim().length > 0 ? q.deckId.trim() : null;

  
  const rawLimit = Number(q.limit ?? 25);
  const rawOffset = Number(q.offset ?? 0);
  const limit = Math.min(Math.max(rawLimit || 25, 1), 200);
  const offset = Math.max(rawOffset || 0, 0);

  
  // When deckId filter is present, we overfetch and filter in-memory because JSON filtering
  // is not guaranteed across SQLite/Prisma versions.
  const overTake = deckId ? Math.min(200, Math.max(limit * 10, 50)) : limit;
  const rowsRaw = await prisma.engineMatchArtifactV1.findMany({
    orderBy: { createdAt: "desc" },
    skip: deckId ? 0 : offset,
    take: overTake,

    select: { matchId: true, createdAt: true, matchResultJson: true },
  });

  const rows = (deckId
    ? rowsRaw.filter((r) => {
        const mr: any = r.matchResultJson as any;
        return String(mr?.deckId ?? "") === String(deckId);
      })
    : rowsRaw
  ).slice(deckId ? offset : 0, deckId ? offset + limit : undefined);

  const backHref = deckId ? `/ui/decks/${encodeURIComponent(deckId)}` : "/ui/decks";
  const headerNote = deckId
    ? `Showing stored matches tagged to this deck.`
    : `Showing latest stored matches.`;

  const bodyRows =
    rows.length === 0
      ? `<tr><td colspan="6" class="muted">No stored matches found.</td></tr>`
      : rows
          .map((row) => {
            const mr = row.matchResultJson as any;
            const result = (mr?.result ?? {}) as any;

            const winner = String(result?.winner ?? "");
            const winReason = String(result?.winReason ?? "");
            const battles = result?.totalBattles ?? "";
            const format =
              mr?.formatId && mr?.formatVersion != null
                ? `${mr.formatId}@${mr.formatVersion}`
                : "";
            const mode =
              mr?.gameModeId && mr?.gameModeVersion != null
                ? `${mr.gameModeId}@${mr.gameModeVersion}`
                : "";

            const createdAtIso =
              row.createdAt instanceof Date
                ? row.createdAt.toISOString()
                : new Date(row.createdAt as any).toISOString();

            const href = deckId
              ? `/ui/matches/${row.matchId}?deckId=${encodeURIComponent(deckId)}`
              : `/ui/matches/${row.matchId}`;

            return `<tr>
              <td><a href="${href}"><code>${esc(row.matchId)}</code></a></td>
              <td><code>${esc(createdAtIso)}</code></td>
              <td>${esc(winner)}${winReason ? ` <span class="muted">(${esc(winReason)})</span>` : ""}</td>
              <td>${esc(String(battles))}</td>
              <td><code>${esc(format)}</code></td>
              <td><code>${esc(mode)}</code></td>
            </tr>`;
          })
          .join("");

  const html = layout(
    "Latest Matches",
    `
    <p><a href="${backHref}" style="text-decoration:none;">← Back</a></p>

    <h1>Latest Matches</h1>
    <p class="meta">${headerNote}</p>

    <table>
      <thead>
        <tr>
          <th>matchId</th>
          <th>createdAt</th>
          <th>winner</th>
          <th>battles</th>
          <th>format</th>
          <th>mode</th>
        </tr>
      </thead>
      <tbody>
        ${bodyRows}
      </tbody>
    
    </table>
    <div style="margin-top:16px;">
      ${offset > 0 ? `<a class="linkBtn" href="/ui/matches?limit=${limit}&offset=${Math.max(offset - limit, 0)}${deckId ? `&deckId=${encodeURIComponent(deckId)}` : ``}">← Prev</a>` : ""}
      ${rows.length === limit ? `<a class="linkBtn" style="margin-left:8px;" href="/ui/matches?limit=${limit}&offset=${offset + limit}${deckId ? `&deckId=${encodeURIComponent(deckId)}` : ``}">Next →</a>` : ""}
    </div>


    <p class="meta">Tip: open a deck and run a match to generate new entries.</p>
    `
  );

  return reply.type("text/html; charset=utf-8").send(html);
});

  app.get("/ui/matches/:matchId", async (req, reply) => {
    const matchId = (req.params as any).matchId as string;
    const deckIdRaw = (req.query as any)?.deckId as string | undefined;
    const deckId = typeof deckIdRaw === "string" && /^[0-9a-fA-F-]{36}$/.test(deckIdRaw) ? deckIdRaw : undefined;
    const backHref = deckId ? `/ui/decks/${deckId}` : `/ui/decks`;

        // Validate matchId shape; invalid IDs should return 400 (not 404).
        // This also prevents accidental probing of arbitrary strings.
        if (!/^M_API_[A-Za-z0-9-]+$/.test(matchId)) {
          reply.code(400).type("text/html").send(
            layout(
              "Invalid matchId",
              `<h1>Match Viewer</h1><p class="meta">Invalid matchId.</p><p><a href="${backHref}">← Back to Deck</a></p>`
            )
          );
          return;
        }

    const row = await (prisma as any).engineMatchArtifactV1.findUnique({
      where: { matchId },
      select: {
        matchId: true,
        sessionId: true,
        formatId: true,
        formatVersion: true,
        gameModeId: true,
        gameModeVersion: true,
        engineCompatVersion: true,
        matchResultJson: true,
        insightRecordJson: true,
        createdAt: true,
      },
    });

    if (!row) {
      return reply
        .code(404)
        .type("text/html; charset=utf-8")
        .send(
          layout(
            "Match Not Found",
            `<h1>Match Not Found</h1><p class="meta"><code>${esc(matchId)}</code></p><p><a href="${backHref}">${deckId ? "← Back to Deck" : "Back to Decks"}</a></p>`
          )
        );
    }

    const mr: any = row.matchResultJson ?? {};
    const result: any = mr.result ?? {};
    const timeline: any[] = Array.isArray(mr.timeline) ? mr.timeline : [];

    const winner = result.winner ?? "(unknown)";
    const winReason = result.winReason ?? "(unknown)";
    const totalBattles = result.totalBattles ?? timeline.length ?? "(unknown)";
    const finalCoin = result.finalCoinCount ?? null;

    const insights: any[] = Array.isArray((row.insightRecordJson as any)?.insights)
      ? (row.insightRecordJson as any).insights
      : [];

    const timelineRows = timeline
      .slice(0, 80)
      .map((ev: any) => {
        const idx = ev?.idx ?? "";
        const at = ev?.at ?? "";
        const extra = ev?.extra ?? {};
        const extraKeys = extra && typeof extra === "object" ? Object.keys(extra).slice(0, 6) : [];
        const extraSummary = extraKeys.length ? extraKeys.map((k) => `${k}=${String((extra as any)[k])}`).join(", ") : "";
        return `<tr><td>${esc(idx)}</td><td><code>${esc(at)}</code></td><td class="muted">${esc(extraSummary)}</td></tr>`;
      })
      .join("");

    const insightRows = insights
      .slice(0, 20)
      .map((i: any) => {
        const type = i?.type ?? "";
        const conf = i?.confidence ?? "";
        const txt = i?.explanationText ?? "";
        return `<tr><td><code>${esc(type)}</code></td><td>${esc(conf)}</td><td>${esc(txt)}</td></tr>`;
      })
      .join("");

    const html = layout(
      `Match ${row.matchId}`,
      `
        <h1>Match Viewer</h1>
        <p class="meta"><strong>matchId:</strong> <code>${esc(row.matchId)}</code> <a class="linkBtn" href="/ui/matches/${esc(row.matchId)}${deckId ? `?deckId=${encodeURIComponent(deckId)}` : ``}">Open Match Viewer</a></p>

        <div class="box">
          <div><strong>Status:</strong> <span class="pill">${esc(winner)}</span> <span class="muted">(${esc(winReason)})</span></div>
          <div class="row" style="margin-top:10px;">
            <span class="pill">battles: ${esc(totalBattles)}</span>
            <span class="pill">format: ${esc(row.formatId)}@${esc(row.formatVersion)}</span>
            <span class="pill">mode: ${esc(row.gameModeId)}@${esc(row.gameModeVersion)}</span>
            <span class="pill">engine: v${esc(row.engineCompatVersion)}</span>
          </div>
          <div class="kv">
            <div><strong>sessionId:</strong> <code>${esc(row.sessionId)}</code></div>
            <div><strong>createdAt:</strong> <code>${esc(new Date(row.createdAt).toISOString())}</code></div>
            ${
              finalCoin
                ? `<div><strong>finalCoinCount:</strong> <code>${esc(prettyJson(finalCoin))}</code></div>`
                : `<div><strong>finalCoinCount:</strong> <span class="muted">-</span></div>`
            }
          </div>

          <p style="margin-top:10px;">
            <a href="/engine/matches/${esc(row.matchId)}" target="_blank">Open Stored Match Artifact (JSON)</a>
          </p>
        </div>

        <div class="box">
          <div><strong>Timeline</strong> <span class="muted">(${esc(timeline.length)} events)</span></div>
          <div class="subtle">Showing up to 80 events (idx, at, extra summary keys).</div>
          <table>
            <thead><tr><th>idx</th><th>at</th><th>extra</th></tr></thead>
            <tbody>
              ${timelineRows || `<tr><td colspan="3">No timeline events.</td></tr>`}
            </tbody>
          </table>

          <details>
            <summary>Raw matchResultJson</summary>
            <pre style="white-space: pre-wrap;">${esc(prettyJson(row.matchResultJson))}</pre>
          </details>
        </div>

        <div class="box">
          <div><strong>Insights</strong> <span class="muted">(${esc(insights.length)} items)</span></div>
          <table>
            <thead><tr><th>type</th><th>confidence</th><th>explanation</th></tr></thead>
            <tbody>
              ${insightRows || `<tr><td colspan="3">No insights.</td></tr>`}
            </tbody>
          </table>

          <details>
            <summary>Raw insightRecordJson</summary>
            <pre style="white-space: pre-wrap;">${esc(prettyJson(row.insightRecordJson))}</pre>
          </details>
        </div>

        <p style="margin-top:20px;">
          <a href="${backHref}">${deckId ? "← Back to Deck" : "Back to Decks"}</a>
        </p>
      `
    );

    return reply.type("text/html; charset=utf-8").send(html);
  });


  app.get("/ui/decks", async (_req, reply) => {
    const decks = await prisma.deck.findMany({
      where: { archivedAt: null },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        ownerUserId: true,
        createdAt: true,
        cards: { select: { qty: true } },
      },
    });


  


    const rows = decks
      .map((d) => {
        const totalCards = d.cards.reduce((sum, c) => sum + c.qty, 0);
        return `
          <tr>
            <td><a href="/ui/decks/${esc(d.id)}">${esc(d.id)}</a></td>
            <td>${esc(d.name)}</td>
            <td>${esc(d.ownerUserId ?? "-")}</td>
            <td>${totalCards}</td>
            <td><code>${esc(d.createdAt.toISOString())}</code></td>
          </tr>
        `;
      })
      .join("");

    reply.type("text/html; charset=utf-8").send(
      layout(
        "Decks",
        `
          <h1>Decks</h1>
          <p class="meta">Read-only viewer (non-archived decks).</p>
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Name</th>
                <th>Owner</th>
                <th>Total Cards</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              ${rows || `<tr><td colspan="5">No decks found.</td></tr>`}
            </tbody>
          </table>
        `
      )
    );
  });

  // GET /ui/decks/:id/run-match?modeKey=SCORED
  app.get("/ui/decks/:id/run-match", async (req, reply) => {
    const deckId = (req.params as any).id as string;
    const modeKey = String((req.query as any)?.modeKey ?? "SCORED").trim() || "SCORED";

    // Optional matchType passthrough (default TRAINING). Allow future types.
    const rawMatchType = String((req.query as any)?.matchType ?? "").trim();
    const rawMatchTypeCustom = String((req.query as any)?.matchTypeCustom ?? "").trim();
    const matchType = (rawMatchTypeCustom || rawMatchType || "TRAINING").toUpperCase();

    const payload = {
      modeKey,
      gameModeId: "GM_SCORED",
      gameModeVersion: 1,
      formatId: "FMT_ROOKIE",
      formatVersion: 1,
      matchType,
    };

    const injected = await app.inject({
      method: "POST",
      url: "/engine/matches/run",
      payload: JSON.stringify(payload),
      headers: { "content-type": "application/json" },
    });

    const raw = injected.body ?? "";
    let parsed: any = null;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      parsed = null;
    }

    if (injected.statusCode >= 400) {
      return reply.type("text/html; charset=utf-8").send(
        layout(
          "Run Match Failed",
          `
            <h1>Run Match Failed</h1>
            <p class="meta">deck: <code>${esc(deckId)}</code> | modeKey: <code>${esc(modeKey)}</code></p>
            <div class="box">
              <div><strong>Status:</strong> ${injected.statusCode}</div>
              <div><strong>Response:</strong></div>
              <pre style="white-space: pre-wrap;">${esc(raw)}</pre>
            </div>
            <p><a href="/ui/decks/${esc(deckId)}">Back to deck</a></p>
          `
        )
      );
    }

    const matchId = parsed?.stored?.matchId ?? null;

    // Best-effort: tag the stored match artifact with deckId for UI filtering.
    // Non-breaking: if this fails, the match still exists and UI still works via ?deckId= linkback.
    if (matchId) {
      try {
        const art = await prisma.engineMatchArtifactV1.findFirst({
          where: { matchId: String(matchId) },
          select: { matchResultJson: true },
        });
        const mr: any = (art?.matchResultJson as any) ?? {};
        if (!mr.deckId) {
          await prisma.engineMatchArtifactV1.updateMany({
            where: { matchId: String(matchId) },
            data: { matchResultJson: { ...(mr || {}), deckId } as any },
          });
        }
      } catch {
        // ignore
      }
    }

    return reply.type("text/html; charset=utf-8").send(
      layout(
        "Match Started",
        `
          <h1>Match Started</h1>
        <p class="meta">modeKey: <code>${esc(modeKey)}</code> | matchType: <code>${esc(matchType)}</code></p>
          <div class="box">
            <div><strong>matchId:</strong> ${matchId ? `<code>${esc(matchId)}</code>` : `<span class="muted">(not found in response)</span>`}</div>
            <p style="margin-top:10px;">
              ${matchId ? `<a class="linkBtn" href="/ui/matches/${esc(matchId)}?deckId=${encodeURIComponent(deckId)}">Open Match Viewer</a> <span class="muted">|</span> <a href="/engine/matches/${esc(matchId)}" target="_blank">Open Stored Match Artifact (JSON)</a>` : ""}
            </p>
            <details style="margin-top:10px;">
              <summary>Raw Response</summary>
              <pre style="white-space: pre-wrap;">${esc(raw)}</pre>
            </details>
          </div>
          <p><a href="/ui/decks/${esc(deckId)}">Back to deck</a></p>
        `
      )
    );
  });

  app.get("/ui/decks/:id", async (req, reply) => {
    const deckId = (req.params as any).id as string;
    const modeKeyFromQuery = String((req.query as any)?.modeKey ?? "").trim() || null;

    const deck = await prisma.deck.findUnique({
      where: { id: deckId },
      select: {
        id: true,
        name: true,
        ownerUserId: true,
        cards: { orderBy: { createdAt: "asc" }, select: { versionKey: true, qty: true } },
      },
    });

    if (!deck) {
      return reply
        .code(404)
        .type("text/html; charset=utf-8")
        .send(layout("Deck Not Found", `<h1>Deck Not Found</h1><p class="meta">${esc(deckId)}</p><p><a href="/ui/decks">Back</a></p>`));
    }

    const totalCards = deck.cards.reduce((sum, c) => sum + c.qty, 0);

    const cardRows = deck.cards
      .map(
        (c) => `
          <tr>
            <td><code>${esc(c.versionKey)}</code></td>
            <td>${c.qty}</td>
          </tr>
        `
      )
      .join("");

    const validation = await validateDeckAdvisory(deck.id);

    const pills = validation
      ? `
        <div class="row">
          <span class="pill">total: ${validation.summary.totalCards}</span>
          <span class="pill">heroes: ${validation.summary.heroes}</span>
          <span class="pill">plays: ${validation.summary.plays}</span>
          <span class="pill">hotdogs: ${validation.summary.hotdogs}</span>
        </div>
      `
      : "";

    const valBlock = validation
      ? `
        <div class="box">
          <div>Advisory Validation: <span class="${validation.ok ? "ok" : "bad"}">${validation.ok ? "PASS" : "FAIL"}</span></div>
          ${pills}
          ${
            validation.errors.length
              ? `<details ${validation.ok ? "" : "open"}>
                  <summary>Errors <span class="muted">(${validation.errors.length})</span></summary>
                  <ul>${validation.errors.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>
                </details>`
              : ""
          }
          ${
            validation.warnings.length
              ? `<details>
                  <summary>Warnings <span class="muted">(${validation.warnings.length})</span></summary>
                  <ul>${validation.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>
                </details>`
              : ""
          }
          ${!validation.errors.length && !validation.warnings.length ? `<p class="meta" style="margin-top:10px;">No errors or warnings.</p>` : ""}
          <p style="margin-top:10px;">
            <a href="/decks/${esc(deck.id)}/validate" target="_blank">Open advisory validation JSON</a>
          </p>
        </div>
      `
      : `
        <div class="box">
          <div>Advisory Validation: <span class="bad">UNKNOWN</span></div>
          <p class="meta">Could not compute advisory validation for this deck.</p>
          <p style="margin-top:10px;">
            <a href="/decks/${esc(deck.id)}/validate" target="_blank">Try advisory validation JSON</a>
          </p>
        </div>
      `;

    const bindings = await (prisma as any).modeRuleBinding.findMany({
      orderBy: { modeKey: "asc" },
      select: { modeKey: true, ruleSetKey: true, ruleSetVersion: true },
    });

    const options = (bindings as any[])
      .map((b) => {
        const mk = String(b.modeKey);
        const label = `${mk}  (RuleSet: ${b.ruleSetKey}@${b.ruleSetVersion})`;
        const selected = modeKeyFromQuery === mk ? "selected" : "";
        return `<option value="${esc(mk)}" ${selected}>${esc(label)}</option>`;
      })
      .join("");

    let modeValidationHtml = "";
    if (modeKeyFromQuery) {
      const result = await validateDecksForModeRuleSet({
        prisma: prisma as any,
        modeKey: modeKeyFromQuery,
        deckIds: [deck.id],
      });
      modeValidationHtml = renderModeValidationBlock(result);
    }

    const modeForm = `
      <div class="box">
        <div><strong>Validate For Mode</strong></div>
        <div class="subtle">Uses Mode → RuleSet binding and the same gateway used by engine routes. This is read-only.</div>
        <form method="get" action="/ui/decks/${esc(deck.id)}">
          <div class="formRow">
            <select name="modeKey" aria-label="modeKey">
              <option value="">-- choose a modeKey --</option>
              ${options}
            </select>
            <button type="submit">Validate</button>
          </div>
        </form>
      </div>
      ${modeValidationHtml}
    `;

    const runMatchBox = `
      <div class="box">
        <div><strong>Run Match</strong> <span class="muted">(engine demo)</span></div>
        <div class="subtle">Triggers <code>POST /engine/matches/run</code> internally (GET link to avoid form parsing).</div>
        <form method="get" action="/ui/decks/${esc(deck.id)}/run-match">
          <div class="formRow">
            <input type="hidden" name="modeKey" value="SCORED" />

            <select name="matchType" aria-label="matchType">
              <option value="TRAINING">TRAINING</option>
              <option value="RANKED">RANKED</option>
              <option value="TOURNAMENT">TOURNAMENT</option>
            </select>

            <input name="matchTypeCustom" placeholder="custom matchType (optional)" style="min-width:220px;" />

            <button type="submit">Run</button>
          </div>
          <div class="subtle" style="margin-top:6px;">If <code>custom matchType</code> is set, it overrides the dropdown.</div>
        </form>
      </div>
    `;

    return reply.type("text/html; charset=utf-8").send(
      layout(
        `Deck ${deck.id}`,
        `
          <h1>Deck Detail</h1>
          <p><strong>ID:</strong> <code>${esc(deck.id)}</code></p>
          <p><strong>Name:</strong> ${esc(deck.name)}</p>
          <p><strong>Owner:</strong> ${esc(deck.ownerUserId ?? "-")}</p>
          <p><strong>Total Cards:</strong> ${totalCards}</p>

          ${valBlock}

          ${modeForm}

          ${runMatchBox}

          <h2>Cards</h2>
          <table>
            <thead>
              <tr>
                <th>Version Key</th>
                <th>Quantity</th>
              </tr>
            </thead>
            <tbody>
              ${cardRows || `<tr><td colspan="2">No cards found for this deck.</td></tr>`}
            </tbody>
          </table>

          <p style="margin-top:20px;">
            <a href="/ui/decks">Back to Decks</a>
          </p>
        `
      )
    );
  });
}
