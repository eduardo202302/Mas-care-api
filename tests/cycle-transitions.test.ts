import { describe, expect, it } from 'vitest';
import {
  canMoveCycle, isCycleClosed, isSilentNoticeMove, movableCycleStatuses,
  validateCycleMove,
} from '../src/domain/cycleTransitions.js';
import {
  insertionIndex, needsRebalance, positionBetween, positionsAfterInsert,
  spreadPositions,
} from '../src/domain/boardOrder.js';
import { resolveInsertion } from '../src/modules/board/positions.js';

describe('cycle transitions', () => {
  it('advances, goes back and skips steps between operational states', () => {
    for (const from of movableCycleStatuses) {
      for (const to of movableCycleStatuses) {
        expect(canMoveCycle(from, to)).toBe(true);
      }
    }
    expect(validateCycleMove('to_notify', 'confirmed')).toMatchObject({ ok: true, from: 'to_notify', to: 'confirmed' });
    expect(validateCycleMove('prepared', 'to_notify')).toMatchObject({ ok: true, to: 'to_notify' });
  });

  it('rejects dragging into delivered, not_picked_up or cancelled', () => {
    for (const to of ['delivered', 'not_picked_up', 'cancelled', 'unknown']) {
      const result = validateCycleMove('confirmed', to);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('INVALID_TARGET_STATUS');
        expect(result.status).toBe(400);
      }
    }
  });

  it('rejects moving a closed cycle', () => {
    for (const from of ['delivered', 'not_picked_up', 'cancelled'] as const) {
      const result = validateCycleMove(from, 'prepared');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('CYCLE_CLOSED');
        expect(result.status).toBe(409);
      }
      expect(isCycleClosed(from)).toBe(true);
      expect(isCycleClosed('prepared')).toBe(false);
      expect(isCycleClosed('prepared', new Date())).toBe(true);
    }
  });

  it('moving from to_notify to notified does not send a message', () => {
    expect(isSilentNoticeMove('to_notify', 'notified')).toBe(true);
    expect(isSilentNoticeMove('notified', 'confirmed')).toBe(false);
  });
});

describe('fractional board ordering', () => {
  it('uses the midpoint between two cards', () => {
    expect(positionBetween(1, 3)).toBe(2);
    expect(positionBetween(null, 5)).toBe(4);
    expect(positionBetween(10, null)).toBe(11);
  });

  it('asks for a rebalance when the gap collapses or a neighbour has no position', () => {
    expect(needsRebalance(1, 1)).toBe(true);
    expect(needsRebalance(1, 1.0000000001)).toBe(true);
    expect(needsRebalance(1, 2)).toBe(false);
    expect(needsRebalance(null, 2)).toBe(false);
    expect(needsRebalance(null, null)).toBe(true);
  });

  it('finds the insertion index after, before or between two cards', () => {
    const cards = [{ id: 'a', position: 1 }, { id: 'b', position: 2 }, { id: 'c', position: 3 }];
    expect(insertionIndex(cards, 'a')).toEqual({ index: 1 });
    expect(insertionIndex(cards, null, 'c')).toEqual({ index: 2 });
    expect(insertionIndex(cards, 'a', 'b')).toEqual({ index: 1 });
    expect(insertionIndex(cards, null, null)).toEqual({ index: 3 });
    expect(insertionIndex(cards, 'missing')).toEqual({ error: 'INVALID_NEIGHBOUR' });
    expect(insertionIndex(cards, 'b', 'a')).toEqual({ error: 'INVALID_NEIGHBOUR' });
  });

  it('keeps the visible order when a column is rebalanced', () => {
    const cards = [
      { id: 'a', position: 1 },
      { id: 'b', position: 1.0000000001 },
      { id: 'c', position: 2 },
    ];
    const { positions, rebalanced } = positionsAfterInsert(cards, 1);
    expect(rebalanced).toBe(true);
    expect(positions).toEqual(spreadPositions(4));
    expect(positions).toHaveLength(4);
    expect([...positions].sort((x, y) => x - y)).toEqual(positions);
  });

  it('does not rebalance when there is room between neighbours', () => {
    const cards = [{ id: 'a', position: 1 }, { id: 'b', position: 3 }];
    const { positions, rebalanced } = positionsAfterInsert(cards, 1);
    expect(rebalanced).toBe(false);
    expect(positions).toEqual([1, 2, 3]);
  });

  it('rebalances a half-positioned column without changing its visible order', () => {
    // Visible order is manual first, then cards still ordered by expected_on.
    const cards = [
      { id: 'a', boardPosition: 1 },
      { id: 'b', boardPosition: null },
      { id: 'c', boardPosition: null },
    ];
    const result = resolveInsertion(cards, 'b');
    expect(result).not.toHaveProperty('error');
    if ('error' in result) return;
    expect(result.rebalanced).toBe(true);
    expect(result.position).toBe(3);
    expect(result.assignments).toEqual([
      { id: 'a', position: 1 },
      { id: 'b', position: 2 },
      { id: 'c', position: 4 },
    ]);
  });
});
