import { DataSource } from 'typeorm';
import { databaseOptions, loadEnvFiles } from '../config/env';
import { MEETING_ENTITIES } from './entities';

// Data source cho TypeORM CLI (migration:run/revert); ứng dụng dùng TypeOrmModule trong AppModule.
loadEnvFiles();

export default new DataSource({
  ...databaseOptions(),
  entities: MEETING_ENTITIES,
  migrations: [`${__dirname}/migrations/*{.ts,.js}`],
  synchronize: false,
});
