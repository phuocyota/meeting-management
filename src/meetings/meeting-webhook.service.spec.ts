import { TrackSource, type WebhookEvent } from 'livekit-server-sdk';
import type { DataSource } from 'typeorm';
import { createFakeLiveKit } from '../../test/support/fake-livekit';
import { createTestDataSource } from '../../test/support/pg-mem';
import type { MeetingUser } from '../auth/auth.types';
import { MeetingWebhookService } from './meeting-webhook.service';
import { MeetingsService } from './meetings.service';

const uid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const user = (n: number): MeetingUser => ({
  userId: uid(n),
  name: `User ${n}`,
  kind: 'user',
  meetingId: null,
});
const joined = (room: string, identity: string) =>
  ({
    event: 'participant_joined',
    room: { name: room },
    participant: { identity },
  }) as unknown as WebhookEvent;

describe('MeetingWebhookService', () => {
  let dataSource: DataSource;
  let lk: ReturnType<typeof createFakeLiveKit>;
  let meetings: MeetingsService;
  let webhooks: MeetingWebhookService;
  let id: string;
  let room: string;

  beforeEach(async () => {
    dataSource = await createTestDataSource();
    lk = createFakeLiveKit();
    meetings = new MeetingsService(dataSource, lk.livekit);
    webhooks = new MeetingWebhookService(dataSource, lk.livekit);
    ({
      meeting: { id },
    } = await meetings.create(user(1), { title: 'A', waitingRoom: false }));
    room = `meeting-${id}`;
    await meetings.join(user(2), id);
    lk.calls.removed.length = 0;
    lk.calls.updated.length = 0;
  });

  afterEach(async () => {
    await dataSource.destroy();
  });

  it('để yên người đã được vào', async () => {
    await webhooks.handle(joined(room, uid(2)));
    expect(lk.calls.removed).toEqual([]);
    expect(lk.calls.updated).toEqual([]);
  });

  it('đẩy ra người bị mời ra dùng lại token cũ, và người không phải thành viên', async () => {
    await meetings.kick(user(1), id, uid(2));
    lk.calls.removed.length = 0;

    await webhooks.handle(joined(room, uid(2)));
    await webhooks.handle(joined(room, uid(9)));
    expect(lk.calls.removed).toEqual([
      { room, identity: uid(2) },
      { room, identity: uid(9) },
    ]);
  });

  it('đẩy ra mọi người khi cuộc họp đã kết thúc', async () => {
    await meetings.end(user(1), id);
    await webhooks.handle(joined(room, uid(1)));
    expect(lk.calls.removed).toEqual([{ room, identity: uid(1) }]);
  });

  it('áp lại khóa phát khi người bị khóa vào lại', async () => {
    await meetings.setPublish(user(1), id, uid(2), false);
    lk.calls.updated.length = 0;

    await webhooks.handle(joined(room, uid(2)));
    expect(lk.calls.updated).toEqual([
      {
        room,
        identity: uid(2),
        update: {
          permission: {
            canPublish: false,
            canSubscribe: true,
            canPublishData: true,
            canPublishSources: [],
          },
        },
      },
    ]);
  });

  it('áp lại cài đặt phòng (cấm mic, tắt chat) cho người thường, không áp cho admin', async () => {
    await meetings.updateSettings(user(1), id, {
      allowMicrophone: false,
      allowChat: false,
    });
    lk.calls.updated.length = 0;

    await webhooks.handle(joined(room, uid(2)));
    await webhooks.handle(joined(room, uid(1)));
    expect(lk.calls.updated).toEqual([
      {
        room,
        identity: uid(2),
        update: {
          permission: {
            canPublish: true,
            canSubscribe: true,
            canPublishData: false,
            canPublishSources: [
              TrackSource.CAMERA,
              TrackSource.SCREEN_SHARE,
              TrackSource.SCREEN_SHARE_AUDIO,
            ],
          },
        },
      },
    ]);
  });

  it('bỏ qua phòng của CRM, phòng chưa có trong DB và sự kiện khác', async () => {
    await webhooks.handle(joined(`schedule-${uid(5)}`, uid(2)));
    await webhooks.handle(joined(`meeting-${uid(7)}`, uid(2)));
    await webhooks.handle({
      event: 'participant_left',
      room: { name: room },
      participant: { identity: uid(9) },
    } as unknown as WebhookEvent);
    expect(lk.calls.removed).toEqual([]);
  });
});
