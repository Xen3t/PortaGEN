import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { isPng } from '@/lib/catalogue/parse'
import { config } from '@/lib/config'
import { computeLayout, projection, projectRect, type GabaritParams } from '@/lib/geometry'
import {
  cadrageDaEffectif,
  COULEURS_PLAN_DEFAUT,
  type CadrageDaReglages,
  type CouleursPlan,
} from '@/lib/cadrageDa'
import type { MoteurDaKey } from '@/lib/moteursDa'
import { nettoyerProduit, poserProduitSurCible } from '@/lib/images/pose'
import { parseSizeFromProductName } from '@/lib/productName'

/**
 * MINI-APP « DÉCOR AUTOUR » (battants) — v2, retours Mathias 05/08/2026.
 *
 * On pose un PNG produit détouré sur un plan gris uni, MAIS à sa VRAIE échelle —
 * celle que PortaGEN calcule déjà pour ses MES (géométrie des gabarits :
 * computeLayout → projection → rectangle du portail). Nano peint ensuite l'entrée
 * tout autour, sans dessiner de piliers/muret gris (c'est Nano qui les construit).
 *
 * v2 : la sélection est un EXPLORATEUR de dossier (multi-images), la taille est
 * lue dans le nom de fichier (parseSizeFromProductName : « EIGER 300B140 » → 300×140).
 *
 * On réutilise tel quel :
 *  - la géométrie PortaGEN (src/lib/geometry) pour le rectangle du portail ;
 *  - la « pose » PortaGEN (src/lib/images/pose) pour le nettoyage du PNG
 *    (seuil alpha, réparation des pieds) et l'étirement sur la cible ;
 *  - le client Nano de l'app (src/lib/genai/client) côté route API.
 */

/** Racine de navigation : les produits détourés (borne de sécurité des chemins). */
const PRODUCTS_ROOT = path.join(config.dataDir, 'products')

/** Chemin relatif à la racine projet (format attendu par les routes/clients). */
function relOf(full: string): string {
  return path.relative(config.rootDir, full)
}

/** Vrai si `full` est PRODUCTS_ROOT ou vit dessous (anti-évasion de chemin). */
function sousProduits(full: string): boolean {
  return full === PRODUCTS_ROOT || full.startsWith(PRODUCTS_ROOT + path.sep)
}

export interface DossierCrumb {
  name: string
  rel: string
}
export interface DossierRef {
  name: string
  rel: string
}
export interface ImageRef {
  name: string
  rel: string
  /** Taille lue dans le nom (cm), null si non reconnue → non générable. */
  w: number | null
  h: number | null
}
export interface DossierListing {
  dir: string
  parent: string | null
  crumbs: DossierCrumb[]
  folders: DossierRef[]
  images: ImageRef[]
}

/** Fil d'Ariane de PRODUCTS_ROOT (« products ») jusqu'à `target` inclus. */
function construireCrumbs(target: string): DossierCrumb[] {
  const crumbs: DossierCrumb[] = [{ name: 'products', rel: relOf(PRODUCTS_ROOT) }]
  const sub = path.relative(PRODUCTS_ROOT, target)
  if (sub && sub !== '.') {
    let acc = PRODUCTS_ROOT
    for (const seg of sub.split(path.sep)) {
      acc = path.join(acc, seg)
      crumbs.push({ name: seg, rel: relOf(acc) })
    }
  }
  return crumbs
}

/**
 * Liste un dossier sous data/products : sous-dossiers + images PNG (avec la
 * taille lue dans le nom). `relDir` absent = racine data/products.
 */
export function listerDossier(relDir?: string): DossierListing {
  const target = relDir ? path.resolve(config.rootDir, relDir) : PRODUCTS_ROOT
  if (!sousProduits(target)) throw new Error('Dossier hors périmètre (data/products uniquement)')
  if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
    throw new Error('Dossier introuvable')
  }
  const entries = fs.readdirSync(target, { withFileTypes: true })
  const folders: DossierRef[] = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => ({ name: e.name, rel: relOf(path.join(target, e.name)) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
  const images: ImageRef[] = entries
    .filter((e) => e.isFile() && isPng(e.name))
    .map((e) => {
      const size = parseSizeFromProductName(e.name)
      return { name: e.name, rel: relOf(path.join(target, e.name)), w: size?.w ?? null, h: size?.h ?? null }
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
  const parent = target === PRODUCTS_ROOT ? null : relOf(path.dirname(target))
  return { dir: relOf(target), parent, crumbs: construireCrumbs(target), folders, images }
}

export interface RenduRecent {
  /** Clé unique (base du nom de fichier) */
  key: string
  /** Libellé produit lisible (nom sans les jetons techniques) */
  title: string
  /** Taille lue dans le nom du rendu (cm) */
  w: number | null
  h: number | null
  /** Plan gris envoyé (rel) et rendu brut recadré (rel) — servis via /api/artifacts */
  planPath: string
  resultPath: string
  /** Date du fichier (ms) — tri du plus récent au plus ancien */
  mtime: number
}

/**
 * Liste les rendus DÉJÀ produits (data/artifacts/decor-autour), du plus récent
 * au plus ancien : chaque `final-<base>.jpg` apparié à son `plan-<base>.png`.
 * Permet à l'UI de retrouver les images après un rafraîchissement / redémarrage
 * (l'outil ne gardait l'historique qu'en mémoire).
 */
export function listerRendus(): RenduRecent[] {
  const dir = path.join(config.artifactsDir, 'decor-autour')
  if (!fs.existsSync(dir)) return []
  const files = new Set(fs.readdirSync(dir))
  const rendus: RenduRecent[] = []
  for (const f of files) {
    if (!f.startsWith('final-') || !/\.jpe?g$/i.test(f)) continue
    const base = f.replace(/^final-/, '').replace(/\.jpe?g$/i, '')
    const plan = `plan-${base}.png`
    if (!files.has(plan)) continue
    const m = base.match(/^(.*)-(\d+)x(\d+)-/)
    const finalFull = path.join(dir, f)
    rendus.push({
      key: base,
      title: m ? m[1].replace(/-/g, ' ').trim() : base,
      w: m ? Number(m[2]) : null,
      h: m ? Number(m[3]) : null,
      planPath: relOf(path.join(dir, plan)),
      resultPath: relOf(finalFull),
      mtime: fs.statSync(finalFull).mtimeMs,
    })
  }
  return rendus.sort((a, b) => b.mtime - a.mtime)
}

/** Résout un chemin d'image demandé par l'UI (PNG sous data/products). */
export function resoudreProduit(rel: string): string {
  const full = path.resolve(config.rootDir, rel)
  if (!sousProduits(full)) throw new Error('Image hors périmètre')
  if (!fs.existsSync(full) || !fs.statSync(full).isFile() || !isPng(full)) {
    throw new Error('Image introuvable')
  }
  return full
}

/** Taille (cm) lue dans le nom d'un fichier, ou erreur claire si absente. */
export function tailleProduit(fileName: string): { w: number; h: number } {
  const size = parseSizeFromProductName(fileName)
  if (!size) throw new Error(`Taille introuvable dans le nom : ${fileName}`)
  return size
}

export interface PlanGris {
  /** Plan gris (format livraison) avec le portail posé à sa vraie échelle (PNG) */
  buffer: Buffer
  /** Rectangle réellement couvert par le portail (px) */
  portail: { x: number; y: number; w: number; h: number }
  planW: number
  planH: number
  /** Pixels de matière restaurés dans les trous d'alpha (pieds alu…) */
  alphaReparePx: number
}

export interface PlanGrisOptions {
  /** Alpha minimal conservé au nettoyage (0-255) — réglage moteur poseSeuilAlpha */
  seuilAlpha?: number
  /** Couleurs des aplats (réglage Cadrage & scène 07/08) — défauts du rodage. */
  couleurs?: Partial<CouleursPlan>
  /** Échelle largeur du produit (%, 100 = fidèle) — rectangle dilaté, centré. */
  produitLargeurPct?: number
  /** Échelle hauteur du produit (%, 100 = fidèle) — ancrée à la ligne de sol. */
  produitHauteurPct?: number
  /** Engagement de la lame sous le pilier droit (cm) — coulissant. */
  recouvrementCm?: number
  /** Couverture minimale d'une colonne « lame pleine » (%) — mesure de la queue. */
  queueCouverturePct?: number
  /** Sous ce ratio de lame pleine (%), une queue est détectée. */
  queueSeuilPct?: number
  /** Largeur de référence imposée (cm) — BANC uniquement ; absente = vraie largeur. */
  refWidth?: number
  /**
   * Bloc gabarit FIGÉ appliqué à la pose (banc portillon : zoom, décalage Y,
   * hauteurs pilier… — voir BANC_PORTILLON_GABARIT). Absent = défauts battant.
   */
  gabarit?: Partial<GabaritParams>
  /**
   * COULISSANT (07/08, choix Mathias — l'esprit du « 2 étapes » legacy en une
   * seule image) : la lame est étirée sous le pilier droit (recouvrement fixe)
   * et l'aplat du pilier droit + son chapeau sont peints PAR-DESSUS après la
   * pose — la lame passe DERRIÈRE lui par construction. Ne vaut qu'avec bandesSol.
   */
  pilierDroitDevant?: boolean
  /**
   * BANC uniquement (rodage 07/08, v3) : dessine sous la ligne de pied du
   * portail les bandes de sol en aplats (trottoir / bordure / route) — la
   * structure dessinée ancre la géométrie de Nano (le prompt v2 seul laissait
   * le portail se faire rétrécir ~30 %), comme les aplats piliers/murets de
   * l'ancienne méthode que Nano texturait sans les déplacer.
   */
  bandesSol?: boolean
}

/**
 * Cadrage d'une image selon moteur et largeur (source de vérité unique,
 * partagée par l'aperçu /pose et la génération /generate). Depuis le 07/08
 * soir, les valeurs viennent des RÉGLAGES « Cadrage & scène » du moteur
 * (src/lib/cadrageDa.ts — défauts = la recette rodée au banc) :
 *  - battant + coulissant standard : référence 400, zoom du moteur ;
 *  - coulissant ≥ xlMinW (450) : bascule XL — référence 600, scène élargie ;
 *  - portillon : VRAIE largeur, zoom/décalage/plafond pilier de sa recette.
 */
export function bancCadrage(
  moteur: MoteurDaKey,
  w: number,
  cadrage?: CadrageDaReglages
): {
  refWidth?: number
  gabarit?: Partial<GabaritParams>
  pilierDroitDevant?: boolean
} {
  const c = cadrage ?? cadrageDaEffectif(moteur)
  const gab: Partial<GabaritParams> = {}
  if (c.zoom !== 100) gab.zoom = c.zoom
  if (c.offsetX !== 0) gab.offsetX = c.offsetX
  if (c.offsetY !== 0) gab.offsetY = c.offsetY
  if (c.pillarHMax !== null) gab.pillarHMax = c.pillarHMax
  const gabarit = Object.keys(gab).length > 0 ? gab : undefined
  if (moteur === 'terminus' && w >= c.xlMinW) {
    return {
      refWidth: c.xlRefWidthCm,
      gabarit: {
        sceneH: c.xlSceneH,
        groundY: c.xlGroundY,
        ...(c.xlZoom !== 100 ? { zoom: c.xlZoom } : {}),
      },
      pilierDroitDevant: true,
    }
  }
  return {
    ...(c.refWidthCm !== null ? { refWidth: c.refWidthCm } : {}),
    ...(gabarit ? { gabarit } : {}),
    ...(moteur === 'terminus' ? { pilierDroitDevant: true } : {}),
  }
}

/**
 * Construit le plan gris : produit posé à l'échelle PortaGEN. Le rectangle du
 * portail vient de la géométrie des gabarits (défauts battant) ; AUCUN débord
 * (on ne pose pas de piliers, Nano les peint autour). Accepte un chemin OU un
 * Buffer (produit déjà traité — RALify — côté pipeline).
 *
 * Le PNG est posé TEL QUEL : aucune réparation de bande basse ni de poches
 * (demande Mathias 07/08 — la nouvelle méthode n'a ni juge ni réparation, les
 * PNG produits sont propres, faits main, décision du 21/07). Seul le seuil
 * alpha du nettoyage standard s'applique.
 */
export async function construirePlanGris(
  produit: Buffer | string,
  size: { w: number; h: number },
  opts: PlanGrisOptions = {}
): Promise<PlanGris> {
  // Échelle produit (réglage Cadrage, 07/08 soir) : appliquée DANS la géométrie
  // — un produit agrandi écarte ses piliers, monte ses murets, tout l'échafaudage
  // se recompose autour (exigence Mathias : « le reste s'adapte autour »).
  const echLargeur = (opts.produitLargeurPct ?? 100) / 100
  const echHauteur = (opts.produitHauteurPct ?? 100) / 100
  const sizeEff = {
    w: Math.max(1, Math.round(size.w * echLargeur)),
    h: Math.max(1, Math.round(size.h * echHauteur)),
  }
  // La largeur étalon est dilatée du même facteur : à l'étalon, la largeur du
  // rectangle vient d'elle, pas de la taille du produit.
  const refWidthEff = opts.refWidth
    ? Math.max(1, Math.round(opts.refWidth * echLargeur))
    : undefined
  const layout = computeLayout(sizeEff, {
    ...(opts.gabarit ?? {}),
    ...(refWidthEff ? { refWidth: refWidthEff } : {}),
  })
  const planW = config.delivery.width
  const planH = config.delivery.height
  const proj = projection(planW, planH, layout.sceneW, layout.sceneH, 'stretch')
  const portail = projectRect(
    { x: layout.gateLeft, y: layout.gateTop, w: layout.gateW, h: layout.gateH },
    proj
  )

  let gris = await sharp({
    create: { width: planW, height: planH, channels: 4, background: { r: 200, g: 200, b: 200, alpha: 1 } },
  })
    .png()
    .toBuffer()

  // Structure dessinée (BANC, rodage 07/08) : aplats posés AVANT le produit.
  // v3 = bandes de sol (respectées par Nano, hauteur du portail tenue) ;
  // v4 = AUSSI les piliers/murets/chapeaux du gabarit (refWidth 400), car sans
  // butées dessinées Nano écrasait la LARGEUR du portail (~85 % → ~60 %). Même
  // principe que l'échafaudage piliers/murets de l'ancienne méthode.
  // Coulissant (pilierDroitDevant) : la LAME PLEINE ferme l'ouverture jusqu'à
  // s'engager sous le pilier droit (20 cm). Si le PNG porte une QUEUE DE
  // REFOULEMENT (PNG corrigés Mathias 07/08 : bras de cadre fins qui dépassent
  // du dernier panneau), on la MESURE (profil de couverture des colonnes) et
  // la pose est calée pour que la lame pleine s'arrête au pilier — la queue
  // file naturellement derrière/au-delà (c'est le produit, portail FERMÉ).
  // Sans ça, la queue comptait dans la boîte englobante : la lame pleine
  // s'arrêtait AVANT le pilier et l'espace entre les bras lisait « ouvert ».
  const cible = { x: portail.x, y: portail.y, w: portail.w, h: portail.h }
  // COULISSANT (08/08, retour Mathias) : le RAIL est l'origine — posé SUR la
  // ligne de sol, et la lame MONTE de sa hauteur pour rouler dessus. Avant, le
  // rail était planté dans le trottoir et dépassait sous la lame.
  const railH =
    opts.pilierDroitDevant && opts.bandesSol ? Math.max(3, Math.round(proj.sy * 2)) : 0
  if (railH > 0) cible.y -= railH
  if (opts.pilierDroitDevant) {
    // Physique du coulissant FERMÉ (enseignée par Mathias 07/08) : la lame vit
    // sur un plan EN RETRAIT derrière la ligne des piliers. À DROITE son nez
    // s'engage derrière le pilier (caché, ~20 cm) et la queue file au-delà ;
    // à GAUCHE son chant de fermeture (serrure/poignée) COLMATE contre
    // l'arrière du pilier en restant VISIBLE — ni caché, ni « entre » : la
    // lame démarre au bord intérieur du pilier gauche, en creux derrière lui.
    const prPx = projectRect(layout.pillarRight, proj)
    const engPx = Math.round((opts.recouvrementCm ?? 20) * proj.sx)
    const engagement = Math.min(planW, prPx.x + Math.min(prPx.w, engPx))
    // Part de LAME PLEINE du PNG : dernière colonne couverte au-delà du seuil
    // (une colonne de lame est quasi pleine ; un bras de queue couvre ~10-20 %).
    const nettoye = await nettoyerProduit(produit, opts.seuilAlpha, false, false)
    const prof = await sharp(nettoye.image)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    const W = prof.info.width
    const H = prof.info.height
    const ch = prof.info.channels
    const couvertureMin = (opts.queueCouverturePct ?? 50) / 100
    let finLamePleine = W - 1
    for (let x = W - 1; x >= 0; x--) {
      let c = 0
      for (let y = 0; y < H; y++) {
        if (prof.data[(y * W + x) * ch + 3] > 0) c++
      }
      if (c >= H * couvertureMin) {
        finLamePleine = x
        break
      }
    }
    const fracLame = (finLamePleine + 1) / W
    if (fracLame < (opts.queueSeuilPct ?? 98) / 100) {
      // Queue détectée : [début..fin de lame pleine] couvre [gauche..engagement],
      // la queue dépasse au-delà du pilier (bornée au cadre).
      cible.w = Math.min(planW - cible.x, Math.round((engagement - cible.x) / fracLame))
    } else {
      // Pas de queue (PNG historiques) : nez de lame engagé sous le pilier.
      cible.w = Math.max(cible.w, engagement - cible.x)
    }
  }

  // Aplats peints APRÈS la pose (occlusion par construction) : pilier droit +
  // chapeau du coulissant, par-dessus le bout de lame.
  let apresSvg: string | null = null
  if (opts.bandesSol) {
    // Couleurs de l'échafaudage : réglage « Cadrage & scène » du moteur (07/08),
    // défauts = les teintes rodées au banc.
    const coul = { ...COULEURS_PLAN_DEFAUT, ...(opts.couleurs ?? {}) }
    const yG = portail.y + portail.h
    const hBelow = planH - yG
    const rects: string[] = []
    const rectsApres: string[] = []
    if (hBelow > 12) {
      const hTrottoir = Math.round(hBelow * 0.45)
      const hBordure = Math.max(4, Math.round(hBelow * 0.08))
      rects.push(
        `<rect x="0" y="${yG}" width="${planW}" height="${hTrottoir}" fill="${coul.trottoir}"/>`,
        `<rect x="0" y="${yG + hTrottoir}" width="${planW}" height="${hBordure}" fill="${coul.bordure}"/>`,
        `<rect x="0" y="${yG + hTrottoir + hBordure}" width="${planW}" height="${hBelow - hTrottoir - hBordure}" fill="${coul.route}"/>`
      )
    }
    // COULISSANT : le RAIL DE GUIDAGE au sol (rodage 07/08 — marqueur visuel
    // du produit avec les galets ; sans lui, le prior « battant » gagnait).
    // Fine bande sombre sur la ligne de sol, de la lame jusque sous le pilier
    // droit — dessinée AVANT la pose : la lame et ses galets passent dessus.
    if (opts.pilierDroitDevant && hBelow > 12 && railH > 0) {
      const prPx = projectRect(layout.pillarRight, proj)
      // Le rail part du début de la LAME posée (cible — échelle produit
      // comprise), POSÉ sur la ligne de sol — la lame roule dessus (08/08).
      const railW = Math.max(0, prPx.x + prPx.w - cible.x)
      if (railW > 0) {
        rects.push(
          `<rect x="${cible.x}" y="${yG - railH}" width="${railW}" height="${railH}" fill="${coul.rail}"/>`
        )
      }
    }
    // Murets d'abord (les piliers passent devant), puis piliers et chapeaux —
    // rects en cm du gabarit, projetés en px comme le portail.
    const aplat = (
      r: { x: number; y: number; w: number; h: number } | null | undefined,
      fill: string,
      apres = false
    ) => {
      if (!r) return
      const p = projectRect(r, proj)
      if (p.w > 0 && p.h > 0) {
        ;(apres ? rectsApres : rects).push(
          `<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" fill="${fill}"/>`
        )
      }
    }
    aplat(layout.muretLeft, coul.muret)
    // Coulissant : le muret droit passe DEVANT la lame lui aussi — la lame file
    // derrière lui, seul son haut émerge au-dessus (physique du refoulement).
    aplat(layout.muretRight, coul.muret, opts.pilierDroitDevant === true)
    // Coulissant : pilier DROIT devant la lame (le nez s'engage derrière lui) ;
    // le pilier GAUCHE reste peint AVANT la pose — le chant de fermeture
    // (serrure/poignée, qui peut déborder sur le pilier) doit rester VISIBLE.
    aplat(layout.pillarLeft, coul.pilier)
    aplat(layout.pillarRight, coul.pilier, opts.pilierDroitDevant === true)
    // Chapeaux dans la MÊME famille blanc cassé que les piliers (07/08 : un
    // aplat plus foncé faisait sortir des chapeaux GRIS au lieu de blancs —
    // Nano texture la teinte qu'on lui donne).
    aplat(layout.capLeft?.bbox, coul.chapeau)
    aplat(layout.capRight?.bbox, coul.chapeau, opts.pilierDroitDevant === true)
    // FACETTES DE PROFONDEUR (18/08, maquette gabarit-profondeur v3 validée par
    // Mathias — sans arêtes grises) : chaque pilier du coulissant est dessiné
    // comme un BLOC 3D vu de face — facette interne sur le fût et le chapeau
    // (le retour du pilier vers le plan de la lame, en retrait) + fine ombre
    // sous le débord du chapeau. Indices visibles quel que soit le coloris du
    // produit : ils vivent sur les piliers clairs, pas sur la lame (l'ombre à
    // 40 % disparaissait sur un produit anthracite). Teintes DÉRIVÉES des
    // couleurs réglées, jamais de gris en dur.
    if (opts.pilierDroitDevant) {
      const assombrir = (hex: string, frac: number): string => {
        const n = hex.replace('#', '')
        if (n.length !== 6) return hex
        const v = [0, 2, 4].map((i) =>
          Math.max(0, Math.round(parseInt(n.slice(i, i + 2), 16) * (1 - frac)))
        )
        return '#' + v.map((x) => x.toString(16).padStart(2, '0')).join('')
      }
      const facette = (
        pilier: { x: number; y: number; w: number; h: number } | null | undefined,
        cap: { x: number; y: number; w: number; h: number } | null | undefined,
        interieurADroite: boolean,
        couche: string[]
      ) => {
        if (!pilier) return
        const p = projectRect(pilier, proj)
        if (p.w <= 0 || p.h <= 0) return
        const fw = Math.max(3, Math.round(p.w * 0.2))
        const xFut = interieurADroite ? p.x + p.w - fw : p.x
        couche.push(
          `<rect x="${xFut}" y="${p.y}" width="${fw}" height="${p.h}" fill="${assombrir(coul.pilier, 0.09)}"/>`
        )
        if (cap) {
          const c = projectRect(cap, proj)
          if (c.w > 0 && c.h > 0) {
            const xCap = interieurADroite ? c.x + c.w - fw : c.x
            couche.push(
              `<rect x="${xCap}" y="${c.y}" width="${fw}" height="${c.h}" fill="${assombrir(coul.chapeau, 0.14)}"/>`
            )
            couche.push(
              `<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${Math.max(3, Math.round(proj.sy * 2))}" fill="rgba(0,0,0,0.16)"/>`
            )
          }
        }
      }
      facette(layout.pillarLeft, layout.capLeft?.bbox, true, rects)
      facette(layout.pillarRight, layout.capRight?.bbox, false, rectsApres)
    }
    if (rects.length > 0) {
      const svg = `<svg width="${planW}" height="${planH}" xmlns="http://www.w3.org/2000/svg">${rects.join('')}</svg>`
      gris = await sharp(gris).composite([{ input: Buffer.from(svg) }]).png().toBuffer()
    }
    // PROFONDEUR PAR L'OMBRE (17/08 soir, demande Mathias « donner de la
    // perspective au gabarit ») : l'élévation frontale n'offre aucun indice de
    // profondeur et Nano re-dessinait la jonction lame/pilier à sa façon (lame
    // traversant le pilier droit, chant au milieu du pilier gauche — jobs
    // 123/125/126, trois itérations de prompt sans effet). Recette VALIDÉE du
    // coulissant legacy reprise (28/07 : sans ombre « la lame s'arrêtait AVANT
    // le pilier » ; étude fiabilité 25 % = 2/4, 40 % = 3/3 → 40) : bande
    // d'occlusion ambiante TRÈS progressive sur la lame le long de la face
    // gauche du pilier droit (1,5 × sa largeur, 0 → 40 % au contact, jusqu'au
    // sol — jamais de bloc sombre). Face droite du pilier GAUCHE : même indice
    // moitié moins large (le chant de fermeture vit en creux DERRIÈRE lui).
    let ombresSvg = ''
    if (opts.pilierDroitDevant && portail.y + portail.h > cible.y) {
      const prPx = projectRect(layout.pillarRight, proj)
      const plPx = projectRect(layout.pillarLeft, proj)
      const ombreY = cible.y
      const ombreH = portail.y + portail.h - cible.y
      const bandeDroite = Math.round(prPx.w * 1.5)
      const bandeGauche = Math.round(plPx.w * 0.75)
      ombresSvg =
        `<defs>` +
        `<linearGradient id="ombrePilierDroit" x1="0" y1="0" x2="1" y2="0">` +
        `<stop offset="0" stop-color="black" stop-opacity="0"/>` +
        `<stop offset="1" stop-color="black" stop-opacity="0.4"/>` +
        `</linearGradient>` +
        `<linearGradient id="ombrePilierGauche" x1="0" y1="0" x2="1" y2="0">` +
        `<stop offset="0" stop-color="black" stop-opacity="0.4"/>` +
        `<stop offset="1" stop-color="black" stop-opacity="0"/>` +
        `</linearGradient>` +
        `</defs>` +
        `<rect x="${prPx.x - bandeDroite}" y="${ombreY}" width="${bandeDroite}" height="${ombreH}" fill="url(#ombrePilierDroit)"/>` +
        `<rect x="${plPx.x + plPx.w}" y="${ombreY}" width="${bandeGauche}" height="${ombreH}" fill="url(#ombrePilierGauche)"/>`
    }
    if (rectsApres.length > 0 || ombresSvg) {
      apresSvg = `<svg width="${planW}" height="${planH}" xmlns="http://www.w3.org/2000/svg">${ombresSvg}${rectsApres.join('')}</svg>`
    }
  }

  const pose = await poserProduitSurCible(gris, produit, cible, opts.seuilAlpha, false, false)
  let buffer = pose.image
  if (apresSvg) {
    buffer = await sharp(buffer)
      .composite([{ input: Buffer.from(apresSvg) }])
      .png()
      .toBuffer()
  }
  return {
    buffer,
    portail: pose.cible,
    planW,
    planH,
    alphaReparePx: pose.produit.alphaReparePx,
  }
}

/** Description par défaut de l'ambiance (éditable côté UI). */
export const DESCRIPTION_DEFAUT =
  "Derrière le portail, une maison individuelle française (pavillon) vue de face, façade frontale visible au-dessus du muret. De part et d'autre, piliers carrés et muret bas en stucco blanc (crépi), chapeau plat. Devant, trottoir béton, bordure, route bitume. Grand ciel bleu dégagé et ensoleillé, lumière franche de beau temps."

/**
 * Prompt « décor autour » : ossature FIXE (élévation à plat + portail verrouillé,
 * les deux leviers validés au banc v1) autour de la description ÉDITABLE de
 * l'ambiance. On ne dit jamais « coulissant/glisser » — ici c'est un battant.
 */
export function promptDecorAutour(description: string): string {
  const desc = description.trim() || DESCRIPTION_DEFAUT
  return `Photorealistic photograph shot as a strict ARCHITECTURAL ELEVATION / flat front view. The camera is exactly perpendicular to the gate, dead-on, at gate mid-height. ZERO perspective: no vanishing point, no diagonal lines, no 3/4 angle, no foreshortening. Everything is parallel to the image plane — walls run perfectly horizontal from the left edge to the right edge, pillars are vertical, and the ground layers (sidewalk, kerb, road) read as flat HORIZONTAL BANDS stacked one above another across the whole width.

The attached image is a plain neutral-grey work canvas with a wooden double-swing driveway gate already correctly placed and centered on it. The grey area is empty and must be replaced by a realistic environment, keeping this same flat frontal geometry.

Build the environment AROUND the gate, all seen perfectly head-on. Ambiance: ${desc}

KEEP THE GATE UNCHANGED: same exact size, width, height, centred position, slats, texture, colour and hardware as in the input. Do NOT resize, move, recenter or restyle it — only construct the entrance strictly around its current outline.

Photorealistic, high detail. Absolutely FLAT, FRONTAL, symmetrical — no perspective whatsoever.`
}
