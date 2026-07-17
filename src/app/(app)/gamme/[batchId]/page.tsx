import { redirect } from 'next/navigation'

/** Ancienne adresse — la vue d'une gamme est désormais sous Production. */
export default async function OldGammePage({
  params,
}: {
  params: Promise<{ batchId: string }>
}) {
  const { batchId } = await params
  redirect(`/production/gamme/${batchId}`)
}
