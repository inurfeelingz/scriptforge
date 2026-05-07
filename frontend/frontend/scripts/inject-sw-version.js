// frontend/scripts/inject-sw-version.js
// Runs before every build — injects git commit hash into sw.js
// so the browser always detects a changed SW on deploy.
// No manual version bumping ever again.

import { execSync } from 'child_process'
import { readFileSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

let hash
try {
  hash = execSync('git rev-parse --short HEAD', { stdio: ['pipe','pipe','pipe'] })
    .toString().trim()
} catch {
  hash = Date.now().toString(36)
}

const version = `wc-${hash}`
const swPath  = resolve(__dirname, '../public/sw.js')
let   src     = readFileSync(swPath, 'utf8')

src = src.replace(
  /const CACHE_VERSION = '[^']*'/,
  `const CACHE_VERSION = '${version}'  // auto: ${new Date().toISOString()}`
)

writeFileSync(swPath, src)
console.log(`[sw] Version injected: ${version}`)
