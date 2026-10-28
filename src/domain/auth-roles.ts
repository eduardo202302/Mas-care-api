import { createAccessControl } from 'better-auth/plugins/access';
import { defaultStatements, adminAc, ownerAc } from 'better-auth/plugins/organization/access';

const statement = { ...defaultStatements, branches: ['read', 'write'], patients: ['read', 'write'], audit: ['read'] } as const;
export const accessControl = createAccessControl(statement);
const owner = accessControl.newRole({ ...ownerAc.statements, branches: ['read', 'write'], patients: ['read', 'write'], audit: ['read'] });
const admin = accessControl.newRole({ ...adminAc.statements, branches: ['read', 'write'], patients: ['read', 'write'], audit: ['read'] });
const pharmacist = accessControl.newRole({ branches: ['read'], patients: ['read', 'write'], audit: [] });
const operator = accessControl.newRole({ branches: ['read'], patients: ['read', 'write'], audit: [] });
const readOnly = accessControl.newRole({ branches: ['read'], patients: ['read'], audit: [] });
export const organizationRoles = { owner, admin, pharmacist, operator, read_only: readOnly };
