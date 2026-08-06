use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::path::{PathBuf, Path};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

// ─────────────────────────────────────────────────────────────────────────────
// Estado global: sesiones Microsoft en curso
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Clone, Serialize)]
#[serde(tag = "status")]
enum MsSessionStatus {
    #[serde(rename = "pending")]
    Pending,
    #[serde(rename = "done")]
    Done {
        token: String,
        #[serde(rename = "minecraftUsername")]
        minecraft_username: String,
        #[serde(rename = "minecraftAccessToken")]
        minecraft_access_token: String,
        #[serde(rename = "minecraftUuid")]
        minecraft_uuid: String,
    },
    #[serde(rename = "error")]
    Error { message: String },
}

struct MsSessions(Mutex<HashMap<String, MsSessionStatus>>);

// ─────────────────────────────────────────────────────────────────────────────
// Rutas base
// ─────────────────────────────────────────────────────────────────────────────

/// Raíz: AppData\Roaming\ChevereTuLauncher\
fn launcher_root(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
}

/// AppData\Roaming\ChevereTuLauncher\data\
fn data_dir(app: &AppHandle) -> PathBuf {
    launcher_root(app).join("data")
}

/// data\instances\<unique_code>\
fn instance_dir(app: &AppHandle, unique_code: &str) -> PathBuf {
    data_dir(app).join("instances").join(unique_code)
}

/// data\instances\<unique_code>\version.txt
fn version_file(app: &AppHandle, unique_code: &str) -> PathBuf {
    instance_dir(app, unique_code).join("version.txt")
}

/// data\assets\
fn assets_dir(app: &AppHandle) -> PathBuf {
    data_dir(app).join("assets")
}

/// data\libraries\
fn libraries_dir(app: &AppHandle) -> PathBuf {
    data_dir(app).join("libraries")
}

/// data\versions\<mc_version>\
fn versions_dir(app: &AppHandle, mc_version: &str) -> PathBuf {
    data_dir(app).join("versions").join(mc_version)
}

/// client\data\jdk\
fn java_base_dir(app: &AppHandle) -> PathBuf {
    launcher_root(app).join("client").join("data").join("jdk")
}

/// Ruta al ejecutable de java embebido
fn java_exe(app: &AppHandle, java_version: u8) -> PathBuf {
    let dir = java_base_dir(app).join(format!("java{}", java_version));
    if cfg!(target_os = "windows") {
        dir.join("bin").join("javaw.exe")
    } else {
        dir.join("bin").join("java")
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Estructuras JSON de Mojang
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct VersionManifest {
    versions: Vec<VersionEntry>,
}

#[derive(Deserialize)]
struct VersionEntry {
    id: String,
    url: String,
}

#[derive(Deserialize, Serialize, Clone)]
struct VersionJson {
    #[serde(rename = "mainClass")]
    main_class: String,
    #[serde(rename = "minecraftArguments", default)]
    minecraft_arguments: Option<String>,
    arguments: Option<Arguments>,
    libraries: Vec<Library>,
    downloads: VersionDownloads,
    #[serde(rename = "javaVersion")]
    java_version: Option<JavaVersion>,
    #[serde(rename = "assetIndex")]
    asset_index: AssetIndex,
    assets: String,
}

#[derive(Deserialize, Serialize, Clone)]
struct JavaVersion {
    #[serde(rename = "majorVersion")]
    major_version: u8,
}

#[derive(Deserialize, Serialize, Clone)]
struct Arguments {
    game: Option<Vec<serde_json::Value>>,
    jvm: Option<Vec<serde_json::Value>>,
}

#[derive(Deserialize, Serialize, Clone)]
struct VersionDownloads {
    client: Download,
}

#[derive(Deserialize, Serialize, Clone)]
struct Download {
    url: String,
    sha1: String,
}

#[derive(Deserialize, Serialize, Clone)]
struct AssetIndex {
    id: String,
    url: String,
}

#[derive(Deserialize, Serialize, Clone)]
struct Library {
    name: String,
    downloads: Option<LibraryDownloads>,
    rules: Option<Vec<Rule>>,
}

#[derive(Deserialize, Serialize, Clone)]
struct LibraryDownloads {
    artifact: Option<LibraryArtifact>,
}

#[derive(Deserialize, Serialize, Clone)]
struct LibraryArtifact {
    path: String,
    url: String,
    sha1: String,
}

#[derive(Deserialize, Serialize, Clone)]
struct Rule {
    action: String,
    os: Option<OsRule>,
}

#[derive(Deserialize, Serialize, Clone)]
struct OsRule {
    name: Option<String>,
}

#[derive(Deserialize)]
struct AssetObjects {
    objects: HashMap<String, AssetObject>,
}

#[derive(Deserialize)]
struct AssetObject {
    hash: String,
    size: u64,
}

// ─────────────────────────────────────────────────────────────────────────────
// Estructura modrinth.index.json
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct ModrinthIndex {
    files: Vec<ModrinthFile>,
    dependencies: HashMap<String, String>,
}

#[derive(Deserialize)]
struct ModrinthFile {
    path: String,
    downloads: Vec<String>,
    #[serde(rename = "fileSize")]
    file_size: Option<u64>,
}

// ─────────────────────────────────────────────────────────────────────────────
// Fabric meta
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct FabricLoaderMeta {
    #[serde(rename = "launcherMeta")]
    launcher_meta: FabricLauncherMeta,
    loader: FabricLoader,
    intermediary: FabricIntermediary,
}

#[derive(Deserialize)]
struct FabricLauncherMeta {
    libraries: FabricLibraries,
    #[serde(rename = "mainClass")]
    main_class: FabricMainClass,
}

#[derive(Deserialize)]
struct FabricLibraries {
    client: Vec<FabricLibrary>,
    common: Vec<FabricLibrary>,
}

#[derive(Deserialize)]
struct FabricLibrary {
    name: String,
    url: String,
}

#[derive(Deserialize)]
struct FabricMainClass {
    client: String,
}

#[derive(Deserialize)]
struct FabricLoader {
    version: String,
}

#[derive(Deserialize)]
struct FabricIntermediary {
    version: String,
}

// ─────────────────────────────────────────────────────────────────────────────
// Emisor de progreso
// ─────────────────────────────────────────────────────────────────────────────

fn emit(app: &AppHandle, unique_code: &str, status: &str, percent: u8, detail: &str) {
    let _ = app.emit("download-progress", serde_json::json!({
        "unique_code": unique_code,
        "status": status,
        "percent": percent,
        "detail": detail,
    }));
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP helpers
// ─────────────────────────────────────────────────────────────────────────────

async fn fetch_json<T: for<'de> Deserialize<'de>>(client: &reqwest::Client, url: &str) -> Result<T, String> {
    client.get(url)
        .send().await.map_err(|e| format!("GET {url}: {e}"))?
        .json::<T>().await.map_err(|e| format!("JSON {url}: {e}"))
}

async fn download_file(client: &reqwest::Client, url: &str, path: &Path) -> Result<(), String> {
    if path.exists() { return Ok(()); }
    if let Some(p) = path.parent() { std::fs::create_dir_all(p).map_err(|e| e.to_string())?; }

    let resp = client.get(url).send().await.map_err(|e| format!("GET {url}: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {} para {url}", resp.status()));
    }
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    std::fs::write(path, &bytes).map_err(|e| e.to_string())
}

async fn download_file_bytes(client: &reqwest::Client, url: &str) -> Result<Vec<u8>, String> {
    let resp = client.get(url).send().await.map_err(|e| format!("GET {url}: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {} para {url}", resp.status()));
    }
    resp.bytes().await.map(|b| b.to_vec()).map_err(|e| e.to_string())
}

// ─────────────────────────────────────────────────────────────────────────────
// Java embebido — descarga Adoptium Temurin
// ─────────────────────────────────────────────────────────────────────────────

async fn ensure_java(app: &AppHandle, java_version: u8, unique_code: &str) -> Result<PathBuf, String> {
    let exe = java_exe(app, java_version);
    if exe.exists() { return Ok(exe); }

    emit(app, unique_code, "java", 0, &format!("Descargando Java {}...", java_version));

    let os = if cfg!(target_os = "windows") { "windows" }
             else if cfg!(target_os = "macos") { "mac" }
             else { "linux" };
    let arch = if cfg!(target_arch = "x86_64") { "x64" } else { "aarch64" };
    let ext  = if cfg!(target_os = "windows") { "zip" } else { "tar.gz" };

    let url = format!(
        "https://api.adoptium.net/v3/binary/latest/{}/ga/{}/{}/jdk/hotspot/normal/eclipse?project=jdk",
        java_version, os, arch
    );

    let client = reqwest::Client::new();
    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("No se pudo descargar Java {}: HTTP {}", java_version, resp.status()));
    }

    let total = resp.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;
    let mut bytes = Vec::new();
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;
        bytes.extend_from_slice(&chunk);
        if total > 0 {
            emit(app, unique_code, "java", (downloaded * 100 / total) as u8,
                 &format!("Descargando Java {}...", java_version));
        }
    }

    let java_dir = java_base_dir(app).join(format!("java{}", java_version));
    std::fs::create_dir_all(&java_dir).map_err(|e| e.to_string())?;

    emit(app, unique_code, "java", 99, "Extrayendo Java...");

    if ext == "zip" {
        let cursor = std::io::Cursor::new(bytes);
        let mut archive = zip::ZipArchive::new(cursor).map_err(|e| e.to_string())?;
        // Adoptium zip tiene una carpeta raíz (jdk-21+...) — la saltamos
        let prefix = {
            let f = archive.by_index(0).map_err(|e| e.to_string())?;
            f.name().split('/').next().unwrap_or("").to_string()
        };
        for i in 0..archive.len() {
            let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
            let raw = file.name().to_string();
            let rel = raw.strip_prefix(&format!("{}/", prefix)).unwrap_or(&raw);
            if rel.is_empty() { continue; }
            let out = java_dir.join(rel);
            if raw.ends_with('/') {
                std::fs::create_dir_all(&out).map_err(|e| e.to_string())?;
            } else {
                if let Some(p) = out.parent() { std::fs::create_dir_all(p).map_err(|e| e.to_string())?; }
                let mut f = std::fs::File::create(&out).map_err(|e| e.to_string())?;
                std::io::copy(&mut file, &mut f).map_err(|e| e.to_string())?;
            }
        }
    } else {
        // tar.gz para Linux/Mac
        use std::io::Read;
        let cursor = std::io::Cursor::new(bytes);
        let gz = flate2::read::GzDecoder::new(cursor);
        let mut tar = tar::Archive::new(gz);
        for entry in tar.entries().map_err(|e| e.to_string())? {
            let mut entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path().map_err(|e| e.to_string())?.to_path_buf();
            // Saltar la carpeta raíz del tar
            let components: Vec<_> = path.components().collect();
            if components.len() < 2 { continue; }
            let rel: PathBuf = components[1..].iter().collect();
            let out = java_dir.join(rel);
            if let Some(p) = out.parent() { std::fs::create_dir_all(p).map_err(|e| e.to_string())?; }
            entry.unpack(&out).map_err(|e| e.to_string())?;
        }
    }

    emit(app, unique_code, "java", 100, "Java listo");
    Ok(java_exe(app, java_version))
}

// ─────────────────────────────────────────────────────────────────────────────
// Descarga version.json de Mojang
// ─────────────────────────────────────────────────────────────────────────────

async fn get_version_json(
    app: &AppHandle,
    client: &reqwest::Client,
    mc_version: &str,
    unique_code: &str,
) -> Result<VersionJson, String> {
    let ver_dir = versions_dir(app, mc_version);
    let ver_path = ver_dir.join(format!("{}.json", mc_version));

    if ver_path.exists() {
        let s = std::fs::read_to_string(&ver_path).map_err(|e| e.to_string())?;
        return serde_json::from_str(&s).map_err(|e| e.to_string());
    }

    emit(app, unique_code, "version", 0, "Obteniendo metadata de Minecraft...");

    let manifest: VersionManifest = fetch_json(client,
        "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json").await?;

    let entry = manifest.versions.iter()
        .find(|v| v.id == mc_version)
        .ok_or_else(|| format!("Versión {} no encontrada en Mojang", mc_version))?;

    let ver_json: VersionJson = fetch_json(client, &entry.url).await?;
    std::fs::create_dir_all(&ver_dir).map_err(|e| e.to_string())?;
    std::fs::write(&ver_path, serde_json::to_string(&ver_json).unwrap())
        .map_err(|e| e.to_string())?;

    Ok(ver_json)
}

// ─────────────────────────────────────────────────────────────────────────────
// Descarga client.jar de Mojang
// ─────────────────────────────────────────────────────────────────────────────

async fn ensure_client_jar(
    app: &AppHandle,
    client: &reqwest::Client,
    mc_version: &str,
    ver_json: &VersionJson,
    unique_code: &str,
) -> Result<PathBuf, String> {
    let jar_path = versions_dir(app, mc_version).join(format!("{}.jar", mc_version));
    if !jar_path.exists() {
        emit(app, unique_code, "client_jar", 0, "Descargando client.jar...");
        download_file(client, &ver_json.downloads.client.url, &jar_path).await?;
    }
    Ok(jar_path)
}

// ─────────────────────────────────────────────────────────────────────────────
// Descarga libraries de Mojang
// ─────────────────────────────────────────────────────────────────────────────

fn library_allowed(lib: &Library) -> bool {
    let Some(rules) = &lib.rules else { return true; };
    let current_os = if cfg!(target_os = "windows") { "windows" }
                     else if cfg!(target_os = "macos") { "osx" }
                     else { "linux" };
    let mut allowed = false;
    for rule in rules {
        let matches = match &rule.os {
            None => true,
            Some(os) => os.name.as_deref() == Some(current_os),
        };
        if matches {
            allowed = rule.action == "allow";
        }
    }
    allowed
}

async fn ensure_libraries(
    app: &AppHandle,
    client: &reqwest::Client,
    libraries: &[Library],
    unique_code: &str,
) -> Result<Vec<PathBuf>, String> {
    let lib_dir = libraries_dir(app);
    let total = libraries.len();
    let mut paths = Vec::new();

    for (i, lib) in libraries.iter().enumerate() {
        if !library_allowed(lib) { continue; }
        let Some(downloads) = &lib.downloads else { continue; };
        let Some(artifact) = &downloads.artifact else { continue; };

        let path = lib_dir.join(&artifact.path);
        if !path.exists() {
            emit(app, unique_code, "libraries",
                 (i * 100 / total) as u8,
                 &format!("Lib: {}", lib.name));
            download_file(client, &artifact.url, &path).await?;
        }
        paths.push(path);
    }

    Ok(paths)
}

// ─────────────────────────────────────────────────────────────────────────────
// Descarga assets
// ─────────────────────────────────────────────────────────────────────────────

async fn ensure_assets(
    app: &AppHandle,
    client: &reqwest::Client,
    ver_json: &VersionJson,
    unique_code: &str,
) -> Result<(), String> {
    let assets = assets_dir(app);
    let indexes_dir = assets.join("indexes");
    let objects_dir = assets.join("objects");

    let index_path = indexes_dir.join(format!("{}.json", ver_json.asset_index.id));
    if !index_path.exists() {
        emit(app, unique_code, "assets", 0, "Descargando asset index...");
        download_file(client, &ver_json.asset_index.url, &index_path).await?;
    }

    let index_str = std::fs::read_to_string(&index_path).map_err(|e| e.to_string())?;
    let index: AssetObjects = serde_json::from_str(&index_str).map_err(|e| e.to_string())?;

    let objects: Vec<_> = index.objects.values().collect();
    let total = objects.len();

    for (i, obj) in objects.iter().enumerate() {
        let hash = &obj.hash;
        let prefix = &hash[..2];
        let path = objects_dir.join(prefix).join(hash);
        if !path.exists() {
            let url = format!("https://resources.download.minecraft.net/{}/{}", prefix, hash);
            download_file(client, &url, &path).await?;
        }
        if i % 50 == 0 {
            emit(app, unique_code, "assets", (i * 100 / total) as u8,
                 &format!("Assets: {}/{}", i, total));
        }
    }

    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// Fabric — descarga loader y sus libs
// ─────────────────────────────────────────────────────────────────────────────

async fn ensure_fabric(
    app: &AppHandle,
    client: &reqwest::Client,
    mc_version: &str,
    loader_version: &str,
    unique_code: &str,
) -> Result<(String, Vec<PathBuf>), String> {
    emit(app, unique_code, "fabric", 0, "Descargando Fabric...");

    // Intentar con la versión pedida; si falla, usar la más reciente disponible.
    // Nota: NO usar el sufijo /profile/json de la API de Fabric — ese endpoint
    // devuelve un JSON con un formato distinto (plano, estilo launcher vanilla)
    // que no coincide con la estructura anidada que espera este código.
    let meta_url = format!(
        "https://meta.fabricmc.net/v2/versions/loader/{}/{}",
        mc_version, loader_version
    );

    let meta: FabricLoaderMeta = match fetch_json(client, &meta_url).await {
        Ok(m) => m,
        Err(_) => {
            emit(app, unique_code, "fabric", 0, "Buscando versión de Fabric compatible...");
            #[derive(Deserialize)]
            struct LoaderEntry { loader: LoaderVer }
            #[derive(Deserialize)]
            struct LoaderVer { version: String }

            let list_url = format!("https://meta.fabricmc.net/v2/versions/loader/{}", mc_version);
            let loaders: Vec<LoaderEntry> = fetch_json(client, &list_url).await
                .map_err(|e| format!("No se pudo obtener la lista de versiones de Fabric para MC {mc_version}: {e}"))?;

            let latest_version = loaders.first()
                .ok_or_else(|| format!("No hay versiones de Fabric disponibles para MC {mc_version}"))?
                .loader.version.clone();

            let fallback_url = format!(
                "https://meta.fabricmc.net/v2/versions/loader/{}/{}",
                mc_version, latest_version
            );
            fetch_json(client, &fallback_url).await
                .map_err(|e| format!("No se pudo descargar el perfil de Fabric {latest_version} para MC {mc_version}: {e}"))?
        }
    };

    let main_class = meta.launcher_meta.main_class.client.clone();
    let lib_dir = libraries_dir(app);
    let mut paths = Vec::new();

    // Intermediary
    let intermediary_path = lib_dir
        .join("net/fabricmc/intermediary")
        .join(&meta.intermediary.version)
        .join(format!("intermediary-{}.jar", meta.intermediary.version));
    if !intermediary_path.exists() {
        let url = format!(
            "https://maven.fabricmc.net/net/fabricmc/intermediary/{}/intermediary-{}.jar",
            meta.intermediary.version, meta.intermediary.version
        );
        download_file(client, &url, &intermediary_path).await?;
    }
    paths.push(intermediary_path);

    // Loader
    let loader_path = lib_dir
        .join("net/fabricmc/fabric-loader")
        .join(&meta.loader.version)
        .join(format!("fabric-loader-{}.jar", meta.loader.version));
    if !loader_path.exists() {
        let url = format!(
            "https://maven.fabricmc.net/net/fabricmc/fabric-loader/{}/fabric-loader-{}.jar",
            meta.loader.version, meta.loader.version
        );
        download_file(client, &url, &loader_path).await?;
    }
    paths.push(loader_path);

    // Libraries de launcherMeta
    let all_libs: Vec<_> = meta.launcher_meta.libraries.common.iter()
        .chain(meta.launcher_meta.libraries.client.iter())
        .collect();

    for lib in &all_libs {
        // name: "net.fabricmc:mapping-io:0.6.1" → path: net/fabricmc/mapping-io/0.6.1/mapping-io-0.6.1.jar
        let parts: Vec<&str> = lib.name.splitn(3, ':').collect();
        if parts.len() < 3 { continue; }
        let group = parts[0].replace('.', "/");
        let artifact = parts[1];
        let version = parts[2];
        let jar_name = format!("{}-{}.jar", artifact, version);
        let path = lib_dir.join(&group).join(artifact).join(version).join(&jar_name);

        if !path.exists() {
            let url = format!("{}{}/{}/{}/{}", lib.url, group, artifact, version, jar_name);
            download_file(client, &url, &path).await
                .unwrap_or_else(|_| {}); // algunas libs pueden fallar, continuamos
        }
        if path.exists() { paths.push(path); }
    }

    emit(app, unique_code, "fabric", 100, "Fabric listo");
    Ok((main_class, paths))
}

// ─────────────────────────────────────────────────────────────────────────────
// Forge — descarga y setup básico
// ─────────────────────────────────────────────────────────────────────────────

async fn ensure_forge(
    app: &AppHandle,
    client: &reqwest::Client,
    mc_version: &str,
    loader_version: &str,
    unique_code: &str,
) -> Result<(String, Vec<PathBuf>), String> {
    emit(app, unique_code, "forge", 0, "Descargando Forge...");

    let lib_dir = libraries_dir(app);
    let forge_full = format!("{}-{}", mc_version, loader_version);

    // Forge installer jar
    let installer_path = lib_dir
        .join("net/minecraftforge/forge")
        .join(&forge_full)
        .join(format!("forge-{}-installer.jar", forge_full));

    if !installer_path.exists() {
        let url = format!(
            "https://maven.minecraftforge.net/net/minecraftforge/forge/{}/forge-{}-installer.jar",
            forge_full, forge_full
        );
        download_file(client, &url, &installer_path).await
            .map_err(|_| format!("No se encontró Forge {} para MC {}", loader_version, mc_version))?;
    }

    // Forge universal jar (para lanzar)
    let forge_jar = lib_dir
        .join("net/minecraftforge/forge")
        .join(&forge_full)
        .join(format!("forge-{}.jar", forge_full));

    if !forge_jar.exists() {
        // Intentar client jar directamente
        let url = format!(
            "https://maven.minecraftforge.net/net/minecraftforge/forge/{}/forge-{}-client.jar",
            forge_full, forge_full
        );
        let _ = download_file(client, &url, &forge_jar).await;
    }

    emit(app, unique_code, "forge", 100, "Forge listo");

    let main_class = "net.minecraftforge.fml.loading.FMLClientLaunchProvider".to_string();
    let mut paths = Vec::new();
    if forge_jar.exists() { paths.push(forge_jar); }
    Ok((main_class, paths))
}

// ─────────────────────────────────────────────────────────────────────────────
// Descarga .mrpack, parsea modrinth.index.json y extrae overrides
// ─────────────────────────────────────────────────────────────────────────────

async fn install_mrpack(
    app: &AppHandle,
    client: &reqwest::Client,
    mrpack_url: &str,
    mrpack_version: &str,
    unique_code: &str,
) -> Result<(), String> {
    let inst_dir = instance_dir(app, unique_code);

    // Borrar versión anterior si existe
    if inst_dir.exists() {
        std::fs::remove_dir_all(&inst_dir).map_err(|e| e.to_string())?;
    }
    std::fs::create_dir_all(&inst_dir).map_err(|e| e.to_string())?;

    // 1. Descargar .mrpack
    emit(app, unique_code, "mrpack", 0, "Descargando modpack...");
    let resp = client.get(mrpack_url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("Error descargando modpack: HTTP {}", resp.status()));
    }
    let total = resp.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;
    let mut mrpack_bytes = Vec::new();
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;
        mrpack_bytes.extend_from_slice(&chunk);
        if total > 0 {
            emit(app, unique_code, "mrpack", (downloaded * 100 / total) as u8,
                 "Descargando modpack...");
        }
    }

    // 2. Abrir zip y leer modrinth.index.json + extraer overrides
    emit(app, unique_code, "mrpack", 100, "Procesando modpack...");
    let cursor = std::io::Cursor::new(mrpack_bytes);
    let mut archive = zip::ZipArchive::new(cursor).map_err(|e| e.to_string())?;

    // Leer modrinth.index.json
    let index: ModrinthIndex = {
        let mut f = archive.by_name("modrinth.index.json")
            .map_err(|_| "modrinth.index.json no encontrado en el .mrpack".to_string())?;
        let mut s = String::new();
        std::io::Read::read_to_string(&mut f, &mut s).map_err(|e| e.to_string())?;
        serde_json::from_str(&s).map_err(|e| format!("modrinth.index.json inválido: {e}"))?
    };

    // Extraer overrides/ → carpeta de instancia
    let total_files = archive.len();
    for i in 0..total_files {
        let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
        let raw = file.name().to_string();

        let rel = if let Some(s) = raw.strip_prefix("overrides/") {
            if s.is_empty() { continue; }
            s.to_string()
        } else {
            continue;
        };

        let out = inst_dir.join(&rel);
        if raw.ends_with('/') {
            std::fs::create_dir_all(&out).map_err(|e| e.to_string())?;
        } else {
            if let Some(p) = out.parent() { std::fs::create_dir_all(p).map_err(|e| e.to_string())?; }
            let mut out_file = std::fs::File::create(&out).map_err(|e| e.to_string())?;
            std::io::copy(&mut file, &mut out_file).map_err(|e| e.to_string())?;
        }
    }

    // 3. Descargar mods desde modrinth.index.json
    let total_mods = index.files.len();
    for (i, mod_file) in index.files.iter().enumerate() {
        let out_path = inst_dir.join(&mod_file.path);
        if out_path.exists() { continue; }
        if let Some(p) = out_path.parent() { std::fs::create_dir_all(p).map_err(|e| e.to_string())?; }

        emit(app, unique_code, "mods", (i * 100 / total_mods) as u8,
             &format!("Mod {}/{}", i + 1, total_mods));

        let mut downloaded_ok = false;
        for url in &mod_file.downloads {
            match download_file(client, url, &out_path).await {
                Ok(_) => { downloaded_ok = true; break; }
                Err(_) => continue,
            }
        }
        if !downloaded_ok {
            return Err(format!("No se pudo descargar: {}", mod_file.path));
        }
    }

    // 4. Guardar version.txt
    std::fs::write(version_file(app, unique_code), mrpack_version)
        .map_err(|e| e.to_string())?;

    emit(app, unique_code, "listo", 100, "Instalación completa");
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// Comandos Tauri
// ─────────────────────────────────────────────────────────────────────────────

#[tauri::command]
fn get_installed_version(app: AppHandle, unique_code: String) -> Option<String> {
    std::fs::read_to_string(version_file(&app, &unique_code))
        .ok()
        .map(|s| s.trim().to_string())
}

/// Devuelve los IDs (nombres de carpeta) de todas las instancias instaladas localmente.
#[tauri::command]
fn list_installed_instance_ids(app: AppHandle) -> Vec<String> {
    let instances_root = data_dir(&app).join("instances");
    let Ok(entries) = std::fs::read_dir(&instances_root) else { return vec![]; };
    entries
        .filter_map(|e| {
            let e = e.ok()?;
            if e.file_type().ok()?.is_dir() {
                Some(e.file_name().to_string_lossy().to_string())
            } else {
                None
            }
        })
        .collect()
}

/// Borra la carpeta completa de una instancia local (mods, saves, config, todo).
/// Se llama cuando el backend ya no devuelve esa instancia para el usuario.
#[tauri::command]
fn delete_instance_folder(app: AppHandle, unique_code: String) -> Result<(), String> {
    let dir = instance_dir(&app, &unique_code);
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Instala una instancia completa:
/// 1. Java embebido
/// 2. version.json + client.jar de Mojang
/// 3. Libraries de Mojang
/// 4. Assets de Mojang
/// 5. Fabric o Forge según loader
/// 6. Descarga .mrpack + mods de Modrinth + extrae overrides
#[tauri::command]
async fn download_mrpack(
    app: AppHandle,
    unique_code: String,
    mrpack_url: String,
    mrpack_version: String,
    minecraft_version: String,
    loader: String,           // "fabric" | "forge" | "neoforge" | "quilt"
    loader_version: String,   // versión del loader (ej: "0.16.9" para Fabric)
) -> Result<(), String> {
    // Crear carpeta instances desde el inicio para que siempre exista
    let instances_root = data_dir(&app).join("instances");
    std::fs::create_dir_all(&instances_root).map_err(|e| e.to_string())?;

    let client = reqwest::Client::builder()
        .user_agent("ChevereTuLauncher/1.0")
        .build()
        .map_err(|e| e.to_string())?;

    // 1. version.json
    let ver_json = get_version_json(&app, &client, &minecraft_version, &unique_code).await?;

    // 2. Java
    let java_major = ver_json.java_version.as_ref().map(|j| j.major_version).unwrap_or(21);
    ensure_java(&app, java_major, &unique_code).await?;

    // 3. client.jar
    ensure_client_jar(&app, &client, &minecraft_version, &ver_json, &unique_code).await?;

    // 4. Libraries Mojang
    emit(&app, &unique_code, "libraries", 0, "Descargando libraries...");
    ensure_libraries(&app, &client, &ver_json.libraries, &unique_code).await?;

    // 5. Assets
    ensure_assets(&app, &client, &ver_json, &unique_code).await?;

    // 6. Loader
    match loader.to_lowercase().as_str() {
        "fabric" | "quilt" => {
            ensure_fabric(&app, &client, &minecraft_version, &loader_version, &unique_code).await?;
        }
        "forge" | "neoforge" => {
            ensure_forge(&app, &client, &minecraft_version, &loader_version, &unique_code).await?;
        }
        _ => {}
    }

    // 7. .mrpack
    install_mrpack(&app, &client, &mrpack_url, &mrpack_version, &unique_code).await?;

    Ok(())
}

/// Lanza Minecraft con la instancia instalada
#[tauri::command]
async fn launch_minecraft(
    app: AppHandle,
    unique_code: String,
    minecraft_version: String,
    loader: String,
    loader_version: String,
    minecraft_username: String,
    access_token: String,
    minecraft_uuid: Option<String>,
    ram_gb: u32,
    window_width: Option<u32>,
    window_height: Option<u32>,
) -> Result<u32, String> {
    let inst_dir = instance_dir(&app, &unique_code);
    if !inst_dir.exists() {
        return Err("La instancia no está instalada.".into());
    }

    let client = reqwest::Client::new();
    let ver_json = get_version_json(&app, &client, &minecraft_version, &unique_code).await?;
    let java_major = ver_json.java_version.as_ref().map(|j| j.major_version).unwrap_or(21);
    let java = java_exe(&app, java_major);

    // Construir classpath
    let lib_dir = libraries_dir(&app);
    let client_jar = versions_dir(&app, &minecraft_version)
        .join(format!("{}.jar", minecraft_version));

    let mut classpath_entries: Vec<PathBuf> = Vec::new();

    // Libraries Mojang
    for lib in &ver_json.libraries {
        if !library_allowed(lib) { continue; }
        if let Some(d) = &lib.downloads {
            if let Some(a) = &d.artifact {
                let p = lib_dir.join(&a.path);
                if p.exists() { classpath_entries.push(p); }
            }
        }
    }

    // Main class y libs del loader
    let main_class = match loader.to_lowercase().as_str() {
        "fabric" | "quilt" => {
            let (mc, fabric_libs) = ensure_fabric(&app, &client, &minecraft_version, &loader_version, &unique_code).await?;
            classpath_entries.extend(fabric_libs);
            mc
        }
        "forge" | "neoforge" => {
            let (mc, forge_libs) = ensure_forge(&app, &client, &minecraft_version, &loader_version, &unique_code).await?;
            classpath_entries.extend(forge_libs);
            mc
        }
        _ => ver_json.main_class.clone(),
    };

    // client.jar al final del classpath
    if client_jar.exists() { classpath_entries.push(client_jar); }

    let sep = if cfg!(target_os = "windows") { ";" } else { ":" };
    let classpath = classpath_entries.iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect::<Vec<_>>()
        .join(sep);

    // Assets dir
    let assets = assets_dir(&app);
    let asset_index = &ver_json.asset_index.id;

    // UUID: si tenemos el UUID real de Minecraft (cuenta premium), lo usamos.
    // Si no (cuenta no premium / offline), generamos uno offline estable.
    let uuid = match minecraft_uuid.filter(|u| !u.is_empty()) {
        Some(u) => u,
        None => format!("offline-{}", &unique_code[..8]),
    };

    let mut cmd = std::process::Command::new(&java);
    cmd.arg(format!("-Xmx{}G", ram_gb))
       .arg("-Xms512M")
       .arg(format!("-Djava.library.path={}", inst_dir.join("natives").display()))
       .arg("-cp").arg(&classpath)
       .arg(&main_class)
       // Args del juego
       .arg("--username").arg(&minecraft_username)
       .arg("--version").arg(&minecraft_version)
       .arg("--gameDir").arg(&inst_dir)
       .arg("--assetsDir").arg(&assets)
       .arg("--assetIndex").arg(asset_index)
       .arg("--uuid").arg(&uuid)
       .arg("--accessToken").arg(if access_token.is_empty() { "0" } else { &access_token })
       .arg("--userType").arg(if access_token.is_empty() { "offline" } else { "msa" })
       .arg("--width").arg(window_width.unwrap_or(1280).to_string())
       .arg("--height").arg(window_height.unwrap_or(720).to_string())
       .current_dir(&inst_dir);

    let child = cmd.spawn().map_err(|e| format!("No se pudo lanzar Minecraft: {e}"))?;
    let pid = child.id();

    // Ocultar la ventana del launcher (no se cierra el proceso, solo se
    // esconde de pantalla y de la barra de tareas) para que solo se vea
    // Minecraft. Se vuelve a mostrar cuando el watcher detecta que el
    // juego se cerró (ver start_background_watcher).
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.hide();
    }

    // Esperamos unos segundos para dar tiempo a que la ventana de Minecraft
    // termine de abrir antes de cerrar el launcher (aproximado: no hay forma
    // 100% confiable de detectar "la ventana ya es visible" sin hooks nativos).
    tokio::time::sleep(std::time::Duration::from_secs(24)).await;

    Ok(pid)
}

// ─────────────────────────────────────────────────────────────────────────────
// Login Microsoft
// ─────────────────────────────────────────────────────────────────────────────

#[tauri::command]
async fn start_microsoft_login(app: AppHandle, session_id: String, discord_id: Option<String>) -> Result<(), String> {
    let sessions = app.state::<Arc<MsSessions>>();
    sessions.0.lock().unwrap().insert(session_id.clone(), MsSessionStatus::Pending);

    let backend_url = {
        let cfg = std::fs::read_to_string(
            app.path().resource_dir().unwrap_or_default().join("dist/config.json"),
        ).unwrap_or_default();
        serde_json::from_str::<serde_json::Value>(&cfg)
            .ok()
            .and_then(|v| v["backend_url"].as_str().map(|s| s.to_string()))
            .unwrap_or_else(|| "https://chevere-backend.onrender.com".to_string())
    };

    let sessions_clone = Arc::clone(&*sessions);
    let app_clone = app.clone();
    tokio::spawn(async move {
        let status = match do_microsoft_login(&app_clone, &session_id, &backend_url, discord_id.as_deref()).await {
            Ok((token, username, mc_access_token, mc_uuid)) => MsSessionStatus::Done {
                token,
                minecraft_username: username,
                minecraft_access_token: mc_access_token,
                minecraft_uuid: mc_uuid,
            },
            Err(e) => MsSessionStatus::Error { message: e },
        };
        sessions_clone.0.lock().unwrap().insert(session_id, status);
    });
    Ok(())
}

#[tauri::command]
fn poll_microsoft_login(app: AppHandle, session_id: String) -> MsSessionStatus {
    let sessions = app.state::<Arc<MsSessions>>();
    let status = sessions.0.lock().unwrap().get(&session_id).cloned().unwrap_or(MsSessionStatus::Pending);
    status
}

async fn do_microsoft_login(app: &AppHandle, session_id: &str, backend_url: &str, discord_id: Option<&str>) -> Result<(String, String, String, String), String> {
    let discord_id = discord_id
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "Debes iniciar sesion con Discord primero.".to_string())?;

    use minecraft_msa_auth::MinecraftAuthorizationFlow;
    use oauth2::{AuthUrl, ClientId, DeviceAuthorizationUrl, TokenUrl, basic::BasicClient};

    let client = BasicClient::new(
        ClientId::new("6cd90ab7-e6b5-4f24-99b2-addb4ff8b7f8".to_string()),
        None,
        AuthUrl::new("https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize".to_string())
            .map_err(|e| e.to_string())?,
        Some(TokenUrl::new("https://login.microsoftonline.com/consumers/oauth2/v2.0/token".to_string())
            .map_err(|e| e.to_string())?),
    ).set_device_authorization_url(
        DeviceAuthorizationUrl::new(
            "https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode".to_string(),
        ).map_err(|e| e.to_string())?,
    );

    let http = reqwest::Client::new();
    let mc_flow = MinecraftAuthorizationFlow::new(http.clone());
    use oauth2::{Scope, TokenResponse, reqwest::async_http_client};

    let details: oauth2::devicecode::StandardDeviceAuthorizationResponse = client
        .exchange_device_code().map_err(|e| e.to_string())?
        .add_scope(Scope::new("XboxLive.signin offline_access".to_string()))
        .request_async(async_http_client).await
        .map_err(|e| format!("Error obteniendo el codigo de Microsoft: {e:?}"))?;

    // Emitir el código y URL al frontend para que el usuario sepa qué hacer
    use oauth2::DeviceAuthorizationResponse;
    let user_code = details.user_code().secret().to_string();
    let verification_uri = details.verification_uri().to_string();
    let _ = app.emit("ms-device-code", serde_json::json!({
        "user_code": user_code,
        "verification_uri": verification_uri,
    }));

    let ms_token = client
        .exchange_device_access_token(&details)
        .request_async(async_http_client, tokio::time::sleep, None)
        .await
        .map_err(|e| {
            // El Display de oauth2::RequestTokenError es muy pobre (ej: "Server returned
            // error response") y oculta el código de error real que manda Microsoft.
            // Usamos Debug para sacar el detalle y lo traducimos a algo entendible.
            let debug = format!("{e:?}");
            if debug.contains("expired_token") {
                "El código expiró antes de que confirmaras el login. Intenta de nuevo.".to_string()
            } else if debug.contains("authorization_declined") {
                "Cancelaste el inicio de sesión con Microsoft.".to_string()
            } else if debug.contains("bad_verification_code") {
                "Código de verificación inválido. Intenta de nuevo.".to_string()
            } else if debug.contains("invalid_client") || debug.contains("unauthorized_client") {
                "La app de Microsoft usada por el launcher no está autorizada (invalid_client). Hay que revisar el Client ID/registro en Azure.".to_string()
            } else if debug.contains("invalid_grant") {
                "La sesión de login con Microsoft ya no es válida. Intenta de nuevo.".to_string()
            } else {
                format!("Error de Microsoft al obtener el token: {debug}")
            }
        })?;

    let mc_token = mc_flow
        .exchange_microsoft_token(ms_token.access_token().secret())
        .await
        .map_err(|e| format!("Error validando la cuenta con Xbox/Minecraft: {e:?}"))?;

    #[derive(Deserialize)]
    struct BackendResp { token: String, minecraft_username: String, minecraft_uuid: String }

    let mc_access_token = mc_token.access_token().as_ref().to_string();

    let resp = http
        .post(format!("{backend_url}/auth/microsoft/verify"))
        .json(&serde_json::json!({
            "minecraft_access_token": mc_access_token,
            "discord_id": discord_id,
        }))
        .send().await.map_err(|e| format!("Error contactando el backend: {e}"))?;

    if resp.status() == 403 {
        return Err(resp.text().await.unwrap_or_default());
    }
    if !resp.status().is_success() {
        return Err(format!("Backend error {}: {}", resp.status(), resp.text().await.unwrap_or_default()));
    }

    let data: BackendResp = resp.json().await.map_err(|e| e.to_string())?;
    Ok((data.token, data.minecraft_username, mc_access_token, data.minecraft_uuid))
}

// ─────────────────────────────────────────────────────────────────────────────
// Watcher de fondo — corre invisible después de que el launcher se cierra
// ─────────────────────────────────────────────────────────────────────────────

/// Guarda el estado del watcher en disco para poder recuperarlo si el proceso muere.
fn save_watcher_state(app: &AppHandle, token: &str, backend_url: &str, instance_id: &str, pid: u32) {
    let path = data_dir(app).join("watcher.json");
    let state = serde_json::json!({
        "token": token,
        "backend_url": backend_url,
        "instance_id": instance_id,
        "pid": pid,
    });
    let _ = std::fs::create_dir_all(data_dir(app));
    let _ = std::fs::write(&path, state.to_string());
}

/// Borra el archivo de estado del watcher (cuando termina limpiamente).
fn clear_watcher_state(app: &AppHandle) {
    let path = data_dir(app).join("watcher.json");
    let _ = std::fs::remove_file(&path);
}

/// Al arrancar el launcher, revisa si quedó un watcher.json de una sesión anterior
/// (significa que el watcher murió inesperadamente). Si Minecraft sigue vivo,
/// reactiva el watcher. Si ya no está, limpia el archivo.
fn recover_watcher_if_needed(app: &AppHandle) {
    let path = data_dir(app).join("watcher.json");
    let Ok(raw) = std::fs::read_to_string(&path) else { return; };
    let Ok(val) = serde_json::from_str::<serde_json::Value>(&raw) else {
        let _ = std::fs::remove_file(&path);
        return;
    };

    let token       = val["token"].as_str().unwrap_or("").to_string();
    let backend_url = val["backend_url"].as_str().unwrap_or("").to_string();
    let instance_id = val["instance_id"].as_str().unwrap_or("").to_string();
    let pid         = val["pid"].as_u64().unwrap_or(0) as u32;

    if token.is_empty() || instance_id.is_empty() || pid == 0 {
        let _ = std::fs::remove_file(&path);
        return;
    }

    // Verificar si Minecraft sigue corriendo
    #[cfg(target_os = "windows")]
    let mc_still_alive = {
        let out = std::process::Command::new("tasklist")
            .args(["/FI", &format!("PID eq {}", pid), "/NH"])
            .output();
        match out {
            Ok(o) => String::from_utf8_lossy(&o.stdout).contains(&pid.to_string()),
            Err(_) => false,
        }
    };
    #[cfg(not(target_os = "windows"))]
    let mc_still_alive = unsafe { libc::kill(pid as i32, 0) == 0 };

    if mc_still_alive {
        // Minecraft sigue vivo — reactivar el watcher
        let app_clone = app.clone();
        tokio::spawn(async move {
            // Pequeña espera para que el launcher termine de iniciar
            tokio::time::sleep(std::time::Duration::from_secs(5)).await;
            start_background_watcher(app_clone, token, backend_url, instance_id, pid);
        });
    } else {
        // Minecraft ya no está — solo limpiar el archivo
        let _ = std::fs::remove_file(&path);
    }
}

/// Lanza un watcher invisible en segundo plano que:
/// 1. Cada 2 min consulta al backend si el jugador sigue teniendo acceso a la instancia.
/// 2. Si ya no tiene acceso → mata Minecraft → borra la carpeta de la instancia → termina.
/// 3. Si Minecraft se cerró solo → espera 3 min más haciendo la misma consulta → termina.
#[tauri::command]
fn start_background_watcher(
    app: AppHandle,
    token: String,
    backend_url: String,
    instance_id: String,   // UUID de la instancia a vigilar
    minecraft_pid: u32,    // PID del proceso de Minecraft
) {
    let app_clone = app.clone();

    tokio::spawn(async move {
        // Persistir estado por si el proceso muere inesperadamente
        save_watcher_state(&app_clone, &token, &backend_url, &instance_id, minecraft_pid);

        let client = reqwest::Client::new();
        let check_interval = std::time::Duration::from_secs(2 * 60); // 2 minutos
        let grace_period   = std::time::Duration::from_secs(5 * 60); // 5 min después de que Minecraft cierre

        // Función auxiliar: ¿sigue vivo el proceso de Minecraft?
        let mc_alive = |pid: u32| -> bool {
            // En Windows: tasklist /FI "PID eq <pid>" /NH
            // Si devuelve algo con el pid, sigue vivo.
            #[cfg(target_os = "windows")]
            {
                let out = std::process::Command::new("tasklist")
                    .args(["/FI", &format!("PID eq {}", pid), "/NH"])
                    .output();
                match out {
                    Ok(o) => {
                        let s = String::from_utf8_lossy(&o.stdout);
                        s.contains(&pid.to_string())
                    }
                    Err(_) => false,
                }
            }
            #[cfg(not(target_os = "windows"))]
            {
                // En otros SO: kill -0 no mata, solo verifica existencia
                unsafe { libc::kill(pid as i32, 0) == 0 }
            }
        };

        // Función auxiliar: matar Minecraft
        let kill_minecraft = |pid: u32| {
            #[cfg(target_os = "windows")]
            {
                let _ = std::process::Command::new("taskkill")
                    .args(["/PID", &pid.to_string(), "/F"])
                    .output();
            }
            #[cfg(not(target_os = "windows"))]
            {
                unsafe { libc::kill(pid as i32, libc::SIGKILL); }
            }
        };

        // Función auxiliar: consultar al backend si esta instancia sigue disponible.
        // Devuelve: Ok(true) = tiene acceso, Ok(false) = sin acceso, Err = fallo de red
        let has_access = |client: &reqwest::Client, backend_url: &str, token: &str, instance_id: &str| {
            let url    = format!("{}/instances", backend_url);
            let auth   = format!("Bearer {}", token);
            let iid    = instance_id.to_string();
            let c      = client.clone();
            let u      = url.clone();
            let a      = auth.clone();
            async move {
                match c.get(&u).header("Authorization", &a).send().await {
                    Ok(res) => {
                        if res.status() == 401 {
                            // Token vencido o revocado → sin acceso definitivo
                            return Ok(false);
                        }
                        if res.status().is_success() {
                            if let Ok(list) = res.json::<Vec<serde_json::Value>>().await {
                                return Ok(list.iter().any(|i| {
                                    i["id"].as_str().unwrap_or("") == iid
                                }));
                            }
                        }
                        Err(()) // respuesta rara, contar como fallo de red
                    }
                    Err(_) => Err(()), // sin internet u otro error de red
                }
            }
        };

        let mut mc_was_alive    = true;
        let mut grace_start: Option<std::time::Instant> = None;
        let mut network_fails: u32 = 0;
        const MAX_NET_FAILS: u32   = 3; // 3 fallos seguidos (~6 min sin red) → borrar igual

        loop {
            tokio::time::sleep(check_interval).await;

            let alive = mc_alive(minecraft_pid);

            // Detectar si Minecraft acaba de cerrarse
            if mc_was_alive && !alive {
                grace_start = Some(std::time::Instant::now());

                // Minecraft se cerró: volvemos a mostrar el launcher
                if let Some(win) = app_clone.get_webview_window("main") {
                    let _ = win.show();
                    let _ = win.set_focus();
                }
            }
            mc_was_alive = alive;

            // Consultar acceso al backend
            match has_access(&client, &backend_url, &token, &instance_id).await {
                Ok(false) => {
                    // Sin acceso confirmado (o token vencido) → matar Minecraft → borrar → salir
                    if alive {
                        kill_minecraft(minecraft_pid);
                        tokio::time::sleep(std::time::Duration::from_secs(3)).await;
                    }
                    let dir = instance_dir(&app_clone, &instance_id);
                    if dir.exists() { let _ = std::fs::remove_dir_all(&dir); }
                    clear_watcher_state(&app_clone);
                    break;
                }
                Ok(true) => {
                    // Tiene acceso — resetear contador de fallos de red
                    network_fails = 0;
                }
                Err(()) => {
                    // Fallo de red — acumular
                    network_fails += 1;
                    if network_fails >= MAX_NET_FAILS {
                        // Demasiados fallos seguidos (probablemente cortó internet a propósito)
                        // → tratar como sin acceso
                        if alive {
                            kill_minecraft(minecraft_pid);
                            tokio::time::sleep(std::time::Duration::from_secs(3)).await;
                        }
                        let dir = instance_dir(&app_clone, &instance_id);
                        if dir.exists() { let _ = std::fs::remove_dir_all(&dir); }
                        clear_watcher_state(&app_clone);
                        break;
                    }
                }
            }

            // Si Minecraft ya cerró y pasaron los 5 min de gracia → terminar watcher
            if let Some(start) = grace_start {
                if start.elapsed() >= grace_period {
                    clear_watcher_state(&app_clone);
                    break;
                }
            }
        }
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Salir
// ─────────────────────────────────────────────────────────────────────────────

#[tauri::command]
fn exit_app(app: AppHandle) { app.exit(0); }

// ─────────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(Arc::new(MsSessions(Mutex::new(HashMap::new()))))
        .setup(|app| {
            // ── Lock file: evitar que el launcher abra dos veces ────────────
            // Si ya hay una instancia corriendo, el archivo .lock existe y está
            // bloqueado. En ese caso cerramos esta nueva instancia silenciosamente.
            let lock_path = app.path().app_data_dir()
                .unwrap_or_else(|_| std::path::PathBuf::from("."))
                .join("launcher.lock");

            let lock_file = std::fs::OpenOptions::new()
                .create(true)
                .write(true)
                .open(&lock_path);

            match lock_file {
                Ok(f) => {
                    use std::os::windows::io::AsRawHandle;
                    // En Windows usamos LockFileEx para bloquear exclusivo
                    #[cfg(target_os = "windows")]
                    {
                        use windows_sys::Win32::Storage::FileSystem::{LockFileEx, LOCKFILE_EXCLUSIVE_LOCK, LOCKFILE_FAIL_IMMEDIATELY};
                        use windows_sys::Win32::System::IO::OVERLAPPED;
                        let handle = f.as_raw_handle();
                        let mut overlapped = unsafe { std::mem::zeroed::<OVERLAPPED>() };
                        let locked = unsafe {
                            LockFileEx(handle, LOCKFILE_EXCLUSIVE_LOCK | LOCKFILE_FAIL_IMMEDIATELY, 0, 1, 0, &mut overlapped)
                        };
                        if locked == 0 {
                            // Ya hay otra instancia — cerrar esta
                            std::process::exit(0);
                        }
                        // Guardar el file handle para que viva toda la sesión
                        app.manage(f);
                    }
                    #[cfg(not(target_os = "windows"))]
                    {
                        use std::os::unix::io::AsRawFd;
                        let fd = f.as_raw_fd();
                        let locked = unsafe { libc::flock(fd, libc::LOCK_EX | libc::LOCK_NB) };
                        if locked != 0 {
                            std::process::exit(0);
                        }
                        app.manage(f);
                    }
                }
                Err(_) => {} // Si no se puede crear el lock, seguir igual
            }
            // ────────────────────────────────────────────────────────────────

            // Limpieza de una carpeta de AppData vieja, que quedó huérfana de
            // cuando el identifier de la app era distinto ("cheverestudios.launcher").
            // Se ejecuta una vez por arranque; si ya no existe, no hace nada.
            if let Ok(data_dir) = app.path().app_data_dir() {
                if let Some(roaming) = data_dir.parent() {
                    let old_dir = roaming.join("cheverestudios.launcher");
                    if old_dir.exists() {
                        let _ = std::fs::remove_dir_all(&old_dir);
                    }
                }
            }

            // Recuperar watcher si murió inesperadamente en sesión anterior
            recover_watcher_if_needed(&app.handle().clone());

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_installed_version,
            list_installed_instance_ids,
            delete_instance_folder,
            download_mrpack,
            launch_minecraft,
            start_background_watcher,
            start_microsoft_login,
            poll_microsoft_login,
            exit_app,
        ])
        .run(tauri::generate_context!())
        .expect("Error arrancando Chevere Launcher");
}
