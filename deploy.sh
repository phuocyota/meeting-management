#!/usr/bin/env bash
# Deploy meeting-management trên server: pull, cài dependencies, build, migrate DB meeting, reload PM2, kiểm tra /health.
# Cần sao lưu database meeting trước khi deploy thay đổi schema.
set -euo pipefail
cd "$(dirname "$0")"

APP_NAME=meeting-management

echo "👉 Pull code..."
git pull --ff-only

echo "👉 Cài/cập nhật dependencies..."
npm install --no-audit --no-fund

echo "👉 Build..."
npm run build

# Đọc cổng và tên DB theo đúng thứ tự nạp env của service (env thật → .env riêng → ENV_FILE của CRM).
read -r MEETING_PORT_RESOLVED MEETING_DB_RESOLVED < <(node -e "
  const env = require('./dist/config/env');
  env.loadEnvFiles();
  console.log(env.meetingPort(), env.databaseOptions().database);
")

echo "👉 Áp dụng migrations vào database meeting: ${MEETING_DB_RESOLVED}..."
npm run migration:run

echo "👉 Reload PM2 (${APP_NAME})..."
pm2 startOrReload ecosystem.config.js --env production --update-env
pm2 save >/dev/null 2>&1 || true

echo "👉 Kiểm tra http://127.0.0.1:${MEETING_PORT_RESOLVED}/health..."
for _ in $(seq 1 30); do
  body=$(curl -fsS "http://127.0.0.1:${MEETING_PORT_RESOLVED}/health" 2>/dev/null || true)
  if [[ "$body" == *'"status":"ok"'* ]]; then
    echo "   $body"
    echo "✅ Deploy thành công!"
    exit 0
  fi
  sleep 1
done

echo "❌ /health không trả status ok sau 30 giây. Phản hồi cuối: ${body:-<không có>}" >&2
echo "   Xem log: pm2 logs ${APP_NAME} --lines 100" >&2
exit 1
