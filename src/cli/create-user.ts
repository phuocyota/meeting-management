import { DataSource } from 'typeorm';
import { databaseOptions, loadEnvFiles } from '../config/env';
import { MEETING_ENTITIES } from '../database/entities';
import { UsersService } from '../users/users.service';

/**
 * Tạo tài khoản từ dòng lệnh (dùng cho tài khoản đầu tiên):
 *   MEETING_USER_PASSWORD='...' npm run user:create -- --username admin --name "Quản trị"
 * Mật khẩu đọc từ biến môi trường để không lưu vào lịch sử shell.
 */
async function main() {
  loadEnvFiles();
  const args = process.argv.slice(2);
  const flag = (name: string) => {
    const index = args.indexOf(`--${name}`);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const username = flag('username')?.trim().toLowerCase();
  const name = flag('name')?.trim();
  const password = process.env.MEETING_USER_PASSWORD ?? '';
  if (!username || !name || password.length < 8) {
    console.error(
      'Cách dùng: MEETING_USER_PASSWORD=<tối thiểu 8 ký tự> npm run user:create -- --username <tên đăng nhập> --name "<tên hiển thị>"',
    );
    process.exitCode = 1;
    return;
  }
  if (!/^[a-z0-9._-]{3,50}$/.test(username)) {
    console.error('Tên đăng nhập 3-50 ký tự: chữ thường, số, . _ -');
    process.exitCode = 1;
    return;
  }
  const dataSource = new DataSource({
    ...databaseOptions(),
    entities: MEETING_ENTITIES,
    synchronize: false,
  });
  await dataSource.initialize();
  try {
    const user = await new UsersService(dataSource).create(null, {
      username,
      name,
      password,
    });
    console.log(`Đã tạo tài khoản ${user.username} (${user.id})`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    await dataSource.destroy();
  }
}

void main();
