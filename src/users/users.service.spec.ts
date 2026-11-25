import {
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { createTestDataSource } from '../../test/support/pg-mem';
import type { MeetingUser } from '../auth/auth.types';
import { verifyToken } from '../auth/tokens';
import { UserEntity } from '../database/entities/user.entity';
import { UsersService } from './users.service';

describe('UsersService', () => {
  const originalEnv = process.env;
  let dataSource: DataSource;
  let users: UsersService;

  beforeEach(async () => {
    process.env = {
      ...originalEnv,
      MEETING_JWT_SECRET: 'meeting-test-secret-that-is-long-enough',
    };
    dataSource = await createTestDataSource();
    users = new UsersService(dataSource);
  });

  afterEach(async () => {
    process.env = originalEnv;
    await dataSource.destroy();
  });

  const actorOf = (id: string): MeetingUser => ({
    userId: id,
    name: 'A',
    kind: 'user',
    meetingId: null,
  });

  it('tạo tài khoản: băm mật khẩu, ghi người tạo, không trả mật khẩu, trùng tên đăng nhập bị chặn', async () => {
    const admin = await users.create(null, {
      name: 'Quản trị',
      username: 'admin',
      password: 'mat-khau-1',
    });
    expect(admin).not.toHaveProperty('password');
    expect(admin.createdBy).toBeNull();

    const staff = await users.create(actorOf(admin.id), {
      name: 'Lan',
      username: 'Lan.Nguyen',
      password: 'mat-khau-2',
    });
    expect(staff).toMatchObject({
      username: 'lan.nguyen',
      createdBy: admin.id,
      updatedBy: admin.id,
    });
    const stored = await dataSource.getRepository(UserEntity).findOneOrFail({
      where: { id: staff.id },
      select: { password: true },
    });
    expect(stored.password).toMatch(/^scrypt\$/);
    expect(stored.password).not.toContain('mat-khau-2');

    await expect(
      users.create(null, {
        name: 'X',
        username: 'LAN.NGUYEN',
        password: '12345678',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('đăng nhập không phân biệt hoa thường tên đăng nhập; sai mật khẩu hoặc tên đều cùng một lỗi', async () => {
    const user = await users.create(null, {
      name: 'Lan',
      username: 'lan',
      password: 'mat-khau-1',
    });
    const result = await users.login('LAN', 'mat-khau-1');
    expect(result.user).toEqual({ id: user.id, name: 'Lan', username: 'lan' });
    expect(verifyToken(result.accessToken)).toMatchObject({
      sub: user.id,
      typ: 'user',
    });

    await expect(users.login('lan', 'sai')).rejects.toThrow(
      'Tên đăng nhập hoặc mật khẩu không đúng',
    );
    await expect(users.login('khong-co', 'mat-khau-1')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('đổi tên và mật khẩu của tôi (cần mật khẩu hiện tại); tìm theo tên', async () => {
    const user = await users.create(null, {
      name: 'Lan',
      username: 'lan',
      password: 'mat-khau-1',
    });
    const me = actorOf(user.id);
    await expect(
      users.updateMe(me, { password: 'moi-12345' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      users.updateMe(me, { password: 'moi-12345', currentPassword: 'sai' }),
    ).rejects.toThrow('Mật khẩu hiện tại không đúng');
    await users.updateMe(me, {
      name: 'Lan Nguyễn',
      password: 'moi-12345',
      currentPassword: 'mat-khau-1',
    });
    await expect(users.login('lan', 'moi-12345')).resolves.toMatchObject({
      user: { name: 'Lan Nguyễn' },
    });
    await users.create(null, {
      name: 'Bình',
      username: 'binh',
      password: '12345678',
    });
    expect((await users.list('nguy')).map((u) => u.username)).toEqual(['lan']);
    expect(await users.list()).toHaveLength(2);
  });
});
