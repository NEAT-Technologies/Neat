#!/usr/bin/env node

// `neat init <path>` — placeholder. Full implementation in M5.
const [, , cmd, target] = process.argv

if (cmd === 'init') {
  console.log(`neat init ${target ?? '<path>'} — not yet implemented (M5)`)
  process.exit(0)
}

console.log('usage: neat <command>')
console.log('commands: init <path>')
process.exit(1)
