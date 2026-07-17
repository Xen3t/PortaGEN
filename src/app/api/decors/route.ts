import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/session'
import { listMoodboards } from '@/lib/server/catalog'
import { listAllTags, listDecorLibrary, listGammes, syncDecorsFromDisk } from '@/lib/db/decors'

/** Bibliothèque de décors : liste complète + référentiels pour les filtres. */
export async function GET(req: NextRequest) {
  const auth = requireApiUser(req)
  if (auth instanceof NextResponse) return auth
  // Réconciliation disque ↔ base (référence les décors historiques, purge les fichiers disparus)
  syncDecorsFromDisk()
  return NextResponse.json({
    decors: listDecorLibrary(auth.id),
    moodboards: listMoodboards(),
    gammes: listGammes(),
    tags: listAllTags(),
    role: auth.role,
  })
}
