import { isAbsolute, resolve } from 'node:path';

/** Thư mục gốc của repo (src/config hoặc dist/config -> ../..). */
const projectRoot = resolve(__dirname, '..', '..');

/**
 * Danh sách file .env theo thứ tự ưu tiên (file đứng trước thắng, biến môi trường thật thắng tất cả):
 * 1. `.env` riêng của meeting-management (tùy chọn, để ghi đè cục bộ).
 * 2. `ENV_FILE` hoặc mặc định `../di-ichi-crm-services/.env` để dùng chung LiveKit và máy chủ DB với CRM.
 */
export function envFilePaths(env: NodeJS.ProcessEnv = process.env): string[] {
  const shared = env.ENV_FILE?.trim() || '../di-ichi-crm-services/.env';
  return [
    resolve(projectRoot, '.env'),
    isAbsolute(shared) ? shared : resolve(projectRoot, shared),
  ];
}

export function numberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

/** `PORT` trong .env dùng chung là cổng của CRM, nên meeting dùng biến riêng. */
export function meetingPort(): number {
  return numberEnv('MEETING_PORT', 3010);
}

/**
 * Kết nối DB riêng của meeting: ưu tiên `MEETING_DB_*`, host/port/user/password mặc định theo `DB_*` của CRM
 * (cùng PostgreSQL server), còn tên database luôn riêng và không được trùng database của CRM.
 */
export function databaseOptions(env: NodeJS.ProcessEnv = process.env) {
  const pick = (own: string, shared: string, fallback: string) =>
    env[own]?.trim() || env[shared]?.trim() || fallback;
  const database = env.MEETING_DB_DATABASE?.trim() || 'diichi_meeting';
  if (env.DB_DATABASE?.trim() && database === env.DB_DATABASE.trim()) {
    throw new Error(
      'MEETING_DB_DATABASE không được trùng DB_DATABASE của CRM; meeting phải dùng database riêng',
    );
  }
  return {
    type: 'postgres' as const,
    host: pick('MEETING_DB_HOST', 'DB_HOST', 'localhost'),
    port: Number(pick('MEETING_DB_PORT', 'DB_PORT', '5432')),
    username: pick('MEETING_DB_USERNAME', 'DB_USERNAME', 'postgres'),
    password: pick('MEETING_DB_PASSWORD', 'DB_PASSWORD', 'postgres'),
    database,
  };
}

/** Nạp các file .env cho CLI (không qua ConfigModule); file nạp trước thắng, biến có sẵn không bị ghi đè. */
export function loadEnvFiles(): void {
  for (const file of envFilePaths()) {
    try {
      process.loadEnvFile(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}
