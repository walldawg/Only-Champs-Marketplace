#!/usr/bin/env bash
set -euo pipefail

# Rookie Smoke Test v7 — CURRENT STATE (Engine matches + UI artifacts)
# Purpose:
# - Avoid legacy /wallet and /games routes (not mounted in current build)
# - Generate REAL decks + cards + match artifacts so /ui/decks and /ui/matches look "full"
#
# Requires:
# - Server running at BASE_URL (Terminal A)
# - DATABASE_URL points at the same SQLite DB the server uses (recommended: file:./prisma/dev.db)

BASE_URL="${BASE_URL:-http://127.0.0.1:3000}"
MODE_KEY="${MODE_KEY:-SCORED}"
GAME_MODE_ID="${GAME_MODE_ID:-GM_SCORED}"
GAME_MODE_VERSION="${GAME_MODE_VERSION:-1}"
FORMAT_ID="${FORMAT_ID:-FMT_ROOKIE}"
FORMAT_VERSION="${FORMAT_VERSION:-1}"
MATCH_COUNT="${MATCH_COUNT:-12}"

echo "== Rookie Smoke Test v7 (CURRENT) =="
echo "BASE_URL=$BASE_URL"
echo "MODE_KEY=$MODE_KEY  gameMode=$GAME_MODE_ID@$GAME_MODE_VERSION  format=$FORMAT_ID@$FORMAT_VERSION"
echo "MATCH_COUNT=$MATCH_COUNT"
echo

echo "== Optional: seed core CardVersions (idempotent) =="
if command -v npx >/dev/null 2>&1; then
  if [ -f "scripts/seed.ts" ]; then
    npx -y tsx scripts/seed.ts || true
  else
    echo "scripts/seed.ts not found — skipping."
  fi
else
  echo "npx not found — skipping seed."
fi
echo

create_deck () {
  local NAME="$1"
  curl -sS -X POST "$BASE_URL/decks" \
    -H 'content-type: application/json' \
    -d "{\"name\":\"$NAME\"}" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])"
}

echo "== Create Decks =="
D1="$(create_deck "Rookie Starter A (Smoke)")"
D2="$(create_deck "Rookie Starter B (Smoke)")"
echo "D1=$D1"
echo "D2=$D2"
echo

echo "== Populate Decks (CORE seed keys) =="
# NOTE: The deck cards endpoint expects { cards: [{ versionKey, qty }] }
# These keys are created by scripts/seed.ts in the current repo.
populate_deck () {
  local DECK_ID="$1"
  curl -sS -X PUT "$BASE_URL/decks/$DECK_ID/cards" \
    -H 'content-type: application/json' \
    -d '{
      "cards": [
        {"versionKey":"CORE:HERO:bo-jackson:V1","qty":1},
        {"versionKey":"CORE:HERO:ken-griffey-jr:V1","qty":1},
        {"versionKey":"CORE:PLAY:home-run:V1","qty":1},
        {"versionKey":"CORE:HOTDOG:ballpark-dog:V1","qty":1}
      ]
    }' >/dev/null
}

populate_deck "$D1" || { echo "FAILED to populate D1. Make sure scripts/seed.ts ran and CardVersions exist."; exit 1; }
populate_deck "$D2" || { echo "FAILED to populate D2. Make sure scripts/seed.ts ran and CardVersions exist."; exit 1; }
echo "Decks populated."
echo

echo "== Run Matches (artifact persistence) =="
run_match () {
  curl -sS -X POST "$BASE_URL/engine/matches/run" \
    -H 'content-type: application/json' \
    -d "{\"modeKey\":\"$MODE_KEY\",\"gameModeId\":\"$GAME_MODE_ID\",\"gameModeVersion\":$GAME_MODE_VERSION,\"formatId\":\"$FORMAT_ID\",\"formatVersion\":$FORMAT_VERSION}" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['stored']['matchId'])"
}

for i in $(seq 1 "$MATCH_COUNT"); do
  MID="$(run_match)"
  echo "[$i/$MATCH_COUNT] matchId=$MID"
done
echo

echo "== Quick UI sanity (HTML pages) =="
echo "Decks page:"
curl -sS -D- -o /tmp/_ui_decks_v7.html "$BASE_URL/ui/decks" | head -n 5
echo "Saved: /tmp/_ui_decks_v7.html"
echo

echo "Latest matches page:"
curl -sS -D- -o /tmp/_ui_matches_v7.html "$BASE_URL/ui/matches?limit=25&offset=0" | head -n 5
echo "Saved: /tmp/_ui_matches_v7.html"
echo

echo "== Done =="
echo "Open in browser:"
echo "  $BASE_URL/ui/decks"
echo "  $BASE_URL/ui/matches?limit=25&offset=0"
