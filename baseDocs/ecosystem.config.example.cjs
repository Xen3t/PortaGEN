// ============================================================
// Template PM2 — déploiement Windows
//
// - Copier ce fichier à la racine du projet en `ecosystem.config.cjs`
// - Utiliser l'extension .cjs (fonctionne même si le package.json
//   contient "type": "module")
// - Décommenter UNE SEULE variante selon le type de projet
// - Adapter `name` et le port
// ============================================================

module.exports = {
  apps: [
    {
      name: 'mon-projet',            // unique dans `pm2 list`
      cwd: __dirname,
      exec_mode: 'fork',
      instances: 1,
      max_memory_restart: '500M',
      time: true,
      merge_logs: true,
      out_file: './logs/out.log',
      error_file: './logs/err.log',

      // --- A) Next.js -------------------------------------------------
      // script: 'node_modules/next/dist/bin/next',
      // args: 'start -p 3001',
      // env: { NODE_ENV: 'production' },

      // --- B) Node / Express (pur, ou Vite+Express après `npm run build`) ---
      // script: 'server.js',
      // env: { NODE_ENV: 'production', PORT: 3001 },
    },
  ],
};
