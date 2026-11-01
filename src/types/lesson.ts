/** 课程相关类型定义 */

/** 课程中的一句话 */
export interface LessonSentence {
  /** 英文句子 */
  text: string
  /** 中文翻译；导入课可能没有逐句翻译，缺省时不显示译文 */
  translation?: string
  /** 开始时间（秒） */
  startTime: number
  /** 结束时间（秒） */
  endTime: number
  /** 单词级时间戳（语音对齐实测；缺省时按句内词长比例估算） */
  words?: LessonWord[]
}

/** 句子中的一个词及其在课内音频中的起止时间（秒） */
export interface LessonWord {
  /** 词本身（含原标点，如 "coat."） */
  text: string
  /** 开始时间（秒） */
  startTime: number
  /** 结束时间（秒） */
  endTime: number
}

/** 课程中的一段：小节标题 + 该段的句子数组 */
export interface LessonParagraph {
  /** 小节标题（可空） */
  heading?: string
  /** 该段的句子 */
  sentences: LessonSentence[]
}

/** 难度等级（C1/C2 暂无课程，分组筛选中已预留） */
export type LessonLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2'

/** 课程 */
export interface Lesson {
  /** 课程 id，用于详情页跳转 */
  id: string
  /** 英文标题 */
  title: string
  /** 中文标题；导入课可能没有中文标题，缺省时列表与详情不显示该行 */
  titleCn?: string
  /** 难度等级；导入课无难度等级，缺省 */
  level?: LessonLevel
  /** 封面图地址；官方课为打包的封面图（卡片顶部图），导入课列表页按标题哈希取程序化封面，不用该字段 */
  cover: string
  /** 总时长（秒） */
  duration: number
  /** 发布日期（YYYY-MM-DD；列表卡片封面下方展示） */
  date?: string
  /** 音频地址；本阶段为占位地址，接入 TTS 后替换为真实地址 */
  audioUrl: string
  /** 是否为最新课（列表页显示“新”标） */
  /** 段落数组：原文按段落整段排版，不再按句子拆卡片 */
  paragraphs: LessonParagraph[]
  /** 本课生词表（仅词本身，释义等生词卡片内容后续阶段再接）；
   * 原文渲染时按首次出现位置做黄色标记 + 角标序号 */
  vocabWords?: string[]
  /** 课程来源：官方课 / 导入课（缺省为官方课） */
  source?: 'official' | 'import'
  /** 导入课的生词释义（词 → 词性 + 中文翻译）；官方课用 mock/vocab.ts */
  vocabDict?: Record<string, { pos: string; meaningCn: string }>
}
