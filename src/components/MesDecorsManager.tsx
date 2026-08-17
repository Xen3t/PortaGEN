'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * GESTION DES DÉCORS de MES Contrainte (08/08/2026, maquette
 * decors-mes-contrainte-v2) : bibliothèque partagée par les 3 moteurs décor
 * autour. Chaque décor = un nom, un texte de prompt LIBRE (injecté à la place
 * de {DECOR}) et des images de référence optionnelles jointes à l'appel Nano
 * comme inspiration d'ambiance.
 *
 * Composant PARTAGÉ (décision Mathias 08/08 : « et l'utilisateur qui est pas
 * admin ? ») : la modale « Gérer les décors » de la page MES Contrainte
 * (accessible à tous — création/édition collectives) ET la rubrique Décors
 * d'Admin → Réglages (même bibliothèque). Décor par défaut et suppression :
 * boutons visibles seulement pour l'admin (l'API le vérifie aussi).
 */

export interface MesDecor {
  id: number
  name: string
  prompt: string
  /** Version RÉÉCRITE par le LLM (obligatoire, 08/08 soir) — celle qui part à
   *  la génération ; null = réécriture échouée (repli : texte humain). */
  promptIa: string | null
  images: string[]
  isDefault: boolean
}

const imgUrl = (p: string, w?: number) =>
  `/api/artifacts?p=${encodeURIComponent(p)}${w ? `&w=${w}` : ''}`

export default function MesDecorsManager({
  isAdmin,
  onDecorsChange,
}: {
  isAdmin: boolean
  /** Remonte la liste à chaque changement (le sélecteur de la page s'en nourrit). */
  onDecorsChange?: (decors: MesDecor[]) => void
}) {
  const [decors, setDecors] = useState<MesDecor[]>([])
  const [ouvert, setOuvert] = useState<number | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [chargement, setChargement] = useState(true)
  /** Brouillons nom/prompt du décor ouvert — enregistrés au blur. */
  const [nom, setNom] = useState('')
  const [texte, setTexte] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const nomInput = useRef<HTMLInputElement>(null)

  function publier(liste: MesDecor[]) {
    setDecors(liste)
    onDecorsChange?.(liste)
  }

  /** Mise à jour d'UN décor dans la liste — forme fonctionnelle : les ajouts
   *  d'images en série ne s'écrasent pas entre eux (fermeture périmée sinon). */
  function publierDecor(decor: MesDecor) {
    setDecors((cur) => {
      const next = cur.map((x) => (x.id === decor.id ? decor : x))
      onDecorsChange?.(next)
      return next
    })
  }

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const r = await fetch('/api/mes-decors')
        const d = await r.json().catch(() => null)
        if (alive && r.ok && Array.isArray(d?.decors)) publier(d.decors)
      } catch {
        if (alive) setNotice('Impossible de charger les décors.')
      } finally {
        if (alive) setChargement(false)
      }
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function ouvrir(d: MesDecor) {
    setOuvert(d.id)
    setNom(d.name)
    setTexte(d.prompt)
  }

  async function patch(body: Record<string, unknown>): Promise<boolean> {
    setNotice(null)
    try {
      const r = await fetch('/api/mes-decors', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const d = await r.json().catch(() => null)
      if (!r.ok) {
        setNotice(d?.error ?? 'Enregistrement impossible.')
        return false
      }
      if (Array.isArray(d?.decors)) publier(d.decors)
      // Texte enregistré mais réécriture IA échouée : on le dit.
      if (typeof d?.avertissement === 'string') setNotice(d.avertissement)
      return true
    } catch {
      setNotice('Impossible de contacter le serveur.')
      return false
    }
  }

  /** Enregistrement du TEXTE (blur ou Réécrire) : la réécriture IA part avec —
   *  quelques secondes, signalées sur la fiche (iaBusy). */
  const [iaBusy, setIaBusy] = useState<number | null>(null)
  async function patchIa(id: number, body: Record<string, unknown>) {
    setIaBusy(id)
    try {
      await patch(body)
    } finally {
      setIaBusy(null)
    }
  }

  async function creer() {
    setNotice(null)
    try {
      const r = await fetch('/api/mes-decors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Nouveau décor' }),
      })
      const d = await r.json().catch(() => null)
      if (!r.ok || !d?.decor) {
        setNotice(d?.error ?? 'Création impossible.')
        return
      }
      if (Array.isArray(d.decors)) publier(d.decors)
      ouvrir(d.decor)
      // Le nom se corrige tout de suite : champ focalisé et pré-sélectionné.
      setTimeout(() => {
        nomInput.current?.focus()
        nomInput.current?.select()
      }, 0)
    } catch {
      setNotice('Impossible de contacter le serveur.')
    }
  }

  async function supprimer(d: MesDecor) {
    if (!window.confirm(`Supprimer le décor « ${d.name} » ? Ses images de référence partent avec.`))
      return
    setNotice(null)
    try {
      const r = await fetch(`/api/mes-decors?id=${d.id}`, { method: 'DELETE' })
      const data = await r.json().catch(() => null)
      if (!r.ok) {
        setNotice(data?.error ?? 'Suppression impossible.')
        return
      }
      if (Array.isArray(data?.decors)) publier(data.decors)
      if (ouvert === d.id) setOuvert(null)
    } catch {
      setNotice('Impossible de contacter le serveur.')
    }
  }

  async function ajouterImage(d: MesDecor, file: File) {
    setNotice(null)
    const form = new FormData()
    form.set('id', String(d.id))
    form.set('file', file)
    try {
      const r = await fetch('/api/mes-decors/images', { method: 'POST', body: form })
      const data = await r.json().catch(() => null)
      if (!r.ok || !data?.decor) {
        setNotice(data?.error ?? 'Ajout impossible.')
        return
      }
      publierDecor(data.decor)
    } catch {
      setNotice('Impossible de contacter le serveur.')
    }
  }

  async function retirerImage(d: MesDecor, rel: string) {
    setNotice(null)
    try {
      const r = await fetch(
        `/api/mes-decors/images?id=${d.id}&p=${encodeURIComponent(rel)}`,
        { method: 'DELETE' }
      )
      const data = await r.json().catch(() => null)
      if (!r.ok || !data?.decor) {
        setNotice(data?.error ?? 'Retrait impossible.')
        return
      }
      publierDecor(data.decor)
    } catch {
      setNotice('Impossible de contacter le serveur.')
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-2">
        <p className="text-[13px] text-text-secondary">
          Le décor peint autour du produit. Le texte décrit l&apos;ambiance ; les images de
          référence (optionnelles) sont jointes à la génération comme inspiration — jamais comme
          structure à copier.
        </p>
        <button
          type="button"
          onClick={() => void creer()}
          className="shrink-0 bg-brand-green hover:bg-brand-green-hover text-white text-[12px] font-bold rounded-[8px] px-3 py-1.5"
        >
          + Nouveau décor
        </button>
      </div>

      {notice && (
        <p className="text-[13px] text-brand-red font-semibold mb-3">{notice}</p>
      )}
      {chargement && <p className="text-[13px] text-text-disabled">Chargement…</p>}

      {decors.map((d) => {
        const estOuvert = ouvert === d.id
        return (
          <div key={d.id} className="border border-border rounded-[8px] mb-3 overflow-hidden">
            <button
              type="button"
              onClick={() => (estOuvert ? setOuvert(null) : ouvrir(d))}
              className="w-full flex items-center gap-3 px-3.5 py-2.5 text-left hover:bg-surface/60"
            >
              <b className="text-[14px]">{d.name}</b>
              {d.isDefault && (
                <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-brand-green-light text-brand-green">
                  Par défaut
                </span>
              )}
              <span className="text-[12px] text-text-disabled">
                {d.images.length === 0
                  ? 'Sans image'
                  : `${d.images.length} image${d.images.length > 1 ? 's' : ''} de référence`}
              </span>
              <span className="flex-1" />
              <span className="text-[11px] text-text-disabled">{estOuvert ? '▲' : '▼'}</span>
            </button>
            {estOuvert && (
              <div className="border-t border-border p-3.5 grid gap-4 md:grid-cols-[minmax(0,1fr)_250px]">
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wide text-text-secondary mb-1">
                    Nom du décor
                  </label>
                  <input
                    ref={nomInput}
                    type="text"
                    maxLength={60}
                    value={nom}
                    onChange={(e) => setNom(e.target.value)}
                    onBlur={() => {
                      const v = nom.trim()
                      if (v && v !== d.name) void patch({ id: d.id, name: v })
                    }}
                    className="w-full border border-border rounded-[8px] px-2.5 py-1.5 text-[13.5px] focus:outline-none focus:border-brand-green"
                  />
                  <label className="block text-[11px] font-bold uppercase tracking-wide text-text-secondary mt-3 mb-1">
                    Texte du décor (envoyé tel quel à la génération)
                  </label>
                  <textarea
                    value={texte}
                    onChange={(e) => setTexte(e.target.value)}
                    onBlur={() => {
                      if (texte !== d.prompt) void patchIa(d.id, { id: d.id, prompt: texte })
                    }}
                    rows={5}
                    className="w-full border border-border rounded-[8px] px-2.5 py-1.5 text-[13px] leading-relaxed resize-y focus:outline-none focus:border-brand-green"
                  />
                  <p className="text-[12px] text-text-disabled mt-1">
                    Décris l&apos;ambiance avec tes mots (lieu, végétation, ciel, lumière…) — en
                    français ou en anglais, l&apos;IA s&apos;occupe du reste.
                  </p>
                  {/* Version IA (obligatoire, 08/08 soir) : réécriture LLM du
                      texte humain — c'est ELLE qui part à la génération. */}
                  <div className="mt-3 border border-border rounded-[8px] bg-surface/60 p-2.5">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[11px] font-bold uppercase tracking-wide text-text-secondary">
                        Version IA — celle envoyée à la génération
                      </span>
                      <span className="flex-1" />
                      <button
                        type="button"
                        disabled={iaBusy === d.id}
                        onClick={() => void patchIa(d.id, { id: d.id, ameliorer: true })}
                        className="text-[12px] font-semibold text-text-secondary hover:text-brand-green disabled:opacity-50"
                      >
                        Réécrire
                      </button>
                    </div>
                    {iaBusy === d.id ? (
                      <p className="text-[12.5px] text-text-disabled italic">
                        Réécriture par l&apos;IA…
                      </p>
                    ) : d.promptIa ? (
                      <p className="text-[12.5px] leading-relaxed text-text-secondary whitespace-pre-wrap">
                        {d.promptIa}
                      </p>
                    ) : (
                      <p className="text-[12.5px] text-text-disabled italic">
                        Pas encore réécrite — enregistre un texte (ou « Réécrire »).
                      </p>
                    )}
                  </div>
                </div>
                <div>
                  <span className="block text-[11px] font-bold uppercase tracking-wide text-text-secondary mb-1">
                    Images de référence
                  </span>
                  <div className="grid grid-cols-2 gap-2">
                    {d.images.map((rel) => (
                      <div
                        key={rel}
                        className="relative aspect-[4/3] rounded-[8px] overflow-hidden border border-border bg-surface"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={imgUrl(rel, 240)}
                          alt=""
                          className="w-full h-full object-cover"
                        />
                        <button
                          type="button"
                          onClick={() => void retirerImage(d, rel)}
                          title="Retirer cette image"
                          className="absolute top-1 right-1 w-5 h-5 rounded-full bg-[rgba(31,41,55,0.55)] text-white text-[10px] grid place-items-center hover:bg-brand-red"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => fileInput.current?.click()}
                      className="aspect-[4/3] rounded-[8px] border border-dashed border-border bg-white text-text-disabled hover:text-brand-green hover:border-brand-green flex flex-col items-center justify-center gap-1 text-[11px] font-semibold"
                    >
                      <svg
                        width="16" height="16" viewBox="0 0 24 24" fill="none"
                        stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                      >
                        <path d="M12 5v14M5 12h14" />
                      </svg>
                      Ajouter
                    </button>
                  </div>
                  <p className="text-[12px] text-text-disabled mt-1.5">
                    Jointes à chaque génération avec ce décor, comme inspiration d&apos;ambiance.
                  </p>
                </div>
                {isAdmin && (
                  <div className="md:col-span-2 flex items-center gap-4 border-t border-dashed border-border pt-3">
                    {!d.isDefault && (
                      <button
                        type="button"
                        onClick={() => void patch({ id: d.id, isDefault: true })}
                        className="text-[12.5px] font-semibold text-text-secondary hover:text-brand-green"
                      >
                        Définir par défaut
                      </button>
                    )}
                    <span className="flex-1" />
                    <button
                      type="button"
                      onClick={() => void supprimer(d)}
                      className="text-[12.5px] font-semibold text-brand-red hover:underline"
                    >
                      Supprimer ce décor
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}

      {/* Un seul input fichier : il vise le décor OUVERT. */}
      <input
        ref={fileInput}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        className="hidden"
        onChange={(e) => {
          const d = decors.find((x) => x.id === ouvert)
          const files = Array.from(e.target.files ?? [])
          e.target.value = ''
          if (!d) return
          // EN SÉRIE : deux ajouts simultanés se liraient l'un l'autre une liste
          // périmée côté serveur (lecture puis réécriture du JSON images).
          void (async () => {
            for (const f of files) await ajouterImage(d, f)
          })()
        }}
      />
    </div>
  )
}
