import { redirect } from 'next/navigation'

/** Ancienne adresse — la gestion des décors est désormais dans la Bibliothèque. */
export default function OldDecorPage() {
  redirect('/bibliotheque')
}
