import { redirect } from 'next/navigation'

/**
 * Page Production SUPPRIMÉE le 13/07/2026 (maquette sessions-v2, demande
 * Mathias) : un lancement de gamme = une session, affichée sur l'Accueil avec
 * les générations directes. Les pages de détail restent à leurs adresses :
 * /production/gamme/[batchId] (une gamme) et /production/image/[id] (une image).
 */
export default function OldProductionPage() {
  redirect('/')
}
