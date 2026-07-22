import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { config } from '@/lib/config'
import { hashPassword, generatePassword } from '@/lib/auth/password'

let instance: Database.Database | null = null

/**
 * Base SQLite singleton. `filename` n'est paramétrable que pour les tests (':memory:').
 */
export function getDb(filename?: string): Database.Database {
  if (filename) {
    const db = new Database(filename)
    migrate(db, { ephemeral: true })
    return db
  }
  if (!instance) {
    fs.mkdirSync(path.dirname(config.dbPath), { recursive: true })
    instance = new Database(config.dbPath)
    instance.pragma('journal_mode = WAL')
    migrate(instance, { ephemeral: false })
  }
  return instance
}

interface MigrateOptions {
  /** true pour les bases de test : seeds déterministes, aucune écriture de fichier */
  ephemeral: boolean
}

export function migrate(db: Database.Database, opts: MigrateOptions = { ephemeral: false }): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sizes (
      id INTEGER PRIMARY KEY,
      width_cm INTEGER NOT NULL,
      height_cm INTEGER NOT NULL,
      label TEXT NOT NULL,
      sort INTEGER NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      moteur TEXT NOT NULL DEFAULT 'battant',
      UNIQUE (label, moteur)
    );

    CREATE TABLE IF NOT EXISTS backgrounds (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      moodboard_path TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      payload TEXT,
      result TEXT,
      error TEXT,
      regen_count INTEGER NOT NULL DEFAULT 0,
      review_status TEXT NOT NULL DEFAULT 'pending',
      reviewed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS api_calls (
      id INTEGER PRIMARY KEY,
      job_id INTEGER,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      kind TEXT NOT NULL,
      duration_ms INTEGER,
      input_tokens INTEGER,
      output_tokens INTEGER,
      total_tokens INTEGER,
      ok INTEGER NOT NULL,
      error TEXT,
      artifact_path TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'user')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS prompts (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      version INTEGER NOT NULL,
      content TEXT NOT NULL,
      comment TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (name, version)
    );

    CREATE TABLE IF NOT EXISTS size_params (
      label TEXT PRIMARY KEY,
      params TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS decors (
      id INTEGER PRIMARY KEY,
      file_path TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      gamme TEXT,
      type TEXT NOT NULL DEFAULT 'battant' CHECK (type IN ('battant', 'coulissant', 'portillon', 'coulissant-xl')),
      angle TEXT NOT NULL DEFAULT 'face' CHECK (angle IN ('face', 'angle')),
      status TEXT NOT NULL DEFAULT 'a_valider' CHECK (status IN ('a_valider', 'actif', 'archive')),
      image_size TEXT,
      width INTEGER,
      height INTEGER,
      moodboard_path TEXT,
      job_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS decor_tags (
      decor_id INTEGER NOT NULL REFERENCES decors(id),
      tag TEXT NOT NULL,
      UNIQUE (decor_id, tag)
    );

    CREATE TABLE IF NOT EXISTS decor_favorites (
      user_id INTEGER NOT NULL REFERENCES users(id),
      decor_id INTEGER NOT NULL REFERENCES decors(id),
      UNIQUE (user_id, decor_id)
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS decor_versions (
      id INTEGER PRIMARY KEY,
      decor_id INTEGER NOT NULL REFERENCES decors(id),
      version INTEGER NOT NULL,
      file_path TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'initial' CHECK (kind IN ('initial', 'correction', 'restauration')),
      instruction TEXT,
      job_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (decor_id, version)
    );

    -- Catalogue vivant (cadrage 12/07/2026) : pages produit créées par le scan
    -- LECTURE SEULE du serveur de fichiers. summary = JSON (tailles, coloris,
    -- vues, PNG, MES existantes, avertissements) — souple tant que les
    -- conventions de nommage du serveur varient.
    CREATE TABLE IF NOT EXISTS catalog_products (
      id INTEGER PRIMARY KEY,
      brand TEXT NOT NULL,
      family TEXT NOT NULL,
      name TEXT NOT NULL,
      server_path TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'detecte' CHECK (status IN ('detecte', 'a_completer')),
      summary TEXT NOT NULL,
      -- Références (coloris|taille) apparues AU DERNIER SCAN vs le scan précédent
      -- → étiquette « NOUVEAU » de la grille (bloc 3.4). Disparaît au scan suivant.
      new_refs TEXT NOT NULL DEFAULT '[]',
      last_scan_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Réglages par défaut PAR COLORIS d'une gamme (maquette page produit v6,
    -- validée le 12/07/2026) : décor, alignement sol, formats — utilisés par
    -- tous les boutons « Générer » du coloris. settings = JSON.
    CREATE TABLE IF NOT EXISTS catalog_coloris_settings (
      product_id INTEGER NOT NULL REFERENCES catalog_products(id),
      coloris TEXT NOT NULL,
      settings TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (product_id, coloris)
    );

    -- Détourage JPG → PNG (chantier 2) : PNG produit stockés EN LOCAL (data/)
    -- tant que l'écriture serveur n'est pas autorisée. Un PNG « valide » ou
    -- « importe » rend la référence générable. source_rel = fichier de la gamme
    -- détouré (null si import) ; png_path = chemin local du PNG.
    -- Coloris CORRIGÉ à la main sur la fiche produit (12/07/2026). Le coloris est
    -- d'abord lu dans les noms de dossiers, sinon DEVINÉ depuis l'image ; s'il se
    -- trompe, l'utilisateur choisit le bon dans le menu déroulant du titre de la
    -- carte. On stocke la correction par (produit, coloris d'origine tel que scanné).
    CREATE TABLE IF NOT EXISTS catalog_coloris_override (
      product_id INTEGER NOT NULL REFERENCES catalog_products(id),
      coloris_key TEXT NOT NULL,
      coloris TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (product_id, coloris_key)
    );

    -- Sessions de génération directe (validé le 13/07/2026, maquette sessions-v1) :
    -- un lancement depuis la page « Génération » = une session qu'on peut rouvrir
    -- depuis l'accueil (résultats, téléchargements, passage MP). Les jobs restent
    -- la source de vérité (rattachés par batch_id) — la session porte ce que les
    -- jobs ne connaissent pas : le nom du produit et le décor choisi.
    CREATE TABLE IF NOT EXISTS generation_sessions (
      batch_id TEXT PRIMARY KEY,
      produit TEXT NOT NULL DEFAULT '',
      moteur TEXT NOT NULL DEFAULT 'battant',
      decor_id INTEGER,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Lancements de gamme masqués de « Mes sessions » (16/07/2026) : une carte
    -- Catalogue n'a pas de ligne de session (résumé recalculé depuis les jobs),
    -- son ✕ inscrit donc le lot ici — jobs et images conservés, la gamme reste
    -- consultable depuis le Catalogue.
    CREATE TABLE IF NOT EXISTS hidden_session_batches (
      batch_id TEXT PRIMARY KEY,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Retours utilisateurs (13/07/2026) : envoyés depuis le bouton flottant « ? »
    -- présent en bas à droite de toutes les pages (repris de HoorTRADS).
    -- Consultation et suppression dans Admin → Feedback.
    CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      username TEXT,
      category TEXT NOT NULL DEFAULT 'general',
      message TEXT NOT NULL,
      page_url TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS detourages (
      id INTEGER PRIMARY KEY,
      product_id INTEGER NOT NULL REFERENCES catalog_products(id),
      coloris TEXT NOT NULL,
      size_label TEXT NOT NULL,
      source_rel TEXT,
      png_path TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'a_valider'
        CHECK (status IN ('a_valider', 'valide', 'importe', 'ignore')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (product_id, coloris, size_label)
    );
  `)

  // Bases créées avant l'ajout des colonnes de validation : migration douce.
  const jobCols = (db.prepare(`PRAGMA table_info(jobs)`).all() as { name: string }[]).map(
    (c) => c.name
  )
  if (!jobCols.includes('review_status')) {
    db.exec(`ALTER TABLE jobs ADD COLUMN review_status TEXT NOT NULL DEFAULT 'pending'`)
  }
  if (!jobCols.includes('reviewed_at')) {
    db.exec(`ALTER TABLE jobs ADD COLUMN reviewed_at TEXT`)
  }
  // Groupe de génération : un lancement de gamme = un batch, suivi sur une page unique.
  if (!jobCols.includes('batch_id')) {
    db.exec(`ALTER TABLE jobs ADD COLUMN batch_id TEXT`)
  }
  // Lanceur du job : support de la limite de générations simultanées PAR UTILISATEUR.
  if (!jobCols.includes('created_by')) {
    db.exec(`ALTER TABLE jobs ADD COLUMN created_by TEXT`)
  }
  // LAB (refonte lab-v1, 22/07/2026) : essai archivé = masqué de la liste des
  // essais du LAB, images et mesures conservées (consultable via « Archives »).
  if (!jobCols.includes('lab_archived_at')) {
    db.exec(`ALTER TABLE jobs ADD COLUMN lab_archived_at TEXT`)
  }

  // Marque active PAR UTILISATEUR (navigation v2, 12/07/2026) : migration douce.
  const userCols = (db.prepare(`PRAGMA table_info(users)`).all() as { name: string }[]).map(
    (c) => c.name
  )
  if (!userCols.includes('brand')) {
    db.exec(`ALTER TABLE users ADD COLUMN brand TEXT NOT NULL DEFAULT 'casanoov'`)
  }

  // Étiquette « NOUVEAU » (bloc 3.4) : bases créées avant l'ajout de la colonne.
  const catCols = (db.prepare(`PRAGMA table_info(catalog_products)`).all() as { name: string }[]).map(
    (c) => c.name
  )
  if (!catCols.includes('new_refs')) {
    db.exec(`ALTER TABLE catalog_products ADD COLUMN new_refs TEXT NOT NULL DEFAULT '[]'`)
  }

  // Moteurs (13/07/2026) : chaque taille appartient à UN moteur — les référentiels
  // ne sont jamais partagés. Les tailles existantes sont toutes battant (JANUS).
  const sizeCols = (db.prepare(`PRAGMA table_info(sizes)`).all() as { name: string }[]).map(
    (c) => c.name
  )
  if (!sizeCols.includes('moteur')) {
    db.exec(`ALTER TABLE sizes ADD COLUMN moteur TEXT NOT NULL DEFAULT 'battant'`)
  }
  // Coulissant (13/07/2026) : ses labels (« 300x140 »…) existent déjà côté battant —
  // l'unicité du label devient PAR MOTEUR. Reconstruction douce des bases créées
  // avec l'ancienne contrainte UNIQUE globale.
  const sizesSchema = (
    db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'sizes'`).get() as
      | { sql: string }
      | undefined
  )?.sql
  if (sizesSchema && /label\s+TEXT\s+NOT\s+NULL\s+UNIQUE/i.test(sizesSchema)) {
    db.exec(`
      ALTER TABLE sizes RENAME TO sizes_old;
      CREATE TABLE sizes (
        id INTEGER PRIMARY KEY,
        width_cm INTEGER NOT NULL,
        height_cm INTEGER NOT NULL,
        label TEXT NOT NULL,
        sort INTEGER NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        moteur TEXT NOT NULL DEFAULT 'battant',
        UNIQUE (label, moteur)
      );
      INSERT INTO sizes (id, width_cm, height_cm, label, sort, active, moteur)
        SELECT id, width_cm, height_cm, label, sort, active, moteur FROM sizes_old;
      DROP TABLE sizes_old;
    `)
  }

  // Décors XL (22/07/2026) : le type de décor « coulissant-xl » entre dans la
  // contrainte CHECK. Reconstruction douce des bases existantes, ATOMIQUE
  // (transaction : tout ou rien) et REPRENABLE — le premier essai du 22/07 a
  // planté au DROP (better-sqlite3 active les clés étrangères PAR DÉFAUT, et
  // decor_tags/favorites/versions pointent sur decors), laissant une decors_new
  // orpheline qui faisait replanter tous les démarrages suivants. D'où :
  // foreign_keys OFF le temps de la reconstruction (réglé HORS transaction,
  // sinon c'est un no-op), et renommage en mode legacy_alter_table pour que les
  // tables filles, qui référencent « decors » par NOM, ne soient pas réécrites.
  const decorsSchema = (
    db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'decors'`).get() as
      | { sql: string }
      | undefined
  )?.sql
  if (decorsSchema && !decorsSchema.includes('coulissant-xl')) {
    db.pragma('foreign_keys = OFF')
    db.exec('DROP TABLE IF EXISTS decors_new')
    db.pragma('legacy_alter_table = ON')
    const rebuildDecors = db.transaction(() => {
      db.exec(`
        CREATE TABLE decors_new (
          id INTEGER PRIMARY KEY,
          file_path TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          slug TEXT NOT NULL,
          gamme TEXT,
          type TEXT NOT NULL DEFAULT 'battant' CHECK (type IN ('battant', 'coulissant', 'portillon', 'coulissant-xl')),
          angle TEXT NOT NULL DEFAULT 'face' CHECK (angle IN ('face', 'angle')),
          status TEXT NOT NULL DEFAULT 'a_valider' CHECK (status IN ('a_valider', 'actif', 'archive')),
          image_size TEXT,
          width INTEGER,
          height INTEGER,
          moodboard_path TEXT,
          job_id INTEGER,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO decors_new SELECT id, file_path, name, slug, gamme, type, angle, status,
          image_size, width, height, moodboard_path, job_id, created_at FROM decors;
        DROP TABLE decors;
        ALTER TABLE decors_new RENAME TO decors;
      `)
    })
    try {
      rebuildDecors()
    } finally {
      db.pragma('legacy_alter_table = OFF')
      db.pragma('foreign_keys = ON')
    }
  }

  seedSizes(db)
  seedPrompts(db)
  seedAdmin(db, opts.ephemeral)
}

/**
 * Référentiel des 18 tailles battants : 3 largeurs × 6 hauteurs (validé par Mathias le 08/07/2026).
 */
export const BATTANT_SIZES: ReadonlyArray<{ w: number; h: number }> = [100, 120, 140, 160, 180, 200]
  .flatMap((h) => [300, 350, 400].map((w) => ({ w, h })))
  .sort((a, b) => a.w - b.w || a.h - b.h)

/**
 * Référentiel des tailles portillons : largeur unique 100 cm, mêmes 6 hauteurs que
 * les battants — relevé sur les 36 gammes du serveur le 13/07/2026 (100×140 et
 * 100×160 sur 31 gammes, 120/180/200 fréquentes ; les hauteurs atypiques 110/115/
 * 130/150 de gammes isolées passent par le catalogue, qui ne consulte pas ce
 * référentiel). Le référentiel borne l'interpolation des gabarits et la gamme du
 * mode Créer.
 */
export const PORTILLON_SIZES: ReadonlyArray<{ w: number; h: number }> = [
  100, 120, 140, 160, 180, 200,
].map((h) => ({ w: 100, h }))

/**
 * Référentiel des tailles coulissants : 3 largeurs × 3 hauteurs — relevé sur les
 * 22 gammes du serveur le 13/07/2026 (300/350/400 présentes sur 12-18 gammes,
 * hauteurs 140/160/180 uniquement, jamais de 100/120/200). Les largeurs ≥ 450
 * vivent dans le jeu « Gabarits XL » ci-dessous (chantier 22/07/2026) — le 400
 * RESTE ici (décision Mathias 22/07/2026 : rendus validés inchangés).
 */
export const COULISSANT_SIZES: ReadonlyArray<{ w: number; h: number }> = [140, 160, 180]
  .flatMap((h) => [300, 350, 400].map((w) => ({ w, h })))
  .sort((a, b) => a.w - b.w || a.h - b.h)

/**
 * Référentiel des coulissants XL (demande Mathias 22/07/2026) : largeurs
 * 450/500/550/600, mêmes hauteurs 140/160/180 que le relevé serveur. Jeu de
 * gabarits SÉPARÉ « coulissant-xl » (onglet « Gabarits XL » de la fiche
 * TERMINUS) : sa scène élargie (src/lib/gabaritSets.ts) contient les grandes
 * lames que la scène standard clampait. Même moteur TERMINUS pour tout le reste.
 */
export const COULISSANT_XL_SIZES: ReadonlyArray<{ w: number; h: number }> = [140, 160, 180]
  .flatMap((h) => [450, 500, 550, 600].map((w) => ({ w, h })))
  .sort((a, b) => a.w - b.w || a.h - b.h)

function seedSizes(db: Database.Database): void {
  const insert = db.prepare(
    'INSERT INTO sizes (width_cm, height_cm, label, sort, moteur) VALUES (?, ?, ?, ?, ?)'
  )
  // Un référentiel PAR MOTEUR (jamais partagés) : chacun se seed indépendamment,
  // pour que les bases existantes (déjà seedées battant) reçoivent les portillons.
  // « coulissant-xl » n'est pas un moteur mais un second JEU DE GABARITS du
  // coulissant (22/07/2026) — même mécanique de stockage.
  const referentiels: ReadonlyArray<[string, ReadonlyArray<{ w: number; h: number }>]> = [
    ['battant', BATTANT_SIZES],
    ['portillon', PORTILLON_SIZES],
    ['coulissant', COULISSANT_SIZES],
    ['coulissant-xl', COULISSANT_XL_SIZES],
  ]
  const insertAll = db.transaction(() => {
    for (const [moteur, sizes] of referentiels) {
      const count = db
        .prepare('SELECT COUNT(*) AS n FROM sizes WHERE moteur = ?')
        .get(moteur) as { n: number }
      if (count.n > 0) continue
      sizes.forEach((s, i) => insert.run(s.w, s.h, `${s.w}x${s.h}`, i, moteur))
    }
  })
  insertAll()
}

/**
 * Prompts système : noms stables utilisés par les pipelines. RÈGLE moteurs
 * (13/07/2026) : les prompts ne sont JAMAIS partagés — les noms sans préfixe sont
 * ceux du Battant « JANUS » (historiques), les moteurs suivants préfixent. Les
 * prompts portillon et coulissant sont de VRAIES ADAPTATIONS, pas des copies :
 * portillon = vantail unique, entrée piétonne ; coulissant = lame d'un seul
 * tenant dont le bord droit disparaît DERRIÈRE le pilier droit (prompt gagnant
 * v8 de la recherche docs/MOTEUR-COULISSANT-prompt.md — ne JAMAIS y écrire
 * « sliding »). Les Décors portillon/coulissant viendront avec leurs prompts.
 */
export const PROMPT_FILES: Record<string, string> = {
  'moodboard-llm': 'Moodboard LLM.txt',
  // Décors XL (22/07/2026) : le Canny seul ne suffit pas à imposer le cadrage —
  // c'est le prompt qui le verrouille. Adaptation RÉELLE : caméra reculée de
  // l'autre côté de la rue, allée de 6 m, trottoir remonté, rue en avant-plan.
  'coulissant-xl-moodboard-llm': 'Moodboard LLM XL.txt',
  'decor-architecture': 'Prompt Decor Architecture.txt',
  'decor-couloir': 'Prompt Decor Couloir.txt',
  'piliers-murets': 'Prompt Piliers et Murets.txt',
  integration: 'Prompt Integration.txt',
  'integration-simple': 'Prompt Integration Simple.txt',
  // Chantier pose + fusion (17/07/2026) : prompt JANUS générique dérivé du prompt
  // labo validé (« Prompt Pose Fusion.txt », conservé verbatim comme référence) —
  // coloris injecté via {COLORIS}, formulations neutres ajouré/sommet.
  'pose-fusion': 'Prompt Pose Fusion JANUS.txt',
  'decor-tags': 'Prompt Decor Tags.txt',
  'decor-correctif': 'Prompt Decor Correctif.txt',
  'portillon-piliers-murets': 'Prompt Piliers et Murets Portillon.txt',
  'portillon-integration': 'Prompt Integration Portillon.txt',
  'portillon-integration-simple': 'Prompt Integration Simple Portillon.txt',
  // Migration pose + fusion des moteurs (20/07/2026) : prompts ADAPTÉS par produit
  // (vantail unique piéton / lame d'un seul tenant derrière le pilier droit —
  // jamais de simple copie, règle « moteur = contenu adapté »).
  'portillon-pose-fusion': 'Prompt Pose Fusion Portillon.txt',
  'coulissant-pose-fusion': 'Prompt Pose Fusion Coulissant.txt',
  'marketplace-extension': 'Prompt Marketplace Extension.txt',
  'portillon-marketplace-extension': 'Prompt Marketplace Extension Portillon.txt',
  'coulissant-piliers-murets': 'Prompt Piliers et Murets Coulissant.txt',
  'coulissant-integration-simple': 'Prompt Integration Simple Coulissant.txt',
  'coulissant-marketplace-extension': 'Prompt Marketplace Extension Coulissant.txt',
}

/**
 * Filet de sécurité si un fichier moteur manque : copie du prompt battant.
 * `coulissant-integration` (méthode « verrouillée », archivée) n'a PAS de vraie
 * adaptation : la méthode du coulissant est « simple » — la copie n'existe que
 * pour qu'un changement de méthode dans l'admin ne plante pas le pipeline.
 */
const PROMPT_COPY_SOURCES: Record<string, { source: string; moteur: string }> = {
  'portillon-piliers-murets': { source: 'piliers-murets', moteur: 'Portillon « FORCULUS »' },
  'portillon-integration': { source: 'integration', moteur: 'Portillon « FORCULUS »' },
  'portillon-integration-simple': { source: 'integration-simple', moteur: 'Portillon « FORCULUS »' },
  'portillon-marketplace-extension': { source: 'marketplace-extension', moteur: 'Portillon « FORCULUS »' },
  'coulissant-piliers-murets': { source: 'piliers-murets', moteur: 'Coulissant « TERMINUS »' },
  'coulissant-integration': { source: 'integration', moteur: 'Coulissant « TERMINUS »' },
  'coulissant-integration-simple': { source: 'integration-simple', moteur: 'Coulissant « TERMINUS »' },
  'coulissant-marketplace-extension': { source: 'marketplace-extension', moteur: 'Coulissant « TERMINUS »' },
  'coulissant-xl-moodboard-llm': { source: 'moodboard-llm', moteur: 'Jeu Coulissant XL' },
}

function seedPrompts(db: Database.Database): void {
  const insert = db.prepare(
    `INSERT INTO prompts (name, version, content, comment, created_by) VALUES (?, 1, ?, 'Import initial depuis Prompt System/', 'seed')`
  )
  for (const [name, file] of Object.entries(PROMPT_FILES)) {
    const exists = db.prepare('SELECT COUNT(*) AS n FROM prompts WHERE name = ?').get(name) as {
      n: number
    }
    if (exists.n > 0) continue
    const filePath = path.join(config.promptSystemDir, file)
    if (!fs.existsSync(filePath)) continue
    insert.run(name, fs.readFileSync(filePath, 'utf8'))
  }
  const insertCopy = db.prepare(
    `INSERT INTO prompts (name, version, content, comment, created_by) VALUES (?, 1, ?, ?, 'seed')`
  )
  for (const [name, { source, moteur }] of Object.entries(PROMPT_COPY_SOURCES)) {
    const exists = db.prepare('SELECT COUNT(*) AS n FROM prompts WHERE name = ?').get(name) as {
      n: number
    }
    if (exists.n > 0) continue
    const src = db
      .prepare('SELECT content FROM prompts WHERE name = ? ORDER BY version DESC LIMIT 1')
      .get(source) as { content: string } | undefined
    if (!src) continue
    insertCopy.run(
      name,
      src.content,
      `Moteur ${moteur} — copie du prompt battant « ${source} », à adapter`
    )
  }
}

function seedAdmin(db: Database.Database, ephemeral: boolean): void {
  const count = db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }
  if (count.n > 0) return
  const password = ephemeral ? 'test-password' : generatePassword()
  db.prepare(`INSERT INTO users (username, password_hash, role) VALUES ('admin', ?, 'admin')`).run(
    hashPassword(password)
  )
  if (!ephemeral) {
    // Mot de passe initial remis à l'admin via un fichier local (jamais commité, dossier data/).
    fs.mkdirSync(config.dataDir, { recursive: true })
    fs.writeFileSync(
      path.join(config.dataDir, 'admin-initial-password.txt'),
      `Compte initial PortaGEN\nutilisateur : admin\nmot de passe : ${password}\n\nÀ changer depuis Admin → Utilisateurs après la première connexion.\n`,
      'utf8'
    )
  }
}

export interface SizeRow {
  id: number
  width_cm: number
  height_cm: number
  label: string
  sort: number
  active: number
  moteur: string
}

/** Tailles actives d'UN moteur (les référentiels ne sont jamais partagés). */
export function listSizes(db: Database.Database = getDb(), moteur = 'battant'): SizeRow[] {
  return db
    .prepare('SELECT * FROM sizes WHERE active = 1 AND moteur = ? ORDER BY sort')
    .all(moteur) as SizeRow[]
}

export interface JobRow {
  id: number
  type: string
  status: string
  payload: string | null
  result: string | null
  error: string | null
  regen_count: number
  review_status: string
  reviewed_at: string | null
  batch_id: string | null
  created_by: string | null
  lab_archived_at: string | null
  created_at: string
  updated_at: string | null
}

export function createJob(
  type: string,
  payload: unknown,
  db: Database.Database = getDb(),
  batchId?: string,
  createdBy?: string
): number {
  const res = db
    .prepare(
      `INSERT INTO jobs (type, status, payload, batch_id, created_by) VALUES (?, 'queued', ?, ?, ?)`
    )
    .run(type, JSON.stringify(payload), batchId ?? null, createdBy ?? null)
  return Number(res.lastInsertRowid)
}

export function listJobsByBatch(batchId: string, db: Database.Database = getDb()): JobRow[] {
  return db.prepare('SELECT * FROM jobs WHERE batch_id = ? ORDER BY id').all(batchId) as JobRow[]
}

export function getJob(id: number, db: Database.Database = getDb()): JobRow | undefined {
  return db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as JobRow | undefined
}

export function listJobs(limit = 50, db: Database.Database = getDb()): JobRow[] {
  return db.prepare('SELECT * FROM jobs ORDER BY id DESC LIMIT ?').all(limit) as JobRow[]
}

/** Supprime la ligne d'un job (les artefacts disque sont conservés). */
export function deleteJob(id: number, db: Database.Database = getDb()): void {
  db.prepare('DELETE FROM jobs WHERE id = ?').run(id)
}

export function updateJob(
  id: number,
  fields: Partial<Pick<JobRow, 'status' | 'result' | 'error' | 'review_status' | 'reviewed_at'>> & {
    incrementRegen?: boolean
  },
  db: Database.Database = getDb()
): void {
  const sets: string[] = [`updated_at = datetime('now')`]
  const params: Record<string, unknown> = { id }
  for (const key of ['status', 'result', 'error', 'review_status', 'reviewed_at'] as const) {
    if (fields[key] !== undefined) {
      sets.push(`${key} = @${key}`)
      params[key] = fields[key]
    }
  }
  if (fields.incrementRegen) sets.push(`regen_count = regen_count + 1`)
  db.prepare(`UPDATE jobs SET ${sets.join(', ')} WHERE id = @id`).run(params)
}

export interface ApiCallRow {
  id: number
  job_id: number | null
  provider: string
  model: string
  kind: string
  duration_ms: number | null
  input_tokens: number | null
  output_tokens: number | null
  total_tokens: number | null
  ok: number
  error: string | null
  artifact_path: string | null
  created_at: string
}

/** Appels API d'un job (Lab moteur : durées, modèles, tokens par étape). */
export function listApiCallsForJob(jobId: number, db: Database.Database = getDb()): ApiCallRow[] {
  return db
    .prepare('SELECT * FROM api_calls WHERE job_id = ? ORDER BY id')
    .all(jobId) as ApiCallRow[]
}

export interface ApiCallLog {
  jobId?: number
  provider: string
  model: string
  kind: string
  durationMs?: number
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  ok: boolean
  error?: string
  artifactPath?: string
}

export function logApiCall(entry: ApiCallLog, db: Database.Database = getDb()): void {
  db.prepare(
    `INSERT INTO api_calls (job_id, provider, model, kind, duration_ms, input_tokens, output_tokens, total_tokens, ok, error, artifact_path)
     VALUES (@jobId, @provider, @model, @kind, @durationMs, @inputTokens, @outputTokens, @totalTokens, @ok, @error, @artifactPath)`
  ).run({
    jobId: entry.jobId ?? null,
    provider: entry.provider,
    model: entry.model,
    kind: entry.kind,
    durationMs: entry.durationMs ?? null,
    inputTokens: entry.inputTokens ?? null,
    outputTokens: entry.outputTokens ?? null,
    totalTokens: entry.totalTokens ?? null,
    ok: entry.ok ? 1 : 0,
    error: entry.error ?? null,
    artifactPath: entry.artifactPath ?? null,
  })
}
