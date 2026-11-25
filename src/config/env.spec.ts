import { resolve } from 'node:path';
import {
  databaseOptions,
  envFilePaths,
  liveKitWebhookCredentials,
  validateEnv,
} from './env';

const root = resolve(__dirname, '..', '..');

describe('env', () => {
  const originalEnv = process.env;
  afterEach(() => {
    process.env = originalEnv;
  });

  it('khóa webhook tách khỏi LIVEKIT_API_*', () => {
    expect(
      liveKitWebhookCredentials({
        LIVEKIT_API_KEY: 'api',
        LIVEKIT_API_SECRET: 'api-secret',
      }),
    ).toBeNull();
    expect(
      liveKitWebhookCredentials({
        LIVEKIT_API_KEY: 'api',
        LIVEKIT_API_SECRET: 'api-secret',
        LIVEKIT_WEBHOOK_API_KEY: ' hook ',
        LIVEKIT_WEBHOOK_API_SECRET: 'hook-secret',
      }),
    ).toEqual({ apiKey: 'hook', apiSecret: 'hook-secret' });
  });

  it('validateEnv từ chối cấu hình webhook thiếu cặp, rỗng hoặc có khoảng trắng', () => {
    expect(validateEnv({})).toEqual({});
    const ok = {
      LIVEKIT_WEBHOOK_API_KEY: 'hook',
      LIVEKIT_WEBHOOK_API_SECRET: 'hook-secret',
    };
    expect(validateEnv(ok)).toBe(ok);
    expect(() => validateEnv({ LIVEKIT_WEBHOOK_API_KEY: 'hook' })).toThrow(
      'Phải đặt đủ cả LIVEKIT_WEBHOOK_API_KEY và LIVEKIT_WEBHOOK_API_SECRET',
    );
    expect(() =>
      validateEnv({ ...ok, LIVEKIT_WEBHOOK_API_SECRET: '  ' }),
    ).toThrow('LIVEKIT_WEBHOOK_API_SECRET không được để trống');
    expect(() =>
      validateEnv({ ...ok, LIVEKIT_WEBHOOK_API_KEY: 'ho ok' }),
    ).toThrow('LIVEKIT_WEBHOOK_API_KEY không được chứa khoảng trắng');
  });

  it('ưu tiên .env riêng, sau đó tới .env của CRM cạnh repo', () => {
    expect(envFilePaths({})).toEqual([
      resolve(root, '.env'),
      resolve(root, '../di-ichi-crm-services/.env'),
    ]);
  });

  it('cho phép đổi đường dẫn .env dùng chung bằng ENV_FILE', () => {
    expect(envFilePaths({ ENV_FILE: '/srv/crm/.env' })[1]).toBe(
      '/srv/crm/.env',
    );
    expect(envFilePaths({ ENV_FILE: 'shared/.env' })[1]).toBe(
      resolve(root, 'shared/.env'),
    );
  });

  it('DB meeting dùng chung server với CRM nhưng database riêng, không được trùng DB CRM', () => {
    const crm = {
      DB_HOST: 'pg.local',
      DB_PORT: '5433',
      DB_USERNAME: 'crm',
      DB_PASSWORD: 'secret',
      DB_DATABASE: 'di_ichi_crm',
    };
    const crmDb = 'di_ichi_crm';
    // DB_DATABASE là của CRM (.env riêng không đặt) -> dùng tên mặc định.
    expect(databaseOptions(crm, crmDb)).toMatchObject({
      host: 'pg.local',
      port: 5433,
      username: 'crm',
      database: 'diichi_meeting',
    });
    expect(
      databaseOptions({ ...crm, MEETING_DB_USERNAME: 'meeting' }, crmDb)
        .username,
    ).toBe('meeting');
    expect(() =>
      databaseOptions({ ...crm, MEETING_DB_DATABASE: crmDb }, crmDb),
    ).toThrow(/database riêng/);
  });

  it('lấy tên database theo DB_DATABASE trong .env riêng của meeting', () => {
    const env = { DB_HOST: 'pg.local', DB_DATABASE: 'di-ichi-meeting' };
    expect(databaseOptions(env, 'di_ichi_crm').database).toBe(
      'di-ichi-meeting',
    );
    expect(
      databaseOptions(
        { ...env, MEETING_DB_DATABASE: 'meeting_override' },
        'di_ichi_crm',
      ).database,
    ).toBe('meeting_override');
  });
});
