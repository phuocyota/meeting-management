import {
  type CreateOptions,
  type ParticipantInfo,
  TrackSource,
  TrackType,
  type VideoGrant,
} from 'livekit-server-sdk';
import type { LiveKitService } from '../../src/livekit/livekit.service';

export interface IssuedToken {
  identity: string;
  metadata?: string;
  grant: VideoGrant;
}

/** LiveKit giả: ghi lại mọi lệnh gọi để test kiểm tra. */
export function createFakeLiveKit() {
  const calls = {
    rooms: [] as CreateOptions[],
    tokens: [] as IssuedToken[],
    removed: [] as Array<{ room: string; identity: string }>,
    updated: [] as Array<{ room: string; identity: string; update: unknown }>,
    muted: [] as Array<{ room: string; identity: string; kinds: string[] }>,
    mutedSources: [] as Array<{
      room: string;
      identity: string;
      sources: TrackSource[];
    }>,
    data: [] as Array<{
      room: string;
      topic: string;
      payload: unknown;
      to?: string[];
    }>,
    deleted: [] as string[],
  };
  /** Người đang có mặt theo phòng; test thêm bằng `present(room, identity, sources)`. */
  const rooms = new Map<string, Map<string, ParticipantInfo>>();
  const present = (
    room: string,
    identity: string,
    sources: TrackSource[] = [],
    joinedAtMs = Date.now(),
  ) => {
    const participants = rooms.get(room) ?? new Map<string, ParticipantInfo>();
    rooms.set(room, participants);
    const info = {
      identity,
      attributes: {} as Record<string, string>,
      joinedAt: BigInt(Math.floor(joinedAtMs / 1000)),
      joinedAtMs: BigInt(joinedAtMs),
      tracks: sources.map((source, index) => ({
        sid: `TR_${identity}_${index}`,
        source,
        muted: false,
        type:
          source === TrackSource.MICROPHONE ||
          source === TrackSource.SCREEN_SHARE_AUDIO
            ? TrackType.AUDIO
            : TrackType.VIDEO,
      })),
    } as unknown as ParticipantInfo;
    participants.set(identity, info);
    return info;
  };
  const find = (room: string, identity: string) =>
    rooms.get(room)?.get(identity) ?? null;
  const fake = {
    publicUrl: 'wss://livekit.example',
    ensureRoom: jest.fn((options: CreateOptions) => {
      calls.rooms.push(options);
      return Promise.resolve({ name: options.name });
    }),
    deleteRoom: jest.fn((name: string) => {
      calls.deleted.push(name);
      return Promise.resolve();
    }),
    removeParticipant: jest.fn((room: string, identity: string) => {
      calls.removed.push({ room, identity });
      return Promise.resolve(true);
    }),
    listParticipants: jest.fn((room: string) =>
      Promise.resolve([...(rooms.get(room)?.values() ?? [])]),
    ),
    findParticipant: jest.fn((room: string, identity: string) =>
      Promise.resolve(find(room, identity)),
    ),
    muteSources: jest.fn(
      (room: string, identity: string, sources: TrackSource[]) => {
        if (!sources.length) return Promise.resolve(0);
        calls.mutedSources.push({ room, identity, sources });
        const tracks = (find(room, identity)?.tracks ?? []).filter(
          (track) => sources.includes(track.source) && !track.muted,
        );
        for (const track of tracks) track.muted = true;
        return Promise.resolve(tracks.length);
      },
    ),
    updateParticipant: jest.fn(
      (
        room: string,
        identity: string,
        update: { attributes?: Record<string, string> },
      ) => {
        calls.updated.push({ room, identity, update });
        const info = find(room, identity);
        for (const [key, value] of Object.entries(update.attributes ?? {})) {
          if (!info) break;
          if (value) info.attributes[key] = value;
          else delete info.attributes[key];
        }
        return Promise.resolve(true);
      },
    ),
    muteTracks: jest.fn((room: string, identity: string, kinds: string[]) => {
      calls.muted.push({ room, identity, kinds });
      return Promise.resolve(kinds.length);
    }),
    sendData: jest.fn(
      (room: string, topic: string, payload: unknown, to?: string[]) => {
        calls.data.push({ room, topic, payload, to });
        return Promise.resolve();
      },
    ),
    createToken: jest.fn((input: IssuedToken) => {
      calls.tokens.push(input);
      return Promise.resolve({ token: 'jwt', expiresAt: 'later' });
    }),
  };
  return {
    livekit: fake as unknown as LiveKitService,
    fake,
    calls,
    present,
  };
}
