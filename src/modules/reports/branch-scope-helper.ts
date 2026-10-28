/**
 * Intersects the branch ids a report client asked for with the branch ids
 * that tenant is authorized to see (`accessibleBranchIds()`,
 * src/infra/branch-scope.ts). The client-supplied list is NEVER trusted to
 * widen scope on its own - every report in this module routes its
 * client-supplied `branch_id` through this function before using it in a
 * Prisma `where`.
 *
 * - `scope === null` means the caller is owner/admin (no restriction): the
 *   requested ids are used as-is (or `null` = no filter at all, meaning
 *   "every branch in the organization", if the client sent none).
 * - `scope` is an array for a restricted caller: the result is always a
 *   subset of `scope`. A requested id outside `scope` is silently dropped
 *   rather than erroring, mirroring how `/dashboard/consolidated` already
 *   handles an out-of-scope `branch_id` (block 3) - the response just omits
 *   it instead of leaking a 403/404 that would confirm whether that branch
 *   id exists at all.
 * - If the client asked for zero branches and the caller is restricted,
 *   the full accessible set is used (same default as every other scoped
 *   endpoint in this codebase).
 */
export function resolveScopedBranchIds(scope: string[] | null, requested: string[] | undefined): string[] | null {
  if (scope === null) return requested && requested.length ? requested : null;
  if (!requested || !requested.length) return scope;
  const allowed = new Set(scope);
  return requested.filter((id) => allowed.has(id));
}
