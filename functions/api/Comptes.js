/*
 * E.M.O.E — Gestion des comptes
 * Étape 2/6
 *
 * Endpoint :
 *   POST /api/comptes
 *
 * Actions :
 *   register  -> créer un compte étudiant
 *   login     -> connexion étudiant/enseignant
 *   me        -> récupérer le compte connecté
 *   logout    -> fermer la session
 *
 * IMPORTANT :
 * Le binding Cloudflare D1 doit s'appeler :
 *   DB
 *
 * La base et ses tables sont créées automatiquement
 * lors de la première requête.
 */

const SESSION_DAYS = 30;
const PASSWORD_MIN_LENGTH = 8;

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

function clean(value, max = 200) {
  return String(value ?? "")
    .replace(/[\u0000-\u001F\u007F]+/g, " ")
    .trim()
    .slice(0, max);
}

function normalizeEmail(value) {
  return clean(value, 254).toLowerCase();
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function randomBytes(length = 32) {
  return crypto.getRandomValues(new Uint8Array(length));
}

function bytesToHex(bytes) {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(hex) {
  const result = new Uint8Array(hex.length / 2);

  for (let i = 0; i < result.length; i++) {
    result[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }

  return result;
}

async function hashPassword(password, saltHex) {
  const encoder = new TextEncoder();

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: hexToBytes(saltHex),
      iterations: 120000,
      hash: "SHA-256"
    },
    keyMaterial,
    256
  );

  return bytesToHex(new Uint8Array(derivedBits));
}

function getCookie(request, name) {
  const cookieHeader = request.headers.get("cookie") || "";

  const cookies = cookieHeader.split(";");

  for (const cookie of cookies) {
    const [key, ...rest] = cookie.trim().split("=");

    if (key === name) {
      return decodeURIComponent(rest.join("="));
    }
  }

  return null;
}

function sessionCookie(token, maxAge) {
  return [
    `emoe_session=${encodeURIComponent(token)}`,
    "Path=/",
    `Max-Age=${maxAge}`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax"
  ].join("; ");
}

function clearSessionCookie() {
  return [
    "emoe_session=",
    "Path=/",
    "Max-Age=0",
    "HttpOnly",
    "Secure",
    "SameSite=Lax"
  ].join("; ");
}

async function ensureDatabase(db) {
  await db.batch([
    db.prepare(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'student',
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `),

    db.prepare(`
      CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `)
  ]);
}

async function hashToken(token) {
  const data = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return bytesToHex(new Uint8Array(digest));
}

async function createSession(db, userId) {
  const rawToken = bytesToHex(randomBytes(32));
  const tokenHash = await hashToken(rawToken);

  const expires = new Date(
    Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  await db
    .prepare(`
      INSERT INTO sessions (user_id, token_hash, expires_at)
      VALUES (?, ?, ?)
    `)
    .bind(userId, tokenHash, expires)
    .run();

  return {
    token: rawToken,
    expires
  };
}

async function getCurrentUser(request, db) {
  const token = getCookie(request, "emoe_session");

  if (!token) {
    return null;
  }

  const tokenHash = await hashToken(token);

  const row = await db
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
      INNER JOIN users ON users.id = sessions.user_id
      WHERE sessions.token_hash = ?
      LIMIT 1
    `)
    .bind(tokenHash)
    .first();

  if (!row) {
    return null;
  }

  if (!row.active) {
    return null;
  }

  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await db
      .prepare("DELETE FROM sessions WHERE token_hash = ?")
      .bind(tokenHash)
      .run();

    return null;
  }

  return row;
}

async function register(request, db) {
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

  const firstName = clean(body.firstName, 80);
  const lastName = clean(body.lastName, 80);
  const email = normalizeEmail(body.email);
  const password = String(body.password ?? "");

  if (!firstName || !lastName || !email || !password) {
    return json(
      {
        ok: false,
        error: "Tous les champs sont obligatoires."
      },
      422
    );
  }

  if (!validEmail(email)) {
    return json(
      {
        ok: false,
        error: "Adresse email invalide."
      },
      422
    );
  }

  if (password.length < PASSWORD_MIN_LENGTH) {
    return json(
      {
        ok: false,
        error: `Le mot de passe doit contenir au moins ${PASSWORD_MIN_LENGTH} caractères.`
      },
      422
    );
  }

  const existing = await db
    .prepare("SELECT id FROM users WHERE email = ? LIMIT 1")
    .bind(email)
    .first();

  if (existing) {
    return json(
      {
        ok: false,
        error: "Un compte existe déjà avec cette adresse email."
      },
      409
    );
  }

  const salt = bytesToHex(randomBytes(16));
  const passwordHash = await hashPassword(password, salt);

  const result = await db
    .prepare(`
      INSERT INTO users
        (first_name, last_name, email, password_hash, password_salt, role)
      VALUES (?, ?, ?, ?, ?, 'student')
    `)
    .bind(
      firstName,
      lastName,
      email,
      passwordHash,
      salt
    )
    .run();

  const userId = result.meta.last_row_id;

  const session = await createSession(db, userId);

  return new Response(
    JSON.stringify({
      ok: true,
      message: "Compte étudiant créé.",
      user: {
        id: userId,
        firstName,
        lastName,
        email,
        role: "student"
      }
    }),
    {
      status: 201,
      headers: {
        "content-type": "application/json; charset=UTF-8",
        "cache-control": "no-store",
        "set-cookie": sessionCookie(
          session.token,
          SESSION_DAYS * 24 * 60 * 60
        ),
        "x-content-type-options": "nosniff"
      }
    }
  );
}

async function login(request, db) {
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

  const email = normalizeEmail(body.email);
  const password = String(body.password ?? "");

  if (!validEmail(email) || !password) {
    return json(
      {
        ok: false,
        error: "Email ou mot de passe incorrect."
      },
      401
    );
  }

  const user = await db
    .prepare(`
      SELECT
        id,
        first_name,
        last_name,
        email,
        password_hash,
        password_salt,
        role,
        active
      FROM users
      WHERE email = ?
      LIMIT 1
    `)
    .bind(email)
    .first();

  if (!user || !user.active) {
    return json(
      {
        ok: false,
        error: "Email ou mot de passe incorrect."
      },
      401
    );
  }

  const passwordHash = await hashPassword(
    password,
    user.password_salt
  );

  if (passwordHash !== user.password_hash) {
    return json(
      {
        ok: false,
        error: "Email ou mot de passe incorrect."
      },
      401
    );
  }

  const session = await createSession(db, user.id);

  return new Response(
    JSON.stringify({
      ok: true,
      user: {
        id: user.id,
        firstName: user.first_name,
        lastName: user.last_name,
        email: user.email,
        role: user.role
      }
    }),
    {
      status: 200,
      headers: {
        "content-type": "application/json; charset=UTF-8",
        "cache-control": "no-store",
        "set-cookie": sessionCookie(
          session.token,
          SESSION_DAYS * 24 * 60 * 60
        ),
        "x-content-type-options": "nosniff"
      }
    }
  );
}

async function me(request, db) {
  const user = await getCurrentUser(request, db);

  if (!user) {
    return json(
      {
        ok: false,
        authenticated: false
      },
      401
    );
  }

  return json({
    ok: true,
    authenticated: true,
    user: {
      id: user.id,
      firstName: user.first_name,
      lastName: user.last_name,
      email: user.email,
      role: user.role
    }
  });
}

async function logout(request, db) {
  const token = getCookie(request, "emoe_session");

  if (token) {
    const tokenHash = await hashToken(token);

    await db
      .prepare("DELETE FROM sessions WHERE token_hash = ?")
      .bind(tokenHash)
      .run();
  }

  return new Response(
    JSON.stringify({
      ok: true,
      message: "Session fermée."
    }),
    {
      status: 200,
      headers: {
        "content-type": "application/json; charset=UTF-8",
        "cache-control": "no-store",
        "set-cookie": clearSessionCookie(),
        "x-content-type-options": "nosniff"
      }
    }
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

  await ensureDatabase(env.DB);

  const url = new URL(request.url);
  const action = url.searchParams.get("action");

  if (action === "register") {
    return register(request, env.DB);
  }

  if (action === "login") {
    return login(request, env.DB);
  }

  if (action === "logout") {
    return logout(request, env.DB);
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

  await ensureDatabase(env.DB);

  const url = new URL(request.url);

  if (url.searchParams.get("action") === "me") {
    return me(request, env.DB);
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
