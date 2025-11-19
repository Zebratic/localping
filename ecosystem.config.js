module.exports = {
  apps: [
    {
      name: 'localping',
      script: './src/app.js',
      args: '--mode all',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        API_PORT: 8000,
        ADMIN_PORT: 8000,
        PUBLIC_PORT: 8000,
      },
      error_file: './logs/error.log',
      out_file: './logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
    },
  ],
};
