import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Modules natifs / WASM : ne doivent pas être bundlés par Next, chargés côté Node.
  // mupdf (WASM) sert à convertir les moodboards PDF des gammes en image (bloc 3.5).
  // exiftool-vendored pilote un exiftool.exe externe : bundlé par Turbopack (DEV),
  // il ne retrouve plus son binaire et le marquage IA reste suspendu sans erreur.
  serverExternalPackages: ['better-sqlite3', 'sharp', 'onnxruntime-node', 'mupdf', 'exiftool-vendored'],
  // Bloc 3.5 (13/07/2026) : « Créer » (ancien flux guidé de MES) est repris par le
  // catalogue → on redirige l'ancienne URL vers le catalogue. Redirection TEMPORAIRE
  // (307) : la page creer/ reste sur le disque, rien n'est supprimé (repo hors Git).
  async redirects() {
    return [
      { source: '/creer', destination: '/catalogue', permanent: false },
      // 22/07/2026 : la page Décors quitte l'adresse historique /bibliotheque.
      { source: '/bibliotheque', destination: '/decors', permanent: false },
    ]
  },
}

export default nextConfig
