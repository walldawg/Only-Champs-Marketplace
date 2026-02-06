# Only Champs Marketplace — Canonical Model (Source of Truth)

This repository is the canonical authority for:
- Cards (Concept → Version → Instance)
- Ownership and transfer history
- Claim/verification of scarce physical cards
- Marketplace actions (listings, trades)
- Tournament roster exports (paid feature)
- Audit logging of all privileged changes

Gameplay systems (deck builders, simulators, future games) are READ-ONLY consumers of marketplace truth.
They never directly modify canonical marketplace data.

## Entity Hierarchy

1) CardConcept
- The idea of the card (name, rules, base identity).
- Stable over time.

2) CardVersion
- A print-specific version of a concept.
- Tied to Edition + Treatment + Rarity (+ weapon/theme where applicable).
- Carries scarcity policy (known cap / unknown cap / 1-of-1 / secret 1-of-1).

3) CardInstance
- A specific ownable unit created ONLY when claimed.
- Used for verified ownership, trading, selling, and tournament rosters.

## Scarcity Policy (No Guessing)

scarcity_kind:
- open
- capped_known (cap_value known)
- capped_unknown (limited but cap not published)
- one_of_one
- one_of_one_secret

Rules:
- No caps are inferred. Unknown caps remain unknown.
- Uniqueness is enforced through verification artifacts, not estimated print counts.

## Locks

Locks apply ONLY to CardInstance:
- listing
- trade_pending
- tournament_roster
- verification_hold

Non-scarce cards never block gameplay use.
Exclusive scarce instances affect marketplace actions and tournament legality.

## Admin Authority + Audit

Admins can correct data and override states, but ALL privileged actions must be audit-logged:
- actor
- timestamp
- before/after
- reason
