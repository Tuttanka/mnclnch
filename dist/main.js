// ─────────────────────────────────────────────────────────────────────────────
// Barra de título personalizada
// ─────────────────────────────────────────────────────────────────────────────
const { getCurrentWindow } = window.__TAURI__.window;
const appWindow = getCurrentWindow();

document.getElementById("titlebar-minimize").addEventListener("click", () => appWindow.minimize());
document.getElementById("titlebar-maximize").addEventListener("click", () => appWindow.toggleMaximize());
document.getElementById("titlebar-close").addEventListener("click", () => appWindow.close());

// ─────────────────────────────────────────────────────────────────────────────
// Auto-actualización del launcher
// ─────────────────────────────────────────────────────────────────────────────
async function checkForUpdates() {
  try {
    const { check } = window.__TAURI__.updater;
    const { relaunch } = window.__TAURI__.process;
    const update = await check();
    if (update) {
      const overlay = document.createElement("div");
      overlay.style.cssText = `
        position:fixed; inset:0; z-index:9999;
        background:rgba(0,0,0,0.85); color:#fff;
        display:flex; flex-direction:column; align-items:center; justify-content:center;
        font-family:-apple-system,'Segoe UI',sans-serif; gap:14px;
      `;
      overlay.innerHTML = `
        <div style="font-size:16px;font-weight:700;">Actualizando el launcher...</div>
        <div style="font-size:12px;color:#aaa;" id="update-progress">Descargando v${update.version}</div>
        <div style="width:260px;height:6px;background:#333;border-radius:4px;overflow:hidden;">
          <div id="update-bar" style="height:100%;width:0%;background:#5865F2;transition:width .2s;"></div>
        </div>
      `;
      document.body.appendChild(overlay);
      let downloaded = 0;
      let total = 0;
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength || 0;
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          if (total > 0) {
            const pct = Math.min(100, Math.round((downloaded / total) * 100));
            document.getElementById("update-bar").style.width = pct + "%";
            document.getElementById("update-progress").textContent = `Descargando... ${pct}%`;
          }
        } else if (event.event === "Finished") {
          document.getElementById("update-progress").textContent = "Instalando...";
        }
      });
      await relaunch();
    }
  } catch (e) {
    console.warn("No se pudo revisar actualizaciones:", e);
  }
}

checkForUpdates();

// ─────────────────────────────────────────────────────────────────────────────
// Auto-login con sesión guardada
// ─────────────────────────────────────────────────────────────────────────────
async function tryAutoLogin() {
  await configReady;
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return;

  let saved;
  try { saved = JSON.parse(raw); } catch (_) { localStorage.removeItem(SESSION_KEY); return; }
  if (!saved.token || !saved.username) { localStorage.removeItem(SESSION_KEY); return; }

  try {
    const res = await fetch(`${BACKEND_URL}/instances`, {
      headers: { "Authorization": `Bearer ${saved.token}` }
    });
    if (res.ok) {
      onLoginSuccess(saved.token, saved.username, saved.accountType, saved.mcAccessToken || "", saved.mcUuid || "");
    } else {
      localStorage.removeItem(SESSION_KEY);
    }
  } catch (_) {
    // Sin conexion: no se puede validar, se deja la pantalla de login normal.
  }
}

tryAutoLogin();

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────
let BACKEND_URL = "http://localhost:8080";
const configReady = fetch("config.json")
  .then(r => r.json())
  .then(cfg => { if (cfg.backend_url) BACKEND_URL = cfg.backend_url; })
  .catch(() => { });

// ─────────────────────────────────────────────────────────────────────────────
// Tauri APIs
// ─────────────────────────────────────────────────────────────────────────────
const { invoke } = window.__TAURI__.core;
const { open: openUrl } = window.__TAURI__.shell;

function getSkinUrl(username) {
  return `https://render.crafty.gg/2d/face/${username}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Staff y Creaciones (editar acá para agregar/quitar gente o proyectos)
// ─────────────────────────────────────────────────────────────────────────────

// Orden de categorias en la pantalla de Staff
const STAFF_CATEGORIES = ["Owner", "Constructor", "Modelador", "Config"];

const STAFF_MEMBERS = [
  { name: "PilarG9", role: "Owner" },
  { name: "ZailenZ", role: "Config" },
  { name: "KeyXw", role: "Config" },
  // Agregá mas gente acá, con el mismo formato:
  // { name: "NombreDeMinecraft", role: "Owner" | "Constructor" | "Modelador" | "Config" },
];

const CREACIONES = [
  // Agregá o editá proyectos acá. "img" es opcional (ruta dentro de dist/img/).
  // { name: "Nombre del proyecto", date: "Fecha", img: "img/creaciones/archivo.png" },
];

function renderStaff() {
  const container = document.getElementById("staff-groups");
  container.innerHTML = "";

  for (const category of STAFF_CATEGORIES) {
    const members = STAFF_MEMBERS.filter(m => m.role === category);
    if (!members.length) continue;

    const group = document.createElement("div");
    group.className = "staff-category";
    group.innerHTML = `<div class="staff-category-title">${category}</div>`;

    const cards = document.createElement("div");
    cards.className = "staff-cards";
    for (const m of members) {
      const card = document.createElement("div");
      card.className = "staff-card";
      card.innerHTML = `
        <img src="https://mc-heads.net/avatar/${m.name}/100" alt="${m.name}" />
        <div class="staff-name">${m.name}</div>
        <div class="staff-role">${m.role}</div>
      `;
      cards.appendChild(card);
    }
    group.appendChild(cards);
    container.appendChild(group);
  }

  if (!STAFF_MEMBERS.length) {
    container.innerHTML = `<p style="color:rgba(255,255,255,0.5);font-size:13px;">Todavia no hay miembros cargados.</p>`;
  }
}

function renderCreaciones() {
  const container = document.getElementById("creaciones-timeline");
  container.innerHTML = "";

  if (!CREACIONES.length) {
    container.innerHTML = `<p style="color:rgba(255,255,255,0.5);font-size:13px;">Todavia no hay creaciones cargadas.</p>`;
    return;
  }

  const track = document.createElement("div");
  track.className = "creacion-track";
  CREACIONES.forEach((c, i) => {
    const item = document.createElement("div");
    item.className = `creacion-item ${i % 2 === 0 ? "top" : "bottom"}`;
    item.innerHTML = `
      ${c.img ? `<img src="${c.img}" alt="${c.name}" />` : ""}
      <div class="creacion-name">${c.name}</div>
      <div class="creacion-date">${c.date || ""}</div>
      <div class="dot"></div>
    `;
    track.appendChild(item);
  });
  container.appendChild(track);
}

// ─────────────────────────────────────────────────────────────────────────────
// Navegacion del sidebar (Inicio / Staff / Creaciones)
// ─────────────────────────────────────────────────────────────────────────────
document.querySelectorAll(".nav-btn[data-panel]").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-btn[data-panel]").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");

    document.querySelectorAll(".content-panel").forEach(p => p.classList.remove("active"));
    document.getElementById(`panel-${btn.dataset.panel}`).classList.add("active");
  });
});

document.getElementById("instance-detail-back").addEventListener("click", () => {
  document.querySelectorAll(".content-panel").forEach(p => p.classList.remove("active"));
  document.getElementById("panel-home").classList.add("active");
  document.querySelectorAll(".nav-btn[data-panel]").forEach(b => b.classList.remove("active"));
  document.querySelector('.nav-btn[data-panel="home"]').classList.add("active");
});

const HOME_FACTS = [
  "¿Sabías que? Chevere Studeos empezó como un proyecto entre amigos.",
  "¿Sabías que? El cuy fue elegido por votación del equipo.",
  // Sumá más frases acá, una por línea, con el mismo formato.
];

function renderHomeFact() {
  const el = document.getElementById("home-fact");
  if (!el || !HOME_FACTS.length) return;
  el.textContent = HOME_FACTS[Math.floor(Math.random() * HOME_FACTS.length)];
}

renderStaff();
renderCreaciones();
renderHomeFact();

// ─────────────────────────────────────────────────────────────────────────────
// Referencias DOM
// ─────────────────────────────────────────────────────────────────────────────
const btnNoPremium = document.getElementById("btn-nopremium");
const loginStatus = document.getElementById("login-status");
const codeInput = document.getElementById("code-input");
const btnVerifyCode = document.getElementById("btn-verify-code");
const codeStatus = document.getElementById("code-status");
const codeDiscordUsername = document.getElementById("code-discord-username");
const btnBackToLogin = document.getElementById("btn-back-to-login");
const inlineCodeWrap = document.getElementById("inline-code-wrap");
const inlineCodeHint = document.getElementById("inline-code-hint");
const unauthUsername = document.getElementById("unauth-username");
const btnBackLogin = document.getElementById("btn-back-login");
const btnChooseNoPremium = document.getElementById("btn-choose-nopremium");
const btnChoosePremium = document.getElementById("btn-choose-premium");
const accountTypeStatus = document.getElementById("account-type-status");
const nicknameInput = document.getElementById("nickname-input");
const btnSaveNickname = document.getElementById("btn-save-nickname");
const nicknameStatus = document.getElementById("nickname-status");
const playerSkinImg = document.getElementById("player-skin-img");
const playerNick = document.getElementById("player-nick");
const instancesDropdownBtn = document.getElementById("instances-dropdown-btn");
const instancesPanel = document.getElementById("instances-panel");
const btnConfig = document.getElementById("btn-config");
const btnExit = document.getElementById("btn-exit");
const ramSlider = document.getElementById("ram-slider");
const ramValue = document.getElementById("ram-value");
const detailOverlay = document.getElementById("detail-overlay");
const detailClose = document.getElementById("detail-close");
const detailLogo = document.getElementById("detail-logo");
const detailName = document.getElementById("detail-name");
const detailActions = document.getElementById("detail-actions");
const detailUpdateBadge = document.getElementById("detail-update-badge");
const detailProgressArea = document.getElementById("detail-progress-area");
const detailProgressStatus = document.getElementById("detail-progress-status");
const detailProgressFill = document.getElementById("detail-progress-fill");
const detailProgressPct = document.getElementById("detail-progress-percent");

// ─────────────────────────────────────────────────────────────────────────────
// Estado
// ─────────────────────────────────────────────────────────────────────────────
let currentSessionId = null;
let pollTimer = null;
let msPollTimer = null;
let instancesPollTimer = null;
let dropdownOpen = false;
let detailUnlisten = null;
let launcherToken = null;
let launcherUsername = null;
let launcherAccType = null;
let launcherMcAccessToken = null;
let launcherMcUuid = null;
let currentDiscordId = null;
const SESSION_KEY = "launcher_session";

// ─────────────────────────────────────────────────────────────────────────────
// Pantallas
// ─────────────────────────────────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById(id).classList.add("active");
}
function setStatus(msg, isError = false) {
  loginStatus.textContent = msg;
  loginStatus.classList.toggle("error", isError);
}
function setCodeStatus(msg, isError = false) {
  codeStatus.textContent = msg;
  codeStatus.classList.toggle("error", isError);
}
function setNicknameStatus(msg, isError = false) {
  nicknameStatus.textContent = msg;
  nicknameStatus.classList.toggle("error", isError);
}
function setButtonsDisabled(d) { btnNoPremium.disabled = d; }

function showInlineCode(discordUsername) {
  codeDiscordUsername.textContent = discordUsername || "";
  inlineCodeWrap.style.display = "flex";
  inlineCodeHint.style.display = "block";
  btnBackToLogin.style.display = "inline-block";
  codeInput.value = "";
  setCodeStatus("");
  codeInput.focus();
}

function hideInlineCode() {
  inlineCodeWrap.style.display = "none";
  inlineCodeHint.style.display = "none";
  btnBackToLogin.style.display = "none";
  codeInput.value = "";
  setCodeStatus("");
}

// ─────────────────────────────────────────────────────────────────────────────
// Timeout login (10 segundos)
// ─────────────────────────────────────────────────────────────────────────────
let loginTimeoutTimer = null;

function startLoginTimeout() {
  if (loginTimeoutTimer) clearTimeout(loginTimeoutTimer);
  loginTimeoutTimer = setTimeout(() => {
    stopPolling();
    setStatus("Tiempo agotado. Intenta de nuevo.", true);
    setButtonsDisabled(false);
    showScreen("login-screen");
  }, 90 * 1000);
}

function clearLoginTimeout() {
  if (loginTimeoutTimer) clearTimeout(loginTimeoutTimer);
  loginTimeoutTimer = null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Polling sesión Discord
// ─────────────────────────────────────────────────────────────────────────────
function stopPolling() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; }
function stopMsPolling() { if (msPollTimer) clearInterval(msPollTimer); msPollTimer = null; }

function startPolling(sessionId) {
  stopPolling();
  pollTimer = setInterval(async () => {
    try {
      const data = await fetch(`${BACKEND_URL}/auth/session/${sessionId}`).then(r => r.json());

      if (data.status === "pending") return;

      if (data.status === "awaiting_discord_code") {
        stopPolling();
        clearLoginTimeout();
        showInlineCode(data.discord_username);
        return;
      }

      if (data.status === "not_whitelisted") {
        stopPolling();
        clearLoginTimeout();
        unauthUsername.textContent = `"${data.discord_username}"`;
        showScreen("unauthorized-screen");
        return;
      }

      if (data.status === "done") {
        stopPolling();
        clearLoginTimeout();
        launcherToken = data.token;
        currentDiscordId = data.discord_id || null;
        accountTypeStatus.textContent = "";
        showScreen("account-type-screen");
        return;
      }

      if (data.status === "error") {
        stopPolling();
        clearLoginTimeout();
        setStatus(data.message || "Error iniciando sesion.", true);
        setButtonsDisabled(false);
        showScreen("login-screen");
      }
    } catch (_) { }
  }, 2000);
}

// ─────────────────────────────────────────────────────────────────────────────
// Polling instancias (cada 2 minutos)
// ─────────────────────────────────────────────────────────────────────────────
function startInstancesPolling() {
  if (instancesPollTimer) clearInterval(instancesPollTimer);
  instancesPollTimer = setInterval(async () => {
    await configReady;
    try {
      const res = await fetch(`${BACKEND_URL}/instances`, {
        headers: { "Authorization": `Bearer ${launcherToken}` }
      });

      if (res.status === 401) {
        clearInterval(instancesPollTimer);
        launcherToken = null;
        launcherUsername = null;
        localStorage.removeItem(SESSION_KEY);
        hideInlineCode();
        setStatus("Tu acceso fue revocado.", true);
        setButtonsDisabled(false);
        showScreen("login-screen");
        return;
      }

      if (!res.ok) return;

      const instances = await res.json();
      if (dropdownOpen) {
        instancesPanel.innerHTML = "";
        for (const inst of instances) {
          const localVersion = await invoke("get_installed_version", { uniqueCode: inst.unique_code }).catch(() => null);
          const isInstalled = localVersion !== null;
          instancesPanel.appendChild(buildInstanceCard(inst, isInstalled, false));
        }
      }
    } catch (_) { }
  }, 2 * 60 * 1000);
}

// ─────────────────────────────────────────────────────────────────────────────
// Login Discord — código de 6 dígitos
// ─────────────────────────────────────────────────────────────────────────────
btnVerifyCode.addEventListener("click", async () => {
  await configReady;
  const code = codeInput.value.trim();
  if (!code || code.length < 6) { setCodeStatus("Ingresa el codigo de 6 digitos.", true); return; }

  btnVerifyCode.disabled = true;
  setCodeStatus("Verificando...");

  try {
    const res = await fetch(`${BACKEND_URL}/auth/discord/verify-code`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: currentSessionId, code }),
    });

    if (res.ok) {
      const data = await fetch(`${BACKEND_URL}/auth/session/${currentSessionId}`).then(r => r.json());
      if (data.status === "done") {
        launcherToken = data.token;
        currentDiscordId = data.discord_id || null;
        accountTypeStatus.textContent = "";
        hideInlineCode();
        showScreen("account-type-screen");
      }
    } else if (res.status === 401) {
      setCodeStatus("Codigo incorrecto. Intenta de nuevo.", true);
      codeInput.value = ""; codeInput.focus(); btnVerifyCode.disabled = false;
    } else if (res.status === 410) {
      setCodeStatus("El codigo expiro. Vuelve a iniciar sesion.", true); btnVerifyCode.disabled = false;
    } else if (res.status === 429) {
      setCodeStatus("Demasiados intentos. Vuelve a iniciar sesion.", true); btnVerifyCode.disabled = false;
    } else {
      setCodeStatus("Error verificando. Intenta de nuevo.", true); btnVerifyCode.disabled = false;
    }
  } catch (_) {
    setCodeStatus("No se pudo conectar al backend.", true); btnVerifyCode.disabled = false;
  }
});

codeInput.addEventListener("keydown", e => { if (e.key === "Enter") btnVerifyCode.click(); });
btnBackToLogin.addEventListener("click", () => {
  stopPolling();
  clearLoginTimeout();
  setStatus("");
  setButtonsDisabled(false);
  btnVerifyCode.disabled = false;
  hideInlineCode();
  showScreen("login-screen");
});
btnBackLogin.addEventListener("click", () => {
  setStatus("");
  setButtonsDisabled(false);
  btnVerifyCode.disabled = false;
  hideInlineCode();
  btnChooseNoPremium.disabled = false;
  btnChoosePremium.disabled = false;
  showScreen("login-screen");
});

// ─────────────────────────────────────────────────────────────────────────────
// Login Discord — botón inicial
// ─────────────────────────────────────────────────────────────────────────────
btnNoPremium.addEventListener("click", async () => {
  await configReady;
  setButtonsDisabled(true);
  setStatus("Abriendo Discord para iniciar sesion...");
  currentSessionId = crypto.randomUUID();
  try {
    const data = await fetch(`${BACKEND_URL}/auth/discord?session_id=${currentSessionId}`).then(r => r.json());
    await openUrl(data.url);
    setStatus("Completa el inicio de sesion en el navegador...");
    startPolling(currentSessionId);
    startLoginTimeout();
  } catch (_) {
    setStatus("No se pudo conectar al backend.", true);
    setButtonsDisabled(false);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Pantalla elección tipo de cuenta
// ─────────────────────────────────────────────────────────────────────────────
btnChooseNoPremium.addEventListener("click", async () => {
  await configReady;
  btnChooseNoPremium.disabled = true;
  btnChoosePremium.disabled = true;
  accountTypeStatus.textContent = "Verificando...";

  try {
    const res = await fetch(`${BACKEND_URL}/user_mc`, {
      headers: { "Authorization": `Bearer ${launcherToken}` }
    });
    const data = await res.json();

    if (data.minecraft_username) {
      onLoginSuccess(launcherToken, data.minecraft_username, "no_premium");
    } else {
      accountTypeStatus.textContent = "";
      btnChooseNoPremium.disabled = false;
      btnChoosePremium.disabled = false;
      showScreen("nickname-screen");
    }
  } catch (_) {
    accountTypeStatus.textContent = "Error al verificar. Intenta de nuevo.";
    btnChooseNoPremium.disabled = false;
    btnChoosePremium.disabled = false;
  }
});

btnChoosePremium.addEventListener("click", async () => {
  await configReady;
  btnChooseNoPremium.disabled = true;
  btnChoosePremium.disabled = true;
  accountTypeStatus.textContent = "Conectando con Microsoft...";
  currentSessionId = crypto.randomUUID();
  try {
    // Escuchar el evento con el código de dispositivo ANTES de invocar
    const unlistenDeviceCode = await window.__TAURI__.event.listen("ms-device-code", async (e) => {
      unlistenDeviceCode();
      const { user_code, verification_uri } = e.payload;
      showMsDeviceCodeScreen(user_code, verification_uri);
    });

    await invoke("start_microsoft_login", { sessionId: currentSessionId, discordId: currentDiscordId });
    startMsPolling(currentSessionId);
  } catch (e) {
    accountTypeStatus.textContent = "No se pudo iniciar el login con Microsoft.";
    btnChooseNoPremium.disabled = false;
    btnChoosePremium.disabled = false;
  }
});

function showMsDeviceCodeScreen(userCode, verificationUri) {
  // Crear overlay con instrucciones del device code
  const existing = document.getElementById("ms-device-overlay");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.id = "ms-device-overlay";
  overlay.style.cssText = `
    position:fixed; inset:0; z-index:500;
    background:rgba(0,0,0,0.88);
    backdrop-filter:blur(8px);
    display:flex; flex-direction:column;
    align-items:center; justify-content:center; gap:20px;
    font-family:-apple-system,'Segoe UI',sans-serif;
  `;
  overlay.innerHTML = `
    <div style="font-size:13px;color:rgba(255,255,255,0.5);text-transform:uppercase;letter-spacing:2px;">Inicio de sesion con Microsoft</div>
    <div style="font-size:15px;color:rgba(255,255,255,0.85);text-align:center;line-height:1.6;max-width:340px;">
      Abre este enlace en tu navegador y escribe el codigo que aparece abajo.
    </div>
    <a href="#" id="ms-open-url" style="
      font-size:14px; font-weight:700; color:#60a5fa;
      text-decoration:none; border-bottom:1px solid rgba(96,165,250,0.4); padding-bottom:2px;
    ">${verificationUri}</a>
    <div style="
      background:rgba(255,255,255,0.07);
      border:1px solid rgba(255,255,255,0.15);
      border-radius:12px;
      padding:18px 40px;
      display:flex; flex-direction:column; align-items:center; gap:6px;
    ">
      <div style="font-size:11px;color:rgba(255,255,255,0.4);letter-spacing:1px;text-transform:uppercase;">Codigo</div>
      <div id="ms-user-code" style="
        font-size:32px; font-weight:900; letter-spacing:8px; color:#fff;
        font-family:monospace;
      ">${userCode}</div>
    </div>
    <button id="ms-copy-code" style="
      background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.15);
      color:#fff; border-radius:50px; padding:8px 24px; font-size:13px;
      cursor:pointer; transition:background 0.15s;
    ">Copiar codigo</button>
    <div style="font-size:12px;color:rgba(255,255,255,0.35);text-align:center;">
      Esperando a que termines el inicio de sesion en Microsoft
    </div>
    <button id="ms-cancel-login" style="
      background:none; border:none; color:rgba(255,255,255,0.35);
      font-size:12px; cursor:pointer; text-decoration:underline; margin-top:4px;
    ">Cancelar</button>
  `;
  document.body.appendChild(overlay);

  // Abrir URL en navegador
  document.getElementById("ms-open-url").addEventListener("click", async (e) => {
    e.preventDefault();
    await openUrl(verificationUri);
  });

  // Copiar código
  document.getElementById("ms-copy-code").addEventListener("click", async () => {
    await navigator.clipboard.writeText(userCode);
    document.getElementById("ms-copy-code").textContent = "Codigo copiado";
    setTimeout(() => {
      const btn = document.getElementById("ms-copy-code");
      if (btn) btn.textContent = "Copiar codigo";
    }, 2000);
  });

  // Cancelar
  document.getElementById("ms-cancel-login").addEventListener("click", () => {
    overlay.remove();
    stopMsPolling();
    btnChooseNoPremium.disabled = false;
    btnChoosePremium.disabled = false;
    accountTypeStatus.textContent = "";
  });
}

function closeMsDeviceOverlay() {
  const el = document.getElementById("ms-device-overlay");
  if (el) el.remove();
}

// ─────────────────────────────────────────────────────────────────────────────
// Guardar nickname (primera vez No Premium)
// ─────────────────────────────────────────────────────────────────────────────
btnSaveNickname.addEventListener("click", async () => {
  await configReady;
  const nick = nicknameInput.value.trim();

  // Validación local
  if (!nick || nick.length < 3) {
    setNicknameStatus("El nickname debe tener al menos 3 caracteres.", true);
    return;
  }
  if (nick.length > 16) {
    setNicknameStatus("El nickname no puede tener mas de 16 caracteres.", true);
    return;
  }
  if (!/^[a-zA-Z0-9_]+$/.test(nick)) {
    setNicknameStatus("Solo se permiten letras, numeros y guion bajo.", true);
    return;
  }

  btnSaveNickname.disabled = true;
  setNicknameStatus("Verificando nombre...");

  try {
    const res = await fetch(`${BACKEND_URL}/user_mc`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${launcherToken}`
      },
      body: JSON.stringify({ minecraft_username: nick })
    });

    if (res.ok) {
      setNicknameStatus("¡Listo!");
      onLoginSuccess(launcherToken, nick, "no_premium");
    } else {
      let msg = "Error al guardar. Intenta de nuevo.";
      try {
        const data = await res.json();
        if (data.error) msg = data.error;
      } catch (_) {}

      setNicknameStatus(msg, true);
      btnSaveNickname.disabled = false;
    }
  } catch (_) {
    setNicknameStatus("No se pudo conectar al backend.", true);
    btnSaveNickname.disabled = false;
  }
});

nicknameInput.addEventListener("keydown", e => { if (e.key === "Enter") btnSaveNickname.click(); });

// ─────────────────────────────────────────────────────────────────────────────
// Login Microsoft
// ─────────────────────────────────────────────────────────────────────────────
function startMsPolling(sessionId) {
  stopMsPolling();
  msPollTimer = setInterval(async () => {
    let data;
    try { data = await invoke("poll_microsoft_login", { sessionId }); } catch (_) { return; }
    if (data.status === "pending") return;
    if (data.status === "done") {
      stopMsPolling();
      closeMsDeviceOverlay();
      onLoginSuccess(
        data.token,
        data.minecraftUsername || data.minecraft_username,
        "premium",
        data.minecraftAccessToken || data.minecraft_access_token || "",
        data.minecraftUuid || data.minecraft_uuid || ""
      );
      return;
    }
    if (data.status === "error") {
      stopMsPolling();
      closeMsDeviceOverlay();
      const msg = data.message || "";
      const jsonStart = msg.indexOf("{");
      if (jsonStart !== -1) {
        try {
          const parsed = JSON.parse(msg.slice(jsonStart));
          if (parsed.not_whitelisted && parsed.minecraft_username) {
            unauthUsername.textContent = `"${parsed.minecraft_username}"`;
            btnChooseNoPremium.disabled = false;
            btnChoosePremium.disabled = false;
            showScreen("unauthorized-screen"); return;
          }
        } catch (_) { }
      }
      accountTypeStatus.textContent = msg || "Error iniciando sesion con Microsoft.";
      btnChooseNoPremium.disabled = false;
      btnChoosePremium.disabled = false;
    }
  }, 1500);
}

// ─────────────────────────────────────────────────────────────────────────────
// Login exitoso
// ─────────────────────────────────────────────────────────────────────────────
function onLoginSuccess(token, username, accountType, mcAccessToken = "", mcUuid = "") {
  launcherToken = token;
  launcherUsername = username;
  launcherAccType = accountType;
  launcherMcAccessToken = mcAccessToken;
  launcherMcUuid = mcUuid;

  localStorage.setItem(SESSION_KEY, JSON.stringify({ token, username, accountType, mcAccessToken, mcUuid }));

  showScreen("main-screen");

  playerSkinImg.src = getSkinUrl(username);
  playerSkinImg.onerror = () => {
    playerSkinImg.onerror = null;
    playerSkinImg.src = `https://mc-heads.net/avatar/${username}/130`;
  };
  playerNick.textContent = username;

  loadInstances();
  startInstancesPolling(); // inicia el polling cada 2 minutos
}

// ─────────────────────────────────────────────────────────────────────────────
// Dropdown instancias
// ─────────────────────────────────────────────────────────────────────────────
instancesDropdownBtn.addEventListener("click", () => {
  dropdownOpen = !dropdownOpen;
  instancesPanel.classList.toggle("open", dropdownOpen);
  instancesDropdownBtn.querySelector(".arrow").textContent = dropdownOpen ? "▲" : "▼";
});

// ─────────────────────────────────────────────────────────────────────────────
// Cargar instancias
// ─────────────────────────────────────────────────────────────────────────────
async function loadInstances() {
  await configReady;
  instancesPanel.innerHTML = "<p style='color:#888;font-size:11px;padding:4px'>Cargando...</p>";

  let instances = [];
  try {
    const res = await fetch(`${BACKEND_URL}/instances`, {
      headers: { "Authorization": `Bearer ${launcherToken}` }
    });

    if (res.status === 401) {
      if (instancesPollTimer) clearInterval(instancesPollTimer);
      launcherToken = null;
      launcherUsername = null;
      localStorage.removeItem(SESSION_KEY);
      hideInlineCode();
      setStatus("Tu acceso fue revocado.", true);
      setButtonsDisabled(false);
      showScreen("login-screen");
      return;
    }

    instances = await res.json();
  } catch (e) {
    instancesPanel.innerHTML = `<p style='color:#f87171;font-size:11px;padding:4px'>Error al cargar instancias</p>`;
    return;
  }

  if (!instances.length) {
    instancesPanel.innerHTML = "<p style='color:#888;font-size:11px;padding:4px'>Sin instancias disponibles.</p>";
    return;
  }

  instancesPanel.innerHTML = "";
  for (const inst of instances) {
    const localVersion = await invoke("get_installed_version", { uniqueCode: inst.unique_code }).catch(() => null);
    const isInstalled = localVersion !== null;
    instancesPanel.appendChild(buildInstanceCard(inst, isInstalled, false));
  }
}

function buildInstanceCard(inst, isInstalled, needsUpdate) {
  const card = document.createElement("div");
  card.className = "instance-card";
  card.innerHTML = `
    <img src="${inst.image_url || ""}" onerror="this.style.display='none'" />
    <div class="body">
      <div class="name">${inst.name}</div>
      <div class="meta">${inst.minecraft_version} · ${inst.loader}</div>
    </div>
  `;
  card.addEventListener("click", () => openDetail(inst, isInstalled, needsUpdate));
  return card;
}

// ─────────────────────────────────────────────────────────────────────────────
// Panel de detalle de instancia (integrado en el menú, como Staff/Creaciones)
// ─────────────────────────────────────────────────────────────────────────────
const instanceDetailBg = document.getElementById("instance-detail-bg");
const instanceDetailButtons = document.getElementById("instance-detail-buttons");
const instanceDetailProgress = document.getElementById("instance-detail-progress");
const instanceDetailProgressFill = document.getElementById("instance-detail-progress-fill");
const instanceDetailProgressPct = document.getElementById("instance-detail-progress-pct");

function openDetail(inst, isInstalled, needsUpdate) {
  instanceDetailBg.style.backgroundImage = inst.image_url ? `url('${inst.image_url}')` : "none";
  instanceDetailProgress.classList.remove("show");
  instanceDetailProgressFill.style.width = "0%";
  instanceDetailProgressPct.textContent = "0%";

  document.querySelectorAll(".nav-btn[data-panel]").forEach(b => b.classList.remove("active"));
  document.querySelectorAll(".content-panel").forEach(p => p.classList.remove("active"));
  document.getElementById("panel-instance").classList.add("active");

  renderDetailActions(inst, isInstalled, needsUpdate);
}

function renderDetailActions(inst, isInstalled, needsUpdate) {
  instanceDetailButtons.innerHTML = "";
  if (!isInstalled) {
    addBtn("btn-download", "Descargar", (b) => doDownload(inst));
  } else {
    addBtn("btn-play", "Jugar", (b) => doLaunch(inst, b));
  }
  function addBtn(cls, label, onClick) {
    const b = document.createElement("button");
    b.className = cls; b.textContent = label; b.onclick = () => onClick(b);
    instanceDetailButtons.appendChild(b);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Descarga
// ─────────────────────────────────────────────────────────────────────────────
async function doDownload(inst) {
  instanceDetailButtons.querySelectorAll("button").forEach(b => b.disabled = true);
  instanceDetailProgress.classList.add("show");
  instanceDetailProgressFill.style.width = "0%";
  instanceDetailProgressPct.textContent = "0%";

  detailUnlisten = await window.__TAURI__.event.listen("download-progress", e => {
    if (e.payload.unique_code !== inst.unique_code) return;
    const pct = Math.max(0, Math.min(100, e.payload.percent ?? 0));
    instanceDetailProgressFill.style.width = `${pct}%`;
    instanceDetailProgressPct.textContent = `${pct}%`;
  });

  try {
    await invoke("download_mrpack", {
      uniqueCode:       inst.unique_code,
      mrpackUrl:        inst.mrpack_url,
      mrpackVersion:    "",
      minecraftVersion: inst.minecraft_version,
      loader:           inst.loader,
      loaderVersion:    inst.loader_version ?? "",
    });

    instanceDetailProgressFill.style.width = "100%";
    instanceDetailProgressPct.textContent = "100%";

    setTimeout(() => {
      instanceDetailProgress.classList.remove("show");
      renderDetailActions(inst, true, false);
    }, 500);

  } catch (err) {
    instanceDetailProgress.classList.remove("show");
    alert("Error al descargar:\n" + err);
    instanceDetailButtons.querySelectorAll("button").forEach(b => b.disabled = false);
  } finally {
    if (detailUnlisten) { detailUnlisten(); detailUnlisten = null; }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Lanzar Minecraft
// ─────────────────────────────────────────────────────────────────────────────
async function doLaunch(inst, btn) {
  const ram = parseInt(ramSlider.value, 10) || 4;
  const size = await appWindow.innerSize();
  const originalLabel = btn ? btn.textContent : "";
  if (btn) { btn.disabled = true; btn.textContent = "Abriendo Minecraft..."; }

  // Barra animada 0% -> 100% aproximada a los ~24s reales que tarda en abrir
  const LAUNCH_DURATION_MS = 24000;
  instanceDetailProgress.classList.add("show");
  instanceDetailProgressFill.style.width = "0%";
  instanceDetailProgressPct.textContent = "0%";
  const startTime = Date.now();
  const progressTimer = setInterval(() => {
    const elapsed = Date.now() - startTime;
    const pct = Math.min(97, Math.round((elapsed / LAUNCH_DURATION_MS) * 100));
    instanceDetailProgressFill.style.width = `${pct}%`;
    instanceDetailProgressPct.textContent = `${pct}%`;
  }, 200);

  try {
    await invoke("launch_minecraft", {
      uniqueCode:        inst.unique_code,
      minecraftVersion:  inst.minecraft_version,
      loader:            inst.loader,
      loaderVersion:     inst.loader_version ?? "",
      minecraftUsername: launcherUsername,
      accessToken:       launcherAccType === "premium" ? (launcherMcAccessToken || "") : "",
      minecraftUuid:     launcherAccType === "premium" ? (launcherMcUuid || "") : "",
      ramGb:             ram,
      windowWidth:       size.width,
      windowHeight:      size.height,
    });
    clearInterval(progressTimer);
    instanceDetailProgressFill.style.width = "100%";
    instanceDetailProgressPct.textContent = "100%";
    await appWindow.close();
  } catch (e) {
    clearInterval(progressTimer);
    instanceDetailProgress.classList.remove("show");
    alert("No se pudo lanzar Minecraft:\n" + e);
    if (btn) { btn.disabled = false; btn.textContent = originalLabel; }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Configuración RAM
// ─────────────────────────────────────────────────────────────────────────────
const RAM_KEY = "launcher_ram_gb";
const savedRam = parseInt(localStorage.getItem(RAM_KEY), 10);
if (!isNaN(savedRam)) ramSlider.value = savedRam;
ramValue.textContent = `${ramSlider.value} GB`;

ramSlider.addEventListener("input", () => {
  ramValue.textContent = `${ramSlider.value} GB`;
  localStorage.setItem(RAM_KEY, ramSlider.value);
});

// ─────────────────────────────────────────────────────────────────────────────
// Botones inferiores
// ─────────────────────────────────────────────────────────────────────────────

const SIZE_KEY = "launcher_window_size";
const SIZES = [
  { label: "1200 x 700", w: 1200, h: 700 },
  { label: "1280 x 720", w: 1280, h: 720 },
  { label: "1280 x 800", w: 1280, h: 800 },
  { label: "1366 x 768", w: 1366, h: 768 },
  { label: "1400 x 800", w: 1400, h: 800 },
];

const savedSize = localStorage.getItem(SIZE_KEY);
let currentSizeIdx = SIZES.findIndex(s => s.label === savedSize);
if (currentSizeIdx === -1) currentSizeIdx = 0;

const sizeSelect = document.getElementById("size-select");
SIZES.forEach((s, i) => {
  const opt = document.createElement("option");
  opt.value = i;
  opt.textContent = s.label;
  if (i === currentSizeIdx) opt.selected = true;
  sizeSelect.appendChild(opt);
});

async function applySize(idx) {
  const s = SIZES[idx];
  await appWindow.setSize(new window.__TAURI__.dpi.LogicalSize(s.w, s.h));
  await appWindow.center();
  localStorage.setItem(SIZE_KEY, s.label);
}

applySize(currentSizeIdx);
sizeSelect.addEventListener("change", () => applySize(parseInt(sizeSelect.value)));

btnExit.addEventListener("click", async () => { await invoke("exit_app"); });

document.getElementById("btn-social-x").addEventListener("click", () => {
  openUrl("https://x.com/CStudeos");
});
document.getElementById("btn-social-tiktok").addEventListener("click", () => {
  openUrl("https://www.tiktok.com/@chevere_studeos");
});

// ─────────────────────────────────────────────────────────────────────────────
// Seguridad
// ─────────────────────────────────────────────────────────────────────────────
document.addEventListener("contextmenu", e => e.preventDefault());
document.addEventListener("keydown", e => {
  const blocked =
    e.key === "F12" ||
    (e.ctrlKey && e.shiftKey && ["I", "i", "J", "j", "C", "c"].includes(e.key)) ||
    (e.ctrlKey && ["U", "u"].includes(e.key)) ||
    (e.metaKey && e.altKey && ["I", "i"].includes(e.key));
  if (blocked) { e.preventDefault(); e.stopPropagation(); }
});