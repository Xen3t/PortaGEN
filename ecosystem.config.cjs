// ============================================================
// Configuration PM2 — PortaGEN
// Modèle d'origine : baseDocs/ecosystem.config.example.cjs
//
// MÉTHODE DE LANCEMENT
//
// 0. Installation (une seule fois, sur ce poste) :
//        npm install -g pm2
//
// 1. Premier lancement :
//    - Fermer toute fenêtre PortaGEN déjà ouverte (les .bat utilisent
//      aussi le port 3302 : un seul serveur à la fois).
//        npm run build
//        pm2 start ecosystem.config.cjs
//        pm2 save
//    → L'application tourne en arrière-plan sur http://localhost:3302
//      (aucune fenêtre à laisser ouverte).
//
// 2. Au quotidien :
//        pm2 status              → voir si PortaGEN tourne
//        pm2 logs PortaGEN       → voir les messages du serveur
//        pm2 restart PortaGEN    → redémarrer
//        pm2 stop PortaGEN       → arrêter
//
// 3. Mise à jour du code (RÈGLE : jamais de build pendant que le
//    serveur tourne) :
//        pm2 stop PortaGEN
//        npm run build
//        pm2 restart PortaGEN
//
// 4. (Optionnel) Relancer PortaGEN tout seul au démarrage de Windows :
//        npm install -g pm2-windows-startup
//        pm2-startup install
//        pm2 save
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
