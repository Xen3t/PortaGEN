/**
 * État d'attente commun (28/07/2026, retour Mathias : « c'est censé être
 * animé », puis « un truc centré au milieu ») : grande roue verte centrée au
 * milieu de la zone de page, texte qui respire en dessous — même style que
 * l'écran « Chargement de la session… » de la page Générer.
 *
 * `inline` : version compacte sur une ligne (roue 16 px + texte) pour les
 * petits espaces — menu de recherche, panneaux d'atelier.
 * `plein=false` : la grande roue sans la pleine hauteur, pour les zones qui
 * centrent déjà leur contenu (zone image du Studio MES).
 */
export default function Chargement({
  label = 'Chargement…',
  inline = false,
  plein = true,
}: {
  label?: string
  inline?: boolean
  plein?: boolean
}) {
  if (inline) {
    return (
      <span className="inline-flex items-center gap-2.5 text-sm text-text-secondary">
        <span className="inline-block w-4 h-4 rounded-full border-2 border-brand-green-light border-t-brand-green animate-spin" />
        <span className="anim-respire">{label}</span>
      </span>
    )
  }
  const bloc = (
    <div className="text-center">
      <span className="inline-block w-10 h-10 rounded-full border-4 border-brand-green-light border-t-brand-green animate-spin mb-4" />
      <p className="text-sm font-semibold text-text-secondary anim-respire">{label}</p>
    </div>
  )
  if (!plein) return bloc
  return <div className="min-h-[60vh] grid place-items-center">{bloc}</div>
}
