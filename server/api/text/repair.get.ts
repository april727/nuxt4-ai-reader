// 已迁移到 SQLite，不再需要 JSON 修复
export default defineEventHandler(() => ({ ok: true, msg: 'migrated to SQLite' }))