import { redirect } from 'next/navigation'

/** Ancienne adresse — la gestion des décors est désormais sur MES Décors. */
export default function OldDecorPage() {
  redirect('/decors')
}
