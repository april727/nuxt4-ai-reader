/**
 * 配图检索「相关性判定」回归（纯函数，不联网）
 *
 * 跑法：node --experimental-strip-types server/scripts/verify-image-query.mjs
 * （Node 22 的 strip-types 让脚本可以直接 import .ts 的工具函数，不需要编译）
 *
 * 固定用例全部来自实测的失败现场，改判定逻辑时先跑一遍这里：
 *   amazon warrior woman      → 亚马逊电商 Logo（品牌折叠）
 *   female warrior women      → female（英文单词）_百度百科（词典页）
 *   muscle tension back pain  → muscle coloring pages（只认第一个词）
 *   amazon warrior women      → Amazon Warrior Women: Myth or History（正常命中）
 */
import { ACCEPT_SCORE, scoreResults, signalTokens } from '../utils/imageRelevance.ts'

const results = []
function check(name, ok, extra = '') {
  results.push({ name, ok })
  console.log(`${ok ? '  ok ' : ' FAIL'}  ${name}${extra ? '  ' + extra : ''}`)
}
const titles = (...t) => t.map(title => ({ title }))

/* 1. 判别 token 必须剔掉原词本身 */
{
  const toks = signalTokens('amazon warrior women', 'amazon')
  check('1 判别 token 剔除原词', !toks.includes('amazon') && toks.includes('warrior'), toks.join(','))
}

/* 2. 品牌折叠：标题只有 amazon 命中，总分必须低于采信线 */
{
  const s = scoreResults('amazon warrior woman', 'amazon', titles(
    'Amazon亚马逊-店小秘', '亚马逊全球购官网入口', '亚马逊海外购物网站(亚马逊海外购物攻略) | 零壹电商',
    'Amazon 的推荐系统到底行不行？ | 极客公园',
  ))
  check('2 品牌电商结果判为不相关', s.score < ACCEPT_SCORE, `score=${s.score} coverage=${s.coverage}`)
}

/* 3. 正常命中：标题同时含 warrior / women，应当直接采信 */
{
  const s = scoreResults('amazon warrior women', 'amazon', titles(
    'Amazon Warrior Women: Myth or History?', 'Amazon Warrior Women', 'Amazon Warrior Women: Myth or History?',
    'Wonder Woman (Amazon warrior women film still)',
  ))
  check('3 正确结果直接采信', s.score >= ACCEPT_SCORE && s.distinct >= 2, `score=${s.score} distinct=${s.distinct}`)
}

/* 4. 词典/百科页：token 全中也不能算相关 */
{
  const s = scoreResults('female warrior women', 'amazon', titles(
    '♀（文化术语）_百度百科', 'female（英文单词）_百度百科', 'female（英文单词）_百度百科', 'female（英文单词）_百度百科',
  ))
  check('4 词典百科页判为不相关', s.score < ACCEPT_SCORE, `score=${s.score} junk=${s.junk}`)
}

/* 5. 只命中第一个词：coverage 满分但要打折，够不到采信线 */
{
  const s = scoreResults('muscle tension back pain', 'strain', titles(
    'Printable Muscle Coloring Pages', 'Human Muscles Front View Worksheet coloring pages',
    'Human Body Muscles Coloring Muscle Anatomy', '65 Muscle Coloring Pages - Free Printable Sheets',
  ))
  check('5 只命中单个词时打折', s.score < ACCEPT_SCORE, `score=${s.score} coverage=${s.coverage} distinct=${s.distinct}`)
}

/* 6. 两个词都命中：正常采信（防止打折过头，把好结果也毙掉） */
{
  const s = scoreResults('rainy street empty', 'dreary', titles(
    'Downtown on rainy day stock photography', 'Empty rainy street at night', 'Rainy street in the old town',
    'Empty rainy street at dawn',
  ))
  check('6 多词命中正常采信', s.score >= ACCEPT_SCORE, `score=${s.score} distinct=${s.distinct}`)
}

/* 7. 标题缺失（Bing 偶发只给图）不能误杀，但也不能当满分采信 */
{
  const s = scoreResults('warrior women spears', 'amazon', [{ title: '' }, { title: '' }])
  check('7 无标题时给中间分', s.judged === false && s.score > 0 && s.score < ACCEPT_SCORE, `score=${s.score}`)
}

/* 8. 原词与检索词完全一致（用户手打），没有判别 token 时不该拦 */
{
  const s = scoreResults('amazon', 'amazon', titles('Amazon river', 'Amazon rainforest'))
  check('8 检索词等于原词时放行', s.score === 1, `score=${s.score}`)
}

const bad = results.filter(r => !r.ok)
console.log(`\n${results.length - bad.length}/${results.length} 通过`)
if (bad.length) {
  console.log('失败项：' + bad.map(b => b.name).join(' / '))
  process.exit(1)
}
