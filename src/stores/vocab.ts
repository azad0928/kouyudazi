import { defineStore } from 'pinia'

/** 生词本里收藏的一条生词（来源用于以后生词本按官方课/导入课分组显示） */
export interface SavedVocab {
  word: string
  pos: string
  meaningCn: string
  lessonId: string
  lessonTitle: string
  savedAt: number
}

const STORAGE_KEY = 'savedVocab'

/** 词形归一化：小写、去标点（closet. 与 closet 视为同一词，兼容旧版带标点存的收藏） */
function normWord(w: string) {
  return w.toLowerCase().replace(/[^a-z']/g, '')
}

export const useVocabStore = defineStore('vocab', {
  state: () => ({
    saved: [] as SavedVocab[],
    loaded: false,
  }),
  actions: {
    load() {
      if (this.loaded) return
      try {
        this.saved = uni.getStorageSync(STORAGE_KEY) || []
      } catch {
        this.saved = []
      }
      this.loaded = true
    },
    isSaved(word: string) {
      this.load() // 防冷启动未加载时误判为空
      const key = normWord(word)
      return this.saved.some((s) => normWord(s.word) === key)
    },
    /** 收藏/取消收藏，返回操作后的状态（true=已收藏） */
    toggle(entry: Omit<SavedVocab, 'savedAt'>) {
      this.load() // 关键：先从存储恢复旧词，否则空数组会覆盖掉已存的生词
      const key = normWord(entry.word)
      const idx = this.saved.findIndex((s) => normWord(s.word) === key)
      let nowSaved: boolean
      if (idx >= 0) {
        this.saved.splice(idx, 1)
        nowSaved = false
      } else {
        this.saved.push({ ...entry, savedAt: Date.now() })
        nowSaved = true
      }
      try {
        uni.setStorageSync(STORAGE_KEY, this.saved)
      } catch {
        // 本地存储失败时内存里的收藏仍有效，下次进页重新加载
        return nowSaved
      }
      // 写后校验：确认真的落盘了，失败就明确提示（不再静默丢词）
      try {
        const back = uni.getStorageSync(STORAGE_KEY) || []
        if (!Array.isArray(back) || back.length !== this.saved.length) {
          try { uni.showToast({ title: '生词保存失败，请重试', icon: 'none' }) } catch {}
        }
      } catch {}
      return nowSaved
    },
  },
})
