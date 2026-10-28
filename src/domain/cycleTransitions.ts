/**
 * Pure rules for dragging refill cycles across the board.
 *
 * Only the four operational states are draggable. Closing a cycle
 * (delivered, not_picked_up, cancelled) always happens through its own
 * endpoint, never by a board move. No database or Express imports here.
 */

export const refillCycleStatuses = [
  'to_notify',
  'notified',
  'confirmed',
  'prepared',
  'delivered',
  'not_picked_up',
  'cancelled',
] as const;
export type RefillCycleStatus = (typeof refillCycleStatuses)[number];

/** States the board can move a cycle into. */
export const movableCycleStatuses = ['to_notify', 'notified', 'confirmed', 'prepared'] as const;
export type MovableCycleStatus = (typeof movableCycleStatuses)[number];

/** States that are final: no drag, only explicit operations. */
export const closedCycleStatuses = ['delivered', 'not_picked_up', 'cancelled'] as const;
export type ClosedCycleStatus = (typeof closedCycleStatuses)[number];

/** Board columns, in display order. `closed` groups the two pickup outcomes. */
export const boardColumns = ['to_notify', 'notified', 'confirmed', 'prepared', 'closed'] as const;
export type BoardColumn = (typeof boardColumns)[number];

export const boardColumnLabels: Record<BoardColumn, string> = {
  to_notify: 'Por avisar',
  notified: 'Avisado',
  confirmed: 'Confirmado',
  prepared: 'Preparado',
  closed: 'Cerrado',
};

export type CycleMoveErrorCode = 'CYCLE_CLOSED' | 'INVALID_TARGET_STATUS' | 'INVALID_CURRENT_STATUS';

export type CycleMoveValidation =
  | { ok: true; from: RefillCycleStatus; to: MovableCycleStatus }
  | { ok: false; code: CycleMoveErrorCode; status: 400 | 409; message: string };

export function isRefillCycleStatus(value: string): value is RefillCycleStatus {
  return (refillCycleStatuses as readonly string[]).includes(value);
}

export function isMovableCycleStatus(value: string): value is MovableCycleStatus {
  return (movableCycleStatuses as readonly string[]).includes(value);
}

export function isClosedCycleStatus(value: string): value is ClosedCycleStatus {
  return (closedCycleStatuses as readonly string[]).includes(value);
}

/** A cycle is closed when its status is final; closedAt is the persisted marker. */
export function isCycleClosed(status: RefillCycleStatus, closedAt?: Date | null): boolean {
  return closedAt != null || isClosedCycleStatus(status);
}

/**
 * Validates a drag move. Advancing, going back and skipping steps are all
 * allowed; only closed cycles and non-operational targets are rejected.
 */
export function validateCycleMove(from: RefillCycleStatus, to: string): CycleMoveValidation {
  if (isClosedCycleStatus(from)) {
    return {
      ok: false,
      code: 'CYCLE_CLOSED',
      status: 409,
      message: 'Closed cycles cannot be moved',
    };
  }
  if (!isMovableCycleStatus(from)) {
    return {
      ok: false,
      code: 'INVALID_CURRENT_STATUS',
      status: 409,
      message: 'The current cycle status cannot be moved',
    };
  }
  if (!isMovableCycleStatus(to)) {
    return {
      ok: false,
      code: 'INVALID_TARGET_STATUS',
      status: 400,
      message: 'to_status must be one of to_notify, notified, confirmed, prepared',
    };
  }
  return { ok: true, from, to };
}

/** Convenience boolean wrapper used by the UI and tests. */
export function canMoveCycle(from: RefillCycleStatus, to: string): boolean {
  return validateCycleMove(from, to).ok;
}

/** Whether dragging from one status to another requires a stock check. */
export function requiresStockCheck(to: string): to is 'prepared' {
  return to === 'prepared';
}

/** Moving to notified from to_notify only changes state; it never sends a message. */
export function isSilentNoticeMove(from: RefillCycleStatus, to: string): boolean {
  return from === 'to_notify' && to === 'notified';
}
