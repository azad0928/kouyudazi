import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { Lesson } from '@/types/lesson';
import { getLocalAudio, cacheAudioLocally, dropLocalAudio } from '@/utils/audio-cache';
import { useLearningStore } from './learning';
import {startDailyListening,pauseDailyListening,recordDailyListening} from '@/utils/daily-learning';

// Normal listening uses the system player; sentence practice stays in the foreground.
export const useAudioStore = defineStore('audio', () => {
  const currentLesson = ref<Lesson | null>(null),
    playing = ref(false),
    audioLoading = ref(false),
    currentTime = ref(0),
    rawCurrentTime = ref(0),
    duration = ref(0),
    seekTarget = ref<number | null>(null),
    speed = ref(1),
    muted = ref(false),
    endedCount = ref(0),
    practiceMode = ref(false),
    articleLoop = ref(false);
  let background = false, sessionReady = false, wiredInterruption = false;
  let playerEpoch = 0;
  let interruption: {version: number; lessonId: string; position: number} | null = null;
  function wireInterruptions() {
    if (wiredInterruption || typeof wx === 'undefined') return;
    wiredInterruption = true;
    const api = wx as any;
    api.onAudioInterruptionBegin?.(() => {
      const resume = !practiceMode.value && (playing.value || audioLoading.value);
      const position = Number(player?.currentTime) || rawCurrentTime.value;
      const lessonId = currentLesson.value?.id;
      pause();
      if (resume && lessonId) interruption = {version, lessonId, position};
    });
    api.onAudioInterruptionEnd?.(() => {
      const pending = interruption;
      interruption = null;
      if (pending && pending.version === version && pending.lessonId === currentLesson.value?.id && !practiceMode.value && !playing.value) void start(pending.position);
    });
  }
  const displayTime = computed(() => Math.max(0, rawCurrentTime.value - (currentLesson.value?.source === 'import' ? .15 : .12)));
  let player: any = null,
    version = 0,
    active = false,
    lastTick = 0,
    lastSave = 0,
    ended = false;
  const urls = new Map<string, {
      url: string;
      at: number;
    }>(),
    pending = new Map<string, Promise<string | null>>();
  const study = () => {
    const s = useLearningStore();
    s.load();
    return s;
  };
  function save(delta = 0, finished = false) {
    if (currentLesson.value) study().update(currentLesson.value, rawCurrentTime.value, delta, finished);
  }
  // WeChat uses global audio options on iOS; the instance property alone is insufficient.
  function configureSilentModePlayback(): Promise<void> {
    return new Promise(resolve => {
      const api = typeof wx !== 'undefined' ? wx : undefined;
      if (!api || typeof api.setInnerAudioOption !== 'function') {
        resolve();
        return;
      }
      try {
        api.setInnerAudioOption({
          obeyMuteSwitch: false,
          fail: error => console.warn('[audio] Unable to configure silent-mode playback', error.errMsg),
          complete: () => resolve()
        });
      } catch (error) {
        console.warn('[audio] Unable to configure silent-mode playback', error);
        resolve();
      }
    });
  }
  let detach: Array<() => void> = [];
  function ensure() {
    if (player) return player;
    background = !practiceMode.value && typeof uni.getBackgroundAudioManager === 'function';
    const p: any = background ? uni.getBackgroundAudioManager() : uni.createInnerAudioContext();
    player = p;
    const epoch = ++playerEpoch;
    wireInterruptions();
    function bind(event: string, callback: (...args: any[]) => void) {
      p['on' + event]?.(callback);
      detach.push(() => p['off' + event]?.(callback));
    }
    if (!background) {
      p.obeyMuteSwitch = false;
      p.volume = muted.value ? 0 : 1;
    }
    p.playbackRate = speed.value;
    bind('Play', () => {
      if (player !== p || epoch !== playerEpoch) return;
      if (!active && background && sessionReady) active = true;
      if (!active) {
        p.pause();
        return;
      }
      playing.value = true;
      startDailyListening();
      audioLoading.value = false;
      lastTick = Date.now();
    });
    bind('Waiting', () => {
      if (player !== p || epoch !== playerEpoch) return;
      if (active) audioLoading.value = true;
      lastTick = 0;
    });
    bind('Pause', () => {
      if (player !== p || epoch !== playerEpoch) return;
      save(unflushed);
      unflushed = 0;
      pauseDailyListening();
      playing.value = false;
      audioLoading.value = false;
      lastTick = 0;
    });
    bind('Stop', () => {
      if (player !== p || epoch !== playerEpoch) return;
      save(unflushed);
      unflushed = 0;
      pauseDailyListening();
      playing.value = false;
      audioLoading.value = false;
      lastTick = 0;
    });
    bind('TimeUpdate', () => {
      if (player !== p || epoch !== playerEpoch) return;
      if (!active) return;
      const t = Number(p.currentTime) || 0;
      if (seekTarget.value !== null && Math.abs(t - seekTarget.value) > 1) return;
      seekTarget.value = null;
      const now = Date.now();
      const wallSeconds = playing.value && lastTick ? Math.max(0, Math.min(2, (now - lastTick) / 1000)) : 0;
      recordDailyListening(wallSeconds);
      const delta = wallSeconds * speed.value;
      lastTick = now;
      currentTime.value = Math.floor(t);
      rawCurrentTime.value = t;
      audioLoading.value = false;
      if (now - lastSave > 3000) {
        save(delta + unflushed);
        unflushed = 0;
        lastSave = now;
      } else unflushed += delta;
    });
    bind('Seeked', () => {
      if (!active) return;
      seekTarget.value = null;
      lastTick = Date.now();
    });
    bind('Ended', () => {
      if (player !== p || epoch !== playerEpoch) return;
      pauseDailyListening();
      if (!active) return;
      playing.value = false;
      audioLoading.value = false;
      rawCurrentTime.value = duration.value;
      currentTime.value = duration.value;
      ended = true;
      save(unflushed, true);
      unflushed = 0;
      endedCount.value++;
      study().sync();
      if (articleLoop.value && !practiceMode.value) void start(0);
    });
    bind('Error', () => {
      if (player !== p || epoch !== playerEpoch) return;
      pauseDailyListening();
      if (!active) return;
      version++;
      active = false;
      playing.value = false;
      audioLoading.value = false;
      if (currentLesson.value) {
        urls.delete(currentLesson.value.id);
        dropLocalAudio(currentLesson.value.audioUrl);
      }
      uni.showToast({
        title: '音频加载失败，请重试',
        icon: 'none'
      });
    });
    return p;
  }
  let unflushed = 0;
  async function resolveSrc(lesson: Lesson, download = false): Promise<string | null> {
    const src = lesson.audioUrl;
    if (!src) return null;
    if (!src.startsWith('cloud://')) return src;
    const local = practiceMode.value || typeof uni.getBackgroundAudioManager !== 'function' ? await getLocalAudio(src) : null;
    if (local) return local;
    const hit = urls.get(lesson.id);
    if (hit && Date.now() - hit.at < 10 * 60000) {
      if (download) cacheAudioLocally(src, hit.url).catch(() => {});
      return hit.url;
    }
    if (pending.has(src)) return pending.get(src)!;
    const p = (async () => {
      try {
        const r: any = await wx.cloud.callFunction({
          name: 'getAudioUrl',
          data: {
            fileID: src
          }
        });
        const url = r.result?.tempFileURL;
        if (!url) return null;
        urls.set(lesson.id, {
          url,
          at: Date.now()
        });
        if (download) cacheAudioLocally(src, url).catch(() => {});
        return url;
      } catch {
        return null;
      } finally {
        pending.delete(src);
      }
    })();
    pending.set(src, p);
    return p;
  }
  function primeLessonSrc(id: string, url: string) {
    if (url) urls.set(id, {
      url,
      at: Date.now()
    });
  }
  function warmLesson(l: Lesson) {
    return resolveSrc(l);
  }
  function prefetchLesson(l: Lesson) {
    resolveSrc(l).catch(() => {});
  }
  async function prefetchLessons(list: Lesson[]) {
    await Promise.all(list.slice(0, 3).map(warmLesson));
  }
  function pause() {
    interruption = null;
    version++;
    active = false;
    save(unflushed);
    unflushed = 0;
    if (player) player.pause();
    playing.value = false;
    audioLoading.value = false;
    seekTarget.value = null;
    lastTick = 0;
  }
  function stop() {
    sessionReady = false;
    pause();
    if (player) {
      player.stop();
      player.src = '';
    }
    study().sync();
  }
  function loadLesson(lesson: Lesson) {
    stop();
    articleLoop.value = false;
    currentLesson.value = lesson;
    duration.value = lesson.duration;
    const p = study().progress[lesson.id];
    const position = p?.completed ? 0 : Math.min(p?.position || 0, Math.max(0, lesson.duration - .5));
    rawCurrentTime.value = position;
    currentTime.value = Math.floor(position);
    speed.value = study().preferences.speed;
    ended = false;
    articleLoop.value = false;
  }
  async function start(at: number) {
    const l = currentLesson.value;
    if (!l) return;
    const request = ++version;
    active = true;
    audioLoading.value = true;
    const src = await resolveSrc(l, true);
    if (request !== version || !active || currentLesson.value?.id !== l.id) return;
    if (!src) {
      active = false;
      audioLoading.value = false;
      uni.showToast({
        title: '音频加载失败，点播放重试',
        icon: 'none'
      });
      return;
    }
    await configureSilentModePlayback();
    // Pause/navigation can happen while the native audio settings are being applied.
    if (request !== version || !active || currentLesson.value?.id !== l.id) return;
    const p = ensure();
    sessionReady = true;
    if (background) {
      p.title = l.title;
      p.singer = '口语搭子';
      p.epname = '沉浸听读';
      p.coverImgUrl = /^https:\/\//.test(l.cover || '') ? l.cover : '';
    }
    if (!background) p.obeyMuteSwitch = false;
    p.playbackRate = speed.value;
    const target = Math.max(0, Math.min(at, Math.max(0, duration.value - .05)));
    ended = false;
    seekTarget.value = target;
    rawCurrentTime.value = target;
    currentTime.value = Math.floor(target);
    lastTick = 0;
    if (p.src !== src) {
      p.startTime = target;
      p.src = src;
    } else p.seek(target);
    p.play();
  }
  async function toggle() {
    if (playing.value || audioLoading.value) {
      pause();
      return;
    }
    await start(ended ? 0 : rawCurrentTime.value);
  }
  async function playLesson(l: Lesson) {
    if (currentLesson.value?.id !== l.id) loadLesson(l);
    await start(rawCurrentTime.value);
  }
  async function playFrom(seconds: number) {
    await start(seconds);
  }
  function seek(seconds: number) {
    const target = Math.max(0, Math.min(seconds, duration.value));
    rawCurrentTime.value = target;
    currentTime.value = Math.floor(target);
    if (playing.value) {
      void start(target);
    } else {
      version++;
      active = false;
      if (player?.src) player.seek(target);
      save();
    }
    ended = target >= duration.value;
  }
  function setPracticeMode(value: boolean) {
    if (practiceMode.value === value) return;
    const resume = playing.value || audioLoading.value;
    pause();
    const old = player;
    detach.forEach(fn => fn());
    detach = [];
    player = null;
    sessionReady = false;
    old?.stop();
    if (!background) old?.destroy?.();
    practiceMode.value = value;
    if (value) articleLoop.value = false;
    if (resume) void start(rawCurrentTime.value);
  }
  function leavePage() {
    if (practiceMode.value) pause();
  }
  function setMuted(value:boolean){muted.value=value;if(player)player.volume=value?0:1}
  function setSpeed(value: number) {
    if (![.5, .75, 1, 1.25, 1.5, 2].includes(value)) return;
    speed.value = value;
    study().preference({
      speed: value
    });
    if (player) player.playbackRate = value;
  }
  return {
    practiceMode,
    articleLoop,
    setPracticeMode,
    leavePage,
    currentLesson,
    playing,
    audioLoading,
    currentTime,
    rawCurrentTime,
    duration,
    seekTarget,
    displayTime,
    speed,
    endedCount,
    resolveSrc,
    primeLessonSrc,
    warmLesson,
    prefetchLesson,
    prefetchLessons,
    loadLesson,
    playLesson,
    playFrom,
    toggle,
    pause,
    stop,
    seek,
    setSpeed,
    muted,
    setMuted
  };
});
