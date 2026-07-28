import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/session'
import { getDetectionProgress, startAnalyse } from '@/lib/detection/analyse'

/**
 * Admin → Détection des images : bouton « Analyser les images ».
 * POST = lance l'analyse (inventaire + exemples gratuits + empreintes +
 * prédictions), GET = progression pour la barre. LECTURE SEULE du serveur.
 */
export async function POST(req: NextRequest) {
  const auth = requireApiUser(req, 'admin')
  if (auth instanceof NextResponse) return auth
  const started = startAnalyse()
  const progress = getDetectionProgress()
  if (!started && progress.erreur) {
    return NextResponse.json({ error: progress.erreur }, { status: 503 })
  }
  return NextResponse.json({ ok: true, dejaEnCours: !started, progress })
}

export async function GET(req: NextRequest) {
  const auth = requireApiUser(req, 'admin')
  if (auth instanceof NextResponse) return auth
  return NextResponse.json({ progress: getDetectionProgress() })
}
