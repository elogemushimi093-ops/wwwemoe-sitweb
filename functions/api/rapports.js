/*
 * E.M.O.E — Rapport automatique de présence
 * Étape 5/6
 *
 * Endpoint :
 *
 * POST /api/rapport?action=send
 *
 * Body :
 * {
 *   "sessionId": 123
 * }
 *
 * Le rapport :
 *   - récupère la session ;
 *   - récupère les étudiants ayant participé ;
 *   - calcule présents / partiels / absents ;
 *   - détaille la participation ;
 *   - envoie le rapport par Resend ;
 *   - évite les doublons grâce à une trace d'envoi.
 *
 * Variables Cloudflare nécessaires :
 *
 *   DB
 *   RESEND_API_KEY
 *   RESEND_FROM
 *
 * Destination :
 *
 *   ecoleombredeleternel@gmail.com
 */

const RECIPIENT = "ecoleombredeleternel@gmail.com";

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

  if (
    new Date(user.expires_at).getTime() <=
    Date.now()
  ) {
    return null;
  }

  return user;
}

async function ensureReportTable(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS attendance_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL UNIQUE,
      recipient TEXT NOT NULL,
      resend_id TEXT DEFAULT '',
      sent_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (session_id)
        REFERENCES course_sessions(id)
    )
  `).run();
}

async function getSession(db, sessionId) {
  return db
    .prepare(`
      SELECT
        course_sessions.id,
        course_sessions.title,
        course_sessions.session_date,
        course_sessions.start_time,
        course_sessions.end_time,
        courses.id AS course_id,
        courses.title AS course_title,
        courses.teacher_id,
        teachers.first_name AS teacher_first_name,
        teachers.last_name AS teacher_last_name
      FROM course_sessions
      INNER JOIN courses
        ON courses.id = course_sessions.course_id
      INNER JOIN users AS teachers
        ON teachers.id = courses.teacher_id
      WHERE course_sessions.id = ?
        AND course_sessions.active = 1
      LIMIT 1
    `)
    .bind(sessionId)
    .first();
}

async function getAllStudents(db) {
  const result = await db
    .prepare(`
      SELECT
        id,
        first_name,
        last_name,
        email
      FROM users
      WHERE role = 'student'
        AND active = 1
      ORDER BY last_name ASC, first_name ASC
    `)
    .all();

  return result.results || [];
}

async function getAttendance(db, sessionId) {
  const result = await db
    .prepare(`
      SELECT
        attendance.id,
        attendance.user_id,
        attendance.started_at,
        attendance.finished_at,
        attendance.participation_percent,
        attendance.status,
        users.first_name,
        users.last_name,
        users.email
      FROM attendance
      INNER JOIN users
        ON users.id = attendance.user_id
      WHERE attendance.session_id = ?
      ORDER BY users.last_name ASC, users.first_name ASC
    `)
    .bind(sessionId)
    .all();

  return result.results || [];
}

async function getEventStats(db, attendanceId) {
  const result = await db
    .prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(
          CASE
            WHEN success = 1 THEN 1
            ELSE 0
          END
        ) AS successful,
        SUM(
          CASE
            WHEN event_type = 'checkpoint'
             AND success = 1
            THEN 1
            ELSE 0
          END
        ) AS checkpoints
      FROM attendance_events
      WHERE attendance_id = ?
    `)
    .bind(attendanceId)
    .first();

  return {
    total: Number(result?.total || 0),
    successful: Number(result?.successful || 0),
    checkpoints: Number(result?.checkpoints || 0)
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function statusLabel(status) {
  if (status === "present") {
    return "PRÉSENT";
  }

  if (status === "partial") {
    return "PARTIEL";
  }

  return "ABSENT";
}

function buildTextReport(
  session,
  students,
  attendanceRows,
  eventStats
) {
  const attendanceMap = new Map(
    attendanceRows.map((row) => [
      row.user_id,
      row
    ])
  );

  const lines = [];

  lines.push("RAPPORT DE PRÉSENCE — E.M.O.E.");
  lines.push("");
  lines.push(`Cours : ${session.course_title}`);
  lines.push(`Session : ${session.title}`);
  lines.push(`Date : ${session.session_date}`);
  lines.push(
    `Horaire : ${session.start_time} - ${session.end_time}`
  );
  lines.push(
    `Enseignant : ${session.teacher_first_name} ${session.teacher_last_name}`
  );
  lines.push("");

  let present = 0;
  let partial = 0;
  let absent = 0;

  for (const student of students) {
    const row = attendanceMap.get(student.id);

    let status = "absent";
    let percent = 0;
    let startedAt = "-";
    let finishedAt = "-";
    let checkpoints = 0;

    if (row) {
      status = row.status || "absent";
      percent = Number(
        row.participation_percent || 0
      );

      startedAt =
        row.started_at || "-";

      finishedAt =
        row.finished_at || "-";

      const stats =
        eventStats.get(row.id);

      checkpoints =
        stats?.checkpoints || 0;
    }

    if (status === "present") {
      present++;
    } else if (status === "partial") {
      partial++;
    } else {
      absent++;
    }

    lines.push(
      `${student.last_name} ${student.first_name} | ` +
      `${statusLabel(status)} | ` +
      `${percent}% | ` +
      `checkpoints: ${checkpoints} | ` +
      `début: ${startedAt} | ` +
      `fin: ${finishedAt}`
    );
  }

  lines.push("");
  lines.push("RÉSUMÉ");
  lines.push(`Étudiants : ${students.length}`);
  lines.push(`Présents : ${present}`);
  lines.push(`Partiels : ${partial}`);
  lines.push(`Absents : ${absent}`);

  return {
    text: lines.join("\n"),
    summary: {
      total: students.length,
      present,
      partial,
      absent
    }
  };
}

function buildHtmlReport(
  session,
  students,
  attendanceRows,
  eventStats
) {
  const attendanceMap = new Map(
    attendanceRows.map((row) => [
      row.user_id,
      row
    ])
  );

  let present = 0;
  let partial = 0;
  let absent = 0;

  const rows = students.map((student) => {
    const attendance =
      attendanceMap.get(student.id);

    let status = "absent";
    let percent = 0;
    let startedAt = "-";
    let finishedAt = "-";
    let checkpoints = 0;

    if (attendance) {
      status =
        attendance.status || "absent";

      percent = Number(
        attendance.participation_percent || 0
      );

      startedAt =
        attendance.started_at || "-";

      finishedAt =
        attendance.finished_at || "-";

      const stats =
        eventStats.get(attendance.id);

      checkpoints =
        stats?.checkpoints || 0;
    }

    if (status === "present") {
      present++;
    } else if (status === "partial") {
      partial++;
    } else {
      absent++;
    }

    return `
      <tr>
        <td>
          ${escapeHtml(
            `${student.last_name} ${student.first_name}`
          )}
        </td>
        <td>
          ${escapeHtml(student.email)}
        </td>
        <td>
          <strong>
            ${escapeHtml(statusLabel(status))}
          </strong>
        </td>
        <td>${percent}%</td>
        <td>${checkpoints}/3</td>
        <td>${escapeHtml(startedAt)}</td>
        <td>${escapeHtml(finishedAt)}</td>
      </tr>
    `;
  }).join("");

  return {
    html: `
<!doctype html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Rapport E.M.O.E.</title>
<style>
  body {
    font-family: Arial, sans-serif;
    line-height: 1.5;
    color: #222;
  }

  h1 {
    margin-bottom: 4px;
  }

  .summary {
    margin: 20px 0;
    padding: 16px;
    background: #f3f3f3;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }

  th,
  td {
    border: 1px solid #ddd;
    padding: 8px;
    text-align: left;
  }

  th {
    background: #f1f1f1;
  }
</style>
</head>

<body>

<h1>Rapport de présence — E.M.O.E.</h1>

<p>
<strong>Cours :</strong>
${escapeHtml(session.course_title)}
</p>

<p>
<strong>Session :</strong>
${escapeHtml(session.title)}
</p>

<p>
<strong>Date :</strong>
${escapeHtml(session.session_date)}
</p>

<p>
<strong>Horaire :</strong>
${escapeHtml(session.start_time)}
-
${escapeHtml(session.end_time)}
</p>

<p>
<strong>Enseignant :</strong>
${escapeHtml(
  `${session.teacher_first_name} ${session.teacher_last_name}`
)}
</p>

<div class="summary">
  <strong>Résumé :</strong><br>
  Étudiants : ${students.length}<br>
  Présents : ${present}<br>
  Partiels : ${partial}<br>
  Absents : ${absent}
</div>

<table>
<thead>
<tr>
  <th>Étudiant</th>
  <th>Email</th>
  <th>Statut</th>
  <th>Participation</th>
  <th>Checkpoints</th>
  <th>Début</th>
  <th>Fin</th>
</tr>
</thead>

<tbody>
${rows}
</tbody>
</table>

<p>
Ce rapport mesure les signaux de participation enregistrés
sur la plateforme E.M.O.E. Il ne prétend pas démontrer que
l'étudiant a regardé chaque seconde de la réunion Zoom.
</p>

</body>
</html>
    `,
    summary: {
      total: students.length,
      present,
      partial,
      absent
    }
  };
}

async function sendEmail(
  env,
  session,
  text,
  html
) {
  if (
    !env.RESEND_API_KEY ||
    !env.RESEND_FROM
  ) {
    throw new Error(
      "RESEND_API_KEY ou RESEND_FROM manquant."
    );
  }

  const response = await fetch(
    "https://api.resend.com/emails",
    {
      method: "POST",
      headers: {
        authorization:
          `Bearer ${env.RESEND_API_KEY}`,
        "content-type":
          "application/json"
      },
      body: JSON.stringify({
        from: env.RESEND_FROM,
        to: [RECIPIENT],
        subject:
          `E.M.O.E. — Rapport de présence — ${session.course_title} — ${session.session_date}`,
        text,
        html
      })
    }
  );

  let result = null;

  try {
    result = await response.json();
  } catch {
    result = null;
  }

  if (!response.ok) {
    console.error(
      "Resend rejected attendance report",
      response.status,
      result
    );

    throw new Error(
      "L'envoi du rapport a échoué."
    );
  }

  return result?.id || "";
}

async function sendReport(
  request,
  env,
  db,
  user
) {
  if (
    user.role !== "teacher" &&
    user.role !== "admin"
  ) {
    return json(
      {
        ok: false,
        error:
          "Seuls les enseignants peuvent envoyer un rapport."
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

  const sessionId = Number(
    body.sessionId
  );

  if (
    !Number.isInteger(sessionId) ||
    sessionId <= 0
  ) {
    return json(
      {
        ok: false,
        error: "Session invalide."
      },
      422
    );
  }

  const session =
    await getSession(
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

  if (
    user.role !== "admin" &&
    session.teacher_id !== user.id
  ) {
    return json(
      {
        ok: false,
        error:
          "Vous ne pouvez pas envoyer le rapport de cette session."
      },
      403
    );
  }

  const existing =
    await db
      .prepare(`
        SELECT
          id,
          resend_id,
          sent_at
        FROM attendance_reports
        WHERE session_id = ?
        LIMIT 1
      `)
      .bind(sessionId)
      .first();

  /*
   * Protection contre l'envoi accidentel du même rapport
   * plusieurs fois.
   */
  if (existing) {
    return json({
      ok: true,
      alreadySent: true,
      message:
        "Le rapport de cette session a déjà été envoyé.",
      sentAt: existing.sent_at,
      resendId: existing.resend_id || null
    });
  }

  const students =
    await getAllStudents(db);

  const attendanceRows =
    await getAttendance(
      db,
      sessionId
    );

  const eventStats =
    new Map();

  for (const row of attendanceRows) {
    eventStats.set(
      row.id,
      await getEventStats(
        db,
        row.id
      )
    );
  }

  const textReport =
    buildTextReport(
      session,
      students,
      attendanceRows,
      eventStats
    );

  const htmlReport =
    buildHtmlReport(
      session,
      students,
      attendanceRows,
      eventStats
    );

  let resendId;

  try {
    resendId =
      await sendEmail(
        env,
        session,
        textReport.text,
        htmlReport.html
      );
  } catch (error) {
    console.error(
      "E.M.O.E. attendance report error",
      error
    );

    return json(
      {
        ok: false,
        error:
          "Le rapport n'a pas pu être envoyé."
      },
      502
    );
  }

  await db
    .prepare(`
      INSERT INTO attendance_reports
        (
          session_id,
          recipient,
          resend_id
        )
      VALUES (?, ?, ?)
    `)
    .bind(
      sessionId,
      RECIPIENT,
      resendId
    )
    .run();

  return json({
    ok: true,
    message:
      "Rapport de présence envoyé.",
    recipient: RECIPIENT,
    resendId,
    summary:
      htmlReport.summary
  });
}

export async function onRequestPost({
  request,
  env
}) {
  if (!env.DB) {
    return json(
      {
        ok: false,
        error:
          "La base de données E.M.O.E. n'est pas configurée."
      },
      503
    );
  }

  await ensureReportTable(
    env.DB
  );

  const user =
    await getCurrentUser(
      request,
      env.DB
    );

  if (!user) {
    return json(
      {
        ok: false,
        error:
          "Connexion requise."
      },
      401
    );
  }

  const action =
    new URL(request.url)
      .searchParams
      .get("action");

  if (action === "send") {
    return sendReport(
      request,
      env,
      env.DB,
      user
    );
  }

  return json(
    {
      ok: false,
      error:
        "Action inconnue."
    },
    400
  );
}

export async function onRequestGet({
  request,
  env
}) {
  if (!env.DB) {
    return json(
      {
        ok: false,
        error:
          "La base de données E.M.O.E. n'est pas configurée."
      },
      503
    );
  }

  await ensureReportTable(
    env.DB
  );

  const user =
    await getCurrentUser(
      request,
      env.DB
    );

  if (!user) {
    return json(
      {
        ok: false,
        error:
          "Connexion requise."
      },
      401
    );
  }

  if (
    user.role !== "teacher" &&
    user.role !== "admin"
  ) {
    return json(
      {
        ok: false,
        error:
          "Accès réservé aux enseignants."
      },
      403
    );
  }

  const url =
    new URL(request.url);

  const sessionId =
    Number(
      url.searchParams.get(
        "sessionId"
      )
    );

  if (
    !Number.isInteger(sessionId) ||
    sessionId <= 0
  ) {
    return json(
      {
        ok: false,
        error:
          "Session invalide."
      },
      422
    );
  }

  const report =
    await env.DB
      .prepare(`
        SELECT
          id,
          session_id,
          recipient,
          resend_id,
          sent_at
        FROM attendance_reports
        WHERE session_id = ?
        LIMIT 1
      `)
      .bind(sessionId)
      .first();

  return json({
    ok: true,
    sent: Boolean(report),
    report: report || null
  });
}

export async function onRequestOptions() {
  return new Response(
    null,
    {
      status: 204,
      headers: {
        allow:
          "GET, POST, OPTIONS"
      }
    }
  );
}
