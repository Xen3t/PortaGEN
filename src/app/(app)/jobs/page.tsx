import { redirect } from 'next/navigation'

/** Ancienne adresse — le suivi se fait désormais sur la page Production (accueil). */
export default function OldJobsPage() {
  redirect('/')
}
