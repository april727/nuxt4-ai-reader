/**
 * 卡片组合层
 *
 * 原则：标记解析（mark.detail）已经是高质量结构化内容，卡片不再重复生成，
 * 而是「解析已有的直接展示，缺的才让 AI 补」。
 *
 * 标记解析提供：音标、词性、原形、基本释义、当前语境用法、其他用法、语域色彩、配图
 * 卡片补充提供：词根拆解、同根词、近义词、趣味知识、例句（这些标记解析里没有）
 */

export interface DetailSection {
  key: string
  title: string
  body: string
}

export interface ParsedDetail {
  sections: DetailSection[]
  phonetic: string
  pos: string
  lemma: string
  meaning: string
  image: string
}

export interface CardExtras {
  phonetic?: string
  meaning?: string
  example?: string
  exampleZh?: string
  roots?: Array<{ part: string; note: string }>
  rootNote?: string
  related?: string[]
  similar?: string[]
  funFact?: { title: string; body: string }
  pos?: string
}

export interface ComposedCard {
  wordId: string
  headword: string
  lemma: string
  phonetic: string
  pos: string
  meaning: string
  context: string
  image: string
  sections: DetailSection[]
  extras: CardExtras
  /** 仍需 AI 补全的字段 */
  missing: string[]
  /** 每个字段的来源，便于前端标注与排查 */
  sources: Record<string, 'mark' | 'ai' | 'none'>
  needsAI: boolean
}

/** 章节标题 → 语义 key（兼容单词/短语/句子三种解析模板） */
const SECTION_KEYS: Record<string, string> = {
  '基本释义': 'meaning',
  '短语含义': 'meaning',
  '含义阐述': 'meaning',
  '当前语境用法': 'usage',
  '用法说明': 'usage',
  '语境分析': 'usage',
  '其他常用用法': 'otherUsage',
  '语域与色彩': 'register',
  '可替换表达': 'alternatives',
  '原形提示': 'lemma',
  '句子解析': 'structure',
  '修辞/表达分析': 'rhetoric',
  '修辞/表达手法': 'rhetoric',
  '在段落中的作用': 'role',
}

/** 解析 mark.detail：按 ### 切分章节，并提取标签与图片 */
export function parseMarkDetail(detail: string): ParsedDetail {
  const result: ParsedDetail = { sections: [], phonetic: '', pos: '', lemma: '', meaning: '', image: '' }
  if (!detail) return result

  const phonetic = detail.match(/\[PHONETIC\]\s*(\/[^/\n]+\/)\s*\[\/PHONETIC\]/)
  if (phonetic) result.phonetic = phonetic[1]
  const pos = detail.match(/\[POS\]\s*([^\[\]]+?)\s*\[\/POS\]/)
  if (pos) result.pos = pos[1].trim()
  const lemma = detail.match(/\[LEMMA\]\s*([^\[\]]+?)\s*\[\/LEMMA\]/)
  if (lemma) result.lemma = lemma[1].trim()
  const image = detail.match(/!\[[^\]]*\]\(([^)\s]+)[^)]*\)/)
  if (image) result.image = image[1]

  // 去掉标签行，避免混入最后一段正文
  const cleaned = detail
    .replace(/\[(PHONETIC|POS|LEMMA)\][\s\S]*?\[\/\1\]/g, '')
    .trim()

  const lines = cleaned.split(/\r?\n/)
  let current: DetailSection | null = null
  const push = () => {
    if (!current) return
    const body = current.body.trim()
    if (body) result.sections.push({ ...current, body })
  }

  for (const line of lines) {
    const m = line.match(/^\s*#{2,4}\s+(.+?)\s*$/)
    if (m) {
      push()
      const title = m[1].trim()
      current = { key: SECTION_KEYS[title] || title, title, body: '' }
      continue
    }
    if (current) current.body += line + '\n'
  }
  push()

  const meaningSection = result.sections.find(s => s.key === 'meaning')
  if (meaningSection) result.meaning = simplifyMeaning(meaningSection.body)

  return result
}

/** 把「基本释义」章节压成一句适合卡片展示的释义 */
function simplifyMeaning(body: string): string {
  const text = body
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\*\*/g, '')
    .replace(/^\s*\d+\s*[.、．)]\s*/gm, '')
    .replace(/^\s*[-*]\s*/gm, '')
    .replace(/\n+/g, '；')
    .replace(/；{2,}/g, '；')
    .replace(/[；;]\s*\d+\s*[.、．)]\s*/g, '；')
    .replace(/^；|；$/g, '')
    .trim()
  return text.slice(0, 160)
}

function parseExtras(raw?: string | null): CardExtras {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/** 组合成卡片视图，并算出还缺什么 */
export function buildComposedCard(word: any, type: 'word' | 'phrase' | 'sentence'): ComposedCard {
  const parsed = parseMarkDetail(word.detail || '')
  const extras = parseExtras(word.enhancement)

  const phonetic = word.phonetic || parsed.phonetic || extras.phonetic || ''
  const pos = word.pos || parsed.pos || extras.pos || ''
  const lemma = word.lemma || parsed.lemma || ''
  const rawMeaning = word.meaning || parsed.meaning || extras.meaning || ''
  // 历史释义可能带「1. 2.」编号或加粗标记，展示前统一清洗
  const meaning = /^\s*\d+\s*[.、．)]/.test(rawMeaning) || rawMeaning.includes('**')
    ? simplifyMeaning(rawMeaning)
    : rawMeaning
  const image = word.image || parsed.image || ''
  const context = word.context || ''
  const example = word.example || extras.example || ''

  const missing: string[] = []
  if (!meaning) missing.push('meaning')
  // 句子本身就是例句，不再单独要求 example
  if (type !== 'sentence' && !example) missing.push('example')
  if (type === 'word') {
    if (!extras.roots?.length) missing.push('roots')
    if (!extras.rootNote) missing.push('rootNote')
    if (!extras.related?.length) missing.push('related')
  }
  if (!extras.similar?.length) missing.push('similar')
  if (!extras.funFact?.title) missing.push('funFact')

  const sources: Record<string, 'mark' | 'ai' | 'none'> = {
    phonetic: word.phonetic ? 'mark' : parsed.phonetic ? 'mark' : extras.phonetic ? 'ai' : 'none',
    meaning: word.meaning ? 'mark' : parsed.meaning ? 'mark' : extras.meaning ? 'ai' : 'none',
    pos: word.pos ? 'mark' : parsed.pos ? 'mark' : extras.pos ? 'ai' : 'none',
    context: context ? 'mark' : 'none',
    image: image ? 'mark' : 'none',
    roots: extras.roots?.length ? 'ai' : 'none',
    related: extras.related?.length ? 'ai' : 'none',
    similar: extras.similar?.length ? 'ai' : 'none',
    funFact: extras.funFact?.title ? 'ai' : 'none',
    example: example ? 'ai' : 'none',
  }

  return {
    wordId: word.id,
    headword: word.word,
    lemma,
    phonetic,
    pos,
    meaning,
    context,
    image,
    sections: parsed.sections,
    extras: {
      ...extras,
      example,
      exampleZh: extras.exampleZh || '',
      phonetic: phonetic || undefined,
      meaning: meaning || undefined,
      pos: pos || undefined,
    },
    missing,
    sources,
    needsAI: missing.length > 0,
  }
}
