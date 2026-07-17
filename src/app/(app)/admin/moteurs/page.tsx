import { redirect } from 'next/navigation'

/**
 * « Réglages par moteur » a fusionné dans Admin → Réglages (13/07/2026) :
 * la page Réglages porte désormais les réglages généraux de l'application
 * ET la fiche de chaque moteur. Redirection pour les favoris.
 */
export default function MoteursPage() {
  redirect('/admin/reglages')
}
