'use client'

import { useEffect, useState } from 'react'

/**
 * Faux texte d'attente pendant une génération : une phrase d'ambiance qui
 * change toutes les quelques secondes à la place d'un « Génération en cours… »
 * statique. Chaque instance démarre sur une phrase au hasard, pour que deux
 * vignettes côte à côte ne racontent pas la même chose.
 */

const PHRASES = [
  'Pose du portail au millimètre près…',
  'Vérification de l’aplomb des piliers…',
  'Application du coloris exact…',
  'Polissage de l’aluminium…',
  'Serrage des dernières vis…',
  'Réglage de la lumière du soleil…',
  'Tonte de la pelouse avant la photo…',
  'Taille de la haie du voisin…',
  'On pousse la voiture qui gênait le cadre…',
  'Recherche du meilleur angle de vue…',
  'Nettoyage de l’objectif…',
  'Les ombres se mettent en place…',
  'Le photographe recule de trois pas…',
  'Négociation avec les nuages…',
  'On demande au chien de sortir du cadre…',
  'Dernier coup de chiffon avant la photo…',
]

export default function PhraseAttente({ className = '' }: { className?: string }) {
  // Démarre sur la première phrase côté serveur (hydratation stable), puis
  // tire au sort au montage avant de tourner en boucle.
  const [index, setIndex] = useState(0)
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    setIndex(Math.floor(Math.random() * PHRASES.length))
    let fade: ReturnType<typeof setTimeout> | undefined
    const timer = setInterval(() => {
      setVisible(false)
      fade = setTimeout(() => {
        setIndex((i) => (i + 1) % PHRASES.length)
        setVisible(true)
      }, 220)
    }, 4000)
    return () => {
      clearInterval(timer)
      if (fade) clearTimeout(fade)
    }
  }, [])

  return (
    <span
      className={`inline-block transition-opacity duration-200 ${visible ? 'opacity-100' : 'opacity-0'} ${className}`}
    >
      {PHRASES[index]}
    </span>
  )
}
