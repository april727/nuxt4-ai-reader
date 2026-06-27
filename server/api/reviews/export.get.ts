import { queryAll } from '../../utils/db'

export default defineEventHandler(async () => {
  const rows = await queryAll('SELECT id,title,marks FROM texts WHERE marks IS NOT NULL AND marks != \'\' AND marks != \'[]\'')
  if (!rows.length) return ''

  let csv = 'Word,Type,Phonetic,Meaning,Source\n'
  for (const row of rows) {
    const title = String(row.title || '')
    let marks = []
    try { marks = JSON.parse(String(row.marks)) } catch {}
    for (const m of marks) {
      const phonetic = (m.detail || '').match(/\[PHONETIC\]\s*(\/[^/]+\/)/)?.[1] || ''
      const brief = (m.detail || '').replace(/\[PHONETIC\].*?\[\/PHONETIC\]/g, '').replace(/[#*]/g, '').split('\n').filter((s: string) => s.trim().length > 5)[0]?.trim().slice(0, 60) || ''
      csv += `"${m.text}","${m.type}","${phonetic}","${brief}","${title}"\n`
    }
  }
  setHeader(event, 'Content-Type', 'text/csv; charset=utf-8')
  setHeader(event, 'Content-Disposition', 'attachment; filename=vocabulary.csv')
  return csv
})
