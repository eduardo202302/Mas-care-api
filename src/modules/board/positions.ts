import { insertionIndex, positionsAfterInsert, spreadPositions, type NeighbourInput } from '../../domain/boardOrder.js';

export type PositionedRow = { id: string; boardPosition: number | null };

export type InsertionResult =
  | { error: 'INVALID_NEIGHBOUR' }
  | {
    position: number;
    rebalanced: boolean;
    /** New positions for the cards already in the column (the moved card excluded). */
    assignments: Array<{ id: string; position: number }>;
  };

/**
 * Resolves where a dragged card lands inside its target column.
 *
 * A column is either fully manual (every card has a position) or default
 * ordered (expected_on for cycles, created_at for incidents). Mixing both
 * would silently push every unpositioned card after the manual ones, so the
 * first drag into a half-positioned column rebalances that column and
 * preserves the order the user is seeing.
 */
export function resolveInsertion(
  cards: readonly PositionedRow[],
  afterId?: string | null,
  beforeId?: string | null,
): InsertionResult {
  const neighbours: NeighbourInput[] = cards.map((card) => ({ id: card.id, position: card.boardPosition }));
  const index = insertionIndex(neighbours, afterId, beforeId);
  if ('error' in index) return index;

  if (cards.some((card) => card.boardPosition == null)) {
    const positions = spreadPositions(cards.length + 1);
    return {
      position: positions[index.index]!,
      rebalanced: true,
      assignments: cards.map((card, cardIndex) => ({
        id: card.id,
        // The moved card is not in `cards`; indices after it shift by one.
        position: positions[cardIndex < index.index ? cardIndex : cardIndex + 1]!,
      })),
    };
  }

  const { positions, rebalanced } = positionsAfterInsert(neighbours, index.index);
  return {
    position: positions[index.index]!,
    rebalanced,
    assignments: cards.map((card, cardIndex) => ({
      id: card.id,
      // The moved card is not in `cards`; indices after it shift by one.
      position: positions[cardIndex < index.index ? cardIndex : cardIndex + 1]!,
    })),
  };
}
