const RECIPIENT = "ecoleombredeleternel@gmail.com";
const ALLOWED_LEVELS = new Set(["Licence", "Master", "Doctorat"]);
const FIELD_LIMITS = {
  nom: 90,
  prenoms: 90,
  postNom: 90,
  dateNaissance: 10,
  telephone: 35,
  email: 254,
  pays: 80,
  ville: 90,
  eglise: 160,
  fonction: 160,
  niveau: 20,
  website: 100
};

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

function clean(value, maxLength) {
  return String(value ?? "")
    .replace(/[\u0000-\u001F\u007F]+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function isValidDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function applicationText(data) {
  return [
    "Nouvelle candidature E.M.O.E",
    "",
    `Niveau demandé : ${data.niveau}`,
    `Nom : ${data.nom}`,
    `Prénoms : ${data.prenoms}`,
    `Post-nom : ${data.postNom}`,
    `Date de naissance : ${data.dateNaissance}`,
    `Téléphone : ${data.telephone}`,
    `Email : ${data.email}`,
    `Pays : ${data.pays}`,
    `Ville : ${data.ville}`,
    `Église de provenance : ${data.eglise}`,
    `Fonction dans l’église : ${data.fonction}`
  ].join("\n");
}

export async function onRequestPost({ request, env }) {
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return json({ ok: false, error: "Unsupported content type" }, 415);
  }

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 6_000) return json({ ok: false, error: "Request too large" }, 413);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid request" }, 400);
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ ok: false, error: "Invalid request" }, 400);
  }

  const data = Object.fromEntries(
    Object.entries(FIELD_LIMITS).map(([field, limit]) => [field, clean(body[field], limit)])
  );

  // Champ invisible : les robots le remplissent souvent. On répond avec succès
  // sans déclencher d'email afin de ne pas leur révéler le mécanisme anti-spam.
  if (data.website) return json({ ok: true });

  const requiredFields = ["nom", "prenoms", "postNom", "dateNaissance", "telephone", "email", "pays", "ville", "eglise", "fonction", "niveau"];
  if (requiredFields.some((field) => !data[field]) || !isValidEmail(data.email) || !isValidDate(data.dateNaissance) || !ALLOWED_LEVELS.has(data.niveau)) {
    return json({ ok: false, error: "Invalid form fields" }, 422);
  }

  if (!env.RESEND_API_KEY || !env.RESEND_FROM) {
    // Ne divulgue jamais la clé. Cette erreur indique uniquement une configuration incomplète dans Cloudflare.
    return json({ ok: false, error: "Mail service is not configured" }, 503);
  }

  const resendResponse = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "authorization": `Bearer ${env.RESEND_API_KEY}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      from: env.RESEND_FROM,
      to: [RECIPIENT],
      reply_to: data.email,
      subject: `Nouvelle candidature E.M.O.E — ${data.niveau}`,
      text: applicationText(data)
    })
  });

  if (!resendResponse.ok) {
    // Ne renvoie ni le corps de Resend ni des données du candidat au navigateur.
    console.error("Resend rejected an E.M.O.E application", resendResponse.status);
    return json({ ok: false, error: "Mail delivery failed" }, 502);
  }

  return json({ ok: true }, 201);
}

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: { allow: "POST, OPTIONS" } });
}

