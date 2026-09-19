export async function onRequestGet() {
  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="description" content="Espace privé de la plateforme E.M.O.E.">
  <title>E.M.O.E. — Espace de formation</title>

  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    :root {
      --bg: #08080d;
      --panel: #11111a;
      --panel-2: #171722;
      --border: rgba(255,255,255,.09);
      --text: #f4f4f7;
      --muted: #a6a6b5;
      --violet: #8b5cf6;
      --violet-dark: #6d28d9;
      --mint: #6ee7b7;
      --danger: #fb7185;
    }

    body {
      font-family: Inter, Arial, sans-serif;
      background:
        radial-gradient(circle at top right, rgba(139,92,246,.16), transparent 32%),
        radial-gradient(circle at bottom left, rgba(110,231,183,.08), transparent 30%),
        var(--bg);
      color: var(--text);
      min-height: 100vh;
    }

    a {
      color: inherit;
      text-decoration: none;
    }

    button {
      font: inherit;
    }

    .layout {
      min-height: 100vh;
      display: grid;
      grid-template-columns: 250px 1fr;
    }

    .sidebar {
      border-right: 1px solid var(--border);
      background: rgba(8,8,13,.94);
      padding: 24px 16px;
      position: sticky;
      top: 0;
      height: 100vh;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 8px 10px 28px;
    }

    .brand img {
      width: 42px;
      height: 42px;
      object-fit: cover;
      border-radius: 12px;
    }

    .brand strong {
      font-size: 18px;
      letter-spacing: .5px;
    }

    .brand small {
      display: block;
      color: var(--muted);
      font-size: 11px;
      margin-top: 3px;
    }

    .nav {
      display: grid;
      gap: 7px;
    }

    .nav button {
      width: 100%;
      text-align: left;
      border: 1px solid transparent;
      background: transparent;
      color: var(--muted);
      padding: 12px 13px;
      border-radius: 12px;
      cursor: pointer;
      transition: .2s;
    }

    .nav button:hover,
    .nav button.active {
      color: var(--text);
      background: var(--panel);
      border-color: var(--border);
    }

    .nav button.active {
      box-shadow: inset 3px 0 0 var(--violet);
    }

    .sidebar-bottom {
      position: absolute;
      left: 16px;
      right: 16px;
      bottom: 20px;
    }

    .back {
      display: block;
      padding: 12px;
      color: var(--muted);
      font-size: 14px;
    }

    .main {
      padding: 28px;
      max-width: 1500px;
      width: 100%;
      margin: auto;
    }

    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 20px;
      margin-bottom: 30px;
    }

    .eyebrow {
      color: var(--mint);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 1.5px;
      margin-bottom: 7px;
    }

    h1 {
      font-size: clamp(28px, 4vw, 42px);
      line-height: 1.1;
    }

    .subtitle {
      color: var(--muted);
      margin-top: 9px;
    }

    .role-switch {
      display: flex;
      padding: 4px;
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 12px;
    }

    .role-switch button {
      border: 0;
      background: transparent;
      color: var(--muted);
      padding: 9px 13px;
      border-radius: 9px;
      cursor: pointer;
    }

    .role-switch button.active {
      background: var(--violet);
      color: white;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0,1fr));
      gap: 15px;
      margin-bottom: 22px;
    }

    .card {
      background: rgba(17,17,26,.86);
      border: 1px solid var(--border);
      border-radius: 17px;
      padding: 20px;
    }

    .stat-label {
      color: var(--muted);
      font-size: 13px;
      margin-bottom: 12px;
    }

    .stat-value {
      font-size: 29px;
      font-weight: 700;
    }

    .stat-note {
      color: var(--mint);
      font-size: 12px;
      margin-top: 8px;
    }

    .section {
      display: grid;
      grid-template-columns: 1.4fr 1fr;
      gap: 18px;
    }

    .section-title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 15px;
      margin-bottom: 17px;
    }

    .section-title h2 {
      font-size: 18px;
    }

    .section-title span {
      color: var(--muted);
      font-size: 12px;
    }

    .course {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 15px;
      padding: 15px 0;
      border-top: 1px solid var(--border);
    }

    .course:first-of-type {
      border-top: 0;
      padding-top: 0;
    }

    .course-info strong {
      display: block;
      margin-bottom: 5px;
    }

    .course-info span {
      color: var(--muted);
      font-size: 13px;
    }

    .pill {
      white-space: nowrap;
      padding: 7px 10px;
      border-radius: 999px;
      background: rgba(110,231,183,.09);
      color: var(--mint);
      font-size: 12px;
      border: 1px solid rgba(110,231,183,.15);
    }

    .session {
      border: 1px solid var(--border);
      background: var(--panel-2);
      padding: 16px;
      border-radius: 13px;
      margin-bottom: 11px;
    }

    .session strong {
      display: block;
      margin-bottom: 7px;
    }

    .session p {
      color: var(--muted);
      font-size: 13px;
      line-height: 1.6;
    }

    .empty {
      padding: 35px 15px;
      text-align: center;
      color: var(--muted);
      border: 1px dashed var(--border);
      border-radius: 13px;
    }

    .hidden {
      display: none !important;
    }

    .notice {
      margin-top: 18px;
      padding: 14px 16px;
      border-radius: 13px;
      background: rgba(139,92,246,.08);
      border: 1px solid rgba(139,92,246,.16);
      color: #c4b5fd;
      font-size: 13px;
      line-height: 1.5;
    }

    @media (max-width: 1000px) {
      .grid {
        grid-template-columns: repeat(2, 1fr);
      }

      .section {
        grid-template-columns: 1fr;
      }
    }

    @media (max-width: 700px) {
      .layout {
        display: block;
      }

      .sidebar {
        position: static;
        height: auto;
        border-right: 0;
        border-bottom: 1px solid var(--border);
        padding: 12px;
      }

      .brand {
        padding-bottom: 14px;
      }

      .nav {
        display: flex;
        overflow-x: auto;
      }

      .nav button {
        white-space: nowrap;
        width: auto;
      }

      .sidebar-bottom {
        display: none;
      }

      .main {
        padding: 20px 14px;
      }

      .topbar {
        align-items: flex-start;
        flex-direction: column;
      }

      .grid {
        grid-template-columns: 1fr 1fr;
      }
    }

    @media (max-width: 430px) {
      .grid {
        grid-template-columns: 1fr;
      }

      .role-switch {
        width: 100%;
      }

      .role-switch button {
        flex: 1;
      }
    }
  </style>
</head>

<body>

  <div class="layout">

    <aside class="sidebar">

      <div class="brand">
        <img src="/logo-emoe.jpg" alt="Logo E.M.O.E.">
        <div>
          <strong>E.M.O.E.</strong>
          <small>Plateforme de formation</small>
        </div>
      </div>

      <nav class="nav" aria-label="Navigation">

        <button class="active" data-section="dashboard">
          🏠 Tableau de bord
        </button>

        <button data-section="courses">
          📚 Mes cours
        </button>

        <button data-section="sessions">
          🎥 Sessions Zoom
        </button>

        <button data-section="attendance">
          🟢 Présence
        </button>

        <button data-section="assignments">
          📝 Devoirs / TP
        </button>

        <button data-section="grades">
          📊 Notes
        </button>

      </nav>

      <div class="sidebar-bottom">
        <a class="back" href="/">
          ← Retour au site E.M.O.E.
        </a>
      </div>

    </aside>

    <main class="main">

      <header class="topbar">

        <div>
          <div class="eyebrow">Plateforme E.M.O.E.</div>
          <h1 id="page-title">Tableau de bord</h1>
          <p class="subtitle" id="page-subtitle">
            Bienvenue dans votre espace de formation.
          </p>
        </div>

        <div class="role-switch">
          <button id="student-role" class="active" type="button">
            👨‍🎓 Étudiant
          </button>

          <button id="teacher-role" type="button">
            👨‍🏫 Enseignant
          </button>
        </div>

      </header>

      <section id="dashboard">

        <div class="grid">

          <div class="card">
            <div class="stat-label">Cours</div>
            <div class="stat-value" id="courses-count">0</div>
            <div class="stat-note">Cours inscrits</div>
          </div>

          <div class="card">
            <div class="stat-label">Présence</div>
            <div class="stat-value">—</div>
            <div class="stat-note">Sera calculée automatiquement</div>
          </div>

          <div class="card">
            <div class="stat-label">Devoirs</div>
            <div class="stat-value">0</div>
            <div class="stat-note">En attente</div>
          </div>

          <div class="card">
            <div class="stat-label">Notes</div>
            <div class="stat-value">—</div>
            <div class="stat-note">Aucune donnée</div>
          </div>

        </div>

        <div class="section">

          <div class="card">

            <div class="section-title">
              <h2>Mes cours</h2>
              <span id="course-role-label">Étudiant</span>
            </div>

            <div id="courses-list">

              <div class="empty">
                Aucun cours n'est encore associé à ce compte.
                <br><br>
                Les cours apparaîtront automatiquement ici.
              </div>

            </div>

          </div>

          <div class="card">

            <div class="section-title">
              <h2>Prochaine session</h2>
              <span>Zoom</span>
            </div>

            <div class="empty">
              Aucune session programmée.
              <br><br>
              Les prochaines sessions apparaîtront ici.
            </div>

          </div>

        </div>

        <div class="notice">
          🔐 Cette interface constitue le point d'entrée de la plateforme
          E.M.O.E. Les comptes, les cours, les sessions Zoom, la présence
          automatique et les rapports seront connectés progressivement dans
          les prochaines étapes.
        </div>

      </section>

      <section id="courses" class="hidden">
        <div class="card">
          <div class="section-title">
            <h2>Mes cours</h2>
            <span>E.M.O.E.</span>
          </div>

          <div class="empty">
            Les cours seront disponibles après la configuration des comptes
            et des inscriptions.
          </div>
        </div>
      </section>

      <section id="sessions" class="hidden">
        <div class="card">
          <div class="section-title">
            <h2>Sessions Zoom</h2>
            <span>Classe virtuelle</span>
          </div>

          <div class="empty">
            Les sessions Zoom seront affichées ici automatiquement.
          </div>
        </div>
      </section>

      <section id="attendance" class="hidden">
        <div class="card">
          <div class="section-title">
            <h2>Présence</h2>
            <span>Suivi automatique</span>
          </div>

          <div class="empty">
            Le système de présence automatique sera connecté à cette section
            lors de l'étape 4.
          </div>
        </div>
      </section>

      <section id="assignments" class="hidden">
        <div class="card">
          <div class="section-title">
            <h2>Devoirs et TP</h2>
            <span>Travail académique</span>
          </div>

          <div class="empty">
            Les devoirs et travaux pratiques seront connectés lors de l'étape 6.
          </div>
        </div>
      </section>

      <section id="grades" class="hidden">
        <div class="card">
          <div class="section-title">
            <h2>Notes</h2>
            <span>Résultats académiques</span>
          </div>

          <div class="empty">
            Les résultats académiques seront connectés lors de l'étape 6.
          </div>
        </div>
      </section>

    </main>

  </div>

  <script>
    const sections = [
      "dashboard",
      "courses",
      "sessions",
      "attendance",
      "assignments",
      "grades"
    ];

    const titles = {
      dashboard: [
        "Tableau de bord",
        "Bienvenue dans votre espace de formation."
      ],
      courses: [
        "Mes cours",
        "Retrouvez ici vos cours et votre progression."
      ],
      sessions: [
        "Sessions Zoom",
        "Retrouvez ici vos prochaines classes virtuelles."
      ],
      attendance: [
        "Présence",
        "Votre assiduité sera calculée automatiquement."
      ],
      assignments: [
        "Devoirs / TP",
        "Travaux et évaluations à réaliser."
      ],
      grades: [
        "Notes",
        "Consultez vos résultats académiques."
      ]
    };

    const buttons = document.querySelectorAll(".nav button");

    function showSection(name) {
      sections.forEach(section => {
        const element = document.getElementById(section);
        if (element) {
          element.classList.toggle("hidden", section !== name);
        }
      });

      buttons.forEach(button => {
        button.classList.toggle(
          "active",
          button.dataset.section === name
        );
      });

      document.getElementById("page-title").textContent =
        titles[name][0];

      document.getElementById("page-subtitle").textContent =
        titles[name][1];
    }

    buttons.forEach(button => {
      button.addEventListener("click", () => {
        showSection(button.dataset.section);
      });
    });

    const studentRole = document.getElementById("student-role");
    const teacherRole = document.getElementById("teacher-role");
    const courseRoleLabel = document.getElementById("course-role-label");

    studentRole.addEventListener("click", () => {
      studentRole.classList.add("active");
      teacherRole.classList.remove("active");
      courseRoleLabel.textContent = "Étudiant";
    });

    teacherRole.addEventListener("click", () => {
      teacherRole.classList.add("active");
      studentRole.classList.remove("active");
      courseRoleLabel.textContent = "Enseignant";
    });
  </script>

</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=UTF-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    }
  });
}
