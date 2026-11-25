import {
  createParamDecorator,
  type ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import type { Request } from 'express';
import type { MeetingUser } from './auth.types';

export const IS_PUBLIC_KEY = 'isPublic';
export const ALLOW_GUEST_KEY = 'allowGuest';

/** Bỏ qua xác thực (health check, đăng nhập, khách xin vào). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Cho phép token khách, với điều kiện `:id` trên route trùng cuộc họp của token. */
export const AllowGuest = () => SetMetadata(ALLOW_GUEST_KEY, true);

export type AuthenticatedRequest = Request & { user?: MeetingUser };

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): MeetingUser | undefined =>
    context.switchToHttp().getRequest<AuthenticatedRequest>().user,
);
