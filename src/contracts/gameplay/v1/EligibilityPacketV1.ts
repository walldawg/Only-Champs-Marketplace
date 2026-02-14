/**
 * EligibilityPacketV1 — Ownership/eligibility proof envelope for deck participation.
 *
 * Phase 11 Step 1 (types only):
 * - Bridge between Marketplace/Ownership layer and EngineAdapter.validateDeck()
 * - Engine-agnostic, JSON-safe, no Prisma types
 * - MUST NOT mutate decks; this is a proof/receipt packet only
 *
 * Design intent:
 * - Tournament/match creation can attach an EligibilityPacketV1
 * - Platform can verify ownership rules BEFORE calling validateDeck
 * - Engine can optionally validate constraints using only the provided packet data
 *
 * Non-goals (Phase 11 Step 1):
 * - Persistence schema
 * - Signature/crypto proof systems (placeholders only)
 * - Network verification
 */

import type { IdString, JSONObject } from "./MatchArtifactV1";

export const ELIGIBILITY_PACKET_VERSION = "EligibilityPacketV1" as const;

/** Eligibility decision from platform verification layer. */
export type EligibilityDecisionV1 = "ELIGIBLE" | "INELIGIBLE" | "UNKNOWN";

/** The provenance method for a card eligibility claim. */
export type EligibilityClaimKindV1 =
  | "OWNERSHIP_RECORD"     // platform DB says user owns item
  | "LISTING_LOCK"         // item locked to listing/trade state
  | "EVENT_GRANT"          // event-specific temporary grant
  | "MANUAL_OVERRIDE"      // admin override
  | "UNVERIFIED_SELF_CLAIM"; // user claim only (allowed but marked)

/** Optional signature envelope placeholder (no crypto required yet). */
export interface EligibilitySignatureV1 {
  scheme: "none" | "ed25519" | "secp256k1" | string;
  signerId?: IdString;
  signature?: string;
  signedAt?: string;
  extra?: JSONObject;
}

/** A single card eligibility claim for a specific card version and quantity. */
export interface EligibilityCardClaimV1 {
  /** Card version key used by engines. */
  cardVersionKey: string;

  /** Quantity claimed as eligible for this deck. */
  quantity: number;

  /** Why/how this claim exists. */
  claimKind: EligibilityClaimKindV1;

  /**
   * Proof references (ids only). Platform may use these to audit later.
   * Examples: ownershipId, listingId, grantId, adminDecisionId.
   */
  refs?: {
    ownershipId?: IdString;
    listingId?: IdString;
    grantId?: IdString;
    adminDecisionId?: IdString;
    externalRef?: string;
  };

  /** Optional claim metadata. */
  extra?: JSONObject;
}

/** Deck-level eligibility context. */
export interface EligibilityDeckContextV1 {
  deckId: IdString;

  /** Deck display name (optional). */
  deckName?: string;

  /** The owner/controller participant for this deck (player/team). */
  participantId: IdString;

  /** Claims for card quantities in this deck. */
  claims: EligibilityCardClaimV1[];

  /**
   * Optional deck constraints (platform-defined) passed alongside claims.
   * Example: ownedOnly=true, maxDuplicates=4, rarityCaps, etc.
   */
  constraints?: JSONObject;

  /** Optional signature (placeholder). */
  signature?: EligibilitySignatureV1;

  /** Optional audit metadata. */
  auditMeta?: JSONObject;
}

/**
 * Top-level eligibility packet used during tournament/match enrollment.
 * This is the platform's statement about eligibility at a point in time.
 */
export interface EligibilityPacketV1 {
  packetVersion: typeof ELIGIBILITY_PACKET_VERSION;

  /** Packet id for idempotency/audit. */
  eligibilityPacketId: IdString;

  /** ISO-8601 issued timestamp (platform time). */
  issuedAt: string;

  /** Optional expiry timestamp for temporary grants. */
  expiresAt?: string;

  /** Who is requesting/using this packet (optional). */
  requester?: {
    userId?: IdString;
    participantId?: IdString;
    clientId?: string;
  };

  /** The universe/mode context this packet is intended for. */
  context: {
    universeCode: string;
    modeCode?: string;
    tournamentId?: IdString;
    matchId?: IdString;
  };

  /** The deck context being verified. */
  deck: EligibilityDeckContextV1;

  /**
   * Platform verification outcome for this packet (may be UNKNOWN if not checked).
   * Engines should not treat UNKNOWN as eligible unless mode policy permits.
   */
  decision: EligibilityDecisionV1;

  /** Reasons/codes explaining the decision (platform-defined). */
  reasons?: Array<{ code: string; message?: string; extra?: JSONObject }>;

  /** Optional signature (placeholder). */
  signature?: EligibilitySignatureV1;

  /** Optional extra metadata. */
  extra?: JSONObject;
}

/**
 * Minimal bridge payload to EngineAdapter.validateDeck.
 * Engines receive only what they need: cardVersionKeys + constraints + eligibility decision.
 */
export interface EligibilityToValidateDeckBridgeV1 {
  universeCode: string;
  engineCode: string;
  engineVersion: string;
  modeCode: string;

  deckId: IdString;

  cardVersionKeys: string[];

  constraints?: JSONObject;

  /** Included so engines can enforce "owned-only" modes if desired. */
  eligibilityDecision: EligibilityDecisionV1;

  /** Optional packet id for audit. */
  eligibilityPacketId?: IdString;
}
