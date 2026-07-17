import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Modules natifs / WASM : ne doivent pas être bundlés par Next, chargés côté Node.
  // mupdf (WASM) sert à convertir les moodboards PDF des gammes en image (bloc 3.5).
  serverExternalPackages: ['better-sqlite3', 'sharp', 'onnxruntime-node', 'mupdf'],
  // Bloc 3.5 (13/07/2026) : « Créer » (ancien flux guidé de MES) est repris par le
  // catalogue → on redirige l'ancienne URL vers le catalogue. Redirection TEMPORAIRE
  // (307) : la page creer/ reste sur le disque, rien n'est supprimé (repo hors Git).
  async redirects() {
    return [{ source: '/creer', destination: '/catalogue', permanent: false }]
  },
}

export default nextConfig
