'use client'

import { usePathname } from 'next/navigation'

/**
 * Entrée de page animée (28/07/2026, demande Mathias « de la vie partout ») :
 * le contenu fond et remonte légèrement à CHAQUE navigation. La clé sur le
 * chemin force React à remonter le bloc, donc l'animation CSS rejoue même
 * quand on passe d'une page à l'autre côté client.
 */
export default function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  return (
    <div key={pathname} className="anim-page">
      {children}
    </div>
  )
}
