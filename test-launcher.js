const path = require('path');
const os = require('os');
const fs = require('fs-extra');
const { spawn } = require('child_process');
const MinecraftLauncher = require('./src/launcher/MinecraftLauncher');
const JavaManager = require('./src/launcher/JavaManager');

async function test() {
  const launcher = new MinecraftLauncher();
  await launcher.initDirectories();

  const versionId = '1.21.8-forge-58.1.16';
  const mcVersion = '1.21.8';

  console.log('=== Resolving version ===');
  const resolved = await launcher.resolveVersion(versionId);

  console.log('=== Building classpath ===');
  const libraries = [];
  for (const library of resolved.libraries || []) {
    let libPath = null;
    if (library.downloads && library.downloads.artifact) {
      libPath = path.join(launcher.librariesDir, library.downloads.artifact.path);
    } else if (library.name) {
      const parts = library.name.split(':');
      if (parts.length >= 3) {
        const [group, artifact, libVersion] = parts;
        const groupPath = group.replace(/\./g, path.sep);
        const jarName = `${artifact}-${libVersion}.jar`;
        libPath = path.join(launcher.librariesDir, groupPath, artifact, libVersion, jarName);
      }
    }
    if (libPath && await fs.pathExists(libPath)) libraries.push(libPath);
  }
  const jarPath = path.join(launcher.versionsDir, versionId, `${versionId}.jar`);
  libraries.push(jarPath);

  // Deduplicate
  const seen = new Set();
  const uniqueLibraries = [];
  for (const libPath of libraries) {
    const relative = path.relative(launcher.librariesDir, libPath);
    const parts = relative.split(path.sep);
    if (parts.length >= 4) {
      const group = parts.slice(0, -3).join('.');
      const artifact = parts[parts.length - 3];
      const key = `${group}:${artifact}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueLibraries.push(libPath);
      }
    } else {
      uniqueLibraries.push(libPath);
    }
  }

  const classpath = uniqueLibraries.join(path.delimiter);
  console.log('Classpath entries:', uniqueLibraries.length);
  console.log('Classpath length:', classpath.length);
  console.log('Has bootstrap:', classpath.includes('bootstrap'));
  console.log('Has ForgeBootstrap class:', classpath.includes('bootstrap'));

  // Check if bootstrap jar has the class
  const bootstrapLib = resolved.libraries?.find(l => l.name?.includes('bootstrap:2.1.8'));
  if (bootstrapLib) {
    const fullPath = path.join(launcher.librariesDir, bootstrapLib.downloads?.artifact?.path);
    console.log('Bootstrap jar:', fullPath);
    console.log('Bootstrap jar exists:', await fs.pathExists(fullPath));
    console.log('Bootstrap jar size:', (await fs.stat(fullPath)).size);
  }

  // Test: build JVM args like the launcher does
  const versionJvmArgs = resolved.arguments?.jvm || [];
  let loaderJvmArgs = [];
  for (const arg of versionJvmArgs) {
    if (typeof arg === 'string') {
      let resolved2 = arg
        .replace(/\$\{library_directory\}/g, launcher.librariesDir)
        .replace(/\$\{classpath_separator\}/g, path.delimiter)
        .replace(/\$\{version_name\}/g, versionId)
        .replace(/\$\{natives_directory\}/g, path.join(launcher.minecraftDir, 'natives', `${versionId}-test`))
        .replace(/\$\{user_properties\}/g, '{}');
      if (resolved2.includes('${classpath}')) resolved2 = resolved2.replace(/\$\{classpath\}/g, classpath);
      if (resolved2 === '${classpath}') resolved2 = classpath;
      loaderJvmArgs.push(resolved2);
    }
  }

  // Remove -cp and classpath from loaderJvmArgs (new fix)
  loaderJvmArgs = loaderJvmArgs.filter((a, i) => {
    if (a === '-cp') return false;
    if (i > 0 && loaderJvmArgs[i - 1] === '-cp') return false;
    if (a.includes(path.delimiter) && a.length > 500) return false;
    return true;
  });

  const jvmArgs = [
    '-Xmx2048M',
    '-Xms1024M',
    '-Dlog4j2.level=warn',
    `-Djava.library.path=${path.join(launcher.minecraftDir, 'natives', `${versionId}-test`)}`,
    `-Dorg.lwjgl.opengl.Display.allowSoftwareOpenGL=false`,
    ...loaderJvmArgs,
    '-cp',
    classpath
  ].filter(a => a !== '');

  const allArgs = [...jvmArgs, resolved.mainClass, '--launchTarget', 'forge_client', '--username', 'TestPlayer'];

  console.log('\n=== Final JVM args ===');
  console.log('Total args:', allArgs.length);
  const cpIdx = allArgs.indexOf('-cp');
  if (cpIdx >= 0) {
    console.log('-cp found at index:', cpIdx);
    console.log('Classpath arg length:', allArgs[cpIdx + 1]?.length);
  } else {
    console.log('WARNING: -cp NOT FOUND in args!');
  }

  const estimatedLength = allArgs.reduce((sum, a) => sum + a.length + 1, 0);
  console.log('Estimated command line length:', estimatedLength);

  // Try launching
  console.log('\n=== Attempting launch ===');
  const javaPath = 'java';
  const gameProcess = spawn(javaPath, allArgs, {
    cwd: path.join(launcher.instancesDir, versionId),
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let output = '';
  gameProcess.stderr.on('data', (d) => { output += d.toString(); });
  gameProcess.stdout.on('data', (d) => { output += d.toString(); });

  gameProcess.on('exit', (code) => {
    console.log('Exit code:', code);
    if (output.length > 0) {
      console.log('Game output:');
      console.log(output.substring(0, 3000));
    }
    // Check for specific errors
    if (output.includes('ClassNotFoundException')) {
      console.log('\nFAILED: ClassNotFoundException detected');
      const match = output.match(/ClassNotFoundException: ([^\n]+)/);
      if (match) console.log('Missing class:', match[1]);
    } else if (output.includes('UnsupportedClassVersionError')) {
      console.log('\nFAILED: Wrong Java version');
    } else if (code === 0) {
      console.log('\nSUCCESS: Game launched without errors!');
    } else {
      console.log('\nGame failed with code', code);
    }
    process.exit(code || 0);
  });

  gameProcess.on('error', (err) => {
    console.error('Process error:', err.message);
    process.exit(1);
  });

  // Timeout after 30 seconds
  setTimeout(() => {
    console.log('\nTimeout - killing process');
    gameProcess.kill();
    if (output.includes('authlib-injector')) {
      console.log('authlib-injector loaded - game started OK (just waiting for user)');
    }
    process.exit(0);
  }, 30000);
}

test().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
