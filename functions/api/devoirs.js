/**
 * E.M.O.E. — Étape 6/6
 * Devoirs / TP / QCM / Notes / Statistiques
 *
 * Route :
 *   /api/devoirs
 *
 * Actions principales :
 *   POST ?action=create
 *   POST ?action=submit
 *   POST ?action=grade
 *   POST ?action=create-question
 *   POST ?action=answer
 *
 *   GET ?action=list
 *   GET ?action=detail
 *   GET ?action=my-submissions
 *   GET ?action=stats
 *
 * Requiert :
 *   env.DB
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      ...CORS_HEADERS
    }
  });
}

function clean(value, max = 5000) {
  return String(value ?? "").trim().slice(0, max);
}

async function initDB(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      type TEXT NOT NULL DEFAULT 'devoir',
      due_date TEXT,
      max_points REAL NOT NULL DEFAULT 20,
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      active INTEGER NOT NULL DEFAULT 1
    )
  `).run();

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      assignment_id INTEGER NOT NULL,
      student_id INTEGER NOT NULL,
      content TEXT DEFAULT '',
      file_url TEXT DEFAULT '',
      submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      status TEXT NOT NULL DEFAULT 'submitted',
      UNIQUE(assignment_id, student_id)
    )
  `).run();

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS grades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      submission_id INTEGER NOT NULL UNIQUE,
      points REAL NOT NULL DEFAULT 0,
      feedback TEXT DEFAULT '',
      graded_by INTEGER,
      graded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS assignment_questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      assignment_id INTEGER NOT NULL,
      question TEXT NOT NULL,
      option_a TEXT DEFAULT '',
      option_b TEXT DEFAULT '',
      option_c TEXT DEFAULT '',
      option_d TEXT DEFAULT '',
      correct_option TEXT DEFAULT '',
      points REAL NOT NULL DEFAULT 1
    )
  `).run();

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS question_answers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question_id INTEGER NOT NULL,
      student_id INTEGER NOT NULL,
      answer TEXT NOT NULL,
      points REAL NOT NULL DEFAULT 0,
      answered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(question_id, student_id)
    )
  `).run();
}

async function getUser(request, db) {
  const cookie = request.headers.get("Cookie") || "";

  const match = cookie.match(
    /(?:^|;\s*)emoe_session=([^;]+)/
  );

  if (!match) return null;

  const token = decodeURIComponent(match[1]);

  const result = await db.prepare(`
    SELECT
      s.id AS session_id,
      s.user_id,
      s.expires_at,
      u.name,
      u.email,
      u.role
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = ?
      AND s.expires_at > datetime('now')
  `).bind(token).first();

  return result || null;
}

function isTeacher(user) {
  return user && (user.role === "teacher" || user.role === "admin");
}

async function courseExists(db, courseId) {
  return await db.prepare(`
    SELECT *
    FROM courses
    WHERE id = ?
  `).bind(courseId).first();
}

async function assignmentAccess(db, assignmentId, user) {
  const assignment = await db.prepare(`
    SELECT
      a.*,
      c.title AS course_title,
      c.teacher_id
    FROM assignments a
    JOIN courses c ON c.id = a.course_id
    WHERE a.id = ?
  `).bind(assignmentId).first();

  if (!assignment) {
    return { assignment: null, allowed: false };
  }

  if (user.role === "admin") {
    return { assignment, allowed: true };
  }

  if (user.role === "teacher") {
    return {
      assignment,
      allowed: Number(assignment.teacher_id) === Number(user.user_id)
    };
  }

  return {
    assignment,
    allowed: true
  };
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS
  });
}

export async function onRequest(context) {
  const { request, env } = context;

  if (!env.DB) {
    return json({
      success: false,
      error: "La base D1 n'est pas configurée."
    }, 500);
  }

  const db = env.DB;

  try {
    await initDB(db);

    const url = new URL(request.url);
    const action = url.searchParams.get("action") || "list";

    const user = await getUser(request, db);

    /* =========================================================
       GET — LISTE DES DEVOIRS
       ========================================================= */

    if (request.method === "GET" && action === "list") {
      const courseId = url.searchParams.get("courseId");

      let result;

      if (courseId) {
        result = await db.prepare(`
          SELECT
            a.*,
            c.title AS course_title
          FROM assignments a
          JOIN courses c ON c.id = a.course_id
          WHERE a.course_id = ?
            AND a.active = 1
          ORDER BY a.due_date ASC, a.created_at DESC
        `).bind(courseId).all();
      } else {
        result = await db.prepare(`
          SELECT
            a.*,
            c.title AS course_title
          FROM assignments a
          JOIN courses c ON c.id = a.course_id
          WHERE a.active = 1
          ORDER BY a.due_date ASC, a.created_at DESC
        `).all();
      }

      return json({
        success: true,
        assignments: result.results || []
      });
    }

    /* =========================================================
       GET — DETAIL D'UN DEVOIR
       ========================================================= */

    if (request.method === "GET" && action === "detail") {
      const assignmentId = Number(url.searchParams.get("assignmentId"));

      if (!assignmentId) {
        return json({
          success: false,
          error: "assignmentId requis."
        }, 400);
      }

      const assignment = await db.prepare(`
        SELECT
          a.*,
          c.title AS course_title
        FROM assignments a
        JOIN courses c ON c.id = a.course_id
        WHERE a.id = ?
      `).bind(assignmentId).first();

      if (!assignment) {
        return json({
          success: false,
          error: "Devoir introuvable."
        }, 404);
      }

      const questions = await db.prepare(`
        SELECT
          id,
          assignment_id,
          question,
          option_a,
          option_b,
          option_c,
          option_d,
          points
        FROM assignment_questions
        WHERE assignment_id = ?
        ORDER BY id ASC
      `).bind(assignmentId).all();

      return json({
        success: true,
        assignment,
        questions: questions.results || []
      });
    }

    /* =========================================================
       GET — MES SOUMISSIONS
       ========================================================= */

    if (request.method === "GET" && action === "my-submissions") {
      if (!user) {
        return json({
          success: false,
          error: "Connexion requise."
        }, 401);
      }

      const result = await db.prepare(`
        SELECT
          s.*,
          a.title,
          a.type,
          a.max_points,
          a.course_id,
          c.title AS course_title,
          g.points,
          g.feedback,
          g.graded_at
        FROM submissions s
        JOIN assignments a ON a.id = s.assignment_id
        JOIN courses c ON c.id = a.course_id
        LEFT JOIN grades g ON g.submission_id = s.id
        WHERE s.student_id = ?
        ORDER BY s.submitted_at DESC
      `).bind(user.user_id).all();

      return json({
        success: true,
        submissions: result.results || []
      });
    }

    /* =========================================================
       GET — STATISTIQUES
       ========================================================= */

    if (request.method === "GET" && action === "stats") {
      if (!user) {
        return json({
          success: false,
          error: "Connexion requise."
        }, 401);
      }

      const studentId = url.searchParams.get("studentId");

      let targetStudent = user.user_id;

      if (studentId && isTeacher(user)) {
        targetStudent = Number(studentId);
      }

      const totals = await db.prepare(`
        SELECT
          COUNT(*) AS total_submissions,
          COUNT(g.id) AS graded_submissions,
          COALESCE(SUM(g.points), 0) AS earned_points,
          COALESCE(SUM(a.max_points), 0) AS possible_points
        FROM submissions s
        JOIN assignments a ON a.id = s.assignment_id
        LEFT JOIN grades g ON g.submission_id = s.id
        WHERE s.student_id = ?
      `).bind(targetStudent).first();

      const average = totals &&
        Number(totals.possible_points) > 0
        ? (
            Number(totals.earned_points) /
            Number(totals.possible_points)
          ) * 100
        : 0;

      const courses = await db.prepare(`
        SELECT
          c.id,
          c.title,
          COUNT(DISTINCT a.id) AS assignments_count,
          COUNT(DISTINCT s.id) AS submissions_count,
          COALESCE(SUM(g.points), 0) AS earned_points,
          COALESCE(SUM(a.max_points), 0) AS possible_points
        FROM courses c
        LEFT JOIN assignments a
          ON a.course_id = c.id
        LEFT JOIN submissions s
          ON s.assignment_id = a.id
          AND s.student_id = ?
        LEFT JOIN grades g
          ON g.submission_id = s.id
        GROUP BY c.id, c.title
        ORDER BY c.title
      `).bind(targetStudent).all();

      return json({
        success: true,
        student_id: targetStudent,
        totals: {
          ...totals,
          average_percent: Number(average.toFixed(2))
        },
        courses: courses.results || []
      });
    }

    /* =========================================================
       POST — CRÉER UN DEVOIR / TP / EXAMEN
       ========================================================= */

    if (request.method === "POST" && action === "create") {
      if (!user || !isTeacher(user)) {
        return json({
          success: false,
          error: "Accès enseignant requis."
        }, 403);
      }

      const body = await request.json();

      const courseId = Number(body.courseId);
      const title = clean(body.title, 200);
      const description = clean(body.description, 10000);
      const type = clean(body.type || "devoir", 50);
      const dueDate = clean(body.dueDate, 100);
      const maxPoints = Number(body.maxPoints || 20);

      if (!courseId || !title) {
        return json({
          success: false,
          error: "courseId et title sont requis."
        }, 400);
      }

      const course = await courseExists(db, courseId);

      if (!course) {
        return json({
          success: false,
          error: "Cours introuvable."
        }, 404);
      }

      if (
        user.role !== "admin" &&
        Number(course.teacher_id) !== Number(user.user_id)
      ) {
        return json({
          success: false,
          error: "Vous n'êtes pas responsable de ce cours."
        }, 403);
      }

      if (!Number.isFinite(maxPoints) || maxPoints <= 0) {
        return json({
          success: false,
          error: "maxPoints invalide."
        }, 400);
      }

      const allowedTypes = [
        "devoir",
        "tp",
        "qcm",
        "examen"
      ];

      if (!allowedTypes.includes(type)) {
        return json({
          success: false,
          error: "Type d'évaluation invalide."
        }, 400);
      }

      const result = await db.prepare(`
        INSERT INTO assignments
          (course_id, title, description, type, due_date, max_points, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(
        courseId,
        title,
        description,
        type,
        dueDate || null,
        maxPoints,
        user.user_id
      ).run();

      return json({
        success: true,
        message: "Évaluation créée.",
        assignment_id: result.meta.last_row_id
      }, 201);
    }

    /* =========================================================
       POST — AJOUTER UNE QUESTION QCM
       ========================================================= */

    if (request.method === "POST" && action === "create-question") {
      if (!user || !isTeacher(user)) {
        return json({
          success: false,
          error: "Accès enseignant requis."
        }, 403);
      }

      const body = await request.json();

      const assignmentId = Number(body.assignmentId);
      const question = clean(body.question, 3000);

      if (!assignmentId || !question) {
        return json({
          success: false,
          error: "assignmentId et question sont requis."
        }, 400);
      }

      const access = await assignmentAccess(
        db,
        assignmentId,
        user
      );

      if (!access.assignment) {
        return json({
          success: false,
          error: "Évaluation introuvable."
        }, 404);
      }

      if (!access.allowed) {
        return json({
          success: false,
          error: "Accès refusé."
        }, 403);
      }

      if (access.assignment.type !== "qcm") {
        return json({
          success: false,
          error: "Les questions sont réservées aux QCM."
        }, 400);
      }

      const optionA = clean(body.optionA, 1000);
      const optionB = clean(body.optionB, 1000);
      const optionC = clean(body.optionC, 1000);
      const optionD = clean(body.optionD, 1000);
      const correctOption = clean(body.correctOption, 1);
      const points = Number(body.points || 1);

      if (!["A", "B", "C", "D"].includes(correctOption)) {
        return json({
          success: false,
          error: "correctOption doit être A, B, C ou D."
        }, 400);
      }

      const result = await db.prepare(`
        INSERT INTO assignment_questions
          (
            assignment_id,
            question,
            option_a,
            option_b,
            option_c,
            option_d,
            correct_option,
            points
          )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        assignmentId,
        question,
        optionA,
        optionB,
        optionC,
        optionD,
        correctOption,
        points
      ).run();

      return json({
        success: true,
        message: "Question ajoutée.",
        question_id: result.meta.last_row_id
      }, 201);
    }

    /* =========================================================
       POST — SOUMETTRE UN DEVOIR / TP
       ========================================================= */

    if (request.method === "POST" && action === "submit") {
      if (!user || user.role !== "student") {
        return json({
          success: false,
          error: "Un compte étudiant est requis."
        }, 403);
      }

      const body = await request.json();

      const assignmentId = Number(body.assignmentId);
      const content = clean(body.content, 30000);
      const fileUrl = clean(body.fileUrl, 2000);

      if (!assignmentId) {
        return json({
          success: false,
          error: "assignmentId requis."
        }, 400);
      }

      const assignment = await db.prepare(`
        SELECT *
        FROM assignments
        WHERE id = ?
          AND active = 1
      `).bind(assignmentId).first();

      if (!assignment) {
        return json({
          success: false,
          error: "Évaluation introuvable."
        }, 404);
      }

      if (assignment.due_date) {
        const due = new Date(assignment.due_date);

        if (
          !Number.isNaN(due.getTime()) &&
          new Date() > due
        ) {
          return json({
            success: false,
            error: "La date limite est dépassée."
          }, 400);
        }
      }

      const result = await db.prepare(`
        INSERT INTO submissions
          (
            assignment_id,
            student_id,
            content,
            file_url
          )
        VALUES (?, ?, ?, ?)
        ON CONFLICT(assignment_id, student_id)
        DO UPDATE SET
          content = excluded.content,
          file_url = excluded.file_url,
          submitted_at = CURRENT_TIMESTAMP,
          status = 'resubmitted'
      `).bind(
        assignmentId,
        user.user_id,
        content,
        fileUrl
      ).run();

      const submission = await db.prepare(`
        SELECT *
        FROM submissions
        WHERE assignment_id = ?
          AND student_id = ?
      `).bind(
        assignmentId,
        user.user_id
      ).first();

      return json({
        success: true,
        message: "Travail remis avec succès.",
        submission_id: submission?.id || result.meta.last_row_id
      }, 201);
    }

    /* =========================================================
       POST — RÉPONDRE À UNE QUESTION QCM
       ========================================================= */

    if (request.method === "POST" && action === "answer") {
      if (!user || user.role !== "student") {
        return json({
          success: false,
          error: "Connexion étudiant requise."
        }, 403);
      }

      const body = await request.json();

      const questionId = Number(body.questionId);
      const answer = clean(body.answer, 1);

      if (!questionId || !answer) {
        return json({
          success: false,
          error: "questionId et answer sont requis."
        }, 400);
      }

      if (!["A", "B", "C", "D"].includes(answer)) {
        return json({
          success: false,
          error: "Réponse QCM invalide."
        }, 400);
      }

      const question = await db.prepare(`
        SELECT *
        FROM assignment_questions
        WHERE id = ?
      `).bind(questionId).first();

      if (!question) {
        return json({
          success: false,
          error: "Question introuvable."
        }, 404);
      }

      const points =
        answer === question.correct_option
          ? Number(question.points)
          : 0;

      await db.prepare(`
        INSERT INTO question_answers
          (
            question_id,
            student_id,
            answer,
            points
          )
        VALUES (?, ?, ?, ?)
        ON CONFLICT(question_id, student_id)
        DO UPDATE SET
          answer = excluded.answer,
          points = excluded.points,
          answered_at = CURRENT_TIMESTAMP
      `).bind(
        questionId,
        user.user_id,
        answer,
        points
      ).run();

      return json({
        success: true,
        message: "Réponse enregistrée."
      });
    }

    /* =========================================================
       POST — CORRIGER / NOTER
       ========================================================= */

    if (request.method === "POST" && action === "grade") {
      if (!user || !isTeacher(user)) {
        return json({
          success: false,
          error: "Accès enseignant requis."
        }, 403);
      }

      const body = await request.json();

      const submissionId = Number(body.submissionId);
      const points = Number(body.points);
      const feedback = clean(body.feedback, 10000);

      if (!submissionId || !Number.isFinite(points)) {
        return json({
          success: false,
          error: "submissionId et points sont requis."
        }, 400);
      }

      const submission = await db.prepare(`
        SELECT
          s.*,
          a.max_points,
          a.course_id,
          c.teacher_id
        FROM submissions s
        JOIN assignments a ON a.id = s.assignment_id
        JOIN courses c ON c.id = a.course_id
        WHERE s.id = ?
      `).bind(submissionId).first();

      if (!submission) {
        return json({
          success: false,
          error: "Soumission introuvable."
        }, 404);
      }

      if (
        user.role !== "admin" &&
        Number(submission.teacher_id) !== Number(user.user_id)
      ) {
        return json({
          success: false,
          error: "Vous n'êtes pas responsable de ce cours."
        }, 403);
      }

      if (points < 0 || points > Number(submission.max_points)) {
        return json({
          success: false,
          error: `La note doit être comprise entre 0 et ${submission.max_points}.`
        }, 400);
      }

      await db.prepare(`
        INSERT INTO grades
          (
            submission_id,
            points,
            feedback,
            graded_by
          )
        VALUES (?, ?, ?, ?)
        ON CONFLICT(submission_id)
        DO UPDATE SET
          points = excluded.points,
          feedback = excluded.feedback,
          graded_by = excluded.graded_by,
          graded_at = CURRENT_TIMESTAMP
      `).bind(
        submissionId,
        points,
        feedback,
        user.user_id
      ).run();

      await db.prepare(`
        UPDATE submissions
        SET status = 'graded'
        WHERE id = ?
      `).bind(submissionId).run();

      return json({
        success: true,
        message: "Note enregistrée.",
        points,
        max_points: submission.max_points
      });
    }

    return json({
      success: false,
      error: "Action inconnue."
    }, 404);

  } catch (error) {
    console.error("E.M.O.E. devoirs.js:", error);

    return json({
      success: false,
      error: "Erreur serveur.",
      detail: error?.message || String(error)
    }, 500);
  }
}
