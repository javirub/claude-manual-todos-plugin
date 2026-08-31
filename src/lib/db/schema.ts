// The schema lives in a TypeScript module rather than a .sql file so that it
// survives bundling: Next would not ship a stray .sql into .next/server, and
// the MCP server and the app must apply byte-identical migrations.

export const MIGRATION_1 = `
-- Migration 1 — the whole schema.
--
-- Ordering rule for the app: a task sorts by due_at when it has one, and by
-- created_at when it does not. Everything else here exists to make two
-- questions cheap: "which project is this directory?" and "is this task done?".

CREATE TABLE projects (
  id          INTEGER PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  summary     TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  archived_at TEXT
);

-- The theme is a handful of numbers, not CSS. The lightness ramp lives in code
-- and is fixed per mode, so no value storable here can break text contrast.
CREATE TABLE project_themes (
  project_id     INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  mode           TEXT    NOT NULL DEFAULT 'dark'   CHECK (mode IN ('dark','light','auto')),
  hue            REAL    NOT NULL                  CHECK (hue >= 0 AND hue < 360),
  chroma         REAL    NOT NULL DEFAULT 0.13     CHECK (chroma >= 0.02 AND chroma <= 0.22),
  neutral_chroma REAL    NOT NULL DEFAULT 0.012    CHECK (neutral_chroma >= 0 AND neutral_chroma <= 0.03),
  accent2_hue    REAL                              CHECK (accent2_hue IS NULL OR (accent2_hue >= 0 AND accent2_hue < 360)),
  motif          TEXT    NOT NULL DEFAULT 'none'   CHECK (motif IN ('none','grid','dots','lines','glow','noise')),
  font_heading   TEXT    NOT NULL DEFAULT 'grotesque' CHECK (font_heading IN ('geometric','grotesque','serif','mono')),
  radius         TEXT    NOT NULL DEFAULT 'soft'   CHECK (radius IN ('sharp','soft','round'))
);

-- One project, N repositories. This is what turns a cwd into a project:
-- the longest matching path prefix wins.
CREATE TABLE project_paths (
  id         INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  path       TEXT NOT NULL UNIQUE,
  label      TEXT,
  role       TEXT
);
CREATE INDEX idx_project_paths_project ON project_paths(project_id);

CREATE TABLE project_links (
  from_project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  to_project_id   INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL DEFAULT 'relates' CHECK (kind IN ('relates','depends_on','shares_infra')),
  note            TEXT,
  PRIMARY KEY (from_project_id, to_project_id, kind)
);

-- Owner vocabulary is per project: "apple"/"cluster" mean something in Costia
-- and nothing in another project. A NULL project_id makes an owner global.
CREATE TABLE owners (
  id         INTEGER PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  slug       TEXT NOT NULL,
  label      TEXT NOT NULL,
  color_hue  REAL,
  UNIQUE (project_id, slug)
);

CREATE TABLE tasks (
  id             INTEGER PRIMARY KEY,
  slug           TEXT NOT NULL UNIQUE,
  title          TEXT NOT NULL,
  summary        TEXT,
  due_at         TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  completed_at   TEXT,
  archived_at    TEXT,
  cancelled_at   TEXT,
  created_by     TEXT NOT NULL DEFAULT 'agent' CHECK (created_by IN ('agent','user')),
  source_path    TEXT,
  source_session TEXT
);
CREATE INDEX idx_tasks_due ON tasks(due_at);

-- Membership is many-to-many: a task that spans repositories is one task in
-- several projects, with one shared state.
CREATE TABLE task_projects (
  task_id    INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  is_primary INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (task_id, project_id)
);
CREATE INDEX idx_task_projects_project ON task_projects(project_id);
CREATE UNIQUE INDEX idx_task_one_primary ON task_projects(task_id) WHERE is_primary = 1;

CREATE TABLE task_links (
  from_task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  to_task_id   INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL DEFAULT 'relates' CHECK (kind IN ('blocks','relates')),
  PRIMARY KEY (from_task_id, to_task_id, kind),
  CHECK (from_task_id <> to_task_id)
);

CREATE TABLE phases (
  id       INTEGER PRIMARY KEY,
  task_id  INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  name     TEXT NOT NULL,
  note     TEXT
);
CREATE INDEX idx_phases_task ON phases(task_id, position);

CREATE TABLE steps (
  id         INTEGER PRIMARY KEY,
  task_id    INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  phase_id   INTEGER REFERENCES phases(id) ON DELETE SET NULL,
  position   INTEGER NOT NULL,
  title      TEXT NOT NULL,
  body_md    TEXT,
  why        TEXT,
  value      TEXT,
  link_url   TEXT,
  link_label TEXT,
  owner_id   INTEGER REFERENCES owners(id) ON DELETE SET NULL,
  done_at    TEXT,
  -- 'agent' means Claude resolved it in code. Showing that is half the reason
  -- the remaining steps make sense, so it is never collapsed into a bare tick.
  done_by    TEXT CHECK (done_by IS NULL OR done_by IN ('user','agent')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_steps_task ON steps(task_id, position);

-- The SSE endpoint tails this table so a board left open picks up whatever
-- Claude writes from another process.
CREATE TABLE db_events (
  id        INTEGER PRIMARY KEY,
  at        TEXT NOT NULL,
  kind      TEXT NOT NULL,
  entity    TEXT NOT NULL,
  entity_id INTEGER
);

-- Progress and state are derived, never stored: a task is done when every one
-- of its steps is done. A stored flag is a flag that can lie.
CREATE VIEW v_task_progress AS
SELECT t.id AS task_id,
       (SELECT COUNT(*) FROM steps s WHERE s.task_id = t.id) AS total_steps,
       (SELECT COUNT(*) FROM steps s WHERE s.task_id = t.id AND s.done_at IS NOT NULL) AS done_steps
FROM tasks t;

CREATE VIEW v_task_state AS
SELECT t.id AS task_id,
       p.total_steps,
       p.done_steps,
       CASE
         WHEN t.archived_at IS NOT NULL THEN 'archived'
         WHEN t.cancelled_at IS NOT NULL THEN 'cancelled'
         WHEN p.total_steps > 0 AND p.done_steps = p.total_steps THEN 'done'
         WHEN p.total_steps = 0 AND t.completed_at IS NOT NULL THEN 'done'
         ELSE 'open'
       END AS state
FROM tasks t
JOIN v_task_progress p ON p.task_id = t.id;
`;

export const MIGRATION_2 = `
-- Migration 2 — settings.
--
-- One row per knob, so adding the next one is not another migration. The only
-- knob so far is the locale: it drives the board's chrome and, more importantly,
-- tells the agent which language to write task content in.

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;
