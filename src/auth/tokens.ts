import { InternalServerErrorException } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { numberEnv } from '../config/env';

/** Issuer riêng để không nhận nhầm token của hệ thống khác (ví dụ CRM) dù trùng secret. */
const ISSUER = 'meeting-management';

export interface TokenClaims {
  sub: string;
  typ: 'user' | 'guest';
  name: string;
  /** Chỉ có ở token khách: cuộc họp được phép. */
  mid?: string;
}

function secret(): string {
  const value = process.env.MEETING_JWT_SECRET?.trim();
  if (!value || value.length < 32) {
    throw new InternalServerErrorException(
      'MEETING_JWT_SECRET chưa được cấu hình (tối thiểu 32 ký tự)',
    );
  }
  return value;
}

export function signToken(claims: TokenClaims): {
  accessToken: string;
  expiresAt: string;
} {
  const ttl =
    claims.typ === 'guest'
      ? numberEnv('MEETING_GUEST_TOKEN_TTL_SECONDS', 12 * 3600)
      : numberEnv('MEETING_JWT_TTL_SECONDS', 7 * 24 * 3600);
  const accessToken = jwt.sign(claims, secret(), {
    algorithm: 'HS256',
    issuer: ISSUER,
    expiresIn: ttl,
  });
  return {
    accessToken,
    expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
  };
}

/** Trả claims hợp lệ hoặc null (sai chữ ký, hết hạn, sai issuer, thiếu trường). */
export function verifyToken(token: string): TokenClaims | null {
  try {
    const payload = jwt.verify(token, secret(), {
      algorithms: ['HS256'],
      issuer: ISSUER,
    });
    if (typeof payload !== 'object') return null;
    const { sub, typ, name, mid } = payload as Partial<TokenClaims>;
    if (typeof sub !== 'string' || typeof name !== 'string') return null;
    if (typ === 'user') return { sub, typ, name };
    if (typ === 'guest' && typeof mid === 'string') {
      return { sub, typ, name, mid };
    }
    return null;
  } catch (error) {
    if (error instanceof InternalServerErrorException) throw error;
    return null;
  }
}
