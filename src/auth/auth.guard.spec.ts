import {
  type ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as jwt from 'jsonwebtoken';
import type { DataSource } from 'typeorm';
import { createTestDataSource } from '../../test/support/pg-mem';
import { UserEntity } from '../database/entities/user.entity';
import { MeetingAuthGuard } from './auth.guard';
import { ALLOW_GUEST_KEY, type AuthenticatedRequest } from './decorators';
import { signToken } from './tokens';

const SECRET = 'meeting-test-secret-that-is-long-enough';
const USER = '00000000-0000-4000-8000-000000000001';
const MEETING = '11111111-1111-4111-8111-111111111111';

function contextFor(
  request: Partial<AuthenticatedRequest>,
  allowGuest = false,
) {
  const handler = function handler() {};
  if (allowGuest) Reflect.defineMetadata(ALLOW_GUEST_KEY, true, handler);
  return {
    getHandler: () => handler,
    getClass: () => class Controller {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}
const bearer = (token: string, params: Record<string, string> = {}) =>
  ({
    headers: { authorization: `Bearer ${token}` },
    params,
  }) as unknown as Partial<AuthenticatedRequest>;

describe('MeetingAuthGuard', () => {
  const originalEnv = process.env;
  let dataSource: DataSource;
  let guard: MeetingAuthGuard;

  beforeEach(async () => {
    process.env = { ...originalEnv, MEETING_JWT_SECRET: SECRET };
    dataSource = await createTestDataSource();
    await dataSource.getRepository(UserEntity).save({
      id: USER,
      name: 'Tên trong DB',
      username: 'a',
      password: 'x',
    });
    guard = new MeetingAuthGuard(new Reflector(), dataSource);
  });

  afterEach(async () => {
    process.env = originalEnv;
    await dataSource.destroy();
  });

  it('token tài khoản: tên lấy từ DB, không từ payload', async () => {
    const { accessToken } = signToken({ sub: USER, typ: 'user', name: 'Giả' });
    const request = bearer(accessToken);
    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(request.user).toEqual({
      userId: USER,
      name: 'Tên trong DB',
      kind: 'user',
      meetingId: null,
    });
  });

  it('từ chối thiếu token, sai chữ ký, sai issuer (ví dụ token CRM) và tài khoản đã xóa', async () => {
    await expect(
      guard.canActivate(contextFor({ headers: {} })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    for (const token of [
      jwt.sign(
        { sub: USER, typ: 'user', name: 'x' },
        'other-secret-other-secret-other!!',
        {
          issuer: 'meeting-management',
        },
      ),
      jwt.sign({ userId: USER, userType: 'ADMIN' }, SECRET),
      jwt.sign({ sub: USER, typ: 'user', name: 'x' }, SECRET, {
        issuer: 'crm',
      }),
    ]) {
      await expect(
        guard.canActivate(contextFor(bearer(token))),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    }
    const { accessToken } = signToken({
      sub: '00000000-0000-4000-8000-000000000009',
      typ: 'user',
      name: 'x',
    });
    await expect(
      guard.canActivate(contextFor(bearer(accessToken))),
    ).rejects.toThrow('Tài khoản không còn tồn tại');
  });

  it('token khách chỉ dùng cho route cho phép khách và đúng cuộc họp', async () => {
    const { accessToken } = signToken({
      sub: 'guest-id',
      typ: 'guest',
      name: 'Khách',
      mid: MEETING,
    });
    const ok = bearer(accessToken, { id: MEETING.toUpperCase() });
    await expect(guard.canActivate(contextFor(ok, true))).resolves.toBe(true);
    expect(ok.user).toMatchObject({ kind: 'guest', meetingId: MEETING });

    await expect(
      guard.canActivate(contextFor(bearer(accessToken, { id: MEETING }))),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      guard.canActivate(
        contextFor(
          bearer(accessToken, { id: '22222222-2222-4222-8222-222222222222' }),
          true,
        ),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
