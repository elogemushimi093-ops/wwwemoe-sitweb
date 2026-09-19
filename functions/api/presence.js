/*
 * E.M.O.E — Présence et participation automatique
 * Étape 4/6
 *
 * Endpoint :
 *   GET  /api/presence?action=status&sessionId=123
 *   GET  /api/presence?action=challenge&sessionId=123
 *
 *   POST /api/presence?action=start
 *   POST /api/presence?action=checkpoint
 *   POST /api/presence?action=finish
 *
 * Principe :
 *   1. L'étudiant doit être connecté.
 *   2. Il rejoint une session programmée.
 *   3. Le serveur enregistre sa présence initiale.
 *   4. Des validations intermédiaires sont demandées.
 *   5. Une validation finale est enregistrée.
 *   6. Le serveur calcule automatiquement le niveau de participation.
 *
 * IMPORTANT :
 * Cette présence mesure la participation sur la plateforme.
 * Elle ne prétend pas prouver que l'étudiant a regardé chaque seconde
 * de la réunion Zoom.
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
    return null;
  }

  return user;
}

async function ensureTables(db) {
  await db.batch([
    db.prepare(`
      CREATE TABLE IF NOT EXISTS attendance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        participation_percent INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'absent',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(session_id, user_id),
        FOREIGN KEY (session_id) REFERENCES course_sessions(id),
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `),

    db.prepare(`
      CREATE TABLE IF NOT EXISTS attendance_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        attendance_id INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        event_number INTEGER NOT NULL DEFAULT 0,
        answer TEXT DEFAULT '',
        success INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (attendance_id) REFERENCES attendance(id)
      )
    `),

    db.prepare(`
      CREATE TABLE IF NOT EXISTS attendance_challenges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        attendance_id INTEGER NOT NULL,
        challenge_number INTEGER NOT NULL,
        question TEXT NOT NULL,
        expected_answer TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        used INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(attendance_id, challenge_number),
        FOREIGN KEY (attendance_id) REFERENCES attendance(id)
      )
    `),

    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_attendance_session
      ON attendance(session_id)
    `),

    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_attendance_user
      ON attendance(user_id)
    `),

    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_attendance_events_attendance
      ON attendance_events(attendance_id)
    `)
  ]);
}

async function getSession(db, sessionId) {
  return db
    .prepare(`
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
      WHERE course_sessions.id = ?
        AND course_sessions.active = 1
      LIMIT 1
    `)
    .bind(sessionId)
    .first();
}

function sessionTimes(session) {
  const start = new Date(
    `${session.session_date}T${session.start_time}:00`
  );

  const end = new Date(
    `${session.session_date}T${session.end_time}:00`
  );

  return {
    start,
    end
  };
}

function currentStage(session) {
  const { start, end } = sessionTimes(session);
  const now = Date.now();

  const startMs = start.getTime();
  const endMs = end.getTime();
  const duration = endMs - startMs;

  /*
   * On accepte une entrée jusqu'à 15 minutes avant le début.
   * Les checkpoints sont répartis sur la session.
   */
  const earlyWindow = 15 * 60 * 1000;

  if (now < startMs - earlyWindow) {
    return "too_early";
  }

  if (now >= endMs) {
    return "ended";
  }

  if (now < startMs + duration * 0.25) {
    return "initial";
  }

  if (now < startMs + duration * 0.50) {
    return "checkpoint_1";
  }

  if (now < startMs + duration * 0.75) {
    return "checkpoint_2";
  }

  return "checkpoint_3";
}

async function getAttendance(db, sessionId, userId) {
  return db
    .prepare(`
      SELECT *
      FROM attendance
      WHERE session_id = ?
        AND user_id = ?
      LIMIT 1
    `)
    .bind(sessionId, userId)
    .first();
}

function statusFromPercent(percent) {
  if (percent >= 75) {
    return "present";
  }

  if (percent >= 35) {
    return "partial";
  }

  return "absent";
}

async function calculateParticipation(db, attendanceId) {
  const result = await db
    .prepare(`
      SELECT
        SUM(
          CASE
            WHEN success = 1 THEN 1
            ELSE 0
          END
        ) AS successful,
        COUNT(*) AS total
      FROM attendance_events
      WHERE attendance_id = ?
        AND event_type IN (
          'start',
          'checkpoint',
          'finish'
        )
    `)
    .bind(attendanceId)
    .first();

  const successful = Number(result?.successful || 0);
  const total = Number(result?.total || 0);

  if (!total) {
    return 0;
  }

  return Math.min(
    100,
    Math.round((successful / total) * 100)
  );
}

async function updateAttendance(db, attendanceId) {
  const percent = await calculateParticipation(
    db,
    attendanceId
  );

  const status = statusFromPercent(percent);

  await db
    .prepare(`
      UPDATE attendance
      SET
        participation_percent = ?,
        status = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `)
    .bind(
      percent,
      status,
      attendanceId
    )
    .run();

  return {
    participationPercent: percent,
    status
  };
}

async function startAttendance(request, db, user) {
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

  const sessionId = Number(body.sessionId);

  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    return json(
      {
        ok: false,
        error: "Session invalide."
      },
      422
    );
  }

  const session = await getSession(db, sessionId);

  if (!session) {
    return json(
      {
        ok: false,
        error: "Session introuvable."
      },
      404
    );
  }

  if (user.role !== "student") {
    return json(
      {
        ok: false,
        error: "Cette présence est réservée aux étudiants."
      },
      403
    );
  }

  const stage = currentStage(session);

  if (stage === "too_early") {
    return json(
      {
        ok: false,
        error: "La session n'est pas encore ouverte."
      },
      403
    );
  }

  if (stage === "ended") {
    return json(
      {
        ok: false,
        error: "La session est terminée."
      },
      403
    );
  }

  let attendance = await getAttendance(
    db,
    sessionId,
    user.id
  );

  if (attendance) {
    return json({
      ok: true,
      alreadyStarted: true,
      attendance: {
        id: attendance.id,
        participationPercent:
          attendance.participation_percent,
        status: attendance.status
      }
    });
  }

  const result = await db
    .prepare(`
      INSERT INTO attendance
        (
          session_id,
          user_id,
          started_at,
          participation_percent,
          status
        )
      VALUES (?, ?, CURRENT_TIMESTAMP, 25, 'partial')
    `)
    .bind(
      sessionId,
      user.id
    )
    .run();

  const attendanceId = result.meta.last_row_id;

  await db
    .prepare(`
      INSERT INTO attendance_events
        (
          attendance_id,
          event_type,
          event_number,
          success
        )
      VALUES (?, 'start', 0, 1)
    `)
    .bind(attendanceId)
    .run();

  attendance = await getAttendance(
    db,
    sessionId,
    user.id
  );

  return json(
    {
      ok: true,
      message: "Présence initiale enregistrée.",
      attendance: {
        id: attendance.id,
        participationPercent:
          attendance.participation_percent,
        status: attendance.status
      }
    },
    201
  );
}

async function challenge(request, db, user) {
  const url = new URL(request.url);

  const sessionId = Number(
    url.searchParams.get("sessionId")
  );

  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    return json(
      {
        ok: false,
        error: "Session invalide."
      },
      422
    );
  }

  const session = await getSession(db, sessionId);

  if (!session) {
    return json(
      {
        ok: false,
        error: "Session introuvable."
      },
      404
    );
  }

  const attendance = await getAttendance(
    db,
    sessionId,
    user.id
  );

  if (!attendance) {
    return json(
      {
        ok: false,
        error: "La présence initiale n'a pas encore été enregistrée."
      },
      403
    );
  }

  const stage = currentStage(session);

  const stageNumbers = {
    checkpoint_1: 1,
    checkpoint_2: 2,
    checkpoint_3: 3
  };

  const challengeNumber =
    stageNumbers[stage];

  if (!challengeNumber) {
    return json(
      {
        ok: false,
        error: "Aucune validation intermédiaire n'est actuellement disponible."
      },
      403
    );
  }

  const existing = await db
    .prepare(`
      SELECT
        id,
        question,
        expires_at,
        used
      FROM attendance_challenges
      WHERE attendance_id = ?
        AND challenge_number = ?
      LIMIT 1
    `)
    .bind(
      attendance.id,
      challengeNumber
    )
    .first();

  if (existing && !existing.used) {
    if (
      new Date(existing.expires_at).getTime() >
      Date.now()
    ) {
      return json({
        ok: true,
        challenge: {
          number: challengeNumber,
          question: existing.question,
          expiresAt: existing.expires_at
        }
      });
    }
  }

  /*
   * Petite validation numérique générée côté serveur.
   * Elle sert de signal de participation, pas d'examen.
   */
  const a = 2 + Math.floor(Math.random() * 8);
  const b = 2 + Math.floor(Math.random() * 8);
  const operation = a + b;

  const question =
    `Validation ${challengeNumber}/3 : combien font ${a} + ${b} ?`;

  const expiresAt = new Date(
    Date.now() + 5 * 60 * 1000
  ).toISOString();

  await db
    .prepare(`
      INSERT INTO attendance_challenges
        (
          attendance_id,
          challenge_number,
          question,
          expected_answer,
          expires_at
        )
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(attendance_id, challenge_number)
      DO UPDATE SET
        question = excluded.question,
        expected_answer = excluded.expected_answer,
        expires_at = excluded.expires_at,
        used = 0
    `)
    .bind(
      attendance.id,
      challengeNumber,
      question,
      String(operation),
      expiresAt
    )
    .run();

  return json({
    ok: true,
    challenge: {
      number: challengeNumber,
      question,
      expiresAt
    }
  });
}

async function checkpoint(request, db, user) {
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

  const sessionId = Number(body.sessionId);
  const challengeNumber = Number(
    body.challengeNumber
  );
  const answer = clean(body.answer, 20);

  if (
    !Number.isInteger(sessionId) ||
    !Number.isInteger(challengeNumber) ||
    challengeNumber < 1 ||
    challengeNumber > 3
  ) {
    return json(
      {
        ok: false,
        error: "Validation invalide."
      },
      422
    );
  }

  const session = await getSession(
    db,
    sessionId
  );

  if (!session) {
    return json(
      {
        ok: false,
        error: "Session introuvable."
      },
      404
    );
  }

  const attendance = await getAttendance(
    db,
    sessionId,
    user.id
  );

  if (!attendance) {
    return json(
      {
        ok: false,
        error: "Présence initiale absente."
      },
      403
    );
  }

  const stage = currentStage(session);

  const stageNumbers = {
    checkpoint_1: 1,
    checkpoint_2: 2,
    checkpoint_3: 3
  };

  if (
    stageNumbers[stage] !== challengeNumber
  ) {
    return json(
      {
        ok: false,
        error: "Cette validation n'est pas disponible actuellement."
      },
      403
    );
  }

  const challenge = await db
    .prepare(`
      SELECT *
      FROM attendance_challenges
      WHERE attendance_id = ?
        AND challenge_number = ?
      LIMIT 1
    `)
    .bind(
      attendance.id,
      challengeNumber
    )
    .first();

  if (!challenge) {
    return json(
      {
        ok: false,
        error: "Validation introuvable."
      },
      404
    );
  }

  if (challenge.used) {
    return json(
      {
        ok: false,
        error: "Cette validation a déjà été utilisée."
      },
      409
    );
  }

  if (
    new Date(challenge.expires_at).getTime() <=
    Date.now()
  ) {
    return json(
      {
        ok: false,
        error: "Cette validation a expiré."
      },
      410
    );
  }

  const success =
    answer.toLowerCase() ===
    String(challenge.expected_answer).toLowerCase();

  await db
    .prepare(`
      UPDATE attendance_challenges
      SET used = 1
      WHERE id = ?
    `)
    .bind(challenge.id)
    .run();

  await db
    .prepare(`
      INSERT INTO attendance_events
        (
          attendance_id,
          event_type,
          event_number,
          answer,
          success
        )
      VALUES (?, 'checkpoint', ?, ?, ?)
    `)
    .bind(
      attendance.id,
      challengeNumber,
      answer,
      success ? 1 : 0
    )
    .run();

  const result = await updateAttendance(
    db,
    attendance.id
  );

  return json({
    ok: true,
    correct: success,
    participationPercent:
      result.participationPercent,
    status: result.status
  });
}

async function finish(request, db, user) {
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

  const sessionId = Number(body.sessionId);

  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    return json(
      {
        ok: false,
        error: "Session invalide."
      },
      422
    );
  }

  const session = await getSession(
    db,
    sessionId
  );

  if (!session) {
    return json(
      {
        ok: false,
        error: "Session introuvable."
      },
      404
    );
  }

  const attendance = await getAttendance(
    db,
    sessionId,
    user.id
  );

  if (!attendance) {
    return json(
      {
        ok: false,
        error: "Aucune présence enregistrée."
      },
      403
    );
  }

  const existingFinish = await db
    .prepare(`
      SELECT id
      FROM attendance_events
      WHERE attendance_id = ?
        AND event_type = 'finish'
      LIMIT 1
    `)
    .bind(attendance.id)
    .first();

  if (!existingFinish) {
    await db
      .prepare(`
        INSERT INTO attendance_events
          (
            attendance_id,
            event_type,
            event_number,
            success
          )
        VALUES (?, 'finish', 4, 1)
      `)
      .bind(attendance.id)
      .run();
  }

  await db
    .prepare(`
      UPDATE attendance
      SET finished_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `)
    .bind(attendance.id)
    .run();

  const result = await updateAttendance(
    db,
    attendance.id
  );

  return json({
    ok: true,
    message: "Participation finale enregistrée.",
    participationPercent:
      result.participationPercent,
    status: result.status
  });
}

async function getStatus(request, db, user) {
  const url = new URL(request.url);

  const sessionId = Number(
    url.searchParams.get("sessionId")
  );

  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    return json(
      {
        ok: false,
        error: "Session invalide."
      },
      422
    );
  }

  const session = await getSession(
    db,
    sessionId
  );

  if (!session) {
    return json(
      {
        ok: false,
        error: "Session introuvable."
      },
      404
    );
  }

  const attendance = await getAttendance(
    db,
    sessionId,
    user.id
  );

  const stage = currentStage(session);

  if (!attendance) {
    return json({
      ok: true,
      session: {
        id: session.id,
        title: session.title,
        courseTitle: session.course_title,
        sessionDate: session.session_date,
        startTime: session.start_time,
        endTime: session.end_time,
        stage
      },
      attendance: null
    });
  }

  const result = await updateAttendance(
    db,
    attendance.id
  );

  return json({
    ok: true,
    session: {
      id: session.id,
      title: session.title,
      courseTitle: session.course_title,
      sessionDate: session.session_date,
      startTime: session.start_time,
      endTime: session.end_time,
      stage
    },
    attendance: {
      id: attendance.id,
      startedAt: attendance.started_at,
      finishedAt: attendance.finished_at,
      participationPercent:
        result.participationPercent,
      status: result.status
    }
  });
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

  const user = await getCurrentUser(
    request,
    env.DB
  );

  if (!user) {
    return json(
      {
        ok: false,
        error: "Connexion requise."
      },
      401
    );
  }

  const action = new URL(request.url)
    .searchParams
    .get("action");

  if (action === "status") {
    return getStatus(
      request,
      env.DB,
      user
    );
  }

  if (action === "challenge") {
    return challenge(
      request,
      env.DB,
      user
    );
  }

  return json(
    {
      ok: false,
      error: "Action inconnue."
    },
    400
  );
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

  const user = await getCurrentUser(
    request,
    env.DB
  );

  if (!user) {
    return json(
      {
        ok: false,
        error: "Connexion requise."
      },
      401
    );
  }

  const action = new URL(request.url)
    .searchParams
    .get("action");

  if (action === "start") {
    return startAttendance(
      request,
      env.DB,
      user
    );
  }

  if (action === "checkpoint") {
    return checkpoint(
      request,
      env.DB,
      user
    );
  }

  if (action === "finish") {
    return finish(
      request,
      env.DB,
      user
    );
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
