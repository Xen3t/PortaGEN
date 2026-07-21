/**
 * Progression du scan catalogue EN COURS — alimente la barre du bouton
 * « Actualiser depuis le serveur » (polling GET /api/catalogue/progression).
 * État en mémoire accroché à globalThis pour survivre au rechargement à chaud
 * de Next en dev, même motif que le runner de jobs.
 */

export interface ScanProgress {
  /** Un scan tourne en ce moment. */
  actif: boolean
  /** Gammes déjà scannées. */
  fait: number
  /** Gammes à scanner au total. */
  total: number
  /** Départ du scan (epoch ms) — sert à estimer le temps restant côté client. */
  demarreA: number | null
}

const g = globalThis as typeof globalThis & { __portagenScanProgress?: ScanProgress }

function state(): ScanProgress {
  if (!g.__portagenScanProgress) {
    g.__portagenScanProgress = { actif: false, fait: 0, total: 0, demarreA: null }
  }
  return g.__portagenScanProgress
}

export function beginScanProgress(total: number): void {
  const s = state()
  s.actif = true
  s.fait = 0
  s.total = total
  s.demarreA = Date.now()
}

export function tickScanProgress(): void {
  state().fait += 1
}

export function endScanProgress(): void {
  state().actif = false
}

export function getScanProgress(): ScanProgress {
  return { ...state() }
}
