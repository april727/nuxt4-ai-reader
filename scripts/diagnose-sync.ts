/**
 * 诊断脚本：对比本地 sql.js 与 Turso 云端数据差异
 * 用法: npx tsx scripts/diagnose-sync.ts
 */
import 'dotenv/config'
import { createClient } from '@libsql/client'
import initSqlJs from 'sql.js'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const DB_PATH = path.resolve('server/data/reader.db')

interface TableInfo {
  name: string
  pkCol: string
  hasUpdatedAt: boolean
}

const TABLES: TableInfo[] = [
  { name: 'texts', pkCol: 'id', hasUpdatedAt: true },
  { name: 'folders', pkCol: 'id', hasUpdatedAt: false },
  { name: 'stats', pkCol: 'textId', hasUpdatedAt: false },
  { name: 'knowledge_points', pkCol: 'id', hasUpdatedAt: true },
  { name: 'wordbooks', pkCol: 'id', hasUpdatedAt: false },
  { name: 'words', pkCol: 'id', hasUpdatedAt: true },
  { name: 'daily_insights', pkCol: 'date', hasUpdatedAt: false },
]

async function main() {
  console.log('═══════════════════════════════════════════')
  console.log('  双向同步诊断')
  console.log('═══════════════════════════════════════════\n')

  // 检查配置
  const tursoUrl = process.env['TURSO_URL']
  const tursoToken = process.env['TURSO_AUTH_TOKEN']
  const useTurso = process.env['USE_TURSO']

  console.log(`USE_TURSO = ${useTurso || '(未设置)'}`)
  console.log(`TURSO_URL = ${tursoUrl ? '✓ 已配置' : '✗ 未配置'}`)
  console.log(`TURSO_AUTH_TOKEN = ${tursoToken ? '✓ 已配置' : '✗ 未配置'}`)
  console.log(`本地 DB 路径: ${DB_PATH}`)
  console.log(`本地 DB 存在: ${existsSync(DB_PATH) ? '✓' : '✗'}\n`)

  // 连接 Turso
  if (!tursoUrl || !tursoToken) {
    console.log('❌ Turso 未配置，无法继续诊断')
    return
  }

  let tursoConnected = false
  let turso: any
  try {
    turso = createClient({ url: tursoUrl, authToken: tursoToken })
    await turso.execute('SELECT 1')
    tursoConnected = true
    console.log('✓ Turso 连接成功\n')
  } catch (e: any) {
    console.log(`❌ Turso 连接失败: ${e.message}\n`)
  }

  // 加载本地 DB
  let localConnected = false
  let localDb: any
  const SQL = await initSqlJs()
  if (existsSync(DB_PATH)) {
    try {
      localDb = new SQL.Database(readFileSync(DB_PATH))
      localConnected = true
      console.log('✓ 本地 DB 加载成功\n')
    } catch (e: any) {
      console.log(`❌ 本地 DB 加载失败: ${e.message}\n`)
    }
  } else {
    console.log('❌ 本地 DB 文件不存在\n')
  }

  if (!tursoConnected || !localConnected) {
    console.log('请先确保两端都可连接后再运行诊断')
    if (localDb) localDb.close()
    return
  }

  // ─── 逐表对比 ───
  console.log('═══════════════════════════════════════════')
  console.log('  逐表数据对比')
  console.log('═══════════════════════════════════════════\n')

  for (const { name, pkCol, hasUpdatedAt } of TABLES) {
    console.log(`── ${name} ──`)

    // 获取 Turso 数据
    let tursoRows: Map<string, any> = new Map()
    let tursoColumns: string[] = []
    try {
      const r = await turso.execute(`SELECT * FROM ${name}`)
      tursoColumns = r.columns
      for (const row of r.rows) {
        const pk = String((row as any[])[0] ?? '')
        tursoRows.set(pk, row)
      }
    } catch (e: any) {
      console.log(`  Turso 查询失败: ${e.message}`)
      continue
    }

    // 获取本地数据
    let localRows: Map<string, any> = new Map()
    let localColumns: string[] = []
    try {
      const stmt = localDb.prepare(`SELECT * FROM ${name}`)
      localColumns = stmt.getColumnNames()
      while (stmt.step()) {
        const obj = stmt.getAsObject()
        const pk = String(obj[pkCol] ?? '')
        localRows.set(pk, obj)
      }
      stmt.free()
    } catch (e: any) {
      console.log(`  本地查询失败: ${e.message}`)
      continue
    }

    console.log(`  Turso: ${tursoRows.size} 行, ${tursoColumns.length} 列`)
    console.log(`  本地:  ${localRows.size} 行, ${localColumns.length} 列`)

    // 列名对比
    const tursoOnlyCols = tursoColumns.filter((c: string) => !localColumns.includes(c))
    const localOnlyCols = localColumns.filter((c: string) => !tursoColumns.includes(c))
    if (tursoOnlyCols.length > 0) console.log(`  ⚠️  仅 Turso 有列: ${tursoOnlyCols.join(', ')}`)
    if (localOnlyCols.length > 0) console.log(`  ⚠️  仅本地有列: ${localOnlyCols.join(', ')}`)

    // PK 差异
    const onlyTurso: string[] = []
    const onlyLocal: string[] = []
    const both: string[] = []

    for (const pk of tursoRows.keys()) {
      if (localRows.has(pk)) both.push(pk)
      else onlyTurso.push(pk)
    }
    for (const pk of localRows.keys()) {
      if (!tursoRows.has(pk)) onlyLocal.push(pk)
    }

    if (onlyTurso.length > 0) {
      console.log(`  📤 仅 Turso 有 (${onlyTurso.length}): ${onlyTurso.slice(0, 5).join(', ')}${onlyTurso.length > 5 ? '...' : ''}`)
    }
    if (onlyLocal.length > 0) {
      console.log(`  📥 仅本地有 (${onlyLocal.length}): ${onlyLocal.slice(0, 5).join(', ')}${onlyLocal.length > 5 ? '...' : ''}`)
    }

    // 内容差异（共同行）
    let contentDiff = 0
    const updatedAtIdx = tursoColumns.indexOf('updatedAt')
    for (const pk of both.slice(0, 100)) {  // 最多检查 100 行
      const tRow = tursoRows.get(pk)
      const lRow = localRows.get(pk)
      let diff = false
      const diffCols: string[] = []
      for (let i = 0; i < tursoColumns.length; i++) {
        const col = tursoColumns[i]
        const tVal = String((tRow as any[])[i] ?? '')
        const lVal = String(lRow[col] ?? '')
        if (tVal !== lVal) {
          diff = true
          diffCols.push(col)
        }
      }
      if (diff) {
        contentDiff++
        if (contentDiff <= 3) {
          console.log(`  🔄 内容差异 PK=${pk}: ${diffCols.join(', ')}`)
          if (hasUpdatedAt && updatedAtIdx > -1) {
            const tTime = String((tRow as any[])[updatedAtIdx] ?? '')
            const lTime = String(lRow['updatedAt'] ?? '')
            console.log(`     Turso updatedAt: ${tTime}`)
            console.log(`     本地 updatedAt:  ${lTime}`)
          }
        }
      }
    }
    if (contentDiff > 0) {
      console.log(`  🔄 内容差异共 ${contentDiff} 行${both.length > 100 ? ` (已检查 ${Math.min(both.length, 100)}/${both.length})` : ''}`)
    }
    if (onlyTurso.length === 0 && onlyLocal.length === 0 && contentDiff === 0) {
      console.log(`  ✅ 数据完全一致`)
    }
    console.log()
  }

  // ─── 汇总 ───
  console.log('═══════════════════════════════════════════')

  localDb.close()
}

main().catch(console.error)
