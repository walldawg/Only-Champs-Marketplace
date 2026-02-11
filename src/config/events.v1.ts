// CONFIG-ONLY: Event Authority v1 fixtures.
// No schema. No routes. No DB writes.
// Event authority must remain EVENT_ONLY.

export type EventStatus = "DRAFT" | "OPEN" | "LIVE" | "CLOSED" | "ARCHIVED";
export type EnforcementLevel = "ADVISORY" | "STRICT";

export type EventV1 = {
  eventId: string;
  name: string;
  status: EventStatus;
  formatRef?: string;
  enforcementLevel: EnforcementLevel;
  validatorProfileRef: string;
  authorityScope: "EVENT_ONLY";
  submissionOpenAt?: string;
  submissionCloseAt?: string;
  // Human-owned kill switch (conceptual). When true, STRICT behaves like ADVISORY for consequences.
  killSwitchActive?: boolean;
};

const EVENTS: Record<string, EventV1> = {
  EVT_ADVISORY_TEST: {
    eventId: "EVT_ADVISORY_TEST",
    name: "Advisory Test Event",
    status: "OPEN",
    formatRef: "FORMAT_TEST_DEFAULT",
    enforcementLevel: "ADVISORY",
    validatorProfileRef: "VALIDATOR_PROFILE_DEFAULT",
    authorityScope: "EVENT_ONLY",
    killSwitchActive: false,
  },
  EVT_STRICT_TEST: {
    eventId: "EVT_STRICT_TEST",
    name: "Strict Test Event",
    status: "OPEN",
    formatRef: "FORMAT_TEST_DEFAULT",
    enforcementLevel: "STRICT",
    validatorProfileRef: "VALIDATOR_PROFILE_DEFAULT",
    authorityScope: "EVENT_ONLY",
    killSwitchActive: false,
  },
  EVT_STRICT_KILL_TEST: {
    eventId: "EVT_STRICT_KILL_TEST",
    name: "Strict (Kill Switch Active) Test Event",
    status: "OPEN",
    formatRef: "FORMAT_TEST_DEFAULT",
    enforcementLevel: "STRICT",
    validatorProfileRef: "VALIDATOR_PROFILE_DEFAULT",
    authorityScope: "EVENT_ONLY",
    killSwitchActive: true,
  },

  // Queue gating fixtures (must be LIVE)
  EVT_QUEUE_ADVISORY_TEST: {
    eventId: "EVT_QUEUE_ADVISORY_TEST",
    name: "Queue Advisory Test Event",
    status: "LIVE",
    formatRef: "FORMAT_TEST_DEFAULT",
    enforcementLevel: "ADVISORY",
    validatorProfileRef: "VALIDATOR_PROFILE_DEFAULT",
    authorityScope: "EVENT_ONLY",
    killSwitchActive: false,
  },
  EVT_QUEUE_STRICT_TEST: {
    eventId: "EVT_QUEUE_STRICT_TEST",
    name: "Queue Strict Test Event",
    status: "LIVE",
    formatRef: "FORMAT_TEST_DEFAULT",
    enforcementLevel: "STRICT",
    validatorProfileRef: "VALIDATOR_PROFILE_DEFAULT",
    authorityScope: "EVENT_ONLY",
    killSwitchActive: false,
  },
};

export function getEventById_V1(eventId: string): EventV1 | null {
  return EVENTS[eventId] ?? null;
}

export function listEvents_V1(): EventV1[] {
  return Object.values(EVENTS);
}
