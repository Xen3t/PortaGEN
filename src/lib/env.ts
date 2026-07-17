import fs from 'node:fs'
import path from 'node:path'

/**
 * Charge .env.local dans process.env pour les scripts lancés hors de Next
 * (Next charge .env.local tout seul, mais pas tsx). Sans dépendance externe.
 * Les variables déjà présentes dans l'environnement gardent la priorité.
 */
export function loadEnvLocal(rootDir: string = process.cwd()): void {
  const file = path.join(rootDir, '.env.local')
  if (!fs.existsSync(file)) return
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    const value = trimmed.slice(eq + 1).trim()
    if (!(key in process.env)) {
      process.env[key] = value
    }
  }
}
