#!/usr/bin/env node
// Cross-platform `pnpm setup:whisper` dispatcher.
//
//   Windows -> runs scripts/setup-whisper.ps1 (downloads a prebuilt whisper.cpp).
//   Linux   -> prints platform-appropriate install hints (apt / build-from-src).
//   macOS   -> prints platform-appropriate install hints (brew).
//
// Also downloads the `ggml-base.en.bin` model on *nix so users just need the
// whisper-cli binary on their PATH.

import { spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pkgRoot = path.resolve(__dirname, '..');

// A git checkout keeps everything under the repo (./bin/whisper, ./models),
// which is what `pnpm dev` expects. An npm / npx install must not: the package
// dir is read-only-ish and, under npx, a throwaway cache. Install into the
// same per-user dir that config.json points at instead.
const isCheckout = existsSync(path.join(pkgRoot, '.git'));
const root = isCheckout ? pkgRoot : userDataDir();

/** Mirrors getUserDataDir() in src/main/config/index.ts. */
function userDataDir() {
  if (process.platform === 'win32') {
    return path.join(
      process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
      'murmur',
    );
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'murmur');
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'murmur');
}

const MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin';

function log(msg) {
  console.log(`[setup-whisper] ${msg}`);
}

async function downloadModel(destPath) {
  mkdirSync(path.dirname(destPath), { recursive: true });
  if (existsSync(destPath)) {
    log(`model already present at ${destPath}`);
    return;
  }
  log(`downloading ggml-base.en.bin (~148 MB) -> ${destPath}`);
  const res = await fetch(MODEL_URL, { redirect: 'follow' });
  if (!res.ok || !res.body) {
    throw new Error(`download failed: HTTP ${res.status}`);
  }
  // Write to .part and rename on success so an interrupted download never
  // leaves a truncated model that the existsSync() check above would accept.
  const partPath = `${destPath}.part`;
  let total = 0;
  try {
    await pipeline(
      Readable.fromWeb(res.body),
      new Transform({
        transform(chunk, _enc, cb) {
          total += chunk.byteLength;
          cb(null, chunk);
        },
      }),
      createWriteStream(partPath),
    );
    renameSync(partPath, destPath);
  } catch (err) {
    rmSync(partPath, { force: true });
    throw err;
  }
  log(`model ready (${(total / 1024 / 1024).toFixed(1)} MB)`);
}

async function setupWindows() {
  const script = path.join(__dirname, 'setup-whisper.ps1');
  log(`running ${script}`);
  const args = ['-ExecutionPolicy', 'Bypass', '-NoProfile', '-File', script];
  if (!isCheckout) args.push('-InstallDir', root);
  const res = spawnSync('powershell', args, { stdio: 'inherit', cwd: root });
  process.exit(res.status ?? 0);
}

async function setupUnix() {
  const isMac = process.platform === 'darwin';
  log(`detected ${process.platform}${process.arch}`);

  await downloadModel(path.join(root, 'models', 'ggml-base.en.bin'));

  console.log('');
  console.log('  Next: install the whisper-cli binary on your PATH.');
  console.log('');
  if (isMac) {
    console.log('    # Homebrew (recommended):');
    console.log('    brew install whisper-cpp');
    console.log('');
    console.log('    # or build from source:');
    console.log('    git clone https://github.com/ggml-org/whisper.cpp');
    console.log('    cd whisper.cpp && cmake -B build && cmake --build build --config Release -j');
    console.log('    sudo cp build/bin/whisper-cli /usr/local/bin/whisper-cli');
  } else {
    console.log('    # build from source (works everywhere):');
    console.log('    sudo apt-get install -y build-essential cmake git');
    console.log('    git clone https://github.com/ggml-org/whisper.cpp');
    console.log('    cd whisper.cpp && cmake -B build && cmake --build build --config Release -j');
    console.log('    sudo cp build/bin/whisper-cli /usr/local/bin/whisper-cli');
  }
  console.log('');
  console.log('  Then point Murmur at the model you just downloaded:');
  console.log('');
  console.log(`    murmur --whisper-model ${path.join(root, 'models', 'ggml-base.en.bin')}`);
  console.log('');
  console.log('  Or set it permanently in the control panel (Whisper tab).');
}

async function main() {
  if (process.platform === 'win32') {
    await setupWindows();
  } else {
    await setupUnix();
  }
}

main().catch((err) => {
  console.error('[setup-whisper] failed:', err?.message ?? err);
  process.exit(1);
});
