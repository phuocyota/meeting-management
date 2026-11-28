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
    // synchronize: khi khởi động, TypeORM sửa schema theo entity. Mọi ràng buộc (check, unique, khóa ngoại)
    // phải khai báo trong entity cùng tên với migration, nếu không synchronize sẽ xoá chúng.
    // Kiểm tra trước khi đổi entity: schemaBuilder.log() chỉ được ra các câu ADD mong muốn.
    TypeOrmModule.forRootAsync({
      useFactory: () => ({
        ...databaseOptions(),
        entities: MEETING_ENTITIES,
        synchronize: true,
      }),
    }),
    MeetingsModule,
    UsersModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: MeetingAuthGuard }],
})
export class AppModule {}
