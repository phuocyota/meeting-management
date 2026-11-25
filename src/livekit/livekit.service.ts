import {
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  AccessToken,
  type CreateOptions,
  DataPacket_Kind,
  type ParticipantInfo,
  type ParticipantPermission,
  type Room,
  RoomServiceClient,
  type TrackInfo,
  TrackSource,
  TrackType,
  TwirpError,
  type VideoGrant,
  type WebhookEvent,
  WebhookReceiver,
} from 'livekit-server-sdk';
import { liveKitWebhookCredentials, numberEnv } from '../config/env';

interface LiveKitCredentials {
  apiKey: string;
  apiSecret: string;
  publicUrl: string;
  internalUrl: string;
}

export type MuteKind = 'audio' | 'video';

const isNotFound = (error: unknown) =>
  error instanceof TwirpError && error.code === 'not_found';

/** Client LiveKit dùng chung biến `LIVEKIT_*` với di-ichi-crm-services. */
@Injectable()
export class LiveKitService {
  private readonly logger = new Logger(LiveKitService.name);
  private client?: RoomServiceClient;

  get publicUrl(): string {
    return this.credentials().publicUrl;
  }

  get tokenTtlSeconds(): number {
    return numberEnv('LIVEKIT_TOKEN_TTL_SECONDS', 7200);
  }

  /** LiveKit trả phòng hiện có nếu tên đã tồn tại, nên gọi lặp lại vẫn an toàn. */
  async ensureRoom(options: CreateOptions): Promise<Room> {
    try {
      return await this.roomClient().createRoom(options);
    } catch (error) {
      this.connectionError('tạo phòng LiveKit', error);
    }
  }

  async deleteRoom(name: string): Promise<void> {
    try {
      await this.roomClient().deleteRoom(name);
    } catch (error) {
      // Phòng đã tự đóng hoặc đã bị xóa vẫn coi là thành công.
      if (isNotFound(error)) return;
      this.connectionError('đóng phòng LiveKit', error);
    }
  }

  /** Trả false khi người đó không còn trong phòng. */
  async removeParticipant(room: string, identity: string): Promise<boolean> {
    try {
      await this.roomClient().removeParticipant(room, identity);
      return true;
    } catch (error) {
      if (isNotFound(error)) return false;
      this.connectionError('mời người tham gia ra khỏi phòng', error);
    }
  }

  async findParticipant(
    room: string,
    identity: string,
  ): Promise<ParticipantInfo | null> {
    try {
      return await this.roomClient().getParticipant(room, identity);
    } catch (error) {
      if (isNotFound(error)) return null;
      this.connectionError('đọc người tham gia', error);
    }
  }

  /** Người đang có mặt trong phòng; phòng chưa mở hoặc đã đóng trả mảng rỗng. */
  async listParticipants(room: string): Promise<ParticipantInfo[]> {
    try {
      return await this.roomClient().listParticipants(room);
    } catch (error) {
      if (isNotFound(error)) return [];
      this.connectionError('đọc danh sách người trong phòng', error);
    }
  }

  /** Tắt các track đang phát theo nguồn (mic, camera, màn hình); trả số track đã tắt. */
  async muteSources(
    room: string,
    identity: string,
    sources: TrackSource[],
  ): Promise<number> {
    if (!sources.length) return 0;
    const participant = await this.findParticipant(room, identity);
    if (!participant) return 0;
    const wanted = new Set(sources);
    return this.muteMatching(
      room,
      identity,
      participant.tracks.filter(
        (track) => wanted.has(track.source) && !track.muted,
      ),
    );
  }

  /** Tắt các track đang phát theo loại; trả số track đã tắt. */
  async muteTracks(
    room: string,
    identity: string,
    kinds: MuteKind[],
  ): Promise<number> {
    const participant = await this.findParticipant(room, identity);
    if (!participant) return 0;
    const types = new Set<TrackType>(
      kinds.map((kind) =>
        kind === 'audio' ? TrackType.AUDIO : TrackType.VIDEO,
      ),
    );
    return this.muteMatching(
      room,
      identity,
      participant.tracks.filter(
        (track) => types.has(track.type) && !track.muted,
      ),
    );
  }

  private async muteMatching(
    room: string,
    identity: string,
    tracks: TrackInfo[],
  ): Promise<number> {
    try {
      for (const track of tracks) {
        await this.roomClient().mutePublishedTrack(
          room,
          identity,
          track.sid,
          true,
        );
      }
    } catch (error) {
      if (isNotFound(error)) return 0;
      this.connectionError('tắt mic/camera', error);
    }
    return tracks.length;
  }

  /** Cập nhật quyền/metadata của người đang ở trong phòng; trả false nếu họ không có mặt. */
  async updateParticipant(
    room: string,
    identity: string,
    update: {
      metadata?: string;
      permission?: Partial<ParticipantPermission>;
      /** Chỉ các khóa được gửi mới đổi; chuỗi rỗng là xóa khóa. */
      attributes?: Record<string, string>;
    },
  ): Promise<boolean> {
    try {
      await this.roomClient().updateParticipant(room, identity, update);
      return true;
    } catch (error) {
      if (isNotFound(error)) return false;
      this.connectionError('cập nhật người tham gia', error);
    }
  }

  async sendData(
    room: string,
    topic: string,
    payload: unknown,
    destinationIdentities?: string[],
  ): Promise<void> {
    try {
      await this.roomClient().sendData(
        room,
        new TextEncoder().encode(JSON.stringify(payload)),
        DataPacket_Kind.RELIABLE,
        { topic, destinationIdentities },
      );
    } catch (error) {
      if (isNotFound(error)) return;
      this.connectionError('gửi thông báo vào phòng', error);
    }
  }

  async createToken(input: {
    identity: string;
    name?: string;
    metadata?: string;
    grant: VideoGrant;
  }): Promise<{ token: string; expiresAt: string }> {
    const { apiKey, apiSecret } = this.credentials();
    const ttl = this.tokenTtlSeconds;
    const accessToken = new AccessToken(apiKey, apiSecret, {
      identity: input.identity,
      name: input.name,
      metadata: input.metadata,
      ttl,
    });
    accessToken.addGrant(input.grant);
    return {
      token: await accessToken.toJwt(),
      expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
    };
  }

  /**
   * Xác minh chữ ký webhook bằng cặp riêng LIVEKIT_WEBHOOK_API_KEY/SECRET (LiveKit server ký mọi
   * webhook bằng `webhook.api_key`), không dùng cặp LIVEKIT_API_* để gọi API và sinh token.
   */
  async receiveWebhook(
    body: string,
    authorization?: string,
  ): Promise<WebhookEvent> {
    const credentials = liveKitWebhookCredentials();
    if (!credentials) {
      this.logger.error(
        'Nhận webhook nhưng chưa cấu hình LIVEKIT_WEBHOOK_API_KEY/LIVEKIT_WEBHOOK_API_SECRET',
      );
      // 503 để LiveKit server gửi lại sau khi đã cấu hình.
      throw new ServiceUnavailableException(
        'Webhook LiveKit chưa được cấu hình',
      );
    }
    const { apiKey, apiSecret } = credentials;
    try {
      return await new WebhookReceiver(apiKey, apiSecret).receive(
        body,
        authorization,
      );
    } catch {
      throw new UnauthorizedException('Chữ ký webhook LiveKit không hợp lệ');
    }
  }

  private roomClient(): RoomServiceClient {
    if (!this.client) {
      const { internalUrl, apiKey, apiSecret } = this.credentials();
      this.client = new RoomServiceClient(internalUrl, apiKey, apiSecret);
    }
    return this.client;
  }

  private credentials(): LiveKitCredentials {
    const apiKey = process.env.LIVEKIT_API_KEY?.trim();
    const apiSecret = process.env.LIVEKIT_API_SECRET?.trim();
    const publicUrl = process.env.LIVEKIT_PUBLIC_URL?.trim();
    const internalUrl = process.env.LIVEKIT_URL?.trim() || publicUrl;
    if (!apiKey || !apiSecret || !publicUrl || !internalUrl) {
      throw new InternalServerErrorException(
        'LiveKit credentials chưa được cấu hình',
      );
    }
    return { apiKey, apiSecret, publicUrl, internalUrl };
  }

  private connectionError(action: string, error: unknown): never {
    this.logger.error(`Không thể ${action}: ${String(error)}`);
    throw new ServiceUnavailableException('Không thể kết nối LiveKit');
  }
}
