#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:3000}"

need() { command -v "$1" >/dev/null 2>&1 || { echo "Missing dependency: $1" >&2; exit 1; }; }
need curl
need jq

echo "== Rookie Smoke Test v2 (Engine Core v1) =="
echo "BASE_URL=$BASE_URL"
echo
echo "== Create Decks =="
D1_JSON="$(curl -sS -X POST "$BASE_URL/decks" -H 'content-type: application/json' -d '{"name":"Rookie Smoke P1"}')"
D2_JSON="$(curl -sS -X POST "$BASE_URL/decks" -H 'content-type: application/json' -d '{"name":"Rookie Smoke P2"}')"
D1="$(echo "$D1_JSON" | jq -r .id)"
D2="$(echo "$D2_JSON" | jq -r .id)"
if [ -z "$D1" ] || [ "$D1" = "null" ]; then echo "Failed to create deck 1"; echo "$D1_JSON" | jq .; exit 1; fi
if [ -z "$D2" ] || [ "$D2" = "null" ]; then echo "Failed to create deck 2"; echo "$D2_JSON" | jq .; exit 1; fi
echo "D1=$D1"
echo "D2=$D2"
echo
echo "== Create Game (ROOKIE) =="
GAME_JSON="$(curl -sS -X POST "$BASE_URL/games" -H 'content-type: application/json' -d '{"modeCode":"ROOKIE","players":[{"seat":1,"deckId":"'"$D1"'"},{"seat":2,"deckId":"'"$D2"'"}]}' )"
GAME_ID="$(echo "$GAME_JSON" | jq -r .id)"
if [ -z "$GAME_ID" ] || [ "$GAME_ID" = "null" ]; then echo "Failed to create game"; echo "$GAME_JSON" | jq .; exit 1; fi
echo "GAME_ID=$GAME_ID"
echo
echo "== Start Game =="
START_JSON="$(curl -sS -X POST "$BASE_URL/games/$GAME_ID/start")"
echo "$START_JSON" | jq '.status, .state.modeCode, .state.rookie.phase'
echo

act() {
  local TYPE="$1"
  local PAYLOAD="$2"
  local RESP
  RESP="$(curl -sS -X POST "$BASE_URL/games/$GAME_ID/actions" -H 'content-type: application/json' -d '{"type":"'"$TYPE"'","payload":'"$PAYLOAD"'}')"
  # If reducer returns an error object, surface it and fail fast.
  if echo "$RESP" | jq -e '.error?' >/dev/null 2>&1; then
    echo "Action failed: $TYPE" >&2
    echo "$RESP" | jq . >&2
    exit 1
  fi
}

echo "== Place Heroes (7 zones each) =="
act ROOKIE_PLACE '{"seat":1,"zoneIndex":0,"versionKey":"alpha:HERO:NO_001:ALLEN_IVERSON_DEBUT_80_S_RAD_BATTLEFOIL_HEX_SP"}'
act ROOKIE_PLACE '{"seat":1,"zoneIndex":1,"versionKey":"alpha:HERO:NO_002:ALLEN_IVERSON_DEBUT_80_S_RAD_BATTLEFOIL_GLOW_SP"}'
act ROOKIE_PLACE '{"seat":1,"zoneIndex":2,"versionKey":"alpha:HERO:NO_003:ALLEN_IVERSON_DEBUT_80_S_RAD_BATTLEFOIL_FIRE_SP"}'
act ROOKIE_PLACE '{"seat":1,"zoneIndex":3,"versionKey":"alpha:HERO:NO_004:ALLEN_IVERSON_DEBUT_80_S_RAD_BATTLEFOIL_ICE_SP"}'
act ROOKIE_PLACE '{"seat":1,"zoneIndex":4,"versionKey":"alpha:HERO:NO_005:ADLEY_RUTSHMAN_DEBUT_BLUE_BATTLEFOIL_ICE_SP"}'
act ROOKIE_PLACE '{"seat":1,"zoneIndex":5,"versionKey":"alpha:HERO:NO_006:ADLEY_RUTSHMAN_DEBUT_INSPIRED_INK_BATTLEFOIL_GUM_SSP"}'
act ROOKIE_PLACE '{"seat":1,"zoneIndex":6,"versionKey":"alpha:HERO:NO_007:FIRST_EDITION_BASE_SET_FIRE"}'
act ROOKIE_PLACE '{"seat":2,"zoneIndex":0,"versionKey":"alpha:HERO:NO_008:FIRST_EDITION_BASE_SET_ICE"}'
act ROOKIE_PLACE '{"seat":2,"zoneIndex":1,"versionKey":"alpha:HERO:NO_009:AMON_RA_ST_BROWN_DEBUT_BLUE_BATTLEFOIL_ICE_SP"}'
act ROOKIE_PLACE '{"seat":2,"zoneIndex":2,"versionKey":"alpha:HERO:NO_010:AMON_RA_ST_BROWN_DEBUT_INSPIRED_INK_BATTLEFOIL_GUM_SSP"}'
act ROOKIE_PLACE '{"seat":2,"zoneIndex":3,"versionKey":"alpha:HERO:NO_011:BRANDI_CHASTAIN_DEBUT_INSPIRED_INK_BATTLEFOIL_HEX"}'
act ROOKIE_PLACE '{"seat":2,"zoneIndex":4,"versionKey":"alpha:HERO:NO_012:BRANDI_CHASTAIN_DEBUT_INSPIRED_INK_BATTLEFOIL_GLOW"}'
act ROOKIE_PLACE '{"seat":2,"zoneIndex":5,"versionKey":"alpha:HERO:NO_013:BRANDI_CHASTAIN_DEBUT_INSPIRED_INK_BATTLEFOIL_FIRE"}'
act ROOKIE_PLACE '{"seat":2,"zoneIndex":6,"versionKey":"alpha:HERO:NO_014:BRANDI_CHASTAIN_DEBUT_INSPIRED_INK_BATTLEFOIL_ICE"}'
echo "placed"
echo
echo "== Reveal Zones 0-6 =="
act ROOKIE_REVEAL '{"zoneIndex":0}'
act ROOKIE_REVEAL '{"zoneIndex":1}'
act ROOKIE_REVEAL '{"zoneIndex":2}'
act ROOKIE_REVEAL '{"zoneIndex":3}'
act ROOKIE_REVEAL '{"zoneIndex":4}'
act ROOKIE_REVEAL '{"zoneIndex":5}'
act ROOKIE_REVEAL '{"zoneIndex":6}'
echo "revealed"
echo
echo "== Begin Match =="
act ROOKIE_BEGIN_MATCH '{}'
echo "begun"
echo
echo "== Score Match =="
FINAL_JSON="$(curl -sS -X POST "$BASE_URL/games/$GAME_ID/actions" -H 'content-type: application/json' -d '{"type":"ROOKIE_SCORE_MATCH","payload":{}}' )"
echo "$FINAL_JSON" | jq '.state.rookie.phase, .state.rookie.results, .state.rookie.tally'
echo

echo "== Assert tally (length 7) =="
echo "$FINAL_JSON" | jq -e '.state.rookie.tally | length == 7' >/dev/null
echo "tally_ok"
echo
echo "== Done =="