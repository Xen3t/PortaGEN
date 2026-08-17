'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { PictoIllu } from '@/app/(app)/Silhouette'

/**
 * BIBLIOTHÈQUE DE DÉCORS (17/08/2026, maquette bibliotheque-decors-v1, refonte
 * même jour : « intègre-la là-bas ») : la nouvelle UI décors — grille de cartes
 * (aperçu Nano 1K + nom), UN champ de recherche, création en une phrase (l'IA
 * écrit le prompt, propose le nom, génère l'aperçu), fiche avec modification
 * par consigne. Elle vit DANS la page MES Contrainte (modale « Gérer les
 * décors ») et dans Admin → Réglages → Décors — plus de page dédiée ni
 * d'entrée de nav (demande Mathias 17/08). Remplace l'ancien MesDecorsManager.
 *
 * Droits inchangés (décision 08/08) : création/édition pour tous, décor par
 * défaut et suppression admin (l'API vérifie aussi).
 */

export interface MesDecor {
  id: number
  name: string
  prompt: string
  /** Version RÉÉCRITE par le LLM (obligatoire, 08/08 soir) — celle qui part à
   *  la génération ; null = réécriture échouée (repli : texte humain). */
  promptIa: string | null
  /** Aperçu Nano 1K du décor seul (bibliothèque 17/08) — chemin relatif. */
  apercu: string | null
  images: string[]
  isDefault: boolean
}

const imgUrl = (p: string, w?: number) =>
  `/api/artifacts?p=${encodeURIComponent(p)}${w ? `&w=${w}` : ''}`

export default function BibliothequeDecors({
  isAdmin,
  onDecorsChange,
  onUtiliser,
}: {
  isAdmin: boolean
  /** Remonte la liste à chaque changement (le sélecteur de la page s'en nourrit). */
  onDecorsChange?: (decors: MesDecor[]) => void
  /** « Utiliser ce décor » sur la fiche — fourni par la page MES Contrainte. */
  onUtiliser?: (id: number) => void
}) {
  const [decors, setDecors] = useState<MesDecor[]>([])
  const [chargement, setChargement] = useState(true)
  const [notice, setNotice] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  // Création « en une phrase »
  const [creation, setCreation] = useState(false)
  const [idee, setIdee] = useState('')
  const [creationBusy, setCreationBusy] = useState(false)

  // Fiche ouverte + brouillons (enregistrés au blur)
  const [detailId, setDetailId] = useState<number | null>(null)
  const [nom, setNom] = useState('')
  const [texte, setTexte] = useState('')
  const [consigne, setConsigne] = useState('')
  const [iaBusy, setIaBusy] = useState(false)
  const [promptOuvert, setPromptOuvert] = useState(false)

  // Aperçus en cours de génération (spinner sur la carte ET la fiche)
  const [apercuBusy, setApercuBusy] = useState<number[]>([])
  const fileInput = useRef<HTMLInputElement>(null)

  /** Mise à jour d'UN décor — forme fonctionnelle : les ajouts d'images en
   *  série ne s'écrasent pas entre eux (fermeture périmée sinon). */
  function publierDecor(decor: MesDecor) {
    setDecors((cur) => cur.map((x) => (x.id === decor.id ? decor : x)))
  }

  // Remontée au parent APRÈS le rendu, jamais depuis un updater setDecors
  // (setState du parent pendant le rendu = erreur React). Le garde `chargement`
  // évite d'écraser la liste du parent avec [] au montage de la modale.
  useEffect(() => {
    if (chargement) return
    onDecorsChange?.(decors)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decors, chargement])

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const r = await fetch('/api/mes-decors')
        const d = await r.json().catch(() => null)
        if (alive && r.ok && Array.isArray(d?.decors)) setDecors(d.decors)
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

  const filtres = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return decors
    return decors.filter(
      (d) =>
        d.name.toLowerCase().includes(q) ||
        d.prompt.toLowerCase().includes(q) ||
        (d.promptIa ?? '').toLowerCase().includes(q)
    )
  }, [decors, search])

  const detail = decors.find((d) => d.id === detailId) ?? null

  function ouvrir(d: MesDecor) {
    setDetailId(d.id)
    setNom(d.name)
    setTexte(d.prompt)
    setConsigne('')
    setPromptOuvert(false)
  }

  /** PATCH générique — renvoie la liste À JOUR (null si échec) : les appelants
   *  ne relisent pas `decors` (fermeture périmée). */
  async function patch(body: Record<string, unknown>): Promise<MesDecor[] | null> {
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
        return null
      }
      const liste = Array.isArray(d?.decors) ? (d.decors as MesDecor[]) : decors
      if (Array.isArray(d?.decors)) setDecors(d.decors)
      if (typeof d?.avertissement === 'string') setNotice(d.avertissement)
      return liste
    } catch {
      setNotice('Impossible de contacter le serveur.')
      return null
    }
  }

  /** Aperçu Nano 1K — jamais deux générations en même temps sur le même décor. */
  async function genererApercu(id: number) {
    if (apercuBusy.includes(id)) return
    setApercuBusy((cur) => [...cur, id])
    try {
      const r = await fetch('/api/mes-decors/apercu', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      const d = await r.json().catch(() => null)
      if (!r.ok || !d?.decor) {
        setNotice(d?.error ?? 'Génération de l’aperçu impossible.')
        return
      }
      publierDecor(d.decor)
    } catch {
      setNotice('Impossible de contacter le serveur.')
    } finally {
      setApercuBusy((cur) => cur.filter((x) => x !== id))
    }
  }

  /** Création en une phrase : IA (nom + prompt) puis aperçu en arrière-plan. */
  async function creer() {
    const texteIdee = idee.trim()
    if (!texteIdee || creationBusy) return
    setCreationBusy(true)
    setNotice(null)
    try {
      const r = await fetch('/api/mes-decors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idee: texteIdee }),
      })
      const d = await r.json().catch(() => null)
      if (!r.ok || !d?.decor) {
        setNotice(d?.error ?? 'Création impossible.')
        return
      }
      if (Array.isArray(d.decors)) setDecors(d.decors)
      setCreation(false)
      setIdee('')
      ouvrir(d.decor)
      void genererApercu(d.decor.id)
    } catch {
      setNotice('Impossible de contacter le serveur.')
    } finally {
      setCreationBusy(false)
    }
  }

  /** Consigne : l'IA met à jour texte + prompt, puis l'aperçu repart. */
  async function appliquerConsigne(d: MesDecor) {
    const c = consigne.trim()
    if (!c || iaBusy) return
    setIaBusy(true)
    try {
      const liste = await patch({ id: d.id, consigne: c })
      if (liste) {
        setConsigne('')
        // Le brouillon du textarea suit le nouveau texte : sans ça, un blur
        // renverrait l'ancien texte et écraserait la consigne.
        const maj = liste.find((x) => x.id === d.id)
        setTexte((maj ?? d).prompt)
        void genererApercu(d.id)
      }
    } finally {
      setIaBusy(false)
    }
  }

  /** Édition du texte au blur : réécriture IA incluse. */
  async function enregistrerTexte(d: MesDecor) {
    if (texte === d.prompt) return
    setIaBusy(true)
    try {
      await patch({ id: d.id, prompt: texte })
    } finally {
      setIaBusy(false)
    }
  }

  async function supprimer(d: MesDecor) {
    if (!window.confirm(`Supprimer le décor « ${d.name} » ? Aperçu et images de référence partent avec.`))
      return
    setNotice(null)
    try {
      const r = await fetch(`/api/mes-decors?id=${d.id}`, { method: 'DELETE' })
      const data = await r.json().catch(() => null)
      if (!r.ok) {
        setNotice(data?.error ?? 'Suppression impossible.')
        return
      }
      if (Array.isArray(data?.decors)) setDecors(data.decors)
      if (detailId === d.id) setDetailId(null)
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
      const r = await fetch(`/api/mes-decors/images?id=${d.id}&p=${encodeURIComponent(rel)}`, {
        method: 'DELETE',
      })
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

  // La fiche ou la création est ouverte : on montre CE volet seul (pas de
  // modale dans la modale — la bibliothèque vit déjà dans une modale sur la
  // page MES Contrainte).
  if (creation) {
    return (
      <div>
        <div className="flex items-center gap-3 mb-1">
          <button
            type="button"
            disabled={creationBusy}
            onClick={() => setCreation(false)}
            className="text-[13px] font-semibold text-text-secondary hover:text-brand-green disabled:opacity-50"
          >
            &lsaquo; Retour à la bibliothèque
          </button>
        </div>
        <h3 className="text-[15px] font-bold mb-1">Nouveau décor</h3>
        <p className="text-[13px] text-text-secondary mb-3">
          Décris l&apos;ambiance en une phrase — l&apos;IA écrit le prompt, propose le nom et
          génère un aperçu. Tout reste retouchable ensuite.
        </p>
        {notice && <p className="text-[13px] text-brand-red font-semibold mb-3">{notice}</p>}
        <textarea
          value={idee}
          onChange={(e) => setIdee(e.target.value)}
          disabled={creationBusy}
          rows={3}
          autoFocus
          placeholder="Ex. : une maison de ville en briques rouges, haie taillée basse, sol en pavés gris clair"
          className="w-full border border-border rounded-[8px] px-3 py-2 text-[13.5px] leading-relaxed resize-y focus:outline-none focus:border-brand-green"
        />
        <div className="flex items-center gap-3 mt-3">
          <span className="text-[12px] text-text-disabled">
            1 appel texte + 1 aperçu en petite qualité (1K)
          </span>
          <span className="flex-1" />
          <button
            type="button"
            disabled={creationBusy || !idee.trim()}
            onClick={() => void creer()}
            className="bg-brand-green hover:bg-brand-green-hover text-white text-[13px] font-bold rounded-[10px] px-4 py-2 disabled:opacity-50"
          >
            {creationBusy ? 'L’IA écrit le décor…' : 'Créer le décor'}
          </button>
        </div>
      </div>
    )
  }

  if (detail) {
    return (
      <div>
        <div className="flex items-center gap-3 mb-3">
          <button
            type="button"
            onClick={() => setDetailId(null)}
            className="text-[13px] font-semibold text-text-secondary hover:text-brand-green"
          >
            &lsaquo; Retour à la bibliothèque
          </button>
          <div className="flex-1" />
          {detail.isDefault && (
            <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-brand-green-light text-brand-green">
              Par défaut
            </span>
          )}
        </div>
        {notice && <p className="text-[13px] text-brand-red font-semibold mb-3">{notice}</p>}

        <div className="grid gap-5 md:grid-cols-[280px_minmax(0,1fr)]">
          {/* colonne aperçu + références */}
          <div>
            <div className="relative aspect-[3/2] rounded-[8px] overflow-hidden border border-border bg-surface">
              {detail.apercu ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={imgUrl(detail.apercu, 600)} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="absolute inset-0 grid place-items-center text-[11.5px] font-semibold text-text-disabled px-4 text-center">
                  Pas encore d&apos;aperçu
                </div>
              )}
              {apercuBusy.includes(detail.id) && (
                <div className="absolute inset-0 bg-white/60 grid place-items-center text-[12px] font-bold text-text-secondary">
                  Aperçu en cours…
                </div>
              )}
            </div>
            <button
              type="button"
              disabled={apercuBusy.includes(detail.id)}
              onClick={() => void genererApercu(detail.id)}
              className="mt-2 text-[12.5px] font-semibold text-text-secondary hover:text-brand-green disabled:opacity-50"
            >
              Régénérer l&apos;aperçu (1K)
            </button>

            <span className="block text-[11px] font-bold uppercase tracking-wide text-text-secondary mt-4 mb-1">
              Images de référence
            </span>
            <div className="grid grid-cols-3 gap-2">
              {detail.images.map((rel) => (
                <div
                  key={rel}
                  className="relative aspect-[4/3] rounded-[8px] overflow-hidden border border-border bg-surface"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={imgUrl(rel, 240)} alt="" className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={() => void retirerImage(detail, rel)}
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
                className="aspect-[4/3] rounded-[8px] border border-dashed border-border bg-white text-text-disabled hover:text-brand-green hover:border-brand-green flex items-center justify-center text-[11px] font-semibold"
              >
                + Ajouter
              </button>
            </div>
            <p className="text-[12px] text-text-disabled mt-1.5">
              Jointes à chaque génération avec ce décor, comme inspiration d&apos;ambiance.
            </p>
          </div>

          {/* colonne texte + consigne */}
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wide text-text-secondary mb-1">
              Nom
            </label>
            <input
              type="text"
              maxLength={60}
              value={nom}
              onChange={(e) => setNom(e.target.value)}
              onBlur={() => {
                const v = nom.trim()
                if (v && v !== detail.name) void patch({ id: detail.id, name: v })
              }}
              className="w-full border border-border rounded-[8px] px-2.5 py-1.5 text-[13.5px] focus:outline-none focus:border-brand-green"
            />

            <label className="block text-[11px] font-bold uppercase tracking-wide text-text-secondary mt-4 mb-1">
              Modifier par consigne
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={consigne}
                onChange={(e) => setConsigne(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void appliquerConsigne(detail)
                }}
                disabled={iaBusy}
                placeholder="Ex. : moins de végétation, volets bleu lavande, muret plus haut…"
                className="flex-1 border border-border rounded-[8px] px-2.5 py-1.5 text-[13.5px] focus:outline-none focus:border-brand-green"
              />
              <button
                type="button"
                disabled={iaBusy || !consigne.trim()}
                onClick={() => void appliquerConsigne(detail)}
                className="bg-brand-green hover:bg-brand-green-hover text-white text-[12px] font-bold rounded-[8px] px-3.5 py-1.5 disabled:opacity-50"
              >
                {iaBusy ? 'L’IA réécrit…' : 'Appliquer'}
              </button>
            </div>
            <p className="text-[12px] text-text-disabled mt-1">
              L&apos;IA met à jour le texte et le prompt, puis régénère l&apos;aperçu. Tout reste
              vu de face, c&apos;est verrouillé.
            </p>

            <label className="block text-[11px] font-bold uppercase tracking-wide text-text-secondary mt-4 mb-1">
              Texte du décor (modifiable à la main)
            </label>
            <textarea
              value={texte}
              onChange={(e) => setTexte(e.target.value)}
              onBlur={() => void enregistrerTexte(detail)}
              rows={4}
              className="w-full border border-border rounded-[8px] px-2.5 py-1.5 text-[13px] leading-relaxed resize-y focus:outline-none focus:border-brand-green"
            />

            <div className="mt-3 border border-border rounded-[8px] bg-surface/60 p-2.5">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wide text-text-secondary">
                  Prompt écrit par l&apos;IA — celui envoyé à la génération
                </span>
                <span className="flex-1" />
                <button
                  type="button"
                  onClick={() => setPromptOuvert((v) => !v)}
                  className="text-[12px] font-semibold text-text-secondary hover:text-brand-green"
                >
                  {promptOuvert ? 'Masquer' : 'Afficher'}
                </button>
              </div>
              {promptOuvert &&
                (iaBusy ? (
                  <p className="text-[12.5px] text-text-disabled italic mt-1">
                    Réécriture par l&apos;IA…
                  </p>
                ) : detail.promptIa ? (
                  <p className="text-[12.5px] leading-relaxed text-text-secondary whitespace-pre-wrap mt-1">
                    {detail.promptIa}
                  </p>
                ) : (
                  <p className="text-[12.5px] text-text-disabled italic mt-1">
                    Pas encore réécrit — enregistre un texte d&apos;abord.
                  </p>
                ))}
            </div>
          </div>

          {/* pied de fiche */}
          <div className="md:col-span-2 flex items-center gap-4 border-t border-dashed border-border pt-3">
            {isAdmin && !detail.isDefault && (
              <button
                type="button"
                onClick={() => void patch({ id: detail.id, isDefault: true })}
                className="text-[12.5px] font-semibold text-text-secondary hover:text-brand-green"
              >
                Définir par défaut
              </button>
            )}
            {isAdmin && (
              <button
                type="button"
                onClick={() => void supprimer(detail)}
                className="text-[12.5px] font-semibold text-brand-red hover:underline"
              >
                Supprimer
              </button>
            )}
            <span className="flex-1" />
            {onUtiliser && (
              <button
                type="button"
                onClick={() => onUtiliser(detail.id)}
                className="bg-brand-green hover:bg-brand-green-hover text-white text-[12px] font-bold rounded-[8px] px-3.5 py-2"
              >
                Utiliser ce décor
              </button>
            )}
          </div>
        </div>

        {/* Un seul input fichier : il vise la fiche OUVERTE. */}
        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          className="hidden"
          onChange={(e) => {
            const d = decors.find((x) => x.id === detailId)
            const files = Array.from(e.target.files ?? [])
            e.target.value = ''
            if (!d) return
            // EN SÉRIE : deux ajouts simultanés se liraient l'un l'autre une
            // liste périmée côté serveur (lecture puis réécriture du JSON).
            void (async () => {
              for (const f of files) await ajouterImage(d, f)
            })()
          }}
        />
      </div>
    )
  }

  // ---- vue bibliothèque : recherche + grille de cartes ----
  return (
    <div>
      <div className="flex items-center gap-3 flex-wrap mb-4">
        <p className="text-[13px] text-text-secondary">
          Le décor peint autour du produit — aperçus, recherche, création en une phrase.
        </p>
        <span className="flex-1" />
        <label className="flex items-center gap-2 bg-white border border-border rounded-[10px] px-3 py-1.5 w-[240px] text-text-disabled focus-within:border-brand-green">
          <PictoIllu name="loupe" size={13} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher…"
            className="flex-1 min-w-0 text-[13px] text-text-primary outline-none bg-transparent placeholder:text-text-disabled"
          />
        </label>
        <button
          type="button"
          onClick={() => {
            setCreation(true)
            setNotice(null)
          }}
          className="bg-brand-green hover:bg-brand-green-hover text-white text-[12px] font-bold rounded-[8px] px-3 py-1.5"
        >
          + Nouveau décor
        </button>
      </div>

      {notice && <p className="text-[13px] text-brand-red font-semibold mb-3">{notice}</p>}
      {chargement && <p className="text-[13px] text-text-disabled">Chargement…</p>}
      {!chargement && filtres.length === 0 && (
        <p className="text-[13.5px] text-text-secondary">
          {search.trim() ? 'Aucun décor ne correspond à cette recherche.' : 'Aucun décor.'}
        </p>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {filtres.map((d) => (
          <button
            key={d.id}
            type="button"
            onClick={() => ouvrir(d)}
            className="text-left bg-white rounded-[10px] shadow-sm overflow-hidden border-2 border-border/60 hover:border-brand-green transition-colors"
          >
            <div className="relative aspect-[3/2] bg-surface">
              {d.apercu ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={imgUrl(d.apercu, 480)} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="absolute inset-0 grid place-items-center text-[11.5px] font-semibold text-text-disabled px-4 text-center">
                  {apercuBusy.includes(d.id) ? 'Aperçu en cours…' : 'Pas encore d’aperçu'}
                </div>
              )}
              {apercuBusy.includes(d.id) && d.apercu && (
                <div className="absolute inset-0 bg-white/60 grid place-items-center text-[11.5px] font-bold text-text-secondary">
                  Aperçu en cours…
                </div>
              )}
              {d.isDefault && (
                <span className="absolute top-2 left-2 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-brand-green text-white">
                  Par défaut
                </span>
              )}
              {d.images.length > 0 && (
                <span className="absolute bottom-2 right-2 text-[10.5px] font-bold px-2 py-0.5 rounded-full bg-[rgba(31,41,55,0.55)] text-white">
                  {d.images.length} réf.
                </span>
              )}
            </div>
            <div className="px-3 py-2">
              <b className="text-[13px] block truncate">{d.name}</b>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
