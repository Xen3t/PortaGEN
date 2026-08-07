'use client'

import { useEffect, useMemo, useState } from 'react'
import Chargement from '@/components/Chargement'

/**
 * Admin → Descriptions produit (maquette descriptions-produit-v3 validée le
 * 07/08/2026) : la bibliothèque des briefs vision injectés dans le prompt décor
 * autour ({PRODUIT}). Règles maquette : AUCUN jargon moteur à l'écran (janus →
 * « Battant »), recherche CENTRALE pleine largeur, « + Ajouter » à gauche des
 * filtres, deux vues groupées (Par produit / Par catégorie), tri Nom ou Ordre
 * d'ajout, description repliée sur 2 lignes (clic = déplier), édition en
 * textarea dans la ligne, suppression avec confirmation.
 */

interface Entree {
  id: number
  produit: string
  coloris: string
  moteur: string
  description: string
  model: string | null
  created_at: string
}

/** Catégories produit — l'écran ne montre JAMAIS les clés techniques. */
const CATEGORIES: Record<string, string> = {
  janus: 'Battant',
  terminus: 'Coulissant',
  forculus: 'Portillon',
}

function formatDate(iso: string): string {
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z')
  return d.toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function origineDe(e: Entree): string {
  return !e.model || e.model === 'manuel' ? 'manuel' : `vision · ${e.model}`
}

export default function AdminDescriptionsPage() {
  const [items, setItems] = useState<Entree[]>([])
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState<string | null>(null)
  const [recherche, setRecherche] = useState('')
  const [vue, setVue] = useState<'produit' | 'categorie'>('produit')
  const [tri, setTri] = useState<'nom' | 'ajout'>('nom')
  const [depliees, setDepliees] = useState<Set<number>>(new Set())
  const [editionId, setEditionId] = useState<number | null>(null)
  const [editionTexte, setEditionTexte] = useState('')
  const [ajout, setAjout] = useState(false)
  const [ajoutProduit, setAjoutProduit] = useState('')
  const [ajoutColoris, setAjoutColoris] = useState('')
  const [ajoutMoteur, setAjoutMoteur] = useState('janus')
  const [ajoutTexte, setAjoutTexte] = useState('')
  const [busy, setBusy] = useState(false)

  async function charger() {
    try {
      const r = await fetch('/api/admin/descriptions')
      const d = await r.json().catch(() => null)
      if (r.ok && Array.isArray(d?.items)) setItems(d.items)
      else setNotice(d?.error ?? 'Chargement impossible.')
    } catch {
      setNotice('Impossible de contacter le serveur.')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    void charger()
  }, [])

  const filtrees = useMemo(() => {
    const q = recherche.trim().toLowerCase()
    if (!q) return items
    return items.filter((e) =>
      `${e.produit} ${e.coloris} ${CATEGORIES[e.moteur] ?? e.moteur} ${e.description}`
        .toLowerCase()
        .includes(q)
    )
  }, [items, recherche])

  /** Groupes selon la vue : clé d'affichage → entrées triées. */
  const groupes = useMemo(() => {
    const map = new Map<string, Entree[]>()
    for (const e of filtrees) {
      const cle = vue === 'produit' ? e.produit : (CATEGORIES[e.moteur] ?? e.moteur)
      if (!map.has(cle)) map.set(cle, [])
      map.get(cle)!.push(e)
    }
    const ordreEntrees = (a: Entree, b: Entree) =>
      tri === 'nom'
        ? a.produit.localeCompare(b.produit, 'fr') ||
          a.coloris.localeCompare(b.coloris, 'fr') ||
          b.id - a.id
        : b.id - a.id
    const noms = [...map.keys()].sort((a, b) =>
      tri === 'nom'
        ? a.localeCompare(b, 'fr')
        : Math.max(...map.get(b)!.map((e) => e.id)) - Math.max(...map.get(a)!.map((e) => e.id))
    )
    return noms.map((nom) => ({ nom, entrees: map.get(nom)!.sort(ordreEntrees) }))
  }, [filtrees, vue, tri])

  function basculerDepliee(id: number) {
    setDepliees((cur) => {
      const next = new Set(cur)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function enregistrerEdition() {
    if (editionId === null || busy) return
    setBusy(true)
    try {
      const r = await fetch('/api/admin/descriptions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editionId, description: editionTexte }),
      })
      const d = await r.json().catch(() => null)
      if (!r.ok) {
        setNotice(d?.error ?? 'Enregistrement impossible.')
        return
      }
      setEditionId(null)
      await charger()
    } catch {
      setNotice('Impossible de contacter le serveur.')
    } finally {
      setBusy(false)
    }
  }

  async function supprimer(e: Entree) {
    if (!window.confirm(`Supprimer la description ${e.produit} · ${e.coloris || '—'} ?`)) return
    try {
      const r = await fetch(`/api/admin/descriptions?id=${e.id}`, { method: 'DELETE' })
      const d = await r.json().catch(() => null)
      if (!r.ok) {
        setNotice(d?.error ?? 'Suppression impossible.')
        return
      }
      setItems((cur) => cur.filter((x) => x.id !== e.id))
    } catch {
      setNotice('Impossible de contacter le serveur.')
    }
  }

  async function ajouter() {
    if (busy) return
    setBusy(true)
    try {
      const r = await fetch('/api/admin/descriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          produit: ajoutProduit,
          coloris: ajoutColoris,
          moteur: ajoutMoteur,
          description: ajoutTexte,
        }),
      })
      const d = await r.json().catch(() => null)
      if (!r.ok) {
        setNotice(d?.error ?? 'Ajout impossible.')
        return
      }
      setAjout(false)
      setAjoutProduit('')
      setAjoutColoris('')
      setAjoutTexte('')
      await charger()
    } catch {
      setNotice('Impossible de contacter le serveur.')
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <Chargement />

  return (
    <div className="max-w-5xl mx-auto animate-fade-in-up">
      <div className="flex items-baseline gap-3 flex-wrap mb-1">
        <h1 className="text-2xl font-bold tracking-tight">Descriptions produit</h1>
        <span className="text-[13px] text-text-disabled font-semibold">
          {items.length} entrée{items.length > 1 ? 's' : ''}
        </span>
      </div>
      <p className="text-[12.5px] text-text-secondary mb-3">
        La fiche descriptive de chaque produit, utilisée pour générer les mises en situation. Une
        entrée = un produit + un coloris + une catégorie. Modifier ici change les prochaines
        générations.
      </p>

      {notice && (
        <div className="bg-brand-red-light text-brand-red text-sm rounded-[8px] px-4 py-3 mb-4 flex justify-between gap-4">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="text-brand-red/60 hover:text-brand-red">
            ✕
          </button>
        </div>
      )}

      {/* recherche CENTRALE (maquette v3) */}
      <input
        value={recherche}
        onChange={(e) => setRecherche(e.target.value)}
        placeholder="Rechercher un produit, un coloris, un mot de la description…"
        className="w-full bg-white border-[1.5px] border-border focus:border-brand-green outline-none rounded-[12px] px-5 py-3 text-[14.5px] shadow-sm mb-3.5"
      />

      {/* + Ajouter À GAUCHE des filtres (maquette v3) */}
      <div className="flex items-center gap-2.5 flex-wrap mb-4">
        <button
          onClick={() => setAjout((a) => !a)}
          className="bg-brand-green hover:bg-brand-green-hover text-white font-bold text-[13px] rounded-[10px] px-3.5 py-2"
        >
          + Ajouter
        </button>
        <span className="text-[11px] font-bold uppercase tracking-wider text-text-secondary ml-2">
          Vue
        </span>
        <div className="inline-flex border border-border rounded-[8px] overflow-hidden bg-white">
          {(
            [
              // « Par gamme » (renommage Mathias 07/08 — ex-« Par produit ») :
              // un groupe = une gamme (ATHOS, EIGER…), la clé technique ne bouge pas.
              ['produit', 'Par gamme'],
              ['categorie', 'Par catégorie'],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              onClick={() => setVue(v)}
              className={`px-3.5 py-1.5 text-[12.5px] font-bold ${
                vue === v ? 'bg-brand-green text-white' : 'bg-white text-text-secondary'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="text-[11px] font-bold uppercase tracking-wider text-text-secondary ml-2">
          Tri
        </span>
        <div className="inline-flex border border-border rounded-[8px] overflow-hidden bg-white">
          {(
            [
              ['nom', 'Nom'],
              ['ajout', 'Ordre d’ajout'],
            ] as const
          ).map(([t, label]) => (
            <button
              key={t}
              onClick={() => setTri(t)}
              className={`px-3.5 py-1.5 text-[12.5px] font-bold ${
                tri === t ? 'bg-brand-green text-white' : 'bg-white text-text-secondary'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* formulaire d'AJOUT (ligne verte, maquette v1/v3) */}
      {ajout && (
        <div className="bg-brand-green-light border border-brand-green/30 rounded-[12px] p-4 mb-5">
          <div className="flex items-center gap-2.5 flex-wrap mb-2.5">
            <input
              value={ajoutProduit}
              onChange={(e) => setAjoutProduit(e.target.value)}
              placeholder="Produit (ex. ATHOS)"
              className="border border-border bg-white rounded-[8px] px-3 py-2 text-[13px] w-[160px]"
            />
            <input
              value={ajoutColoris}
              onChange={(e) => setAjoutColoris(e.target.value)}
              placeholder="Coloris (ex. Teck)"
              className="border border-border bg-white rounded-[8px] px-3 py-2 text-[13px] w-[140px]"
            />
            <select
              value={ajoutMoteur}
              onChange={(e) => setAjoutMoteur(e.target.value)}
              className="border border-border bg-white rounded-[8px] px-3 py-2 text-[13px]"
            >
              {Object.entries(CATEGORIES).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <textarea
            value={ajoutTexte}
            onChange={(e) => setAjoutTexte(e.target.value)}
            placeholder={'STRUCTURE: …\nFRAME: …\nINFILL: …\nHARDWARE: …'}
            className="w-full min-h-[90px] border border-border bg-white rounded-[8px] px-3 py-2 text-[12.5px] resize-y"
          />
          <div className="flex justify-end gap-2 mt-2.5">
            <button
              onClick={() => setAjout(false)}
              className="bg-white border border-border text-text-secondary font-bold text-[13px] rounded-[8px] px-3.5 py-1.5"
            >
              Annuler
            </button>
            <button
              onClick={() => void ajouter()}
              disabled={busy}
              className="bg-brand-green hover:bg-brand-green-hover text-white font-bold text-[13px] rounded-[8px] px-3.5 py-1.5 disabled:opacity-50"
            >
              Enregistrer
            </button>
          </div>
        </div>
      )}

      {/* groupes (Par produit / Par catégorie) */}
      {groupes.length === 0 && (
        <p className="text-sm text-text-secondary">
          {items.length === 0
            ? 'Aucune description pour l’instant — elles se créent au fil des générations, ou avec « + Ajouter ».'
            : 'Aucune entrée ne correspond à la recherche.'}
        </p>
      )}
      {groupes.map(({ nom, entrees }) => (
        <section key={nom} className="mb-6">
          <h2 className="text-[15px] font-bold mb-2">
            {nom}{' '}
            <span className="text-[12px] text-text-disabled font-semibold">
              {entrees.length} entrée{entrees.length > 1 ? 's' : ''}
              {vue === 'produit'
                ? ` · ${[...new Set(entrees.map((e) => CATEGORIES[e.moteur] ?? e.moteur))].join(' · ')}`
                : ''}
            </span>
          </h2>
          <div className="bg-white border border-border rounded-[12px] shadow-sm overflow-hidden">
            <table className="w-full text-[13.5px]">
              <thead>
                <tr className="bg-surface text-left text-[11px] uppercase tracking-wider text-text-secondary">
                  {vue === 'categorie' && <th className="px-3.5 py-2 font-bold">Produit</th>}
                  <th className="px-3.5 py-2 font-bold">Coloris</th>
                  {vue === 'produit' && <th className="px-3.5 py-2 font-bold">Catégorie</th>}
                  <th className="px-3.5 py-2 font-bold w-full">Description</th>
                  <th className="px-3.5 py-2 font-bold">Origine</th>
                  <th className="px-3.5 py-2" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {entrees.map((e) => (
                  <tr key={e.id} className="border-t border-border align-top">
                    {vue === 'categorie' && (
                      <td className="px-3.5 py-2.5 font-bold whitespace-nowrap">{e.produit}</td>
                    )}
                    <td className="px-3.5 py-2.5 whitespace-nowrap">
                      <span className="text-[10.5px] font-bold font-mono bg-surface border border-border rounded-full px-2 py-0.5 text-text-secondary">
                        {e.coloris || '—'}
                      </span>
                    </td>
                    {vue === 'produit' && (
                      <td className="px-3.5 py-2.5 whitespace-nowrap">
                        <span className="text-[10.5px] font-bold font-mono bg-surface border border-border rounded-full px-2 py-0.5 text-text-secondary">
                          {CATEGORIES[e.moteur] ?? e.moteur}
                        </span>
                      </td>
                    )}
                    <td className="px-3.5 py-2.5">
                      {editionId === e.id ? (
                        <div>
                          <textarea
                            value={editionTexte}
                            onChange={(ev) => setEditionTexte(ev.target.value)}
                            className="w-full min-h-[110px] border border-brand-green rounded-[8px] px-2.5 py-2 text-[12.5px] resize-y"
                          />
                          <div className="flex justify-end gap-2 mt-2">
                            <button
                              onClick={() => setEditionId(null)}
                              className="bg-white border border-border text-text-secondary font-bold text-[12px] rounded-[8px] px-3 py-1"
                            >
                              Annuler
                            </button>
                            <button
                              onClick={() => void enregistrerEdition()}
                              disabled={busy}
                              className="bg-brand-green text-white font-bold text-[12px] rounded-[8px] px-3 py-1 disabled:opacity-50"
                            >
                              Enregistrer
                            </button>
                          </div>
                        </div>
                      ) : (
                        <p
                          onClick={() => basculerDepliee(e.id)}
                          title={depliees.has(e.id) ? 'Replier' : 'Déplier'}
                          className={`whitespace-pre-wrap text-[12.5px] text-text-secondary leading-relaxed cursor-pointer ${
                            depliees.has(e.id) ? '' : 'line-clamp-2'
                          }`}
                        >
                          {e.description}
                        </p>
                      )}
                    </td>
                    <td className="px-3.5 py-2.5 text-[11px] text-text-disabled whitespace-nowrap">
                      {origineDe(e)}
                      <br />
                      {formatDate(e.created_at)}
                    </td>
                    <td className="px-3.5 py-2.5 whitespace-nowrap text-right">
                      {editionId !== e.id && (
                        <>
                          <button
                            onClick={() => {
                              setEditionId(e.id)
                              setEditionTexte(e.description)
                            }}
                            className="text-[12px] font-bold border border-border rounded-[8px] px-2.5 py-1 text-text-secondary hover:text-brand-green hover:border-brand-green"
                          >
                            Modifier
                          </button>
                          <button
                            onClick={() => void supprimer(e)}
                            className="ml-1.5 text-[12px] font-bold border border-border rounded-[8px] px-2.5 py-1 text-text-secondary hover:text-brand-red hover:border-brand-red"
                          >
                            Supprimer
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  )
}
