import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { configureHttpApplication } from './http-app';

async function bootstrap() {
  // rawBody: webhook LiveKit cần body gốc để xác minh chữ ký.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });

  const origins =
    process.env.MEETING_CORS_ORIGIN?.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean) ?? [];
  app.enableCors({
    origin: origins.length ? origins : true,
    credentials: true,
  });
  configureHttpApplication(app);

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Di-Ichi Meeting API')
    .setDescription('Service quản lý cuộc họp trực tuyến dùng chung LiveKit')
    .setVersion('1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'access-token',
    )
    .build();
  SwaggerModule.setup(
    'swagger',
    app,
    SwaggerModule.createDocument(app, swaggerConfig),
  );

  // ConfigModule đã nạp .env khi tạo app, nên đọc cổng sau NestFactory.create.
  // .env của CRM cũng có PORT (3004): production đặt PORT trong ecosystem.config.js để không trùng.
  await app.listen(process.env.PORT || 3005);
}
void bootstrap();
