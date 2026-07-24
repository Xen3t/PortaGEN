// ============================================================
// Configuration PM2 — PortaGEN
//
// - Copier ce fichier à la racine du projet en `ecosystem.config.cjs`
// - Lancer `npm run build`
// - Lancer `pm2 start ecosystem.config.cjs`, puis `pm2 save`
// ============================================================

module.exports = {
  apps: [
    {
      name: 'PortaGEN',
      cwd: __dirname,
      exec_mode: 'fork',
      instances: 1,
      time: true,
      merge_logs: true,
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3302',
      env: { NODE_ENV: 'production' },
    },
  ],
};
