import { defineStore } from 'pinia';
export interface Progress {
  id: string;
  title: string;
  cover?: string;
  duration: number;
  position: number;
  listenedSeconds: number;
  completed: boolean;
  quizScore?: number;
  updatedAt: number;
}
export interface Preferences {
  autoScroll: boolean;
  showTranslation: boolean;
  fontSize: number;
  compact: boolean;
  speed: number;
  showVocab: boolean;
}
const KEY = 'learningStateV2';
export const useLearningStore = defineStore('learning', {
  state: () => ({
    progress: {} as Record<string, Progress>,
    preferences: {
      autoScroll: true,
      showTranslation: false,
      fontSize: 34,
      compact: false,
      speed: 1,
      showVocab: true
    } as Preferences,
    loaded: false,
    syncing: false,
    syncError: '',
    lastSync: 0
  }),
  getters: {
    recent: s => Object.values(s.progress).sort((a, b) => b.updatedAt - a.updatedAt),
    completedCount: s => Object.values(s.progress).filter(p => p.completed).length,
    totalMinutes: s => Math.floor(Object.values(s.progress).reduce((n, p) => n + p.listenedSeconds, 0) / 60)
  },
  actions: {
    load() {
      if (this.loaded) return;
      try {
        const v = uni.getStorageSync(KEY);
        if (v?.progress) this.progress = v.progress;
        if (v?.preferences) this.preferences = {
          ...this.preferences,
          ...v.preferences
        };
      } catch {}
      this.loaded = true;
    },
    save() {
      try {
        uni.setStorageSync(KEY, {
          progress: this.progress,
          preferences: this.preferences
        });
        return true;
      } catch {
        this.syncError = 'Device storage is full. Free some space and try again.';
        return false;
      }
    },
    update(lesson: any, position: number, delta = 0, ended = false) {
      this.load();
      const old = this.progress[lesson.id];
      const seconds = (old?.listenedSeconds || 0) + Math.max(0, delta);
      const duration = Number(lesson.duration) || 0;
      this.progress[lesson.id] = {
        ...old,
        id: lesson.id,
        title: lesson.title,
        cover: lesson.cover || '',
        duration,
        position: Math.min(Math.max(0, position), duration),
        listenedSeconds: seconds,
        completed: !!old?.completed || ended && seconds >= Math.min(60, duration * .5),
        updatedAt: Date.now()
      };
      this.save();
    },
    score(lesson: any, score: number) {
      this.update(lesson, this.progress[lesson.id]?.position || 0);
      this.progress[lesson.id].quizScore = score;
      this.save();
      this.sync();
    },
    preference(p: Partial<Preferences>) {
      Object.assign(this.preferences, p);
      this.save();
    },
    async sync() {
      this.load();
      if (this.syncing) return;
      this.syncing = true;
      this.syncError = '';
      try {
        const res: any = await wx.cloud.callFunction({
          name: 'userApi',
          data: {
            action: 'syncStudy',
            state: {
              progress: this.progress
            }
          }
        });
        const server = res.result?.state?.progress || {};
        for (const [id, p] of Object.entries(server) as [string, Progress][]) if (!this.progress[id] || p.updatedAt > this.progress[id].updatedAt) this.progress[id] = p;
        this.lastSync = Date.now();
        this.save();
      } catch {
        this.syncError = 'Sync unavailable. Your progress is saved on this device.';
      } finally {
        this.syncing = false;
      }
    }
  }
});
