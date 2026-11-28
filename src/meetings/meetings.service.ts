import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, type EntityManager, In } from 'typeorm';
import { isGuest, type MeetingUser } from '../auth/auth.types';
import { signToken } from '../auth/tokens';
import { UserEntity } from '../database/entities/user.entity';
import { meetingJoinUrl, numberEnv } from '../config/env';
import {
  isAdminRole,
  MeetingMemberEntity,
  type MeetingRole,
  type MemberStatus,
} from '../database/entities/meeting-member.entity';
import { MeetingEntity } from '../database/entities/meeting.entity';
import {
  type ParticipantInfo,
  TrackSource,
  type TrackInfo,
} from 'livekit-server-sdk';
import { LiveKitService, type MuteKind } from '../livekit/livekit.service';
import {
  MAX_SCHEDULE_AHEAD_MS,
  type CreateMeetingDto,
  type ScheduleMeetingDto,
} from './dto/create-meeting.dto';
import {
  SETTING_KEYS,
  type UpdateSettingsDto,
} from './dto/update-settings.dto';
import { blockedSources, effectivePermission } from './meeting-permissions';
import {
  HAND_RAISED_ATTRIBUTE,
  MEETING_TOPICS,
  meetingRoomName,
} from './meeting-room';

export interface MeetingView {
  id: string;
  title: string;
  hostId: string;
  waitingRoom: boolean;
  maxParticipants: number;
  status: MeetingEntity['status'];
  settings: MeetingSettings;
  /** Giờ bắt đầu đã hẹn; null nếu họp ngay. */
  scheduledAt: Date | null;
  /** Link vào cuộc họp trên FE (`MEETING_FE_URL`/meeting/:id); null nếu chưa cấu hình. */
  joinUrl: string | null;
  createdAt: Date;
  endedAt: Date | null;
  myRole: MeetingRole | null;
  myStatus: MemberStatus | null;
}

export interface MeetingSettings {
  locked: boolean;
  waitingRoom: boolean;
  allowMicrophone: boolean;
  allowCamera: boolean;
  allowScreenShare: boolean;
  allowChat: boolean;
}

/** 'on': đang phát, 'muted': đã publish nhưng tắt, 'off': không publish. */
export type TrackState = 'on' | 'muted' | 'off';

export interface ParticipantView {
  userId: string;
  name: string | null;
  isGuest: boolean;
  role: MeetingRole;
  canPublish: boolean;
  joinedAt: string | null;
  handRaisedAt: string | null;
  microphone: TrackState;
  camera: TrackState;
  screenShare: TrackState;
}

export interface RoomView {
  meeting: MeetingView;
  /** Người đang có mặt trong phòng LiveKit: chủ trì, đồng chủ trì, rồi người giơ tay (sớm trước), rồi theo giờ vào. */
  participants: ParticipantView[];
  /** Số người đang chờ duyệt; null nếu không phải admin. */
  lobbyCount: number | null;
}

export interface MemberView {
  userId: string;
  name: string | null;
  isGuest: boolean;
  role: MeetingRole;
  status: MemberStatus;
  canPublish: boolean;
  requestedAt: Date | null;
  decidedAt: Date | null;
  decidedBy: string | null;
}

export type JoinResult =
  | {
      status: 'admitted';
      meeting: MeetingView;
      serverUrl: string;
      token: string;
      expiresAt: string;
      role: MeetingRole;
    }
  | {
      /** not_started: cuộc họp đã lên lịch nhưng chưa tới giờ (xem meeting.scheduledAt). */
      status: 'pending' | 'denied' | 'kicked' | 'locked' | 'not_started';
      meeting: MeetingView;
    };

const NOT_FOUND = 'Cuộc họp không tồn tại';
const ENDED = 'Cuộc họp đã kết thúc';
const ADMIN_ONLY = 'Chỉ chủ trì hoặc đồng chủ trì được thực hiện thao tác này';
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Phân quyền theo từng cuộc họp: người tạo là chủ trì (host), chủ trì và đồng chủ trì (cohost) là admin.
 * Quyền admin chỉ được kiểm tra ở API này (theo DB), không cấp `roomAdmin` trong token LiveKit,
 * để thu hồi đồng chủ trì có hiệu lực ngay cả khi họ còn token cũ.
 *
 * Mỗi thao tác chạy một transaction ngắn khóa dòng `meetings` (tuần tự hóa thao tác trên cùng cuộc họp),
 * commit xong mới gọi LiveKit: không gọi hệ thống ngoài khi đang giữ khóa dòng.
 */
@Injectable()
export class MeetingsService {
  private readonly logger = new Logger(MeetingsService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly livekit: LiveKitService,
  ) {}

  async create(user: MeetingUser, dto: CreateMeetingDto): Promise<JoinResult> {
    const { meeting, host } = await this.insertMeeting(user, dto, {
      waitingRoom: dto.waitingRoom ?? true,
      scheduledAt: null,
    });
    return this.admittedResult(meeting, host);
  }

  /**
   * Lên lịch họp: chưa tạo phòng LiveKit, chưa cấp token. Trước giờ hẹn chỉ chủ trì/đồng chủ trì vào
   * được (để chuẩn bị); tới giờ thì ai có link cũng vào thẳng vì cuộc họp không có phòng chờ.
   */
  async schedule(
    user: MeetingUser,
    dto: ScheduleMeetingDto,
  ): Promise<MeetingView> {
    const scheduledAt = new Date(dto.scheduledAt);
    const now = Date.now();
    if (Number.isNaN(+scheduledAt) || +scheduledAt <= now) {
      throw new BadRequestException('Giờ bắt đầu phải ở tương lai');
    }
    if (+scheduledAt > now + MAX_SCHEDULE_AHEAD_MS) {
      throw new BadRequestException('Chỉ lên lịch trước tối đa 1 năm');
    }
    const { meeting, host } = await this.insertMeeting(user, dto, {
      waitingRoom: false,
      scheduledAt,
    });
    return toMeetingView(meeting, host);
  }

  private async insertMeeting(
    user: MeetingUser,
    dto: Omit<CreateMeetingDto, 'waitingRoom'>,
    options: { waitingRoom: boolean; scheduledAt: Date | null },
  ) {
    if (isGuest(user)) {
      throw new ForbiddenException('Khách không được tạo cuộc họp');
    }
    const coHostIds = [...new Set(dto.coHostIds ?? [])]
      .map((id) => id.toLowerCase())
      .filter((id) => id !== user.userId.toLowerCase());
    const now = new Date();
    const id = randomUUID();

    return this.dataSource.transaction(async (m) => {
      const coHosts = coHostIds.length
        ? await m.getRepository(UserEntity).findBy({ id: In(coHostIds) })
        : [];
      if (coHosts.length !== coHostIds.length) {
        throw new NotFoundException(
          'Có đồng chủ trì không phải tài khoản hợp lệ',
        );
      }
      const meeting = await m.getRepository(MeetingEntity).save(
        m.getRepository(MeetingEntity).create({
          id,
          roomName: meetingRoomName(id),
          title: dto.title,
          hostId: user.userId,
          waitingRoom: options.waitingRoom,
          scheduledAt: options.scheduledAt,
          maxParticipants:
            dto.maxParticipants ??
            Math.min(500, numberEnv('LIVEKIT_ROOM_MAX_PARTICIPANTS', 100)),
          status: 'active',
          endedAt: null,
          endedBy: null,
        }),
      );
      const members = m.getRepository(MeetingMemberEntity);
      const host = await members.save(
        members.create({
          meetingId: id,
          userId: user.userId,
          displayName: user.name,
          role: 'host',
          status: 'admitted',
          decidedAt: now,
          decidedBy: user.userId,
        }),
      );
      if (coHosts.length) {
        await members.save(
          coHosts.map((coHost) =>
            members.create({
              meetingId: id,
              userId: coHost.id,
              displayName: coHost.name,
              role: 'cohost',
              status: 'admitted',
              decidedAt: now,
              decidedBy: user.userId,
            }),
          ),
        );
      }
      return { meeting, host };
    });
  }

  /** Cuộc họp đang diễn ra mà người dùng là thành viên đã được vào. */
  async listMine(user: MeetingUser): Promise<MeetingView[]> {
    const members = await this.dataSource
      .getRepository(MeetingMemberEntity)
      .find({
        where: { userId: user.userId, status: 'admitted' },
        relations: { meeting: true },
      });
    return members
      .filter((member) => member.meeting?.status === 'active')
      .sort((a, b) => +b.meeting!.createdAt - +a.meeting!.createdAt)
      .map((member) => toMeetingView(member.meeting!, member));
  }

  async findOne(user: MeetingUser, id: string): Promise<MeetingView> {
    const meeting = await this.dataSource
      .getRepository(MeetingEntity)
      .findOneBy({ id });
    if (!meeting) throw new NotFoundException(NOT_FOUND);
    const member = await this.dataSource
      .getRepository(MeetingMemberEntity)
      .findOneBy({ meetingId: id, userId: user.userId });
    return toMeetingView(meeting, member);
  }

  /**
   * Admin (và mọi người khi tắt phòng chờ) nhận token ngay; người khác vào phòng chờ.
   * Người chờ gọi lại endpoint này để biết đã được duyệt hay chưa.
   */
  async join(user: MeetingUser, id: string): Promise<JoinResult> {
    const outcome = await this.dataSource.transaction(async (m) => {
      const meeting = await this.lockActiveMeeting(m, id);
      const members = m.getRepository(MeetingMemberEntity);
      let member = await members.findOneBy({
        meetingId: id,
        userId: user.userId,
      });
      let requested = false;
      if (member && member.displayName !== user.name) {
        // Tài khoản đổi tên: cập nhật tên hiển thị cho lần vào này.
        member.displayName = user.name;
        member = await members.save(member);
      }
      // Chưa tới giờ hẹn: chỉ admin vào trước; người khác không tạo dòng thành viên, tới giờ gọi lại.
      if (notStarted(meeting) && !isAdminRole(member?.role)) {
        return {
          meeting,
          member,
          requested,
          adminIds: [],
          blocked: 'not_started' as const,
        };
      }
      if (!member) {
        // Khóa phòng chỉ chặn người mới; không tạo dòng thành viên để mở khóa xong xin vào lại được.
        if (meeting.locked)
          return {
            meeting,
            member: null,
            requested,
            adminIds: [],
            blocked: 'locked' as const,
          };
        const now = new Date();
        member = await members.save(
          members.create({
            meetingId: id,
            userId: user.userId,
            displayName: user.name,
            isGuest: isGuest(user),
            role: 'participant',
            status: meeting.waitingRoom ? 'pending' : 'admitted',
            requestedAt: now,
            decidedAt: meeting.waitingRoom ? null : now,
            decidedBy: null,
          }),
        );
        requested = member.status === 'pending';
      }
      const adminIds = requested ? await this.adminIds(m, id) : [];
      return { meeting, member, requested, adminIds, blocked: null };
    });

    const { meeting, member } = outcome;
    if (outcome.blocked || !member) {
      return {
        status: outcome.blocked ?? 'locked',
        meeting: toMeetingView(meeting, member),
      };
    }
    if (outcome.requested) {
      await this.notify(
        meeting.roomName,
        MEETING_TOPICS.lobby,
        {
          type: 'join_requested',
          meetingId: meeting.id,
          userId: member.userId,
        },
        outcome.adminIds,
      );
    }
    if (member.status !== 'admitted') {
      return { status: member.status, meeting: toMeetingView(meeting, member) };
    }
    return this.admittedResult(meeting, member);
  }

  /**
   * Khách vào bằng tên (không cần tài khoản): cấp token khách chỉ dùng cho cuộc họp này rồi xin vào như
   * mọi người (phòng chờ, khóa phòng áp dụng bình thường). Khách gọi lại `join` bằng token khách để
   * biết đã được duyệt chưa. Phòng đang khóa thì không cấp token và không tạo thành viên.
   */
  async guestJoin(id: string, name: string) {
    const meeting = await this.dataSource
      .getRepository(MeetingEntity)
      .findOneBy({ id });
    if (!meeting) throw new NotFoundException(NOT_FOUND);
    if (meeting.status !== 'active') throw new NotFoundException(ENDED);
    // Khách không bao giờ là admin: chưa tới giờ hẹn thì chưa cấp token khách.
    if (notStarted(meeting)) {
      return {
        status: 'not_started' as const,
        meeting: toMeetingView(meeting, null),
        guest: null,
      };
    }
    if (meeting.locked) {
      return {
        status: 'locked' as const,
        meeting: toMeetingView(meeting, null),
        guest: null,
      };
    }
    const guest: MeetingUser = {
      userId: randomUUID(),
      name,
      kind: 'guest',
      meetingId: id,
    };
    const session = signToken({
      sub: guest.userId,
      typ: 'guest',
      name,
      mid: id,
    });
    const result = await this.join(guest, id);
    return { ...result, guest: { id: guest.userId, name, ...session } };
  }

  async listMembers(
    user: MeetingUser,
    id: string,
    status?: MemberStatus,
  ): Promise<MemberView[]> {
    const meeting = await this.dataSource
      .getRepository(MeetingEntity)
      .findOneBy({ id });
    if (!meeting) throw new NotFoundException(NOT_FOUND);
    await this.assertAdmin(this.dataSource.manager, meeting, user);
    const members = await this.dataSource
      .getRepository(MeetingMemberEntity)
      .find({
        where: { meetingId: id, ...(status ? { status } : {}) },
        order: { requestedAt: 'ASC', createdAt: 'ASC' },
      });
    return members.map(toMemberView);
  }

  /** Duyệt người trong phòng chờ, hoặc cho người bị từ chối/mời ra vào lại. */
  async admit(user: MeetingUser, id: string, targetId: string) {
    const { meeting, member } = await this.adminPhase(user, id, async (m) => {
      const member = await this.loadMember(m, id, targetId);
      if (member.status === 'admitted') return member;
      member.status = 'admitted';
      member.decidedAt = new Date();
      member.decidedBy = user.userId;
      return m.getRepository(MeetingMemberEntity).save(member);
    });
    await this.notify(meeting.roomName, MEETING_TOPICS.lobby, {
      type: 'lobby_updated',
      meetingId: id,
      userId: targetId,
      status: member.status,
    });
    return toMemberView(member);
  }

  async deny(user: MeetingUser, id: string, targetId: string) {
    const { meeting, member } = await this.adminPhase(user, id, async (m) => {
      const member = await this.loadMember(m, id, targetId);
      if (member.status !== 'pending') {
        throw new ConflictException('Người này không ở trong phòng chờ');
      }
      member.status = 'denied';
      member.decidedAt = new Date();
      member.decidedBy = user.userId;
      return m.getRepository(MeetingMemberEntity).save(member);
    });
    await this.notify(meeting.roomName, MEETING_TOPICS.lobby, {
      type: 'lobby_updated',
      meetingId: id,
      userId: targetId,
      status: member.status,
    });
    return toMemberView(member);
  }

  /** Mời ra: đánh dấu kicked rồi ngắt kết nối; webhook chặn vào lại bằng token cũ. */
  async kick(user: MeetingUser, id: string, targetId: string) {
    const { meeting, member } = await this.adminPhase(user, id, async (m) => {
      const member = await this.loadMember(m, id, targetId);
      this.assertModerable(member);
      member.status = 'kicked';
      member.decidedAt = new Date();
      member.decidedBy = user.userId;
      return m.getRepository(MeetingMemberEntity).save(member);
    });
    const applied = await this.bestEffort('mời người tham gia ra', () =>
      this.livekit.removeParticipant(meeting.roomName, member.userId),
    );
    return { ...toMemberView(member), applied };
  }

  /** Tắt mic/camera đang phát. Người bị tắt vẫn tự bật lại được, trừ khi bị khóa quyền phát. */
  async mute(
    user: MeetingUser,
    id: string,
    targetId: string,
    input: { audio?: boolean; video?: boolean },
  ) {
    const kinds = muteKinds(input);
    const { meeting, member } = await this.adminPhase(user, id, async (m) => {
      const member = await this.loadMember(m, id, targetId);
      if (member.role === 'host') {
        throw new ForbiddenException('Không thể tắt mic/camera của chủ trì');
      }
      return member;
    });
    const muted = await this.livekit.muteTracks(
      meeting.roomName,
      member.userId,
      kinds,
    );
    return { userId: member.userId, muted };
  }

  async setPublish(
    user: MeetingUser,
    id: string,
    targetId: string,
    allowed: boolean,
  ) {
    const { meeting, member } = await this.adminPhase(user, id, async (m) => {
      const member = await this.loadMember(m, id, targetId);
      this.assertModerable(member);
      member.canPublish = allowed;
      return m.getRepository(MeetingMemberEntity).save(member);
    });
    // Người chưa có mặt sẽ nhận quyền mới qua token và webhook khi vào lại.
    const applied = await this.bestEffort('cập nhật quyền phát', () =>
      this.livekit.updateParticipant(meeting.roomName, member.userId, {
        permission: effectivePermission(meeting, member),
      }),
    );
    return { ...toMemberView(member), applied };
  }

  /**
   * Chỉ định đồng chủ trì (tài khoản, hoặc khách đã có trong cuộc họp); người được chỉ định vào thẳng,
   * không qua phòng chờ.
   */
  async grantCohost(user: MeetingUser, id: string, targetId: string) {
    const { meeting, member } = await this.adminPhase(user, id, async (m) => {
      const members = m.getRepository(MeetingMemberEntity);
      const existing = await members.findOneBy({
        meetingId: id,
        userId: targetId,
      });
      if (existing?.role === 'host') {
        throw new ConflictException('Người này là chủ trì');
      }
      const account = existing
        ? null
        : await m.getRepository(UserEntity).findOneBy({ id: targetId });
      if (!existing && !account) {
        throw new NotFoundException('Tài khoản không tồn tại');
      }
      const now = new Date();
      return members.save(
        members.create({
          ...existing,
          meetingId: id,
          userId: targetId,
          displayName: existing?.displayName ?? account?.name ?? null,
          role: 'cohost',
          status: 'admitted',
          canPublish: true,
          decidedAt: now,
          decidedBy: user.userId,
        }),
      );
    });
    await this.announceRole(meeting, member);
    return toMemberView(member);
  }

  async revokeCohost(user: MeetingUser, id: string, targetId: string) {
    const { meeting, member } = await this.adminPhase(user, id, async (m) => {
      const member = await this.loadMember(m, id, targetId);
      if (member.role !== 'cohost') {
        throw new ConflictException('Người này không phải đồng chủ trì');
      }
      member.role = 'participant';
      member.decidedAt = new Date();
      member.decidedBy = user.userId;
      return m.getRepository(MeetingMemberEntity).save(member);
    });
    await this.announceRole(meeting, member);
    return toMemberView(member);
  }

  /** Kết thúc cho mọi người. Đã commit thì không thất bại vì LiveKit lỗi; webhook vẫn chặn người vào lại. */
  async end(user: MeetingUser, id: string) {
    const { meeting } = await this.adminPhase(user, id, async (m, meeting) => {
      meeting.status = 'ended';
      meeting.endedAt = new Date();
      meeting.endedBy = user.userId;
      await m.getRepository(MeetingEntity).save(meeting);
      return null;
    });
    const applied = await this.bestEffort('đóng phòng LiveKit', async () => {
      await this.livekit.deleteRoom(meeting.roomName);
      return true;
    });
    return { ...toMeetingView(meeting, null), applied };
  }

  /**
   * Đổi cài đặt phòng. Siết quyền mic/camera/màn hình/chat thì tắt track đang phát và cập nhật quyền
   * của người đang có mặt; người vào sau nhận quyền mới qua token và webhook.
   */
  async updateSettings(user: MeetingUser, id: string, dto: UpdateSettingsDto) {
    const changes = SETTING_KEYS.filter((key) => dto[key] !== undefined);
    if (!changes.length) {
      throw new BadRequestException('Chọn ít nhất một cài đặt cần đổi');
    }
    const { meeting, member: admitted } = await this.adminPhase(
      user,
      id,
      async (m, meeting) => {
        for (const key of changes) meeting[key] = dto[key]!;
        await m.getRepository(MeetingEntity).save(meeting);
        const admitted: MeetingMemberEntity[] = meeting.waitingRoom
          ? []
          : await this.admitPending(m, id, user);
        return admitted;
      },
    );
    const applied = changes.some((key) => key.startsWith('allow'))
      ? await this.bestEffort('áp dụng cài đặt phòng', () =>
          this.applyPermissions(meeting),
        )
      : true;
    await this.announceAdmitted(meeting, admitted);
    await this.notify(meeting.roomName, MEETING_TOPICS.settings, {
      type: 'settings_changed',
      meetingId: id,
      settings: toSettings(meeting),
    });
    return {
      settings: toSettings(meeting),
      admitted: admitted.map((member) => member.userId),
      applied,
    };
  }

  /** Duyệt tất cả người đang chờ. */
  async admitAll(user: MeetingUser, id: string) {
    const { meeting, member: admitted } = await this.adminPhase(user, id, (m) =>
      this.admitPending(m, id, user),
    );
    await this.announceAdmitted(meeting, admitted);
    return { admitted: admitted.map(toMemberView) };
  }

  /** Tắt mic (và camera nếu chọn) của mọi người tham gia thường đang có mặt; admin không bị tắt. */
  async muteAll(
    user: MeetingUser,
    id: string,
    input: { audio?: boolean; video?: boolean },
  ) {
    const kinds = muteKinds(input);
    const { meeting } = await this.adminPhase(user, id, () =>
      Promise.resolve(null),
    );
    let participants = 0;
    let tracks = 0;
    for (const { member } of await this.presentMembers(meeting)) {
      if (isAdminRole(member.role)) continue;
      const muted = await this.livekit.muteTracks(
        meeting.roomName,
        member.userId,
        kinds,
      );
      if (muted) participants += 1;
      tracks += muted;
    }
    return { participants, tracks };
  }

  /**
   * Trạng thái phòng cho giao diện: cài đặt, người đang có mặt (vai trò, mic/camera/màn hình, giơ tay)
   * và số người chờ duyệt (chỉ admin). Thành viên đã được vào mới xem được.
   */
  async getRoom(user: MeetingUser, id: string): Promise<RoomView> {
    const { meeting, member } = await this.activeMember(id, user.userId);
    const participants = (await this.presentMembers(meeting))
      .map(({ info, member }) => toParticipantView(info, member))
      .sort(compareParticipants);
    const lobbyCount = isAdminRole(member.role)
      ? await this.dataSource
          .getRepository(MeetingMemberEntity)
          .countBy({ meetingId: id, status: 'pending' })
      : null;
    return {
      meeting: toMeetingView(meeting, member),
      participants,
      lobbyCount,
    };
  }

  /**
   * Giơ tay: ghi vào participant attribute `handRaisedAt` (client không tự sửa được attribute),
   * mọi client nhận qua sự kiện attributesChanged. Giơ lại khi đang giơ giữ nguyên thứ tự cũ.
   */
  async raiseHand(user: MeetingUser, id: string) {
    const { meeting } = await this.activeMember(id, user.userId);
    const info = await this.livekit.findParticipant(
      meeting.roomName,
      user.userId,
    );
    if (!info) {
      throw new ConflictException('Bạn cần vào phòng họp trước khi giơ tay');
    }
    const existing = info.attributes?.[HAND_RAISED_ATTRIBUTE];
    if (existing) return { userId: user.userId, handRaisedAt: existing };
    const handRaisedAt = new Date().toISOString();
    await this.livekit.updateParticipant(meeting.roomName, user.userId, {
      attributes: { [HAND_RAISED_ATTRIBUTE]: handRaisedAt },
    });
    return { userId: user.userId, handRaisedAt };
  }

  /** Hạ tay của mình, hoặc admin hạ tay giúp người khác. */
  async lowerHand(user: MeetingUser, id: string, targetId: string) {
    const { meeting, member } = await this.activeMember(id, user.userId);
    if (targetId !== user.userId && !isAdminRole(member.role)) {
      throw new ForbiddenException(ADMIN_ONLY);
    }
    const applied = await this.livekit.updateParticipant(
      meeting.roomName,
      targetId,
      { attributes: { [HAND_RAISED_ATTRIBUTE]: '' } },
    );
    return { userId: targetId, handRaisedAt: null, applied };
  }

  /** Admin hạ tay tất cả. */
  async lowerAllHands(user: MeetingUser, id: string) {
    const { meeting, member } = await this.activeMember(id, user.userId);
    if (!isAdminRole(member.role)) throw new ForbiddenException(ADMIN_ONLY);
    let lowered = 0;
    for (const { info } of await this.presentMembers(meeting)) {
      if (!info.attributes?.[HAND_RAISED_ATTRIBUTE]) continue;
      await this.livekit.updateParticipant(meeting.roomName, info.identity, {
        attributes: { [HAND_RAISED_ATTRIBUTE]: '' },
      });
      lowered += 1;
    }
    return { lowered };
  }

  /** Chủ trì giao quyền chủ trì cho thành viên đã được vào; chủ trì cũ thành đồng chủ trì. */
  async transferHost(user: MeetingUser, id: string, targetId: string) {
    if (targetId === user.userId) {
      throw new BadRequestException('Bạn đang là chủ trì');
    }
    const { meeting, previous, next } = await this.dataSource.transaction(
      async (m) => {
        const meeting = await this.lockActiveMeeting(m, id);
        const members = m.getRepository(MeetingMemberEntity);
        const previous = await members.findOneBy({
          meetingId: id,
          userId: user.userId,
        });
        if (previous?.role !== 'host') {
          throw new ForbiddenException('Chỉ chủ trì được chuyển quyền chủ trì');
        }
        const next = await this.loadMember(m, id, targetId);
        if (next.isGuest) {
          throw new ConflictException('Khách không thể làm chủ trì');
        }
        if (next.status !== 'admitted') {
          throw new ConflictException(
            'Chỉ chuyển quyền cho người đã được vào cuộc họp',
          );
        }
        const now = new Date();
        // Gỡ chủ trì cũ trước: mỗi cuộc họp chỉ có một dòng role = 'host' (unique index).
        Object.assign(previous, {
          role: 'cohost',
          decidedAt: now,
          decidedBy: user.userId,
        });
        await members.save(previous);
        Object.assign(next, {
          role: 'host',
          canPublish: true,
          decidedAt: now,
          decidedBy: user.userId,
        });
        await members.save(next);
        meeting.hostId = targetId;
        await m.getRepository(MeetingEntity).save(meeting);
        return { meeting, previous, next };
      },
    );
    await this.announceRole(meeting, previous);
    await this.announceRole(meeting, next);
    return { previousHost: toMemberView(previous), host: toMemberView(next) };
  }

  // ---- helpers ----

  private async admitPending(
    m: EntityManager,
    id: string,
    user: MeetingUser,
  ): Promise<MeetingMemberEntity[]> {
    const members = m.getRepository(MeetingMemberEntity);
    const pending = await members.findBy({ meetingId: id, status: 'pending' });
    if (!pending.length) return [];
    const now = new Date();
    for (const member of pending) {
      member.status = 'admitted';
      member.decidedAt = now;
      member.decidedBy = user.userId;
    }
    return members.save(pending);
  }

  private async announceAdmitted(
    meeting: MeetingEntity,
    admitted: MeetingMemberEntity[],
  ) {
    for (const member of admitted) {
      await this.notify(meeting.roomName, MEETING_TOPICS.lobby, {
        type: 'lobby_updated',
        meetingId: meeting.id,
        userId: member.userId,
        status: member.status,
      });
    }
  }

  /** Tắt track thuộc nguồn bị cấm rồi cập nhật quyền cho người tham gia thường đang có mặt. */
  private async applyPermissions(meeting: MeetingEntity): Promise<boolean> {
    const blocked = blockedSources(meeting);
    for (const { member } of await this.presentMembers(meeting)) {
      if (isAdminRole(member.role)) continue;
      await this.livekit.muteSources(meeting.roomName, member.userId, blocked);
      await this.livekit.updateParticipant(meeting.roomName, member.userId, {
        permission: effectivePermission(meeting, member),
      });
    }
    return true;
  }

  /** Người đang ở trong phòng LiveKit kèm dòng thành viên đã được vào (bỏ qua egress/agent và người lạ). */
  private async presentMembers(meeting: MeetingEntity) {
    const present = (
      await this.livekit.listParticipants(meeting.roomName)
    ).filter((info) => UUID_PATTERN.test(info.identity));
    if (!present.length) return [];
    const members = await this.dataSource
      .getRepository(MeetingMemberEntity)
      .findBy({
        meetingId: meeting.id,
        status: 'admitted',
        userId: In(present.map((info) => info.identity.toLowerCase())),
      });
    const byId = new Map(members.map((member) => [member.userId, member]));
    return present.flatMap((info) => {
      const member = byId.get(info.identity.toLowerCase());
      return member ? [{ info, member }] : [];
    });
  }

  /** Cuộc họp đang diễn ra và dòng thành viên đã được vào của người dùng (không khóa dòng). */
  private async activeMember(id: string, userId: string) {
    const meeting = await this.dataSource
      .getRepository(MeetingEntity)
      .findOneBy({ id });
    if (!meeting) throw new NotFoundException(NOT_FOUND);
    if (meeting.status !== 'active') throw new NotFoundException(ENDED);
    const member = await this.dataSource
      .getRepository(MeetingMemberEntity)
      .findOneBy({ meetingId: id, userId });
    if (member?.status !== 'admitted') {
      throw new ForbiddenException('Bạn chưa được vào cuộc họp này');
    }
    return { meeting, member };
  }

  private async adminPhase<T>(
    user: MeetingUser,
    id: string,
    fn: (m: EntityManager, meeting: MeetingEntity) => Promise<T>,
  ): Promise<{ meeting: MeetingEntity; member: T }> {
    return this.dataSource.transaction(async (m) => {
      const meeting = await this.lockActiveMeeting(m, id);
      await this.assertAdmin(m, meeting, user);
      return { meeting, member: await fn(m, meeting) };
    });
  }

  private async lockMeeting(m: EntityManager, id: string) {
    const meeting = await m.getRepository(MeetingEntity).findOne({
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!meeting) throw new NotFoundException(NOT_FOUND);
    return meeting;
  }

  private async lockActiveMeeting(m: EntityManager, id: string) {
    const meeting = await this.lockMeeting(m, id);
    if (meeting.status !== 'active') throw new NotFoundException(ENDED);
    return meeting;
  }

  private async assertAdmin(
    m: EntityManager,
    meeting: MeetingEntity,
    user: MeetingUser,
  ) {
    const actor = await m
      .getRepository(MeetingMemberEntity)
      .findOneBy({ meetingId: meeting.id, userId: user.userId });
    if (!isAdminRole(actor?.role)) {
      throw new ForbiddenException(ADMIN_ONLY);
    }
  }

  private async loadMember(m: EntityManager, id: string, userId: string) {
    const member = await m
      .getRepository(MeetingMemberEntity)
      .findOneBy({ meetingId: id, userId });
    if (!member) {
      throw new NotFoundException('Người này chưa tham gia cuộc họp');
    }
    return member;
  }

  /** Mời ra/khóa phát chỉ áp dụng cho người tham gia thường. */
  private assertModerable(member: MeetingMemberEntity) {
    if (member.role === 'host') {
      throw new ForbiddenException('Không thể thao tác trên chủ trì');
    }
    if (member.role === 'cohost') {
      throw new ConflictException('Hãy thu hồi quyền đồng chủ trì trước');
    }
  }

  private async adminIds(m: EntityManager, id: string) {
    const admins = await m.getRepository(MeetingMemberEntity).find({
      where: { meetingId: id, role: In(['host', 'cohost']) },
    });
    return admins.map((admin) => admin.userId);
  }

  private async admittedResult(
    meeting: MeetingEntity,
    member: MeetingMemberEntity,
  ): Promise<JoinResult> {
    await this.livekit.ensureRoom({
      name: meeting.roomName,
      metadata: JSON.stringify({ meetingId: meeting.id, title: meeting.title }),
      emptyTimeout: numberEnv('MEETING_ROOM_EMPTY_TIMEOUT_SECONDS', 900),
      departureTimeout: numberEnv('MEETING_ROOM_DEPARTURE_TIMEOUT_SECONDS', 60),
      maxParticipants: meeting.maxParticipants,
    });
    const { token, expiresAt } = await this.livekit.createToken({
      identity: member.userId,
      name: member.displayName ?? undefined,
      metadata: participantMetadata(member),
      grant: {
        room: meeting.roomName,
        roomJoin: true,
        roomAdmin: false,
        canUpdateOwnMetadata: false,
        ...effectivePermission(meeting, member),
      },
    });
    return {
      status: 'admitted',
      meeting: toMeetingView(meeting, member),
      serverUrl: this.livekit.publicUrl,
      token,
      expiresAt,
      role: member.role,
    };
  }

  private async announceRole(
    meeting: MeetingEntity,
    member: MeetingMemberEntity,
  ) {
    await this.bestEffort('cập nhật vai trò trong phòng', () =>
      this.livekit.updateParticipant(meeting.roomName, member.userId, {
        metadata: participantMetadata(member),
        permission: effectivePermission(meeting, member),
      }),
    );
    await this.notify(meeting.roomName, MEETING_TOPICS.roles, {
      type: 'role_changed',
      meetingId: meeting.id,
      userId: member.userId,
      role: member.role,
    });
  }

  /**
   * Gọi LiveKit sau khi DB đã commit: lỗi không làm thất bại thao tác đã lưu.
   * Trả true khi đã áp dụng lên người đang trong phòng.
   */
  private async bestEffort(
    action: string,
    run: () => Promise<boolean>,
  ): Promise<boolean> {
    try {
      return await run();
    } catch (error) {
      this.logger.warn(`Không thể ${action}: ${String(error)}`);
      return false;
    }
  }

  /** Thông báo realtime là phụ: DB đã commit, client vẫn có thể hỏi lại qua API. */
  private async notify(
    roomName: string,
    topic: string,
    payload: Record<string, unknown>,
    destinationIdentities?: string[],
  ) {
    if (destinationIdentities && !destinationIdentities.length) return;
    try {
      await this.livekit.sendData(
        roomName,
        topic,
        payload,
        destinationIdentities,
      );
    } catch (error) {
      this.logger.warn(`Không gửi được thông báo ${topic}: ${String(error)}`);
    }
  }
}

/** Cuộc họp đã lên lịch và chưa tới giờ bắt đầu. */
function notStarted(meeting: MeetingEntity, now = new Date()) {
  return meeting.scheduledAt !== null && meeting.scheduledAt > now;
}

function muteKinds(input: { audio?: boolean; video?: boolean }): MuteKind[] {
  const kinds: MuteKind[] = [];
  if (input.audio ?? true) kinds.push('audio');
  if (input.video ?? false) kinds.push('video');
  if (!kinds.length) throw new BadRequestException('Chọn mic hoặc camera');
  return kinds;
}

function toSettings(meeting: MeetingEntity): MeetingSettings {
  return {
    locked: meeting.locked,
    waitingRoom: meeting.waitingRoom,
    allowMicrophone: meeting.allowMicrophone,
    allowCamera: meeting.allowCamera,
    allowScreenShare: meeting.allowScreenShare,
    allowChat: meeting.allowChat,
  };
}

function trackState(tracks: TrackInfo[], sources: TrackSource[]): TrackState {
  const matching = tracks.filter((track) => sources.includes(track.source));
  if (!matching.length) return 'off';
  return matching.some((track) => !track.muted) ? 'on' : 'muted';
}

function toParticipantView(
  info: ParticipantInfo,
  member: MeetingMemberEntity,
): ParticipantView {
  const joinedMs =
    Number(info.joinedAtMs ?? 0) || Number(info.joinedAt ?? 0) * 1000;
  return {
    userId: member.userId,
    name: member.displayName,
    isGuest: member.isGuest,
    role: member.role,
    canPublish: member.canPublish,
    joinedAt: joinedMs ? new Date(joinedMs).toISOString() : null,
    handRaisedAt: info.attributes?.[HAND_RAISED_ATTRIBUTE] || null,
    microphone: trackState(info.tracks ?? [], [TrackSource.MICROPHONE]),
    camera: trackState(info.tracks ?? [], [TrackSource.CAMERA]),
    screenShare: trackState(info.tracks ?? [], [TrackSource.SCREEN_SHARE]),
  };
}

const ROLE_ORDER: Record<MeetingRole, number> = {
  host: 0,
  cohost: 1,
  participant: 2,
};

/** null xếp sau giá trị. */
const compareNullable = (a: string | null, b: string | null) =>
  a === b ? 0 : a === null ? 1 : b === null ? -1 : a.localeCompare(b);

function compareParticipants(a: ParticipantView, b: ParticipantView) {
  return (
    ROLE_ORDER[a.role] - ROLE_ORDER[b.role] ||
    compareNullable(a.handRaisedAt, b.handRaisedAt) ||
    compareNullable(a.joinedAt, b.joinedAt)
  );
}

export function participantMetadata(member: MeetingMemberEntity) {
  return JSON.stringify({ role: member.role });
}

function toMeetingView(
  meeting: MeetingEntity,
  member: MeetingMemberEntity | null | undefined,
): MeetingView {
  return {
    id: meeting.id,
    title: meeting.title,
    hostId: meeting.hostId,
    waitingRoom: meeting.waitingRoom,
    maxParticipants: meeting.maxParticipants,
    status: meeting.status,
    settings: toSettings(meeting),
    scheduledAt: meeting.scheduledAt,
    joinUrl: meetingJoinUrl(meeting.id),
    createdAt: meeting.createdAt,
    endedAt: meeting.endedAt,
    myRole: member?.role ?? null,
    myStatus: member?.status ?? null,
  };
}

function toMemberView(member: MeetingMemberEntity): MemberView {
  return {
    userId: member.userId,
    name: member.displayName,
    isGuest: member.isGuest,
    role: member.role,
    status: member.status,
    canPublish: member.canPublish,
    requestedAt: member.requestedAt,
    decidedAt: member.decidedAt,
    decidedBy: member.decidedBy,
  };
}
