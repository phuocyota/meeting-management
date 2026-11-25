import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';

/**
 * Cấu hình HTTP dùng chung cho main.ts và e2e. App phải được tạo với `rawBody: true`.
 * LiveKit gửi webhook với Content-Type `application/webhook+json`; parser JSON mặc định chỉ nhận
 * `application/json`, nên phải khai báo thêm để có `rawBody` xác minh chữ ký.
 */
export function configureHttpApplication(app: NestExpressApplication) {
  app.useBodyParser('json', {
    type: ['application/json', 'application/webhook+json'],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
}
