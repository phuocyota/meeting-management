import { Test, TestingModule } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createHash } from 'node:crypto';
import { AccessToken } from 'livekit-server-sdk';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from './../src/app.module';
import { configureHttpApplication } from './../src/http-app';
import { LiveKitService } from './../src/livekit/livekit.service';
import { UsersService } from './../src/users/users.service';
import { createFakeLiveKit } from './support/fake-livekit';
import { createTestDataSource } from './support/pg-mem';

const API_KEY = 'e2e-key';
const API_SECRET = 'e2e-secret-that-is-long-enough-for-hs256';
const WEBHOOK_KEY = 'e2e-webhook-key';
const WEBHOOK_SECRET = 'e2e-webhook-secret-that-is-long-enough';

async function signWebhook(
  body: string,
  secret = WEBHOOK_SECRET,
  key = WEBHOOK_KEY,
) {
  const token = new AccessToken(key, secret);
  token.sha256 = createHash('sha256').update(body).digest('base64');
  return token.toJwt();
}

/** LiveKit giả cho phòng/token, nhưng xác minh chữ ký webhook bằng code thật. */
function liveKitWithRealWebhook() {
  const real = new LiveKitService();
  const fake = createFakeLiveKit().livekit;
  const receiveWebhook: LiveKitService['receiveWebhook'] = (body, auth) =>
    real.receiveWebhook(body, auth);
  return Object.assign(fake, { receiveWebhook });
}

describe('Meeting service (e2e)', () => {
  let app: NestExpressApplication;
  let dataSource: DataSource;

  beforeEach(async () => {
    // Biến môi trường thật thắng các file .env, nên test không dùng khóa LiveKit thật.
    process.env.LIVEKIT_API_KEY = API_KEY;
    process.env.LIVEKIT_API_SECRET = API_SECRET;
    process.env.LIVEKIT_PUBLIC_URL = 'wss://livekit.example';
    process.env.LIVEKIT_WEBHOOK_API_KEY = WEBHOOK_KEY;
    process.env.LIVEKIT_WEBHOOK_API_SECRET = WEBHOOK_SECRET;
    process.env.MEETING_JWT_SECRET = 'e2e-meeting-secret-that-is-long-enough';
    dataSource = await createTestDataSource();
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .overrideProvider(LiveKitService)
      .useValue(liveKitWithRealWebhook())
      .compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>({
      rawBody: true,
    });
    configureHttpApplication(app);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    if (dataSource.isInitialized) await dataSource.destroy();
  });

  it('/health (GET) công khai và báo DB', () => {
    return request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect((res) =>
        expect(res.body as Record<string, unknown>).toMatchObject({
          status: 'ok',
          database: true,
        }),
      );
  });

  it('/meetings (GET) cần token', () => {
    return request(app.getHttpServer()).get('/meetings').expect(401);
  });

  it('/livekit/webhook nhận application/webhook+json có chữ ký hợp lệ', async () => {
    const body = JSON.stringify({
      event: 'participant_joined',
      room: { name: 'meeting-11111111-1111-4111-8111-111111111111' },
      participant: { identity: '00000000-0000-4000-8000-000000000001' },
    });
    await request(app.getHttpServer())
      .post('/livekit/webhook')
      .set('Content-Type', 'application/webhook+json')
      .set('Authorization', await signWebhook(body))
      .send(body)
      .expect(200, { received: true });
  });

  it('/livekit/webhook không chấp nhận chữ ký bằng cặp LIVEKIT_API_*', async () => {
    const body = JSON.stringify({ event: 'room_started' });
    await request(app.getHttpServer())
      .post('/livekit/webhook')
      .set('Content-Type', 'application/webhook+json')
      .set('Authorization', await signWebhook(body, API_SECRET, API_KEY))
      .send(body)
      .expect(401);
  });

  it('/livekit/webhook trả 503 khi chưa cấu hình khóa webhook', async () => {
    delete process.env.LIVEKIT_WEBHOOK_API_KEY;
    delete process.env.LIVEKIT_WEBHOOK_API_SECRET;
    const body = JSON.stringify({ event: 'room_started' });
    await request(app.getHttpServer())
      .post('/livekit/webhook')
      .set('Content-Type', 'application/webhook+json')
      .set('Authorization', await signWebhook(body))
      .send(body)
      .expect(503);
  });

  it('/livekit/webhook từ chối chữ ký sai', async () => {
    const body = JSON.stringify({ event: 'room_started' });
    await request(app.getHttpServer())
      .post('/livekit/webhook')
      .set('Content-Type', 'application/webhook+json')
      .set(
        'Authorization',
        await signWebhook(body, 'another-secret-that-is-long-enough!!'),
      )
      .send(body)
      .expect(401);
  });

  it('đăng nhập -> tạo cuộc họp -> khách vào bằng tên -> chủ trì duyệt -> khách vào phòng', async () => {
    await new UsersService(dataSource).create(null, {
      name: 'Chủ trì',
      username: 'host',
      password: 'mat-khau-1',
    });
    const http = request(app.getHttpServer());
    await http
      .post('/auth/login')
      .send({ username: 'host', password: 'sai' })
      .expect(401);
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ username: 'HOST', password: 'mat-khau-1' })
      .expect(200);
    const hostToken = (login.body as { accessToken: string }).accessToken;
    const auth = { Authorization: `Bearer ${hostToken}` };

    const created = await request(app.getHttpServer())
      .post('/meetings')
      .set(auth)
      .send({ title: 'Họp' })
      .expect(201);
    const meetingId = (created.body as { meeting: { id: string } }).meeting.id;

    const guestJoin = await request(app.getHttpServer())
      .post(`/meetings/${meetingId}/guest`)
      .send({ name: '  Khách Lan  ' })
      .expect(201);
    const guestBody = guestJoin.body as {
      status: string;
      guest: { id: string; name: string; accessToken: string };
    };
    expect(guestBody).toMatchObject({
      status: 'pending',
      guest: { name: 'Khách Lan' },
    });
    const guestAuth = {
      Authorization: `Bearer ${guestBody.guest.accessToken}`,
    };

    // Token khách không dùng được ngoài cuộc họp của nó.
    await request(app.getHttpServer())
      .get('/meetings')
      .set(guestAuth)
      .expect(403);
    await request(app.getHttpServer())
      .get(`/meetings/${meetingId}/members`)
      .set(guestAuth)
      .expect(403);

    const lobby = await request(app.getHttpServer())
      .get(`/meetings/${meetingId}/members?status=pending`)
      .set(auth)
      .expect(200);
    expect(lobby.body).toEqual([
      expect.objectContaining({
        userId: guestBody.guest.id,
        name: 'Khách Lan',
        isGuest: true,
      }),
    ]);
    await request(app.getHttpServer())
      .post(`/meetings/${meetingId}/members/${guestBody.guest.id}/admit`)
      .set(auth)
      .expect(201);
    const joined = await request(app.getHttpServer())
      .post(`/meetings/${meetingId}/join`)
      .set(guestAuth)
      .expect(201);
    expect(joined.body).toMatchObject({
      status: 'admitted',
      role: 'participant',
    });

    // Khách được cấp đồng chủ trì thì gọi được API admin của cuộc họp đó.
    await request(app.getHttpServer())
      .put(`/meetings/${meetingId}/cohosts/${guestBody.guest.id}`)
      .set(auth)
      .expect(200);
    await request(app.getHttpServer())
      .get(`/meetings/${meetingId}/members`)
      .set(guestAuth)
      .expect(200);
    // Nhưng không chuyển chủ trì được, và vẫn không dùng được ngoài cuộc họp.
    await request(app.getHttpServer())
      .put(`/meetings/${meetingId}/host/${guestBody.guest.id}`)
      .set(guestAuth)
      .expect(403);
    await request(app.getHttpServer())
      .get('/meetings')
      .set(guestAuth)
      .expect(403);
  });
});
