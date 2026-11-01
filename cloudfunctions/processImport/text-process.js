// 文本处理：md 去标记、分段、分句、生词匹配（供 processImport 云函数使用）

/** md 去标记：只留正文（标题文字保留，后续可作小节标题） */
function stripMarkdown(md) {
  let s = md
  s = s.replace(/```[\s\S]*?```/g, ' ') // 代码块
  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1') // 图片
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // 链接
  s = s.replace(/`([^`]*)`/g, '$1') // 行内代码
  s = s.replace(/(\*\*|__)(.*?)\1/g, '$2') // 粗体
  s = s.replace(/(\*|_)(.*?)\1/g, '$2') // 斜体
  s = s.replace(/<[^>]+>/g, ' ') // HTML 标签
  s = s.replace(/^\s{0,3}>\s?/gm, '') // 引用
  s = s.replace(/^\s{0,3}(-{3,}|\*{3,}|_{3,})\s*$/gm, '') // 分隔线
  s = s.replace(/^\s{0,3}([-*+]|\d+[.)])\s+/gm, '') // 列表标记
  return s
}

/** 分段：空行分段；md 的 # 标题行记为下一段的小节标题 */
function splitParagraphs(text) {
  const paragraphs = []
  let pendingHeading = ''
  let buf = []
  const flush = () => {
    const joined = buf.join(' ').replace(/\s+/g, ' ').trim()
    if (joined) {
      paragraphs.push({ heading: pendingHeading || undefined, text: joined })
    }
    buf = []
    pendingHeading = ''
  }
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    const heading = line.match(/^#{1,6}\s+(.*)$/)
    if (heading) {
      flush()
      pendingHeading = heading[1].trim()
      continue
    }
    if (!line) {
      flush()
      continue
    }
    buf.push(line)
  }
  flush()
  return paragraphs
}

// 句末缩写（小写去点后）：这些词后的句点不断句；单字母大写视为首字母缩写，也不断句
const ABBREV = new Set([
  'mr', 'mrs', 'ms', 'dr', 'st', 'vs', 'etc', 'eg', 'ie', 'us', 'uk',
  'prof', 'sr', 'jr', 'no', 'fig', 'approx', 'dept', 'est', 'inc', 'ltd',
  'co', 'corp', 'ave', 'blvd', 'rd', 'ft', 'in', 'oz', 'lb', 'kg', 'km',
  'cm', 'mm', 'am', 'pm', 'a.m', 'p.m', 'u.s', 'u.k', 'e.g', 'i.e',
])

/** 英文分句：句末标点 + 空白 + 大写/数字/左引号处切分；缩写、首字母、小数不切 */
function splitSentences(paragraphText) {
  const text = paragraphText.trim()
  if (!text) return []
  const sentences = []
  let start = 0
  // 候选切点：句末标点串（含引号）+ 空白 + 下一句首字符
  const re = /([.!?…]+["”"']?)\s+(?=[A-Z0-9"“‘(])/g
  let m
  const push = (end) => {
    const s = text.slice(start, end).trim()
    if (s) sentences.push(s)
  }
  while ((m = re.exec(text)) !== null) {
    const punctEnd = m.index + m[1].length
    const before = text.slice(0, m.index)
    const wordMatch = before.match(/([A-Za-z]+(?:\.[A-Za-z]+)*)\.?$/)
    const word = wordMatch ? wordMatch[1].toLowerCase().replace(/\./g, '') : ''
    // 小数：数字.数字 不断句
    const decimal = /[0-9]\.$/.test(before)
    // 单字母大写：首字母缩写（如 J. R. R. Tolkien）不断句
    const initial = /^[A-Z]$/.test(wordMatch ? wordMatch[1] : '')
    if (ABBREV.has(word) || decimal || initial) {
      continue
    }
    push(punctEnd)
    start = m.index + m[0].length
  }
  push(text.length)
  return sentences
}

/** 词形还原（只做稳妥的几类：复数、所有格、规则动词变形；还原结果必须在词库里才算） */
function lemmatize(token, wordlist) {
  if (wordlist[token]) return token
  let cand = token
  if (cand.endsWith("'s")) cand = cand.slice(0, -2)
  if (wordlist[cand]) return cand
  if (cand.endsWith('ies') && cand.length > 3) {
    const v = cand.slice(0, -3) + 'y'
    if (wordlist[v]) return v
  }
  if (cand.endsWith('es') && cand.length > 2) {
    const v = cand.slice(0, -2)
    if (wordlist[v]) return v
  }
  if (cand.endsWith('s') && cand.length > 1) {
    const v = cand.slice(0, -1)
    if (wordlist[v]) return v
  }
  if (cand.endsWith('ing') && cand.length > 4) {
    const base = cand.slice(0, -3)
    if (wordlist[base]) return base
    if (wordlist[base + 'e']) return base + 'e'
  }
  if (cand.endsWith('ed') && cand.length > 3) {
    const base = cand.slice(0, -2)
    if (wordlist[base]) return base
    if (wordlist[base + 'e']) return base + 'e'
  }
  return null
}

/** 生词匹配：按首次出现顺序返回词表（存原文形态，详情页按原文形态标下划线） */
function matchVocab(sentences, wordlist, limit = 200) {
  const vocabWords = []
  const vocabDict = {}
  const seen = new Set()
  const wordRe = /[A-Za-z]+(?:'[a-z]+)?/g
  for (const s of sentences) {
    let wm
    while ((wm = wordRe.exec(s.text)) !== null) {
      const token = wm[0].toLowerCase()
      if (seen.has(token)) continue
      const base = lemmatize(token, wordlist)
      if (!base) continue
      seen.add(token)
      vocabWords.push(token)
      vocabDict[token] = wordlist[base]
      if (vocabWords.length >= limit) return { vocabWords, vocabDict }
    }
  }
  return { vocabWords, vocabDict }
}

module.exports = { stripMarkdown, splitParagraphs, splitSentences, matchVocab }
