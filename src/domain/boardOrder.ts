/**
 * Pure fractional indexing for board columns (cycles and incidents).
 *
 * A NULL position means "not manually ordered yet": those cards sort by their
 * natural key (expected_on for cycles, created_at for incidents). Once a card
 * is dragged, the whole target column gets concrete positions with gaps of 1.
 */

/** Minimum distance between two neighbours before the column is rebalanced. */
export const POSITION_EPSILON = 1e-6;
/** Gap assigned to each card when a column is rebalanced. */
export const POSITION_STEP = 1;

export function needsRebalance(previous: number | null | undefined, next: number | null | undefined): boolean {
  if (previous == null && next == null) return true;
  if (previous == null || next == null) return false;
  return Math.abs(next - previous) < POSITION_EPSILON;
}

/** Midpoint between two neighbours; open ends extend by one step. */
export function positionBetween(previous: number | null | undefined, next: number | null | undefined): number {
  if (previous == null && next == null) return POSITION_STEP;
  if (previous == null) return next! - POSITION_STEP;
  if (next == null) return previous + POSITION_STEP;
  return previous + (next - previous) / 2;
}

/** Evenly spaced positions for `count` cards, in visible order. */
export function spreadPositions(count: number): number[] {
  return Array.from({ length: Math.max(count, 0) }, (_, index) => (index + 1) * POSITION_STEP);
}

export type NeighbourInput = { id: string; position: number | null };

/**
 * Resolves the insertion index for a move inside a column.
 * `afterId` is the card that must precede the moved card and `beforeId` the
 * one that must follow it. Either may be omitted by the client.
 */
export function insertionIndex(
  cards: readonly NeighbourInput[],
  afterId?: string | null,
  beforeId?: string | null,
): { index: number } | { error: 'INVALID_NEIGHBOUR' } {
  const after = afterId ? cards.findIndex((card) => card.id === afterId) : -1;
  const before = beforeId ? cards.findIndex((card) => card.id === beforeId) : -1;
  if (afterId && after < 0) return { error: 'INVALID_NEIGHBOUR' };
  if (beforeId && before < 0) return { error: 'INVALID_NEIGHBOUR' };
  if (after >= 0 && before >= 0) {
    if (before === after + 1) return { index: after + 1 };
    return { error: 'INVALID_NEIGHBOUR' };
  }
  if (after >= 0) return { index: after + 1 };
  if (before >= 0) return { index: before };
  return { index: cards.length };
}

/** Builds the new ordered position list after inserting at `index`. */
export function positionsAfterInsert(
  cards: readonly NeighbourInput[],
  index: number,
): { positions: number[]; rebalanced: boolean } {
  const previous = index > 0 ? cards[index - 1]!.position : null;
  const next = index < cards.length ? cards[index]!.position : null;
  if (needsRebalance(previous, next)) {
    return { positions: spreadPositions(cards.length + 1), rebalanced: true };
  }
  const position = positionBetween(previous, next);
  const positions = cards.map((card) => card.position ?? 0);
  positions.splice(index, 0, position);
  return { positions, rebalanced: false };
}
