import { defineStore } from 'pinia';
export interface SavedVocab {
  word: string;
  pos: string;
  meaningCn: string;
  lessonId: string;
  lessonTitle: string;
  savedAt: number;
  updatedAt?: number;
  sentenceIndex?: number;
  example?: string;
  known?: boolean;
  dueAt?: number;
  reviews?: number;
  deleted?: boolean;
}
const KEY = 'savedVocab',
  norm = (w: string) => w.toLowerCase().replace(/[^a-z']/g, '');
export const useVocabStore = defineStore('vocab', {
  state: () => ({
    saved: [] as SavedVocab[],
    tombstones: [] as SavedVocab[],
    loaded: false,
    syncing: false,
    syncError: '',
    lastSync: 0
  }),
  actions: {
    load() {
      if (this.loaded) return;
      try {
        const v = uni.getStorageSync(KEY);
        this.saved = Array.isArray(v) ? v : [];
        this.tombstones = uni.getStorageSync('vocabDeletedV2') || [];
      } catch {
        this.saved = [];
      }
      this.loaded = true;
    },
    persist() {
      uni.setStorageSync(KEY, this.saved);
      uni.setStorageSync('vocabDeletedV2', this.tombstones);
    },
    isSaved(word: string) {
      this.load();
      return this.saved.some(w => norm(w.word) === norm(word));
    },
    toggle(entry: Omit<SavedVocab, 'savedAt'>) {
      this.load();
      const before = [...this.saved],
        deleted = [...this.tombstones],
        k = norm(entry.word),
        idx = this.saved.findIndex(w => norm(w.word) === k),
        now = Date.now();
      let result: boolean;
      if (idx >= 0) {
        const [w] = this.saved.splice(idx, 1);
        this.tombstones = this.tombstones.filter(x => norm(x.word) !== k);
        this.tombstones.push({
          ...w,
          deleted: true,
          updatedAt: now
        });
        result = false;
      } else {
        this.saved.push({
          ...entry,
          word: entry.word,
          savedAt: now,
          updatedAt: now,
          dueAt: now,
          reviews: 0
        });
        this.tombstones = this.tombstones.filter(x => norm(x.word) !== k);
        result = true;
      }
      try {
        this.persist();
      } catch {
        this.saved = before;
        this.tombstones = deleted;
        try {
          this.persist();
        } catch {}
        throw new Error('Unable to save this word. Try again.');
      }
      this.sync();
      return result;
    },
    review(word: string, known: boolean) {
      this.load();
      const w = this.saved.find(w => norm(w.word) === norm(word));
      if (!w) return;
      const before = {
        ...w
      };
      const n = Date.now();
      w.known = known;
      w.reviews = (w.reviews || 0) + 1;
      w.updatedAt = n;
      w.dueAt = n + (known ? Math.min(30, 2 ** Math.min(5, w.reviews)) * 86400000 : 600000);
      try {
        this.persist();
      } catch {
        Object.assign(w, before);
        uni.showToast({
          title: 'Unable to save review progress',
          icon: 'none'
        });
      }
      this.sync();
    },
    async sync() {
      this.load();
      if (this.syncing) return;
      this.syncing = true;
      this.syncError = '';
      try {
        const map: Record<string, SavedVocab> = {};
        for (const w of [...this.saved, ...this.tombstones]) map[norm(w.word)] = {
          ...w,
          updatedAt: w.updatedAt || w.savedAt
        };
        const res: any = await wx.cloud.callFunction({
          name: 'userApi',
          data: {
            action: 'syncStudy',
            state: {
              vocab: map
            }
          }
        });
        const merged: Record<string, SavedVocab> = {};
        for (const w of [...this.saved, ...this.tombstones]) merged[norm(w.word)] = {
          ...w,
          updatedAt: w.updatedAt || w.savedAt
        };
        for (const [k, w] of Object.entries(res.result?.state?.vocab || {}) as [string, SavedVocab][]) if (!merged[k] || (w.updatedAt || 0) > (merged[k].updatedAt || 0)) merged[k] = w;
        this.saved = Object.values(merged).filter(w => !w.deleted);
        this.tombstones = Object.values(merged).filter(w => w.deleted);
        this.persist();
        this.lastSync = Date.now();
      } catch {
        this.syncError = 'Sync unavailable. Your words are saved on this device.';
      } finally {
        this.syncing = false;
      }
    }
  }
});
