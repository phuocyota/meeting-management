import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { Logger } from '@nestjs/common';

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

/** Cặp khóa LiveKit dùng riêng để xác minh chữ ký webhook (khác cặp gọi API/sinh token). */
export interface LiveKitWebhookCredentials {
  apiKey: string;
  apiSecret: string;
}

const WEBHOOK_KEY = 'LIVEKIT_WEBHOOK_API_KEY';
const WEBHOOK_SECRET = 'LIVEKIT_WEBHOOK_API_SECRET';

/** Lỗi cấu hình của các biến webhook; mảng rỗng là hợp lệ (kể cả khi chưa đặt cả hai). */
function webhookEnvErrors(env: Record<string, unknown>): string[] {
  const read = (name: string) =>
    typeof env[name] === 'string' ? env[name].trim() : undefined;
  const key = read(WEBHOOK_KEY);
  const secret = read(WEBHOOK_SECRET);
  const errors: string[] = [];
  for (const [name, value] of [
    [WEBHOOK_KEY, key],
    [WEBHOOK_SECRET, secret],
  ] as const) {
    if (value === '') errors.push(`${name} không được để trống`);
    else if (value !== undefined && /\s/.test(value))
      errors.push(`${name} không được chứa khoảng trắng`);
  }
  if (Boolean(key) !== Boolean(secret) && !errors.length) {
    errors.push(`Phải đặt đủ cả ${WEBHOOK_KEY} và ${WEBHOOK_SECRET}`);
  }
  return errors;
}

/**
 * Khóa xác minh webhook: `LIVEKIT_WEBHOOK_API_KEY`/`LIVEKIT_WEBHOOK_API_SECRET`, không dùng
 * `LIVEKIT_API_*`. Trả `null` khi chưa cấu hình; ném lỗi khi cấu hình sai.
 */
export function liveKitWebhookCredentials(
  env: NodeJS.ProcessEnv = process.env,
): LiveKitWebhookCredentials | null {
  const errors = webhookEnvErrors(env);
  if (errors.length) throw new Error(errors.join('; '));
  const apiKey = env[WEBHOOK_KEY]?.trim();
  const apiSecret = env[WEBHOOK_SECRET]?.trim();
  return apiKey && apiSecret ? { apiKey, apiSecret } : null;
}

/**
 * `validate` của ConfigModule: dừng khởi động nếu biến webhook LiveKit cấu hình sai.
 * Thiếu cả hai biến vẫn cho chạy (cuộc họp không phụ thuộc webhook) nhưng webhook trả 503.
 */
export function validateEnv(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const errors = webhookEnvErrors(config);
  if (errors.length) {
    throw new Error(`Cấu hình môi trường không hợp lệ: ${errors.join('; ')}`);
  }
  if (!liveKitWebhookCredentials(config as NodeJS.ProcessEnv)) {
    new Logger('Config').warn(
      'Chưa đặt LIVEKIT_WEBHOOK_API_KEY/LIVEKIT_WEBHOOK_API_SECRET: /livekit/webhook sẽ trả 503',
    );
  }
  return config;
}

export function numberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

/** Tên database của CRM, đọc trực tiếp từ .env dùng chung (`ENV_FILE`); `undefined` nếu không đọc được. */
export function crmDatabaseName(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  try {
    const shared = parseEnv(readFileSync(envFilePaths(env)[1], 'utf8'));
    return shared.DB_DATABASE?.trim() || undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

/**
 * Kết nối DB riêng của meeting: ưu tiên `MEETING_DB_*`, sau đó `DB_*` (cùng PostgreSQL server với CRM).
 * Tên database lấy theo `MEETING_DB_DATABASE`, rồi `DB_DATABASE` (thường đặt trong `meeting-management/.env`),
 * nhưng bỏ qua `DB_DATABASE` nếu đó là database của CRM (khi .env riêng không đặt), và không bao giờ được trùng DB CRM.
 */
export function databaseOptions(
  env: NodeJS.ProcessEnv = process.env,
  crmDatabase: string | undefined = crmDatabaseName(env),
) {
  const pick = (own: string, shared: string, fallback: string) =>
    env[own]?.trim() || env[shared]?.trim() || fallback;
  const shared = env.DB_DATABASE?.trim();
  const database =
    env.MEETING_DB_DATABASE?.trim() ||
    (shared && shared !== crmDatabase ? shared : undefined) ||
    'diichi_meeting';
  if (crmDatabase && database === crmDatabase) {
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
