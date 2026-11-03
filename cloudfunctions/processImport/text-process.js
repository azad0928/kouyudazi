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

/**
 * PDF 提取文本清洗（pdf.js 输出的是「视觉行」，不是段落）
 * - pdf.js 每行按版面宽度补空格，行尾空白会把「空行」变成「只有空格的行」→ 必须先按行 trim
 * - 行尾硬换行会把一句话切碎：单个换行折成空格，空行保留为段落分隔
 * - 行末连字符（exam-⏎ple）是排版断词，直接拼回；后半个词首字母大写时视为真复合词保留连字符
 * - 去掉软连字符 / 零宽字符 / BOM，压缩多余空格
 * - 去掉纯页码行（1 / - 3 - / Page 4 of 9），这类行会被分句器当成一句话
 */
function normalizePdfText(raw) {
  let s = String(raw || '')
  s = s.replace(/\r\n?/g, '\n')
  s = s.replace(/[\u00ad\u200b\u200c\u200d\ufeff]/g, '')
  // 逐行 trim：不做这一步，下面的「空行 = 段落」判断永远不成立
  s = s
    .split('\n')
    .map((line) => line.replace(/[ \t\u00a0]+/g, ' ').trim())
    .join('\n')
  // 行末连字符：PDF 里绝大多数是排版断词（exam-⏎ple → example）；
  // 后半个词首字母大写（Anglo-⏎Saxon）多为真连字符，保留
  s = s.replace(/([A-Za-z]{2,})-\n([A-Za-z]{2,})/g, (m, a, b) => (/^[A-Z]/.test(b) ? `${a}-${b}` : a + b))
  s = s.replace(/^(?:[-–—]\s*)?(?:page\s*)?\d{1,4}(?:\s*(?:of|\/)\s*\d{1,4})?\s*(?:[-–—])?$/gim, '')
  s = s.replace(/\n{3,}/g, '\n\n')
  // 单个换行 = 版面上的折行 → 空格；连续空行保留为段落分隔
  s = s.replace(/([^\n])\n(?!\n)/g, '$1 ')
  return s.trim()
}

/**
 * 分段：空行分段；md 的 # 标题行记为下一段的小节标题
 * @param {string} text
 * @param {{ bareHeadings?: boolean }} [opts]
 *   bareHeadings=true 用于 PDF：独占一行、短、且不以句末标点结尾的行当标题
 *   （PDF 里的文章标题/章节名就是这样，不识别会被当句子读出来）
 */
function splitParagraphs(text, opts) {
  const bareHeadings = !!(opts && opts.bareHeadings)
  const paragraphs = []
  let pendingHeading = ''
  let buf = []
  const flush = () => {
    const joined = buf.join(' ').replace(/\s+/g, ' ').trim()
    if (joined) {
      paragraphs.push({ heading: pendingHeading || undefined, text: joined })
      // 只有真的产出段落才清掉标题：标题后面常跟一个空行，
      // 之前的写法会在空行 flush 时把标题丢掉（md/pdf 都中招）
      pendingHeading = ''
    }
    buf = []
  }
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
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
    // PDF 裸标题：短、无句末标点、下一行为空行（或已是最后一行）
    if (bareHeadings) {
      const nextBlank = i + 1 >= lines.length || !lines[i + 1].trim()
      const noEndPunct = !/[.!?…:;。！？：；]$/.test(line)
      const wordCount = line.split(/\s+/).length
      if (nextBlank && noEndPunct && line.length <= 60 && wordCount <= 10) {
        flush()
        pendingHeading = line
        continue
      }
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
    const rawWord = wordMatch ? wordMatch[1] : ''
    const word = rawWord.toLowerCase().replace(/\./g, '')
    // 小数：数字.数字 不断句
    const decimal = /[0-9]\.$/.test(before)
    // 单字母大写：首字母缩写（如 J. R. R. Tolkien）不断句
    const initial = /^[A-Z]$/.test(rawWord)
    // 缩写只认「带点」（u.s / e.g）或「含大写」（Mr / US / Ltd）的原词：
    // 全小写无点的词不进缩写判断——否则代词 us（"work with us." Tom...）、
    // no、in 这些普通词会被误当缩写，整句切不开，时间轴出现好几秒的长句
    const abbrev = ABBREV.has(word) && (rawWord.includes('.') || /[A-Z]/.test(rawWord))
    if (abbrev || decimal || initial) {
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

module.exports = { stripMarkdown, normalizePdfText, splitParagraphs, splitSentences, matchVocab }
