import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/session'
import {
  batchBelongsTo,
  deleteGenerationSession,
  getGenerationSession,
  hideSessionBatch,
  summarizeGenerationSession,
} from '@/lib/db/generationSessions'

/**
 * Une session de génération directe : détail (pour rouvrir l'écran de résultats
 * depuis l'accueil) et suppression (bouton discret de la carte). Réservé à son
 * auteur — l'admin peut aussi supprimer.
 *
 * Supprimer une session directe efface la LIGNE de session uniquement ; pour un
 * lancement de gamme (carte Catalogue, pas de ligne de session) le lot est
 * masqué de la liste. Dans les deux cas les jobs et les images restent visibles
 * (traçabilité), et la gamme reste consultable depuis le Catalogue.
 */

export async function GET(req: NextRequest, ctx: { params: Promise<{ batchId: string }> }) {
  const auth = requireApiUser(req)
  if (auth instanceof NextResponse) return auth
  const { batchId } = await ctx.params
  const row = getGenerationSession(batchId)
  if (!row || (row.created_by !== auth.username && auth.role !== 'admin')) {
    return NextResponse.json({ error: 'Session introuvable' }, { status: 404 })
  }
  return NextResponse.json({ session: summarizeGenerationSession(row) })
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ batchId: string }> }) {
  const auth = requireApiUser(req)
  if (auth instanceof NextResponse) return auth
  const { batchId } = await ctx.params
  const row = getGenerationSession(batchId)
  if (row) {
    if (row.created_by !== auth.username && auth.role !== 'admin') {
      return NextResponse.json({ error: 'Session introuvable' }, { status: 404 })
    }
    deleteGenerationSession(batchId)
    return NextResponse.json({ ok: true })
  }
  // Pas de ligne de session : lancement de gamme (carte Catalogue) → masquage.
  if (!batchBelongsTo(batchId, auth.username)) {
    return NextResponse.json({ error: 'Session introuvable' }, { status: 404 })
  }
  hideSessionBatch(batchId, auth.username)
  return NextResponse.json({ ok: true })
}
