/**
 * APEX handoff helper.
 * Prepends a new SESSION LOG entry to HANDOFF.md using the latest commit.
 *
 * Usage:
 *   node scripts/handoff.mjs "Computer A (day)" "short description of what you did"
 *
 * Then edit HANDOFF.md if you need to expand safety notes, commit, and push.
 */

import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'

const [, , machineArg, ...descParts] = process.argv
if (!machineArg || descParts.length === 0) {
  console.error('Usage: node scripts/handoff.mjs "<Computer A|B (day|night)>" "<short description>"')
  process.exit(1)
}
const machine = machineArg
const desc = descParts.join(' ')

const root = process.cwd()
const file = path.join(root, 'HANDOFF.md')
if (!fs.existsSync(file)) {
  console.error('HANDOFF.md not found at', file)
  process.exit(1)
}

function sh(cmd) {
  return execSync(cmd, { cwd: root }).toString().trim()
}

const sha = sh('git log -1 --format=%h')
const subject = sh('git log -1 --format=%s')
const now = new Date()
// Dubai = UTC+4, no DST.
const dubai = new Date(now.getTime() + 4 * 3600 * 1000)
const yyyy = dubai.getUTCFullYear()
const mm = String(dubai.getUTCMonth() + 1).padStart(2, '0')
const dd = String(dubai.getUTCDate()).padStart(2, '0')
const hh = String(dubai.getUTCHours()).padStart(2, '0')
const min = String(dubai.getUTCMinutes()).padStart(2, '0')

const entry = `### ${yyyy}-${mm}-${dd} · ${hh}:${min} Dubai · ${machine}
**Commit:** \`${sha} ${subject}\`

${desc}

`

const current = fs.readFileSync(file, 'utf8')
const marker = '## SESSION LOG (newest on top)\n\n'
const i = current.indexOf(marker)
if (i === -1) {
  console.error('Could not find "SESSION LOG (newest on top)" heading in HANDOFF.md')
  process.exit(1)
}
const before = current.slice(0, i + marker.length)
const after = current.slice(i + marker.length)
fs.writeFileSync(file, before + entry + after, 'utf8')
console.log(`Prepended session log entry (${sha}) to HANDOFF.md`)
console.log('Now: review HANDOFF.md, then `git add HANDOFF.md && git commit && git push`.')
