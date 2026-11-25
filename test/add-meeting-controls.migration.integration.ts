import { PGlite } from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import type { QueryRunner } from 'typeorm';
import { CreateMeetings1764000000000 } from '../src/database/migrations/1764000000000-CreateMeetings';
import { AddMeetingControls1764100000000 } from '../src/database/migrations/1764100000000-AddMeetingControls';

const M = '11111111-1111-4111-8111-111111111111';
const U1 = '00000000-0000-4000-8000-000000000001';
const COLUMNS = [
  'locked',
  'allow_microphone',
  'allow_camera',
  'allow_screen_share',
  'allow_chat',
];

/** Migration cài đặt điều khiển phòng chạy được trên dữ liệu cũ và gỡ sạch. */
void describe('AddMeetingControls migration', () => {
  let pg: PGlite;
  let runner: QueryRunner;
  const migration = new AddMeetingControls1764100000000();

  beforeEach(async () => {
    pg = new PGlite();
    runner = {
      query: (sql: string) => pg.query(sql),
    } as unknown as QueryRunner;
    await new CreateMeetings1764000000000().up(runner);
    // Cuộc họp tạo trước migration phải nhận giá trị mặc định.
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

  void it('dữ liệu cũ: không khóa, cho phép mọi thứ', async () => {
    const row = await pg.query<Record<string, boolean>>(
      `SELECT ${COLUMNS.join(', ')} FROM meetings WHERE id = $1`,
      [M],
    );
    assert.deepEqual(row.rows[0], {
      locked: false,
      allow_microphone: true,
      allow_camera: true,
      allow_screen_share: true,
      allow_chat: true,
    });
    await assert.rejects(
      pg.query(`UPDATE meetings SET locked = NULL WHERE id = $1`, [M]),
      /null value/,
    );
  });

  void it('down gỡ sạch cột', async () => {
    await migration.down(runner);
    const cols = await pg.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'meetings' AND column_name = ANY($1)`,
      [COLUMNS],
    );
    assert.equal(cols.rows.length, 0);
  });
});
