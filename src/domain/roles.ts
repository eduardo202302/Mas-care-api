export const roles = ['owner', 'admin', 'pharmacist', 'operator', 'read_only'] as const;
export type Role = (typeof roles)[number];
