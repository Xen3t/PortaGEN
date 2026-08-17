import { NextRequest, NextResponse } from 'next/server'
import { requireApiUser } from '@/lib/auth/session'
import {
  createMesDecor,
  deleteMesDecor,
  getMesDecor,
  listMesDecors,
  setMesDecorDefaut,
  updateMesDecor,
} from '@/lib/db/mesDecors'
import {
  ameliorerDecorPrompt,
  creerDecorDepuisIdee,
  modifierDecorParConsigne,
} from '@/lib/genai/decorPromptIa'

/**
 * DÉCORS des MES Contrainte (08/08/2026, maquette decors-mes-contrainte-v2) :
 * bibliothèque partagée par les 3 moteurs décor autour.
 *
 * Droits (décision Mathias 08/08) : lecture/création/édition pour TOUS les
 * utilisateurs connectés ; décor PAR DÉFAUT et SUPPRESSION réservés à l'admin.
 */

export async function GET(req: NextRequest) {
  const auth = requireApiUser(req)
  if (auth instanceof NextResponse) return auth
  return NextResponse.json({ decors: listMesDecors() })
}

/**
 * Création : { name } — le texte se remplit ensuite par PATCH (modale MES
 * Contrainte) — OU { idee } (bibliothèque 17/08) : l'IA écrit le prompt et
 * propose le nom depuis la phrase de l'utilisateur ; l'aperçu se génère
 * ensuite par POST /api/mes-decors/apercu.
 */
export async function POST(req: NextRequest) {
  const auth = requireApiUser(req)
  if (auth instanceof NextResponse) return auth
  const body = await req.json().catch(() => null)

  const idee = typeof body?.idee === 'string' ? body.idee.trim().slice(0, 4000) : ''
  if (idee) {
    try {
      const ia = await creerDecorDepuisIdee(idee)
      const decor = createMesDecor(ia.nom, auth.username, undefined, {
        prompt: idee,
        promptIa: ia.prompt,
      })
      return NextResponse.json({ decor, decors: listMesDecors() })
    } catch {
      return NextResponse.json(
        { error: 'Création IA impossible (modèle injoignable) — réessaie.' },
        { status: 502 }
      )
    }
  }

  const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 60) : ''
  if (!name) return NextResponse.json({ error: 'Nom de décor vide' }, { status: 400 })
  const decor = createMesDecor(name, auth.username)
  return NextResponse.json({ decor, decors: listMesDecors() })
}

/**
 * Édition : { id, name?, prompt? } (tous), { id, ameliorer: true } (tous —
 * relance la réécriture IA sur le texte stocké) — ou { id, isDefault: true }
 * (admin).
 *
 * RÉÉCRITURE LLM OBLIGATOIRE (08/08 soir, exigence Mathias) : dès que le texte
 * humain change, le modèle le corrige/enrichit et c'est CETTE version qui
 * remplira {DECOR}. Modèle injoignable = le texte humain est quand même
 * enregistré (promptIa remis à null → repli sur le texte humain au run) et la
 * réponse porte un avertissement.
 */
export async function PATCH(req: NextRequest) {
  const auth = requireApiUser(req)
  if (auth instanceof NextResponse) return auth
  const body = await req.json().catch(() => null)
  const id = Number(body?.id)
  if (!Number.isInteger(id)) return NextResponse.json({ error: 'Requête invalide' }, { status: 400 })

  if (body?.isDefault === true) {
    const adm = requireApiUser(req, 'admin')
    if (adm instanceof NextResponse) return adm
    if (!setMesDecorDefaut(id)) {
      return NextResponse.json({ error: 'Décor introuvable' }, { status: 404 })
    }
    return NextResponse.json({ decors: listMesDecors() })
  }

  // Modification par CONSIGNE (bibliothèque 17/08) : « moins de végétation »
  // → l'IA met à jour le texte humain ET le prompt, cohérents entre eux.
  if (typeof body?.consigne === 'string' && body.consigne.trim()) {
    const decor = getMesDecor(id)
    if (!decor) return NextResponse.json({ error: 'Décor introuvable' }, { status: 404 })
    const texteActuel = decor.prompt.trim() || decor.promptIa || ''
    if (!texteActuel) {
      return NextResponse.json({ error: 'Écris d’abord un texte de décor.' }, { status: 400 })
    }
    try {
      const ia = await modifierDecorParConsigne(texteActuel, body.consigne.trim().slice(0, 1000))
      updateMesDecor(id, { prompt: ia.texte, promptIa: ia.prompt })
      return NextResponse.json({ decors: listMesDecors() })
    } catch {
      return NextResponse.json(
        { error: 'Modification IA impossible (modèle injoignable) — réessaie.' },
        { status: 502 }
      )
    }
  }

  // Relance manuelle de la réécriture IA (bouton « Réécrire »).
  if (body?.ameliorer === true) {
    const decor = getMesDecor(id)
    if (!decor) return NextResponse.json({ error: 'Décor introuvable' }, { status: 404 })
    if (!decor.prompt.trim()) {
      return NextResponse.json({ error: 'Écris d’abord un texte de décor.' }, { status: 400 })
    }
    try {
      const ia = await ameliorerDecorPrompt(decor.prompt)
      updateMesDecor(id, { promptIa: ia.prompt })
      return NextResponse.json({ decors: listMesDecors() })
    } catch {
      return NextResponse.json(
        { error: 'Réécriture IA impossible (modèle injoignable) — réessaie.' },
        { status: 502 }
      )
    }
  }

  const champs: { name?: string; prompt?: string; promptIa?: string | null } = {}
  if (typeof body?.name === 'string') {
    const name = body.name.trim().slice(0, 60)
    if (!name) return NextResponse.json({ error: 'Nom de décor vide' }, { status: 400 })
    champs.name = name
  }
  let avertissement: string | undefined
  if (typeof body?.prompt === 'string') {
    const promptHumain = body.prompt.slice(0, 4000)
    champs.prompt = promptHumain
    if (promptHumain.trim()) {
      try {
        champs.promptIa = (await ameliorerDecorPrompt(promptHumain)).prompt
      } catch {
        champs.promptIa = null
        avertissement =
          'Texte enregistré, mais la réécriture IA a échoué — bouton « Réécrire » pour réessayer (en attendant, le texte brut sera utilisé).'
      }
    } else {
      champs.promptIa = null
    }
  }
  if (!updateMesDecor(id, champs)) {
    return NextResponse.json({ error: 'Décor introuvable' }, { status: 404 })
  }
  return NextResponse.json({ decors: listMesDecors(), ...(avertissement ? { avertissement } : {}) })
}

/** Suppression (admin) : ?id= — refusée sur le dernier décor. */
export async function DELETE(req: NextRequest) {
  const auth = requireApiUser(req, 'admin')
  if (auth instanceof NextResponse) return auth
  const id = Number(req.nextUrl.searchParams.get('id'))
  if (!Number.isInteger(id)) return NextResponse.json({ error: 'Requête invalide' }, { status: 400 })
  const res = deleteMesDecor(id)
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 })
  return NextResponse.json({ decors: listMesDecors() })
}
