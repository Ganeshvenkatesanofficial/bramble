#!/usr/bin/env node
// Copies docs/ai-usage/*.md (except README.md) into docs/AI_USAGE.md between markers.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'

const dir = 'docs/ai-usage'
const target = 'docs/AI_USAGE.md'
const start = '<!-- fragments:start -->'
const end = '<!-- fragments:end -->'

const parts = readdirSync(dir)
  .filter((f) => f.endsWith('.md') && f !== 'README.md')
  .sort()
  .map((f) => `### ${f.replace(/\.md$/, '')}\n\n${readFileSync(`${dir}/${f}`, 'utf8').trim()}\n`)

let text = readFileSync(target, 'utf8')
const block = `${start}\n\n## Per-agent usage\n\n${parts.join('\n')}\n${end}`
const a = text.indexOf(start)
const b = text.indexOf(end)
text = a >= 0 && b > a ? text.slice(0, a) + block + text.slice(b + end.length) : `${text.trimEnd()}\n\n${block}\n`
writeFileSync(target, text)
console.log(`combine-ai-usage: ${parts.length} fragment(s) written to ${target}`)
