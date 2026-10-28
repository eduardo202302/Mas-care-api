# Phase 2 board performance

Generated: 2026-10-27T15:58:37.054Z

- Environment: local PostgreSQL
- Seed: 5000 open cycles across 3 performance branches (see `scripts/seed-perf.ts`)
- Endpoint: `GET /api/v1/board` (5 columns + counts + 30 cards each)
- Runs per scenario: 30

| scenario | p50 (ms) | p95 (ms) | max (ms) |
| --- | ---: | ---: | ---: |
| branch filter (`branch_id=cmvqvdnc60001kvo8yuqqv3sc`) | 51 | 59 | 68 |
| no filters (whole organization) | 59 | 68 | 120 |

Target: p95 < 300 ms with and without filters. Result: **PASS**.

## EXPLAIN (ANALYZE, BUFFERS): branch filter

```text
Limit  (cost=3.35..62.13 rows=30 width=53) (actual time=3.915..3.918 rows=30 loops=1)
  Buffers: shared hit=1384
  ->  Incremental Sort  (cost=3.35..820.46 rows=417 width=53) (actual time=3.914..3.916 rows=30 loops=1)
        Sort Key: rc.status, rc.board_position, rc.expected_on, rc.id
        Presorted Key: rc.status, rc.board_position
        Full-sort Groups: 1  Sort Method: top-N heapsort  Average Memory: 28kB  Peak Memory: 28kB
        Pre-sorted Groups: 1  Sort Method: top-N heapsort  Average Memory: 27kB  Peak Memory: 27kB
        Buffers: shared hit=1384
        ->  Result  (cost=0.57..806.11 rows=417 width=53) (actual time=0.034..3.531 rows=417 loops=1)
              One-Time Filter: (current_setting('app.organization_id'::text, true) = 'KRabWBAWZiwQ25aUEInT997rFrd2PzGL'::text)
              Buffers: shared hit=1384
              ->  Nested Loop  (cost=0.57..806.11 rows=417 width=53) (actual time=0.032..3.491 rows=417 loops=1)
                    Buffers: shared hit=1384
                    ->  Index Scan using refill_cycles_organization_id_branch_id_status_board_position_i on refill_cycles rc  (cost=0.28..379.79 rows=417 width=123) (actual time=0.018..0.721 rows=417 loops=1)
                          Index Cond: ((organization_id = 'KRabWBAWZiwQ25aUEInT997rFrd2PzGL'::text) AND (branch_id = 'cmvqvdnc60001kvo8yuqqv3sc'::text))
                          Filter: ((closed_at IS NULL) AND (status = 'to_notify'::"RefillCycleStatus"))
                          Rows Removed by Filter: 1250
                          Buffers: shared hit=549
                    ->  Index Only Scan using treatments_organization_id_id_key on treatments t  (cost=0.28..1.01 rows=1 width=70) (actual time=0.006..0.006 rows=1 loops=417)
                          Index Cond: ((organization_id = 'KRabWBAWZiwQ25aUEInT997rFrd2PzGL'::text) AND (id = rc.treatment_id))
                          Heap Fetches: 0
                          Buffers: shared hit=835
Planning:
  Buffers: shared hit=20
Planning Time: 0.610 ms
Execution Time: 3.946 ms
```

## EXPLAIN (ANALYZE, BUFFERS): no filters

```text
Limit  (cost=243.92..244.00 rows=30 width=53) (actual time=1.351..1.354 rows=30 loops=1)
  Buffers: shared hit=132
  ->  Sort  (cost=243.92..247.05 rows=1250 width=53) (actual time=1.350..1.353 rows=30 loops=1)
        Sort Key: status, board_position, expected_on, id
        Sort Method: top-N heapsort  Memory: 28kB
        Buffers: shared hit=132
        ->  Result  (cost=0.01..207.00 rows=1250 width=53) (actual time=0.010..0.868 rows=1250 loops=1)
              One-Time Filter: (current_setting('app.organization_id'::text, true) = 'KRabWBAWZiwQ25aUEInT997rFrd2PzGL'::text)
              Buffers: shared hit=132
              ->  Seq Scan on refill_cycles rc  (cost=0.01..207.00 rows=1250 width=53) (actual time=0.007..0.791 rows=1250 loops=1)
                    Filter: ((closed_at IS NULL) AND (organization_id = 'KRabWBAWZiwQ25aUEInT997rFrd2PzGL'::text) AND (status = 'to_notify'::"RefillCycleStatus"))
                    Rows Removed by Filter: 3750
                    Buffers: shared hit=132
Planning Time: 0.152 ms
Execution Time: 1.369 ms
```
