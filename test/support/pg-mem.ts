import { DataType, newDb } from 'pg-mem';
import type { DataSource } from 'typeorm';
import { MEETING_ENTITIES } from '../../src/database/entities';

/**
 * DataSource TypeORM trên pg-mem cho unit/e2e test (không cần PostgreSQL thật).
 * pg-mem không chứng minh được khóa dòng/đồng thời; ràng buộc schema được kiểm ở migration spec (PGlite).
 */
export async function createTestDataSource(): Promise<DataSource> {
  const db = newDb({ autoCreateForeignKeyIndices: true });
  db.public.registerFunction({
    name: 'current_database',
    implementation: () => 'diichi_meeting_test',
  });
  db.public.registerFunction({
    name: 'version',
    implementation: () => 'PostgreSQL 16',
  });
  db.public.registerFunction({
    name: 'quote_ident',
    args: [DataType.text],
    returns: DataType.text,
    implementation: (value: string) => value,
  });
  db.public.registerFunction({
    name: 'obj_description',
    args: [DataType.regclass, DataType.text],
    returns: DataType.text,
    implementation: () => null,
  });
  const dataSource = db.adapters.createTypeormDataSource({
    type: 'postgres',
    entities: MEETING_ENTITIES,
    synchronize: true,
  }) as DataSource;
  await dataSource.initialize();
  return dataSource;
}
