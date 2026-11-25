import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MeetingAuthGuard } from './auth/auth.guard';
import { databaseOptions, envFilePaths, validateEnv } from './config/env';
import { MEETING_ENTITIES } from './database/entities';
import { HealthController } from './health/health.controller';
import { MeetingsModule } from './meetings/meetings.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    // Đọc .env riêng (nếu có) rồi tới .env của di-ichi-crm-services để dùng chung LiveKit và máy chủ DB.
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: envFilePaths(),
      validate: validateEnv,
    }),
    // Migration sở hữu schema (npm run migration:run); ứng dụng không synchronize.
    TypeOrmModule.forRootAsync({
      useFactory: () => ({
        ...databaseOptions(),
        entities: MEETING_ENTITIES,
        synchronize: false,
      }),
    }),
    MeetingsModule,
    UsersModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: MeetingAuthGuard }],
})
export class AppModule {}
