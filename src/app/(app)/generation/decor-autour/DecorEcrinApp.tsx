'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { parseProduitFromFileName, parseSizeFromProductName } from '@/lib/productName'
import { PictoIllu } from '../../Silhouette'

/**
 * DÉCOR ÉCRIN — page officielle de génération « décor autour » (07/08/2026 :
 * le banc de test remplace l'ancienne page MES Écrin, décision Mathias).
 * Héritée du banc (maquette banc-generation-v1) :
 *  - dépôt d'images produit → chaque case affiche le PLAN GRIS (PNG posé à la
 *    vraie échelle, ce que Nano reçoit) dès l'upload ;
 *  - resizing OFFICIEL = celui rodé au banc (réf 400, gabarits bancCadrage) ;
 *  - versions + retours par prompt + choix persistant dans la vue en grand ;
 * Détail historique du banc :
 *  - dépôt d'images produit → chaque case affiche le PLAN GRIS (PNG posé à la
 *    vraie échelle, ce que Nano reçoit) dès l'upload ;
 *  - répartition par taille lue dans le nom : une largeur = UNE ligne (règle
 *    grille), taille illisible = rangée à part non générable ;
 *  - moteur détecté par la lettre (B/C/P), comme MES Écrin ;
 *  - Générer = 1 génération par image (jamais de multi-générations au banc) ;
 *  - pendant la génération la case « respire » avec une roue PAR-DESSUS le plan,
 *    le rendu reçu remplace le plan ; ↻ par case (regen du job) ;
 *  - clic sur une case = vue en grand identique à MES Écrin (comparateur à
 *    poignée parquée à GAUCHE, liens plan gris / rendu).
 */

type Typo = 'janus' | 'terminus' | 'forculus'

const TYPO_INFO: Record<Typo, { titre: string; lettre: string }> = {
  janus: { titre: 'Portail battant', lettre: 'B' },
  terminus: { titre: 'Portail coulissant', lettre: 'C' },
  forculus: { titre: 'Portillon', lettre: 'P' },
}

type Status =
  | 'detour'
  | 'ralify'
  | 'descr'
  | 'pose'
  | 'ready'
  | 'queued'
  | 'running'
  | 'done'
  | 'error'

/** Étape RÉELLE en cours pendant la préparation (demande Mathias 07/08 :
 *  afficher l'étape, pas un « préparation… » générique). */
const PREP_LABEL: Partial<Record<Status, string>> = {
  detour: 'Détourage',
  ralify: 'RALify',
  descr: 'Description',
  pose: 'Resizing',
}

const enPrepa = (s: Status): boolean =>
  s === 'detour' || s === 'ralify' || s === 'descr' || s === 'pose'

/** Trois petits points animés (chargement) — accolés au libellé d'étape. */
function Dots() {
  return (
    <span className="anim-dots">
      <span>.</span>
      <span>.</span>
      <span>.</span>
    </span>
  )
}

interface Item {
  key: string
  name: string
  w: number
  h: number
  coloris: string
  status: Status
  /** Aperçu navigateur du PNG déposé — il « respire » pendant la préparation
   *  locale (détourage → RALify → pose), avant que le plan gris n'existe. */
  localUrl?: string
  productPath?: string
  planPath?: string
  /** Plan posé SANS RALify — présent si RALify actif : comparateur avant/après. */
  planBrutPath?: string
  /** Fichier ORIGINEL déposé (avant détourage) — vue de contrôle. */
  originalPath?: string
  /** PNG produit RALifié — vue de contrôle (présent si RALify actif). */
  ralifyPath?: string
  deliveryPath?: string
  jobId?: number
  error?: string
  /** N° de dépôt : chaque « Ajouter des images » = un groupe, affiché à part
   *  (demande Mathias 07/08 : ne pas mélanger les essais, voir l'évolution). */
  groupe: number
  /** Brief vision du produit (bibliothèque) — affiché dans la vue en grand. */
  description?: string
  /** D'où vient la description : réutilisée ou fraîchement décrite. */
  descriptionSource?: 'bibliotheque' | 'vision'
  /** Prompt COMPLET réellement envoyé à Nano (résultat du job). */
  promptFinal?: string
  /** Rendu tombé EN DIRECT (pas restauré au reload) : la case le dévoile
   *  zone par zone (~2 s) au lieu de l'afficher d'un coup. */
  fraiche?: boolean
  /** Compteur de rejeu (Maj+clic sur la case) : changer la clé du composant
   *  de dévoilement rejoue l'animation sans rien regénérer. */
  rejeu?: number
  /** VERSION épinglée (retour arrière 07/08) — id du job affiché par la case.
   *  Absent = suivre la dernière version prête. Persisté dans le manifeste. */
  chosenJobId?: number
}

interface JobRow {
  id: number
  type: string
  status: string
  /** payload.productPath raccroche les jobs aux images du lot ; rootJobId
   *  raccroche les retours « mes-fix » à leur version d'origine. */
  payload: { productPath?: string; rootJobId?: number; instruction?: string } | null
  result: {
    deliveryPath?: string
    planPath?: string
    promptFinal?: string
    instruction?: string
  } | null
  error: string | null
}

// —————————————————————————————————————————————— versions d'une case
/** VERSIONS d'une image (retour arrière, 07/08) : tous ses jobs decor-autour
 *  (génération d'origine + regénérations) + les retours « mes-fix » qui leur
 *  sont rattachés, du plus ancien au plus récent. */
const normP = (p: string) => p.replace(/\\/g, '/')
function versionsPour(it: Pick<Item, 'productPath'>, jobs: JobRow[]): JobRow[] {
  if (!it.productPath) return []
  const racines = jobs.filter(
    (j) =>
      j.type === 'decor-autour' &&
      typeof j.payload?.productPath === 'string' &&
      normP(j.payload.productPath).endsWith(normP(it.productPath!))
  )
  const ids = new Set(racines.map((j) => j.id))
  const fixes = jobs.filter(
    (j) =>
      j.type === 'mes-fix' &&
      typeof j.payload?.rootJobId === 'number' &&
      ids.has(j.payload.rootJobId)
  )
  return [...racines, ...fixes].sort((a, b) => a.id - b.id)
}

/** Applique l'état des versions à une case : statut, rendu affiché (version
 *  épinglée sinon dernière prête), dévoilement sur les rendus qui TOMBENT. */
function appliquerVersions(it: Item, jobs: JobRow[]): Item {
  const versions = versionsPour(it, jobs)
  if (versions.length === 0) return it
  const racines = versions.filter((j) => j.type === 'decor-autour')
  const jobId = racines.length ? racines[racines.length - 1].id : it.jobId
  const pretes = versions.filter((j) => j.status === 'done' && j.result?.deliveryPath)
  const choisie = it.chosenJobId ? pretes.find((j) => j.id === it.chosenJobId) : undefined
  const affichee = choisie ?? (pretes.length ? pretes[pretes.length - 1] : undefined)
  const enCours = versions.some((j) => j.status === 'queued' || j.status === 'running')
  if (enCours) {
    return {
      ...it,
      jobId,
      status: versions.some((j) => j.status === 'running') ? 'running' : 'queued',
      deliveryPath: affichee?.result?.deliveryPath ?? it.deliveryPath,
      error: undefined,
    }
  }
  if (affichee) {
    return {
      ...it,
      jobId,
      status: 'done',
      // Dévoilement seulement quand le rendu TOMBE (la case était en travail) —
      // pas au reload, pas quand on rebascule de version.
      fraiche: it.status === 'queued' || it.status === 'running' ? true : it.fraiche,
      deliveryPath: affichee.result!.deliveryPath,
      planPath: affichee.result?.planPath ?? it.planPath,
      promptFinal: affichee.result?.promptFinal ?? it.promptFinal,
      error: undefined,
    }
  }
  const derniere = versions[versions.length - 1]
  if (derniere.status === 'error') {
    return { ...it, jobId, status: 'error', error: derniere.error ?? 'échec' }
  }
  // Génération ANNULÉE en file (08/08) : la case redevient « prêt » — le plan
  // gris est toujours là, relançable quand on veut.
  if (derniere.status === 'cancelled') {
    return { ...it, jobId, status: 'ready', error: undefined }
  }
  return { ...it, jobId }
}

function imgUrl(p: string, w?: number): string {
  const base = `/api/artifacts?p=${encodeURIComponent(p)}`
  return w ? `${base}&w=${w}` : base
}

/** Coloris lu dans le nom de fichier. Les coloris AJOUTÉS à la palette
 *  (Admin → Réglages → RALify, 07/08) sont reconnus en premier — sinon un
 *  « Beige » retomberait sur Gris et sa règle RALify ne jouerait jamais. */
function parseColoris(name: string, palette: string[] = []): string {
  const up = name.toUpperCase()
  for (const label of palette) {
    if (label && up.includes(label.toUpperCase())) return label
  }
  if (/WHITE|BLANC/.test(up)) return 'Blanc'
  if (/BLACK|NOIR|9005/.test(up)) return 'Noir'
  if (/TECK|TEAK|BOIS/.test(up)) return 'Teck'
  return 'Gris'
}

// —————————————————————————————————————————————— comparateur avant/après
/** Copie du comparateur MES Écrin (07/08) : poignée à cheval sur le bord
 *  gauche au repos — l'image « après » s'affiche pleine, on tire vers la
 *  droite pour révéler l'« avant ». Labels paramétrables (avant/après RALify). */
function Comparateur({
  avant,
  apres,
  labelAvant = 'avant',
  labelApres = 'après',
}: {
  avant: string
  apres: string
  labelAvant?: string
  labelApres?: string
}) {
  const [pos, setPos] = useState(0)
  const [drag, setDrag] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const move = useCallback((clientX: number) => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setPos(Math.max(0, Math.min(100, ((clientX - r.left) / r.width) * 100)))
  }, [])
  // Glisser au niveau fenêtre (comme HoorTRADS) : la poignée va jusqu'aux deux
  // bouts sans que le drag lâche quand le curseur sort du cadre.
  useEffect(() => {
    if (!drag) return
    const onMove = (e: MouseEvent) => move(e.clientX)
    const onUp = () => setDrag(false)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [drag, move])
  /** Parquée hors de l'image : uniquement au repos, jamais pendant le glisser
   *  (en glisser, le rond reste centré sur la ligne, bord compris). */
  const parquee = !drag && pos < 1
  return (
    // La zone de saisie déborde de 48 px à gauche : la moitié extérieure du
    // rond au repos reste attrapable.
    <div
      // Curseur CROIX (crosshair) sur la MES ouverte (08/08, demande Mathias).
      className="absolute inset-y-0 -left-12 right-0 select-none cursor-crosshair"
      onMouseDown={(e) => {
        e.preventDefault()
        setDrag(true)
        move(e.clientX)
      }}
    >
      <div ref={ref} className="absolute inset-y-0 left-12 right-0">
        <div className="absolute inset-0 overflow-hidden rounded-[10px]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={apres} alt="après" className="absolute inset-0 w-full h-full object-cover" />
          <div
            className={`absolute top-0 left-0 h-full overflow-hidden ${parquee ? '' : 'border-r-2 border-white'}`}
            style={{ width: `${pos}%` }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={avant}
              alt="avant"
              className="absolute top-0 left-0 h-full max-w-none object-cover"
              style={{ width: `${(10000 / Math.max(pos, 1)).toFixed(2)}%` }}
            />
            {/* Étiquette DANS la tranche révélée : poignée au repos = invisible —
                par défaut on ne voit QUE la vue « après » et son étiquette. */}
            <span className="absolute bottom-1.5 left-1.5 text-[9px] font-bold uppercase tracking-wide text-white bg-black/40 rounded-full px-1.5 pointer-events-none whitespace-nowrap">
              {labelAvant}
            </span>
          </div>
          <span className="absolute bottom-1.5 right-1.5 text-[9px] font-bold uppercase tracking-wide text-white bg-black/40 rounded-full px-1.5 pointer-events-none">
            {labelApres}
          </span>
        </div>
        {!parquee && (
          <div
            className="absolute top-0 bottom-0 w-[3px] bg-white shadow-md -translate-x-[1.5px]"
            style={{ left: `${pos}%` }}
          />
        )}
        {/* Poignée HoorTRADS (chevrons ‹ ›) : rond toujours centré sur la ligne —
            aux deux bouts (et au repos à gauche) il est à cheval sur le bord. */}
        <div
          className="absolute top-1/2 w-8 h-8 rounded-full bg-white shadow-lg flex items-center justify-center border border-border"
          style={{ left: `${pos}%`, transform: 'translate(-50%, -50%)' }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-text-secondary"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-text-secondary -ml-1"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </div>
      </div>
    </div>
  )
}

// —————————————————————————————————————————————— dévoilement du rendu
/** Un rendu fraîchement généré « naît » du plan gris : les détails arrivent
 *  d'abord en niveaux de gris au-dessus du gabarit, puis la couleur infuse
 *  (~1,2 s) — l'impression que le plan devient réel. */
function RenduDevoile({ src }: { src: string }) {
  /** Le dévoilement ne démarre qu'une fois le rendu CHARGÉ (sinon l'animation
   *  court pendant le téléchargement et on la rate). */
  const [pret, setPret] = useState(false)
  const [fini, setFini] = useState(false)
  useEffect(() => {
    if (!pret) return
    const t = setTimeout(() => setFini(true), 1300)
    return () => clearTimeout(t)
  }, [pret])
  if (!pret) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        onLoad={() => setPret(true)}
        className="absolute inset-0 w-full h-full object-cover opacity-0"
      />
    )
  }
  return (
    // Une fois l'animation jouée (forwards), retirer la classe laisse l'image
    // exactement dans son état final — pas de bascule visible.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      className={`absolute inset-0 w-full h-full object-cover ${fini ? '' : 'anim-plan-vivant'}`}
    />
  )
}

// —————————————————————————————————————————————— app
export default function DecorEcrinApp() {
  const [typo, setTypo] = useState<Typo>('janus')
  const [typoDetected, setTypoDetected] = useState(false)
  const [produit, setProduit] = useState('')
  const [imageSize, setImageSize] = useState<'2K' | '4K'>('2K')
  const [items, setItems] = useState<Item[]>([])
  /** Tous les jobs du lot (decor-autour + retours mes-fix) : nourrit la galerie
   *  de VERSIONS de la vue en grand et l'état des cases (07/08). */
  const [batchJobs, setBatchJobs] = useState<JobRow[]>([])
  /** Fichiers illisibles (pas de taille dans le nom) — non générables. */
  const [rejets, setRejets] = useState<string[]>([])
  /** Lot persistant (?lot=… dans l'URL) : manifeste serveur + batchId des jobs. */
  const [lotId, setLotId] = useState<string | null>(null)
  const [batchId, setBatchId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [hot, setHot] = useState(false)
  const [launching, setLaunching] = useState(false)
  const [lightbox, setLightbox] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  /** Images ANNULÉES pendant la préparation (08/08) : la chaîne vérifie ce
   *  drapeau entre chaque étape et s'arrête sans bruit. */
  const annulees = useRef(new Set<string>())
  /** Ouverture d'une session (?lot=/?session=) en cours — anim visible (08/08). */
  const [ouvertureLot, setOuvertureLot] = useState(false)
  /** NOM de la session (titre des cartes de l'Accueil) — renommable sur place
   *  (08/08, demande Mathias : partout, Accueil, liste ET dans la session). */
  const [nomSession, setNomSession] = useState('')
  /** Valeur en cours d'édition du nom (null = pas d'édition). */
  const [renommage, setRenommage] = useState<string | null>(null)
  async function renommerSession(valeur: string) {
    const nom = valeur.trim().slice(0, 60)
    setRenommage(null)
    if (!nom || !lotId || nom === nomSession) return
    setNomSession(nom)
    try {
      // La ligne de session (cartes Accueil) ET le manifeste du lot.
      await fetch(`/api/generation/sessions/${encodeURIComponent(lotId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ produit: nom }),
      })
      await fetch('/api/banc-generation/lot', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: lotId, produit: nom }),
      })
    } catch {
      setNotice('Impossible d’enregistrer le nouveau nom de session.')
    }
  }
  /** Libellés des coloris PERSONNALISÉS de la palette (Admin → Réglages →
   *  RALify, 07/08) : reconnus dans les noms de fichiers avant les règles
   *  historiques Gris/Noir/Blanc/Teck. */
  const [paletteColoris, setPaletteColoris] = useState<string[]>([])
  /** Chaînes de préparation simultanées — réglage global (Admin → Réglages →
   *  Générations & modèle, 07/08 soir), défaut 3. */
  const prepConc = useRef(3)
  useEffect(() => {
    fetch('/api/settings')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const n = Number(d?.prepConcurrence)
        if (Number.isInteger(n) && n >= 1 && n <= 6) prepConc.current = n
      })
      .catch(() => {})
  }, [])
  useEffect(() => {
    fetch('/api/coloris')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (Array.isArray(d?.coloris)) {
          setPaletteColoris(
            (d.coloris as { label?: string; custom?: boolean }[])
              .filter((c) => c.custom && typeof c.label === 'string')
              .map((c) => c.label as string)
          )
        }
      })
      .catch(() => {})
  }, [])
  const seq = useRef(0)
  /** Prochain n° de dépôt (repart après le plus grand groupe restauré). */
  const groupeSeq = useRef(1)

  // — robustesse au reload (demande Mathias 07/08) : le lot vit dans l'URL. Au
  //   montage on relit le manifeste (plans déjà préparés) puis les jobs du lot
  //   (/api/gamme/<lot> — le lot sert de batchId), raccrochés par productPath.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    // ?session=… : les cartes « Mes sessions » de l'accueil arrivent avec ce
    // paramètre — un lot Décor Écrin (banc-…) se rouvre tel quel ; une session
    // de l'ANCIENNE page MES Écrin (supprimée 07/08) n'est plus consultable.
    const session = q.get('session')
    const lot = q.get('lot') ?? (session && /^banc-/i.test(session) ? session : null)
    if (!lot) {
      if (session) {
        setNotice(
          'Cette session vient de l’ancienne version de MES Contrainte (remplacée) — elle n’est plus consultable ici. Ajoute tes images pour une nouvelle session.'
        )
      }
      return
    }
    let alive = true
    setOuvertureLot(true)
    ;(async () => {
      try {
        const r = await fetch(`/api/banc-generation/lot?id=${encodeURIComponent(lot)}`)
        if (!r.ok) return
        const d = await r.json()
        if (!alive || !Array.isArray(d?.items)) return
        if (d.moteur === 'janus' || d.moteur === 'terminus' || d.moteur === 'forculus') {
          setTypo(d.moteur)
          setTypoDetected(true)
        }
        if (typeof d.produit === 'string' && d.produit) {
          setProduit(d.produit)
          setNomSession(d.produit)
        }
        let restored: Item[] = (
          d.items as {
            name: string
            w: number
            h: number
            coloris?: string
            productPath: string
            planPath: string
            planBrutPath?: string
            groupe?: number
            originalPath?: string
            ralifyPath?: string
            chosenJobId?: number
          }[]
        ).map((m) => ({
          key: `it-${seq.current++}`,
          name: m.name,
          w: m.w,
          h: m.h,
          coloris: m.coloris || 'Gris',
          status: 'ready' as Status,
          productPath: m.productPath,
          planPath: m.planPath,
          planBrutPath: m.planBrutPath,
          groupe: m.groupe ?? 0,
          originalPath: m.originalPath,
          ralifyPath: m.ralifyPath,
          chosenJobId: m.chosenJobId,
        }))
        groupeSeq.current = Math.max(0, ...restored.map((i) => i.groupe)) + 1
        let jobs: JobRow[] = []
        try {
          const rg = await fetch(`/api/gamme/${encodeURIComponent(lot)}`)
          if (rg.ok) {
            const dg = await rg.json()
            if (Array.isArray(dg.jobs)) {
              jobs = (dg.jobs as JobRow[]).filter(
                (j) => j.type === 'decor-autour' || j.type === 'mes-fix' || j.type === 'marketplace'
              )
              restored = restored.map((it) => appliquerVersions(it, jobs))
            }
          }
        } catch {
          // pas de jobs : lot jamais généré — les plans suffisent
        }
        if (!alive) return
        setLotId(lot)
        setBatchId(lot)
        setBatchJobs(jobs)
        setItems(restored)
      } catch {
        // lot illisible : la page démarre vide
      } finally {
        if (alive) setOuvertureLot(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  // Entrée « via le catalogue » (acté Mathias 07/08, « comme le legacy ») :
  // ?produit=<id catalogue> sur une page vierge → les visuels générables du
  // produit (détourage local sinon face du serveur) sont téléchargés puis
  // entrent dans la chaîne NORMALE, comme un glisser-déposer.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const produitId = q.get('produit')
    if (!produitId || q.get('lot') || q.get('session')) return
    let alive = true
    ;(async () => {
      try {
        const r = await fetch(`/api/catalogue/${encodeURIComponent(produitId)}/mes-contrainte`)
        const d = await r.json().catch(() => null)
        if (!alive) return
        if (!r.ok || !Array.isArray(d?.items)) {
          setNotice(d?.error ?? 'Produit du catalogue introuvable.')
          return
        }
        if (d.items.length === 0) {
          setNotice(
            'Aucun visuel générable pour ce produit — détoure-le d’abord dans le Catalogue.'
          )
          return
        }
        const files: File[] = []
        for (const it of d.items as { name: string; url: string }[]) {
          try {
            const rb = await fetch(it.url)
            if (!rb.ok) continue
            const blob = await rb.blob()
            files.push(new File([blob], it.name, { type: blob.type || 'image/png' }))
          } catch {
            // visuel illisible : on continue avec les autres
          }
        }
        if (!alive) return
        if (files.length === 0) {
          setNotice('Impossible de télécharger les visuels de ce produit.')
          return
        }
        void addFiles(files)
      } catch {
        if (alive) setNotice('Impossible de contacter le serveur.')
      }
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Fichiers d'un glisser-déposer, DOSSIERS COMPRIS (08/08, demande Mathias :
   *  la boîte de dialogue navigateur ne sait faire QUE fichiers OU dossier —
   *  le drop, lui, accepte les deux ; un dossier déposé est parcouru
   *  récursivement). */
  async function fichiersDepuisDrop(dt: DataTransfer): Promise<File[]> {
    const entries = Array.from(dt.items).map((i) =>
      typeof i.webkitGetAsEntry === 'function' ? i.webkitGetAsEntry() : null
    )
    if (!entries.some((e) => e?.isDirectory)) return Array.from(dt.files)
    const out: File[] = []
    const lire = async (entry: FileSystemEntry): Promise<void> => {
      if (entry.isFile) {
        const f = await new Promise<File>((res, rej) =>
          (entry as FileSystemFileEntry).file(res, rej)
        )
        out.push(f)
      } else if (entry.isDirectory) {
        const reader = (entry as FileSystemDirectoryEntry).createReader()
        // readEntries se rappelle jusqu'à liste vide (par paquets de ~100).
        let paquet: FileSystemEntry[]
        do {
          paquet = await new Promise<FileSystemEntry[]>((res, rej) =>
            reader.readEntries(res, rej)
          )
          for (const e of paquet) await lire(e)
        } while (paquet.length > 0)
      }
    }
    for (const e of entries) if (e) await lire(e)
    return out
  }

  // — ajout : parse des noms, puis UNE requête PAR image (traitement un à un,
  //   chaque case s'affiche dès que SON plan est prêt — demande Mathias 07/08) —
  async function addFiles(list: FileList | File[] | null) {
    if (!list?.length) return
    setNotice(null)
    // La sélection de dossier ramène TOUT le contenu : on ne garde que les images.
    let files = Array.from(list).filter((f) => /\.(png|jpe?g|webp)$/i.test(f.name))
    if (files.length === 0) {
      setNotice('Aucune image (PNG, JPG ou WEBP) dans cette sélection.')
      return
    }

    // VERROU CATÉGORIE (acté Mathias 07/08 : une session = un groupe d'images
    // d'UNE catégorie). La lettre de la 1ʳᵉ image — ou le choix du sélecteur —
    // fixe la catégorie ; ensuite toute image d'une autre lettre est REFUSÉE.
    const lettreDe = (n: string) => n.toUpperCase().match(/\d{2,3}([BCP])\d{2,3}/)?.[1] ?? null
    let effTypo: Typo = typo
    let verrou = typoDetected || items.length > 0
    if (!verrou) {
      const premiere = files.map((f) => lettreDe(f.name)).find((l) => l !== null)
      if (premiere) {
        effTypo = premiere === 'C' ? 'terminus' : premiere === 'P' ? 'forculus' : 'janus'
        setTypo(effTypo)
        setTypoDetected(true)
        verrou = true
      }
    }
    if (verrou) {
      const lettreSession = TYPO_INFO[effTypo].lettre
      const refusees = files.filter((f) => {
        const l = lettreDe(f.name)
        return l !== null && l !== lettreSession
      })
      if (refusees.length > 0) {
        files = files.filter((f) => !refusees.includes(f))
        const n = refusees.length
        // Message DÉTAILLÉ (08/08, demande Mathias) : quels fichiers, quelle
        // catégorie détectée pour chacun, et quoi faire.
        const nomCategorie = (l: string | null) =>
          l === 'C' ? 'coulissant' : l === 'P' ? 'portillon' : 'battant'
        const details = refusees
          .slice(0, 3)
          .map((f) => `« ${f.name} » (${nomCategorie(lettreDe(f.name))})`)
          .join(', ')
        const reste = n > 3 ? ` et ${n - 3} autre${n - 3 > 1 ? 's' : ''}` : ''
        setNotice(
          n === 1
            ? `Cette session est en ${TYPO_INFO[effTypo].titre} — ${details} n'en est pas et a été écartée. Clique sur « Nouvelle session » pour la générer à part.`
            : `Cette session est en ${TYPO_INFO[effTypo].titre} — ${n} images d'autres catégories ont été écartées : ${details}${reste}. Clique sur « Nouvelle session » pour les générer à part.`
        )
        if (files.length === 0) return
      }
    }
    let effProduit = produit
    if (!effProduit) {
      for (const f of files) {
        const det = parseProduitFromFileName(f.name)
        if (det) {
          effProduit = det
          setProduit(det)
          break
        }
      }
    }

    const valides: { file: File; item: Item }[] = []
    const sansTaille: string[] = []
    for (const f of files) {
      const size = parseSizeFromProductName(f.name)
      if (!size) {
        sansTaille.push(f.name)
        continue
      }
      valides.push({
        file: f,
        item: {
          key: `it-${seq.current++}`,
          name: f.name,
          w: size.w,
          h: size.h,
          coloris: parseColoris(f.name, paletteColoris),
          status: 'detour',
          localUrl: URL.createObjectURL(f),
          groupe: 0, // posé juste après (un seul n° pour tout le dépôt)
        },
      })
    }
    if (sansTaille.length) setRejets((cur) => [...cur, ...sansTaille])
    if (valides.length === 0) return

    // Un dépôt = UN groupe : les essais restent séparés à l'écran.
    const groupe = groupeSeq.current++
    valides.forEach((v) => {
      v.item.groupe = groupe
    })

    // Les cases apparaissent en « détourage… » et avancent 3 DE FRONT, étape
    // par étape (le libellé suit la vraie étape serveur en cours).
    setItems((cur) => [...cur, ...valides.map((v) => v.item)])
    let lot = lotId
    const patchItem = (key: string, patch: Partial<Item>) =>
      setItems((cur) => cur.map((i) => (i.key === key ? { ...i, ...patch } : i)))
    const fail = (v: { item: Item }, msg: string) => {
      if (v.item.localUrl) URL.revokeObjectURL(v.item.localUrl)
      patchItem(v.item.key, { status: 'error', localUrl: undefined, error: msg })
    }
    // UNE description par clé produit DANS LE DÉPÔT (demande Mathias 07/08) :
    // les images jumelles partagent le même appel — vital avec 3 chaînes de
    // front, sinon 3 visions partiraient pour la même clé avant l'enregistrement.
    const descPartagees = new Map<
      string,
      Promise<{ description?: string; source?: string } | null>
    >()

    // Chaîne RÉELLE, étape par étape (demande Mathias 07/08 : la case affiche la
    // vraie étape) : 1. détourage → 2. RALify → 3. description → 4. pose.
    // Chaque image déroule SA chaîne complète ; 3 images avancent de front
    // (choix Mathias 07/08 — même plafond que le sas serveur).
    /** Point de contrôle d'annulation (08/08) : true = image annulée, la
     *  chaîne s'arrête là ; les fichiers déjà au manifeste sont nettoyés
     *  (404 bénin tant que la pose n'a pas écrit le manifeste). */
    const annulee = (key: string, productPath?: string) => {
      if (!annulees.current.has(key)) return false
      annulees.current.delete(key)
      if (productPath && lot) {
        void fetch(
          `/api/banc-generation/lot?id=${encodeURIComponent(lot)}&p=${encodeURIComponent(productPath)}`,
          { method: 'DELETE' }
        ).catch(() => {})
      }
      return true
    }

    const preparer = async (v: (typeof valides)[number]) => {
      try {
        if (annulee(v.item.key)) return
        // 1/4 — détourage
        const fd = new FormData()
        fd.append('moteur', effTypo)
        if (lot) fd.append('lot', lot)
        fd.append('file', v.file, v.file.name)
        const r1 = await fetch('/api/banc-generation/upload', { method: 'POST', body: fd })
        const d1 = await r1.json().catch(() => null)
        // Lot créé au 1ᵉʳ dépôt : gardé et gravé dans l'URL — le rechargement
        // de la page retrouvera plans et jobs.
        if (typeof d1?.lotId === 'string' && d1.lotId !== lot) {
          lot = d1.lotId
          setLotId(lot)
          window.history.replaceState(null, '', `/generation/decor-autour?lot=${lot}`)
          // Nom de session initial = celui que le serveur donne à la carte
          // (produit du 1ᵉʳ fichier) — renommable ensuite au ✎.
          setNomSession((cur) => cur || parseProduitFromFileName(v.file.name) || 'Session')
        }
        if (!r1.ok || typeof d1?.productPath !== 'string') {
          fail(v, d1?.error ?? 'échec du détourage')
          return
        }
        if (annulee(v.item.key, d1.productPath)) return
        // 2/4 — RALify (le serveur ne touche à rien si la cible est nulle)
        patchItem(v.item.key, {
          status: 'ralify',
          productPath: d1.productPath,
          originalPath: typeof d1.originalPath === 'string' ? d1.originalPath : undefined,
        })
        const r2 = await fetch('/api/banc-generation/ralify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            lot,
            moteur: effTypo,
            productPath: d1.productPath,
            name: v.file.name,
            coloris: v.item.coloris,
          }),
        })
        const d2 = await r2.json().catch(() => null)
        if (!r2.ok) {
          fail(v, d2?.error ?? 'échec RALify')
          return
        }
        // 3/4 — description produit (bibliothèque d'abord, sinon vision imposante
        // + enregistrement — rodage 07/08, clé produit+coloris+moteur). UN seul
        // appel PAR CLÉ dans le dépôt : les jumelles attendent la même promesse.
        patchItem(v.item.key, {
          status: 'descr',
          ralifyPath: typeof d2?.ralifyPath === 'string' ? d2.ralifyPath : undefined,
        })
        const cle = `${parseProduitFromFileName(v.file.name) || v.file.name}|${v.item.coloris}|${effTypo}`
        let attente = descPartagees.get(cle)
        if (!attente) {
          attente = (async () => {
            const r25 = await fetch('/api/banc-generation/description', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                lot,
                moteur: effTypo,
                productPath: d1.productPath,
                name: v.file.name,
                coloris: v.item.coloris,
              }),
            })
            const d25 = await r25.json().catch(() => null)
            return r25.ok ? d25 : null
          })()
          descPartagees.set(cle, attente)
        }
        const d25 = await attente.catch(() => null)
        if (annulee(v.item.key, d1.productPath)) return
        if (!d25) {
          fail(v, 'échec de la description produit')
          return
        }
        patchItem(v.item.key, {
          description: typeof d25?.description === 'string' ? d25.description : undefined,
          descriptionSource: d25?.source === 'bibliotheque' ? 'bibliotheque' : 'vision',
        })
        // 4/4 — pose / resizing (référence 400)
        patchItem(v.item.key, { status: 'pose' })
        const r3 = await fetch('/api/banc-generation/pose', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            lot,
            moteur: effTypo,
            productPath: d1.productPath,
            ralifyPath: d2?.ralifyPath ?? null,
            w: v.item.w,
            h: v.item.h,
            name: v.file.name,
            coloris: v.item.coloris,
            produit: effProduit,
            groupe: v.item.groupe,
            originalPath: d1.originalPath ?? null,
          }),
        })
        const d3 = await r3.json().catch(() => null)
        // Après la pose le manifeste est écrit : l'annulation nettoie le serveur.
        if (annulee(v.item.key, d1.productPath)) return
        if (!r3.ok || typeof d3?.planPath !== 'string') {
          fail(v, d3?.error ?? 'échec de la pose')
          return
        }
        // Le plan gris (RALify par défaut) remplace l'aperçu navigateur.
        if (v.item.localUrl) URL.revokeObjectURL(v.item.localUrl)
        patchItem(v.item.key, {
          status: 'ready',
          localUrl: undefined,
          planPath: d3.planPath,
          planBrutPath: d3.planBrutPath ?? undefined,
        })
      } catch {
        fail(v, 'serveur injoignable')
      }
    }

    // La 1ʳᵉ image crée le lot SEULE (des créations parallèles = autant de
    // lots), puis les ouvrières (réglage « préparation simultanée », défaut 3)
    // se partagent la file — chaque case suit sa vraie étape.
    const file = [...valides]
    if (!lot && file.length > 0) await preparer(file.shift()!)
    const ouvriere = async () => {
      for (let v = file.shift(); v; v = file.shift()) await preparer(v)
    }
    await Promise.all(
      Array.from({ length: Math.min(prepConc.current, file.length) }, () => ouvriere())
    )
  }

  /** ✕ d'une case : retirée de l'écran ET du manifeste serveur (fichiers
   *  effacés) — sinon l'image « revenait » au rechargement de la page. */
  async function removeItem(key: string) {
    const it = items.find((i) => i.key === key)
    if (!it) return
    if (it.localUrl) URL.revokeObjectURL(it.localUrl)
    setItems((cur) => cur.filter((i) => i.key !== key))
    if (it.productPath && lotId) {
      try {
        await fetch(
          `/api/banc-generation/lot?id=${encodeURIComponent(lotId)}&p=${encodeURIComponent(it.productPath)}`,
          { method: 'DELETE' }
        )
      } catch {
        // serveur injoignable : la case est retirée de l'écran, le manifeste
        // sera purgé à la prochaine suppression réussie
      }
    }
  }

  // — génération : 1 job par image prête (pas encore lancée) —
  const aLancer = items.filter((i) => i.status === 'ready' && !i.jobId)
  async function generate() {
    if (aLancer.length === 0 || launching) return
    setLaunching(true)
    setNotice(null)
    try {
      const res = await fetch('/api/banc-generation/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: aLancer.map((i) => ({
            productPath: i.productPath,
            w: i.w,
            h: i.h,
            coloris: i.coloris,
            // Nom d'origine = clé de la bibliothèque de descriptions.
            name: i.name,
          })),
          moteur: typo,
          imageSize,
          // Le LOT sert de batchId : au reload, /api/gamme/<lot> retrouve les jobs.
          batchId: lotId ?? batchId,
          produit,
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !Array.isArray(data?.jobIds)) {
        setNotice(data?.error ?? 'Échec du lancement.')
        return
      }
      // jobIds aligné avec les items envoyés (1 génération par image).
      setBatchId(data.batchId)
      setItems((cur) =>
        cur.map((i) => {
          const idx = aLancer.findIndex((a) => a.key === i.key)
          return idx === -1 ? i : { ...i, jobId: data.jobIds[idx], status: 'queued' as Status }
        })
      )
    } catch {
      setNotice('Impossible de contacter le serveur.')
    } finally {
      setLaunching(false)
    }
  }

  // — ↻ par case : relance FRAÎCHE via generate (nouveau job) — le regen
  //   générique rejouait l'ancien payload, donc une description PÉRIMÉE après
  //   « forcer la vision » (07/08) ; ici la bibliothèque est relue à chaque fois.
  async function regen(it: Item) {
    if (!it.productPath || it.status === 'queued' || it.status === 'running' || !lotId) return
    try {
      const res = await fetch('/api/banc-generation/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [
            { productPath: it.productPath, w: it.w, h: it.h, coloris: it.coloris, name: it.name },
          ],
          moteur: typo,
          imageSize,
          batchId: lotId,
          produit,
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !Array.isArray(data?.jobIds) || data.jobIds.length === 0) {
        setNotice(data?.error ?? 'Relance impossible.')
        return
      }
      // Une relance désépingle la version retenue : on suit la nouvelle.
      if (it.chosenJobId) void epinglerVersion(it, null)
      setItems((cur) =>
        cur.map((x) =>
          x.key === it.key
            ? {
                ...x,
                jobId: data.jobIds[0],
                status: 'queued' as Status,
                error: undefined,
                chosenJobId: undefined,
              }
            : x
        )
      )
    } catch {
      setNotice('Impossible de contacter le serveur.')
    }
  }

  // — vue en grand : VERSIONS (retour arrière) + RETOURS par prompt (07/08,
  //   même mécanique que le studio MES — le banc remplacera la page actuelle) —
  /** Version REGARDÉE dans la vue en grand (null = celle de la case). */
  const [verJobId, setVerJobId] = useState<number | null>(null)
  const [instruction, setInstruction] = useState('')
  const [retourBusy, setRetourBusy] = useState(false)

  /** Épingle (ou libère : null) la version affichée par la case — persisté au
   *  manifeste pour survivre au rechargement. */
  async function epinglerVersion(it: Item, jobId: number | null) {
    if (!lotId || !it.productPath) return
    setItems((cur) =>
      cur.map((x) =>
        x.key === it.key
          ? appliquerVersions({ ...x, chosenJobId: jobId ?? undefined }, batchJobs)
          : x
      )
    )
    try {
      await fetch('/api/banc-generation/lot', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: lotId, p: it.productPath, chosenJobId: jobId }),
      })
    } catch {
      // le choix restera au moins pour la session — le manifeste se resynchronisera
    }
  }

  /** ANNULER une image PENDANT sa préparation (08/08, demande Mathias) : la
   *  case disparaît tout de suite, la chaîne s'arrête à son prochain point de
   *  contrôle et les fichiers déjà posés sont nettoyés. */
  function annulerPrepa(it: Item) {
    annulees.current.add(it.key)
    if (it.localUrl) URL.revokeObjectURL(it.localUrl)
    setItems((cur) => cur.filter((x) => x.key !== it.key))
  }

  /** ANNULER une génération encore EN FILE (un appel Nano en vol ne peut pas
   *  être interrompu — l'API refuse proprement dans ce cas). */
  async function annulerJob(it: Item) {
    const versions = versionsPour(it, batchJobs)
    const enFile = versions.filter((j) => j.status === 'queued')
    if (enFile.length === 0) return
    try {
      let ok = false
      for (const j of enFile) {
        const res = await fetch(`/api/jobs/${j.id}/cancel`, { method: 'POST' })
        if (res.ok) ok = true
      }
      if (ok) {
        // Retour immédiat à « prêt » (plan gris conservé) — le poll confirmera.
        setItems((cur) =>
          cur.map((x) => (x.key === it.key ? { ...x, status: 'ready' as Status } : x))
        )
      } else {
        setNotice('Impossible d’annuler : la génération est déjà partie chez Nano.')
      }
    } catch {
      setNotice('Impossible de contacter le serveur.')
    }
  }

  /** DÉCLINAISON MARKETPLACE (1:1) de la version regardée — route MP commune
   *  (recadrage + bords générés), rebranchee sur la page officielle 07/08 soir.
   *  Le réglage moteur « jamais » est appliqué côté serveur (erreur claire). */
  const [mpBusy, setMpBusy] = useState(false)
  async function envoyerMp(cibleJobId: number) {
    if (mpBusy) return
    setMpBusy(true)
    try {
      const res = await fetch('/api/generation/mp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobIds: [cibleJobId] }),
      })
      const d = await res.json().catch(() => null)
      if (!res.ok || !Array.isArray(d?.jobIds) || d.jobIds.length === 0) {
        setNotice(
          d?.error ?? (Array.isArray(d?.errors) && d.errors[0]) ?? 'Déclinaison MP impossible.'
        )
        return
      }
      // Job MP inscrit tout de suite (statut provisoire) : le poll se réveille
      // et le remplacera par l'état réel au prochain tick.
      setBatchJobs((cur) => [
        ...cur,
        {
          id: d.jobIds[0],
          type: 'marketplace',
          status: 'queued',
          payload: { rootJobId: cibleJobId },
          result: null,
          error: null,
        },
      ])
    } catch {
      setNotice('Impossible de contacter le serveur.')
    } finally {
      setMpBusy(false)
    }
  }

  /** RETOUR par prompt sur la version regardée : enqueue un « mes-fix » dans le
   *  même lot (route du studio MES, compatible decor-autour depuis le 05/08). */
  async function envoyerRetour(it: Item, cibleJobId: number) {
    const instr = instruction.trim()
    if (!instr || retourBusy) return
    setRetourBusy(true)
    try {
      const res = await fetch('/api/generation/mes-correct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: cibleJobId, instruction: instr }),
      })
      const d = await res.json().catch(() => null)
      if (!res.ok) {
        setNotice(d?.error ?? 'Retour impossible.')
        return
      }
      setInstruction('')
      // On suivra la nouvelle version dès qu'elle tombe : dépingle + relance le poll.
      setVerJobId(null)
      if (it.chosenJobId) void epinglerVersion(it, null)
      setItems((cur) =>
        cur.map((x) =>
          x.key === it.key
            ? { ...x, status: 'queued' as Status, chosenJobId: undefined, error: undefined }
            : x
        )
      )
    } catch {
      setNotice('Impossible de contacter le serveur.')
    } finally {
      setRetourBusy(false)
    }
  }

  // — vue en grand : FORCER un nouvel appel vision (ignore la bibliothèque,
  //   écrase l'entrée) — la nouvelle description se propage aux cases jumelles.
  const [visionBusy, setVisionBusy] = useState(false)
  async function forcerVision(it: Item) {
    if (!it.productPath || !lotId || visionBusy) return
    setVisionBusy(true)
    try {
      const res = await fetch('/api/banc-generation/description', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lot: lotId,
          moteur: typo,
          productPath: it.productPath,
          name: it.name,
          coloris: it.coloris,
          force: true,
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || typeof data?.description !== 'string') {
        setNotice(data?.error ?? 'Appel vision impossible.')
        return
      }
      const cle = `${parseProduitFromFileName(it.name) || it.name}|${it.coloris}`
      setItems((cur) =>
        cur.map((x) =>
          `${parseProduitFromFileName(x.name) || x.name}|${x.coloris}` === cle
            ? { ...x, description: data.description, descriptionSource: 'vision' as const }
            : x
        )
      )
    } catch {
      setNotice('Impossible de contacter le serveur.')
    } finally {
      setVisionBusy(false)
    }
  }

  // — poll du lot tant que des jobs tournent (générations, retours… et les
  //   déclinaisons Marketplace, qui ne passent pas par le statut des cases) —
  const active =
    items.some((i) => i.status === 'queued' || i.status === 'running') ||
    batchJobs.some(
      (j) => j.type === 'marketplace' && (j.status === 'queued' || j.status === 'running')
    )
  useEffect(() => {
    if (!batchId || !active) return
    let alive = true
    const tick = async () => {
      try {
        const r = await fetch(`/api/gamme/${batchId}`)
        if (!alive || !r.ok) return
        const d = await r.json()
        if (!alive || !Array.isArray(d.jobs)) return
        const jobs = (d.jobs as JobRow[]).filter(
          (j) => j.type === 'decor-autour' || j.type === 'mes-fix' || j.type === 'marketplace'
        )
        setBatchJobs(jobs)
        setItems((cur) => cur.map((i) => appliquerVersions(i, jobs)))
      } catch {
        // réseau : on réessaie au prochain tick
      }
    }
    tick()
    const t = setInterval(tick, 1500)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [batchId, active])

  // Changement de case (ou fermeture) : on repart sur la version suivie et une
  // consigne vierge — le retour tapé pour une image ne fuit pas sur une autre.
  useEffect(() => {
    setVerJobId(null)
    setInstruction('')
  }, [lightbox])

  // Vue en grand ouverte = la page derrière ne défile plus (08/08, demande
  // Mathias — même règle que le studio MES).
  useEffect(() => {
    if (!lightbox) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [lightbox])

  /** Message FUGACE au centre de l'image (bout de liste, 08/08) — la clé n
   *  force le rejeu de l'anim à chaque appui. */
  const [fugace, setFugace] = useState<{ msg: string; n: number } | null>(null)
  useEffect(() => {
    if (!fugace) return
    const t = setTimeout(() => setFugace(null), 1100)
    return () => clearTimeout(t)
  }, [fugace])

  // NAVIGATION FLÈCHES dans la vue en grand (08/08, demande Mathias) : ← / →
  // passent à la MES précédente/suivante dans l'ORDRE VISUEL de la grille ;
  // en bout de liste, message fugace au centre de l'image.
  useEffect(() => {
    if (!lightbox) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      // Jamais pendant la frappe (retour par prompt, renommage…).
      const cible = e.target as HTMLElement | null
      if (cible && (cible.tagName === 'INPUT' || cible.tagName === 'TEXTAREA')) return
      e.preventDefault()
      // Ordre visuel : groupes du plus récent au plus ancien, puis largeurs et
      // hauteurs croissantes — le miroir exact du rendu de la grille.
      const ordre: string[] = []
      const gs = Array.from(new Set(items.map((i) => i.groupe))).sort((a, b) => b - a)
      for (const g of gs) {
        const gItems = items.filter((i) => i.groupe === g)
        const ws = Array.from(new Set(gItems.map((i) => i.w))).sort((a, b) => a - b)
        const hs = Array.from(new Set(gItems.map((i) => i.h))).sort((a, b) => a - b)
        for (const w of ws)
          for (const h of hs)
            for (const it of gItems.filter((i) => i.w === w && i.h === h)) ordre.push(it.key)
      }
      const idx = ordre.indexOf(lightbox)
      if (idx === -1) return
      const suivant = e.key === 'ArrowRight' ? idx + 1 : idx - 1
      if (suivant < 0) {
        setFugace((f) => ({ msg: 'Première MES', n: (f?.n ?? 0) + 1 }))
      } else if (suivant >= ordre.length) {
        setFugace((f) => ({ msg: 'Dernière MES', n: (f?.n ?? 0) + 1 }))
      } else {
        setLightbox(ordre[suivant])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightbox, items])

  // Aperçu en grand du PNG produit d'origine (vignette bas de colonne, comme
  // le studio MES) — par-dessus la vue en grand, fond clair (PNG détouré).
  const [pngZoom, setPngZoom] = useState(false)

  // Échap : ferme l'aperçu PNG s'il est ouvert, sinon la vue en grand
  useEffect(() => {
    if (!lightbox) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (pngZoom) setPngZoom(false)
      else setLightbox(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightbox, pngZoom])

  // — LOUPE au survol (copiée du studio MES, demande Mathias 07/08) : position
  //   souris 0..1 + ratio de l'image ; fenêtre zoomée qui suit le curseur,
  //   molette = puissance. null = souris hors de l'image.
  const [loupe, setLoupe] = useState<{ x: number; y: number; ar: number } | null>(null)
  const [loupeZoom, setLoupeZoom] = useState(4)
  const [lensBox, setLensBox] = useState<{ w: number; h: number } | null>(null)
  const lensRef = useCallback((el: HTMLDivElement | null) => {
    if (el) setLensBox({ w: el.offsetWidth, h: el.offsetHeight })
  }, [])
  const stageRef = useRef<HTMLDivElement | null>(null)
  // Molette = puissance de la loupe. Listener natif non-passif (comme au studio
  // MES : l'onWheel React ne peut pas bloquer le défilement du navigateur).
  useEffect(() => {
    if (!lightbox) return
    const zone = stageRef.current
    if (!zone) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      setLoupeZoom((z) => Math.min(12, Math.max(2, e.deltaY < 0 ? z + 1 : z - 1)))
    }
    zone.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      zone.removeEventListener('wheel', onWheel)
      setLoupe(null)
      setPngZoom(false)
    }
  }, [lightbox])

  const lettre = TYPO_INFO[typo].lettre
  const doneCount = items.filter((i) => i.status === 'done').length
  // Un dépôt = un groupe affiché À PART, du plus récent au plus ancien (suivi
  // du rodage — demande Mathias 07/08 : les essais ne se mélangent pas).
  const groupes = Array.from(new Set(items.map((i) => i.groupe))).sort((a, b) => b - a)

  const chipOf = (i: Item) => `${i.w}${lettre}${i.h}`
  /** Nom du produit DE CETTE IMAGE, lu dans son nom de fichier (tout ce qui
   *  précède la taille) — un dépôt peut mélanger plusieurs produits.
   *  Secours : le champ Produit de la barre, sinon rien. */
  const produitDe = (i: Item) => {
    const m = i.name.match(/^(.*?)\s*\d{2,3}[BCP]\d{2,3}/i)
    const p = m?.[1]?.replace(/[_-]+/g, ' ').trim()
    return p ? p.toUpperCase() : produit
  }
  /** Format 07/08 : « ATHOS 350C160 - Teck » (produit + taille + coloris). */
  const labelOf = (i: Item) => {
    const p = produitDe(i)
    return `${p ? `${p} ` : ''}${chipOf(i)} - ${i.coloris}`
  }
  /** Nom du livrable téléchargé (format Mathias 08/08) :
   *  « ATHOS_300B140_Gris_WEB.jpg » / « …_MP.jpg ». */
  const nomLivrable = (i: Item, suffixe: 'WEB' | 'MP') =>
    `${(produitDe(i) || 'PRODUIT').toUpperCase().replace(/\s+/g, '-')}_${chipOf(i)}_${i.coloris}_${suffixe}.jpg`

  // —————————————————————————————————————————————— rendu
  return (
    <div className="min-h-screen bg-surface">
      <div className="max-w-6xl mx-auto px-6 py-5">
        {/* Ouverture d'une session : l'écran n'affiche QUE l'anim (08/08,
            demande Mathias) — tout le reste attend que le lot soit chargé. */}
        {ouvertureLot && items.length === 0 ? (
          <div className="py-28 text-center">
            <span className="inline-flex items-center gap-4 text-xl font-bold text-text-secondary">
              <span className="inline-block w-9 h-9 rounded-full border-[3px] border-border border-t-brand-green animate-spin" />
              Ouverture de la session
              <Dots />
            </span>
          </div>
        ) : (
          <>
        {/* en-tête de page (in-app depuis le 07/08 : plus de barre standalone,
            le menu de PortaGEN est au-dessus) */}
        {/* Titre seul sur sa ligne, catégorie/produit/compteur en SOUS-TITRE
            dessous (08/08, demande Mathias — l'alignement en ligne était moche). */}
        <div className="flex items-center gap-2.5 flex-wrap mb-1">
          <h1 className="text-xl font-bold tracking-tight">MES Contrainte</h1>
          <div className="flex-1" />
          <div className="inline-flex border border-border rounded-[8px] overflow-hidden bg-white">
            {(['2K', '4K'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setImageSize(s)}
                className={`px-3.5 py-1.5 text-[12.5px] font-bold ${
                  imageSize === s ? 'bg-brand-green text-white' : 'bg-white text-text-secondary'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
          {/* Esprit session (07/08) : quitter le lot courant pour en démarrer
              un neuf — l'actuel reste retrouvable par sa carte sur l'Accueil. */}
          {lotId && (
            <button
              onClick={() => window.location.assign('/generation/decor-autour')}
              title="Repartir sur une session vierge — celle-ci reste sur l'Accueil"
              className="bg-white border border-border text-text-secondary hover:text-brand-green hover:border-brand-green font-bold text-[13px] rounded-[10px] px-3.5 py-2"
            >
              Nouvelle session
            </button>
          )}
          {/* Une session = UN groupe d'images (acté 07/08) : l'ajout après coup
              reste possible mais DÉCOURAGÉ — bouton discret, sans relief. */}
          {items.length === 0 ? (
            <button
              onClick={() => fileInput.current?.click()}
              className="bg-white border border-border text-text-secondary hover:text-brand-green hover:border-brand-green font-bold text-[13px] rounded-[10px] px-3.5 py-2"
            >
              + Ajouter des images
            </button>
          ) : (
            <button
              onClick={() => fileInput.current?.click()}
              title="Une session = un groupe d'images d'une catégorie — pour un autre essai, préfère Nouvelle session"
              className="text-[12px] font-semibold text-text-disabled hover:text-text-secondary px-1"
            >
              + compléter la session
            </button>
          )}
          <button
            onClick={generate}
            disabled={aLancer.length === 0 || launching}
            className="bg-brand-green hover:bg-brand-green-hover text-white font-bold text-[13px] rounded-[10px] px-3.5 py-2 disabled:opacity-50"
          >
            <PictoIllu name="generer" size={15} className="mr-1.5" />
            Générer ({aLancer.length} image{aLancer.length > 1 ? 's' : ''})
          </button>
        </div>
        {/* SOUS-TITRE : nom de session (renommable au ✎) — catégorie · produit ·
            compteur, à la ligne sous le titre (08/08). */}
        <div className="flex items-center gap-2.5 flex-wrap mb-3">
          {lotId &&
            (renommage !== null ? (
              <input
                type="text"
                autoFocus
                maxLength={60}
                value={renommage}
                onChange={(e) => setRenommage(e.target.value)}
                onBlur={() => void renommerSession(renommage)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void renommerSession(renommage)
                  }
                  if (e.key === 'Escape') setRenommage(null)
                }}
                className="text-[13px] font-bold border border-brand-green rounded-[6px] px-1.5 py-0.5 focus:outline-none"
              />
            ) : (
              <span className="inline-flex items-center gap-1.5 text-[13px] font-bold text-text-primary">
                {nomSession || 'Session'}
                <button
                  onClick={() => setRenommage(nomSession)}
                  title="Renommer la session (aussi sur sa carte de l'Accueil)"
                  className="text-text-disabled hover:text-brand-green"
                >
                  ✎
                </button>
                <span className="text-text-disabled font-normal">—</span>
              </span>
            ))}
          {items.length === 0 ? (
            // Lot vide : la catégorie n'est PAS un fait, c'est un choix — un
            // sélecteur corrigeable (la lettre B/C/P du 1ᵉʳ dépôt fait foi si
            // on n'y touche pas).
            <select
              value={typoDetected ? typo : ''}
              onChange={(e) => {
                if (!e.target.value) return
                setTypo(e.target.value as Typo)
                setTypoDetected(true)
              }}
              title="Catégorie de la session — détectée au 1ᵉʳ ajout (lettre B/C/P), corrigeable ici"
              className="text-[12px] font-semibold text-text-secondary border border-border rounded-full px-2.5 py-0.5 bg-white"
            >
              <option value="">catégorie auto (selon les images)</option>
              {(Object.keys(TYPO_INFO) as Typo[]).map((t) => (
                <option key={t} value={t}>
                  {TYPO_INFO[t].titre}
                </option>
              ))}
            </select>
          ) : (
            // TOUS les produits de la session avec leur COLORIS (08/08) :
            // « Portillon · VELETA Gris, VELETA Noir ».
            <span className="text-[13px] text-text-secondary">
              {TYPO_INFO[typo].titre}
              {(() => {
                const noms = Array.from(
                  new Set(
                    items
                      .map((i) => [produitDe(i), i.coloris].filter(Boolean).join(' '))
                      .filter(Boolean)
                  )
                )
                return noms.length > 0 ? ` · ${noms.join(', ')}` : ''
              })()}
            </span>
          )}
          {items.length > 0 && (
            <span className="text-[13px] text-text-disabled font-semibold tabular-nums">
              {doneCount}/{items.length} généré{doneCount > 1 ? 's' : ''}
            </span>
          )}
        </div>
        {/* Phrase d'aide supprimée (08/08, demande Mathias). */}

        {notice && (
          <div className="bg-brand-red-light text-brand-red text-sm rounded-[8px] px-4 py-3 mb-4 flex justify-between gap-4">
            <span>{notice}</span>
            <button onClick={() => setNotice(null)} className="text-brand-red/60 hover:text-brand-red">
              ✕
            </button>
          </div>
        )}

        {/* Zone d'ajout : réservée à la session VIERGE (une session = un groupe
            d'images, acté 07/08) — une fois lancée, seul le bouton discret
            « compléter » reste. */}
        {items.length === 0 && (
          <div
            onClick={() => fileInput.current?.click()}
            onDragOver={(e) => {
              e.preventDefault()
              setHot(true)
            }}
            onDragLeave={() => setHot(false)}
            onDrop={(e) => {
              e.preventDefault()
              setHot(false)
              // Dossiers acceptés au drop (parcourus récursivement) — 08/08.
              void fichiersDepuisDrop(e.dataTransfer).then((fs) => addFiles(fs))
            }}
            className={`rounded-[12px] border-2 border-dashed text-center cursor-pointer transition-colors mb-5 py-14 ${
              hot
                ? 'border-brand-green bg-brand-green-light'
                : 'border-[#c8d3bb] bg-white hover:border-brand-green hover:bg-[#fbfdf8]'
            }`}
          >
            {/* UNE seule entrée (08/08, colère justifiée de Mathias sur la boîte
                « dossier » qui grisait les images — limite système : aucune
                boîte de dialogue ne sait mélanger dossier ET fichiers) : le clic
                ouvre l'explorateur d'images classique (dossiers navigables,
                Ctrl+A pour tout un dossier) ; le glisser accepte images ET
                dossiers entiers. */}
            <div className="text-[14px] font-bold">
              Glisse tes images ou un dossier entier ici
            </div>
            <div className="text-xs text-text-disabled mt-0.5">— ou clique pour parcourir —</div>
          </div>
        )}
        <input
          ref={fileInput}
          type="file"
          multiple
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => {
            void addFiles(e.target.files)
            e.target.value = ''
          }}
        />
        {/* La boîte « dossier » (webkitdirectory) a été RETIRÉE (08/08) : elle
            grisait les images et rendait fou — le dossier entier passe par le
            glisser-déposer ou Ctrl+A dans l'explorateur d'images. */}

        {/* un DÉPÔT = un bloc, du plus récent au plus ancien ; dedans, la
            grille habituelle : une largeur = UNE ligne, colonnes = hauteurs */}
        {groupes.map((g) => {
          const gItems = items.filter((i) => i.groupe === g)
          const gDone = gItems.filter((i) => i.status === 'done').length
          const widths = Array.from(new Set(gItems.map((i) => i.w))).sort((a, b) => a - b)
          const heights = Array.from(new Set(gItems.map((i) => i.h))).sort((a, b) => a - b)
          return (
            <section key={g} className="mb-7 pt-4 border-t border-border first-of-type:border-t-0 first-of-type:pt-0">
              {/* En-tête de groupe = le NOM DU PRODUIT (08/08, demande Mathias
                  — fini « Dépôt n ») ; masqué quand il n'y a qu'un seul groupe
                  (le sous-titre de la page dit déjà tout). */}
              {groupes.length > 1 && (
                <h3 className="text-[13px] font-bold mb-2.5">
                  {/* Catégorie rappelée DEVANT le produit (08/08) :
                      « Portillon · VELETA ». */}
                  <span className="text-text-secondary font-semibold">
                    {TYPO_INFO[typo].titre} ·{' '}
                  </span>
                  {/* Produit + COLORIS (08/08) : « VELETA Gris, VELETA Noir ». */}
                  {Array.from(
                    new Set(
                      gItems
                        .map((i) => [produitDe(i), i.coloris].filter(Boolean).join(' '))
                        .filter(Boolean)
                    )
                  ).join(', ') || `Dépôt ${g === 0 ? '—' : g}`}
                  <span className="text-text-disabled font-semibold ml-2 tabular-nums">
                    {gDone}/{gItems.length} généré{gDone > 1 ? 's' : ''}
                  </span>
                </h3>
              )}
              {widths.map((w) => (
          <div key={w} className="mb-5">
            <h4 className="text-xs font-bold text-text-secondary mb-1.5">Largeur {w} cm</h4>
            <div
              className="stagger grid gap-4"
              style={{ gridTemplateColumns: `repeat(${heights.length}, minmax(0, 420px))` }}
            >
              {heights.map((h) => {
                const cell = gItems.filter((i) => i.w === w && i.h === h)
                if (cell.length === 0) return <div key={h} title={`${w}×${h} absent de la session`} />
                return (
                  <div key={h} className="grid gap-4 content-start">
                    {cell.map((it) => {
                      const running = it.status === 'queued' || it.status === 'running'
                      // « Occupée » = traitement LOCAL (détourage/RALify/pose) OU
                      // Nano : dans les deux cas la case respire, roue par-dessus.
                      const busy = running || enPrepa(it.status)
                      const img =
                        it.status === 'done' && it.deliveryPath ? it.deliveryPath : it.planPath
                      return (
                        // C'est la CASE ENTIÈRE qui respire pendant un traitement
                        // (local ou Nano), pas l'image (précision Mathias 07/08).
                        <div
                          key={it.key}
                          className={`bg-white border border-border rounded-[12px] shadow-sm overflow-hidden ${
                            busy ? 'anim-respire-scale' : ''
                          }`}
                        >
                          <div className="relative aspect-[3/2] bg-[#c9c9c9]">
                            {img ? (
                              <button
                                onClick={(e) => {
                                  // Maj+clic : rejoue le dévoilement en local,
                                  // sans aucun appel (contrôle de l'effet).
                                  if (e.shiftKey && it.status === 'done' && it.deliveryPath) {
                                    setItems((cur) =>
                                      cur.map((x) =>
                                        x.key === it.key
                                          ? { ...x, fraiche: true, rejeu: (x.rejeu ?? 0) + 1 }
                                          : x
                                      )
                                    )
                                    return
                                  }
                                  setLightbox(it.key)
                                }}
                                className="absolute inset-0"
                              >
                                {it.status === 'done' && it.deliveryPath && it.fraiche ? (
                                  // Rendu tombé en direct : il se dessine zone
                                  // par zone au-dessus du plan gris (~2 s).
                                  <>
                                    {it.planPath && (
                                      // eslint-disable-next-line @next/next/no-img-element
                                      <img
                                        src={imgUrl(it.planPath, 560)}
                                        alt=""
                                        className="absolute inset-0 w-full h-full object-cover"
                                      />
                                    )}
                                    <RenduDevoile
                                      key={`${it.deliveryPath}#${it.rejeu ?? 0}`}
                                      src={imgUrl(it.deliveryPath, 560)}
                                    />
                                  </>
                                ) : (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    src={imgUrl(img, 560)}
                                    alt=""
                                    className="absolute inset-0 w-full h-full object-cover"
                                  />
                                )}
                              </button>
                            ) : enPrepa(it.status) && it.localUrl ? (
                              // Préparation locale : le PNG déposé en attendant
                              // son plan gris (aperçu navigateur).
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={it.localUrl}
                                alt=""
                                className="absolute inset-0 w-full h-full object-contain p-4"
                              />
                            ) : it.status === 'error' ? (
                              <div className="absolute inset-0 grid place-items-center px-4 text-center text-brand-red text-[12.5px] font-bold">
                                ⚠ {it.error}
                              </div>
                            ) : (
                              <div className="absolute inset-0 grid place-items-center text-text-secondary text-[12.5px]">
                                <span className="inline-flex items-center gap-2">
                                  <span className="inline-block w-4 h-4 rounded-full border-2 border-white/70 border-t-brand-green animate-spin" />
                                  {PREP_LABEL[it.status] ?? 'Préparation'}
                                  <Dots />
                                </span>
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-2 px-3 py-2.5">
                            <b className="text-[13px] truncate">{labelOf(it)}</b>
                            {it.description && (
                              <span
                                title={
                                  it.descriptionSource === 'bibliotheque'
                                    ? 'Description réutilisée de la bibliothèque (aucun appel vision)'
                                    : 'Description fraîchement établie par vision (enregistrée en bibliothèque)'
                                }
                                className="shrink-0 cursor-help text-brand-green inline-flex items-center"
                              >
                                <PictoIllu
                                  name={it.descriptionSource === 'bibliotheque' ? 'biblio' : 'vision'}
                                  size={14}
                                  className="!align-baseline"
                                />
                              </span>
                            )}
                            <div className="flex-1" />
                            {/* Vrais petits boutons bordés (demande Mathias 07/08 :
                                on doit COMPRENDRE que ce sont des boutons). */}
                            {it.status === 'done' && it.deliveryPath && (
                              <a
                                href={imgUrl(it.deliveryPath)}
                                download={nomLivrable(it, 'WEB')}
                                title="Télécharger le rendu"
                                className="shrink-0 w-[30px] h-[30px] rounded-[8px] border border-border bg-white text-text-secondary grid place-items-center hover:text-brand-green hover:border-brand-green hover:bg-brand-green-light"
                              >
                                <PictoIllu name="telecharger" size={15} className="!align-middle" />
                              </a>
                            )}
                            {it.jobId && !running && (
                              <button
                                onClick={() => regen(it)}
                                title="Regénérer (mêmes réglages, nouvelle image)"
                                className="shrink-0 w-[30px] h-[30px] rounded-[8px] border border-border bg-white text-text-secondary grid place-items-center hover:text-brand-green hover:border-brand-green hover:bg-brand-green-light"
                              >
                                <PictoIllu name="relancer" size={15} className="!align-middle" />
                              </button>
                            )}
                            {!it.jobId && !enPrepa(it.status) && (
                              <button
                                onClick={() => void removeItem(it.key)}
                                title="Retirer"
                                className="text-text-disabled hover:text-brand-red text-[14px]"
                              >
                                ✕
                              </button>
                            )}
                            {/* ANNULER pendant le traitement (08/08) : visible
                                seulement en préparation ou en file — un appel
                                Nano déjà parti ne peut pas être interrompu. */}
                            {(enPrepa(it.status) || it.status === 'queued') && (
                              <button
                                onClick={() =>
                                  enPrepa(it.status) ? annulerPrepa(it) : void annulerJob(it)
                                }
                                title={
                                  enPrepa(it.status)
                                    ? 'Annuler cette image (la préparation s’arrête)'
                                    : 'Annuler la génération en file (le plan gris reste)'
                                }
                                className="text-text-disabled hover:text-brand-red text-[14px]"
                              >
                                ✕
                              </button>
                            )}
                            <span
                              className={`text-[10.5px] font-bold rounded-full px-2 py-0.5 ${
                                it.status === 'done'
                                  ? 'bg-brand-green-light text-brand-green'
                                  : running
                                    ? 'bg-[#fef3c7] text-[#b45309]'
                                    : it.status === 'error'
                                      ? 'bg-brand-red-light text-brand-red'
                                      : 'bg-surface text-text-secondary'
                              }`}
                            >
                              {it.status === 'done' ? (
                                '✓ Généré'
                              ) : it.status === 'running' ? (
                                <>
                                  Génération
                                  <Dots />
                                </>
                              ) : it.status === 'queued' ? (
                                'En attente'
                              ) : it.status === 'error' ? (
                                '⚠ Échec'
                              ) : enPrepa(it.status) ? (
                                <>
                                  {PREP_LABEL[it.status]}
                                  <Dots />
                                </>
                              ) : (
                                'Prêt'
                              )}
                            </span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          </div>
              ))}
            </section>
          )
        })}

        {/* fichiers sans taille lisible — non générables */}
        {rejets.length > 0 && (
          <div className="mt-2">
            <h4 className="text-xs font-bold text-text-secondary mb-1.5">
              Taille non reconnue — non générable
            </h4>
            <div className="flex flex-col gap-1.5">
              {rejets.map((n, idx) => (
                <div
                  key={`${n}-${idx}`}
                  className="flex items-center gap-3 bg-white border border-border rounded-[10px] px-3 py-2 text-[13px]"
                >
                  <span className="truncate">{n}</span>
                  <span className="text-[10.5px] font-bold rounded-full px-2 py-0.5 bg-brand-red-light text-brand-red">
                    taille ?
                  </span>
                  <div className="flex-1" />
                  <button
                    onClick={() => setRejets((cur) => cur.filter((_, k) => k !== idx))}
                    title="Retirer"
                    className="text-text-disabled hover:text-brand-red"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
          </>
        )}
      </div>

      {/* vue en grand — identique à MES Écrin : poignée à gauche, liens, Échap */}
      {lightbox &&
        (() => {
          const it = items.find((x) => x.key === lightbox)
          if (!it) return null
          const avant = it.planPath ? imgUrl(it.planPath) : null
          // VERSIONS (retour arrière, 07/08) : générations + retours mes-fix.
          const versions = versionsPour(it, batchJobs)
          const pretes = versions.filter((j) => j.status === 'done' && j.result?.deliveryPath)
          const caseJob =
            (it.chosenJobId && pretes.find((j) => j.id === it.chosenJobId)) ||
            (pretes.length ? pretes[pretes.length - 1] : null)
          /** Version REGARDÉE : celle cliquée dans la galerie, sinon celle de la case. */
          const regardee = (verJobId != null && pretes.find((j) => j.id === verJobId)) || caseJob
          const renduPath = regardee?.result?.deliveryPath
          const apres = renduPath ? imgUrl(renduPath) : null
          const working = it.status === 'queued' || it.status === 'running'
          // Déclinaison MP de la version regardée (rebranchée 07/08 soir).
          const mpJob = regardee
            ? batchJobs.find(
                (j) => j.type === 'marketplace' && j.payload?.rootJobId === regardee.id
              )
            : undefined
          const mpEnCours = mpJob?.status === 'queued' || mpJob?.status === 'running'
          const mpPath = mpJob?.status === 'done' ? mpJob.result?.deliveryPath : undefined
          // Avant/après RALify (07/08) : tant que la case n'est pas générée, la
          // poignée compare le plan SANS RALify au plan envoyé (avec RALify).
          const brut = it.planBrutPath ? imgUrl(it.planBrutPath) : null
          // Description + prompt : COLONNE LATÉRALE scrollable (07/08 — empilés
          // sous l'image ils sortaient de l'écran, illisibles).
          const infos = Boolean(it.description || it.promptFinal)
          return (
            <div
              className="fixed inset-0 z-[80] bg-[#0f1216]/85 flex items-center justify-center p-6"
              // Fermeture (08/08, v2) : tout appui HORS du contenu ferme —
              // testé par inclusion DOM (le test target===backdrop ratait des
              // zones selon la structure, galerie comprise).
              onMouseDown={(e) => {
                const contenu = (e.currentTarget as HTMLElement).firstElementChild
                if (contenu && !contenu.contains(e.target as Node)) setLightbox(null)
              }}
            >
              {/* pointer-events-none sur les conteneurs invisibles (08/08) :
                  les clics dans le « vide » (à côté de la galerie…) traversent
                  jusqu'au fond et FERMENT ; les blocs visibles réactivent. */}
              <div className="flex items-start gap-3 max-w-[96vw] pointer-events-none">
              <div className="flex flex-col gap-2.5 min-w-0">
                <div className="flex items-center gap-3 text-white pointer-events-auto">
                  <b className="text-[15px]">{labelOf(it)}</b>
                  <div className="flex-1" />
                  {/* Chaque état du pipeline inspectable, dans l'ordre (07/08) :
                      originel → détouré → RALify → plans → rendu. */}
                  {(
                    [
                      ['originel', it.originalPath],
                      ['détouré', it.productPath],
                      ['RALify', it.ralifyPath],
                      ['plan sans RALify', it.planBrutPath],
                      ['plan gris', it.planPath],
                      ['rendu', renduPath],
                    ] as const
                  ).map(
                    ([label, p]) =>
                      p && (
                        <a
                          key={label}
                          href={imgUrl(p)}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[#cfe0ec] text-[12.5px] font-bold hover:underline whitespace-nowrap"
                        >
                          {label} ↗
                        </a>
                      )
                  )}
                  <button
                    onClick={() => setLightbox(null)}
                    title="Fermer (Échap)"
                    className="bg-white/15 hover:bg-white/25 text-white w-[30px] h-[30px] rounded-[8px] text-[15px]"
                  >
                    ✕
                  </button>
                </div>
                <div
                  ref={stageRef}
                  onMouseMove={(e) => {
                    const r = e.currentTarget.getBoundingClientRect()
                    setLoupe({
                      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
                      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
                      ar: r.height / r.width,
                    })
                  }}
                  onMouseLeave={() => setLoupe(null)}
                  className={`relative aspect-[3/2] rounded-[10px] shadow-2xl bg-[#181d23] cursor-crosshair pointer-events-auto ${
                    infos
                      ? pretes.length > 1
                        ? 'w-[min(63vw,calc(70vh*1.5))]'
                        : 'w-[min(63vw,calc(80vh*1.5))]'
                      : pretes.length > 1
                        ? 'w-[min(94vw,calc(76vh*1.5))]'
                        : 'w-[min(94vw,calc(86vh*1.5))]'
                  }`}
                >
                  {avant && apres ? (
                    <Comparateur avant={avant} apres={apres} />
                  ) : avant && brut ? (
                    // Pas encore générée + RALify actif : la poignée compare le
                    // plan brut au plan RALify (même pose, seule la teinte bouge).
                    <Comparateur
                      avant={brut}
                      apres={avant}
                      labelAvant="sans RALify"
                      labelApres="RALify"
                    />
                  ) : avant ? (
                    // Pas encore générée : le plan gris seul, en grand (contrôle du resizing).
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={avant}
                      alt=""
                      className="absolute inset-0 w-full h-full object-cover rounded-[10px]"
                    />
                  ) : (
                    <div className="absolute inset-0 grid place-items-center text-white/80 text-sm">
                      {it.status === 'error' ? (
                        <span className="text-brand-red font-bold px-6 text-center">⚠ {it.error}</span>
                      ) : (
                        <span className="inline-flex items-center gap-2.5">
                          <span className="inline-block w-5 h-5 rounded-full border-2 border-white/25 border-t-white animate-spin" />
                          <span>
                            {PREP_LABEL[it.status] ?? 'Préparation'}
                            <Dots />
                          </span>
                        </span>
                      )}
                    </div>
                  )}
                  {/* Regénération/retour EN COURS (08/08, gros oubli signalé par
                      Mathias : rien ne bougeait à l'écran) : voile + roue par-
                      dessus l'ancien rendu, qui reste visible dessous. */}
                  {working && (avant || apres) && (
                    <div className="absolute inset-0 z-10 grid place-items-center pointer-events-none bg-black/25 rounded-[10px]">
                      <span className="inline-flex items-center gap-2.5 bg-black/70 text-white text-sm font-bold rounded-full px-4 py-2">
                        <span className="inline-block w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                        {it.status === 'queued' ? 'En attente de génération' : 'Génération en cours'}
                        <Dots />
                      </span>
                    </div>
                  )}
                  {/* Message fugace (bout de liste ← →, 08/08) : centré sur
                      l'image, apparaît puis s'efface tout seul. */}
                  {fugace && (
                    <div
                      key={fugace.n}
                      className="absolute inset-0 z-20 grid place-items-center pointer-events-none"
                    >
                      <span className="bg-black/70 text-white text-sm font-bold rounded-full px-4 py-2 anim-toast-fugace">
                        {fugace.msg}
                      </span>
                    </div>
                  )}
                </div>

                {/* GALERIE DE VERSIONS SOUS L'IMAGE (08/08, demande Mathias —
                    plus dans la colonne de droite) : clic = regarder,
                    « Choisir » = la case l'affiche (persisté au manifeste). */}
                {pretes.length > 1 && (
                  // Centrée quand elle tient, défilante sans rien couper quand
                  // elle déborde (w-max + mx-auto, pas justify-center).
                  <div className="overflow-x-auto pb-1">
                  <div className="flex items-center gap-2 w-max mx-auto">
                    {pretes.map((j) => {
                      const n = versions.findIndex((v) => v.id === j.id) + 1
                      const active = regardee?.id === j.id
                      const retenue = it.chosenJobId === j.id
                      return (
                        <button
                          key={j.id}
                          onClick={() => setVerJobId(j.id)}
                          title={
                            j.payload?.instruction ??
                            j.result?.instruction ??
                            (j.type === 'decor-autour' ? 'Génération' : 'Retour')
                          }
                          className={`shrink-0 w-[110px] rounded-[8px] overflow-hidden border-2 bg-white text-left relative pointer-events-auto ${
                            active ? 'border-brand-green' : 'border-transparent hover:border-white/50'
                          }`}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={imgUrl(j.result!.deliveryPath!, 240)}
                            alt=""
                            loading="lazy"
                            className="w-full aspect-[3/2] object-cover"
                          />
                          <span className="absolute bottom-1 left-1 text-[10px] font-bold text-white bg-black/50 rounded-full px-1.5">
                            V{n}
                          </span>
                          {/* Version choisie = COCHE verte (08/08, à la place du texte). */}
                          {retenue && (
                            <span
                              title="Version choisie — c'est elle que la case affiche"
                              className="absolute top-1 right-1 w-5 h-5 rounded-full bg-brand-green text-white grid place-items-center text-[11px] font-bold"
                            >
                              ✓
                            </span>
                          )}
                          {/* « Choisir » SUR la vignette sélectionnée (08/08,
                              demande Mathias — plus de bouton à part). */}
                          {active && caseJob?.id !== j.id && (
                            <span
                              onClick={(e) => {
                                e.stopPropagation()
                                void epinglerVersion(it, j.id)
                              }}
                              title="La case affichera cette version"
                              className="absolute top-1 right-1 bg-brand-green text-white text-[10px] font-bold rounded-full px-2 py-0.5 cursor-pointer hover:bg-brand-green-hover"
                            >
                              Choisir
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                  </div>
                )}
              </div>

              {/* colonne latérale : description + prompt, pleine hauteur, scrollable */}
              {(infos || it.productPath) && (
                <aside className="w-[380px] shrink-0 self-stretch relative pointer-events-auto">
                <div
                  className={`h-full max-h-[86vh] overflow-y-auto flex flex-col gap-2 transition-opacity ${
                    loupe ? 'opacity-30 grayscale pointer-events-none select-none' : ''
                  }`}
                >
                  {/* RETOUR par prompt (07/08, mécanique du studio MES) : une
                      consigne → Nano retouche la version regardée → nouvelle
                      version dans la galerie. */}
                  {regardee && (
                    <div className="bg-white/10 rounded-[8px] px-3 py-2.5">
                      <p className="font-bold text-white text-[12.5px] mb-1.5">
                        Retour sur ce rendu
                      </p>
                      <textarea
                        value={instruction}
                        onChange={(e) => setInstruction(e.target.value)}
                        rows={1}
                        placeholder="Ex. : éloigne la maison…"
                        className="w-full rounded-[8px] bg-white text-text-primary text-[12.5px] p-2 resize-y min-h-[34px]"
                      />
                      <button
                        onClick={() => void envoyerRetour(it, regardee.id)}
                        disabled={retourBusy || working || !instruction.trim()}
                        className="mt-2 w-full bg-brand-green text-white rounded-[10px] py-2 text-sm font-bold hover:bg-brand-green-hover transition-colors disabled:opacity-50"
                      >
                        {working ? 'Version en cours…' : retourBusy ? 'Envoi…' : 'Générer la version'}
                      </button>
                    </div>
                  )}

                  {/* ACTIONS (comme la modale du studio MES : les options de la
                      vue en grand, pas seulement sur la case) — 07/08. */}
                  <div className="pt-1 flex flex-col gap-2">
                    {/* Style « fantôme » du reste de la colonne sombre (comme
                        Forcer la vision) — le vert plein reste réservé à
                        l'action principale « Générer la version ». */}
                    {it.jobId && !working && (
                      <button
                        onClick={() => regen(it)}
                        title="Regénérer depuis le plan gris (mêmes réglages, nouvelle image)"
                        className="w-full bg-white/15 hover:bg-white/25 text-white rounded-[10px] py-2 text-sm font-bold transition-colors inline-flex items-center justify-center gap-2"
                      >
                        <PictoIllu name="relancer" size={14} className="!align-middle" />
                        Regénérer
                      </button>
                    )}
                    {renduPath && (
                      <a
                        href={imgUrl(renduPath)}
                        download={`${(produitDe(it) || 'produit').toLowerCase().replace(/\s+/g, '-')}_${it.coloris.toLowerCase()}_${it.w}${lettre}${it.h}_site.jpg`}
                        className="w-full inline-flex items-center justify-center gap-2 bg-white/15 hover:bg-white/25 text-white rounded-[10px] py-2 text-sm font-bold transition-colors"
                      >
                        <PictoIllu name="telecharger" size={14} className="!align-middle" />
                        Télécharger ce rendu
                      </a>
                    )}
                    {/* Déclinaison Marketplace (1:1) — rebranchée le 07/08 soir :
                        recadrage + bords générés depuis la version regardée. */}
                    {regardee && mpPath ? (
                      <a
                        href={imgUrl(mpPath)}
                        download={nomLivrable(it, 'MP')}
                        className="w-full inline-flex items-center justify-center gap-2 bg-white/15 hover:bg-white/25 text-white rounded-[10px] py-2 text-sm font-bold transition-colors"
                      >
                        <PictoIllu name="telecharger" size={14} className="!align-middle" />
                        Télécharger la MP (1:1)
                      </a>
                    ) : regardee && mpEnCours ? (
                      <span className="w-full inline-flex items-center justify-center gap-2 bg-white/10 text-white/70 rounded-[10px] py-2 text-sm font-bold">
                        <span className="inline-block w-3.5 h-3.5 rounded-full border-2 border-white/25 border-t-white animate-spin" />
                        Déclinaison MP en cours…
                      </span>
                    ) : regardee ? (
                      <button
                        onClick={() => void envoyerMp(regardee.id)}
                        disabled={mpBusy}
                        title="Recadrage 1:1 (2000 × 2000) avec bords générés — à partir de cette version"
                        className="w-full inline-flex items-center justify-center gap-2 bg-white/15 hover:bg-white/25 text-white rounded-[10px] py-2 text-sm font-bold transition-colors disabled:opacity-50"
                      >
                        {mpJob?.status === 'error'
                          ? 'MP en échec — réessayer'
                          : mpBusy
                            ? 'Envoi…'
                            : 'Décliner en Marketplace (1:1)'}
                      </button>
                    ) : null}
                  </div>

                  {/* Description + prompt AU-DESSUS du PNG d'origine (demande
                      Mathias 07/08) — les deux FERMÉS par défaut (08/08).
                      Le mt-auto les colle en bas avec le PNG. */}
                  <details className="mt-auto bg-white/10 rounded-[8px] px-3 py-2.5 text-white/90 text-[12px]">
                    <summary className="cursor-pointer font-bold text-white text-[12.5px] select-none">
                      Description produit{' '}
                      {it.description
                        ? it.descriptionSource === 'bibliotheque'
                          ? '(bibliothèque)'
                          : '(vision)'
                        : ''}
                    </summary>
                    {it.description ? (
                      <p className="whitespace-pre-wrap mt-2 leading-relaxed">{it.description}</p>
                    ) : (
                      <p className="mt-2 text-white/60">
                        Pas de description chargée pour cette case (dépôt antérieur ou page rechargée).
                      </p>
                    )}
                    {it.productPath && (
                      <button
                        onClick={() => void forcerVision(it)}
                        disabled={visionBusy}
                        title="Ignore la bibliothèque : nouvel appel vision, l'entrée est écrasée"
                        className="mt-2.5 bg-white/15 hover:bg-white/25 text-white font-bold text-[12px] rounded-[8px] px-3 py-1.5 disabled:opacity-50"
                      >
                        {visionBusy ? 'Vision en cours…' : 'Forcer la vision (redécrire)'}
                      </button>
                    )}
                  </details>
                  {it.promptFinal && (
                    <details className="bg-white/10 rounded-[8px] px-3 py-2.5 text-white/90 text-[12px]">
                      <summary className="cursor-pointer font-bold text-white text-[12.5px] select-none">
                        Prompt complet envoyé à Nano
                      </summary>
                      <p className="whitespace-pre-wrap mt-2 leading-relaxed font-mono text-[10.5px]">
                        {it.promptFinal}
                      </p>
                    </details>
                  )}

                  {/* PNG produit d'origine en BAS de colonne (comme la modale
                      du studio MES) : vignette sur fond blanc, clic = en grand. */}
                  {it.productPath && (
                    <div className="pt-1">
                      <p className="text-[11px] uppercase tracking-wide text-white/70 font-bold mb-1.5">
                        PNG produit d’origine
                      </p>
                      <button
                        onClick={() => setPngZoom(true)}
                        title="Le produit détouré utilisé pour cette pose — cliquer pour agrandir"
                        className="w-full bg-white border border-border rounded-[10px] p-2 cursor-zoom-in hover:border-brand-green transition-colors flex items-center justify-center"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={imgUrl(it.productPath, 480)}
                          alt="PNG produit d'origine"
                          loading="lazy"
                          className="max-h-[110px] max-w-full object-contain"
                        />
                      </button>
                    </div>
                  )}
                </div>

                {/* LOUPE (copiée du studio MES) : elle REMPLACE temporairement
                    la colonne description/prompt pendant le survol (demande
                    Mathias 07/08 — pas de fenêtre volante). Molette = puissance. */}
                {loupe && (apres || avant) && (
                  <div className="absolute inset-0 z-10 pointer-events-none">
                    <div
                      ref={lensRef}
                      className="w-full h-full rounded-[12px] border-2 border-brand-green bg-white shadow-lg bg-no-repeat"
                      style={(() => {
                        // Le point sous le curseur (x, y en 0..1) est placé au
                        // centre de la fenêtre — même calcul que le studio MES.
                        const src = (apres ?? avant)!
                        const bgW = (lensBox?.w ?? 380) * loupeZoom
                        const bgH = bgW * loupe.ar
                        return {
                          backgroundImage: `url(${src})`,
                          backgroundSize: `${bgW}px ${bgH}px`,
                          backgroundPosition: `${(lensBox?.w ?? 380) / 2 - loupe.x * bgW}px ${
                            (lensBox?.h ?? 380) / 2 - loupe.y * bgH
                          }px`,
                        }
                      })()}
                    />
                  </div>
                )}
                </aside>
              )}
              </div>

              {/* Aperçu plein écran du PNG produit — fond BLANC (un détouré
                  serait invisible sur le voile noir), clic ou Échap pour fermer. */}
              {pngZoom && it.productPath && (
                <div
                  className="fixed inset-0 z-[95] bg-black/80 flex items-center justify-center p-6 cursor-zoom-out"
                  onClick={(e) => {
                    e.stopPropagation()
                    setPngZoom(false)
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={imgUrl(it.productPath)}
                    alt="PNG produit d'origine"
                    className="max-w-[92vw] max-h-[88vh] bg-white rounded-[12px] p-3 object-contain"
                  />
                </div>
              )}
            </div>
          )
        })()}
    </div>
  )
}
