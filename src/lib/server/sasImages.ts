/**
 * Sas de calcul d'image (07/08/2026) — protège la réactivité de l'app pendant
 * les gros lots.
 *
 * Le réglage « générations simultanées » (jusqu'à 20) pilote le NOMBRE de jobs
 * en vol : la majorité de leur temps est de l'attente Nano (réseau, gratuit en
 * machine). Ce sas plafonne uniquement les PHASES de calcul d'image (RALify,
 * plan gris, livraison sharp) : au-delà de la limite, les jobs patientent ici
 * quelques secondes au lieu de saturer CPU/RAM du processus qui sert aussi
 * l'interface. Limite RÉGLABLE depuis Admin → Réglages → Générations & modèle
 * (07/08 soir — défaut 3), lue à chaque entrée dans le sas : effet immédiat.
 *
 * État sur globalThis, comme le runner : le hot-reload du DEV recharge les
 * modules mais le sas doit rester UNIQUE par processus.
 */

import { getSasImagesLimite } from '@/lib/db/settings'

interface SasState {
  actifs: number
  attente: Array<() => void>
}

function state(): SasState {
  const g = globalThis as typeof globalThis & { __portagenSasImages?: SasState }
  if (!g.__portagenSasImages) g.__portagenSasImages = { actifs: 0, attente: [] }
  return g.__portagenSasImages
}

export async function sasCalculImage<T>(fn: () => Promise<T>): Promise<T> {
  const s = state()
  while (s.actifs >= getSasImagesLimite()) {
    await new Promise<void>((libere) => s.attente.push(libere))
  }
  s.actifs++
  try {
    return await fn()
  } finally {
    s.actifs--
    s.attente.shift()?.()
  }
}
