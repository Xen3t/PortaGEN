import { redirect } from 'next/navigation'

/** Ancienne adresse — les gabarits vivent dans la fiche moteur d'Admin → Réglages. */
export default function OldGabaritsPage() {
  redirect('/admin/reglages')
}
