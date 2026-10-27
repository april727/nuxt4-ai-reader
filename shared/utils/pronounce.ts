/**
 * 词形还原（前端 & 服务端共用）
 *
 * 音库只收录单词原形：catches / makes / eggs / running 全部 404，
 * 必须先把变形词还原成原形才能查到发音。
 *
 * 为什么放 shared：前端（快速发音）与服务端（批量解析）必须用**完全一致**的
 * 还原逻辑，否则会出现「服务端说能发音、前端说不能」或反之的口径不一致。
 */

/** 不规则变形表：变形 → 原形 */
export const PRON_IRREGULAR: Record<string, string> = {
  am: 'be', is: 'be', are: 'be', was: 'be', were: 'be', been: 'be', being: 'be',
  has: 'have', had: 'have', having: 'have',
  does: 'do', did: 'do', done: 'do', doing: 'do',
  went: 'go', gone: 'go', goes: 'go',
  said: 'say', says: 'say',
  made: 'make', took: 'take', taken: 'take', came: 'come',
  saw: 'see', seen: 'see', got: 'get', gotten: 'get',
  gave: 'give', given: 'give', found: 'find', told: 'tell',
  thought: 'think', knew: 'know', known: 'know',
  wrote: 'write', written: 'write',
  ate: 'eat', eaten: 'eat', ran: 'run', flew: 'fly', flown: 'fly',
  brought: 'bring', bought: 'buy', caught: 'catch', taught: 'teach',
  kept: 'keep', left: 'leave', felt: 'feel', met: 'meet',
  sat: 'sit', stood: 'stand', understood: 'understand',
  sang: 'sing', sung: 'sing', spoke: 'speak', spoken: 'speak',
  broke: 'break', broken: 'break', chose: 'choose', chosen: 'choose',
  began: 'begin', begun: 'begin', drank: 'drink', drunk: 'drink',
  grew: 'grow', grown: 'grow', threw: 'throw', thrown: 'throw',
  woke: 'wake', woken: 'wake', wore: 'wear', worn: 'wear',
  won: 'win', built: 'build', sent: 'send', spent: 'spend',
  children: 'child', men: 'man', women: 'woman', feet: 'foot', teeth: 'tooth',
  mice: 'mouse', geese: 'goose',
  "don't": 'do', "doesn't": 'do', "didn't": 'do', "can't": 'can',
  "won't": 'will', "isn't": 'be', "aren't": 'be', "wasn't": 'be', "weren't": 'be',
  "it's": 'it', "i'm": 'be', "let's": 'let', "that's": 'that', "there's": 'there',
}

/**
 * 以 ly 结尾但不是「形容词+ly」的高频词：
 * early→ear 会读错，必须白名单排除。
 */
export const PRON_ADVERB_EXCEPTIONS = [
  'early', 'only', 'family', 'reply', 'apply', 'supply', 'ally', 'fly',
  'july', 'italy', 'ugly', 'silly', 'holy', 'rely', 'imply', 'multiply',
]

/**
 * 生成候选原形，按可能性从高到低排序；对不对最终由音库裁决。
 */
export function pronCandidates(word: string): string[] {
  const w = String(word || '').toLowerCase().trim()
  if (!w) return []

  const out: string[] = []
  const push = (x: string) => {
    if (x && x.length >= 2 && !out.includes(x) && x !== w) out.push(x)
  }

  if (PRON_IRREGULAR[w]) push(PRON_IRREGULAR[w])

  if (/ies$/.test(w)) push(w.slice(0, -3) + 'y')
  if (/ves$/.test(w)) { push(w.slice(0, -3) + 'f'); push(w.slice(0, -3) + 'fe') }
  if (/(?:s|x|z|ch|sh)es$/.test(w)) push(w.slice(0, -2))
  if (/es$/.test(w)) push(w.slice(0, -2))
  if (/s$/.test(w) && !/ss$/.test(w)) push(w.slice(0, -1))

  if (/ying$/.test(w)) push(w.slice(0, -4) + 'ie')
  if (/ing$/.test(w)) {
    const stem = w.slice(0, -3)
    push(stem); push(stem + 'e')
    if (/([bdfglmnprt])\1$/.test(stem)) push(stem.slice(0, -1))
  }

  if (/ied$/.test(w)) push(w.slice(0, -3) + 'y')
  if (/ed$/.test(w)) {
    const st = w.slice(0, -2)
    push(st); push(st + 'e')
    if (/([bdfglmnprt])\1$/.test(st)) push(st.slice(0, -1))
    if (/([bdfglmnprt])\1$/.test(w.slice(0, -3))) push(w.slice(0, -3))
  }

  if (/iest$/.test(w)) push(w.slice(0, -4) + 'y')
  if (/ier$/.test(w)) push(w.slice(0, -3) + 'y')
  if (/est$/.test(w)) push(w.slice(0, -3))
  if (/er$/.test(w)) push(w.slice(0, -2))

  if (/ly$/.test(w) && w.length >= 6 && !PRON_ADVERB_EXCEPTIONS.includes(w)) push(w.slice(0, -2))

  return out
}
