# ECHO Launcher v5.0

A modern custom Minecraft launcher built with Electron. Full Modrinth integration, animated UI, and advanced game management tools.

---

## Screenshots

> Add screenshots to the `screenshots/` folder and insert them here:
> - "Play" tab — version selector, avatar, launch button
> - "Mods" tab — Modrinth catalog with filters
> - "Files" tab — built-in file manager
> - "Settings" tab — launcher settings and Java management

---

## Key Features

- **9 tabs** with full functionality in each
- **Modrinth integration** — mods, modpacks, resource packs, shaders from one window
- **Automatic Java** — downloads the right version without user involvement
- **Version isolation** — each Minecraft version lives in its own folder
- **Built-in file manager** — full control over game files
- **Statistics** — track playtime, launches, and favorite versions
- **Russian & English** interface

---

## Launcher Tabs

### Play
- Active account selector with avatar and username
- Dropdown list of installed Minecraft versions
- "Play" button with loading animation
- Download progress bar (stage + percentage)
- Running instances display (can be terminated)
- Open current version folder button
- Delete version button
- Isolation mode toggle (shared folder / isolated)
- Current isolation mode indicator

### Versions
- Full list of available Minecraft versions (Release + Snapshot)
- Filters by type: Vanilla, Forge, NeoForge, Fabric, Quilt, OptiFine, All
- Search by version number
- Download button with progress indicator
- Status information (installed / not installed)

### Statistics
- Total playtime (hours and minutes)
- Total number of launches
- Favorite version (most played)
- Detailed per-version statistics:
  - Number of launches
  - Playtime
  - Last played

### Accounts
- Two account types:
  - **Local** — just a username, no authentication required
  - **Ely.by** — full authentication (OAuth or username/password)
- List of all accounts with avatars
- Detailed info: username, UUID, type, creation date
- Action buttons: select for game, change skin, delete
- Upload skin from PNG file (64x64 or 64x32)
- Current skin preview
- Switch between accounts with one click

### Mods (Modrinth)
- Four content categories:
  - **Mods** — Minecraft modifications
  - **Modpacks** — pre-built mod collections
  - **Resource Packs** — textures and resources
  - **Shaders** — graphical enhancements
- Filters:
  - Minecraft version (dropdown)
  - Loader (Forge, NeoForge, Fabric, Quilt)
- Sorting: by relevance, downloads, follows, newest, updated
- Search by name and description
- Mod cards with icons and descriptions
- Detailed mod page (description, versions, downloads)
- Install mods into current version's mods folder
- Install modpacks (unpack .mrpack, download mods, configure loader)
- Install resource packs into resourcepacks folder
- Install shaders into shaderpacks folder
- Pagination (back/forward)
- Target version selection on install

### Media (Screenshots)
- Screenshot gallery from selected version's screenshots folder
- Thumbnail grid of all screenshots
- Full-size screenshot viewer (popup window)
- Delete screenshots
- Open screenshots folder in file explorer
- Refresh gallery

### Tools & Diagnostics
- **Integrity Check** — verify game files against manifest, find missing/corrupted files
- **Cache Cleanup** — remove temporary files with freed space calculation
- **Optimization** — automatic JVM argument tuning for your PC configuration
- **Log Analysis:**
  - Read last 100 lines from latest.log
  - Color-coded: errors (red), warnings (yellow), info (blue)
  - Error summary (up to 5)
  - Monospace font display (Consolas)
- **Open Logs Folder** in file explorer

### Settings
- **Interface Language** — Russian / English (instant switching)
- **Allocated RAM** — slider 512–16384 MB with precise input
- **Optimization Profiles:**
  - Balanced — optimal settings for most PCs
  - Max FPS — aggressive GC and memory optimization
  - Weak PC — minimal system load
- **Java Management:**
  - Auto-detect required Java version for each Minecraft version
  - Compatibility table: Java 8 (1.16 and below), Java 17 (1.17–1.20.4), Java 21 (1.20.5+), Java 25 (26.x+)
  - Auto-download via Adoptium API
  - Install / remove Java versions
  - Download progress bar
- **System Info:**
  - Operating system
  - CPU
  - RAM (total and available)
  - GPU
- **GPU Selection** — for laptops with dual GPUs
- **Save Button** with confirmation animation

### Files (File Manager)
- Full-featured file manager for `.minecraft_custom`
- **Sidebar** — directory tree with quick access
- **Navigation:**
  - Buttons: back, forward, up one level, refresh
  - Breadcrumbs with current path (clickable)
- **File Viewing:**
  - List mode (table: name, size, modified date)
  - Grid mode (cards)
- **Context Menu (right-click):**
  - Open file
  - Show in file explorer
  - Cut (Ctrl+X)
  - Copy (Ctrl+C)
  - Paste (Ctrl+V)
  - Rename (F2)
  - Delete (Delete)
  - Properties (size, date, path)
- **Create New Folders**
- **Status Bar** — current path, file count

---

## Backend Modules

### Account Manager (AccountManager)
- Store accounts in `accounts.json`
- Generate UUID for each account
- Track last usage
- Attach skins to accounts

### Minecraft Launcher (MinecraftLauncher)
- Download Minecraft and all dependencies
- Auto-download authlib-injector for Ely.by
- Mod loader support:
  - **Forge** — download Forge client
  - **Fabric** — download Fabric Loader + Yarn mappings
  - **NeoForge** — download NeoForge
  - **Quilt** — download Quilt Loader
  - **OptiFine** — integration via modpack
- Isolation: each version can live in `instances/<version>/`
- Library, asset, and mod loader download progress
- Launch via `child_process.spawn` with JVM arguments
- Capture stdout/stderr for logging
- Track process termination

### Java Manager (JavaManager)
- Detect system Java via `java -version`
- Determine required Java version by Minecraft version number
- Download via Adoptium API (Adoptium/Temurin)
- Store in `~/.minecraft_custom/java/`
- Install / remove individual versions

### Modrinth API (ModrinthAPI)
- Search mods, modpacks, resource packs, shaders
- Filter by Minecraft version and loader
- Get project details
- Get project version list
- Download files with progress

### Modpack Installer (ModpackInstaller)
- Support Modrinth format (.mrpack)
- Unpack modrinth.index.json manifest
- Auto-detect loader and version
- Download all mods from manifest
- Install into isolated version folder

### Stats Manager (StatsManager)
- Record each launch (version, time, duration)
- Calculate total playtime
- Determine favorite version
- Store in `launcher_stats.json`

---

## Requirements

- **OS:** Windows 10/11 (x64)
- **Electron:** 28+ (included in installer)
- **Java:** 8, 17, 21 or 25 (launcher auto-downloads via Adoptium)
- **Internet:** required for downloading versions, mods, Java

---

## Installation & Usage

### From Installer
1. Download `ECHO-Launcher-Setup.exe` from the Releases section
2. Run the installer
3. Choose installation directory
4. Launch ECHO Launcher

### From Source
```bash
# Clone the repository
git clone https://github.com/your-username/echo-launcher.git
cd echo-launcher

# Install dependencies
npm install

# Run in development mode
npm run dev

# Or run in normal mode
npm start
```

### Build Installer
```bash
npm run build-installer
```
The finished installer will appear in the `dist/` folder.

---

## Project Structure

```
echo-launcher/
├── src/
│   ├── main.js                       # Electron entry point, IPC handlers (78 channels)
│   ├── auth/
│   │   └── ElyByAuth.js              # Ely.by authentication (OAuth + username/password)
│   ├── launcher/
│   │   ├── AccountManager.js         # Account CRUD (local + Ely.by)
│   │   ├── JavaManager.js            # Java detection, download, management
│   │   ├── MinecraftLauncher.js      # Minecraft launch (587 lines)
│   │   ├── ModLoaderAPI.js           # Forge/Fabric/OptiFine/NeoForge/Quilt versions
│   │   ├── ModpackInstaller.js       # .mrpack modpack installation (267 lines)
│   │   ├── ModrinthAPI.js            # Modrinth v2 REST API
│   │   └── StatsManager.js           # Launch and playtime statistics
│   ├── localization/
│   │   ├── translations.js           # 200+ translation keys (RU/EN)
│   │   └── backend-translations.js   # Backend message translations
│   └── ui/
│       ├── index.html                # Main page (832 lines)
│       ├── renderer.js               # UI logic (2516 lines)
│       ├── styles.css                # Main styles (5186 lines)
│       ├── dialog.css                # Dialog styles
│       ├── custom-dialogs.js         # Alert / Confirm / Prompt dialogs
│       ├── dialog.js                 # Deletion confirmation dialog
│       ├── file-manager.js           # File manager (783 lines)
│       ├── file-manager-styles.css   # File manager styles
│       └── background.js             # Animated background — particles + lines
├── assets/
│   └── icon.png                      # Application icon
├── icon.ico                          # Icon for Windows build
├── build_installer.bat               # NSIS installer build script
├── GITHUB_DESCRIPTION.txt            # This file (Russian)
├── GITHUB_DESCRIPTION_EN.md          # This file (English)
├── package.json                      # Dependencies and build configuration
└── package-lock.json
```

---

## Technologies & Dependencies

### Core
- **Electron 28** — desktop framework (Chromium + Node.js)
- **Node.js** — server-side logic

### Dependencies (package.json)
- **axios** — HTTP requests to Modrinth API, Ely.by, Adoptium
- **fs-extra** — enhanced file system operations
- **adm-zip** — .mrpack modpack extraction
- **extract-zip** — .zip file extraction (Java, mods)

### Frontend
- **HTML5** — semantic markup
- **CSS3** — gradients, backdrop-filter, animations, CSS Grid/Flexbox
- **Vanilla JavaScript** — no frameworks
- **Canvas API** — animated background (40 particles + connecting lines)
- **Google Fonts** — Plus Jakarta Sans + Caveat

### Build
- **electron-builder** — NSIS installer build for Windows
- **NSIS** — installer with directory selection, desktop and Start Menu shortcuts

---

## IPC Channels (78 handlers)

The launcher uses 78 IPC channels between main and renderer processes:

| Category | Channels |
|----------|----------|
| Game | `launch-game`, `get-versions`, `download-version`, `get-installed-versions`, `check-version-ready`, `delete-version` |
| Accounts | `accounts-get-all`, `accounts-add-local`, `accounts-add-ely`, `accounts-set-active`, `accounts-remove`, `accounts-update-skin` |
| Ely.by | `ely-start-oauth`, `ely-login-username-password`, `ely-get-account-info`, `ely-refresh-token`, `ely-validate-token`, `ely-logout`, `ely-authenticate-for-game` |
| Java | `java-get-all-info`, `java-get-installed`, `java-download`, `java-delete`, `java-get-for-minecraft`, `java-get-required-version` |
| Modrinth | `modrinth-search`, `modrinth-search-content`, `modrinth-get-mod`, `modrinth-get-versions`, `modrinth-download-mod`, `modrinth-install-modpack`, `modrinth-download-resourcepack`, `modrinth-download-shader` |
| Files | `get-minecraft-root`, `list-directory`, `get-parent-directory`, `open-file`, `show-item-in-folder`, `file-operation`, `rename-item`, `delete-items`, `create-folder`, `get-item-properties` |
| Screenshots | `get-screenshots`, `delete-screenshot`, `open-screenshots-folder` |
| Statistics | `get-stats`, `get-favorite-version` |
| Diagnostics | `check-integrity`, `clear-cache`, `optimize-settings`, `open-logs-folder`, `analyze-logs` |
| System | `get-system-info`, `get-system-memory`, `get-config`, `save-config`, `toggle-fullscreen`, `resize-launcher` |
| Other | `minimize-window`, `close-window`, `open-folder`, `save-skin`, `get-skin`, `remove-skin`, `toggle-isolation`, `get-isolation-settings`, `save-isolation-settings`, `get-running-instances`, `kill-instance`, `open-instance-folder`, `complete-first-setup`, `create-modpack-version` |

---

## How It Works

### Game Launch
1. Check for required Java version (auto-download if missing)
2. Download all Minecraft files (if not already present)
3. Download mod loader libraries (Forge/Fabric/NeoForge/Quilt)
4. Download assets
5. Build classpath from all libraries
6. Launch Java process with correct arguments
7. Capture stdout/stderr for logging
8. On termination — update statistics

### Modpack Installation
1. Download .mrpack file from Modrinth
2. Unpack modrinth.index.json
3. Determine Minecraft version and loader
4. Create isolated version folder
5. Download all mods from manifest
6. Install Overrides (configs, resource packs)
7. Configure launch profile

---

## License

MIT

---

## Author

Created with [ECHO Launcher](https://github.com/your-username/echo-launcher)
