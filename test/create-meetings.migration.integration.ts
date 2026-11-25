import { PGlite } from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import type { QueryRunner } from 'typeorm';
import { CreateMeetings1764000000000 } from '../src/database/migrations/1764000000000-CreateMeetings';

const M = '11111111-1111-4111-8111-111111111111';
const U1 = '00000000-0000-4000-8000-000000000001';
const U2 = '00000000-0000-4000-8000-000000000002';

/** Chạy migration trên PostgreSQL thật (PGlite) để kiểm ràng buộc mà pg-mem không kiểm được. */
void describe('CreateMeetings migration', () => {
  let pg: PGlite;
  let runner: QueryRunner;
  const migration = new CreateMeetings1764000000000();

  beforeEach(async () => {
    pg = new PGlite();
    runner = {
      query: (sql: string) => pg.query(sql),
    } as unknown as QueryRunner;
    await migration.up(runner);
    await pg.query(
      `INSERT INTO meetings (id, room_name, title, host_id, max_participants)
       VALUES ($1, $2, 'A', $3, 10)`,
      [M, `meeting-${M}`, U1],
    );
  });

  afterEach(async () => {
    await pg.close();
  });

  const addMember = (userId: string, role: string, status: string) =>
    pg.query(
      `INSERT INTO meeting_members (meeting_id, user_id, role, status) VALUES ($1, $2, $3, $4)`,
      [M, userId, role, status],
    );

  void it('mỗi cuộc họp chỉ có một chủ trì', async () => {
    await addMember(U1, 'host', 'admitted');
    await assert.rejects(
      addMember(U2, 'host', 'admitted'),
      /uq_meeting_members_host/,
    );
  });

  void it('admin phải ở trạng thái admitted; vai trò/trạng thái lạ bị từ chối', async () => {
    await assert.rejects(
      addMember(U2, 'cohost', 'pending'),
      /chk_meeting_members_admin_admitted/,
    );
    await assert.rejects(
      addMember(U2, 'owner', 'admitted'),
      /chk_meeting_members_role/,
    );
    await assert.rejects(
      addMember(U2, 'participant', 'waiting'),
      /chk_meeting_members_status/,
    );
    await addMember(U2, 'participant', 'pending');
  });

  void it('kết thúc phải có ended_at', async () => {
    await assert.rejects(
      pg.query(`UPDATE meetings SET status = 'ended' WHERE id = $1`, [M]),
      /chk_meetings_ended/,
    );
    await pg.query(
      `UPDATE meetings SET status = 'ended', ended_at = now() WHERE id = $1`,
      [M],
    );
  });

  void it('xóa cuộc họp xóa thành viên; down gỡ sạch bảng', async () => {
    await addMember(U1, 'host', 'admitted');
    await pg.query(`DELETE FROM meetings WHERE id = $1`, [M]);
    const left = await pg.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM meeting_members`,
    );
    assert.equal(left.rows[0].n, 0);

    await migration.down(runner);
    const tables = await pg.query(
      `SELECT 1 FROM information_schema.tables WHERE table_name IN ('meetings', 'meeting_members')`,
    );
    assert.equal(tables.rows.length, 0);
  });
});
