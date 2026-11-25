import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, ILike } from 'typeorm';
import type { MeetingUser } from '../auth/auth.types';
import { hashPassword, verifyPassword } from '../auth/password';
import { signToken } from '../auth/tokens';
import { UserEntity } from '../database/entities/user.entity';
import type { CreateUserDto, UpdateMeDto } from './dto/user.dto';

export interface UserView {
  id: string;
  name: string;
  username: string;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  updatedBy: string | null;
}

const INVALID_LOGIN = 'Tên đăng nhập hoặc mật khẩu không đúng';

/** Tài khoản của hệ thống meeting. Không có phân quyền hệ thống: mọi tài khoản đều tạo được tài khoản khác. */
@Injectable()
export class UsersService {
  private dummyHash?: Promise<string>;

  constructor(private readonly dataSource: DataSource) {}

  private get repo() {
    return this.dataSource.getRepository(UserEntity);
  }

  async login(username: string, password: string) {
    const user = await this.repo.findOne({
      where: { username: username.toLowerCase() },
      select: { id: true, name: true, username: true, password: true },
    });
    // Vẫn băm khi không có tài khoản để thời gian phản hồi không lộ tên đăng nhập tồn tại.
    this.dummyHash ??= hashPassword(randomUUID());
    const ok = await verifyPassword(
      password,
      user?.password ?? (await this.dummyHash),
    );
    if (!user || !ok) throw new UnauthorizedException(INVALID_LOGIN);
    const { accessToken, expiresAt } = signToken({
      sub: user.id,
      typ: 'user',
      name: user.name,
    });
    return {
      accessToken,
      expiresAt,
      user: { id: user.id, name: user.name, username: user.username },
    };
  }

  /** actor null: tạo từ CLI (tài khoản đầu tiên). */
  async create(
    actor: MeetingUser | null,
    dto: CreateUserDto,
  ): Promise<UserView> {
    const username = dto.username.toLowerCase();
    if (await this.repo.existsBy({ username })) {
      throw new ConflictException('Tên đăng nhập đã tồn tại');
    }
    const user = await this.repo.save(
      this.repo.create({
        id: randomUUID(),
        name: dto.name,
        username,
        password: await hashPassword(dto.password),
        createdBy: actor?.userId ?? null,
        updatedBy: actor?.userId ?? null,
      }),
    );
    return toUserView(user);
  }

  async list(q?: string): Promise<UserView[]> {
    const users = await this.repo.find({
      where: q
        ? [
            { name: ILike(`%${escapeLike(q)}%`) },
            { username: ILike(`%${escapeLike(q)}%`) },
          ]
        : {},
      order: { name: 'ASC' },
      take: 50,
    });
    return users.map(toUserView);
  }

  async me(user: MeetingUser): Promise<UserView> {
    return toUserView(await this.repo.findOneByOrFail({ id: user.userId }));
  }

  async updateMe(actor: MeetingUser, dto: UpdateMeDto): Promise<UserView> {
    if (dto.name === undefined && dto.password === undefined) {
      throw new BadRequestException('Chọn ít nhất một thông tin cần đổi');
    }
    const user = await this.repo.findOneOrFail({
      where: { id: actor.userId },
      select: {
        id: true,
        name: true,
        username: true,
        password: true,
        createdAt: true,
        updatedAt: true,
        createdBy: true,
        updatedBy: true,
      },
    });
    if (dto.password !== undefined) {
      if (
        !dto.currentPassword ||
        !(await verifyPassword(dto.currentPassword, user.password))
      ) {
        throw new BadRequestException('Mật khẩu hiện tại không đúng');
      }
      user.password = await hashPassword(dto.password);
    }
    if (dto.name !== undefined) user.name = dto.name;
    user.updatedBy = actor.userId;
    return toUserView(await this.repo.save(user));
  }
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function toUserView(user: UserEntity): UserView {
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    createdBy: user.createdBy,
    updatedBy: user.updatedBy,
  };
}
