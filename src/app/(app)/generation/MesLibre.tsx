'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Silhouette, { PictoIllu, type Typo } from '../Silhouette'
import PhraseAttente from '@/components/PhraseAttente'

/**
 * MES Libre — le studio visuel adaptatif (maquette mes-libre-v11 validée le
 * 28/07/2026) : produit en références (« quasi que du prompt », cadrage Portail
 * §2), scène décrite par un FORMULAIRE guidé (jamais de prompting imposé),
 * réglages tous visuels branchés sur un aperçu d'ambiance vivant, profils de
 * réglages par typologie (portail / cache-clim en v1), génération par lot de
 * variantes via /api/generation/libre (un job « libre » par variante).
 *
 * V1 volontairement minimale (règle « version minimale d'abord ») : décors
 * Libres préfaits côté client, pas d'enregistrement de décor, pas de session
 * Accueil, pas de Marketplace — à ramifier sur retours.
 */

// —————————————————————————————————————————————— types

/** Scène d'aperçu disponible (l'illustration) — les profils s'y rattachent. */
type SceneKey = 'portail' | 'clim'
type TypoKey = 'battant' | 'coulissant' | 'portillon' | 'clim' | 'autre'

interface LibreJob {
  id: number
  type: string
  status: string
  error: string | null
  payload: {
    variante?: number
    productLabel?: string
    productPaths?: string[]
    aspectRatio?: string
    imageSize?: string
    model?: string
    rootJobId?: number
    instruction?: string
    ui?: Partial<UiState>
  } | null
  result: {
    imagePath?: string
    deliveryPath?: string
    promptPath?: string
    rootJobId?: number
    instruction?: string
    variante?: number
    width?: number
    height?: number
  } | null
}

/** État du formulaire embarqué dans le payload (`ui`) — la reprise de session le relit. */
interface UiState {
  typo: TypoKey
  customTypo: { nm: string; marque: string; profil: string } | null
  profilId: string
  decorSel: string
  sceneDecor: string
  desc: string
  dfVals: Record<string, string>
  saison: string
  meteo: string
  light: string
  angle: string
  cadr: string
  haut: string
  compo: string
  pdc: string
  extras: Record<string, boolean>
  n: number
  ratio: string
  model: 'pro' | 'flash'
  quality: '1K' | '2K' | '4K'
  label: string
}

interface ImgItem {
  id: string
  name: string
  url: string
  file: File
}

function imgUrl(p: string, w?: number): string {
  const base = `/api/artifacts?p=${encodeURIComponent(p)}`
  return w ? `${base}&w=${w}` : base
}

// —————————————————————————————————————————————— profils de réglages
// À terme : un profil par famille de produits, généré par cas et stocké en base
// (éditable en Admin). V1 : portail (battant/coulissant/portillon) + cache-clim.

interface DecorPreset {
  id: string
  nm: string
  tg: string
  desc: string
  /** mini-vignette (SVG maquette v11, injectée telle quelle) */
  th: string
  /** Ambiance d'aperçu pilotée par ce décor (clé CSS de la scène) — défaut : id. */
  sceneDecor?: string
}

interface DfField {
  id: string
  lbl: string
  opts: [string, string][]
}

interface PlusItem {
  id: string
  lbl: string
  txt: string
  /** icône plate langage silhouettes (SVG maquette v11) */
  ic: string
}

interface Profil {
  label: string
  /** Scène d'aperçu utilisée par ce profil (l'illustration d'ambiance). */
  scene: SceneKey
  typoTxt: string
  decors: DecorPreset[]
  df: DfField[]
  dfTxt: Record<string, Record<string, string>>
  sentence: (t: Record<string, string>) => string
  plus: PlusItem[]
}

interface SavedDecor {
  id: number
  name: string
  profil: string
  description: string
  created_by: string | null
}

const ICONS: Record<string, string> = {
  voiture:
    '<svg viewBox="0 0 24 24"><path d="M4.5 14.5 l1.8 -4.6 q.4 -1 1.5 -1 h8.4 q1.1 0 1.5 1 l1.8 4.6" fill="#e8f2dc" stroke="#5d9228" stroke-width="1.8"/><rect x="3" y="14.5" width="18" height="4" rx="1.5" fill="#e8f2dc" stroke="#5d9228" stroke-width="1.8"/><circle cx="8" cy="19.5" r="1.8" fill="#dfe3e8" stroke="#b6bdc6" stroke-width="1.5"/><circle cx="16" cy="19.5" r="1.8" fill="#dfe3e8" stroke="#b6bdc6" stroke-width="1.5"/></svg>',
  vege: '<svg viewBox="0 0 24 24"><line x1="3" y1="20" x2="21" y2="20" stroke="#c3c9d1" stroke-width="2"/><circle cx="8" cy="15" r="4" fill="#e8f2dc" stroke="#5d9228" stroke-width="1.8"/><circle cx="15" cy="13" r="5" fill="#e8f2dc" stroke="#5d9228" stroke-width="1.8"/></svg>',
  lamp: '<svg viewBox="0 0 24 24"><circle cx="12" cy="9" r="4.5" fill="#e8f2dc" stroke="#5d9228" stroke-width="1.8"/><g stroke="#b6bdc6" stroke-width="1.6" stroke-linecap="round"><line x1="12" y1="1.5" x2="12" y2="3.5"/><line x1="4.5" y1="9" x2="6.5" y2="9"/><line x1="17.5" y1="9" x2="19.5" y2="9"/></g><rect x="10.4" y="14.5" width="3.2" height="5" rx="1" fill="#dfe3e8" stroke="#b6bdc6" stroke-width="1.5"/></svg>',
  pot: '<svg viewBox="0 0 24 24"><circle cx="12" cy="9" r="4.5" fill="#e8f2dc" stroke="#5d9228" stroke-width="1.8"/><path d="M7.5 14.5 h9 l-1.4 6 h-6.2 Z" fill="#dfe3e8" stroke="#b6bdc6" stroke-width="1.5"/></svg>',
  mail: '<svg viewBox="0 0 24 24"><rect x="5" y="7" width="13" height="8" rx="2.5" fill="#e8f2dc" stroke="#5d9228" stroke-width="1.8"/><line x1="8" y1="11" x2="13" y2="11" stroke="#5d9228" stroke-width="1.8"/><line x1="12" y1="15" x2="12" y2="21" stroke="#b6bdc6" stroke-width="1.8"/></svg>',
  inter:
    '<svg viewBox="0 0 24 24"><rect x="7" y="3.5" width="10" height="17" rx="2" fill="#e8f2dc" stroke="#5d9228" stroke-width="1.8"/><rect x="9.5" y="6.5" width="5" height="4" rx="1" fill="none" stroke="#5d9228" stroke-width="1.5"/><g fill="#b6bdc6"><circle cx="10.5" cy="14.5" r="1"/><circle cx="13.5" cy="14.5" r="1"/><circle cx="10.5" cy="17.5" r="1"/><circle cx="13.5" cy="17.5" r="1"/></g></svg>',
  borne:
    '<svg viewBox="0 0 24 24"><line x1="4" y1="21" x2="20" y2="21" stroke="#c3c9d1" stroke-width="2"/><rect x="9.5" y="6.5" width="5" height="14.5" rx="1.5" fill="#dfe3e8" stroke="#b6bdc6" stroke-width="1.5"/><rect x="9.5" y="6.5" width="5" height="4.5" rx="1.5" fill="#e8f2dc" stroke="#5d9228" stroke-width="1.8"/></svg>',
  haie: '<svg viewBox="0 0 24 24"><line x1="3" y1="20" x2="21" y2="20" stroke="#c3c9d1" stroke-width="2"/><path d="M4 20 v-5.5 a4 4 0 0 1 8 0 v5.5 M12 20 v-6.5 a4 4 0 0 1 8 0 v6.5" fill="#e8f2dc" stroke="#5d9228" stroke-width="1.8"/></svg>',
  galet:
    '<svg viewBox="0 0 24 24"><ellipse cx="8" cy="17" rx="5" ry="3.5" fill="#dfe3e8" stroke="#b6bdc6" stroke-width="1.5"/><ellipse cx="16" cy="18" rx="4" ry="3" fill="#e8f2dc" stroke="#5d9228" stroke-width="1.8"/><ellipse cx="12" cy="11.5" rx="4" ry="3" fill="#dfe3e8" stroke="#b6bdc6" stroke-width="1.5"/></svg>',
  grimp:
    '<svg viewBox="0 0 24 24"><path d="M12 21 C10 15 14 12 12 5.5" fill="none" stroke="#5d9228" stroke-width="1.8"/><circle cx="9" cy="9" r="2.5" fill="#e8f2dc" stroke="#5d9228" stroke-width="1.6"/><circle cx="15" cy="13" r="2.5" fill="#e8f2dc" stroke="#5d9228" stroke-width="1.6"/><circle cx="10" cy="17" r="2.5" fill="#e8f2dc" stroke="#5d9228" stroke-width="1.6"/></svg>',
}

const PROFILES: Record<string, Profil> = {
  portail: {
    label: 'Portail',
    scene: 'portail',
    typoTxt: 'Portail acier avec chapeau de gendarme',
    decors: [
      {
        id: 'tuffeau',
        nm: 'Tuffeau sud-ouest',
        tg: 'pierre crème · tuiles canal',
        desc: "Photographie d'une entrée de propriété résidentielle française. Le portail est encadré par deux piliers et des murs latéraux en pierre de tuffeau naturelle, couleur crème claire, blocs réguliers, joints fins. Ambiance sud-ouest élégante, toiture en tuiles canal, allée en gravier clair au premier plan. Photo haut de gamme, matériaux crédibles, ombres naturelles.",
        th: '<svg viewBox="0 0 200 58" preserveAspectRatio="none"><rect width="200" height="40" fill="#9ec7e8"/><rect y="40" width="200" height="18" fill="#ddd5c0"/><polygon points="60,42 140,42 124,26 76,26" fill="#c8764f"/><rect x="70" y="32" width="60" height="10" fill="#f0e7d3"/><ellipse cx="24" cy="38" rx="7" ry="14" fill="#5f7a44"/></svg>',
      },
      {
        id: 'moderne',
        nm: 'Entrée moderne',
        tg: 'béton · lignes nettes',
        desc: "Photographie d'une entrée contemporaine épurée. Piliers et murets en béton lissé gris clair, maison cubique à toit plat en arrière-plan, graminées légères, sol en dalles claires. Lignes nettes, matériaux crédibles.",
        th: '<svg viewBox="0 0 200 58" preserveAspectRatio="none"><rect width="200" height="40" fill="#b8cede"/><rect y="40" width="200" height="18" fill="#cfd3d6"/><rect x="58" y="26" width="84" height="14" fill="#f4f5f6"/><rect x="58" y="24" width="84" height="4" fill="#7d858d"/><rect x="66" y="30" width="68" height="6" fill="#9fb4c4"/></svg>',
      },
      {
        id: 'campagne',
        nm: 'Campagne',
        tg: 'haies · grand arbre',
        desc: "Photographie d'une entrée de propriété à la campagne. Piliers en pierre patinée, haies champêtres, grand arbre feuillu sur la droite, chemin de terre clair. Ambiance naturelle et chaleureuse, ombres douces.",
        th: '<svg viewBox="0 0 200 58" preserveAspectRatio="none"><rect width="200" height="40" fill="#a9cbe3"/><rect y="40" width="200" height="18" fill="#d9cfae"/><ellipse cx="50" cy="40" rx="36" ry="7" fill="#7a9a5a"/><ellipse cx="150" cy="40" rx="36" ry="7" fill="#7a9a5a"/><circle cx="164" cy="24" r="11" fill="#6f8f4f"/><rect x="161" y="30" width="5" height="12" fill="#6e5537"/></svg>',
      },
    ],
    df: [
      {
        id: 'lieu',
        lbl: 'Le lieu',
        opts: [
          ['sudouest', 'Sud-Ouest de la France'],
          ['provence', 'Provence / Méditerranée'],
          ['campagne', 'Campagne française'],
          ['mer', 'Bord de mer'],
          ['ville', 'Quartier résidentiel moderne'],
        ],
      },
      {
        id: 'maison',
        lbl: 'La maison',
        opts: [
          ['trad', 'Traditionnelle en pierre'],
          ['contemp', 'Contemporaine à toit plat'],
          ['longere', 'Longère rénovée'],
          ['aucune', 'Pas de maison visible'],
        ],
      },
      {
        id: 'pilier',
        lbl: 'Piliers & murets',
        opts: [
          ['pierre', 'Pierre naturelle'],
          ['enduit', 'Enduit clair'],
          ['brique', 'Brique patinée'],
          ['beton', 'Béton lissé'],
          ['gabion', 'Gabions'],
        ],
      },
      {
        id: 'sol',
        lbl: "Le sol / l'allée",
        opts: [
          ['gravier', 'Gravier clair'],
          ['paves', 'Pavés anciens'],
          ['beton', 'Béton désactivé'],
          ['terre', 'Chemin de terre'],
        ],
      },
      {
        id: 'fond',
        lbl: "L'arrière-plan",
        opts: [
          ['jardin', 'Jardin arboré'],
          ['haie', 'Haies taillées'],
          ['ouvert', 'Cour ouverte'],
          ['facade', 'Façade proche'],
        ],
      },
      {
        id: 'amb',
        lbl: "L'ambiance",
        opts: [
          ['elegante', 'Élégante'],
          ['chaleureuse', 'Chaleureuse'],
          ['epuree', 'Épurée'],
          ['champetre', 'Champêtre'],
        ],
      },
    ],
    dfTxt: {
      lieu: {
        sudouest: 'dans le Sud-Ouest de la France',
        provence: 'en Provence, ambiance méditerranéenne',
        campagne: 'à la campagne française',
        mer: 'en bord de mer',
        ville: 'dans un quartier résidentiel moderne',
      },
      maison: {
        trad: 'En arrière-plan, une maison traditionnelle en pierre aux tuiles anciennes.',
        contemp: 'En arrière-plan, une maison contemporaine à toit plat.',
        longere: 'En arrière-plan, une longère rénovée.',
        aucune: 'Aucune maison visible.',
      },
      pilier: {
        pierre: 'des piliers et murets en pierre naturelle aux joints fins',
        enduit: 'des piliers et murets enduits d’un crépi clair',
        brique: 'des piliers et murets en brique patinée',
        beton: 'des piliers et murets en béton lissé',
        gabion: 'des piliers et murets en gabions contemporains',
      },
      sol: {
        gravier: 'allée en gravier clair ratissé',
        paves: 'allée en pavés anciens',
        beton: 'allée en béton désactivé',
        terre: 'chemin de terre bordé d’herbes',
      },
      fond: {
        jardin: 'jardin arboré en toile de fond',
        haie: 'haies taillées de part et d’autre',
        ouvert: 'cour ouverte et dégagée',
        facade: 'façade toute proche',
      },
      amb: {
        elegante: 'élégante et haut de gamme',
        chaleureuse: 'chaleureuse et accueillante',
        epuree: 'épurée et minimale',
        champetre: 'champêtre et naturelle',
      },
    },
    sentence: (t) =>
      `Photographie d'une entrée de propriété ${t.lieu}. Le portail est encadré par ${t.pilier}, ${t.sol} au premier plan, ${t.fond}. ${t.maison} Ambiance ${t.amb}, style photographie d’architecture extérieure, matériaux crédibles, ombres naturelles.`,
    plus: [
      { id: 'voiture', lbl: "Voiture dans l'allée", txt: "voiture premium dans l'allée", ic: ICONS.voiture },
      { id: 'vege', lbl: 'Végétation généreuse', txt: 'végétation généreuse en pied de murets', ic: ICONS.vege },
      { id: 'lamp', lbl: 'Luminaires sur piliers', txt: 'luminaires extérieurs sur les piliers', ic: ICONS.lamp },
      { id: 'pot', lbl: 'Pots de fleurs', txt: 'pots de fleurs fleuris au pied des piliers', ic: ICONS.pot },
      { id: 'mail', lbl: 'Boîte aux lettres', txt: "boîte aux lettres à l'entrée", ic: ICONS.mail },
      { id: 'inter', lbl: 'Interphone', txt: 'interphone vidéo sur le pilier', ic: ICONS.inter },
      { id: 'borne', lbl: "Bornes d'allée", txt: "bornes lumineuses le long de l'allée", ic: ICONS.borne },
      { id: 'haie', lbl: 'Haie taillée', txt: 'haie taillée le long des murets', ic: ICONS.haie },
    ],
  },
  clim: {
    label: 'Cache climatisation',
    scene: 'clim',
    typoTxt: 'Cache climatisation aluminium, lames horizontales',
    decors: [
      {
        id: 'crepi',
        nm: 'Façade crépi',
        tg: 'enduit crème · gravier',
        desc: "Photographie d'un cache climatisation posé contre une façade enduite d'un crépi crème propre, au pied du mur sur un lit de gravier clair, fenêtre en arrière-plan. Photo haut de gamme, matériaux crédibles, ombres naturelles.",
        th: '<svg viewBox="0 0 200 58" preserveAspectRatio="none"><rect width="200" height="42" fill="#efe6d5"/><rect y="42" width="200" height="16" fill="#ddd5c0"/><rect x="130" y="10" width="34" height="26" fill="#9fb4c4"/></svg>',
      },
      {
        id: 'pierre',
        nm: 'Mur de pierre',
        tg: 'pierre claire · dalles',
        desc: "Photographie d'un cache climatisation contre un mur en pierre claire appareillée, posé sur de grandes dalles, ambiance cour élégante. Matériaux crédibles, ombres naturelles.",
        th: '<svg viewBox="0 0 200 58" preserveAspectRatio="none"><rect width="200" height="42" fill="#d6ccbb"/><rect y="42" width="200" height="16" fill="#cfd3d6"/><g stroke="#c2b6a2" stroke-width="2"><line x1="0" y1="16" x2="200" y2="16"/><line x1="0" y1="30" x2="200" y2="30"/><line x1="60" y1="2" x2="60" y2="16"/><line x1="130" y1="16" x2="130" y2="30"/></g></svg>',
      },
      {
        id: 'bois',
        nm: 'Terrasse bois',
        tg: 'bardage · lames chaudes',
        desc: "Photographie d'un cache climatisation contre un bardage bois chaleureux, posé sur une terrasse en lames de bois, ambiance jardin contemporain. Matériaux crédibles, ombres douces.",
        th: '<svg viewBox="0 0 200 58" preserveAspectRatio="none"><rect width="200" height="42" fill="#caa87b"/><rect y="42" width="200" height="16" fill="#b98f5e"/><g stroke="#b08a5c" stroke-width="1"><line x1="0" y1="12" x2="200" y2="12"/><line x1="0" y1="26" x2="200" y2="26"/></g></svg>',
      },
    ],
    df: [
      {
        id: 'lieu',
        lbl: 'Le lieu',
        opts: [
          ['jardin', 'Jardin de maison'],
          ['terrasse', 'Terrasse'],
          ['cour', 'Cour intérieure'],
          ['balcon', 'Grand balcon'],
        ],
      },
      {
        id: 'support',
        lbl: 'Le mur derrière',
        opts: [
          ['crepi', 'Crépi clair'],
          ['pierre', 'Pierre naturelle'],
          ['bois', 'Bardage bois'],
          ['brique', 'Brique'],
        ],
      },
      {
        id: 'sol',
        lbl: 'Le sol',
        opts: [
          ['gravier', 'Lit de gravier'],
          ['dalles', 'Dalles claires'],
          ['bois', 'Terrasse bois'],
          ['gazon', 'Gazon'],
        ],
      },
      {
        id: 'fond',
        lbl: 'Autour',
        opts: [
          ['fenetre', 'Une fenêtre à côté'],
          ['plantes', 'Des plantes en pot'],
          ['descente', 'Descente de gouttière'],
          ['rien', 'Mur nu, épuré'],
        ],
      },
      {
        id: 'amb',
        lbl: "L'ambiance",
        opts: [
          ['soignee', 'Soignée'],
          ['naturelle', 'Naturelle'],
          ['contemporaine', 'Contemporaine'],
        ],
      },
    ],
    dfTxt: {
      lieu: {
        jardin: 'dans un jardin de maison',
        terrasse: 'sur une terrasse',
        cour: 'dans une cour intérieure',
        balcon: 'sur un grand balcon',
      },
      support: {
        crepi: 'contre un mur au crépi clair et net',
        pierre: 'contre un mur en pierre naturelle',
        bois: 'contre un bardage bois chaleureux',
        brique: 'contre un mur de brique',
      },
      sol: {
        gravier: 'posé sur un lit de gravier',
        dalles: 'posé sur de grandes dalles claires',
        bois: 'posé sur une terrasse en bois',
        gazon: 'posé en bord de gazon',
      },
      fond: {
        fenetre: 'une fenêtre à proximité',
        plantes: 'des plantes en pot autour',
        descente: 'une descente de gouttière discrète',
        rien: 'un mur nu et épuré',
      },
      amb: {
        soignee: 'soignée et résidentielle',
        naturelle: 'naturelle et végétale',
        contemporaine: 'contemporaine et graphique',
      },
    },
    sentence: (t) =>
      `Photographie d'un cache climatisation ${t.lieu}, ${t.support}, ${t.sol}, avec ${t.fond}. Ambiance ${t.amb}, style photographie d’extérieur haut de gamme, matériaux crédibles, ombres naturelles.`,
    plus: [
      { id: 'vege', lbl: 'Massif au pied', txt: 'massif végétal au pied du cache', ic: ICONS.vege },
      { id: 'lamp', lbl: 'Applique murale', txt: 'applique murale extérieure', ic: ICONS.lamp },
      { id: 'pot', lbl: 'Grande jardinière', txt: 'grande jardinière à côté', ic: ICONS.pot },
      { id: 'galet', lbl: 'Galets au sol', txt: 'lit de galets décoratifs au pied', ic: ICONS.galet },
      { id: 'grimp', lbl: 'Plante grimpante', txt: 'plante grimpante sur le mur', ic: ICONS.grimp },
    ],
  },
}

// Vignettes partagées des décors de profils (SVG courts, langage maquette v11).
const TH = {
  terrasse:
    '<svg viewBox="0 0 200 58" preserveAspectRatio="none"><rect width="200" height="40" fill="#9ec7e8"/><rect y="40" width="200" height="18" fill="#c9a06a"/><g stroke="#b08a5c" stroke-width="1.5"><line x1="0" y1="46" x2="200" y2="46"/><line x1="0" y1="52" x2="200" y2="52"/></g></svg>',
  jardin:
    '<svg viewBox="0 0 200 58" preserveAspectRatio="none"><rect width="200" height="40" fill="#a9cbe3"/><rect y="40" width="200" height="18" fill="#b9cf9a"/><circle cx="160" cy="26" r="11" fill="#6f8f4f"/><rect x="157" y="32" width="5" height="10" fill="#6e5537"/><ellipse cx="40" cy="40" rx="30" ry="6" fill="#7a9a5a"/></svg>',
  piscine:
    '<svg viewBox="0 0 200 58" preserveAspectRatio="none"><rect width="200" height="34" fill="#9ec7e8"/><rect y="34" width="200" height="10" fill="#e8e2d0"/><rect y="44" width="200" height="14" fill="#7fc3d8"/></svg>',
  crepi:
    '<svg viewBox="0 0 200 58" preserveAspectRatio="none"><rect width="200" height="42" fill="#efe6d5"/><rect y="42" width="200" height="16" fill="#ddd5c0"/><rect x="130" y="10" width="34" height="26" fill="#9fb4c4"/></svg>',
  pierre:
    '<svg viewBox="0 0 200 58" preserveAspectRatio="none"><rect width="200" height="42" fill="#d6ccbb"/><rect y="42" width="200" height="16" fill="#cfd3d6"/><g stroke="#c2b6a2" stroke-width="2"><line x1="0" y1="16" x2="200" y2="16"/><line x1="0" y1="30" x2="200" y2="30"/><line x1="60" y1="2" x2="60" y2="16"/><line x1="130" y1="16" x2="130" y2="30"/></g></svg>',
  moderne:
    '<svg viewBox="0 0 200 58" preserveAspectRatio="none"><rect width="200" height="40" fill="#b8cede"/><rect y="40" width="200" height="18" fill="#cfd3d6"/><rect x="58" y="26" width="84" height="14" fill="#f4f5f6"/><rect x="58" y="24" width="84" height="4" fill="#7d858d"/><rect x="66" y="30" width="68" height="6" fill="#9fb4c4"/></svg>',
  campagne:
    '<svg viewBox="0 0 200 58" preserveAspectRatio="none"><rect width="200" height="40" fill="#a9cbe3"/><rect y="40" width="200" height="18" fill="#d9cfae"/><ellipse cx="50" cy="40" rx="36" ry="7" fill="#7a9a5a"/><ellipse cx="150" cy="40" rx="36" ry="7" fill="#7a9a5a"/><circle cx="164" cy="24" r="11" fill="#6f8f4f"/><rect x="161" y="30" width="5" height="12" fill="#6e5537"/></svg>',
}

const AMB_TXT = {
  elegante: 'élégante et haut de gamme',
  chaleureuse: 'chaleureuse et accueillante',
  epuree: 'épurée et contemporaine',
  naturelle: 'naturelle et végétale',
  mediterraneenne: 'méditerranéenne et lumineuse',
}
const AMB_OPTS: [string, string][] = [
  ['elegante', 'Élégante'],
  ['chaleureuse', 'Chaleureuse'],
  ['epuree', 'Épurée'],
  ['naturelle', 'Naturelle'],
  ['mediterraneenne', 'Méditerranéenne'],
]
const SOL_EXT_OPTS: [string, string][] = [
  ['bois', 'Terrasse bois'],
  ['dalles', 'Dalles claires'],
  ['gravier', 'Gravier clair'],
  ['gazon', 'Gazon'],
]
const SOL_EXT_TXT = {
  bois: 'sur une terrasse en lames de bois',
  dalles: 'sur de grandes dalles claires',
  gravier: 'sur un lit de gravier clair',
  gazon: 'en bord de gazon soigné',
}

/* Profils des autres typologies (28/07/2026) — contenu ADAPTÉ par produit
   (règle « moteur = contenu adapté », jamais de clone). À terme : générés par
   famille et stockés en base, éditables en Admin. L'aperçu reste une des deux
   scènes illustratives (portail = extérieur/entrée, clim = mur/terrasse). */
Object.assign(PROFILES, {
  pergola: {
    label: 'Pergola',
    scene: 'clim',
    typoTxt: 'Pergola aluminium à lames orientables',
    decors: [
      { id: 'p-terrasse', sceneDecor: 'bois', nm: 'Terrasse contemporaine', tg: 'bois · façade épurée', th: TH.terrasse, desc: "Photographie d'une pergola installée sur une terrasse en lames de bois, adossée à une façade contemporaine épurée, grandes baies vitrées en arrière-plan. Photo haut de gamme, matériaux crédibles, ombres naturelles." },
      { id: 'p-patio', sceneDecor: 'pierre', nm: 'Patio méditerranéen', tg: 'pierre · oliviers', th: TH.pierre, desc: "Photographie d'une pergola dans un patio méditerranéen, murs en pierre claire, oliviers en pot, sol en dalles chaudes. Lumière du sud, matériaux crédibles, ombres naturelles." },
      { id: 'p-piscine', sceneDecor: 'crepi', nm: 'Bord de piscine', tg: 'eau · transats', th: TH.piscine, desc: "Photographie d'une pergola en bord de piscine, margelle claire, eau turquoise, végétation généreuse en fond. Ambiance vacances haut de gamme, matériaux crédibles." },
    ],
    df: [
      { id: 'lieu', lbl: 'Le lieu', opts: [['terrasse', 'Terrasse attenante'], ['jardin', 'Fond de jardin'], ['piscine', 'Bord de piscine'], ['patio', 'Patio clos']] },
      { id: 'pose', lbl: 'La pose', opts: [['adossee', 'Adossée à la façade'], ['autoportee', 'Autoportée']] },
      { id: 'sol', lbl: 'Le sol', opts: SOL_EXT_OPTS },
      { id: 'amb', lbl: "L'ambiance", opts: AMB_OPTS },
    ],
    dfTxt: {
      lieu: { terrasse: 'sur une terrasse attenante à la maison', jardin: 'au fond du jardin', piscine: 'en bord de piscine', patio: 'dans un patio clos' },
      pose: { adossee: 'adossée à la façade', autoportee: 'autoportée' },
      sol: SOL_EXT_TXT,
      amb: AMB_TXT,
    },
    sentence: (t: Record<string, string>) =>
      `Photographie d'une pergola ${t.pose}, ${t.lieu}, ${t.sol}. Ambiance ${t.amb}, style photographie d'architecture extérieure, matériaux crédibles, ombres naturelles.`,
    plus: [
      { id: 'vege', lbl: 'Végétation généreuse', txt: 'végétation généreuse autour', ic: ICONS.vege },
      { id: 'pot', lbl: 'Grands pots', txt: 'grands pots de plantes sous la pergola', ic: ICONS.pot },
      { id: 'lamp', lbl: 'Éclairage intégré', txt: 'éclairage extérieur chaleureux', ic: ICONS.lamp },
      { id: 'grimp', lbl: 'Plante grimpante', txt: 'plante grimpante sur un montant', ic: ICONS.grimp },
    ],
  },
  carport: {
    label: 'Carport',
    scene: 'portail',
    typoTxt: 'Carport aluminium à toit plat',
    decors: [
      { id: 'c-residentiel', sceneDecor: 'tuffeau', nm: 'Allée résidentielle', tg: 'maison · gravier', th: TH.crepi, desc: "Photographie d'un carport en bord d'allée résidentielle, maison enduite claire en arrière-plan, allée en gravier stabilisé. Photo haut de gamme, matériaux crédibles, ombres naturelles." },
      { id: 'c-moderne', sceneDecor: 'moderne', nm: 'Entrée moderne', tg: 'béton · lignes nettes', th: TH.moderne, desc: "Photographie d'un carport contre une maison cubique contemporaine, sol en béton désactivé, haies basses taillées. Lignes nettes, matériaux crédibles." },
      { id: 'c-campagne', sceneDecor: 'campagne', nm: 'Maison de campagne', tg: 'verdure · chemin', th: TH.campagne, desc: "Photographie d'un carport près d'une maison de campagne, chemin de terre clair, grands arbres et haies champêtres. Ambiance naturelle, ombres douces." },
    ],
    df: [
      { id: 'lieu', lbl: 'Le lieu', opts: [['entree', "En entrée de propriété"], ['pignon', 'Contre le pignon de la maison'], ['jardin', 'En bord de jardin']] },
      { id: 'maison', lbl: 'La maison', opts: [['contemp', 'Contemporaine'], ['trad', 'Traditionnelle'], ['aucune', 'Pas de maison visible']] },
      { id: 'sol', lbl: 'Le sol', opts: [['enrobe', 'Enrobé propre'], ['gravier', 'Gravier stabilisé'], ['paves', 'Pavés'], ['beton', 'Béton désactivé']] },
      { id: 'amb', lbl: "L'ambiance", opts: AMB_OPTS },
    ],
    dfTxt: {
      lieu: { entree: "en entrée de propriété", pignon: 'contre le pignon de la maison', jardin: 'en bord de jardin' },
      maison: { contemp: 'Maison contemporaine en arrière-plan.', trad: 'Maison traditionnelle en arrière-plan.', aucune: 'Aucune maison visible.' },
      sol: { enrobe: 'sol en enrobé propre', gravier: 'sol en gravier stabilisé', paves: 'sol en pavés', beton: 'sol en béton désactivé' },
      amb: AMB_TXT,
    },
    sentence: (t: Record<string, string>) =>
      `Photographie d'un carport ${t.lieu}, ${t.sol}. ${t.maison} Ambiance ${t.amb}, style photographie d'architecture extérieure, matériaux crédibles, ombres naturelles.`,
    plus: [
      { id: 'voiture', lbl: 'Voiture abritée', txt: 'voiture premium garée dessous', ic: ICONS.voiture },
      { id: 'vege', lbl: 'Végétation', txt: 'végétation généreuse autour', ic: ICONS.vege },
      { id: 'lamp', lbl: 'Éclairage', txt: 'éclairage extérieur', ic: ICONS.lamp },
      { id: 'borne', lbl: "Bornes d'allée", txt: "bornes lumineuses le long de l'allée", ic: ICONS.borne },
    ],
  },
  abri: {
    label: 'Abri de jardin',
    scene: 'portail',
    typoTxt: 'Abri de jardin métallique',
    decors: [
      { id: 'a-fond', sceneDecor: 'campagne', nm: 'Fond de jardin', tg: 'pelouse · arbres', th: TH.jardin, desc: "Photographie d'un abri de jardin au fond d'une pelouse arborée, haie en limite de propriété, lumière douce entre les arbres. Matériaux crédibles, ombres naturelles." },
      { id: 'a-potager', sceneDecor: 'campagne', nm: 'Coin potager', tg: 'carrés · outils', th: TH.jardin, desc: "Photographie d'un abri de jardin près d'un potager en carrés surélevés, allée en paillis, ambiance jardin vivant et entretenu. Matériaux crédibles, ombres douces." },
      { id: 'a-terrasse', sceneDecor: 'moderne', nm: 'Jardin contemporain', tg: 'graminées · dalles', th: TH.moderne, desc: "Photographie d'un abri de jardin dans un jardin contemporain, dalles claires, graminées graphiques, clôture épurée. Lignes nettes, matériaux crédibles." },
    ],
    df: [
      { id: 'lieu', lbl: 'Le lieu', opts: [['fond', 'Fond de jardin'], ['potager', 'Près du potager'], ['haie', "Le long d'une haie"]] },
      { id: 'autour', lbl: 'Autour', opts: [['arbres', 'Arbres et pelouse'], ['massifs', 'Massifs fleuris'], ['nu', 'Pelouse dégagée']] },
      { id: 'sol', lbl: 'Le sol devant', opts: [['gazon', 'Gazon'], ['gravier', 'Gravier'], ['dalle', 'Dalle béton'], ['paillis', 'Paillis']] },
      { id: 'amb', lbl: "L'ambiance", opts: AMB_OPTS },
    ],
    dfTxt: {
      lieu: { fond: 'au fond du jardin', potager: 'près du potager', haie: "le long d'une haie" },
      autour: { arbres: 'arbres et pelouse autour', massifs: 'massifs fleuris autour', nu: 'pelouse dégagée autour' },
      sol: { gazon: 'gazon devant la porte', gravier: 'gravier devant la porte', dalle: 'dalle béton devant la porte', paillis: 'paillis devant la porte' },
      amb: AMB_TXT,
    },
    sentence: (t: Record<string, string>) =>
      `Photographie d'un abri de jardin ${t.lieu}, ${t.autour}, ${t.sol}. Ambiance ${t.amb}, style photographie d'extérieur, matériaux crédibles, ombres naturelles.`,
    plus: [
      { id: 'vege', lbl: 'Végétation', txt: 'végétation généreuse autour', ic: ICONS.vege },
      { id: 'pot', lbl: 'Pots de fleurs', txt: "pots de fleurs près de l'entrée", ic: ICONS.pot },
      { id: 'haie', lbl: 'Haie taillée', txt: 'haie taillée en fond', ic: ICONS.haie },
      { id: 'galet', lbl: 'Galets', txt: 'bordure de galets décoratifs', ic: ICONS.galet },
    ],
  },
  cloture: {
    label: 'Clôture',
    scene: 'portail',
    typoTxt: 'Clôture aluminium à lames horizontales',
    decors: [
      { id: 'cl-ville', sceneDecor: 'moderne', nm: 'Jardin de ville', tg: 'net · minéral', th: TH.moderne, desc: "Photographie d'une clôture en limite d'un jardin de ville, maison contemporaine, sol minéral propre, haies basses. Lignes nettes, matériaux crédibles." },
      { id: 'cl-campagne', sceneDecor: 'campagne', nm: 'Campagne', tg: 'haies · verdure', th: TH.campagne, desc: "Photographie d'une clôture en limite de propriété à la campagne, pelouse et haies champêtres, grand arbre. Ambiance naturelle, ombres douces." },
      { id: 'cl-mer', sceneDecor: 'tuffeau', nm: 'Front de mer', tg: 'lumière iodée', th: TH.piscine, desc: "Photographie d'une clôture d'une propriété en bord de mer, végétation littorale, lumière iodée, ciel dégagé. Matériaux crédibles, ombres naturelles." },
    ],
    df: [
      { id: 'lieu', lbl: 'Le lieu', opts: [['ville', 'Jardin de ville'], ['campagne', 'Campagne'], ['lotissement', 'Lotissement'], ['mer', 'Bord de mer']] },
      { id: 'support', lbl: 'La pose', opts: [['poteaux', 'Sur poteaux aluminium'], ['muret', 'Sur muret enduit'], ['pierre', 'Sur muret de pierre']] },
      { id: 'sol', lbl: 'Au pied', opts: [['gazon', 'Gazon'], ['gravier', 'Gravier'], ['paillis', 'Paillis et massifs']] },
      { id: 'amb', lbl: "L'ambiance", opts: AMB_OPTS },
    ],
    dfTxt: {
      lieu: { ville: "en limite d'un jardin de ville", campagne: 'en limite de propriété à la campagne', lotissement: 'dans un lotissement récent', mer: "d'une propriété en bord de mer" },
      support: { poteaux: 'posée sur poteaux aluminium', muret: 'posée sur un muret enduit', pierre: 'posée sur un muret de pierre' },
      sol: { gazon: 'gazon au pied', gravier: 'gravier au pied', paillis: 'paillis et massifs au pied' },
      amb: AMB_TXT,
    },
    sentence: (t: Record<string, string>) =>
      `Photographie d'une clôture ${t.lieu}, ${t.support}, ${t.sol}. Ambiance ${t.amb}, style photographie d'extérieur, matériaux crédibles, ombres naturelles.`,
    plus: [
      { id: 'vege', lbl: 'Végétation', txt: 'végétation généreuse au pied', ic: ICONS.vege },
      { id: 'haie', lbl: 'Haie doublée', txt: 'haie taillée doublant la clôture', ic: ICONS.haie },
      { id: 'lamp', lbl: 'Éclairage', txt: 'éclairage extérieur', ic: ICONS.lamp },
      { id: 'mail', lbl: 'Boîte aux lettres', txt: 'boîte aux lettres en limite', ic: ICONS.mail },
    ],
  },
  brisevue: {
    label: 'Brise-vue',
    scene: 'clim',
    typoTxt: 'Brise-vue aluminium décoratif',
    decors: [
      { id: 'b-terrasse', sceneDecor: 'bois', nm: 'Terrasse cosy', tg: 'bois · intimité', th: TH.terrasse, desc: "Photographie d'un brise-vue posé en bord de terrasse bois, coin détente intime, végétation en pot. Lumière douce, matériaux crédibles." },
      { id: 'b-zen', sceneDecor: 'pierre', nm: 'Jardin zen', tg: 'galets · graminées', th: TH.pierre, desc: "Photographie d'un brise-vue dans un jardin zen, galets clairs, graminées graphiques, lignes calmes. Ambiance épurée, ombres naturelles." },
      { id: 'b-spa', sceneDecor: 'crepi', nm: 'Coin spa', tg: 'détente · lumière', th: TH.piscine, desc: "Photographie d'un brise-vue abritant un coin spa extérieur, sol en dalles, ambiance détente haut de gamme. Matériaux crédibles, lumière chaleureuse." },
    ],
    df: [
      { id: 'lieu', lbl: 'Le lieu', opts: [['terrasse', 'Bord de terrasse'], ['jardin', 'Dans le jardin'], ['spa', 'Autour du spa'], ['balcon', 'Sur un balcon']] },
      { id: 'role', lbl: 'Il protège de', opts: [['visavis', 'Un vis-à-vis'], ['mur', 'Un mur mitoyen'], ['vent', 'Du vent']] },
      { id: 'sol', lbl: 'Le sol', opts: SOL_EXT_OPTS },
      { id: 'amb', lbl: "L'ambiance", opts: AMB_OPTS },
    ],
    dfTxt: {
      lieu: { terrasse: 'en bord de terrasse', jardin: 'dans le jardin', spa: 'autour du spa', balcon: 'sur un balcon' },
      role: { visavis: 'préservant du vis-à-vis', mur: 'habillant un mur mitoyen', vent: 'protégeant du vent' },
      sol: SOL_EXT_TXT,
      amb: AMB_TXT,
    },
    sentence: (t: Record<string, string>) =>
      `Photographie d'un brise-vue ${t.lieu}, ${t.role}, ${t.sol}. Ambiance ${t.amb}, style photographie d'extérieur, matériaux crédibles, ombres naturelles.`,
    plus: [
      { id: 'vege', lbl: 'Végétation', txt: 'végétation généreuse au pied', ic: ICONS.vege },
      { id: 'pot', lbl: 'Grands pots', txt: 'grands pots de plantes devant', ic: ICONS.pot },
      { id: 'grimp', lbl: 'Plante grimpante', txt: 'plante grimpante sur un panneau', ic: ICONS.grimp },
      { id: 'galet', lbl: 'Galets', txt: 'lit de galets décoratifs au pied', ic: ICONS.galet },
    ],
  },
  gardecorps: {
    label: 'Garde-corps',
    scene: 'clim',
    typoTxt: 'Garde-corps aluminium et verre',
    decors: [
      { id: 'g-balcon', sceneDecor: 'crepi', nm: 'Balcon contemporain', tg: 'façade claire', th: TH.crepi, desc: "Photographie d'un garde-corps sur un balcon contemporain, façade enduite claire, vue dégagée. Lignes nettes, matériaux crédibles, ombres naturelles." },
      { id: 'g-terrasse', sceneDecor: 'bois', nm: "Terrasse à l'étage", tg: 'bois · jardin', th: TH.terrasse, desc: "Photographie d'un garde-corps bordant une terrasse en bois à l'étage, jardin arboré en contrebas. Lumière douce, matériaux crédibles." },
      { id: 'g-mer', sceneDecor: 'pierre', nm: 'Vue mer', tg: 'horizon · lumière', th: TH.piscine, desc: "Photographie d'un garde-corps face à la mer, horizon dégagé, lumière iodée, façade en pierre claire. Ambiance haut de gamme, matériaux crédibles." },
    ],
    df: [
      { id: 'lieu', lbl: 'Le lieu', opts: [['balcon', 'Balcon'], ['terrasse', "Terrasse à l'étage"], ['escalier', 'Escalier extérieur']] },
      { id: 'facade', lbl: 'La façade', opts: [['crepi', 'Crépi clair'], ['pierre', 'Pierre'], ['bois', 'Bardage bois']] },
      { id: 'vue', lbl: 'La vue', opts: [['jardin', 'Sur le jardin'], ['mer', 'Sur la mer'], ['ville', 'Sur les toits']] },
      { id: 'amb', lbl: "L'ambiance", opts: AMB_OPTS },
    ],
    dfTxt: {
      lieu: { balcon: 'sur un balcon', terrasse: "sur une terrasse à l'étage", escalier: "le long d'un escalier extérieur" },
      facade: { crepi: 'façade au crépi clair', pierre: 'façade en pierre', bois: 'façade en bardage bois' },
      vue: { jardin: 'vue sur le jardin arboré', mer: 'vue sur la mer', ville: 'vue sur les toits' },
      amb: AMB_TXT,
    },
    sentence: (t: Record<string, string>) =>
      `Photographie d'un garde-corps ${t.lieu}, ${t.facade}, ${t.vue}. Ambiance ${t.amb}, style photographie d'architecture, matériaux crédibles, ombres naturelles.`,
    plus: [
      { id: 'pot', lbl: 'Jardinières', txt: 'jardinières fleuries le long', ic: ICONS.pot },
      { id: 'lamp', lbl: 'Applique', txt: 'applique murale extérieure', ic: ICONS.lamp },
      { id: 'grimp', lbl: 'Plante grimpante', txt: 'plante grimpante sur la façade', ic: ICONS.grimp },
    ],
  },
  claustra: {
    label: 'Claustra',
    scene: 'clim',
    typoTxt: 'Claustra aluminium ajouré',
    decors: [
      { id: 'cla-terrasse', sceneDecor: 'bois', nm: 'Terrasse graphique', tg: 'jeux d’ombres', th: TH.terrasse, desc: "Photographie d'un claustra structurant une terrasse bois, jeux d'ombres graphiques au sol, mobilier discret hors champ. Lignes nettes, matériaux crédibles." },
      { id: 'cla-jardin', sceneDecor: 'pierre', nm: 'Jardin contemporain', tg: 'graminées · dalles', th: TH.pierre, desc: "Photographie d'un claustra dans un jardin contemporain, graminées, dalles claires, lumière traversante. Ambiance épurée, ombres naturelles." },
      { id: 'cla-patio', sceneDecor: 'crepi', nm: 'Patio', tg: 'clos · lumineux', th: TH.crepi, desc: "Photographie d'un claustra délimitant un patio lumineux, murs clairs, végétation en pot. Matériaux crédibles, lumière douce." },
    ],
    df: [
      { id: 'lieu', lbl: 'Le lieu', opts: [['terrasse', 'Sur la terrasse'], ['jardin', 'Dans le jardin'], ['patio', 'Dans un patio']] },
      { id: 'role', lbl: 'Son rôle', opts: [['delimiter', "Délimiter l'espace"], ['filtrer', 'Filtrer la lumière'], ['habiller', 'Habiller un mur']] },
      { id: 'sol', lbl: 'Le sol', opts: SOL_EXT_OPTS },
      { id: 'amb', lbl: "L'ambiance", opts: AMB_OPTS },
    ],
    dfTxt: {
      lieu: { terrasse: 'sur la terrasse', jardin: 'dans le jardin', patio: 'dans un patio' },
      role: { delimiter: "délimitant l'espace", filtrer: 'filtrant la lumière en ombres graphiques', habiller: 'habillant un mur' },
      sol: SOL_EXT_TXT,
      amb: AMB_TXT,
    },
    sentence: (t: Record<string, string>) =>
      `Photographie d'un claustra ${t.lieu}, ${t.role}, ${t.sol}. Ambiance ${t.amb}, style photographie d'extérieur, matériaux crédibles, ombres naturelles.`,
    plus: [
      { id: 'vege', lbl: 'Végétation', txt: 'végétation généreuse autour', ic: ICONS.vege },
      { id: 'pot', lbl: 'Grands pots', txt: 'grands pots de plantes devant', ic: ICONS.pot },
      { id: 'grimp', lbl: 'Plante grimpante', txt: 'plante grimpante sur le claustra', ic: ICONS.grimp },
      { id: 'lamp', lbl: 'Éclairage', txt: 'éclairage extérieur rasant', ic: ICONS.lamp },
    ],
  },
  volet: {
    label: 'Volet battant',
    scene: 'clim',
    typoTxt: 'Volet battant aluminium',
    decors: [
      { id: 'v-provence', sceneDecor: 'crepi', nm: 'Façade provençale', tg: 'crépi · lumière du sud', th: TH.crepi, desc: "Photographie de volets battants sur une façade provençale au crépi clair, fenêtre à encadrement, lumière du sud. Matériaux crédibles, ombres naturelles." },
      { id: 'v-pierre', sceneDecor: 'pierre', nm: 'Maison en pierre', tg: 'encadrements taillés', th: TH.pierre, desc: "Photographie de volets battants sur une façade en pierre appareillée, encadrements taillés, charme authentique. Matériaux crédibles, ombres douces." },
      { id: 'v-longere', sceneDecor: 'bois', nm: 'Longère', tg: 'campagne · glycine', th: TH.campagne, desc: "Photographie de volets battants sur une longère rénovée, végétation grimpante, cour en gravier. Ambiance campagne élégante, ombres naturelles." },
    ],
    df: [
      { id: 'facade', lbl: 'La façade', opts: [['crepi', 'Crépi clair'], ['pierre', 'Pierre'], ['brique', 'Brique'], ['bois', 'Bardage bois']] },
      { id: 'fenetre', lbl: "L'ouverture", opts: [['fenetre', 'Fenêtre'], ['grande', 'Grande fenêtre'], ['pfenetre', 'Porte-fenêtre']] },
      { id: 'autour', lbl: 'Autour', opts: [['jardiniere', 'Jardinière fleurie'], ['grimpante', 'Plante grimpante'], ['nu', 'Façade nue']] },
      { id: 'amb', lbl: "L'ambiance", opts: AMB_OPTS },
    ],
    dfTxt: {
      facade: { crepi: 'sur une façade au crépi clair', pierre: 'sur une façade en pierre appareillée', brique: 'sur une façade en brique', bois: 'sur un bardage bois' },
      fenetre: { fenetre: 'encadrant une fenêtre', grande: 'encadrant une grande fenêtre', pfenetre: 'encadrant une porte-fenêtre' },
      autour: { jardiniere: 'jardinière fleurie en appui', grimpante: 'plante grimpante sur la façade', nu: 'façade nue et propre' },
      amb: AMB_TXT,
    },
    sentence: (t: Record<string, string>) =>
      `Photographie de volets battants ${t.facade}, ${t.fenetre}, ${t.autour}. Ambiance ${t.amb}, style photographie d'architecture, matériaux crédibles, ombres naturelles.`,
    plus: [
      { id: 'pot', lbl: 'Jardinière', txt: 'jardinière fleurie en appui de fenêtre', ic: ICONS.pot },
      { id: 'lamp', lbl: 'Applique', txt: 'applique murale à côté', ic: ICONS.lamp },
      { id: 'grimp', lbl: 'Grimpante', txt: 'plante grimpante sur la façade', ic: ICONS.grimp },
    ],
  },
  table: {
    label: 'Table de jardin',
    scene: 'clim',
    typoTxt: 'Table de jardin aluminium',
    decors: [
      { id: 't-terrasse', sceneDecor: 'bois', nm: "Terrasse d'été", tg: 'bois · lumière douce', th: TH.terrasse, desc: "Photographie d'une table de jardin dressée sobrement sur une terrasse en bois, lumière de fin de journée, végétation en pot. Ambiance conviviale haut de gamme, matériaux crédibles." },
      { id: 't-med', sceneDecor: 'pierre', nm: 'Jardin méditerranéen', tg: 'oliviers · pierre', th: TH.pierre, desc: "Photographie d'une table de jardin sous un olivier, sol en pierre claire, ambiance méditerranéenne. Lumière chaude, matériaux crédibles." },
      { id: 't-pelouse', sceneDecor: 'crepi', nm: 'Pelouse', tg: 'gazon · arbres', th: TH.jardin, desc: "Photographie d'une table de jardin sur un gazon soigné, arbres en fond, lumière d'été. Ambiance naturelle, ombres douces." },
    ],
    df: [
      { id: 'lieu', lbl: 'Le lieu', opts: [['terrasse', 'Sur la terrasse'], ['pelouse', 'Sur la pelouse'], ['piscine', 'Près de la piscine'], ['patio', 'Dans un patio']] },
      { id: 'fond', lbl: 'En fond', opts: [['facade', 'La façade de la maison'], ['jardin', 'Le jardin arboré'], ['haie', 'Une haie']] },
      { id: 'sol', lbl: 'Le sol', opts: SOL_EXT_OPTS },
      { id: 'amb', lbl: "L'ambiance", opts: AMB_OPTS },
    ],
    dfTxt: {
      lieu: { terrasse: 'sur la terrasse', pelouse: 'sur la pelouse', piscine: 'près de la piscine', patio: 'dans un patio' },
      fond: { facade: 'façade de la maison en fond', jardin: 'jardin arboré en fond', haie: 'haie taillée en fond' },
      sol: SOL_EXT_TXT,
      amb: AMB_TXT,
    },
    sentence: (t: Record<string, string>) =>
      `Photographie d'une table de jardin ${t.lieu}, ${t.sol}, ${t.fond}. Ambiance ${t.amb}, style photographie lifestyle extérieure, matériaux crédibles, ombres naturelles.`,
    plus: [
      { id: 'pot', lbl: 'Plantes en pot', txt: 'plantes en pot autour', ic: ICONS.pot },
      { id: 'vege', lbl: 'Végétation', txt: 'végétation généreuse en fond', ic: ICONS.vege },
      { id: 'lamp', lbl: 'Éclairage', txt: 'éclairage extérieur chaleureux', ic: ICONS.lamp },
      { id: 'galet', lbl: 'Galets', txt: 'bordure de galets décoratifs', ic: ICONS.galet },
    ],
  },
  canape: {
    label: 'Canapé de jardin',
    scene: 'clim',
    typoTxt: 'Canapé de jardin en résine tressée',
    decors: [
      { id: 'ca-lounge', sceneDecor: 'bois', nm: 'Salon de terrasse', tg: 'bois · cosy', th: TH.terrasse, desc: "Photographie d'un canapé de jardin sur une terrasse en bois, coin lounge cosy, lumière douce de fin de journée. Ambiance détente haut de gamme, matériaux crédibles." },
      { id: 'ca-piscine', sceneDecor: 'crepi', nm: 'Coin piscine', tg: 'eau · transats', th: TH.piscine, desc: "Photographie d'un canapé de jardin près d'une piscine, margelle claire, eau turquoise, végétation en fond. Ambiance vacances, matériaux crédibles." },
      { id: 'ca-jardin', sceneDecor: 'pierre', nm: 'Jardin lounge', tg: 'graminées · pierre', th: TH.pierre, desc: "Photographie d'un canapé de jardin dans un coin de jardin aménagé, graminées, sol en pierre claire. Ambiance épurée, ombres naturelles." },
    ],
    df: [
      { id: 'lieu', lbl: 'Le lieu', opts: [['terrasse', 'Sur la terrasse'], ['piscine', 'Près de la piscine'], ['jardin', 'Coin de jardin'], ['patio', 'Dans un patio']] },
      { id: 'fond', lbl: 'En fond', opts: [['facade', 'La façade'], ['jardin', 'Le jardin arboré'], ['brise', 'Un mur végétal']] },
      { id: 'sol', lbl: 'Le sol', opts: SOL_EXT_OPTS },
      { id: 'amb', lbl: "L'ambiance", opts: AMB_OPTS },
    ],
    dfTxt: {
      lieu: { terrasse: 'sur la terrasse', piscine: 'près de la piscine', jardin: 'dans un coin de jardin aménagé', patio: 'dans un patio' },
      fond: { facade: 'façade de la maison en fond', jardin: 'jardin arboré en fond', brise: 'mur végétal en fond' },
      sol: SOL_EXT_TXT,
      amb: AMB_TXT,
    },
    sentence: (t: Record<string, string>) =>
      `Photographie d'un canapé de jardin ${t.lieu}, ${t.sol}, ${t.fond}. Ambiance ${t.amb}, style photographie lifestyle extérieure, matériaux crédibles, ombres naturelles.`,
    plus: [
      { id: 'pot', lbl: 'Plantes en pot', txt: 'plantes en pot autour', ic: ICONS.pot },
      { id: 'vege', lbl: 'Végétation', txt: 'végétation généreuse en fond', ic: ICONS.vege },
      { id: 'lamp', lbl: 'Éclairage', txt: 'guirlande et éclairage chaleureux', ic: ICONS.lamp },
      { id: 'grimp', lbl: 'Grimpante', txt: 'plante grimpante sur le mur', ic: ICONS.grimp },
    ],
  },
} satisfies Record<string, Profil>)

/** Libellé produit + typo par carte (les 3 portails partagent le profil portail). */
const TYPO_TXT: Record<Exclude<TypoKey, 'autre'>, string> = {
  battant: 'Portail acier avec chapeau de gendarme',
  coulissant: 'Portail coulissant acier',
  portillon: 'Portillon acier',
  clim: 'Cache climatisation aluminium, lames horizontales',
}

/**
 * Détection de la typologie depuis le NOM du fichier déposé — gratuite et
 * instantanée : mots-clés, puis nomenclature 300B140 / 300C140 / 100P140.
 * En dernier recours, l'image part à /api/generation/libre/detect (vision).
 */
const TYPO_KEYWORDS: [RegExp, string][] = [
  [/pergola/, 'pergola'],
  [/carport/, 'carport'],
  [/abri/, 'abri'],
  [/cl[oô]tur/, 'cloture'],
  [/brise[-_ ]?vue/, 'brisevue'],
  [/garde[-_ ]?corps/, 'gardecorps'],
  [/claustra/, 'claustra'],
  [/volet/, 'volet'],
  [/table/, 'table'],
  [/canap|sofa/, 'canape'],
  [/clim/, 'clim'],
  [/portillon/, 'portillon'],
  [/coulissant/, 'coulissant'],
  [/battant/, 'battant'],
]

function typoFromFileName(name: string): string | null {
  const n = name.toLowerCase()
  for (const [re, key] of TYPO_KEYWORDS) if (re.test(n)) return key
  const m = /\d{2,3}([bcp])\d{2,3}/i.exec(name)
  if (m) {
    const l = m[1].toLowerCase()
    return l === 'c' ? 'coulissant' : l === 'p' ? 'portillon' : 'battant'
  }
  return null
}

/** Autres typologies (fenêtre de recherche) — chacune avec SON profil de réglages. */
const TYPOS_ALL: { nm: string; marque: string; profil: string }[] = [
  { nm: 'Pergola', marque: 'CAZEBOO', profil: 'pergola' },
  { nm: 'Carport', marque: 'CAZEBOO', profil: 'carport' },
  { nm: 'Abri de jardin', marque: 'CAZEBOO', profil: 'abri' },
  { nm: 'Clôture', marque: 'CASANOOV', profil: 'cloture' },
  { nm: 'Brise-vue', marque: 'CASANOOV', profil: 'brisevue' },
  { nm: 'Garde-corps', marque: 'CASANOOV', profil: 'gardecorps' },
  { nm: 'Claustra', marque: 'CASANOOV', profil: 'claustra' },
  { nm: 'Volet battant', marque: 'CASANOOV', profil: 'volet' },
  { nm: 'Table de jardin', marque: 'SICANN', profil: 'table' },
  { nm: 'Canapé de jardin', marque: 'SICANN', profil: 'canape' },
]

// —————————————————————————————————————————————— réglages communs (choix visuels)

interface Choice {
  id: string
  nm: string
  tg: string
  th: string
}

const SAISONS: Choice[] = [
  { id: 'printemps', nm: 'Printemps', tg: 'frais, fleuri', th: '<svg viewBox="0 0 200 58" preserveAspectRatio="none"><rect width="200" height="42" fill="#b8d8ec"/><rect y="42" width="200" height="16" fill="#cfdcb2"/><circle cx="100" cy="25" r="14" fill="#8fb567"/><rect x="97" y="32" width="6" height="12" fill="#6e5537"/><circle cx="92" cy="17" r="3.5" fill="#f2b8cf"/><circle cx="108" cy="21" r="3" fill="#f2b8cf"/></svg>' },
  { id: 'ete', nm: 'Été', tg: 'vert profond', th: '<svg viewBox="0 0 200 58" preserveAspectRatio="none"><rect width="200" height="42" fill="#9ec7e8"/><rect y="42" width="200" height="16" fill="#b9cf9a"/><circle cx="100" cy="25" r="14" fill="#5f7a44"/><rect x="97" y="32" width="6" height="12" fill="#6e5537"/><circle cx="160" cy="13" r="8" fill="#fff6d0"/></svg>' },
  { id: 'automne', nm: 'Automne', tg: 'feuillages chauds', th: '<svg viewBox="0 0 200 58" preserveAspectRatio="none"><rect width="200" height="42" fill="#c9c3b2"/><rect y="42" width="200" height="16" fill="#cbb389"/><circle cx="100" cy="25" r="14" fill="#c08a3e"/><rect x="97" y="32" width="6" height="12" fill="#6e5537"/><circle cx="122" cy="44" r="3" fill="#a06a2c"/></svg>' },
  { id: 'hiver', nm: 'Hiver', tg: 'neige posée', th: '<svg viewBox="0 0 200 58" preserveAspectRatio="none"><rect width="200" height="42" fill="#d4dde3"/><rect y="42" width="200" height="16" fill="#f2f5f7"/><circle cx="100" cy="25" r="14" fill="#ccd6db"/><rect x="97" y="32" width="6" height="12" fill="#7d6a51"/><circle cx="70" cy="15" r="2" fill="#fff"/><circle cx="132" cy="11" r="2" fill="#fff"/></svg>' },
]

const METEOS: Choice[] = [
  { id: 'clair', nm: 'Dégagé', tg: 'grand beau', th: '<svg viewBox="0 0 200 58" preserveAspectRatio="none"><rect width="200" height="58" fill="#9ec7e8"/><circle cx="100" cy="28" r="12" fill="#fff6d0"/></svg>' },
  { id: 'nuage', nm: 'Nuages légers', tg: 'ciel vivant', th: '<svg viewBox="0 0 200 58" preserveAspectRatio="none"><rect width="200" height="58" fill="#a7c9e4"/><ellipse cx="70" cy="22" rx="28" ry="9" fill="#fff" opacity=".9"/><ellipse cx="140" cy="35" rx="34" ry="10" fill="#fff" opacity=".75"/></svg>' },
  { id: 'pluie', nm: 'Pluie fine', tg: 'sols mouillés', th: '<svg viewBox="0 0 200 58" preserveAspectRatio="none"><rect width="200" height="58" fill="#93a5b4"/><g stroke="#dfe9f0" stroke-width="2" stroke-linecap="round"><line x1="60" y1="16" x2="52" y2="42"/><line x1="104" y1="10" x2="96" y2="36"/><line x1="148" y1="18" x2="140" y2="44"/></g></svg>' },
  { id: 'brume', nm: 'Brume', tg: "fond qui s'efface", th: '<svg viewBox="0 0 200 58" preserveAspectRatio="none"><rect width="200" height="58" fill="#c3ced6"/><rect y="28" width="200" height="30" fill="#eef1f3" opacity=".85"/><ellipse cx="100" cy="28" rx="55" ry="8" fill="#eef1f3" opacity=".7"/></svg>' },
]

const LIGHTS: Choice[] = [
  { id: 'day', nm: 'Plein jour', tg: 'ombres nettes', th: '<svg viewBox="0 0 200 58" preserveAspectRatio="none"><defs><linearGradient id="mlxlgD" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9ec7e8"/><stop offset="1" stop-color="#e9f4fb"/></linearGradient></defs><rect width="200" height="58" fill="url(#mlxlgD)"/><circle cx="156" cy="16" r="10" fill="#fff6d0"/></svg>' },
  { id: 'gold', nm: 'Fin de journée', tg: 'dorée rasante', th: '<svg viewBox="0 0 200 58" preserveAspectRatio="none"><defs><linearGradient id="mlxlgG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e8a24e"/><stop offset="1" stop-color="#fbe7c4"/></linearGradient></defs><rect width="200" height="58" fill="url(#mlxlgG)"/><circle cx="44" cy="40" r="12" fill="#ffd28c"/></svg>' },
  { id: 'veil', nm: 'Ciel voilé', tg: 'douce, diffuse', th: '<svg viewBox="0 0 200 58" preserveAspectRatio="none"><defs><linearGradient id="mlxlgV" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c3ced6"/><stop offset="1" stop-color="#eef1f3"/></linearGradient></defs><rect width="200" height="58" fill="url(#mlxlgV)"/><ellipse cx="70" cy="16" rx="22" ry="7" fill="#dde4e9"/><ellipse cx="136" cy="28" rx="26" ry="8" fill="#d5dde2"/></svg>' },
  { id: 'nuit', nm: 'Tombée de la nuit', tg: 'les luminaires brillent', th: '<svg viewBox="0 0 200 58" preserveAspectRatio="none"><defs><linearGradient id="mlxlgN" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#25344f"/><stop offset="1" stop-color="#5e7396"/></linearGradient></defs><rect width="200" height="58" fill="url(#mlxlgN)"/><circle cx="152" cy="16" r="8" fill="#e8ecf4"/><circle cx="60" cy="12" r="1.6" fill="#dfe6f2"/></svg>' },
]

const gateGlyph = (transform: string, dot: string) =>
  `<svg viewBox="0 0 200 58"><g ${transform}><rect x="52" y="12" width="8" height="32" fill="#c9bda1"/><rect x="140" y="12" width="8" height="32" fill="#c9bda1"/><path d="M60 20 Q100 12 140 20 L140 44 L60 44 Z" fill="#3a4149"/></g>${dot}</svg>`

const ANGLES: Choice[] = [
  { id: 'face', nm: 'Face', tg: 'frontal, catalogue', th: gateGlyph('', '<circle cx="100" cy="53" r="3.5" fill="#5d9228"/>') },
  { id: 'tq', nm: 'Trois-quarts', tg: 'perspective', th: gateGlyph('transform="translate(100,30) skewY(-6) scale(.92,1) translate(-100,-30)"', '<circle cx="148" cy="53" r="3.5" fill="#5d9228"/>') },
  { id: 'cote', nm: 'De côté', tg: 'fuyante marquée', th: gateGlyph('transform="translate(100,30) skewY(-12) scale(.78,1) translate(-100,-30)"', '<circle cx="172" cy="48" r="3.5" fill="#5d9228"/>') },
]

const cadGlyph = (scale: string) =>
  `<svg viewBox="0 0 200 58" preserveAspectRatio="none"><rect width="200" height="42" fill="#9ec7e8"/><rect y="42" width="200" height="16" fill="#ddd5c0"/><g ${scale}><rect x="52" y="12" width="8" height="32" fill="#c9bda1"/><rect x="140" y="12" width="8" height="32" fill="#c9bda1"/><path d="M60 20 Q100 12 140 20 L140 44 L60 44 Z" fill="#3a4149"/></g></svg>`

const CADRAGES: Choice[] = [
  { id: 'large', nm: 'Plan large', tg: 'ça respire', th: cadGlyph('transform="translate(100,30) scale(.6) translate(-100,-30)"') },
  { id: 'moyen', nm: 'Plan moyen', tg: "l'entrée entière", th: cadGlyph('') },
  { id: 'serre', nm: 'Plan serré', tg: 'le produit domine', th: cadGlyph('transform="translate(100,30) scale(1.5) translate(-100,-30)"') },
]

const HAUTEURS: Choice[] = [
  { id: 'oeil', nm: "Hauteur d'œil", tg: 'naturelle', th: gateGlyph('', '<circle cx="24" cy="28" r="3.5" fill="#5d9228"/>') },
  { id: 'contre', nm: 'Contre-plongée', tg: 'le produit impose', th: gateGlyph('transform="translate(100,31) scale(1,1.16) translate(-100,-31)"', '<circle cx="24" cy="48" r="3.5" fill="#5d9228"/>') },
  { id: 'drone', nm: 'Vue haute', tg: 'drone, on voit le sol', th: gateGlyph('transform="translate(100,35) scale(1,.8) translate(-100,-35)"', '<circle cx="24" cy="10" r="3.5" fill="#5d9228"/>') },
]

const compoGlyph = (x: number, lines: string) =>
  `<svg viewBox="0 0 200 58"><rect x="4" y="4" width="192" height="50" rx="4" fill="#eef1f4"/><rect x="${x}" y="16" width="36" height="24" rx="2" fill="#3a4149"/>${lines}</svg>`

const COMPOS: Choice[] = [
  { id: 'c', nm: 'Centré', tg: 'symétrie', th: compoGlyph(82, '<line x1="100" y1="4" x2="100" y2="54" stroke="#c8d0d8" stroke-dasharray="3 4"/>') },
  { id: 'g', nm: 'Tiers gauche', tg: "l'air à droite", th: compoGlyph(46, '<line x1="68" y1="4" x2="68" y2="54" stroke="#c8d0d8" stroke-dasharray="3 4"/><line x1="132" y1="4" x2="132" y2="54" stroke="#c8d0d8" stroke-dasharray="3 4"/>') },
  { id: 'd', nm: 'Tiers droit', tg: "l'air à gauche", th: compoGlyph(118, '<line x1="68" y1="4" x2="68" y2="54" stroke="#c8d0d8" stroke-dasharray="3 4"/><line x1="132" y1="4" x2="132" y2="54" stroke="#c8d0d8" stroke-dasharray="3 4"/>') },
]

const PDCS: Choice[] = [
  { id: 'a', nm: 'Produit net, fond flou', tg: 'effet portrait', th: '<svg viewBox="0 0 200 58" preserveAspectRatio="none"><defs><filter id="mlxbl"><feGaussianBlur stdDeviation="2.4"/></filter></defs><g filter="url(#mlxbl)"><rect width="200" height="42" fill="#9ec7e8"/><rect y="42" width="200" height="16" fill="#ddd5c0"/><polygon points="52,44 148,44 132,26 68,26" fill="#c8764f"/></g><path d="M64 28 Q100 22 136 28 L136 50 L64 50 Z" fill="#3a4149"/></svg>' },
  { id: 'b', nm: 'Tout net', tg: 'deep focus', th: '<svg viewBox="0 0 200 58" preserveAspectRatio="none"><rect width="200" height="42" fill="#9ec7e8"/><rect y="42" width="200" height="16" fill="#ddd5c0"/><polygon points="52,44 148,44 132,26 68,26" fill="#c8764f"/><path d="M64 28 Q100 22 136 28 L136 50 L64 50 Z" fill="#3a4149"/></svg>' },
]

const NAMES: Record<string, Record<string, string>> = {
  saison: { printemps: 'printemps', ete: 'été', automne: 'automne', hiver: 'hiver' },
  meteo: { clair: 'ciel dégagé', nuage: 'nuages légers', pluie: 'pluie fine', brume: 'brume matinale' },
  light: { day: 'plein jour', gold: 'fin de journée dorée (golden hour)', veil: 'ciel voilé', nuit: 'tombée de la nuit' },
  angle: { face: 'face', tq: 'trois-quarts', cote: 'de côté' },
  cadr: { large: 'plan large', moyen: 'plan moyen', serre: 'plan serré' },
  haut: { oeil: "hauteur d'œil", contre: 'contre-plongée', drone: 'vue haute (drone)' },
  compo: { c: 'centrée', g: 'décalée à gauche (règle des tiers)', d: 'décalée à droite (règle des tiers)' },
  pdc: { a: 'produit net, fond flou (bokeh réaliste)', b: 'tout net (deep focus)' },
}

// —————————————————————————————————————————————— génération : ratios, modèles

const RATIOS: { id: string; nm: string; w: number; lbl: string }[] = [
  { id: 'site', nm: 'Site 2000×1330', w: 24, lbl: 'Site' },
  { id: '1:1', nm: 'carré 1:1', w: 16, lbl: '1:1' },
  { id: '4:5', nm: 'portrait 4:5', w: 13, lbl: '4:5' },
  { id: '16:9', nm: 'panorama 16:9', w: 28, lbl: '16:9' },
]
const RATIO_AR: Record<string, number> = { site: 1.504, '1:1': 1, '4:5': 0.8, '16:9': 1.7778 }

interface Quality {
  id: '1K' | '2K' | '4K'
  lbl: string
  price: number
  time: string
}
const QUALITES: Record<'pro' | 'flash', Quality[]> = {
  pro: [
    { id: '1K', lbl: '1K', price: 0.13, time: '~40 s / image' },
    { id: '2K', lbl: '2K', price: 0.15, time: '~1 min / image' },
    { id: '4K', lbl: '4K', price: 0.24, time: '~2 min / image' },
  ],
  flash: [{ id: '1K', lbl: '1024 px', price: 0.04, time: '~10 s / image' }],
}
const MODEL_LABELS: Record<'pro' | 'flash', string> = {
  pro: 'Nano Banana Pro',
  flash: 'Nano Banana',
}

// —————————————————————————————————————————————— aperçu vivant (SVG maquette v11)

const SCENE_SVG = `<svg viewBox="0 0 900 480" preserveAspectRatio="xMidYMid slice" aria-label="Aperçu d'ambiance">
  <defs>
    <linearGradient id="mlxskyD" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9ec7e8"/><stop offset="1" stop-color="#e9f4fb"/></linearGradient>
    <linearGradient id="mlxskyG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e8a24e"/><stop offset="1" stop-color="#fbe7c4"/></linearGradient>
    <linearGradient id="mlxskyV" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c3ced6"/><stop offset="1" stop-color="#eef1f3"/></linearGradient>
    <linearGradient id="mlxskyN" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#25344f"/><stop offset="1" stop-color="#5e7396"/></linearGradient>
    <linearGradient id="mlxfog" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#eef1f3" stop-opacity="0"/><stop offset="1" stop-color="#eef1f3" stop-opacity=".85"/></linearGradient>
  </defs>
  <g class="fade sky-day"><rect width="900" height="480" fill="url(#mlxskyD)"/><circle cx="740" cy="72" r="30" fill="#fff6d0" opacity=".95"/></g>
  <g class="fade sky-gold"><rect width="900" height="480" fill="url(#mlxskyG)"/><circle cx="170" cy="230" r="42" fill="#ffd28c"/></g>
  <g class="fade sky-veil"><rect width="900" height="480" fill="url(#mlxskyV)"/></g>
  <g class="fade sky-nuit"><rect width="900" height="480" fill="url(#mlxskyN)"/><circle cx="730" cy="80" r="24" fill="#e8ecf4" opacity=".9"/><g fill="#dfe6f2"><circle cx="120" cy="60" r="2"/><circle cx="260" cy="40" r="1.6"/><circle cx="420" cy="70" r="2"/><circle cx="560" cy="36" r="1.6"/><circle cx="830" cy="52" r="2"/></g></g>
  <g class="mlx-vscale">
    <g class="mlx-zoomer">
      <g class="mlx-backdrop">
        <g class="p-portail">
          <g class="fade bd-tuffeau">
            <rect x="308" y="252" width="284" height="93" fill="#f0e7d3"/>
            <polygon points="296,254 604,254 566,214 334,214" fill="#c8764f"/>
            <rect x="352" y="278" width="30" height="38" fill="#8a7f6a"/>
            <rect x="518" y="278" width="30" height="38" fill="#8a7f6a"/>
            <ellipse class="folB" cx="150" cy="290" rx="26" ry="66" fill="#5f7a44"/>
            <ellipse class="folB" cx="760" cy="296" rx="22" ry="56" fill="#5f7a44"/>
            <g class="blos" fill="#f2b8cf"><circle cx="142" cy="252" r="5"/><circle cx="160" cy="272" r="4"/><circle cx="754" cy="262" r="4"/><circle cx="768" cy="286" r="5"/></g>
            <rect y="345" width="900" height="135" fill="#ddd5c0"/>
            <polygon points="330,480 570,480 508,345 392,345" fill="#e9e2d0"/>
          </g>
          <g class="fade bd-moderne">
            <rect x="300" y="258" width="300" height="87" fill="#f4f5f6"/>
            <rect x="300" y="252" width="300" height="8" fill="#7d858d"/>
            <rect x="322" y="284" width="256" height="30" fill="#9fb4c4"/>
            <g class="folA" fill="#8b9a6f"><rect x="196" y="316" width="4" height="30"/><rect x="206" y="308" width="4" height="38"/><rect x="686" y="316" width="4" height="30"/><rect x="696" y="308" width="4" height="38"/></g>
            <rect y="345" width="900" height="135" fill="#cfd3d6"/>
            <polygon points="330,480 570,480 508,345 392,345" fill="#dfe2e5"/>
          </g>
          <g class="fade bd-campagne">
            <g class="folA" fill="#7a9a5a"><ellipse cx="120" cy="330" rx="90" ry="26"/><ellipse cx="330" cy="332" rx="110" ry="24"/><ellipse cx="580" cy="332" rx="110" ry="24"/><ellipse cx="800" cy="330" rx="90" ry="26"/></g>
            <rect x="672" y="240" width="14" height="100" fill="#6e5537"/>
            <g class="folB" fill="#6f8f4f"><circle cx="679" cy="216" r="52"/><circle cx="646" cy="238" r="34"/><circle cx="714" cy="240" r="34"/></g>
            <g class="blos" fill="#f2b8cf"><circle cx="660" cy="200" r="5"/><circle cx="700" cy="190" r="4"/><circle cx="722" cy="224" r="5"/></g>
            <rect y="345" width="900" height="135" fill="#d9cfae"/>
            <polygon points="330,480 570,480 508,345 392,345" fill="#e2dabc"/>
          </g>
          <g class="x-voiture">
            <path d="M648 402 q6 -18 30 -20 l50 0 q24 2 30 20 l6 4 q4 2 4 8 l0 10 q0 4 -5 4 l-114 0 q-5 0 -5 -4 l0 -10 q0 -6 4 -8 Z" fill="#3d4750"/>
            <path d="M684 384 q4 -10 18 -10 l14 0 q14 0 18 10 l4 8 -58 0 Z" fill="#556069"/>
            <circle cx="678" cy="428" r="11" fill="#22282e"/><circle cx="678" cy="428" r="5" fill="#6b7680"/>
            <circle cx="750" cy="428" r="11" fill="#22282e"/><circle cx="750" cy="428" r="5" fill="#6b7680"/>
          </g>
          <g class="x-vege">
            <ellipse class="folA" cx="212" cy="338" rx="30" ry="16" fill="#7a9a5a"/>
            <ellipse class="folB" cx="248" cy="342" rx="20" ry="11" fill="#5f7a44"/>
            <ellipse class="folA" cx="688" cy="340" rx="26" ry="14" fill="#7a9a5a"/>
          </g>
          <g class="x-borne">
            <rect x="368" y="392" width="9" height="34" rx="2" fill="#3d4750"/><rect x="368" y="392" width="9" height="7" rx="2" fill="#ffe9b8"/>
            <rect x="523" y="404" width="9" height="34" rx="2" fill="#3d4750"/><rect x="523" y="404" width="9" height="7" rx="2" fill="#ffe9b8"/>
          </g>
        </g>
        <g class="p-clim">
          <rect class="climwall" x="0" y="90" width="900" height="255" fill="#efe6d5"/>
          <rect class="climplinthe" x="0" y="322" width="900" height="23" fill="#d3c7ae"/>
          <rect x="640" y="140" width="110" height="130" fill="#9fb4c4"/>
          <rect x="634" y="134" width="122" height="8" fill="#8a9096"/>
          <rect x="693" y="140" width="4" height="130" fill="#e8ecef"/>
          <rect class="climground" y="345" width="900" height="135" fill="#ddd5c0"/>
          <g class="x-vege">
            <ellipse class="folA" cx="240" cy="352" rx="46" ry="18" fill="#7a9a5a"/>
            <ellipse class="folB" cx="290" cy="356" rx="28" ry="12" fill="#5f7a44"/>
          </g>
        </g>
        <rect class="wx wx-brume" width="900" height="360" fill="url(#mlxfog)"/>
      </g>
      <g class="p-portail">
        <g class="snow">
          <rect y="345" width="900" height="135" fill="#f2f5f7"/>
          <polygon points="330,480 570,480 508,345 392,345" fill="#e8edf0"/>
        </g>
      </g>
      <ellipse class="mlx-gateshadow" cx="450" cy="356" rx="185" ry="14" fill="#1f2937" opacity=".16"/>
      <g class="mlx-gatezone">
        <g class="p-portail">
          <rect class="wall" x="0" y="292" width="262" height="53"/>
          <rect class="wall" x="638" y="292" width="262" height="53"/>
          <g class="x-haie">
            <g class="folA" fill="#7a9a5a"><ellipse cx="30" cy="290" rx="34" ry="14"/><ellipse cx="95" cy="288" rx="36" ry="15"/><ellipse cx="165" cy="290" rx="36" ry="14"/><ellipse cx="228" cy="289" rx="30" ry="14"/><ellipse cx="672" cy="289" rx="30" ry="14"/><ellipse cx="735" cy="290" rx="36" ry="14"/><ellipse cx="805" cy="288" rx="36" ry="15"/><ellipse cx="870" cy="290" rx="34" ry="14"/></g>
          </g>
          <rect class="pillar" x="255" y="196" width="46" height="149"/>
          <rect class="pillar" x="251" y="188" width="54" height="12" rx="2"/>
          <rect class="pillar" x="599" y="196" width="46" height="149"/>
          <rect class="pillar" x="595" y="188" width="54" height="12" rx="2"/>
          <g class="snow" fill="#f4f7f9"><rect x="251" y="185" width="54" height="6" rx="3"/><rect x="595" y="185" width="54" height="6" rx="3"/><rect x="0" y="289" width="262" height="6" rx="3"/><rect x="638" y="289" width="262" height="6" rx="3"/></g>
          <g class="x-lamp">
            <circle class="glow2" cx="278" cy="178" r="30" fill="#ffd98c" opacity=".8"/>
            <circle class="glow2" cx="622" cy="178" r="30" fill="#ffd98c" opacity=".8"/>
            <rect x="272" y="170" width="12" height="16" rx="2" fill="#2e353c"/><circle cx="278" cy="178" r="14" fill="#ffd98c" opacity=".4"/><circle cx="278" cy="178" r="5" fill="#ffe9b8"/>
            <rect x="616" y="170" width="12" height="16" rx="2" fill="#2e353c"/><circle cx="622" cy="178" r="14" fill="#ffd98c" opacity=".4"/><circle cx="622" cy="178" r="5" fill="#ffe9b8"/>
          </g>
          <g class="x-pot">
            <polygon points="228,345 252,345 248,318 232,318" fill="#b06a45"/>
            <ellipse class="folA" cx="240" cy="310" rx="16" ry="11" fill="#7a9a5a"/>
            <g fill="#e08fb2"><circle cx="233" cy="306" r="3"/><circle cx="246" cy="303" r="3"/></g>
            <polygon points="648,345 672,345 668,318 652,318" fill="#b06a45"/>
            <ellipse class="folA" cx="660" cy="310" rx="16" ry="11" fill="#7a9a5a"/>
            <g fill="#e08fb2"><circle cx="653" cy="306" r="3"/><circle cx="666" cy="303" r="3"/></g>
          </g>
          <g class="x-mail">
            <rect x="702" y="300" width="6" height="45" fill="#5a5148"/>
            <rect x="690" y="282" width="30" height="20" rx="4" fill="#8b2f35"/>
            <rect x="694" y="288" width="22" height="3" fill="#e8e2d8"/>
          </g>
          <g class="x-inter">
            <rect x="262" y="236" width="15" height="24" rx="2" fill="#2e353c"/>
            <rect x="265" y="240" width="9" height="7" rx="1" fill="#9fb4c4"/>
            <g fill="#6b7680"><circle cx="267" cy="252" r="1.3"/><circle cx="272" cy="252" r="1.3"/><circle cx="267" cy="256" r="1.3"/><circle cx="272" cy="256" r="1.3"/></g>
          </g>
          <g>
            <path d="M305 238 Q450 204 595 238 L595 345 L305 345 Z" fill="#3a4149"/>
            <g fill="#4d565f"><rect x="318" y="242" width="6" height="103"/><rect x="342" y="237" width="6" height="108"/><rect x="366" y="232" width="6" height="113"/><rect x="390" y="228" width="6" height="117"/><rect x="414" y="225" width="6" height="120"/><rect x="438" y="223" width="6" height="122"/><rect x="456" y="223" width="6" height="122"/><rect x="480" y="225" width="6" height="120"/><rect x="504" y="228" width="6" height="117"/><rect x="528" y="232" width="6" height="113"/><rect x="552" y="237" width="6" height="108"/><rect x="576" y="242" width="6" height="103"/></g>
            <rect x="448" y="223" width="4" height="122" fill="#333a41"/>
          </g>
        </g>
        <g class="p-clim">
          <ellipse cx="450" cy="352" rx="115" ry="10" fill="#1f2937" opacity=".14"/>
          <g class="x-lamp">
            <circle class="glow2" cx="308" cy="176" r="28" fill="#ffd98c" opacity=".8"/>
            <rect x="302" y="168" width="12" height="16" rx="2" fill="#2e353c"/><circle cx="308" cy="176" r="13" fill="#ffd98c" opacity=".4"/><circle cx="308" cy="176" r="5" fill="#ffe9b8"/>
          </g>
          <g class="x-pot">
            <polygon points="586,345 616,345 611,312 591,312" fill="#b06a45"/>
            <ellipse class="folA" cx="601" cy="302" rx="19" ry="13" fill="#7a9a5a"/>
            <g fill="#e08fb2"><circle cx="593" cy="298" r="3"/><circle cx="608" cy="295" r="3"/></g>
          </g>
          <g class="x-galet" fill="#c8ccd0">
            <ellipse cx="360" cy="351" rx="16" ry="6"/><ellipse cx="392" cy="355" rx="12" ry="5"/><ellipse cx="452" cy="356" rx="13" ry="5"/><ellipse cx="518" cy="353" rx="14" ry="5.5"/><ellipse cx="548" cy="349" rx="10" ry="4.5"/>
          </g>
          <g class="x-grimp">
            <path d="M300 345 C290 300 312 258 298 212" fill="none" stroke="#5f7a44" stroke-width="5"/>
            <g class="folA" fill="#7a9a5a"><circle cx="291" cy="310" r="14"/><circle cx="309" cy="268" r="12"/><circle cx="294" cy="230" r="12"/></g>
          </g>
          <g>
            <rect x="335" y="212" width="230" height="133" rx="10" fill="#aeb6bc"/>
            <rect x="335" y="212" width="230" height="10" rx="5" fill="#c4cbd0"/>
            <g fill="#8f979e"><rect x="349" y="234" width="202" height="7" rx="3.5"/><rect x="349" y="252" width="202" height="7" rx="3.5"/><rect x="349" y="270" width="202" height="7" rx="3.5"/><rect x="349" y="288" width="202" height="7" rx="3.5"/><rect x="349" y="306" width="202" height="7" rx="3.5"/><rect x="349" y="324" width="202" height="7" rx="3.5"/></g>
          </g>
        </g>
      </g>
    </g>
  </g>
  <g class="wx wx-nuage" fill="#ffffff" opacity="0"><ellipse cx="180" cy="64" rx="70" ry="20" opacity=".85"/><ellipse cx="250" cy="52" rx="52" ry="16" opacity=".7"/><ellipse cx="560" cy="84" rx="86" ry="22" opacity=".8"/><ellipse cx="820" cy="120" rx="60" ry="16" opacity=".7"/></g>
  <g class="wx wx-pluie" stroke="#dfe9f0" stroke-width="2" stroke-linecap="round" opacity="0"><line x1="80" y1="30" x2="68" y2="70"/><line x1="180" y1="90" x2="168" y2="130"/><line x1="280" y1="40" x2="268" y2="80"/><line x1="360" y1="120" x2="348" y2="160"/><line x1="460" y1="60" x2="448" y2="100"/><line x1="540" y1="150" x2="528" y2="190"/><line x1="640" y1="50" x2="628" y2="90"/><line x1="740" y1="110" x2="728" y2="150"/><line x1="840" y1="60" x2="828" y2="100"/><line x1="130" y1="200" x2="118" y2="240"/><line x1="330" y1="230" x2="318" y2="270"/><line x1="530" y1="250" x2="518" y2="290"/><line x1="730" y1="220" x2="718" y2="260"/><line x1="430" y1="350" x2="418" y2="390"/><line x1="630" y1="330" x2="618" y2="370"/></g>
  <rect class="tint tint-gold" width="900" height="480" fill="#f4a94e"/>
  <rect class="tint tint-veil" width="900" height="480" fill="#c9d2d8"/>
  <rect class="tint tint-nuit" width="900" height="480" fill="#1c2942"/>
  <rect class="tint tint-pluie" width="900" height="480" fill="#8fa2b2"/>
</svg>`

/** CSS de l'aperçu — transitions pilotées par les data-attributes du wrapper. */
const SCENE_CSS = `
.mlx-scene { position: relative; overflow: hidden; }
.mlx-scene > svg { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.mlx-scene .fade { transition: opacity .55s ease; opacity: 0; }
.mlx-scene[data-decor="tuffeau"] .bd-tuffeau,
.mlx-scene[data-decor="moderne"] .bd-moderne,
.mlx-scene[data-decor="campagne"] .bd-campagne { opacity: 1; }
.mlx-scene[data-light="day"] .sky-day,
.mlx-scene[data-light="gold"] .sky-gold,
.mlx-scene[data-light="veil"] .sky-veil,
.mlx-scene[data-light="nuit"] .sky-nuit { opacity: 1; }
.mlx-scene .pillar, .mlx-scene .wall { transition: fill .55s ease; }
.mlx-scene[data-decor="tuffeau"] .pillar { fill: #e6d9bb; } .mlx-scene[data-decor="tuffeau"] .wall { fill: #dccfae; }
.mlx-scene[data-decor="moderne"] .pillar { fill: #bfc5cb; } .mlx-scene[data-decor="moderne"] .wall { fill: #b1b8bf; }
.mlx-scene[data-decor="campagne"] .pillar { fill: #cdbfa0; } .mlx-scene[data-decor="campagne"] .wall { fill: #bfb090; }
.mlx-scene .climwall, .mlx-scene .climground, .mlx-scene .climplinthe { transition: fill .55s ease; }
.mlx-scene[data-decor="crepi"] .climwall { fill: #efe6d5; } .mlx-scene[data-decor="crepi"] .climground { fill: #ddd5c0; } .mlx-scene[data-decor="crepi"] .climplinthe { fill: #d3c7ae; }
.mlx-scene[data-decor="pierre"] .climwall { fill: #d6ccbb; } .mlx-scene[data-decor="pierre"] .climground { fill: #cfd3d6; } .mlx-scene[data-decor="pierre"] .climplinthe { fill: #bdb2a0; }
.mlx-scene[data-decor="bois"] .climwall { fill: #caa87b; } .mlx-scene[data-decor="bois"] .climground { fill: #b98f5e; } .mlx-scene[data-decor="bois"] .climplinthe { fill: #a9825a; }
.mlx-scene .mlx-backdrop { transition: filter .5s ease; }
.mlx-scene[data-pdc="a"] .mlx-backdrop { filter: blur(5px); }
.mlx-scene { --mlx-compx: 0px; --mlx-cady: 0px; --mlx-cads: 1; --mlx-hy: 0px; --mlx-hsy: 1; }
.mlx-scene .mlx-zoomer { transition: transform .55s ease; transform-origin: 50% 78%; transform: translate(var(--mlx-compx), var(--mlx-cady)) scale(var(--mlx-cads)); }
.mlx-scene[data-cadr="large"] { --mlx-cads: .86; }
.mlx-scene[data-cadr="serre"] { --mlx-cads: 1.2; --mlx-cady: -12px; }
.mlx-scene[data-compo="g"] { --mlx-compx: -58px; }
.mlx-scene[data-compo="d"] { --mlx-compx: 58px; }
.mlx-scene .mlx-vscale { transition: transform .55s ease; transform-origin: 50% 78%; transform: translateY(var(--mlx-hy)) scaleY(var(--mlx-hsy)); }
.mlx-scene[data-haut="contre"] { --mlx-hy: -8px; --mlx-hsy: 1.07; }
.mlx-scene[data-haut="drone"] { --mlx-hy: 16px; --mlx-hsy: .9; }
.mlx-scene .mlx-gatezone { transition: transform .5s ease; transform-origin: 38% 70%; }
.mlx-scene[data-angle="tq"] .mlx-gatezone { transform: skewY(-3.5deg) scaleX(.93) translateX(14px); }
.mlx-scene[data-angle="cote"] .mlx-gatezone { transform: skewY(-7deg) scaleX(.8) translateX(38px); }
.mlx-scene .mlx-gateshadow { transition: transform .55s ease, opacity .55s ease; transform-origin: center; }
.mlx-scene[data-light="gold"] .mlx-gateshadow { transform: translateX(46px) scaleX(1.45); opacity: .3; }
.mlx-scene[data-light="veil"] .mlx-gateshadow { opacity: .08; }
.mlx-scene[data-light="nuit"] .mlx-gateshadow { opacity: .05; }
.mlx-scene .tint { transition: opacity .55s ease; opacity: 0; pointer-events: none; }
.mlx-scene[data-light="gold"] .tint-gold { opacity: .12; }
.mlx-scene[data-light="veil"] .tint-veil { opacity: .14; }
.mlx-scene[data-light="nuit"] .tint-nuit { opacity: .3; }
.mlx-scene .folA, .mlx-scene .folB { transition: fill .55s ease; }
.mlx-scene[data-saison="printemps"] .folA { fill: #8fb567; } .mlx-scene[data-saison="printemps"] .folB { fill: #74995a; }
.mlx-scene[data-saison="ete"] .folA { fill: #7a9a5a; } .mlx-scene[data-saison="ete"] .folB { fill: #5f7a44; }
.mlx-scene[data-saison="automne"] .folA { fill: #c08a3e; } .mlx-scene[data-saison="automne"] .folB { fill: #a06a2c; }
.mlx-scene[data-saison="hiver"] .folA { fill: #ccd6db; } .mlx-scene[data-saison="hiver"] .folB { fill: #b7c3ca; }
.mlx-scene .blos { transition: opacity .55s ease; opacity: 0; }
.mlx-scene[data-saison="printemps"] .blos { opacity: 1; }
.mlx-scene .snow { transition: opacity .55s ease; opacity: 0; }
.mlx-scene[data-saison="hiver"] .snow { opacity: 1; }
.mlx-scene .wx { transition: opacity .55s ease; opacity: 0; }
.mlx-scene[data-meteo="nuage"] .wx-nuage { opacity: 1; }
.mlx-scene[data-meteo="pluie"] .wx-pluie { opacity: 1; }
.mlx-scene[data-meteo="pluie"] .tint-pluie { opacity: .16; }
.mlx-scene[data-meteo="brume"] .wx-brume { opacity: 1; }
.mlx-scene .x-voiture, .mlx-scene .x-vege, .mlx-scene .x-lamp, .mlx-scene .x-pot, .mlx-scene .x-mail,
.mlx-scene .x-inter, .mlx-scene .x-borne, .mlx-scene .x-haie, .mlx-scene .x-galet, .mlx-scene .x-grimp { transition: opacity .45s ease; opacity: 0; }
.mlx-scene.on-voiture .x-voiture { opacity: 1; }
.mlx-scene.on-vege .x-vege { opacity: 1; }
.mlx-scene.on-lamp .x-lamp { opacity: 1; }
.mlx-scene.on-pot .x-pot { opacity: 1; }
.mlx-scene.on-mail .x-mail { opacity: 1; }
.mlx-scene.on-inter .x-inter { opacity: 1; }
.mlx-scene.on-borne .x-borne { opacity: 1; }
.mlx-scene.on-haie .x-haie { opacity: 1; }
.mlx-scene.on-galet .x-galet { opacity: 1; }
.mlx-scene.on-grimp .x-grimp { opacity: 1; }
.mlx-scene .glow2 { transition: opacity .55s ease; opacity: 0; }
.mlx-scene[data-light="nuit"].on-lamp .glow2 { opacity: .8; }
.mlx-scene .p-portail, .mlx-scene .p-clim { transition: opacity .5s ease; }
.mlx-scene[data-typo="portail"] .p-clim { opacity: 0; pointer-events: none; }
.mlx-scene[data-typo="clim"] .p-portail { opacity: 0; pointer-events: none; }
`

// —————————————————————————————————————————————— petits composants

function Thumb({ svg, className }: { svg: string; className?: string }) {
  return <span className={className} aria-hidden dangerouslySetInnerHTML={{ __html: svg }} />
}

function Carte({
  on,
  onClick,
  th,
  nm,
  tg,
}: {
  on: boolean
  onClick: () => void
  th: string
  nm: string
  tg: string
}) {
  return (
    <button
      onClick={onClick}
      className={`text-left bg-white rounded-[12px] border-2 overflow-hidden transition-all hover:-translate-y-0.5 hover:shadow-lg ${
        on ? 'border-brand-green ring-[3px] ring-brand-green-light' : 'border-border'
      }`}
    >
      <Thumb svg={th} className="block w-full h-[56px] relative [&>svg]:absolute [&>svg]:inset-0 [&>svg]:w-full [&>svg]:h-full" />
      <span className="block px-2.5 pt-1.5 font-bold text-[12.5px] leading-tight">{nm}</span>
      <span className="block px-2.5 pb-2 text-[11px] text-text-secondary leading-tight">{tg}</span>
    </button>
  )
}

function ChoiceGroup({
  titre,
  sous,
  cols,
  items,
  value,
  onChange,
}: {
  titre: string
  sous: string
  cols: number
  items: Choice[]
  value: string
  onChange: (id: string) => void
}) {
  return (
    <div>
      <div className="flex items-baseline gap-2.5 mb-2.5">
        <h3 className="text-[15.5px] font-bold">{titre}</h3>
        <span className="text-[12px] text-text-disabled">{sous}</span>
      </div>
      <div className="grid gap-2.5" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))` }}>
        {items.map((c) => (
          <Carte key={c.id} on={value === c.id} onClick={() => onChange(c.id)} th={c.th} nm={c.nm} tg={c.tg} />
        ))}
      </div>
    </div>
  )
}

/** Silhouette cache-clim dans le langage de ../Silhouette (piliers gris / produit vert). */
function SilhouetteClim() {
  return (
    <svg viewBox="0 0 220 112" className="block w-full h-auto" aria-hidden>
      <line x1={0} y1={104} x2={220} y2={104} stroke="#c3c9d1" strokeWidth={2} />
      <rect x={62} y={38} width={96} height={66} rx={4} fill="var(--color-brand-green-light)" stroke="var(--color-brand-green)" strokeWidth={2.5} />
      {[52, 65, 78, 91].map((y) => (
        <line key={y} x1={70} y1={y} x2={150} y2={y} stroke="var(--color-brand-green)" strokeWidth={2} />
      ))}
    </svg>
  )
}

// —————————————————————————————————————————————— composant principal

/** initialBatch (réouverture depuis « Mes sessions », /generation?libre=<batch>) :
 *  on arrive directement sur l'écran de résultats du lot, le suivi reprend seul. */
export default function MesLibre({ initialBatch = null }: { initialBatch?: string | null }) {
  // — produit —
  const [typo, setTypo] = useState<TypoKey>('battant')
  const [profilId, setProfilId] = useState('portail')
  const P = PROFILES[profilId] ?? PROFILES.portail
  const [customTypo, setCustomTypo] = useState<{ nm: string; marque: string; profil: string } | null>(
    null
  )
  const [modalOpen, setModalOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [label, setLabel] = useState(TYPO_TXT.battant)
  const [images, setImages] = useState<ImgItem[]>([])
  /** Reprise de session : images produit du lot précédent, réutilisées telles
   *  quelles au prochain lancement (chemins servis par /api/artifacts). */
  const [reuse, setReuse] = useState<{ batch: string; paths: string[] } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // — décor —
  const [decorSel, setDecorSel] = useState(P.decors[0].id)
  /** Ambiance d'aperçu pilotée par le décor choisi (clé CSS de la scène). */
  const [sceneDecor, setSceneDecor] = useState(P.decors[0].sceneDecor ?? P.decors[0].id)
  const [desc, setDesc] = useState(P.decors[0].desc)
  const cleanDescRef = useRef(P.decors[0].desc)
  const [dfVals, setDfVals] = useState<Record<string, string>>(() =>
    Object.fromEntries(PROFILES.portail.df.map((f) => [f.id, f.opts[0][0]]))
  )
  // Décors Libres enregistrés (partagés, table libre_decors) — filtrés par profil.
  const [saved, setSaved] = useState<SavedDecor[]>([])
  const [saveOpen, setSaveOpen] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [saveBusy, setSaveBusy] = useState(false)

  // — scène / photo —
  const [saison, setSaison] = useState('ete')
  const [meteo, setMeteo] = useState('clair')
  const [light, setLight] = useState('day')
  const [angle, setAngle] = useState('face')
  const [cadr, setCadr] = useState('moyen')
  const [haut, setHaut] = useState('oeil')
  const [compo, setCompo] = useState('c')
  const [pdc, setPdc] = useState('b')
  const [extras, setExtras] = useState<Record<string, boolean>>({})

  // — génération —
  const [n, setN] = useState(3)
  const [ratio, setRatio] = useState('site')
  const [model, setModel] = useState<'pro' | 'flash'>('pro')
  const [quality, setQuality] = useState<'1K' | '2K' | '4K'>('2K')
  const [promptOpen, setPromptOpen] = useState(false)

  // — lot en cours —
  /** Réglages dépliés (composition) ou repliés en résumé (après lancement) —
   *  toujours le MÊME écran, jamais de bascule de page (demande Mathias 28/07). */
  const [settingsOpen, setSettingsOpen] = useState(!initialBatch)
  const [batchId, setBatchId] = useState<string | null>(initialBatch)
  const [jobs, setJobs] = useState<LibreJob[]>([])
  const [kept, setKept] = useState<Set<number>>(new Set())
  const [launching, setLaunching] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [lightboxPath, setLightboxPath] = useState<string | null>(null)
  // — studio MES (clic sur une MES) : versions, retouche, prompt, actions —
  const [studioRoot, setStudioRoot] = useState<number | null>(null)
  /** Version affichée (jobId) — null = la plus récente terminée. */
  const [studioVersion, setStudioVersion] = useState<number | null>(null)
  const [fixText, setFixText] = useState('')
  const [fixBusy, setFixBusy] = useState(false)
  const [promptShown, setPromptShown] = useState(false)
  const [promptText, setPromptText] = useState<string | null>(null)
  // Zoom molette dans l'aperçu du studio (100 % → 400 %) + déplacement au drag.
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const viewerRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null)

  // Changement de MES ou de version → zoom remis à 100 %.
  useEffect(() => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }, [studioRoot, studioVersion])

  // Molette = zoom (listener natif non-passif : React pose wheel en passif,
  // preventDefault y serait ignoré).
  useEffect(() => {
    const el = viewerRef.current
    if (!el || studioRoot == null) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      setZoom((z) => {
        const next = Math.min(4, Math.max(1, z * (e.deltaY < 0 ? 1.15 : 1 / 1.15)))
        if (next === 1) setPan({ x: 0, y: 0 })
        return next
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [studioRoot])

  const qualities = QUALITES[model]
  const q = qualities.find((x) => x.id === quality) ?? qualities[0]
  const cost = (n * q.price).toFixed(2).replace('.', ',')

  // — bascule de typologie : profil + libellé + remise à zéro décor/extras —
  function applyProfil(id: string) {
    const prof = PROFILES[id] ?? PROFILES.portail
    setProfilId(id)
    setDecorSel(prof.decors[0].id)
    setSceneDecor(prof.decors[0].sceneDecor ?? prof.decors[0].id)
    setDesc(prof.decors[0].desc)
    cleanDescRef.current = prof.decors[0].desc
    setDfVals(Object.fromEntries(prof.df.map((f) => [f.id, f.opts[0][0]])))
    setExtras({})
    setSaveOpen(false)
  }

  // — détection auto de la typologie depuis l'image déposée (28/07/2026) —
  // nom de fichier d'abord (gratuit), sinon vision Gemini. Un clic manuel sur
  // une carte reprend TOUJOURS la main (autoRef distingue les deux chemins).
  const [typoAuto, setTypoAuto] = useState<'pending' | 'done' | 'failed' | 'manual' | null>(null)
  const autoRef = useRef(false)
  const detectRan = useRef(false)

  function pickTypo(t: TypoKey) {
    if (!autoRef.current) setTypoAuto('manual')
    setTypo(t)
    applyProfil(t === 'autre' ? (customTypo?.profil ?? 'portail') : t === 'clim' ? 'clim' : 'portail')
    setLabel(t === 'autre' ? (customTypo?.nm ?? '') : TYPO_TXT[t])
  }

  function pickCustomTypo(t: { nm: string; marque: string; profil: string }) {
    if (!autoRef.current) setTypoAuto('manual')
    setCustomTypo(t)
    setModalOpen(false)
    setTypo('autre')
    setLabel(t.nm)
    applyProfil(t.profil)
  }

  function applyDetected(key: string) {
    autoRef.current = true
    try {
      if (key === 'battant' || key === 'coulissant' || key === 'portillon' || key === 'clim') {
        pickTypo(key)
      } else {
        const t = TYPOS_ALL.find((x) => x.profil === key)
        if (t) pickCustomTypo(t)
      }
    } finally {
      autoRef.current = false
    }
  }

  useEffect(() => {
    if (images.length === 0) {
      // lot vidé : la prochaine image relance une détection (sauf choix manuel)
      detectRan.current = false
      return
    }
    if (detectRan.current || typoAuto === 'manual') return
    detectRan.current = true
    const first = images[0]
    const fromName = typoFromFileName(first.name)
    if (fromName) {
      applyDetected(fromName)
      setTypoAuto('done')
      return
    }
    setTypoAuto('pending')
    const fd = new FormData()
    fd.append('file', first.file, first.name)
    fetch('/api/generation/libre/detect', { method: 'POST', body: fd })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d?.typo || d.typo === 'autre') {
          setTypoAuto('failed')
          return
        }
        applyDetected(d.typo)
        setTypoAuto('done')
      })
      .catch(() => setTypoAuto('failed'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [images, typoAuto])

  // — formulaire décor : chaque réponse réécrit la description —
  function setDf(id: string, val: string) {
    const next = { ...dfVals, [id]: val }
    setDfVals(next)
    const t = Object.fromEntries(P.df.map((f) => [f.id, P.dfTxt[f.id][next[f.id]]]))
    const txt = P.sentence(t)
    cleanDescRef.current = txt
    setDesc(txt)
  }

  function pickDecor(d: DecorPreset) {
    setDecorSel(d.id)
    setSceneDecor(d.sceneDecor ?? d.id)
    cleanDescRef.current = d.desc
    setDesc(d.desc)
  }

  // — décors Libres enregistrés (partagés) —
  useEffect(() => {
    let alive = true
    fetch(`/api/libre-decors?profil=${encodeURIComponent(profilId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && Array.isArray(d?.decors)) setSaved(d.decors)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [profilId])

  function pickSaved(d: SavedDecor) {
    setDecorSel(`saved-${d.id}`)
    cleanDescRef.current = d.description
    setDesc(d.description)
  }

  async function saveDecor() {
    const name = saveName.trim()
    if (!name) return
    setSaveBusy(true)
    try {
      const res = await fetch('/api/libre-decors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, profil: profilId, description: desc }),
      })
      const body = await res.json().catch(() => null)
      if (res.ok && body?.decor) {
        setSaved((cur) => [body.decor, ...cur])
        setSaveOpen(false)
        setSaveName('')
      } else {
        setNotice(body?.error ?? 'Enregistrement impossible.')
      }
    } catch {
      setNotice('Enregistrement impossible — vérifie la connexion.')
    } finally {
      setSaveBusy(false)
    }
  }

  async function deleteSaved(d: SavedDecor) {
    try {
      const res = await fetch(`/api/libre-decors/${d.id}`, { method: 'DELETE' })
      if (res.ok) {
        setSaved((cur) => cur.filter((x) => x.id !== d.id))
      } else {
        const body = await res.json().catch(() => null)
        setNotice(body?.error ?? 'Suppression impossible.')
      }
    } catch {
      setNotice('Suppression impossible — vérifie la connexion.')
    }
  }

  // — images produit —
  const addFiles = useCallback((files: FileList | File[]) => {
    const list = Array.from(files).filter((f) => /\.(png|jpe?g|webp)$/i.test(f.name))
    // Objets URL créés HORS de l'updater : il doit rester PUR — en dev, React
    // StrictMode l'appelle deux fois et l'image partait en double (bug 28/07).
    const items = list.map((file) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: file.name,
      url: URL.createObjectURL(file),
      file,
    }))
    setImages((cur) => [...cur, ...items].slice(0, 6))
    // De nouvelles images remplacent celles reprises du lot précédent.
    setReuse(null)
  }, [])
  useEffect(
    () => () => {
      setImages((cur) => {
        cur.forEach((i) => URL.revokeObjectURL(i.url))
        return []
      })
    },
    []
  )

  // — sessions : l'état du formulaire part avec le lot (payload.ui) et se relit
  //   à la réouverture — la page reprend TOUJOURS la dernière session libre. —
  function buildUi(): UiState {
    return {
      typo, customTypo, profilId, decorSel, sceneDecor, desc, dfVals,
      saison, meteo, light, angle, cadr, haut, compo, pdc,
      extras, n, ratio, model, quality, label,
    }
  }

  function applyUi(u: Partial<UiState>, payload: { productLabel?: string }) {
    const prof = typeof u.profilId === 'string' && PROFILES[u.profilId] ? u.profilId : 'portail'
    const P2 = PROFILES[prof]
    setProfilId(prof)
    if (u.typo && ['battant', 'coulissant', 'portillon', 'clim', 'autre'].includes(u.typo)) setTypo(u.typo)
    if (u.customTypo && typeof u.customTypo.nm === 'string') setCustomTypo(u.customTypo)
    setDecorSel(typeof u.decorSel === 'string' ? u.decorSel : P2.decors[0].id)
    setSceneDecor(
      typeof u.sceneDecor === 'string' ? u.sceneDecor : (P2.decors[0].sceneDecor ?? P2.decors[0].id)
    )
    const d = typeof u.desc === 'string' && u.desc.trim() ? u.desc : P2.decors[0].desc
    setDesc(d)
    cleanDescRef.current = d
    setDfVals({
      ...Object.fromEntries(P2.df.map((f) => [f.id, f.opts[0][0]])),
      ...(u.dfVals && typeof u.dfVals === 'object' ? u.dfVals : {}),
    })
    if (typeof u.saison === 'string' && NAMES.saison[u.saison]) setSaison(u.saison)
    if (typeof u.meteo === 'string' && NAMES.meteo[u.meteo]) setMeteo(u.meteo)
    if (typeof u.light === 'string' && NAMES.light[u.light]) setLight(u.light)
    if (typeof u.angle === 'string' && NAMES.angle[u.angle]) setAngle(u.angle)
    if (typeof u.cadr === 'string' && NAMES.cadr[u.cadr]) setCadr(u.cadr)
    if (typeof u.haut === 'string' && NAMES.haut[u.haut]) setHaut(u.haut)
    if (typeof u.compo === 'string' && NAMES.compo[u.compo]) setCompo(u.compo)
    if (typeof u.pdc === 'string' && NAMES.pdc[u.pdc]) setPdc(u.pdc)
    setExtras(u.extras && typeof u.extras === 'object' ? u.extras : {})
    if (typeof u.n === 'number') setN(Math.min(8, Math.max(1, Math.round(u.n))))
    if (typeof u.ratio === 'string' && RATIO_AR[u.ratio] !== undefined) setRatio(u.ratio)
    const m = u.model === 'flash' ? 'flash' : 'pro'
    setModel(m)
    setQuality(m === 'flash' ? '1K' : u.quality === '1K' || u.quality === '4K' ? u.quality : '2K')
    setLabel(typeof u.label === 'string' && u.label ? u.label : (payload.productLabel ?? ''))
  }

  const hydratedRef = useRef(false)
  const hydrateFromBatch = useCallback(async (batch: string) => {
    try {
      const d = await fetch(`/api/gamme/${encodeURIComponent(batch)}`).then((r) =>
        r.ok ? r.json() : null
      )
      const job: LibreJob | undefined = Array.isArray(d?.jobs)
        ? d.jobs.find((j: LibreJob) => j.type === 'libre')
        : undefined
      if (!job) return
      applyUi(job.payload?.ui ?? {}, { productLabel: job.payload?.productLabel })
      const paths = Array.isArray(job.payload?.productPaths)
        ? job.payload.productPaths.filter((p): p is string => typeof p === 'string' && !p.includes(':'))
        : []
      if (paths.length > 0) setReuse({ batch, paths })
      // Pas de re-détection de typologie sur une session reprise.
      detectRan.current = true
      setBatchId(batch)
      setSettingsOpen(false)
    } catch {
      // session illisible : la page reste sur une composition vierge
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Reprise de session UNIQUEMENT sur demande explicite (?libre=<batch> —
  // carte de l'Accueil, cloche). La carte « MES Libre » du menu Générer ouvre
  // TOUJOURS une composition vierge (retour Mathias 28/07/2026).
  useEffect(() => {
    if (hydratedRef.current || !initialBatch) return
    hydratedRef.current = true
    void hydrateFromBatch(initialBatch)
  }, [initialBatch, hydrateFromBatch])

  // — textes du prompt (mêmes formulations que le gabarit serveur « libre-mes ») —
  const conditionsText = `saison : ${NAMES.saison[saison]} · météo : ${NAMES.meteo[meteo]} · lumière : ${NAMES.light[light]}`
  const cameraText = `vue de ${NAMES.angle[angle]} · ${NAMES.cadr[cadr]} · ${NAMES.haut[haut]} · composition ${NAMES.compo[compo]} · ${NAMES.pdc[pdc]}`
  const detailsText = P.plus.filter((x) => extras[x.id]).map((x) => x.txt).join(' · ')

  // — lancement + suivi du lot —
  async function launch() {
    if (images.length === 0 && !reuse) {
      setNotice('Dépose au moins une image du produit.')
      return
    }
    setNotice(null)
    setLaunching(true)
    try {
      const fd = new FormData()
      if (images.length > 0) {
        images.forEach((i) => fd.append('files', i.file, i.name))
      } else if (reuse) {
        // Reprise de session : mêmes images produit que le lot précédent.
        fd.append('reuseBatch', reuse.batch)
      }
      fd.append('ui', JSON.stringify(buildUi()))
      fd.append('label', label)
      fd.append('scene', desc)
      fd.append('conditions', conditionsText)
      fd.append('camera', cameraText)
      fd.append('details', detailsText)
      fd.append('ratio', ratio)
      fd.append('quality', quality)
      fd.append('model', model)
      fd.append('count', String(n))
      const res = await fetch('/api/generation/libre', { method: 'POST', body: fd })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        setNotice(body?.error ?? `Erreur ${res.status}`)
        return
      }
      setBatchId(body.batchId)
      setJobs([])
      setMpJobs([])
      setKept(new Set())
      // Même écran : les réglages se replient en résumé, les variantes arrivent au-dessus.
      setSettingsOpen(false)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch {
      setNotice('Lancement impossible — vérifie la connexion et réessaie.')
    } finally {
      setLaunching(false)
    }
  }

  const [mpJobs, setMpJobs] = useState<LibreJob[]>([])
  const [fixJobs, setFixJobs] = useState<LibreJob[]>([])
  /** « Coup de pouce » du polling après un enqueue (MP, retouche) — le temps
   *  que les nouveaux jobs apparaissent dans le batch. */
  const [pollKick, setPollKick] = useState(false)
  const busy =
    jobs.length === 0 ||
    [...jobs, ...mpJobs, ...fixJobs].some((j) => j.status === 'queued' || j.status === 'running')
  useEffect(() => {
    if (!batchId || (!busy && !pollKick)) return
    let alive = true
    const tick = async () => {
      try {
        const d = await fetch(`/api/gamme/${batchId}`).then((r) => r.json())
        if (!alive || !Array.isArray(d.jobs)) return
        const all: LibreJob[] = d.jobs
        setJobs(all.filter((j) => j.type === 'libre'))
        setMpJobs(all.filter((j) => j.type === 'libre-mp'))
        setFixJobs(all.filter((j) => j.type === 'libre-fix'))
        // Le coup de pouce s'éteint dès que l'activité réelle est visible.
        if (all.some((j) => j.status === 'queued' || j.status === 'running')) setPollKick(false)
      } catch {
        // réseau : prochain tick
      }
    }
    tick()
    const t = setInterval(tick, 2000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [batchId, busy, pollKick])

  // Studio : Échap ferme, ← → naviguent entre les MES terminées du lot.
  useEffect(() => {
    if (studioRoot == null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setStudioRoot(null)
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const order = jobs.filter((j) => j.status === 'done' && j.result?.imagePath)
        const idx = order.findIndex((j) => j.id === studioRoot)
        const nx = order[idx + (e.key === 'ArrowRight' ? 1 : -1)]
        if (idx >= 0 && nx) {
          setStudioRoot(nx.id)
          setStudioVersion(null)
          setPromptShown(false)
          setPromptText(null)
          setFixText('')
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [studioRoot, jobs])

  /** Retouche par consigne (studio) : la version affichée + la consigne → une
   *  nouvelle VERSION de la MES racine, même lot. */
  async function fixMes(sourceJobId: number) {
    const instruction = fixText.trim()
    if (!instruction) return
    setFixBusy(true)
    setNotice(null)
    try {
      const res = await fetch('/api/generation/libre/fix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: sourceJobId, instruction }),
      })
      const body = await res.json().catch(() => null)
      if (res.ok) {
        setFixText('')
        setStudioVersion(null) // la nouvelle version s'affichera dès qu'elle sort
        setPollKick(true)
      } else {
        setNotice(body?.error ?? 'Retouche impossible.')
      }
    } catch {
      setNotice('Retouche impossible — vérifie la connexion.')
    } finally {
      setFixBusy(false)
    }
  }

  /** Passe UNE MES en Marketplace (bouton 1:1 de sa carte). */
  async function mpOne(id: number) {
    setNotice(null)
    setPollKick(true)
    try {
      const res = await fetch('/api/generation/libre/mp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobIds: [id] }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        setNotice(body?.error ?? 'Passage Marketplace impossible.')
        setPollKick(false)
      }
    } catch {
      setNotice('Passage Marketplace impossible — vérifie la connexion.')
      setPollKick(false)
    }
  }

  // — passage Marketplace des variantes gardées (carré 2000×2000) —
  async function launchMp() {
    const ids = doneJobs.filter((j) => kept.has(j.id)).map((j) => j.id)
    if (ids.length === 0) {
      setNotice('Garde au moins une MES avant de la passer en Marketplace.')
      return
    }
    setNotice(null)
    setPollKick(true)
    try {
      const res = await fetch('/api/generation/libre/mp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobIds: ids }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        setNotice(body?.error ?? 'Passage Marketplace impossible.')
        setPollKick(false)
      }
    } catch {
      setNotice('Passage Marketplace impossible — vérifie la connexion.')
      setPollKick(false)
    }
  }

  async function regen(id: number) {
    try {
      const res = await fetch(`/api/jobs/${id}/regen`, { method: 'POST' })
      if (res.ok) {
        setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, status: 'queued', error: null } : j)))
      }
    } catch {
      // le polling rattrapera
    }
  }

  function toggleKeep(id: number) {
    setKept((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  /** Une session = UN produit (règle FERME Mathias 28/07) : dès qu'un lot est
   *  généré, TOUT le bloc produit (upload, typologie, libellé) devient figé —
   *  sans exception. Nouvelle image = nouvelle session (Générer → MES Libre). */
  const productLocked = Boolean(batchId)

  const doneJobs = jobs.filter((j) => j.status === 'done' && j.result?.imagePath)
  const typoDisplay =
    typo === 'autre' ? (customTypo?.nm ?? 'Produit') : typo === 'clim' ? 'Cache climatisation' : undefined

  // — écran résultat : progression, temps estimé, récap de la scène —
  const totalVariantes = jobs.length || n
  const pctDone = Math.round((100 * doneJobs.length) / Math.max(1, totalVariantes))
  // Les variantes partent EN PARALLÈLE (limite 10/utilisateur) : le temps restant
  // ≈ la durée d'UNE image du moteur choisi, pas la somme.
  const etaSecs = model === 'flash' ? 10 : quality === '1K' ? 40 : quality === '4K' ? 120 : 60
  const etaLabel = etaSecs < 60 ? `${etaSecs} s` : `${Math.round(etaSecs / 60)} min`
  const decorNm =
    P.decors.find((d) => d.id === decorSel)?.nm ??
    saved.find((d) => `saved-${d.id}` === decorSel)?.name ??
    'décor personnalisé'
  const recapPills = [
    typoDisplay ?? label,
    decorNm,
    NAMES.saison[saison],
    NAMES.light[light],
    RATIOS.find((r) => r.id === ratio)?.nm ?? ratio,
    `${MODEL_LABELS[model]} · ${q.lbl}`,
  ].filter(Boolean)

  const filteredTypos = useMemo(
    () =>
      TYPOS_ALL.filter((t) => !search.trim() || t.nm.toLowerCase().includes(search.trim().toLowerCase())),
    [search]
  )

  // —————————————————————————————————— rendu

  return (
    <div>
      <style>{SCENE_CSS}</style>

      {/* ============ UN SEUL ÉCRAN (28/07/2026) : le rail Génération reste à
          gauche, les variantes s'affichent en haut de la colonne de droite et
          les réglages se replient en résumé dépliable — jamais de bascule. */}
      {
        <>
          <div className="mb-5">
            <h2 className="text-[24px] font-bold tracking-tight mb-0.5">Compose ta scène</h2>
            <p className="text-sm text-text-secondary">
              Ton produit est verrouillé — choisis une ambiance, le moteur s&apos;occupe du reste.
            </p>
          </div>

          <div className="grid lg:grid-cols-[360px_minmax(0,1fr)] gap-6 items-start">
            {/* ===== rail collant : aperçu (composition seulement) + Génération ===== */}
            <div className="lg:sticky lg:top-4 grid gap-3.5 order-first">
              {/* L'aperçu d'ambiance ne sert qu'à composer : dès qu'une MES est
                  générée, il disparaît — les vraies images ont pris le relais. */}
              {!batchId && (
              <div className="bg-white rounded-[16px] border border-border shadow-sm overflow-hidden relative">
                <div
                  className={`mlx-scene ${Object.keys(extras)
                    .filter((k) => extras[k])
                    .map((k) => `on-${k}`)
                    .join(' ')}`}
                  data-typo={P.scene}
                  data-decor={sceneDecor}
                  data-saison={saison}
                  data-meteo={meteo}
                  data-light={light}
                  data-angle={angle}
                  data-cadr={cadr}
                  data-haut={haut}
                  data-compo={compo}
                  data-pdc={pdc}
                  style={{ aspectRatio: String(RATIO_AR[ratio] ?? 1.5) }}
                  dangerouslySetInnerHTML={{ __html: SCENE_SVG }}
                />
                <span className="absolute left-2.5 bottom-2 bg-white/90 rounded-full px-3 py-0.5 text-[10.5px] font-semibold text-text-secondary">
                  Aperçu d&apos;ambiance — pas le rendu final
                </span>
              </div>
              )}

              <div className="bg-white rounded-[16px] border border-border shadow-sm p-3.5 grid gap-2.5">
                <div className="text-[11px] font-bold uppercase tracking-[.08em] text-text-secondary">
                  Génération
                </div>
                <div className="flex items-center gap-2.5">
                  <span className="text-[10.5px] font-bold uppercase tracking-[.07em] text-text-secondary">
                    Images
                  </span>
                  <span className="inline-flex items-center border border-border rounded-[8px] overflow-hidden bg-white">
                    <button
                      className="w-8 h-8 grid place-items-center text-[17px] text-text-secondary hover:text-brand-green"
                      onClick={() => setN((v) => Math.max(1, v - 1))}
                    >
                      −
                    </button>
                    <input
                      className="w-[42px] h-8 text-center font-bold text-sm border-x border-border outline-none focus:bg-brand-green-light/40"
                      value={n}
                      inputMode="numeric"
                      onChange={(e) => {
                        const v = Number.parseInt(e.target.value, 10)
                        if (!Number.isNaN(v)) setN(Math.min(8, Math.max(1, v)))
                      }}
                    />
                    <button
                      className="w-8 h-8 grid place-items-center text-[17px] text-text-secondary hover:text-brand-green"
                      onClick={() => setN((v) => Math.min(8, v + 1))}
                    >
                      ＋
                    </button>
                  </span>
                  <span className="text-[13px] font-bold text-brand-green">
                    {n} MES
                  </span>
                </div>
                <div className="flex items-center gap-2.5">
                  <span className="text-[10.5px] font-bold uppercase tracking-[.07em] text-text-secondary">
                    Ratio
                  </span>
                  <div className="flex gap-1.5 flex-1">
                    {RATIOS.map((r) => (
                      <button
                        key={r.id}
                        onClick={() => setRatio(r.id)}
                        title={r.nm}
                        className={`flex-1 border-[1.5px] rounded-[8px] px-1 py-1.5 grid place-items-center gap-0.5 transition-colors ${
                          ratio === r.id
                            ? 'border-brand-green ring-2 ring-brand-green-light text-brand-green'
                            : 'border-border text-text-secondary hover:border-brand-green'
                        }`}
                      >
                        <span className="border-[1.8px] border-current rounded-[3px]" style={{ width: r.w, height: 16 }} />
                        <span className="text-[10px] font-bold">{r.lbl}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <select
                  className="w-full border border-border rounded-[8px] px-2.5 py-2 text-[12.5px] font-semibold bg-white cursor-pointer"
                  value={model}
                  onChange={(e) => {
                    const m = e.target.value as 'pro' | 'flash'
                    setModel(m)
                    setQuality(m === 'flash' ? '1K' : '2K')
                  }}
                >
                  <option value="pro">Nano Banana Pro</option>
                  <option value="flash">Nano Banana</option>
                </select>
                <div className="grid grid-cols-3 gap-1.5">
                  {qualities.map((qq) => (
                    <button
                      key={qq.id}
                      onClick={() => setQuality(qq.id)}
                      className={`border-[1.5px] rounded-[8px] px-1.5 py-1.5 text-center transition-colors ${
                        quality === qq.id
                          ? 'border-brand-green ring-2 ring-brand-green-light'
                          : 'border-border hover:border-brand-green'
                      }`}
                    >
                      <span className="block font-bold text-[11.5px]">{qq.lbl}</span>
                      <span className="block text-[10px] text-text-secondary tabular-nums">
                        {qq.price.toFixed(2).replace('.', ',')} € · {qq.time.replace(' / image', '')}
                      </span>
                    </button>
                  ))}
                </div>
                <div className="flex items-baseline gap-2">
                  <b className="text-[16px] tabular-nums">≈ {cost} €</b>
                  <span className="text-[11px] text-text-disabled">
                    {q.time} · {RATIOS.find((r) => r.id === ratio)?.nm}
                  </span>
                </div>
                {notice && <div className="text-[12.5px] font-semibold text-brand-red">{notice}</div>}
                <button
                  onClick={launch}
                  disabled={launching}
                  className="group w-full justify-center bg-brand-green hover:bg-brand-green-hover disabled:opacity-60 text-white font-bold text-[14px] rounded-[12px] px-4 py-3 inline-flex items-center gap-2 transition-colors"
                >
                  <PictoIllu name="generer" size={16} />
                  {launching ? 'Lancement…' : `Générer ${n} MES`}
                </button>
              </div>
            </div>

            {/* ===== colonne principale : bandeau réglages AU-DESSUS (replié en
                résumé après lancement, dépliable — produit compris), variantes
                en dessous (order-2 : le code des réglages suit plus bas). ===== */}
            <div className="min-w-0 flex flex-col">
              {/* — Les variantes du lot en cours (affichées SOUS les réglages) — */}
              {batchId && (
                <div className="order-2 mt-5">
                  <div className="flex items-baseline gap-2.5 mb-3 flex-wrap">
                    <h3 className="text-[17px] font-bold">MES</h3>
                    {kept.size > 0 && (
                      <span className="text-[12.5px] text-text-secondary tabular-nums">
                        {kept.size} gardée{kept.size > 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                  {busy && (
                    <div className="max-w-[540px] mb-4">
                      <div className="h-[7px] bg-white border border-border rounded-full overflow-hidden shadow-sm">
                        <span
                          className="block h-full bg-brand-green rounded-full transition-all duration-700"
                          style={{ width: `${Math.max(5, pctDone)}%` }}
                        />
                      </div>
                      <div className="flex items-center gap-2 text-[12px] text-text-secondary mt-1.5">
                        <span className="inline-block animate-spin h-3 w-3 border-2 border-brand-green-light border-t-brand-green rounded-full" />
                        <PhraseAttente />
                        <span className="ml-auto tabular-nums font-semibold">≈ {etaLabel}</span>
                      </div>
                    </div>
                  )}

                  <div className="flex items-center gap-2.5 mb-4 flex-wrap">
                    <button className="pill" onClick={launch} disabled={launching}>
                      ↻ D&apos;autres MES de la même scène
                    </button>
                    <button
                      className="pill"
                      onClick={() => void launchMp()}
                      disabled={pollKick || kept.size === 0}
                      title={kept.size === 0 ? 'Garde au moins une MES d’abord' : 'Carré 2000×2000, bords étendus'}
                    >
                      <PictoIllu name="mp" size={20} className="mr-1" />
                      Passer les gardées en Marketplace
                    </button>
                  </div>

                  <div className="stagger grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
                    {(jobs.length > 0 ? jobs : Array.from({ length: n }, () => null)).map((j, i) => {
                      if (!j || j.status === 'queued' || j.status === 'running') {
                        return (
                          <div
                            key={j?.id ?? `wait-${i}`}
                            className="bg-white rounded-[12px] border-2 border-border overflow-hidden"
                          >
                            <div
                              className="relative grid place-items-center bg-gradient-to-b from-[#fbfdf8] to-brand-green-light/60"
                              style={{ aspectRatio: String(RATIO_AR[ratio] ?? 1.5) }}
                            >
                              {/* petite scène en attente — même langage que les silhouettes */}
                              <svg viewBox="0 0 220 112" className="w-[52%] max-w-[220px] h-auto -mt-4" aria-hidden>
                                <g className="anim-soleil">
                                  <line x1={54} y1={22} x2={58} y2={22} stroke="#b6bdc6" strokeWidth={2} strokeLinecap="round" />
                                  <line x1={30} y1={22} x2={34} y2={22} stroke="#b6bdc6" strokeWidth={2} strokeLinecap="round" />
                                  <line x1={44} y1={8} x2={44} y2={12} stroke="#b6bdc6" strokeWidth={2} strokeLinecap="round" />
                                  <line x1={44} y1={32} x2={44} y2={36} stroke="#b6bdc6" strokeWidth={2} strokeLinecap="round" />
                                  <circle cx={44} cy={22} r={7} fill="#dfe3e8" stroke="#b6bdc6" strokeWidth={1.5} />
                                </g>
                                <g className="anim-nuage">
                                  <ellipse cx={155} cy={21} rx={15} ry={7} fill="#dfe3e8" stroke="#b6bdc6" strokeWidth={1.5} />
                                  <ellipse cx={172} cy={25} rx={10} ry={5} fill="#dfe3e8" stroke="#b6bdc6" strokeWidth={1.5} />
                                </g>
                                <line x1={0} y1={104} x2={220} y2={104} stroke="#c3c9d1" strokeWidth={2} />
                                <rect
                                  x={60}
                                  y={48}
                                  width={100}
                                  height={56}
                                  rx={3}
                                  fill="var(--color-brand-green-light)"
                                  stroke="var(--color-brand-green)"
                                  strokeWidth={2}
                                  strokeDasharray="6 5"
                                  className="animate-pulse"
                                />
                              </svg>
                              <div className="absolute bottom-3 left-3 right-3 text-center">
                                <span className="bg-white/95 border border-border rounded-full text-[10.5px] font-bold px-2.5 py-0.5 text-text-secondary">
                                  MES {j?.payload?.variante ?? i + 1}
                                </span>
                                <PhraseAttente className="block text-[12px] font-medium text-text-secondary mt-1.5" />
                              </div>
                            </div>
                          </div>
                        )
                      }
                      if (j.status === 'error') {
                        return (
                          <div key={j.id} className="bg-white rounded-[12px] border-2 border-brand-red/40 overflow-hidden">
                            <div
                              className="grid place-items-center p-4 text-center"
                              style={{ aspectRatio: String(RATIO_AR[ratio] ?? 1.5) }}
                            >
                              <div>
                                <div className="text-[13px] font-bold text-brand-red mb-1.5">
                                  MES {j.payload?.variante} — échec
                                </div>
                                <div className="text-[12px] text-text-secondary mb-2.5 break-words">{j.error}</div>
                                <button className="pill" onClick={() => regen(j.id)}>
                                  ↻ Réessayer
                                </button>
                              </div>
                            </div>
                          </div>
                        )
                      }
                      const p = j.result?.imagePath
                      if (!p) return null
                      const isKept = kept.has(j.id)
                      return (
                        <div
                          key={j.id}
                          className={`animate-fade-in-up bg-white rounded-[12px] border-2 overflow-hidden transition-colors ${
                            isKept ? 'border-brand-green' : 'border-border'
                          }`}
                        >
                          <button
                            className="relative block w-full"
                            onClick={() => {
                              setStudioRoot(j.id)
                              setStudioVersion(null)
                              setPromptShown(false)
                              setPromptText(null)
                              setFixText('')
                            }}
                            title="Ouvrir le studio (retouche, versions, prompt)"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={imgUrl(p, 800)} alt={`MES ${j.result?.variante ?? ''}`} className="w-full h-auto block" loading="lazy" />
                            {j.result?.variante != null && (
                              <span className="absolute top-2 left-2 bg-white/95 border border-border rounded-full text-[10.5px] font-bold px-2.5 py-0.5 text-text-secondary">
                                MES {j.result.variante}
                              </span>
                            )}
                          </button>
                          <div className="flex items-center gap-2 px-3 py-2.5">
                            <button
                              onClick={() => toggleKeep(j.id)}
                              className={`flex-1 justify-center inline-flex items-center gap-1.5 font-bold text-[12.5px] rounded-[8px] px-3 py-2 border transition-colors ${
                                isKept
                                  ? 'bg-brand-green border-brand-green text-white'
                                  : 'bg-white border-border text-text-secondary hover:border-brand-green hover:text-brand-green'
                              }`}
                            >
                              {isKept ? '✓ Gardée' : 'Garder'}
                            </button>
                            <a
                              href={imgUrl(p)}
                              download={`mes-libre-v${j.result?.variante ?? j.id}.png`}
                              className="pill !px-3"
                              title="Télécharger"
                            >
                              ⬇
                            </a>
                            <button
                              className="pill !px-2.5 !py-1"
                              onClick={() => void mpOne(j.id)}
                              title="Passer cette MES en Marketplace (2000×2000)"
                            >
                              <PictoIllu name="mp" size={26} />
                            </button>
                            <button className="pill !px-3" onClick={() => regen(j.id)} title="Régénérer cette MES">
                              ↻
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  {/* Déclinaisons Marketplace 2000×2000 (jobs « libre-mp » du même lot) */}
                  {(mpJobs.length > 0 || pollKick) && (
                    <div className="mt-6">
                      <h3 className="text-[15.5px] font-bold mb-2.5 flex items-center gap-2">
                        <PictoIllu name="mp" size={17} />
                        Marketplace 2000×2000
                        {(pollKick || mpJobs.some((j) => j.status === 'queued' || j.status === 'running')) && (
                          <span className="text-[12.5px] font-semibold text-text-secondary">
                            <PhraseAttente />
                          </span>
                        )}
                      </h3>
                      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
                        {mpJobs.map((j) => {
                          if (j.status === 'queued' || j.status === 'running') {
                            return (
                              <div key={j.id} className="bg-white rounded-[12px] border-2 border-border overflow-hidden">
                                <div className="aspect-square grid place-items-center bg-surface animate-pulse text-text-disabled text-[13px] font-semibold">
                                  <div className="text-center px-3">
                                    <div>MP</div>
                                    <PhraseAttente className="text-[12px] font-medium mt-0.5" />
                                  </div>
                                </div>
                              </div>
                            )
                          }
                          if (j.status === 'error') {
                            return (
                              <div key={j.id} className="bg-white rounded-[12px] border-2 border-brand-red/40 p-4 text-center">
                                <div className="text-[13px] font-bold text-brand-red mb-1.5">MP — échec</div>
                                <div className="text-[12px] text-text-secondary mb-2.5 break-words">{j.error}</div>
                                <button className="pill" onClick={() => regen(j.id)}>
                                  ↻ Réessayer
                                </button>
                              </div>
                            )
                          }
                          const p = j.result?.deliveryPath
                          if (!p) return null
                          return (
                            <div key={j.id} className="bg-white rounded-[12px] border-2 border-border overflow-hidden">
                              <button className="block w-full" onClick={() => setLightboxPath(p)} title="Agrandir">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={imgUrl(p, 800)} alt="Marketplace 2000×2000" className="w-full h-auto block" loading="lazy" />
                              </button>
                              <div className="flex items-center gap-2 px-3 py-2.5">
                                <span className="text-[12px] font-semibold text-text-secondary flex-1">
                                  2000×2000{j.result?.variante ? ` · MES ${j.result.variante}` : ''}
                                </span>
                                <a
                                  href={imgUrl(p)}
                                  download={`mes-libre-mp-v${j.result?.variante ?? j.id}.jpg`}
                                  className="pill !px-3"
                                  title="Télécharger"
                                >
                                  ⬇
                                </a>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* — Bandeau réglages : UN SEUL bouton bascule, toujours au même
                  endroit en haut — déplié, TOUT se modifie dessous (image
                  produit comprise). — */}
              {batchId && (
                <div className="bg-white rounded-[16px] border border-border shadow-sm px-4 py-3 mb-4 flex items-center gap-2.5 flex-wrap">
                  <span className="text-[11px] font-bold uppercase tracking-[.08em] text-text-secondary">
                    Réglages de la scène
                  </span>
                  {!settingsOpen &&
                    recapPills.map((pill) => (
                      <span
                        key={pill}
                        className="border border-border rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold text-text-secondary"
                      >
                        {pill}
                      </span>
                    ))}
                  <button
                    onClick={() => setSettingsOpen((v) => !v)}
                    className="ml-auto text-[12.5px] font-bold text-brand-green hover:underline"
                  >
                    {settingsOpen ? '▴ Replier' : '✎ Modifier ▾'}
                  </button>
                </div>
              )}
              {(!batchId || settingsOpen) && (
                <>
              {/* — Ton produit : PAS AFFICHÉ DU TOUT dans une session déjà
                  générée (une session = un produit, règle Mathias 28/07) — */}
              {!productLocked && (
              <div className="bg-white rounded-[16px] border border-border shadow-sm p-4 grid gap-3.5 mb-6">
                <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.08em] text-text-secondary">
                  Ton produit
                  <span className="ml-auto normal-case tracking-normal font-semibold text-[11px] text-text-disabled">
                    verrouillé dans la scène (HARD LOCK)
                  </span>
                </div>
                <div className="flex gap-3 items-start flex-wrap">
                  <div className="flex gap-2 flex-wrap items-center">
                    {images.map((img) => (
                      <div
                        key={img.id}
                        className="relative w-[96px] h-[62px] rounded-[8px] border border-border overflow-hidden bg-[repeating-conic-gradient(#eef1f4_0_25%,#fff_0_50%)] bg-[length:12px_12px]"
                        title={img.name}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={img.url} alt={img.name} className="w-full h-full object-contain" />
                        <button
                          onClick={() => {
                            URL.revokeObjectURL(img.url)
                            setImages((cur) => cur.filter((i) => i.id !== img.id))
                          }}
                          className="absolute top-0 right-0 w-5 h-5 grid place-items-center bg-white/90 text-text-secondary hover:text-brand-red text-[12px] font-bold rounded-bl-[8px]"
                          title="Retirer"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                    <button
                      onClick={() => fileRef.current?.click()}
                      className="w-[96px] h-[62px] rounded-[8px] border-2 border-dashed border-brand-green/40 text-brand-green text-[11px] font-bold grid place-items-center hover:bg-brand-green-light/40 transition-colors"
                    >
                      ＋ Image{images.length === 0 ? ' produit' : ''}
                    </button>
                    <input
                      ref={fileRef}
                      type="file"
                      accept=".png,.jpg,.jpeg,.webp"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        if (e.target.files) addFiles(e.target.files)
                        e.target.value = ''
                      }}
                    />
                  </div>
                  <div className="flex-1 min-w-[240px] grid gap-1.5">
                    <input
                      className="w-full border border-border rounded-[8px] px-3 py-2 text-[13px]"
                      value={label}
                      onChange={(e) => setLabel(e.target.value)}
                      placeholder="Type / catégorie — ex. Portail acier avec chapeau de gendarme"
                    />
                    <span className="text-[11px] text-text-disabled">
                      PNG détouré conseillé — l&apos;image part telle quelle en référence, le produit est
                      reproduit à l&apos;identique.
                    </span>
                  </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5">
                  {(['battant', 'coulissant', 'portillon'] as const).map((k) => (
                    <button
                      key={k}
                      onClick={() => pickTypo(k)}
                      className={`relative text-left bg-white rounded-[12px] border-[1.5px] overflow-hidden pb-2.5 transition-all hover:-translate-y-0.5 hover:shadow-lg ${
                        typo === k ? 'border-brand-green ring-[3px] ring-brand-green-light' : 'border-border'
                      }`}
                    >
                      <span className="block border-b border-border px-2.5 pt-2.5 bg-gradient-to-b from-[#fbfdf8] to-brand-green-light">
                        <Silhouette typo={k as Typo} />
                      </span>
                      <span className="block px-2.5 pt-1.5 font-bold text-[12.5px] leading-tight">
                        {k === 'battant' ? 'Portail battant' : k === 'coulissant' ? 'Portail coulissant' : 'Portillon'}
                      </span>
                      {typo === k && typoAuto === 'done' && (
                        <span className="absolute top-1.5 right-1.5 bg-brand-green text-white text-[9px] font-bold uppercase tracking-wide rounded-full px-2 py-0.5">
                          détecté ✓
                        </span>
                      )}
                    </button>
                  ))}
                  <button
                    onClick={() => pickTypo('clim')}
                    className={`relative text-left bg-white rounded-[12px] border-[1.5px] overflow-hidden pb-2.5 transition-all hover:-translate-y-0.5 hover:shadow-lg ${
                      typo === 'clim' ? 'border-brand-green ring-[3px] ring-brand-green-light' : 'border-border'
                    }`}
                  >
                    <span className="block border-b border-border px-2.5 pt-2.5 bg-gradient-to-b from-[#fbfdf8] to-brand-green-light">
                      <SilhouetteClim />
                    </span>
                    <span className="block px-2.5 pt-1.5 font-bold text-[12.5px] leading-tight">
                      Cache climatisation
                    </span>
                    {typo === 'clim' && typoAuto === 'done' && (
                      <span className="absolute top-1.5 right-1.5 bg-brand-green text-white text-[9px] font-bold uppercase tracking-wide rounded-full px-2 py-0.5">
                        détecté ✓
                      </span>
                    )}
                  </button>
                  <button
                    onClick={() => (typo === 'autre' && customTypo ? setModalOpen(true) : setModalOpen(true))}
                    className={`relative text-left bg-white rounded-[12px] border-[1.5px] border-dashed overflow-hidden pb-2.5 transition-all hover:-translate-y-0.5 hover:shadow-lg ${
                      typo === 'autre' ? 'border-brand-green ring-[3px] ring-brand-green-light' : 'border-border'
                    }`}
                  >
                    <span className="grid place-items-center border-b border-border px-2.5 py-4 bg-gradient-to-b from-[#fbfdf8] to-brand-green-light text-brand-green min-h-[62px]">
                      <PictoIllu name="loupe" size={30} />
                    </span>
                    <span className="block px-2.5 pt-1.5 font-bold text-[12.5px] leading-tight">
                      {customTypo?.nm ?? 'Autres produits…'}
                    </span>
                    {typo === 'autre' && typoAuto === 'done' && (
                      <span className="absolute top-1.5 right-1.5 bg-brand-green text-white text-[9px] font-bold uppercase tracking-wide rounded-full px-2 py-0.5">
                        détecté ✓
                      </span>
                    )}
                  </button>
                </div>
                <div className="text-[11.5px] text-text-disabled">
                  {typoAuto === 'pending' ? (
                    <span className="inline-flex items-center gap-1.5 font-semibold text-text-secondary">
                      <span className="inline-block animate-spin h-3 w-3 border-2 border-brand-green-light border-t-brand-green rounded-full" />
                      Détection de la typologie depuis l&apos;image…
                    </span>
                  ) : typoAuto === 'failed' ? (
                    <span className="font-semibold text-amber-700">
                      Typologie non reconnue depuis l&apos;image — choisis-la ci-dessus.
                    </span>
                  ) : (
                    <>
                      Le choix du produit adapte les décors, le formulaire et les petits plus — chaque famille
                      a son profil de réglages.
                    </>
                  )}
                </div>
              </div>
              )}

              {/* — La scène — */}
              <div className="flex items-center gap-3 text-[11px] font-bold uppercase tracking-[.14em] text-text-disabled mb-3.5">
                La scène<span className="flex-1 h-px bg-border" />
              </div>

              <div className="grid gap-5 mb-6">
                <div className="bg-white rounded-[16px] border border-border shadow-sm p-4">
                  <div className="flex items-baseline gap-2.5 mb-3">
                    <h3 className="text-[15.5px] font-bold">Le décor</h3>
                    <span className="text-[12px] text-text-disabled">
                      réponds, on écrit pour toi — pas de prompting
                    </span>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5 mb-3">
                    {P.df.map((f) => (
                      <label key={f.id} className="block">
                        <span className="block text-[10.5px] font-bold uppercase tracking-[.06em] text-text-secondary mb-1">
                          {f.lbl}
                        </span>
                        <select
                          className="w-full border border-border rounded-[8px] px-2 py-1.5 text-[12.5px] bg-white cursor-pointer"
                          value={dfVals[f.id]}
                          onChange={(e) => setDf(f.id, e.target.value)}
                        >
                          {f.opts.map(([v, l]) => (
                            <option key={v} value={v}>
                              {l}
                            </option>
                          ))}
                        </select>
                      </label>
                    ))}
                  </div>
                  <textarea
                    className="w-full border border-border rounded-[10px] px-3 py-2.5 text-[13px] min-h-[88px] resize-y bg-[#fbfcfd]"
                    value={desc}
                    onChange={(e) => setDesc(e.target.value)}
                  />
                  <div className="flex items-center gap-2.5 mt-1.5 flex-wrap">
                    <span className="text-[11px] text-text-disabled flex-1 min-w-[200px]">
                      La description est composée depuis tes réponses — ajustable à la main, c&apos;est elle qui
                      part dans le prompt.
                    </span>
                    {desc !== cleanDescRef.current && (
                      <button
                        className="text-[12px] font-semibold text-text-secondary border border-border rounded-[8px] px-2.5 py-1 hover:text-brand-green hover:border-brand-green"
                        onClick={() => setDesc(cleanDescRef.current)}
                      >
                        ↺ Annuler mes retouches
                      </button>
                    )}
                  </div>
                  <div className="text-[11px] text-text-disabled mt-3">Ou repars d&apos;un décor prêt :</div>
                  <div className="flex gap-2 flex-wrap mt-1.5 items-center">
                    {P.decors.map((d) => (
                      <button
                        key={d.id}
                        title={d.tg}
                        onClick={() => pickDecor(d)}
                        className={`inline-flex items-center gap-1.5 border-[1.5px] rounded-full pl-1.5 pr-3 py-1 text-[12px] font-semibold transition-colors ${
                          decorSel === d.id && desc === d.desc
                            ? 'border-brand-green bg-brand-green-light text-brand-green'
                            : 'border-border text-text-secondary hover:border-brand-green'
                        }`}
                      >
                        <Thumb
                          svg={d.th}
                          className="block w-[28px] h-[19px] rounded-[5px] overflow-hidden [&>svg]:w-full [&>svg]:h-full [&>svg]:block"
                        />
                        {d.nm}
                      </button>
                    ))}
                    {saved.map((d) => (
                      <span
                        key={d.id}
                        className={`inline-flex items-center gap-1 border-[1.5px] rounded-full pl-3 pr-1.5 py-1 text-[12px] font-semibold transition-colors ${
                          decorSel === `saved-${d.id}` && desc === d.description
                            ? 'border-brand-green bg-brand-green-light text-brand-green'
                            : 'border-border text-text-secondary'
                        }`}
                      >
                        <button onClick={() => pickSaved(d)} className="hover:text-brand-green" title={`Décor enregistré${d.created_by ? ` par ${d.created_by}` : ''}`}>
                          {d.name}
                        </button>
                        <button
                          onClick={() => void deleteSaved(d)}
                          className="w-4 h-4 grid place-items-center text-[10px] text-text-disabled hover:text-brand-red"
                          title="Supprimer ce décor enregistré (auteur ou admin)"
                        >
                          ✕
                        </button>
                      </span>
                    ))}
                    {saveOpen ? (
                      <span className="inline-flex items-center gap-1.5">
                        <input
                          autoFocus
                          className="border border-border rounded-full px-3 py-1 text-[12px] w-[180px]"
                          placeholder="Nom du décor…"
                          value={saveName}
                          onChange={(e) => setSaveName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void saveDecor()
                            if (e.key === 'Escape') setSaveOpen(false)
                          }}
                        />
                        <button
                          onClick={() => void saveDecor()}
                          disabled={saveBusy || !saveName.trim()}
                          className="rounded-full bg-brand-green hover:bg-brand-green-hover disabled:opacity-50 text-white text-[12px] font-bold px-3 py-1"
                        >
                          {saveBusy ? '…' : 'OK'}
                        </button>
                        <button
                          onClick={() => setSaveOpen(false)}
                          className="text-[12px] text-text-disabled hover:text-text-primary"
                        >
                          annuler
                        </button>
                      </span>
                    ) : (
                      <button
                        onClick={() => setSaveOpen(true)}
                        className="inline-flex items-center border-[1.5px] border-dashed border-border rounded-full px-3 py-1 text-[12px] font-semibold text-brand-green hover:border-brand-green transition-colors"
                        title="Enregistre la description actuelle comme décor partagé"
                      >
                        ＋ Enregistrer ce décor
                      </button>
                    )}
                  </div>
                </div>

                <div className="grid md:grid-cols-2 gap-5">
                  <ChoiceGroup titre="La saison" sous="la végétation suit" cols={2} items={SAISONS} value={saison} onChange={setSaison} />
                  <ChoiceGroup titre="La météo" sous="le ciel du jour" cols={2} items={METEOS} value={meteo} onChange={setMeteo} />
                </div>
              </div>

              {/* — La photo — */}
              <div className="flex items-center gap-3 text-[11px] font-bold uppercase tracking-[.14em] text-text-disabled mb-3.5">
                La photo<span className="flex-1 h-px bg-border" />
              </div>
              <div className="grid gap-5 mb-6">
                <ChoiceGroup titre="La lumière" sous="l'heure de la prise de vue" cols={4} items={LIGHTS} value={light} onChange={setLight} />
                <div className="grid md:grid-cols-2 gap-5">
                  <ChoiceGroup titre="L'angle de vue" sous="où se place le photographe" cols={3} items={ANGLES} value={angle} onChange={setAngle} />
                  <ChoiceGroup titre="Le cadrage" sous="la distance" cols={3} items={CADRAGES} value={cadr} onChange={setCadr} />
                </div>
                <div className="grid md:grid-cols-2 gap-5">
                  <ChoiceGroup titre="La hauteur de caméra" sous="le point de vue" cols={3} items={HAUTEURS} value={haut} onChange={setHaut} />
                  <ChoiceGroup titre="La composition" sous="la place dans le cadre" cols={3} items={COMPOS} value={compo} onChange={setCompo} />
                </div>
                <ChoiceGroup titre="La netteté" sous="le fond, flou ou piqué" cols={2} items={PDCS} value={pdc} onChange={setPdc} />
              </div>

              {/* — Les détails — */}
              <div className="flex items-center gap-3 text-[11px] font-bold uppercase tracking-[.14em] text-text-disabled mb-3.5">
                Les détails<span className="flex-1 h-px bg-border" />
              </div>
              <div className="mb-6">
                <div className="flex items-baseline gap-2.5 mb-2.5">
                  <h3 className="text-[15.5px] font-bold">Les petits plus</h3>
                  <span className="text-[12px] text-text-disabled">
                    active ce que la scène doit raconter — tout se voit dans l&apos;aperçu
                  </span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                  {P.plus.map((x) => (
                    <button
                      key={x.id}
                      onClick={() => setExtras((prev) => ({ ...prev, [x.id]: !prev[x.id] }))}
                      className={`border-[1.5px] rounded-[12px] px-2 pt-2.5 pb-2 grid justify-items-center gap-1.5 text-center text-[12px] font-semibold transition-all hover:-translate-y-0.5 hover:shadow-lg ${
                        extras[x.id]
                          ? 'border-brand-green ring-[3px] ring-brand-green-light text-brand-green-hover'
                          : 'border-border text-text-secondary hover:border-brand-green'
                      }`}
                    >
                      <Thumb svg={x.ic} className="block w-[26px] h-[26px] [&>svg]:w-full [&>svg]:h-full" />
                      {x.lbl}
                    </button>
                  ))}
                </div>
                <div className="text-[11px] text-text-disabled mt-2.5">
                  Chaque petit plus est un morceau de prompt — jamais de personnage, jamais de texte. Astuce :
                  luminaires + tombée de la nuit = ils s&apos;allument.
                </div>
              </div>

              {/* — prompt — */}
              <div className="text-[12.5px] text-text-disabled mb-8">
                Ces éléments partent au <b className="text-text-secondary">Prompt Specialist</b> (IA) qui
                écrit le brief photo final en anglais — gabarit{' '}
                <b className="text-text-secondary">« libre-prompt-specialist »</b> (Admin → Prompts), HARD
                LOCK PRODUCT en dernière ligne. Le prompt réellement envoyé est archivé avec chaque MES. ·{' '}
                <button className="text-brand-green font-semibold" onClick={() => setPromptOpen((v) => !v)}>
                  voir les éléments du brief {promptOpen ? '▴' : '▾'}
                </button>
                {promptOpen && (
                  <pre className="mt-2.5 bg-[#1f2937] text-[#d7dde5] rounded-[12px] p-4 text-[11.5px] leading-relaxed whitespace-pre-wrap break-words font-mono">
                    {`PRODUIT — ${label || '(à préciser)'}\nSCÈNE — ${desc}\nCONDITIONS — ${conditionsText}\nCAMÉRA — ${cameraText}${detailsText ? `\nDÉTAILS — ${detailsText}` : ''}`}
                  </pre>
                )}
              </div>

              {batchId && (
                <button className="pill mb-2 self-start" onClick={() => setSettingsOpen(false)}>
                  ▴ Replier les réglages
                </button>
              )}
                </>
              )}
            </div>
          </div>

          {/* fenêtre : autres typologies */}
          {modalOpen && (
            <div
              className="fixed inset-0 z-50 bg-black/45 grid place-items-center p-4"
              onClick={(e) => {
                if (e.target === e.currentTarget) setModalOpen(false)
              }}
            >
              <div className="bg-white rounded-[16px] shadow-xl w-full max-w-lg p-5">
                <h3 className="text-lg font-bold mb-0.5">Quel produit ?</h3>
                <p className="text-[12.5px] text-text-secondary mb-3">
                  Toutes les typologies prises en charge — chacune a son profil de réglages
                  (décors, formulaire, petits plus adaptés).
                </p>
                <input
                  autoFocus
                  className="w-full border border-border rounded-[8px] px-3 py-2.5 text-sm"
                  placeholder="Rechercher… (pergola, clôture, table…)"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <div className="grid gap-1.5 mt-3 max-h-[300px] overflow-auto">
                  {filteredTypos.map((t) => (
                    <button
                      key={t.nm}
                      onClick={() => pickCustomTypo(t)}
                      className="flex items-baseline justify-between gap-2.5 border-[1.5px] border-border rounded-[10px] px-3 py-2.5 text-left font-semibold text-[13.5px] hover:border-brand-green transition-colors"
                    >
                      {t.nm}
                      <span className="text-[11.5px] font-normal text-text-disabled">{t.marque}</span>
                    </button>
                  ))}
                  {filteredTypos.length === 0 && (
                    <div className="text-[13px] text-text-disabled py-2">Aucun produit trouvé.</div>
                  )}
                </div>
                <button
                  className="mt-3 text-sm font-semibold text-text-secondary hover:text-brand-red transition-colors"
                  onClick={() => setModalOpen(false)}
                >
                  Annuler
                </button>
              </div>
            </div>
          )}
        </>
      }

      {/* ============ STUDIO MES : grand écran + versions + retouche + prompt ============ */}
      {studioRoot != null &&
        (() => {
          const root = jobs.find((j) => j.id === studioRoot)
          if (!root) return null
          const versions = [
            root,
            ...fixJobs
              .filter((f) => (f.payload?.rootJobId ?? f.result?.rootJobId) === studioRoot)
              .sort((a, b) => a.id - b.id),
          ]
          const doneVersions = versions.filter((v) => v.status === 'done' && v.result?.imagePath)
          const displayed =
            (studioVersion != null ? doneVersions.find((v) => v.id === studioVersion) : undefined) ??
            doneVersions[doneVersions.length - 1] ??
            root
          const dp = displayed.result?.imagePath
          const fixPending = versions.some((v) => v.status === 'queued' || v.status === 'running')
          const order = jobs.filter((j) => j.status === 'done' && j.result?.imagePath)
          const idx = order.findIndex((j) => j.id === studioRoot)
          const go = (d: number) => {
            const nx = order[idx + d]
            if (nx) {
              setStudioRoot(nx.id)
              setStudioVersion(null)
              setPromptShown(false)
              setPromptText(null)
              setFixText('')
            }
          }
          const modelLabel =
            root.payload?.model === 'gemini-3.1-flash-image' ? 'Nano Banana' : 'Nano Banana Pro'
          const togglePrompt = async () => {
            if (promptShown) {
              setPromptShown(false)
              return
            }
            setPromptShown(true)
            if (promptText == null && root.result?.promptPath) {
              try {
                const t = await fetch(imgUrl(root.result.promptPath)).then((r) =>
                  r.ok ? r.text() : null
                )
                setPromptText(t ?? 'Prompt introuvable.')
              } catch {
                setPromptText('Prompt introuvable.')
              }
            }
          }
          return (
            <div className="fixed inset-0 z-50 bg-black/85 flex">
              {/* aperçu : zoom molette + drag, galerie des versions dessous */}
              <div className="flex-1 min-w-0 flex flex-col">
                <div
                  ref={viewerRef}
                  className={`flex-1 relative overflow-hidden grid place-items-center p-6 ${
                    zoom > 1 ? (dragRef.current ? 'cursor-grabbing' : 'cursor-grab') : ''
                  }`}
                  onPointerDown={(e) => {
                    if (zoom <= 1) return
                    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: pan.x, oy: pan.y }
                  }}
                  onPointerMove={(e) => {
                    const d = dragRef.current
                    if (!d) return
                    setPan({ x: d.ox + e.clientX - d.sx, y: d.oy + e.clientY - d.sy })
                  }}
                  onPointerUp={() => {
                    dragRef.current = null
                  }}
                  onPointerLeave={() => {
                    dragRef.current = null
                  }}
                  onDoubleClick={() => {
                    setZoom(1)
                    setPan({ x: 0, y: 0 })
                  }}
                >
                  {dp && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={imgUrl(dp)}
                      alt=""
                      draggable={false}
                      style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
                      className="max-w-full max-h-full rounded-[10px] shadow-2xl select-none transition-transform duration-75"
                    />
                  )}
                  {idx > 0 && (
                    <button
                      onClick={() => go(-1)}
                      className="absolute left-4 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/90 text-text-primary text-xl font-bold grid place-items-center shadow-lg hover:bg-white"
                      title="MES précédente (←)"
                    >
                      ‹
                    </button>
                  )}
                  {idx >= 0 && idx < order.length - 1 && (
                    <button
                      onClick={() => go(1)}
                      className="absolute right-4 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/90 text-text-primary text-xl font-bold grid place-items-center shadow-lg hover:bg-white"
                      title="MES suivante (→)"
                    >
                      ›
                    </button>
                  )}
                </div>

                {/* sous l'image : zoom (molette, curseur, double-clic = 100 %) */}
                <div className="shrink-0 px-6 pt-1 flex justify-end">
                  <div className="bg-black/70 rounded-full px-3.5 py-1.5 flex items-center gap-2.5">
                    <span className="text-white text-[12px] font-bold tabular-nums w-[42px]">
                      {Math.round(zoom * 100)}%
                    </span>
                    <input
                      type="range"
                      min={100}
                      max={400}
                      value={Math.round(zoom * 100)}
                      onChange={(e) => {
                        const z = Number(e.target.value) / 100
                        setZoom(z)
                        if (z === 1) setPan({ x: 0, y: 0 })
                      }}
                      className="w-[110px] accent-brand-green cursor-pointer"
                    />
                  </div>
                </div>

                {/* puis la galerie des versions */}
                <div className="shrink-0 px-6 pb-4 pt-2 flex gap-2 justify-center flex-wrap">
                  {doneVersions.map((v, i) => (
                    <button
                      key={v.id}
                      onClick={() => setStudioVersion(v.id)}
                      className={`relative w-[92px] h-[60px] rounded-[8px] border-2 overflow-hidden ${
                        displayed.id === v.id
                          ? 'border-brand-green ring-2 ring-brand-green/40'
                          : 'border-white/25 hover:border-brand-green/70'
                      }`}
                      title={v.result?.instruction ? `V${i + 1} — ${v.result.instruction}` : `V${i + 1}`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={imgUrl(v.result!.imagePath!, 200)} alt="" className="w-full h-full object-cover" />
                      <span className="absolute bottom-0 left-0 bg-white/95 text-[9.5px] font-bold px-1.5 rounded-tr-[6px] text-text-secondary">
                        V{i + 1}
                      </span>
                    </button>
                  ))}
                  {fixPending && (
                    <div className="w-[92px] h-[60px] rounded-[8px] border-2 border-white/25 bg-white/10 animate-pulse grid place-items-center text-[10px] font-bold text-white/70">
                      retouche…
                    </div>
                  )}
                  {versions
                    .filter((v) => v.status === 'error' && v.type === 'libre-fix')
                    .map((v) => (
                      <button
                        key={v.id}
                        onClick={() => regen(v.id)}
                        className="w-[92px] h-[60px] rounded-[8px] border-2 border-brand-red/60 grid place-items-center text-[10px] font-bold text-brand-red bg-white/90"
                        title={`${v.error ?? 'échec'} — cliquer pour réessayer`}
                      >
                        échec ↻
                      </button>
                    ))}
                </div>
              </div>

              {/* panneau latéral */}
              <div className="w-[380px] max-w-[92vw] bg-white h-full overflow-y-auto p-5 grid gap-4 content-start">
                <div className="flex items-center gap-2">
                  <h3 className="text-[17px] font-bold">
                    MES {root.result?.variante ?? root.payload?.variante ?? ''}
                  </h3>
                  <span className="text-[12px] text-text-secondary truncate flex-1">
                    {root.payload?.productLabel ?? label}
                  </span>
                  <button
                    onClick={() => setStudioRoot(null)}
                    className="w-8 h-8 grid place-items-center rounded-full border border-border text-text-secondary hover:text-brand-red hover:border-brand-red/40"
                    title="Fermer (Échap)"
                  >
                    ✕
                  </button>
                </div>

                {/* réglages du tirage */}
                <div className="flex gap-1.5 flex-wrap">
                  {[
                    modelLabel,
                    root.payload?.imageSize,
                    root.payload?.aspectRatio,
                    displayed.result?.width && displayed.result?.height
                      ? `${displayed.result.width}×${displayed.result.height} px`
                      : null,
                  ]
                    .filter(Boolean)
                    .map((b) => (
                      <span
                        key={String(b)}
                        className="border border-border rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold text-text-secondary"
                      >
                        {b}
                      </span>
                    ))}
                </div>

                {/* retouche par consigne */}
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-[.08em] text-text-secondary mb-1.5">
                    Retoucher cette version
                  </div>
                  <textarea
                    className="w-full border border-border rounded-[10px] px-3 py-2.5 text-[13px] min-h-[70px] resize-y"
                    placeholder="Décris la retouche — ex. « enlève la voiture », « ciel un peu plus chaud », « allée en pavés »…"
                    value={fixText}
                    onChange={(e) => setFixText(e.target.value)}
                  />
                  <button
                    onClick={() => void fixMes(displayed.id)}
                    disabled={fixBusy || fixPending || !fixText.trim()}
                    className="mt-1.5 w-full justify-center bg-brand-green hover:bg-brand-green-hover disabled:opacity-50 text-white font-bold text-[13px] rounded-[10px] px-4 py-2.5 inline-flex items-center gap-2 transition-colors"
                  >
                    <PictoIllu name="generer" size={15} />
                    {fixPending ? 'Retouche en cours…' : 'Retoucher — nouvelle version'}
                  </button>
                  <div className="text-[11px] text-text-disabled mt-1">
                    Le produit reste HARD LOCK — seule la scène est retouchée. Chaque retouche crée une
                    version, l&apos;originale est conservée.
                  </div>
                </div>

                {/* prompt réellement envoyé */}
                <div>
                  <button className="text-[12.5px] font-semibold text-brand-green" onClick={() => void togglePrompt()}>
                    {promptShown ? '▴ Masquer le prompt envoyé' : '▾ Voir le prompt envoyé'}
                  </button>
                  {promptShown && (
                    <div className="mt-1.5">
                      <pre className="bg-[#1f2937] text-[#d7dde5] rounded-[10px] p-3 text-[11px] leading-relaxed whitespace-pre-wrap break-words font-mono max-h-[220px] overflow-y-auto">
                        {promptText ?? 'Chargement…'}
                      </pre>
                      {promptText && (
                        <button
                          className="pill mt-1.5 !text-[12px]"
                          onClick={() => void navigator.clipboard.writeText(promptText)}
                        >
                          Copier le prompt
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* actions */}
                <div className="flex gap-2 flex-wrap border-t border-border pt-3.5">
                  {dp && (
                    <a href={imgUrl(dp)} download={`mes-libre-${root.result?.variante ?? root.id}.png`} className="pill">
                      ⬇ Télécharger
                    </a>
                  )}
                  <button
                    className="pill"
                    onClick={() => void mpOne(displayed.id)}
                    title="Passer cette version en Marketplace (2000×2000)"
                  >
                    <PictoIllu name="mp" size={22} className="mr-1" />
                    Marketplace
                  </button>
                  <button
                    className="pill"
                    onClick={() => {
                      regen(root.id)
                      setStudioRoot(null)
                    }}
                    title="Régénérer entièrement cette MES (nouveau tirage)"
                  >
                    ↻ Régénérer
                  </button>
                </div>
              </div>
            </div>
          )
        })()}

      {/* — zoom plein écran — */}
      {lightboxPath && (
        <div
          className="fixed inset-0 z-50 bg-black/80 grid place-items-center p-5 cursor-zoom-out"
          onClick={() => setLightboxPath(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imgUrl(lightboxPath)} alt="" className="max-w-full max-h-full rounded-[8px] shadow-2xl" />
        </div>
      )}
    </div>
  )
}
