import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { UserEntity } from '../database/entities/user.entity';
import {
  ALLOW_GUEST_KEY,
  type AuthenticatedRequest,
  IS_PUBLIC_KEY,
} from './decorators';
import { verifyToken } from './tokens';

/**
 * Xác thực bằng access token do chính meeting cấp.
 * - Token tài khoản: kiểm tra tài khoản còn tồn tại; tên lấy từ DB, không tin payload.
 * - Token khách: chỉ dùng cho route có @AllowGuest và đúng cuộc họp đã cấp.
 */
@Injectable()
export class MeetingAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly dataSource: DataSource,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) {
      return true;
    }
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Thiếu header Authorization');
    }
    const claims = verifyToken(header.slice('Bearer '.length).trim());
    if (!claims) throw new UnauthorizedException('Token không hợp lệ');

    if (claims.typ === 'guest') {
      const allowed = this.reflector.getAllAndOverride<boolean>(
        ALLOW_GUEST_KEY,
        targets,
      );
      const meetingId = String(request.params?.id ?? '').toLowerCase();
      if (!allowed || meetingId !== claims.mid) {
        throw new ForbiddenException(
          'Khách chỉ dùng được trong cuộc họp đã vào',
        );
      }
      request.user = {
        userId: claims.sub,
        name: claims.name,
        kind: 'guest',
        meetingId: claims.mid,
      };
      return true;
    }

    const user = await this.dataSource
      .getRepository(UserEntity)
      .findOneBy({ id: claims.sub });
    if (!user) {
      throw new UnauthorizedException('Tài khoản không còn tồn tại');
    }
    request.user = {
      userId: user.id,
      name: user.name,
      kind: 'user',
      meetingId: null,
    };
    return true;
  }
}
