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

    -- Décors Libres (28/07/2026) : une description photographique NOMMÉE et
    -- PARTAGÉE entre utilisateurs, rechargeable d'un clic sur l'écran MES Libre.
    -- Rien à voir avec les décors image du mode Contrainte (table decors).
    -- « profil » = profil de réglages (portail, clim, pergola…) : un décor Libre
    -- n'est proposé qu'aux produits de son profil.
    CREATE TABLE IF NOT EXISTS libre_decors (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      profil TEXT NOT NULL DEFAULT 'portail',
      description TEXT NOT NULL,
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

    -- Détection des images par apprentissage (chantier 24/07/2026, maquette
    -- atelier-detection-v4). detection_images = inventaire des images vues sur
    -- le serveur (LECTURE SEULE) avec leur empreinte visuelle (BLOB Float32,
    -- DINOv2 local) et la dernière prédiction de vue (mot-clé nomenclature
    -- HOORTRADE). detection_examples = les exemples appris : un par (image,
    -- axe), issus des noms conformes, des dossiers, des corrections de fiches
    -- ou des clics de l'atelier — un clic atelier n'est JAMAIS écrasé par une
    -- récolte automatique.
    CREATE TABLE IF NOT EXISTS detection_images (
      id INTEGER PRIMARY KEY,
      product_id INTEGER NOT NULL REFERENCES catalog_products(id),
      rel_path TEXT NOT NULL,
      mtime_ms INTEGER,
      size INTEGER,
      width INTEGER,
      height INTEGER,
      embedding BLOB,
      pred_vue TEXT,
      pred_vue_conf REAL,
      pred_vue_why TEXT,
      -- Vue REFUSÉE en mode lots (image décochée, 27/07/2026) : ne revient plus
      -- dans les lots de cette vue, passe en tête de la file un par un.
      bulk_rejected_vue TEXT,
      error TEXT,
      analyzed_at TEXT,
      UNIQUE (product_id, rel_path)
    );

    CREATE TABLE IF NOT EXISTS detection_examples (
      id INTEGER PRIMARY KEY,
      product_id INTEGER NOT NULL REFERENCES catalog_products(id),
      rel_path TEXT NOT NULL,
      axis TEXT NOT NULL CHECK (axis IN ('vue', 'coloris', 'famille', 'gamme')),
      label TEXT NOT NULL,
      source TEXT NOT NULL CHECK (source IN ('nom', 'dossier', 'fiche', 'atelier')),
      features TEXT,
      gamme TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (product_id, rel_path, axis)
    );

    -- Bibliothèque des DESCRIPTIONS PRODUIT vision (rodage 07/08/2026, décision
    -- Mathias) : produit + coloris + moteur = UNE description factuelle
    -- (structure, cadre, remplissage, quincaillerie) établie par un modèle
    -- vision imposant et RÉUTILISÉE tant que la clé correspond — sinon nouvel
    -- appel + insertion. Le coloris fait partie de la clé : un ATHOS Teck et un
    -- ATHOS gris n'ont pas les mêmes matières.
    CREATE TABLE IF NOT EXISTS produit_descriptions (
      id INTEGER PRIMARY KEY,
      produit TEXT NOT NULL,
      coloris TEXT NOT NULL DEFAULT '',
      moteur TEXT NOT NULL,
      description TEXT NOT NULL,
      model TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- DÉCORS des MES Contrainte (08/08/2026, maquette decors-mes-contrainte-v2) :
    -- bibliothèque PARTAGÉE par les 3 moteurs décor autour. Chaque décor = un nom,
    -- un texte de prompt LIBRE (injecté à la place de {DECOR}) et des images de
    -- référence optionnelles (fichiers sous data/mes-decors/<id>/, chemins
    -- relatifs projet en JSON dans images) jointes à l'appel Nano comme
    -- inspiration d'ambiance. Création/édition par TOUS les utilisateurs ;
    -- décor par défaut et suppression réservés à l'admin. Comme la détection :
    -- table hors CLEARED_TABLES — la remise à zéro ne touche PAS les décors.
    CREATE TABLE IF NOT EXISTS mes_decors (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      prompt TEXT NOT NULL DEFAULT '',
      prompt_ia TEXT,
      apercu TEXT,
      images TEXT NOT NULL DEFAULT '[]',
      is_default INTEGER NOT NULL DEFAULT 0,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)

  // Réécriture LLM obligatoire du texte de décor (08/08 soir) : bases créées
  // quelques heures avant l'ajout de la colonne — migration douce, et les
  // textes existants (écrits avant le LLM) deviennent leur propre version IA
  // (comportement inchangé tant qu'on ne réédite pas).
  const decorCols = (db.prepare(`PRAGMA table_info(mes_decors)`).all() as { name: string }[]).map(
    (c) => c.name
  )
  if (decorCols.length > 0 && !decorCols.includes('prompt_ia')) {
    db.exec(`ALTER TABLE mes_decors ADD COLUMN prompt_ia TEXT`)
  }
  db.exec(`UPDATE mes_decors SET prompt_ia = prompt WHERE prompt_ia IS NULL AND prompt != ''`)

  // Bibliothèque de Décors (17/08/2026, maquette bibliotheque-decors-v1) :
  // aperçu Nano 1K du décor seul, fichier sous data/mes-decors/<id>/ (chemin
  // relatif projet) — hors remise à zéro, comme les images de référence.
  if (decorCols.length > 0 && !decorCols.includes('apercu')) {
    db.exec(`ALTER TABLE mes_decors ADD COLUMN apercu TEXT`)
  }

  // Bibliothèque de descriptions créée quelques minutes avant l'ajout du
  // coloris dans la clé (07/08/2026, rechargement DEV entre les deux) :
  // recréation douce avec copie — l'ancienne contrainte UNIQUE(produit, moteur)
  // inline bloquerait deux coloris d'un même produit, un ALTER ne suffit pas.
  const pdCols = (
    db.prepare(`PRAGMA table_info(produit_descriptions)`).all() as { name: string }[]
  ).map((c) => c.name)
  if (pdCols.length > 0 && !pdCols.includes('coloris')) {
    db.exec(`
      ALTER TABLE produit_descriptions RENAME TO produit_descriptions_old;
      CREATE TABLE produit_descriptions (
        id INTEGER PRIMARY KEY,
        produit TEXT NOT NULL,
        coloris TEXT NOT NULL DEFAULT '',
        moteur TEXT NOT NULL,
        description TEXT NOT NULL,
        model TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO produit_descriptions (produit, coloris, moteur, description, model, created_at)
        SELECT produit, '', moteur, description, model, created_at FROM produit_descriptions_old;
      DROP TABLE produit_descriptions_old;
    `)
  }
  db.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_produit_descriptions_cle
     ON produit_descriptions (produit, coloris, moteur)`
  )

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
  // Générations multiples par taille (29/07/2026) : chaque taille lance N MES
  // (variantes, n° dans payload.variant). L'utilisateur en CHOISIT une par
  // taille — chosen = 1 sur la MES retenue, 0 sur ses sœurs. Seule la retenue
  // peut passer en Marketplace. 0 partout = comportement historique (1 par taille).
  if (!jobCols.includes('chosen')) {
    db.exec(`ALTER TABLE jobs ADD COLUMN chosen INTEGER NOT NULL DEFAULT 0`)
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
  // Pieds de soutien (29/07/2026) : NULL = pas encore jugé, 1 = a des pieds,
  // 0 = n'en a pas (VALIER…). Rempli par le juge vision au premier besoin,
  // modifiable sur la fiche produit. Pilote les réparations de bande basse et
  // les sections [PIEDS] du prompt pose-fusion.
  if (!catCols.includes('pieds')) {
    db.exec(`ALTER TABLE catalog_products ADD COLUMN pieds INTEGER`)
  }

  // Mode lots (27/07/2026) : bases créées avant l'ajout de la colonne de refus.
  const detCols = (db.prepare(`PRAGMA table_info(detection_images)`).all() as { name: string }[]).map(
    (c) => c.name
  )
  if (!detCols.includes('bulk_rejected_vue')) {
    db.exec(`ALTER TABLE detection_images ADD COLUMN bulk_rejected_vue TEXT`)
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
  seedMesDecors(db)
  seedDecorPlaceholder(db)
  seedAjourePlaceholder(db)
  seedSceneCachee(db)
  seedDecorDepassement(db)
  seedQueueFlottante(db)
  seedJugeAffine(db)
  seedOmbresExpliquees(db)
  seedAdmin(db, opts.ephemeral)
}

/**
 * Décor de départ « Pavillon français » (08/08/2026) : l'ambiance qui vivait EN
 * DUR dans le paragraphe ENVIRONMENT des prompts décor autour, extraite telle
 * quelle — tant que Mathias n'y touche pas, les rendus ne changent pas. Seedé
 * UNIQUEMENT si la bibliothèque est vide (comme les prompts : jamais réécrit).
 */
function seedMesDecors(db: Database.Database): void {
  const n = (db.prepare('SELECT COUNT(*) AS n FROM mes_decors').get() as { n: number }).n
  if (n > 0) return
  const texte =
    'A typical French residential suburb: a paved driveway and a tidy garden behind the entrance, ' +
    'a classic French detached house (pavillon) in the background. Wide clear blue sky, bright ' +
    'sunny daylight. Realistic materials, fine detail, photorealistic.'
  // prompt_ia = le même texte : il est déjà au format final, pas besoin du LLM.
  db.prepare(
    `INSERT INTO mes_decors (name, prompt, prompt_ia, is_default, created_by) VALUES (?, ?, ?, 1, 'seed')`
  ).run('Pavillon français', texte, texte)
}

/**
 * Externalisation du décor (08/08/2026) : le paragraphe ENVIRONMENT des prompts
 * décor autour devient un emplacement {DECOR} (rempli par le pipeline avec le
 * décor choisi), et la règle « maison toujours vue de face » passe dans le texte
 * FIGÉ, hors d'atteinte des décors custom. Les fichiers Prompt System/ portent
 * la nouvelle ossature ; ici on la publie en NOUVELLE VERSION de chaque prompt
 * (jamais d'écrasement — l'historique du Prompt System reste intact). Garde
 * anti hot-reload (règle du 28/07 : le DEV peut seeder avant les fichiers) :
 * on ne publie que si le FICHIER contient bien {DECOR}.
 */
function seedDecorPlaceholder(db: Database.Database): void {
  const noms = ['janus-decor-autour', 'terminus-decor-autour', 'forculus-decor-autour']
  for (const name of noms) {
    const actif = db
      .prepare('SELECT version, content FROM prompts WHERE name = ? ORDER BY version DESC LIMIT 1')
      .get(name) as { version: number; content: string } | undefined
    if (!actif || actif.content.includes('{DECOR}')) continue
    const file = PROMPT_FILES[name]
    if (!file) continue
    const filePath = path.join(config.promptSystemDir, file)
    if (!fs.existsSync(filePath)) continue
    const contenu = fs.readFileSync(filePath, 'utf8')
    if (!contenu.includes('{DECOR}')) continue
    db.prepare(
      'INSERT INTO prompts (name, version, content, comment, created_by) VALUES (?, ?, ?, ?, ?)'
    ).run(
      name,
      actif.version + 1,
      contenu,
      'Décor externalisé ({DECOR}) + maison de face verrouillée hors décor (08/08/2026)',
      'seed'
    )
  }
}

/**
 * Paragraphe « openwork » conditionnel (17/08/2026) : sur un produit PLEIN de
 * grande hauteur, ce paragraphe donnait à Nano une sortie légitime pour percer
 * le panneau (session banc-msxgayzw-gh9twi, 7/7 percés dès 50 % de couverture
 * verticale). Il devient un emplacement {AJOURE} rempli par le pipeline selon
 * la ligne STRUCTURE de la description produit. Étendu aux 3 moteurs le 17/08
 * soir (feu vert Mathias après validation battant, coulissants percés jobs
 * 92-96) ; même garde anti hot-reload que {DECOR}.
 */
function seedAjourePlaceholder(db: Database.Database): void {
  const noms = ['janus-decor-autour', 'forculus-decor-autour', 'terminus-decor-autour']
  for (const name of noms) {
    const actif = db
      .prepare('SELECT version, content FROM prompts WHERE name = ? ORDER BY version DESC LIMIT 1')
      .get(name) as { version: number; content: string } | undefined
    if (!actif || actif.content.includes('{AJOURE}')) continue
    const file = PROMPT_FILES[name]
    if (!file) continue
    const filePath = path.join(config.promptSystemDir, file)
    if (!fs.existsSync(filePath)) continue
    const contenu = fs.readFileSync(filePath, 'utf8')
    if (!contenu.includes('{AJOURE}')) continue
    db.prepare(
      'INSERT INTO prompts (name, version, content, comment, created_by) VALUES (?, ?, ?, ?, ?)'
    ).run(
      name,
      actif.version + 1,
      contenu,
      'Paragraphe openwork conditionnel ({AJOURE}) : produit plein = jamais percé (17/08/2026)',
      'seed'
    )
  }
}

/**
 * « Ce qui est caché reste caché » (17/08/2026, remède 2 du perçage) : {AJOURE}
 * seul n'a pas suffi — Nano a cessé de percer mais s'est mis à RAPETISSER le
 * portail/les piliers pour dégager la vue (session banc-msxmzlbt-w782di, 5 lames
 * au lieu de 8). Le texte figé dit désormais que le décor peut être presque
 * entièrement masqué par le portail et que c'est VOULU : on ne rétrécit rien,
 * on ne révèle rien. JANUS seul ; même garde anti hot-reload que {DECOR}.
 */
function seedSceneCachee(db: Database.Database): void {
  const marqueur = 'NOT what must be visible'
  const noms = ['janus-decor-autour']
  for (const name of noms) {
    const actif = db
      .prepare('SELECT version, content FROM prompts WHERE name = ? ORDER BY version DESC LIMIT 1')
      .get(name) as { version: number; content: string } | undefined
    if (!actif || actif.content.includes(marqueur)) continue
    const file = PROMPT_FILES[name]
    if (!file) continue
    const filePath = path.join(config.promptSystemDir, file)
    if (!fs.existsSync(filePath)) continue
    const contenu = fs.readFileSync(filePath, 'utf8')
    if (!contenu.includes(marqueur)) continue
    db.prepare(
      'INSERT INTO prompts (name, version, content, comment, created_by) VALUES (?, ?, ?, ?, ?)'
    ).run(
      name,
      actif.version + 1,
      contenu,
      'Remède 2 : le décor caché par le portail reste caché — jamais rétrécir pour dégager la vue (17/08/2026)',
      'seed'
    )
  }
}

/**
 * Décor « ce qui dépasse » (17/08/2026 soir, règle Mathias « voyons simple ») :
 * le paragraphe ENVIRONMENT devient le modèle 3 bandes — sol dessiné, produit
 * dessiné, la bande HAUTE est la seule à inventer (ciel + ce qui dépasse
 * derrière le portail). Fini les décors complets invisibles (jardin, allée) qui
 * poussaient Nano à altérer le produit ; le gros pavé défensif du remède 2
 * disparaît avec la cause. Étendu aux 3 moteurs le 17/08 soir (feu vert Mathias
 * après validation battant — le coulissant EXIGEAIT même la façade toujours
 * visible, l'ordre parfait pour tricher) ; garde anti hot-reload idem {DECOR}.
 */
function seedDecorDepassement(db: Database.Database): void {
  const marqueur = 'What peeks above:'
  const noms = ['janus-decor-autour', 'forculus-decor-autour', 'terminus-decor-autour']
  for (const name of noms) {
    const actif = db
      .prepare('SELECT version, content FROM prompts WHERE name = ? ORDER BY version DESC LIMIT 1')
      .get(name) as { version: number; content: string } | undefined
    if (!actif || actif.content.includes(marqueur)) continue
    const file = PROMPT_FILES[name]
    if (!file) continue
    const filePath = path.join(config.promptSystemDir, file)
    if (!fs.existsSync(filePath)) continue
    const contenu = fs.readFileSync(filePath, 'utf8')
    if (!contenu.includes(marqueur)) continue
    db.prepare(
      'INSERT INTO prompts (name, version, content, comment, created_by) VALUES (?, ?, ?, ?, ?)'
    ).run(
      name,
      actif.version + 1,
      contenu,
      'Décor « ce qui dépasse » : bande haute seule à inventer, plus de décor complet invisible (17/08/2026)',
      'seed'
    )
  }
}

/**
 * Queue flottante du coulissant (17/08/2026 soir, job 123 ATHOS) : le prompt
 * décrivait « deux bras haut et bas » alors que le plan n'en MONTRE qu'un (le
 * bas est caché derrière le muret peint devant — physiquement juste) ; Nano
 * résolvait la contradiction en couchant le bras sur le muret comme un rail,
 * et fondait la lame dans le pilier droit. Le prompt décrit désormais ce qui
 * est réellement dessiné (un bras qui FLOTTE au-dessus du muret, jamais une
 * main courante) + pilier droit pleine largeur aux bords nets. Même garde anti
 * hot-reload que {DECOR}.
 */
function seedQueueFlottante(db: Database.Database): void {
  const marqueur = 'NEVER a handrail'
  const noms = ['terminus-decor-autour']
  for (const name of noms) {
    const actif = db
      .prepare('SELECT version, content FROM prompts WHERE name = ? ORDER BY version DESC LIMIT 1')
      .get(name) as { version: number; content: string } | undefined
    if (!actif || actif.content.includes(marqueur)) continue
    const file = PROMPT_FILES[name]
    if (!file) continue
    const filePath = path.join(config.promptSystemDir, file)
    if (!fs.existsSync(filePath)) continue
    const contenu = fs.readFileSync(filePath, 'utf8')
    if (!contenu.includes(marqueur)) continue
    db.prepare(
      'INSERT INTO prompts (name, version, content, comment, created_by) VALUES (?, ?, ?, ?, ?)'
    ).run(
      name,
      actif.version + 1,
      contenu,
      'Queue flottante : le prompt décrit le bras unique réellement dessiné (jamais une main courante sur le muret) + pilier droit net (17/08/2026)',
      'seed'
    )
  }
}

/**
 * Affinage du juge vision (17/08/2026 soir, jobs 124-125 ATHOS : le juge a
 * refusé le BON rendu — faux comptage « 7 lames au lieu de 10 » — et retenu le
 * MAUVAIS — lame traversant les piliers, invisible pour le contrôle « sommet
 * seul » du gabarit). Juge scène : jamais de refus sur un COMPTAGE de lames,
 * jugement à l'ÉCHELLE (épaisseur d'une lame vs hauteur). Juge gabarit : du
 * portail visible DANS le magenta d'un pilier = pilier non conforme (le pilier
 * doit être un bloc de maçonnerie ininterrompu). Même garde anti hot-reload.
 */
function seedJugeAffine(db: Database.Database): void {
  const cibles = [
    { name: 'juge-mes', marqueur: 'slat COUNT' },
    { name: 'juge-mes-gabarit', marqueur: 'INSIDE the magenta pillar' },
  ]
  for (const { name, marqueur } of cibles) {
    const actif = db
      .prepare('SELECT version, content FROM prompts WHERE name = ? ORDER BY version DESC LIMIT 1')
      .get(name) as { version: number; content: string } | undefined
    if (!actif || actif.content.includes(marqueur)) continue
    const file = PROMPT_FILES[name]
    if (!file) continue
    const filePath = path.join(config.promptSystemDir, file)
    if (!fs.existsSync(filePath)) continue
    const contenu = fs.readFileSync(filePath, 'utf8')
    if (!contenu.includes(marqueur)) continue
    db.prepare(
      'INSERT INTO prompts (name, version, content, comment, created_by) VALUES (?, ?, ?, ?, ?)'
    ).run(
      name,
      actif.version + 1,
      contenu,
      name === 'juge-mes'
        ? 'Jamais de refus sur un comptage de lames — jugement à l’échelle (17/08/2026, faux refus job 124)'
        : 'Portail visible dans le magenta d’un pilier = non conforme (17/08/2026, faux accept job 125)',
      'seed'
    )
  }
}

/**
 * Ombres expliquées + queue neutralisée (17/08/2026 tard, gammes msxr9qso et
 * msxrig10) : les dégradés d'ombre ajoutés au plan n'étaient PAS déclarés dans
 * le prompt, et la v16 parlait d'« un bras sombre fin » — Nano matérialisait
 * des BARRES partout où il voyait du sombre (jusqu'à une barre à GAUCHE, où il
 * n'y a aucune queue). v17 : les dégradés sont déclarés comme OMBRES PORTÉES
 * des piliers (jamais des objets), la queue est décrite de façon neutre
 * (« reproduis ce qui dépasse tel que dessiné ») et tout ajout de barre non
 * dessinée est interdit des deux côtés. Même garde anti hot-reload.
 */
function seedOmbresExpliquees(db: Database.Database): void {
  const marqueur = 'CAST SHADOWS'
  const noms = ['terminus-decor-autour']
  for (const name of noms) {
    const actif = db
      .prepare('SELECT version, content FROM prompts WHERE name = ? ORDER BY version DESC LIMIT 1')
      .get(name) as { version: number; content: string } | undefined
    if (!actif || actif.content.includes(marqueur)) continue
    const file = PROMPT_FILES[name]
    if (!file) continue
    const filePath = path.join(config.promptSystemDir, file)
    if (!fs.existsSync(filePath)) continue
    const contenu = fs.readFileSync(filePath, 'utf8')
    if (!contenu.includes(marqueur)) continue
    db.prepare(
      'INSERT INTO prompts (name, version, content, comment, created_by) VALUES (?, ?, ?, ?, ?)'
    ).run(
      name,
      actif.version + 1,
      contenu,
      'Ombres des piliers déclarées (jamais des objets) + queue neutre + interdit d’ajouter des barres non dessinées (17/08/2026)',
      'seed'
    )
  }
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
  // Circuit « intégration 2 étapes » du battant (29/07/2026) : la scène est
  // déjà finie et le produit déjà posé — appel d'intégration SERRÉ (lumière +
  // ombres de contact uniquement). Sections dynamiques [PIEDS]/[SANS-PIEDS].
  'pose-fusion-integration': 'Prompt Integration Serree.txt',
  'decor-tags': 'Prompt Decor Tags.txt',
  // Enquête maisons illogiques (28/07/2026) : R1 = rôle de la photo de maison
  // de référence jointe à Nano ; R3 = juge de vraisemblance architecturale.
  'decor-maison': 'Prompt Decor Maison.txt',
  'decor-juge': 'Prompt Decor Juge.txt',
  'decor-maison-extraction': 'Prompt Decor Maison Extraction.txt',
  'decor-correctif': 'Prompt Decor Correctif.txt',
  'portillon-piliers-murets': 'Prompt Piliers et Murets Portillon.txt',
  'portillon-integration': 'Prompt Integration Portillon.txt',
  'portillon-integration-simple': 'Prompt Integration Simple Portillon.txt',
  // Migration pose + fusion des moteurs (20/07/2026) : prompts ADAPTÉS par produit
  // (vantail unique piéton / lame d'un seul tenant derrière le pilier droit —
  // jamais de simple copie, règle « moteur = contenu adapté »).
  'portillon-pose-fusion': 'Prompt Pose Fusion Portillon.txt',
  // Report du circuit « intégration 2 étapes » du battant sur le portillon
  // (29/07/2026) : appel d'intégration SERRÉ (lumière + ombres de contact) sur
  // la scène finie et le vantail déjà posé. ADAPTÉ au produit (vantail unique
  // piéton, jamais de double vantail), sections dynamiques [PIEDS]/[SANS-PIEDS].
  'portillon-pose-fusion-integration': 'Prompt Integration Serree Portillon.txt',
  'coulissant-pose-fusion': 'Prompt Pose Fusion Coulissant.txt',
  'marketplace-extension': 'Prompt Marketplace Extension.txt',
  'portillon-marketplace-extension': 'Prompt Marketplace Extension Portillon.txt',
  'coulissant-piliers-murets': 'Prompt Piliers et Murets Coulissant.txt',
  'coulissant-integration-simple': 'Prompt Integration Simple Coulissant.txt',
  'coulissant-marketplace-extension': 'Prompt Marketplace Extension Coulissant.txt',
  // Circuit coulissant « 2 étapes » (29/07/2026, banc test-deux-etapes-stuc validé
  // par Mathias) : étape 1 = scène + lame SANS pilier droit (bout de lame visible,
  // rien à occulter), étape 2 = aplat pilier peint SUR le rendu fini, masque à la
  // silhouette (segmentation Gemini). L'occlusion est garantie par construction.
  'coulissant-2etapes-scene': 'Prompt Coulissant 2 Etapes Scene.txt',
  'coulissant-2etapes-pilier': 'Prompt Coulissant 2 Etapes Pilier.txt',
  'coulissant-2etapes-segmentation': 'Prompt Coulissant 2 Etapes Segmentation.txt',
  // MES Libres (chantier 28/07/2026, maquette mes-libre-v11) : gabarit unique,
  // placeholders {PRODUCT} {SCENE} {CONDITIONS} {CAMERA} {DETAILS} remplis par
  // le pipeline depuis le formulaire — HARD LOCK PRODUCT en dernière ligne.
  'libre-mes': 'Prompt MES Libre.txt',
  // Extension Marketplace des MES Libres : générique (le produit peut être
  // n'importe quoi — jamais le prompt « portail » d'un moteur Contrainte).
  'libre-marketplace-extension': 'Prompt Marketplace Extension Libre.txt',
  // Détection de la typologie depuis l'image déposée (28/07/2026) : le modèle
  // répond une clé parmi la liste (battant, pergola, clim…) — corrigeable à l'écran.
  'libre-typo-detect': 'Prompt Detection Typologie Libre.txt',
  // Prompt Specialist (28/07/2026, calqué sur le workflow Freepik de Mathias) :
  // le LLM reçoit les éléments français du formulaire et ÉCRIT le brief photo
  // final en anglais, HARD LOCK PRODUCT verbatim en dernière ligne.
  'libre-prompt-specialist': 'Prompt Specialist Libre.txt',
  // Retouche d'une MES Libre par consigne (studio, 28/07/2026) : édition ciblée
  // de l'image existante, {INSTRUCTION} injectée, HARD LOCK en dernière ligne.
  'libre-fix': 'Prompt Retouche Libre.txt',
  // Bascule « décor autour » (05/08/2026, docs/CADRAGE-DECOR-AUTOUR-2026-08-05.md) :
  // NOUVEAUX moteurs (séparation totale — src/lib/moteursDa.ts : janus/terminus/
  // forculus), un prompt par moteur ADAPTÉ au produit (double vantail / panneau
  // d'un seul tenant — jamais de vocabulaire de coulissement / vantail piéton),
  // ossature « élévation à plat + produit verrouillé » validée au banc du 29/07.
  'janus-decor-autour': 'Prompt Decor Autour JANUS.txt',
  'terminus-decor-autour': 'Prompt Decor Autour Coulissant.txt',
  'forculus-decor-autour': 'Prompt Decor Autour Portillon.txt',
  // Juge vision des MES décor autour (17/08/2026) : appel produit/scène (défauts
  // flagrants, dans le doute il accepte) + appel GABARIT (superposition magenta
  // du plan sur le rendu, méthode Mathias, pas de bénéfice du doute) — un refus
  // relance une version, 2 relances max (src/lib/server/jugeMesBoucle.ts).
  'juge-mes': 'Prompt Juge MES.txt',
  'juge-mes-gabarit': 'Prompt Juge MES Gabarit.txt',
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

/**
 * Plus grande largeur active (cm) d'un moteur/jeu — largeur de référence des
 * gabarits (04/08/2026) : toutes les largeurs d'une hauteur donnée partagent le
 * gabarit de la plus large. 0 si le référentiel est vide (le code appelant
 * retombe alors sur la largeur réelle).
 */
export function widestActiveWidth(moteur = 'battant', db: Database.Database = getDb()): number {
  const row = db
    .prepare('SELECT MAX(width_cm) AS w FROM sizes WHERE active = 1 AND moteur = ?')
    .get(moteur) as { w: number | null }
  return row.w ?? 0
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
  /** 1 = MES retenue de sa taille (générations multiples, 29/07/2026), 0 sinon. */
  chosen: number
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

/**
 * Générations multiples (29/07/2026) : marque UNE MES comme retenue de sa taille.
 * `chosenId` passe à chosen = 1, ses sœurs (`siblingIds`) à 0 — atomique.
 * L'appelant fournit les sœurs (mêmes taille + coloris du même lot) : le tri
 * MES/rôle vit dans la couche serveur, pas ici.
 */
export function setChosenJob(
  chosenId: number,
  siblingIds: number[],
  db: Database.Database = getDb()
): void {
  const clear = db.prepare(`UPDATE jobs SET chosen = 0, updated_at = datetime('now') WHERE id = ?`)
  const set = db.prepare(`UPDATE jobs SET chosen = 1, updated_at = datetime('now') WHERE id = ?`)
  const tx = db.transaction(() => {
    for (const sid of siblingIds) if (sid !== chosenId) clear.run(sid)
    set.run(chosenId)
  })
  tx()
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
