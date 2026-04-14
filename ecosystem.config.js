module.exports = {
  apps: [{
    name: 'lexiang',
    script: 'server.js',
    instances: 1,
    max_memory_restart: '512M',
    env: { NODE_ENV: 'production', PORT: 3001 },
    error_file: './logs/error.log',
    out_file: './logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    restart_delay: 3000,
    max_restarts: 10,
    health_check_grace_period: 5000,
  }]
};
