import path from 'node:path'

/**
 * Configuration centrale de l'application.
 * Les chemins sont relatifs à la racine du projet (process.cwd() en dev comme en prod PM2).
 */
export const config = {
  rootDir: process.cwd(),
  dataDir: path.join(process.cwd(), 'data'),
  dbPath: path.join(process.cwd(), 'data', 'portagen.db'),
  artifactsDir: path.join(process.cwd(), 'data', 'artifacts'),
  labDir: path.join(process.cwd(), 'data', 'lab'),
  assetsDir: path.join(process.cwd(), 'Assets'),
  promptSystemDir: path.join(process.cwd(), 'Prompt System'),

  // Format de livraison e-commerce (redimensionnement final uniquement — jamais en cours de pipeline)
  delivery: { width: 2000, height: 1330 },
  // Compression des livrables JPEG (Site ET Marketplace). Retour Mathias 13/07/2026 :
  // un livrable doit peser au moins ~1 Mo — qualité maximale utile, chroma non
  // sous-échantillonné (4:4:4), sinon le passage 4K → 2000 px coûte trop de qualité.
  deliveryJpeg: { quality: 98, chromaSubsampling: '4:4:4' },

  get geminiApiKey(): string {
    const key = process.env.GEMINI_API_KEY
    if (!key) throw new Error('GEMINI_API_KEY manquante — renseigner .env.local (voir .env.example)')
    return key
  },
  get imageModel(): string {
    return process.env.GEMINI_IMAGE_MODEL ?? 'gemini-3-pro-image'
  },
  get textModel(): string {
    return process.env.GEMINI_TEXT_MODEL ?? 'gemini-3.5-flash'
  },
}
