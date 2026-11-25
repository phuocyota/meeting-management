import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { createFakeLiveKit } from '../../test/support/fake-livekit';
import { createTestDataSource } from '../../test/support/pg-mem';
import type { MeetingUser } from '../auth/auth.types';
import { MeetingMemberEntity } from '../database/entities/meeting-member.entity';
import { MeetingEntity } from '../database/entities/meeting.entity';
import { UserEntity } from '../database/entities/user.entity';
import { TrackSource } from 'livekit-server-sdk';
import { MeetingsService } from './meetings.service';

const uid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const staff = (n: number): MeetingUser => ({
  userId: uid(n),
  name: `Nhân viên ${n}`,
  kind: 'user',
  meetingId: null,
});
const HOST = staff(1);
const COHOST = staff(2);
const GUEST = staff(3);
const OTHER = staff(4);

describe('MeetingsService', () => {
  let dataSource: DataSource;
  let service: MeetingsService;
  let lk: ReturnType<typeof createFakeLiveKit>;

  beforeEach(async () => {
    dataSource = await createTestDataSource();
    lk = createFakeLiveKit();
    service = new MeetingsService(dataSource, lk.livekit);
    process.env.MEETING_JWT_SECRET = 'meeting-test-secret-that-is-long-enough';
    // Tài khoản 1..9 có trong bảng users (đồng chủ trì phải là tài khoản thật).
    await dataSource.getRepository(UserEntity).save(
      Array.from({ length: 9 }, (_, i) => ({
        id: uid(i + 1),
        name: `Nhân viên ${i + 1}`,
        username: `user${i + 1}`,
        password: 'x',
      })),
    );
  });

  afterEach(async () => {
    await dataSource.destroy();
  });

  const createMeeting = async (extra: { waitingRoom?: boolean } = {}) => {
    const result = await service.create(HOST, {
      title: 'Họp tuần',
      coHostIds: [COHOST.userId],
      ...extra,
    });
    return result.meeting.id;
  };
  const member = (meetingId: string, user: MeetingUser) =>
    dataSource
      .getRepository(MeetingMemberEntity)
      .findOneByOrFail({ meetingId, userId: user.userId });

  it('người tạo là chủ trì, đồng chủ trì được ghi ngay; token không cấp roomAdmin', async () => {
    const result = await service.create(HOST, {
      title: 'Họp tuần',
      coHostIds: [COHOST.userId, HOST.userId],
    });

    expect(result).toMatchObject({ status: 'admitted', role: 'host' });
    expect((await member(result.meeting.id, HOST)).role).toBe('host');
    expect((await member(result.meeting.id, COHOST)).role).toBe('cohost');
    expect(lk.calls.rooms[0].name).toBe(`meeting-${result.meeting.id}`);
    expect(lk.calls.tokens[0]).toMatchObject({
      identity: HOST.userId,
      grant: { roomAdmin: false, canPublish: true },
    });
  });

  it('khách không tạo được cuộc họp; đồng chủ trì phải là tài khoản có thật', async () => {
    await expect(
      service.create(
        { userId: uid(50), name: 'Khách', kind: 'guest', meetingId: uid(51) },
        { title: 'x' },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.create(HOST, { title: 'x', coHostIds: [uid(77)] }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lưu tên hiển thị và đưa vào token LiveKit; tên tài khoản đổi thì cập nhật khi vào lại', async () => {
    const id = await createMeeting({ waitingRoom: false });
    await service.join(GUEST, id);
    expect(lk.calls.tokens.at(-1)).toMatchObject({
      identity: GUEST.userId,
      name: 'Nhân viên 3',
    });
    await service.join({ ...GUEST, name: 'Tên mới' }, id);
    expect((await member(id, GUEST)).displayName).toBe('Tên mới');
    const members = await service.listMembers(HOST, id);
    expect(members.find((m) => m.userId === HOST.userId)).toMatchObject({
      name: 'Nhân viên 1',
      isGuest: false,
    });
  });

  it('phòng chờ: người lạ phải chờ, admin được báo, duyệt xong mới có token', async () => {
    const id = await createMeeting();
    lk.calls.tokens.length = 0;

    await expect(service.join(GUEST, id)).resolves.toMatchObject({
      status: 'pending',
    });
    expect(lk.calls.data).toHaveLength(1);
    expect(lk.calls.data[0]).toMatchObject({
      topic: 'meeting.lobby',
      payload: { type: 'join_requested', userId: GUEST.userId },
    });
    expect([...(lk.calls.data[0].to ?? [])].sort()).toEqual(
      [HOST.userId, COHOST.userId].sort(),
    );
    // Hỏi lại khi chưa duyệt: vẫn chờ, không báo lặp.
    await expect(service.join(GUEST, id)).resolves.toMatchObject({
      status: 'pending',
    });
    expect(lk.calls.data).toHaveLength(1);
    expect(lk.calls.tokens).toHaveLength(0);

    const lobby = await service.listMembers(HOST, id, 'pending');
    expect(lobby.map((m) => m.userId)).toEqual([GUEST.userId]);

    await service.admit(COHOST, id, GUEST.userId);
    await expect(service.join(GUEST, id)).resolves.toMatchObject({
      status: 'admitted',
      role: 'participant',
    });
  });

  it('tắt phòng chờ thì mọi tài khoản vào thẳng', async () => {
    const id = await createMeeting({ waitingRoom: false });
    await expect(service.join(GUEST, id)).resolves.toMatchObject({
      status: 'admitted',
    });
  });

  describe('khách vào bằng tên', () => {
    it('nhận token khách, qua phòng chờ, được duyệt thì vào với tên đã nhập', async () => {
      const id = await createMeeting();
      const result = await service.guestJoin(id, 'Khách Lan');
      expect(result).toMatchObject({
        status: 'pending',
        guest: { name: 'Khách Lan' },
      });
      const guestId = result.guest!.id;
      expect(result.guest!.accessToken).toEqual(expect.any(String));
      expect(lk.calls.data.at(-1)).toMatchObject({
        topic: 'meeting.lobby',
        payload: { type: 'join_requested', userId: guestId },
      });
      const guest: MeetingUser = {
        userId: guestId,
        name: 'Khách Lan',
        kind: 'guest',
        meetingId: id,
      };
      await service.admit(HOST, id, guestId);
      await expect(service.join(guest, id)).resolves.toMatchObject({
        status: 'admitted',
        role: 'participant',
      });
      expect(lk.calls.tokens.at(-1)).toMatchObject({
        identity: guestId,
        name: 'Khách Lan',
      });
      const lobby = await service.listMembers(HOST, id);
      expect(lobby.find((m) => m.userId === guestId)).toMatchObject({
        name: 'Khách Lan',
        isGuest: true,
      });
    });

    it('phòng khóa: không cấp token, không tạo thành viên; cuộc họp kết thúc: 404', async () => {
      const id = await createMeeting();
      await service.updateSettings(HOST, id, { locked: true });
      await expect(service.guestJoin(id, 'A')).resolves.toMatchObject({
        status: 'locked',
        guest: null,
      });
      expect(await service.listMembers(HOST, id)).toHaveLength(2);
      await service.end(HOST, id);
      await expect(service.guestJoin(id, 'A')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('khách không làm đồng chủ trì hay chủ trì được', async () => {
      const id = await createMeeting({ waitingRoom: false });
      const { guest } = await service.guestJoin(id, 'Khách');
      await expect(
        service.grantCohost(HOST, id, guest!.id),
      ).rejects.toBeInstanceOf(ConflictException);
      await expect(
        service.transferHost(HOST, id, guest!.id),
      ).rejects.toBeInstanceOf(ConflictException);
      // Người chưa từng vào và không có tài khoản: không cấp được.
      await expect(
        service.grantCohost(HOST, id, uid(99)),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  it('người tham gia thường không có quyền admin', async () => {
    const id = await createMeeting({ waitingRoom: false });
    await service.join(GUEST, id);
    await service.join(OTHER, id);

    for (const action of [
      () => service.listMembers(GUEST, id),
      () => service.kick(GUEST, id, OTHER.userId),
      () => service.mute(GUEST, id, OTHER.userId, {}),
      () => service.grantCohost(GUEST, id, GUEST.userId),
      () => service.end(GUEST, id),
    ]) {
      await expect(action()).rejects.toBeInstanceOf(ForbiddenException);
    }
  });

  it('đồng chủ trì được cấp có quyền admin, bị thu hồi thì mất quyền và được báo vào phòng', async () => {
    const id = await createMeeting({ waitingRoom: false });
    await service.join(GUEST, id);

    await service.grantCohost(HOST, id, GUEST.userId);
    expect((await member(id, GUEST)).role).toBe('cohost');
    expect(lk.calls.data.at(-1)).toMatchObject({
      topic: 'meeting.roles',
      payload: { type: 'role_changed', userId: GUEST.userId, role: 'cohost' },
    });
    await expect(service.listMembers(GUEST, id)).resolves.toHaveLength(3);

    await service.revokeCohost(COHOST, id, GUEST.userId);
    expect((await member(id, GUEST)).role).toBe('participant');
    expect(lk.calls.updated.at(-1)).toMatchObject({
      identity: GUEST.userId,
      update: { metadata: JSON.stringify({ role: 'participant' }) },
    });
    await expect(service.listMembers(GUEST, id)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('không ai thay được chủ trì; không mời ra/khóa phát đồng chủ trì khi chưa thu hồi', async () => {
    const id = await createMeeting();

    await expect(
      service.grantCohost(COHOST, id, HOST.userId),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.revokeCohost(COHOST, id, HOST.userId),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(service.kick(COHOST, id, HOST.userId)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(
      service.mute(COHOST, id, HOST.userId, {}),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.kick(HOST, id, COHOST.userId)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('mời ra: ngắt kết nối, lần sau xin vào nhận kicked cho tới khi admin duyệt lại', async () => {
    const id = await createMeeting({ waitingRoom: false });
    await service.join(GUEST, id);

    await expect(service.kick(HOST, id, GUEST.userId)).resolves.toMatchObject({
      status: 'kicked',
      applied: true,
    });
    expect(lk.calls.removed).toEqual([
      { room: `meeting-${id}`, identity: GUEST.userId },
    ]);
    await expect(service.join(GUEST, id)).resolves.toMatchObject({
      status: 'kicked',
    });

    await service.admit(HOST, id, GUEST.userId);
    await expect(service.join(GUEST, id)).resolves.toMatchObject({
      status: 'admitted',
    });
  });

  it('từ chối chỉ áp dụng cho người đang chờ', async () => {
    const id = await createMeeting();
    await service.join(GUEST, id);

    await expect(service.deny(HOST, id, GUEST.userId)).resolves.toMatchObject({
      status: 'denied',
    });
    await expect(service.join(GUEST, id)).resolves.toMatchObject({
      status: 'denied',
    });
    await expect(service.deny(HOST, id, GUEST.userId)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('tắt mic gửi lệnh tới LiveKit; khóa phát được lưu và áp dụng vào token sau', async () => {
    const id = await createMeeting({ waitingRoom: false });
    await service.join(GUEST, id);

    await service.mute(COHOST, id, GUEST.userId, { audio: true, video: true });
    expect(lk.calls.muted).toEqual([
      {
        room: `meeting-${id}`,
        identity: GUEST.userId,
        kinds: ['audio', 'video'],
      },
    ]);

    await service.setPublish(HOST, id, GUEST.userId, false);
    expect(lk.calls.updated.at(-1)).toMatchObject({
      identity: GUEST.userId,
      update: {
        permission: {
          canPublish: false,
          canSubscribe: true,
          canPublishData: true,
        },
      },
    });
    await service.join(GUEST, id);
    expect(lk.calls.tokens.at(-1)?.grant).toMatchObject({ canPublish: false });
  });

  it('kết thúc: lưu trạng thái dù LiveKit lỗi, sau đó không vào được nữa', async () => {
    const id = await createMeeting({ waitingRoom: false });
    lk.fake.deleteRoom.mockRejectedValueOnce(new Error('LiveKit down'));

    await expect(service.end(COHOST, id)).resolves.toMatchObject({
      status: 'ended',
      applied: false,
    });
    const saved = await dataSource
      .getRepository(MeetingEntity)
      .findOneByOrFail({ id });
    expect(saved).toMatchObject({ status: 'ended', endedBy: COHOST.userId });
    expect(saved.endedAt).toBeInstanceOf(Date);
    await expect(service.join(GUEST, id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.end(HOST, id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('danh sách của tôi chỉ gồm cuộc họp đang diễn ra mà tôi đã được vào', async () => {
    const open = await createMeeting();
    const ended = await createMeeting({ waitingRoom: false });
    await service.join(GUEST, open); // pending
    await service.join(GUEST, ended);
    await service.end(HOST, ended);

    await expect(service.listMine(GUEST)).resolves.toEqual([]);
    expect((await service.listMine(COHOST)).map((m) => m.id)).toEqual([open]);
  });

  describe('điều khiển phòng', () => {
    const room = (id: string) => `meeting-${id}`;

    it('khóa phòng: người mới nhận locked và không được ghi vào, thành viên cũ và người đang chờ không bị ảnh hưởng', async () => {
      const id = await createMeeting();
      await service.join(GUEST, id); // pending
      await service.updateSettings(HOST, id, { locked: true });

      await expect(service.join(OTHER, id)).resolves.toMatchObject({
        status: 'locked',
        meeting: { settings: { locked: true } },
      });
      await expect(
        dataSource
          .getRepository(MeetingMemberEntity)
          .findOneBy({ meetingId: id, userId: OTHER.userId }),
      ).resolves.toBeNull();
      await service.admit(HOST, id, GUEST.userId);
      await expect(service.join(GUEST, id)).resolves.toMatchObject({
        status: 'admitted',
      });

      await service.updateSettings(COHOST, id, { locked: false });
      await expect(service.join(OTHER, id)).resolves.toMatchObject({
        status: 'pending',
      });
    });

    it('cài đặt: chỉ admin đổi được, phải chọn ít nhất một trường, báo cả phòng', async () => {
      const id = await createMeeting({ waitingRoom: false });
      await service.join(GUEST, id);

      await expect(
        service.updateSettings(GUEST, id, { locked: true }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.updateSettings(HOST, id, {})).rejects.toThrow(
        'Chọn ít nhất một cài đặt',
      );
      await expect(
        service.updateSettings(HOST, id, { allowChat: false }),
      ).resolves.toMatchObject({
        settings: { allowChat: false, allowMicrophone: true },
        applied: true,
      });
      expect(lk.calls.data.at(-1)).toMatchObject({
        topic: 'meeting.settings',
        payload: { type: 'settings_changed', settings: { allowChat: false } },
      });
    });

    it('tắt phòng chờ thì duyệt luôn mọi người đang chờ', async () => {
      const id = await createMeeting();
      await service.join(GUEST, id);
      await service.join(OTHER, id);

      const result = await service.updateSettings(HOST, id, {
        waitingRoom: false,
      });
      expect([...result.admitted].sort()).toEqual(
        [GUEST.userId, OTHER.userId].sort(),
      );
      expect((await member(id, GUEST)).status).toBe('admitted');
      expect(
        lk.calls.data.filter((d) => d.topic === 'meeting.lobby').at(-1),
      ).toMatchObject({
        payload: { type: 'lobby_updated', status: 'admitted' },
      });
    });

    it('duyệt tất cả phòng chờ', async () => {
      const id = await createMeeting();
      await service.join(GUEST, id);
      await service.join(OTHER, id);

      const { admitted } = await service.admitAll(COHOST, id);
      expect(admitted.map((m) => m.userId).sort()).toEqual(
        [GUEST.userId, OTHER.userId].sort(),
      );
      await expect(service.join(OTHER, id)).resolves.toMatchObject({
        status: 'admitted',
      });
    });

    it('cấm mic: tắt mic đang bật của người thường, cập nhật quyền, token sau bị giới hạn nguồn', async () => {
      const id = await createMeeting({ waitingRoom: false });
      await service.join(GUEST, id);
      lk.present(room(id), HOST.userId, [TrackSource.MICROPHONE]);
      lk.present(room(id), GUEST.userId, [
        TrackSource.MICROPHONE,
        TrackSource.CAMERA,
      ]);

      await service.updateSettings(HOST, id, { allowMicrophone: false });

      expect(lk.calls.mutedSources).toEqual([
        {
          room: room(id),
          identity: GUEST.userId,
          sources: [TrackSource.MICROPHONE],
        },
      ]);
      expect(lk.calls.updated).toEqual([
        {
          room: room(id),
          identity: GUEST.userId,
          update: {
            permission: expect.objectContaining({
              canPublish: true,
              canPublishSources: [
                TrackSource.CAMERA,
                TrackSource.SCREEN_SHARE,
                TrackSource.SCREEN_SHARE_AUDIO,
              ],
            }) as unknown,
          },
        },
      ]);
      await service.join(GUEST, id);
      expect(lk.calls.tokens.at(-1)?.grant.canPublishSources).toEqual([
        TrackSource.CAMERA,
        TrackSource.SCREEN_SHARE,
        TrackSource.SCREEN_SHARE_AUDIO,
      ]);
      await service.join(COHOST, id);
      expect(lk.calls.tokens.at(-1)?.grant).toMatchObject({
        canPublish: true,
        canPublishSources: [],
      });
    });

    it('cấm hết mic/camera/màn hình thì người thường không được phát', async () => {
      const id = await createMeeting({ waitingRoom: false });
      await service.updateSettings(HOST, id, {
        allowMicrophone: false,
        allowCamera: false,
        allowScreenShare: false,
      });
      await service.join(GUEST, id);
      expect(lk.calls.tokens.at(-1)?.grant).toMatchObject({
        canPublish: false,
        canPublishSources: [],
      });
    });

    it('tắt mic cả phòng chỉ áp cho người thường đang có mặt', async () => {
      const id = await createMeeting({ waitingRoom: false });
      await service.join(GUEST, id);
      await service.join(OTHER, id);
      lk.present(room(id), HOST.userId);
      lk.present(room(id), COHOST.userId);
      lk.present(room(id), GUEST.userId);
      lk.present(room(id), 'EG_recorder'); // egress/agent: bỏ qua

      await expect(service.muteAll(COHOST, id, {})).resolves.toEqual({
        participants: 1,
        tracks: 1,
      });
      expect(lk.calls.muted).toEqual([
        { room: room(id), identity: GUEST.userId, kinds: ['audio'] },
      ]);
      await expect(service.muteAll(GUEST, id, {})).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('giơ tay: phải có mặt, giơ lại giữ thứ tự, người thường chỉ hạ tay mình, admin hạ tay tất cả', async () => {
      const id = await createMeeting({ waitingRoom: false });
      await service.join(GUEST, id);
      await service.join(OTHER, id);

      await expect(service.raiseHand(GUEST, id)).rejects.toBeInstanceOf(
        ConflictException,
      );
      const guest = lk.present(room(id), GUEST.userId);
      const other = lk.present(room(id), OTHER.userId);

      const first = await service.raiseHand(GUEST, id);
      expect(guest.attributes.handRaisedAt).toBe(first.handRaisedAt);
      await expect(service.raiseHand(GUEST, id)).resolves.toEqual(first);
      await service.raiseHand(OTHER, id);

      await expect(
        service.lowerHand(GUEST, id, OTHER.userId),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await service.lowerHand(GUEST, id, GUEST.userId);
      expect(guest.attributes.handRaisedAt).toBeUndefined();

      await expect(service.lowerAllHands(GUEST, id)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(service.lowerAllHands(HOST, id)).resolves.toEqual({
        lowered: 1,
      });
      expect(other.attributes.handRaisedAt).toBeUndefined();
    });

    it('trạng thái phòng: người có mặt xếp theo vai trò, giơ tay, giờ vào; lobbyCount chỉ cho admin', async () => {
      const id = await createMeeting();
      await service.join(GUEST, id); // pending
      await service.admit(HOST, id, GUEST.userId);
      await service.join(OTHER, id); // pending, không có mặt
      lk.present(room(id), GUEST.userId, [TrackSource.MICROPHONE], 1000);
      lk.present(room(id), staff(8).userId, [], 500); // không phải thành viên
      const cohost = lk.present(
        room(id),
        COHOST.userId,
        [TrackSource.CAMERA, TrackSource.SCREEN_SHARE],
        3000,
      );
      cohost.tracks[0].muted = true;
      lk.present(room(id), HOST.userId, [], 2000);

      const view = await service.getRoom(HOST, id);
      expect(view.lobbyCount).toBe(1);
      expect(view.participants.map((p) => [p.userId, p.role])).toEqual([
        [HOST.userId, 'host'],
        [COHOST.userId, 'cohost'],
        [GUEST.userId, 'participant'],
      ]);
      expect(view.participants[1]).toMatchObject({
        camera: 'muted',
        screenShare: 'on',
        microphone: 'off',
      });
      expect(view.participants[2]).toMatchObject({
        microphone: 'on',
        joinedAt: new Date(1000).toISOString(),
      });

      await expect(service.getRoom(GUEST, id)).resolves.toMatchObject({
        lobbyCount: null,
      });
      await expect(service.getRoom(OTHER, id)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('chuyển chủ trì: chỉ chủ trì làm được, cho người đã được vào; chủ trì cũ thành đồng chủ trì', async () => {
      const id = await createMeeting();
      await service.join(GUEST, id); // pending

      await expect(
        service.transferHost(COHOST, id, GUEST.userId),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        service.transferHost(HOST, id, GUEST.userId),
      ).rejects.toBeInstanceOf(ConflictException);
      await service.admit(HOST, id, GUEST.userId);
      await service.setPublish(HOST, id, GUEST.userId, false);

      await expect(
        service.transferHost(HOST, id, GUEST.userId),
      ).resolves.toMatchObject({
        previousHost: { userId: HOST.userId, role: 'cohost' },
        host: { userId: GUEST.userId, role: 'host', canPublish: true },
      });
      await expect(
        dataSource.getRepository(MeetingEntity).findOneByOrFail({ id }),
      ).resolves.toMatchObject({ hostId: GUEST.userId });
      expect(
        lk.calls.data
          .filter((d) => d.topic === 'meeting.roles')
          .map((d) => d.payload),
      ).toEqual([
        expect.objectContaining({ userId: HOST.userId, role: 'cohost' }),
        expect.objectContaining({ userId: GUEST.userId, role: 'host' }),
      ]);
      // Chủ trì mới không bị mời ra được, chủ trì cũ giờ là đồng chủ trì.
      await expect(service.kick(HOST, id, GUEST.userId)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });
});
