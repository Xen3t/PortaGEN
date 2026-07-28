import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/session'
import { detectionStats } from '@/lib/detection/store'
import { selfTestVue } from '@/lib/detection/classify'
import { embeddingModelAvailable } from '@/lib/detection/embeddings'

/**
 * Admin → Détection des images : compteurs (exemples par axe/source, images
 * analysées, file à classer) + fiabilité mesurée (validation « un contre tous »
 * sur les exemples de vue).
 */
export async function GET(req: NextRequest) {
  const auth = requireApiUser(req, 'admin')
  if (auth instanceof NextResponse) return auth
  return NextResponse.json({
    stats: detectionStats(),
    fiabilite: selfTestVue(),
    modeleDisponible: embeddingModelAvailable(),
  })
}
