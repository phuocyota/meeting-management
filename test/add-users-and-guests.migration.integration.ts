import { PGlite } from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import type { QueryRunner } from 'typeorm';
import { CreateMeetings1764000000000 } from '../src/database/migrations/1764000000000-CreateMeetings';
import { AddMeetingControls1764100000000 } from '../src/database/migrations/1764100000000-AddMeetingControls';
import { AddUsersAndGuests1764200000000 } from '../src/database/migrations/1764200000000-AddUsersAndGuests';

const M = '11111111-1111-4111-8111-111111111111';
const U1 = '00000000-0000-4000-8000-000000000001';
const U2 = '00000000-0000-4000-8000-000000000002';

void describe('AddUsersAndGuests migration', () => {
  let pg: PGlite;
  let runner: QueryRunner;
  const migration = new AddUsersAndGuests1764200000000();

  beforeEach(async () => {
    pg = new PGlite();
    runner = {
      query: (sql: string) => pg.query(sql),
    } as unknown as QueryRunner;
    await new CreateMeetings1764000000000().up(runner);
    await new AddMeetingControls1764100000000().up(runner);
    await pg.query(
      `INSERT INTO meetings (id, room_name, title, host_id, max_participants)
       VALUES ($1, $2, 'A', $3, 10)`,
      [M, `meeting-${M}`, U1],
    );
    await migration.up(runner);
  });

  afterEach(async () => {
    await pg.close();
  });

  const addUser = (
    id: string,
    username: string,
    createdBy: string | null = null,
  ) =>
    pg.query(
      `INSERT INTO users (id, name, username, password, created_by) VALUES ($1, 'N', $2, 'h', $3)`,
      [id, username, createdBy],
    );

  void it('tên đăng nhập duy nhất, chữ thường; xóa người tạo thì created_by về null', async () => {
    await addUser(U1, 'admin');
    await assert.rejects(addUser(U2, 'admin'), /uq_users_username/);
    await assert.rejects(addUser(U2, 'Admin'), /chk_users_username_lower/);
    await addUser(U2, 'lan', U1);
    await pg.query(`DELETE FROM users WHERE id = $1`, [U1]);
    const row = await pg.query<{ created_by: string | null }>(
      `SELECT created_by FROM users WHERE id = $1`,
      [U2],
    );
    assert.equal(row.rows[0].created_by, null);
  });

  void it('khách chỉ được là người tham gia thường', async () => {
    await assert.rejects(
      pg.query(
        `INSERT INTO meeting_members (meeting_id, user_id, role, status, is_guest) VALUES ($1, $2, 'cohost', 'admitted', true)`,
        [M, U2],
      ),
      /chk_meeting_members_guest_participant/,
    );
    await pg.query(
      `INSERT INTO meeting_members (meeting_id, user_id, role, status, is_guest, display_name) VALUES ($1, $2, 'participant', 'pending', true, 'Khách')`,
      [M, U2],
    );
  });

  void it('down khôi phục branch_id và gỡ bảng users', async () => {
    await migration.down(runner);
    const users = await pg.query(
      `SELECT 1 FROM information_schema.tables WHERE table_name = 'users'`,
    );
    assert.equal(users.rows.length, 0);
    const branch = await pg.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name = 'meetings' AND column_name = 'branch_id'`,
    );
    assert.equal(branch.rows.length, 1);
  });
});
