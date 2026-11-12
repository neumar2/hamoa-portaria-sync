const fs = require('fs');
const path = require('path');

// Carrega variáveis de ambiente do arquivo .env sem necessidade de dependências externas
function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    try {
      const content = fs.readFileSync(envPath, 'utf-8');
      const lines = content.split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx > 0) {
          const key = trimmed.slice(0, eqIdx).trim();
          let val = trimmed.slice(eqIdx + 1).trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          if (!(key in process.env)) {
            process.env[key] = val;
          }
        }
      }
    } catch (e) {
      console.warn('[CONFIG] Aviso: Não foi possível ler o arquivo .env:', e.message);
    }
  }
}

loadEnv();

module.exports = {
  PORT: process.env.PORT ? parseInt(process.env.PORT, 10) : 3344,
  MDC_SQL_SERVER: process.env.MDC_SQL_SERVER || 'localhost\\SQLEXPRESS',
  MDC_SQL_DATABASE: process.env.MDC_SQL_DATABASE || 'MDC4WEBDB',
  MDC_SQL_USER: process.env.MDC_SQL_USER || 'sa',
  MDC_SQL_PASSWORD: process.env.MDC_SQL_PASSWORD || '',
  GOOGLE_SHEET_ID: process.env.GOOGLE_SHEET_ID || '',
  SYNC_INTERVAL_MINUTES: process.env.SYNC_INTERVAL_MINUTES ? parseInt(process.env.SYNC_INTERVAL_MINUTES, 10) : 60,
  MDC_WEB_HOST: process.env.MDC_WEB_HOST || 'localhost',
  MDC_WEB_PORT: process.env.MDC_WEB_PORT ? parseInt(process.env.MDC_WEB_PORT, 10) : 8888,
  MDC_BACKUP_PATH: process.env.MDC_BACKUP_PATH || ''
};
