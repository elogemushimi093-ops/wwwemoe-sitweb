/*
 * E.M.O.E — Cours + sessions Zoom
 * Étape 3/6
 *
 * Endpoint :
 *   GET  /api/cours
 *   POST /api/cours
 *
 * Actions POST :
 *   create-course
 *   create-session
 *
 * Actions GET :
 *   courses
 *   course
 *   sessions
 */

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=UTF-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    }
  });
}

function clean(value, max = 500) {
  return String(value ?? "")
    .replace(/[\u0000-\u001F\u007F]+/g, " ")
    .trim()
    .slice(0, max);
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function validTime(value) {
  return /^\d{2}:\d{2}$/.test(value);
}

async function ensureTables(db) {
  await db.batch([
    db.prepare(`
      CREATE TABLE IF NOT EXISTS courses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT DEFAULT '',
        level TEXT DEFAULT '',
        teacher_id INTEGER NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (teacher_id) REFERENCES users(id)
      )
    `),

    db.prepare(`
      CREATE TABLE IF NOT EXISTS course_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        course_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        session_date TEXT NOT NULL,
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        zoom_url TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (course_id) REFERENCES courses(id)
      )
    `),

    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_course_sessions_course
      ON course_sessions(course_id)
    `),

    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_course_sessions_date
      ON course_sessions(session_date)
    `)
  ]);
}

function getCookie(request, name) {
  const header = request.headers.get("cookie") || "";

  for (const item of header.split(";")) {
    const [key, ...parts] = item.trim().split("=");

    if (key === name) {
      return decodeURIComponent(parts.join("="));
    }
  }

  return null;
}

async function hashToken(token) {
  const data = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", data);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function getCurrentUser(request, db) {
  const token = getCookie(request, "emoe_session");

  if (!token) {
    return null;
  }

  const tokenHash = await hashToken(token);

  const user = await db
    .prepare(`
      SELECT
        users.id,
        users.first_name,
        users.last_name,
        users.email,
        users.role,
        users.active,
        sessions.expires_at
      FROM sessions
      INNER JOIN users
        ON users.id = sessions.user_id
      WHERE sessions.token_hash = ?
      LIMIT 1
    `)
    .bind(tokenHash)
    .first();

  if (!user || !user.active) {
    return null;
  }

  if (new Date(user.expires_at).getTime() <= Date.now()) {
    await db
      .prepare(`
        DELETE FROM sessions
        WHERE token_hash = ?
      `)
      .bind(tokenHash)
      .run();

    return null;
  }

  return user;
}

function requireTeacher(user) {
  return user && (user.role === "teacher" || user.role === "admin");
}

async function createCourse(request, db, user) {
  if (!requireTeacher(user)) {
    return json(
      {
        ok: false,
        error: "Accès réservé aux enseignants."
      },
      403
    );
  }

  let body;

  try {
    body = await request.json();
  } catch {
    return json(
      {
        ok: false,
        error: "Données invalides."
      },
      400
    );
  }

  const title = clean(body.title, 180);
  const description = clean(body.description, 2000);
  const level = clean(body.level, 50);

  if (!title) {
    return json(
      {
        ok: false,
        error: "Le titre du cours est obligatoire."
      },
      422
    );
  }

  const result = await db
    .prepare(`
      INSERT INTO courses
        (title, description, level, teacher_id)
      VALUES (?, ?, ?, ?)
    `)
    .bind(
      title,
      description,
      level,
      user.id
    )
    .run();

  return json(
    {
      ok: true,
      message: "Cours créé.",
      course: {
        id: result.meta.last_row_id,
        title,
        description,
        level,
        teacherId: user.id
      }
    },
    201
  );
}

async function createSession(request, db, user) {
  if (!requireTeacher(user)) {
    return json(
      {
        ok: false,
        error: "Accès réservé aux enseignants."
      },
      403
    );
  }

  let body;

  try {
    body = await request.json();
  } catch {
    return json(
      {
        ok: false,
        error: "Données invalides."
      },
      400
    );
  }

  const courseId = Number(body.courseId);
  const title = clean(body.title, 180);
  const sessionDate = clean(body.sessionDate, 10);
  const startTime = clean(body.startTime, 5);
  const endTime = clean(body.endTime, 5);
  const zoomUrl = clean(body.zoomUrl, 1000);

  if (!Number.isInteger(courseId) || courseId <= 0) {
    return json(
      {
        ok: false,
        error: "Cours invalide."
      },
      422
    );
  }

  if (
    !title ||
    !validDate(sessionDate) ||
    !validTime(startTime) ||
    !validTime(endTime) ||
    !zoomUrl
  ) {
    return json(
      {
        ok: false,
        error: "Les informations de la session sont incomplètes."
      },
      422
    );
  }

  if (!/^https:\/\/([a-z0-9-]+\.)?zoom\.us\//i.test(zoomUrl)) {
    return json(
      {
        ok: false,
        error: "Le lien doit être un lien Zoom valide."
      },
      422
    );
  }

  const course = await db
    .prepare(`
      SELECT id, teacher_id
      FROM courses
      WHERE id = ?
        AND active = 1
      LIMIT 1
    `)
    .bind(courseId)
    .first();

  if (!course) {
    return json(
      {
        ok: false,
        error: "Cours introuvable."
      },
      404
    );
  }

  if (course.teacher_id !== user.id && user.role !== "admin") {
    return json(
      {
        ok: false,
        error: "Vous ne pouvez pas modifier ce cours."
      },
      403
    );
  }

  if (endTime <= startTime) {
    return json(
      {
        ok: false,
        error: "L'heure de fin doit être après l'heure de début."
      },
      422
    );
  }

  const result = await db
    .prepare(`
      INSERT INTO course_sessions
        (
          course_id,
          title,
          session_date,
          start_time,
          end_time,
          zoom_url
        )
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    .bind(
      courseId,
      title,
      sessionDate,
      startTime,
      endTime,
      zoomUrl
    )
    .run();

  return json(
    {
      ok: true,
      message: "Session Zoom créée.",
      session: {
        id: result.meta.last_row_id,
        courseId,
        title,
        sessionDate,
        startTime,
        endTime,
        zoomUrl
      }
    },
    201
  );
}

async function listCourses(request, db) {
  const user = await getCurrentUser(request, db);

  if (!user) {
    return json(
      {
        ok: false,
        error: "Connexion requise."
      },
      401
    );
  }

  const result = await db
    .prepare(`
      SELECT
        courses.id,
        courses.title,
        courses.description,
        courses.level,
        courses.teacher_id,
        courses.created_at,
        users.first_name AS teacher_first_name,
        users.last_name AS teacher_last_name
      FROM courses
      INNER JOIN users
        ON users.id = courses.teacher_id
      WHERE courses.active = 1
      ORDER BY courses.created_at DESC
    `)
    .all();

  return json({
    ok: true,
    courses: result.results
  });
}

async function getCourse(request, db) {
  const user = await getCurrentUser(request, db);

  if (!user) {
    return json(
      {
        ok: false,
        error: "Connexion requise."
      },
      401
    );
  }

  const url = new URL(request.url);
  const courseId = Number(url.searchParams.get("id"));

  if (!Number.isInteger(courseId) || courseId <= 0) {
    return json(
      {
        ok: false,
        error: "Identifiant de cours invalide."
      },
      422
    );
  }

  const course = await db
    .prepare(`
      SELECT
        courses.id,
        courses.title,
        courses.description,
        courses.level,
        courses.teacher_id,
        users.first_name AS teacher_first_name,
        users.last_name AS teacher_last_name
      FROM courses
      INNER JOIN users
        ON users.id = courses.teacher_id
      WHERE courses.id = ?
        AND courses.active = 1
      LIMIT 1
    `)
    .bind(courseId)
    .first();

  if (!course) {
    return json(
      {
        ok: false,
        error: "Cours introuvable."
      },
      404
    );
  }

  const sessions = await db
    .prepare(`
      SELECT
        id,
        title,
        session_date,
        start_time,
        end_time,
        zoom_url,
        active
      FROM course_sessions
      WHERE course_id = ?
        AND active = 1
      ORDER BY session_date ASC, start_time ASC
    `)
    .bind(courseId)
    .all();

  return json({
    ok: true,
    course,
    sessions: sessions.results
  });
}

async function listSessions(request, db) {
  const user = await getCurrentUser(request, db);

  if (!user) {
    return json(
      {
        ok: false,
        error: "Connexion requise."
      },
      401
    );
  }

  const url = new URL(request.url);

  const courseId = Number(
    url.searchParams.get("courseId")
  );

  let query = `
    SELECT
      course_sessions.id,
      course_sessions.course_id,
      course_sessions.title,
      course_sessions.session_date,
      course_sessions.start_time,
      course_sessions.end_time,
      course_sessions.zoom_url,
      courses.title AS course_title
    FROM course_sessions
    INNER JOIN courses
      ON courses.id = course_sessions.course_id
    WHERE course_sessions.active = 1
  `;

  const params = [];

  if (Number.isInteger(courseId) && courseId > 0) {
    query += " AND course_sessions.course_id = ?";
    params.push(courseId);
  }

  query += `
    ORDER BY
      course_sessions.session_date ASC,
      course_sessions.start_time ASC
  `;

  const result = await db
    .prepare(query)
    .bind(...params)
    .all();

  return json({
    ok: true,
    sessions: result.results
  });
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) {
    return json(
      {
        ok: false,
        error: "La base de données E.M.O.E. n'est pas configurée."
      },
      503
    );
  }

  await ensureTables(env.DB);

  const user = await getCurrentUser(request, env.DB);

  if (!user) {
    return json(
      {
        ok: false,
        error: "Connexion requise."
      },
      401
    );
  }

  const url = new URL(request.url);
  const action = url.searchParams.get("action");

  if (action === "create-course") {
    return createCourse(request, env.DB, user);
  }

  if (action === "create-session") {
    return createSession(request, env.DB, user);
  }

  return json(
    {
      ok: false,
      error: "Action inconnue."
    },
    400
  );
}

export async function onRequestGet({ request, env }) {
  if (!env.DB) {
    return json(
      {
        ok: false,
        error: "La base de données E.M.O.E. n'est pas configurée."
      },
      503
    );
  }

  await ensureTables(env.DB);

  const url = new URL(request.url);
  const action = url.searchParams.get("action");

  if (action === "courses") {
    return listCourses(request, env.DB);
  }

  if (action === "course") {
    return getCourse(request, env.DB);
  }

  if (action === "sessions") {
    return listSessions(request, env.DB);
  }

  return json(
    {
      ok: false,
      error: "Action inconnue."
    },
    400
  );
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      allow: "GET, POST, OPTIONS"
    }
  });
}
