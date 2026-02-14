/**
 * LFBO — Phase 8H: CardViewModelV1 Freeze
 * Validation script (PASS/FAIL)
 *
 * Usage:
 *   SET_CODE="griffey" BASE_URL="http://127.0.0.1:3000" npx -y tsx scripts/phase8H_validateCardViewModelV1.ts
 */
type Json = any;

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const SET_CODE = process.env.SET_CODE ?? "griffey";

function die(msg: string): never {
  console.error("FAIL:", msg);
  process.exit(1);
}

function ok(msg: string) {
  console.log("OK:", msg);
}

function isObj(v: any): v is Record<string, any> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function hasString(obj: any, key: string) {
  if (!isObj(obj) || typeof obj[key] !== "string" || obj[key].length === 0) {
    die(`Missing/invalid string field "${key}"`);
  }
}

function hasOptionalString(obj: any, key: string) {
  if (!isObj(obj)) die(`Expected object for optional string field check "${key}"`);
  const v = obj[key];
  if (v === undefined || v === null) return;
  if (typeof v !== "string") die(`Invalid optional string field "${key}" (must be string|null|undefined)`);
}

function hasObj(obj: any, key: string) {
  if (!isObj(obj) || !isObj(obj[key])) {
    die(`Missing/invalid object field "${key}"`);
  }
}

function hasArray(obj: any, key: string) {
  if (!isObj(obj) || !Array.isArray(obj[key])) {
    die(`Missing/invalid array field "${key}"`);
  }
}

function checkCardBack(v: any) {
  if (!isObj(v.cardBack)) die(`Missing/invalid "cardBack"`);
  hasString(v.cardBack, "key");
  hasString(v.cardBack, "setCode");
}

const ART_LEVELS = new Set(["BASE", "TREATMENT", "OFFICIAL", "VERIFIED"]);
function checkArtFront(v: any) {
  if (!isObj(v.artFront)) die(`Missing/invalid "artFront" (expected object)`);
  hasString(v.artFront, "level");
  hasString(v.artFront, "key");
  if (!ART_LEVELS.has(v.artFront.level)) {
    die(`Invalid artFront.level="${v.artFront.level}" (expected ${Array.from(ART_LEVELS).join("|")})`);
  }
}

function checkVersionV1(v: any) {
  // CardViewModelV1 — required surface
  hasString(v, "versionKey");
  hasString(v, "conceptKey");
  hasString(v, "setCode");
  hasString(v, "conceptType");
  hasString(v, "versionCode");
  hasString(v, "finish");
  if (!isObj(v.attributes)) die(`Missing/invalid "attributes" object`);
  if (!isObj(v.requirements)) die(`Missing/invalid "requirements" object`);

  // Phase 8F + 8G
  checkCardBack(v);
  checkArtFront(v);

  // Optional surface (allowed, but not required)
  hasOptionalString(v, "treatmentKey");
  hasOptionalString(v, "artOfficialKey");
  hasOptionalString(v, "artVerifiedKey");
}

async function getJson(url: string): Promise<Json> {
  const res = await fetch(url, { headers: { "accept": "application/json" } });
  const text = await res.text();
  let data: any = null;
  try { data = JSON.parse(text); } catch { /* ignore */ }
  if (!res.ok) {
    const detail = data ? JSON.stringify(data) : text;
    die(`HTTP ${res.status} for ${url} :: ${detail}`);
  }
  return data;
}

async function main() {
  console.log(`== Phase 8H: CardViewModelV1 Freeze Validation ==`);
  console.log(`BASE_URL=${BASE_URL}`);
  console.log(`SET_CODE=${SET_CODE}`);

  // 1) Set cards endpoint (includes versions)
  const setUrl = `${BASE_URL}/catalog/sets/${encodeURIComponent(SET_CODE)}/cards?includeVersions=true&limit=1&offset=0`;
  const setPayload = await getJson(setUrl);

  if (!isObj(setPayload)) die("Set payload not an object");
  hasString(setPayload, "setCode");
  if (setPayload.setCode !== SET_CODE) die(`Expected setCode="${SET_CODE}", got "${setPayload.setCode}"`);
  hasObj(setPayload, "paging");
  hasArray(setPayload, "items");
  if (setPayload.items.length < 1) die("Set payload items is empty");

  const concept0 = setPayload.items[0];
  hasString(concept0, "conceptKey");
  hasString(concept0, "setCode");
  hasString(concept0, "type");
  hasString(concept0, "slug");
  hasString(concept0, "name");

  if (!Array.isArray(concept0.versions) || concept0.versions.length < 1) {
    die("Expected includeVersions=true to return non-empty versions[] on first concept");
  }

  checkVersionV1(concept0.versions[0]);
  ok("Set endpoint: first version matches CardViewModelV1 required surface");

  // 2) Concept drilldown endpoint (includes versions)
  const conceptKey = concept0.conceptKey;
  const conceptUrl = `${BASE_URL}/catalog/concepts/${encodeURIComponent(conceptKey)}?includeVersions=true&limit=1&offset=0`;
  const conceptPayload = await getJson(conceptUrl);

  if (!isObj(conceptPayload)) die("Concept payload not an object");
  hasObj(conceptPayload, "concept");
  hasString(conceptPayload.concept, "conceptKey");
  if (conceptPayload.concept.conceptKey !== conceptKey) {
    die(`Concept drilldown returned different conceptKey. expected="${conceptKey}" got="${conceptPayload.concept.conceptKey}"`);
  }

  if (!isObj(conceptPayload.versions)) die("Expected versions object on concept payload (includeVersions=true)");
  hasObj(conceptPayload.versions, "paging");
  hasArray(conceptPayload.versions, "items");
  if (conceptPayload.versions.items.length < 1) die("Concept payload versions.items is empty");

  checkVersionV1(conceptPayload.versions.items[0]);
  ok("Concept drilldown: first version matches CardViewModelV1 required surface");

  console.log("\n=== LFBO Phase 8H — CardViewModelV1 Freeze ===\n\nPASS");
}

main().catch((e) => die(String(e)));
