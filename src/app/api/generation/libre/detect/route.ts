import sharp from 'sharp'
import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/session'
import { getActivePrompt } from '@/lib/db/prompts'
import { generateText } from '@/lib/genai/client'

/**
 * Détection de la typologie depuis l'image produit déposée (28/07/2026) :
 * le modèle texte regarde l'image (réduite à 768 px — appel quasi gratuit) et
 * répond une clé parmi la liste du prompt versionné « libre-typo-detect »
 * (Admin → Prompts). Toujours corrigeable d'un clic à l'écran — la détection
 * propose, l'utilisateur dispose (même règle que la Génération directe).
 */

const TYPO_KEYS = new Set([
  'battant',
  'coulissant',
  'portillon',
  'clim',
  'pergola',
  'carport',
  'abri',
  'cloture',
  'brisevue',
  'gardecorps',
  'claustra',
  'volet',
  'table',
  'canape',
  'autre',
])

export async function POST(req: NextRequest) {
  const auth = requireApiUser(req)
  if (auth instanceof NextResponse) return auth

  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Aucune image.' }, { status: 400 })
  }
  if (file.size > 40 * 1024 * 1024) {
    return NextResponse.json({ error: 'Fichier trop lourd (40 Mo max).' }, { status: 400 })
  }

  try {
    const buf = Buffer.from(await file.arrayBuffer())
    // Vignette : largement suffisant pour reconnaître la typologie, et l'appel
    // reste minuscule. Fond blanc posé sous l'alpha (PNG détourés).
    const thumb = await sharp(buf)
      .resize(768, 768, { fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 85 })
      .toBuffer()

    const prompt = getActivePrompt('libre-typo-detect').content
    const { text } = await generateText({
      prompt,
      images: [{ source: thumb, mimeType: 'image/jpeg' }],
    })
    const key = text.trim().toLowerCase().replace(/[^a-z]/g, '')
    return NextResponse.json({ typo: TYPO_KEYS.has(key) ? key : 'autre' })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Détection impossible.' },
      { status: 502 }
    )
  }
}
