/**
 * 从 Turso 拉取数据到本地 reader.db
 * 运行: npx tsx scripts/pull-from-turso.ts
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

// 加载 .env
const envPath = resolve('.env')
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq === -1) continue
    process.env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim()
  }
}

// 动态导入（需在 env 加载后）
async function main() {
  const { syncFromTurso } = await import('../server/utils/sync-from-turso')
  console.log('☁️  正在从 Turso 拉取数据...')
  const result = await syncFromTurso()
  for (const [table, { inserted, skipped }] of Object.entries(result.tables)) {
    if (inserted === 0) console.log(`  ✅ ${table}: 0 新增 (${skipped} 跳过)`)
    else console.log(`  ✅ ${table}: ${inserted} 新行 (${skipped} 跳过)`)
  }
  console.log(`\n✅ 完成: ${result.totalInserted} 行已导入本地, ${result.totalSkipped} 已跳过`)
}

main().catch(err => { console.error('❌', err.message); process.exit(1) })
