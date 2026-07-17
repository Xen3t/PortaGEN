import { redirect } from 'next/navigation'

/** Ancienne adresse — le détail d'une génération est désormais sous Production. */
export default async function OldJobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  redirect(`/production/image/${id}`)
}
