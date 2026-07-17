import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/session'
import { generatedBytes, resetStatus, runReset } from '@/lib/server/reset'

/**
 * Remise à zéro de l'application (Admin → Réglages) — réservée aux admins.
 * GET : état de l'opération + poids des images concernées (sondé par la
 * fenêtre de progression). POST : sauvegarde puis efface, répond à la fin.
 */

export async function GET(req: NextRequest) {
  const auth = requireApiUser(req, 'admin')
  if (auth instanceof NextResponse) return auth
  const status = resetStatus()
  // Pendant l'opération les dossiers bougent (et le GET est sondé toutes les
  // secondes) : le poids n'est calculé qu'au repos.
  return NextResponse.json({ status, bytes: status.running ? null : generatedBytes() })
}

export async function POST(req: NextRequest) {
  const auth = requireApiUser(req, 'admin')
  if (auth instanceof NextResponse) return auth
  const status = await runReset()
  if (status.error) {
    return NextResponse.json({ error: status.error, status }, { status: 409 })
  }
  return NextResponse.json({ status })
}
