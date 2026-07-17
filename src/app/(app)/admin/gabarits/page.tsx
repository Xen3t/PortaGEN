import { redirect } from 'next/navigation'

/**
 * L'ex-page Admin → Gabarits est ABSORBÉE par la fiche moteur d'Admin → Réglages
 * (décision Mathias 13/07/2026, maquette reglages-par-moteur-v8/v9 : chaque
 * moteur porte ses gabarits). Le code vit dans components/GabaritsManager.tsx.
 */
export default function GabaritsRedirect() {
  redirect('/admin/reglages')
}
