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
// Revisa al abrir si hay una versión nueva del PROGRAMA (no del contenido/mods).
// Si hay, la descarga e instala sola, y reinicia el launcher.
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

      // Reinicia el launcher ya actualizado
      await relaunch();
    }
  } catch (e) {
    // Si falla el chequeo (sin internet, backend caído, etc.) no bloqueamos el login
    console.warn("No se pudo revisar actualizaciones:", e);
  }
}

checkForUpdates();

// ─────────────────────────────────────────────────────────────────────────────
// Config — lee config.json para saber la URL del backend
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

// ─────────────────────────────────────────────────────────────────────────────
// Skin
// ─────────────────────────────────────────────────────────────────────────────
function getSkinUrl(username) {
  return `https://render.crafty.gg/2d/face/${username}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Referencias DOM — Login
// ─────────────────────────────────────────────────────────────────────────────
const btnPremium = document.getElementById("btn-premium");
const btnNoPremium = document.getElementById("btn-nopremium");
const loginStatus = document.getElementById("login-status");
const codeInput = document.getElementById("code-input");
const btnVerifyCode = document.getElementById("btn-verify-code");
const codeStatus = document.getElementById("code-status");
const codeDiscordUsername = document.getElementById("code-discord-username");
const btnBackToLogin = document.getElementById("btn-back-to-login");
const unauthUsername = document.getElementById("unauth-username");
const btnBackLogin = document.getElementById("btn-back-login");

// ─────────────────────────────────────────────────────────────────────────────
// Referencias DOM — Main
// ─────────────────────────────────────────────────────────────────────────────
const playerSkinImg = document.getElementById("player-skin-img");
const playerNick = document.getElementById("player-nick");
const instancesDropdownBtn = document.getElementById("instances-dropdown-btn");
const instancesPanel = document.getElementById("instances-panel");
const configPanel = document.getElementById("config-panel");
const btnConfig = document.getElementById("btn-config");
const btnExit = document.getElementById("btn-exit");
const ramSlider = document.getElementById("ram-slider");
const ramValue = document.getElementById("ram-value");

// ─────────────────────────────────────────────────────────────────────────────
// Referencias DOM — Overlay detalle instancia
// ─────────────────────────────────────────────────────────────────────────────
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
let dropdownOpen = false;
let detailUnlisten = null;
let launcherToken = null;   // JWT guardado en memoria (no localStorage)
let launcherUsername = null;
let launcherAccType = null;

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
function setButtonsDisabled(d) { btnNoPremium.disabled = d; }

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
        codeDiscordUsername.textContent = data.discord_username || "";
        setCodeStatus(""); codeInput.value = "";
        showScreen("discord-code-screen");
        codeInput.focus();
        return;
      }

      if (data.status === "not_whitelisted") {
        stopPolling();
        unauthUsername.textContent = `"${data.discord_username}"`;
        showScreen("unauthorized-screen");
        return;
      }

      if (data.status === "done") {
        stopPolling();
        onLoginSuccess(data.token, data.minecraft_username, data.account_type);
        return;
      }

      if (data.status === "error") {
        stopPolling();
        setStatus(data.message || "Error iniciando sesion.", true);
        setButtonsDisabled(false);
        showScreen("login-screen");
      }
    } catch (_) { }
  }, 2000);
}

// ─────────────────────────────────────────────────────────────────────────────
// Login Discord — código de 6 dígitos
// ─────────────────────────────────────────────────────────────────────────────
btnVerifyCode.addEventListener("click", async () => {
  await configReady;
  const code = codeInput.value.trim();
  if (!code || code.length < 6) { setCodeStatus("Ingresa el código de 6 dígitos.", true); return; }

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
      if (data.status === "done") onLoginSuccess(data.token, data.minecraft_username, data.account_type);
    } else if (res.status === 401) {
      setCodeStatus("Código incorrecto. Intenta de nuevo.", true);
      codeInput.value = ""; codeInput.focus(); btnVerifyCode.disabled = false;
    } else if (res.status === 410) {
      setCodeStatus("El código expiró. Vuelve a iniciar sesión.", true); btnVerifyCode.disabled = false;
    } else if (res.status === 429) {
      setCodeStatus("Demasiados intentos. Vuelve a iniciar sesión.", true); btnVerifyCode.disabled = false;
    } else {
      setCodeStatus("Error verificando. Intenta de nuevo.", true); btnVerifyCode.disabled = false;
    }
  } catch (_) {
    setCodeStatus("No se pudo conectar al backend.", true); btnVerifyCode.disabled = false;
  }
});

codeInput.addEventListener("keydown", e => { if (e.key === "Enter") btnVerifyCode.click(); });
btnBackToLogin.addEventListener("click", () => { stopPolling(); setStatus(""); setButtonsDisabled(false); showScreen("login-screen"); });
btnBackLogin.addEventListener("click", () => { setStatus(""); setButtonsDisabled(false); showScreen("login-screen"); });

// ─────────────────────────────────────────────────────────────────────────────
// Login Microsoft
// ─────────────────────────────────────────────────────────────────────────────
btnPremium.addEventListener("click", async () => {
  await configReady;
  setButtonsDisabled(true);
  setStatus("Abriendo ventana de Microsoft...");
  currentSessionId = crypto.randomUUID();
  try {
    await invoke("start_microsoft_login", { sessionId: currentSessionId });
    startMsPolling(currentSessionId);
  } catch (e) {
    setStatus("No se pudo iniciar el login con Microsoft: " + e, true);
    setButtonsDisabled(false);
  }
});

function startMsPolling(sessionId) {
  stopMsPolling();
  msPollTimer = setInterval(async () => {
    let data;
    try { data = await invoke("poll_microsoft_login", { sessionId }); } catch (_) { return; }
    if (data.status === "pending") return;
    if (data.status === "done") {
      stopMsPolling();
      onLoginSuccess(data.token, data.minecraftUsername || data.minecraft_username, "premium");
      return;
    }
    if (data.status === "error") {
      stopMsPolling();
      const msg = data.message || "";
      const jsonStart = msg.indexOf("{");
      if (jsonStart !== -1) {
        try {
          const parsed = JSON.parse(msg.slice(jsonStart));
          if (parsed.not_whitelisted && parsed.minecraft_username) {
            unauthUsername.textContent = `"${parsed.minecraft_username}"`;
            showScreen("unauthorized-screen"); return;
          }
        } catch (_) { }
      }
      setStatus(msg || "Error iniciando sesion con Microsoft.", true);
      setButtonsDisabled(false);
    }
  }, 1500);
}

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
  } catch (_) {
    setStatus("No se pudo conectar al backend.", true);
    setButtonsDisabled(false);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Login exitoso
// ─────────────────────────────────────────────────────────────────────────────
function onLoginSuccess(token, username, accountType) {
  // Guarda en memoria — nunca en localStorage (seguridad)
  launcherToken = token;
  launcherUsername = username;
  launcherAccType = accountType;

  showScreen("main-screen");

  playerSkinImg.src = getSkinUrl(username);
  playerSkinImg.onerror = () => {
    playerSkinImg.onerror = null;
    playerSkinImg.src = `https://mc-heads.net/avatar/${username}/130`;
  };
  playerNick.textContent = username;

  loadInstances();
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
// El JS llama directo al backend con fetch (no invoke).
// Para cada instancia pide al Rust local la versión instalada y compara.
// ─────────────────────────────────────────────────────────────────────────────
async function loadInstances() {
  await configReady;
  instancesPanel.innerHTML = "<p style='color:#888;font-size:11px;padding:4px'>Cargando...</p>";

  let instances = [];
  try {
    instances = await fetch(`${BACKEND_URL}/instances`, {
      headers: { "Authorization": `Bearer ${launcherToken}` }
    }).then(r => r.json());
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
    // null = no instalada | string = versión instalada localmente
    const localVersion = await invoke("get_installed_version", { uniqueCode: inst.unique_code }).catch(() => null);
    const isInstalled = localVersion !== null;
    const needsUpdate = isInstalled && localVersion !== inst.mrpack_version;
    instancesPanel.appendChild(buildInstanceCard(inst, isInstalled, needsUpdate));
  }
}

// Tarjeta compacta en el dropdown — click abre el overlay de detalle
function buildInstanceCard(inst, isInstalled, needsUpdate) {
  const card = document.createElement("div");
  card.className = "instance-card";
  card.innerHTML = `
    <img src="${inst.image_url || ""}" onerror="this.style.display='none'" />
    <div class="body">
      <div class="name">${inst.name}</div>
      <div class="meta">${inst.minecraft_version} · ${inst.loader}${needsUpdate ? " · <span style='color:#fbbf24'>↑ update</span>" : ""}</div>
    </div>
  `;
  card.addEventListener("click", () => openDetail(inst, isInstalled, needsUpdate));
  return card;
}

// ─────────────────────────────────────────────────────────────────────────────
// Overlay detalle de instancia
// ─────────────────────────────────────────────────────────────────────────────
function openDetail(inst, isInstalled, needsUpdate) {
  detailLogo.src = inst.image_url || "";
  detailLogo.onerror = () => { detailLogo.style.display = "none"; };
  detailLogo.onload = () => { detailLogo.style.display = "block"; };
  detailName.textContent = inst.name;
  detailUpdateBadge.classList.toggle("show", needsUpdate);
  detailProgressArea.classList.remove("show");
  detailProgressFill.style.width = "0%";
  detailProgressPct.textContent = "0%";
  renderDetailActions(inst, isInstalled, needsUpdate);
  detailOverlay.classList.add("open");
}

function closeDetail() {
  detailOverlay.classList.remove("open");
  if (detailUnlisten) { detailUnlisten(); detailUnlisten = null; }
}

detailClose.addEventListener("click", closeDetail);
detailOverlay.addEventListener("click", e => { if (e.target === detailOverlay) closeDetail(); });

function renderDetailActions(inst, isInstalled, needsUpdate) {
  detailActions.innerHTML = "";

  if (!isInstalled) {
    // Sin instalar — solo Descargar
    addBtn("btn-download", "Descargar", () => doDownload(inst));

  } else if (needsUpdate) {
    // Instalada pero hay versión nueva
    addBtn("btn-download", "Actualizar", () => doDownload(inst));
    addBtn("btn-play", "Jugar (versión anterior)", () => doLaunch(inst));

  } else {
    // Instalada y al día
    addBtn("btn-repair", "Reparar", () => doDownload(inst));
    addBtn("btn-play", "▶ Jugar", () => doLaunch(inst));
  }

  function addBtn(cls, label, onClick) {
    const b = document.createElement("button");
    b.className = cls; b.textContent = label; b.onclick = onClick;
    detailActions.appendChild(b);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Descarga / actualización
// Llama al comando Rust download_mrpack que:
//   1. Borra la carpeta vieja de la instancia
//   2. Descarga el .mrpack desde Dropbox (streaming con progreso)
//   3. Extrae overrides/ → carpeta de la instancia
//   4. Escribe version.txt con mrpack_version
// ─────────────────────────────────────────────────────────────────────────────
async function doDownload(inst) {
  // Desactivar botones durante la descarga
  detailActions.querySelectorAll("button").forEach(b => b.disabled = true);
  detailProgressArea.classList.add("show");
  detailProgressStatus.textContent = "Conectando...";
  detailProgressFill.style.width = "0%";
  detailProgressPct.textContent = "0%";

  // Escuchar progreso desde Rust
  detailUnlisten = await window.__TAURI__.event.listen("download-progress", e => {
    if (e.payload.unique_code !== inst.unique_code) return;
    const pct = Math.max(0, Math.min(100, e.payload.percent ?? 0));
    detailProgressFill.style.width = `${pct}%`;
    detailProgressPct.textContent = `${pct}%`;
    detailProgressStatus.textContent =
      e.payload.status === "descargando" ? "Descargando..." :
        e.payload.status === "descomprimiendo" ? "Descomprimiendo..." : "Listo";
  });

  try {
    await invoke("download_mrpack", {
      uniqueCode:      inst.unique_code,
      mrpackUrl:       inst.mrpack_url,
      mrpackVersion:   inst.mrpack_version,
      minecraftVersion: inst.minecraft_version,
      loader:          inst.loader,
      loaderVersion:   inst.loader_version ?? "",
    });

    // Éxito — actualizar UI
    detailProgressStatus.textContent = "✓ Instalada";
    detailProgressFill.style.width = "100%";
    detailProgressPct.textContent = "100%";
    detailUpdateBadge.classList.remove("show");

    setTimeout(() => {
      detailProgressArea.classList.remove("show");
      renderDetailActions(inst, true, false); // ya instalada, sin update
    }, 800);

  } catch (err) {
    detailProgressStatus.textContent = `Error: ${err}`;
    detailProgressFill.style.width = "0%";
    // Rehabilitar botones para que pueda reintentar
    detailActions.querySelectorAll("button").forEach(b => b.disabled = false);
  } finally {
    if (detailUnlisten) { detailUnlisten(); detailUnlisten = null; }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Lanzar Minecraft
// ─────────────────────────────────────────────────────────────────────────────
async function doLaunch(inst) {
  const ram = parseInt(ramSlider.value, 10) || 4;
  try {
    await invoke("launch_minecraft", {
      uniqueCode:        inst.unique_code,
      minecraftVersion:  inst.minecraft_version,
      loader:            inst.loader,
      loaderVersion:     inst.loader_version ?? "",
      minecraftUsername: launcherUsername,
      accessToken:       launcherToken || "",
      ramGb:             ram,
    });
  } catch (e) {
    alert("No se pudo lanzar Minecraft:\n" + e);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Configuración (RAM)
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
btnConfig.addEventListener("click", () => configPanel.classList.toggle("open"));

// ── Tamaño de ventana ──────────────────────────────────────────────────────
const SIZE_KEY = "launcher_window_size";
const SIZES = [
  { label: "1200 × 700",  w: 1200, h: 700  },
  { label: "1280 × 720",  w: 1280, h: 720  },
  { label: "1280 × 800",  w: 1280, h: 800  },
  { label: "1366 × 768",  w: 1366, h: 768  },
  { label: "1400 × 800",  w: 1400, h: 800  },
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
  const win = appWindow;
  await win.setSize(new window.__TAURI__.dpi.LogicalSize(s.w, s.h));
  await win.center();
  localStorage.setItem(SIZE_KEY, s.label);
}

// Aplicar tamaño guardado al arrancar
applySize(currentSizeIdx);
sizeSelect.addEventListener("change", () => applySize(parseInt(sizeSelect.value)));



document.addEventListener("click", e => {
  if (configPanel.classList.contains("open") &&
    !configPanel.contains(e.target) &&
    e.target !== btnConfig) {
    configPanel.classList.remove("open");
  }
});

btnExit.addEventListener("click", async () => { await invoke("exit_app"); });

// ─────────────────────────────────────────────────────────────────────────────
// Seguridad — deshabilitar devtools en producción
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
