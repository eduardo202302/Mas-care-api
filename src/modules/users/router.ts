import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { puede } from '../../domain/permissions.js';
import { ApiError } from '../../infra/errors.js';
import { paginate } from '../../infra/pagination.js';
import { auth } from '../../infra/auth.js';
import { prisma, withTenant } from '../../infra/prisma.js';
import { resolveTenant } from '../../infra/tenant.js';
import { record } from '../audit/record.js';
import { userCreate, userListQuery, userParams, userPatch } from '../../schemas/user.js';
import { createPin, decryptPin } from '../../infra/pin-crypto.js';
import { resolveAssignableRole } from '../roles/system-roles.js';

export const usersRouter = Router();
usersRouter.use(resolveTenant);

usersRouter.post('/', async (req, res, next) => {
  try {
    const tenant = req.tenant!;
    if (!puede(tenant.role, 'users:write')) throw new ApiError(403, 'FORBIDDEN', 'Insufficient permissions');
    const input = userCreate.parse(req.body);

    const existing = await prisma.user.findUnique({ where: { email: input.email } });
    if (existing) {
      throw new ApiError(409, 'EMAIL_IN_USE', 'Ya existe una cuenta con este correo.', {
        email: 'Ya existe una cuenta con este correo.',
      });
    }

    const usernameTaken = await prisma.user.findUnique({ where: { username: input.username }, select: { id: true } });
    if (usernameTaken) {
      throw new ApiError(409, 'USERNAME_IN_USE', 'Ya existe un usuario con ese nombre.', {
        username: 'Ya existe un usuario con ese nombre.',
      });
    }

    const signup = await auth.api.signUpEmail({
      body: { name: input.name, email: input.email, password: input.password },
    }).catch(() => {
      throw new ApiError(400, 'USER_CREATE_FAILED', 'No pudimos crear la cuenta con estos datos.');
    });
    const user = signup.user;
    const recoveryPin = createPin(input.pin);
    const pinUpdatedAt = new Date();

    await prisma.user.update({
      where: { id: user.id },
      data: {
        username: input.username,
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
        emailVerified: true,
        passwordPinEncrypted: recoveryPin.encrypted,
        passwordPinUpdatedAt: pinUpdatedAt,
      },
    });
    await prisma.session.deleteMany({ where: { userId: user.id } });

    const created = await withTenant(tenant.organizationId, async (tx) => {
      const assigned = input.roleId ? await resolveAssignableRole(tx, input.roleId) : null;
      const baseRole = assigned?.baseRole ?? input.role;
      if (!baseRole) {
        throw new ApiError(400, 'ROLE_REQUIRED', 'Selecciona un rol.', { roleId: 'Selecciona un rol.' });
      }
      const branchIds = [...new Set(input.branchIds)];
      const branches = branchIds.length
        ? await tx.branch.findMany({
            where: { id: { in: branchIds }, archivedAt: null },
            select: { id: true, name: true },
          })
        : [];
      if (branches.length !== branchIds.length) {
        throw new ApiError(400, 'INVALID_BRANCH', 'Alguna sucursal no pertenece a la organización.', {
          branchIds: 'Selecciona sucursales activas de esta organización.',
        });
      }
      if (baseRole !== 'admin' && branches.length === 0) {
        throw new ApiError(400, 'BRANCH_REQUIRED', 'Asigna al menos una sucursal.', {
          branchIds: 'Asigna al menos una sucursal.',
        });
      }

      const member = await tx.member.create({
        data: {
          id: crypto.randomUUID(),
          organizationId: tenant.organizationId,
          userId: user.id,
          role: baseRole,
          roleId: assigned?.customId ?? null,
          createdAt: new Date(),
        },
      });
      if (branches.length) {
        await tx.branchMember.createMany({
          data: branches.map((branch) => ({
            organizationId: tenant.organizationId,
            branchId: branch.id,
            userId: user.id,
          })),
        });
      }
      await record(tx, {
        organizationId: tenant.organizationId,
        actorId: tenant.userId,
        action: 'user.create',
        subjectId: user.id,
      });
      return { member, branches, baseRole };
    }).catch(async (error) => {
      await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
      throw error;
    });

    res.status(201).json({
      id: user.id,
      name: user.name,
      email: user.email,
      username: input.username,
      phone: input.phone ?? null,
      createdAt: user.createdAt,
      role: created.baseRole,
      roleId: created.member.roleId,
      memberSince: created.member.createdAt,
      branches: created.branches,
      pin: recoveryPin.pin,
      pinUpdatedAt,
    });
  } catch (error) { next(error); }
});

usersRouter.get('/', async (req, res, next) => {
  try {
    const tenant = req.tenant!;
    if (!puede(tenant.role, 'patients:read')) throw new ApiError(403, 'FORBIDDEN', 'Insufficient permissions');
    const query = userListQuery.parse(req.query);
    const users = await withTenant(tenant.organizationId, async (tx) => {
      const where: Prisma.MemberWhereInput = {
        organizationId: tenant.organizationId,
        ...(query.q ? { user: { is: { OR: [
          { name: { contains: query.q, mode: 'insensitive' } },
          { email: { contains: query.q, mode: 'insensitive' } },
          { username: { contains: query.q, mode: 'insensitive' } },
        ] } } } : {}),
      };
      const result = await paginate(query, (args) => tx.member.findMany({
        where,
        select: {
          id: true,
          role: true,
          roleId: true,
          roleRef: { select: { name: true } },
          createdAt: true,
          user: {
            select: {
              id: true, name: true, username: true, email: true, phone: true, createdAt: true,
              branchMemberships: {
                where: { organizationId: tenant.organizationId },
                select: { branch: { select: { id: true, name: true } } },
              },
            },
          },
        },
        orderBy: [{ user: { name: 'asc' } }, { user: { id: 'asc' } }],
        take: args.take,
        skip: args.skip,
        ...(args.cursor ? { cursor: { id: args.cursor } } : {}),
      }), () => tx.member.count({ where }));
      const rows = result.data.map(({ user, role, roleId, roleRef, createdAt }) => ({
        id: user.id,
        name: user.name,
        username: user.username,
        email: user.email,
        phone: user.phone,
        createdAt: user.createdAt,
        role,
        roleId,
        roleName: roleRef?.name ?? null,
        memberSince: createdAt,
        branches: user.branchMemberships.map(({ branch }) => branch),
      }));
      return { ...result, data: rows };
    });
    res.json(users);
  } catch (error) { next(error); }
});

usersRouter.get('/:id', async (req, res, next) => {
  try {
    const tenant = req.tenant!;
    if (!puede(tenant.role, 'patients:read')) throw new ApiError(403, 'FORBIDDEN', 'Insufficient permissions');
    const { id } = userParams.parse(req.params);
    const user = await withTenant(tenant.organizationId, async (tx) => {
      const member = await tx.member.findFirst({
        where: { organizationId: tenant.organizationId, userId: id },
        select: {
          role: true,
          roleId: true,
          roleRef: { select: { name: true } },
          createdAt: true,
          user: {
            select: {
              id: true, name: true, username: true, email: true, phone: true, createdAt: true,
              passwordPinEncrypted: true, passwordPinUpdatedAt: true,
              branchMemberships: {
                where: { organizationId: tenant.organizationId },
                select: { branch: { select: { id: true, name: true } } },
              },
            },
          },
        },
      });
      if (!member) return null;
      const canViewPin =
        puede(tenant.role, 'users:write') || tenant.userId === member.user.id;
      const pin = canViewPin && member.user.passwordPinEncrypted
        ? decryptPin(member.user.passwordPinEncrypted)
        : null;
      return {
        id: member.user.id,
        name: member.user.name,
        email: member.user.email,
        username: member.user.username,
        phone: member.user.phone,
        createdAt: member.user.createdAt,
        role: member.role,
        roleId: member.roleId,
        roleName: member.roleRef?.name ?? null,
        memberSince: member.createdAt,
        branches: member.user.branchMemberships.map(({ branch }) => branch),
        ...(canViewPin
          ? {
              pin,
              pinUpdatedAt: member.user.passwordPinUpdatedAt,
            }
          : {}),
      };
    });
    if (!user) throw new ApiError(404, 'USER_NOT_FOUND', 'User not found in this organization');
    res.json(user);
  } catch (error) { next(error); }
});

usersRouter.patch('/:id', async (req, res, next) => {
  try {
    const tenant = req.tenant!;
    if (!puede(tenant.role, 'users:write')) throw new ApiError(403, 'FORBIDDEN', 'Insufficient permissions');
    const { id } = userParams.parse(req.params);
    const input = userPatch.parse(req.body);
    if (Object.keys(input).length === 0) {
      throw new ApiError(400, 'EMPTY_UPDATE', 'Envía al menos un campo para actualizar.');
    }

    const member = await prisma.member.findFirst({
      where: { organizationId: tenant.organizationId, userId: id },
      select: { id: true, role: true },
    });
    if (!member) throw new ApiError(404, 'USER_NOT_FOUND', 'User not found in this organization');
    if ((input.role !== undefined || input.roleId !== undefined) && member.role === 'owner') {
      throw new ApiError(400, 'OWNER_ROLE_LOCKED', 'No se puede cambiar el rol del propietario.', {
        role: 'No se puede cambiar el rol del propietario.',
      });
    }
    if (input.email !== undefined) {
      const taken = await prisma.user.findFirst({
        where: { email: input.email, NOT: { id } },
        select: { id: true },
      });
      if (taken) {
        throw new ApiError(409, 'EMAIL_IN_USE', 'Ya existe una cuenta con este correo.', {
          email: 'Ya existe una cuenta con este correo.',
        });
      }
    }

    if (input.username !== undefined) {
      const usernameTaken = await prisma.user.findFirst({
        where: { username: input.username, NOT: { id } },
        select: { id: true },
      });
      if (usernameTaken) {
        throw new ApiError(409, 'USERNAME_IN_USE', 'Ya existe un usuario con ese nombre.', {
          username: 'Ya existe un usuario con ese nombre.',
        });
      }
    }

    await withTenant(tenant.organizationId, async (tx) => {
      const assigned = input.roleId ? await resolveAssignableRole(tx, input.roleId) : null;
      const nextRole = assigned?.baseRole ?? input.role;
      const effectiveRole = nextRole ?? member.role;
      if (input.branchIds !== undefined) {
        const branchIds = [...new Set(input.branchIds)];
        const branches = branchIds.length
          ? await tx.branch.findMany({
              where: { id: { in: branchIds }, archivedAt: null },
              select: { id: true },
            })
          : [];
        if (branches.length !== branchIds.length) {
          throw new ApiError(400, 'INVALID_BRANCH', 'Alguna sucursal no pertenece a la organización.', {
            branchIds: 'Selecciona sucursales activas de esta organización.',
          });
        }
        if (effectiveRole !== 'admin' && effectiveRole !== 'owner' && branches.length === 0) {
          throw new ApiError(400, 'BRANCH_REQUIRED', 'Asigna al menos una sucursal.', {
            branchIds: 'Asigna al menos una sucursal.',
          });
        }
        await tx.branchMember.deleteMany({ where: { organizationId: tenant.organizationId, userId: id } });
        if (branches.length) {
          await tx.branchMember.createMany({
            data: branches.map((branch) => ({
              organizationId: tenant.organizationId,
              branchId: branch.id,
              userId: id,
            })),
          });
        }
      }
      if (nextRole !== undefined || input.roleId !== undefined) {
        await tx.member.update({
          where: { id: member.id },
          data: {
            ...(nextRole !== undefined ? { role: nextRole } : {}),
            ...(input.roleId !== undefined ? { roleId: assigned?.customId ?? null } : {}),
          },
        });
      }
      await record(tx, {
        organizationId: tenant.organizationId,
        actorId: tenant.userId,
        action: 'user.update',
        subjectId: id,
      });
    });

    if (
      input.name !== undefined ||
      input.email !== undefined ||
      input.username !== undefined ||
      input.phone !== undefined
    ) {
      await prisma.user.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.email !== undefined ? { email: input.email } : {}),
          ...(input.username !== undefined ? { username: input.username } : {}),
          ...(input.phone !== undefined ? { phone: input.phone } : {}),
        },
      });
    }

    const updated = await withTenant(tenant.organizationId, (tx) =>
      tx.member.findFirstOrThrow({
        where: { organizationId: tenant.organizationId, userId: id },
        select: {
          role: true,
          roleId: true,
          roleRef: { select: { name: true } },
          createdAt: true,
          user: {
            select: {
              id: true, name: true, username: true, email: true, phone: true, createdAt: true,
              branchMemberships: {
                where: { organizationId: tenant.organizationId },
                select: { branch: { select: { id: true, name: true } } },
              },
            },
          },
        },
      }),
    );
    res.json({
      id: updated.user.id,
      name: updated.user.name,
      email: updated.user.email,
      username: updated.user.username,
      phone: updated.user.phone,
      createdAt: updated.user.createdAt,
      role: updated.role,
      roleId: updated.roleId,
      roleName: updated.roleRef?.name ?? null,
      memberSince: updated.createdAt,
      branches: updated.user.branchMemberships.map(({ branch }) => branch),
    });
  } catch (error) { next(error); }
});

usersRouter.post('/:id/pin', async (req, res, next) => {
  try {
    const tenant = req.tenant!;
    if (!puede(tenant.role, 'users:write')) throw new ApiError(403, 'FORBIDDEN', 'Insufficient permissions');
    const { id } = userParams.parse(req.params);
    const member = await prisma.member.findFirst({
      where: { organizationId: tenant.organizationId, userId: id },
      select: { id: true },
    });
    if (!member) throw new ApiError(404, 'USER_NOT_FOUND', 'User not found in this organization');

    const recoveryPin = createPin();
    const pinUpdatedAt = new Date();
    await prisma.user.update({
      where: { id },
      data: {
        passwordPinEncrypted: recoveryPin.encrypted,
        passwordPinAttempts: 0,
        passwordPinLockedAt: null,
        passwordPinUpdatedAt: pinUpdatedAt,
      },
    });
    await withTenant(tenant.organizationId, (tx) =>
      record(tx, {
        organizationId: tenant.organizationId,
        actorId: tenant.userId,
        action: 'user.pin.regenerate',
        subjectId: id,
      }),
    );

    res.json({ pin: recoveryPin.pin, pinUpdatedAt });
  } catch (error) { next(error); }
});
