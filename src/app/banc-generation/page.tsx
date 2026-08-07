import { redirect } from 'next/navigation'

/**
 * L'ancien banc de test est devenu la page officielle Décor Écrin (07/08/2026).
 * On redirige en conservant le lot (?lot=…) pour les URL déjà ouvertes.
 */
export default async function BancGenerationRedirect({
  searchParams,
}: {
  searchParams: Promise<{ lot?: string }>
}) {
  const { lot } = await searchParams
  redirect(lot ? `/generation/decor-autour?lot=${encodeURIComponent(lot)}` : '/generation/decor-autour')
}
