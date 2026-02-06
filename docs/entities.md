# Canonical Entities — Only Champs Marketplace

This document defines entities and fields.
No business logic is implemented here.
This file is the contract.

---

## CardConcept
Represents the idea of a card.

Fields:
- concept_id (string, immutable)
- type (Hero | Play | HotDog)
- display_name
- name_norm
- signature
- rules_text
- base_attributes (json)
- created_at

---

## CardVersion
Represents a printed version of a concept.

Fields:
- version_id
- concept_id (FK)
- edition_id
- treatment_prefix
- treatment_name
- weapon_type (nullable)
- rarity
- scarcity_kind
- cap_value (nullable)
- serialization_required (bool)
- is_claimable (bool)
- metadata_json
- created_at

---

## CardInstance
Represents an ownable unit.

Fields:
- instance_id
- version_id (FK)
- serial_label (nullable)
- serial_number (nullable)
- serial_total (nullable)
- auth_variant (nullable)
- claim_status (pending | verified | rejected)
- created_at

---

## Ownership
Tracks ownership history.

Fields:
- ownership_id
- instance_id (FK)
- owner_user_id
- from_user_id (nullable)
- acquired_via (claim | trade | sale | admin)
- active (bool)
- timestamp

---

## Lock
Represents temporary or permanent restrictions.

Fields:
- lock_id
- instance_id (FK)
- lock_type
- scope
- expires_at (nullable)
- created_by
- created_at

---

## Listing
Marketplace listing.

Fields:
- listing_id
- instance_id (FK)
- seller_user_id
- price
- status
- created_at

---

## Trade
Peer-to-peer trade.

Fields:
- trade_id
- status
- created_at

---

## AuditLog
Required for all privileged actions.

Fields:
- audit_id
- actor_user_id
- entity_type
- entity_id
- action
- before_state (json)
- after_state (json)
- reason
- timestamp
