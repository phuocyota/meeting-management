// Cấu hình PM2 cho meeting-management. Cổng lấy theo PORT trong env (meeting-management/.env).
module.exports = {
  apps: [
    {
      name: 'meeting-management',
      cwd: __dirname,
      script: 'dist/main.js',
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      kill_timeout: 10000,
      listen_timeout: 10000,
      time: true,
      merge_logs: true,
      error_file: 'logs/pm2-error.log',
      out_file: 'logs/pm2-out.log',
      env: {
        NODE_ENV: 'development',
      },
      env_production: {
        NODE_ENV: 'production',
      },
    },
  ],
};
