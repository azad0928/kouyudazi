import { reactive } from 'vue';
const CACHE_KEY = 'checkinCacheV1';
export interface CheckinResult {
  totalDays: number; todayChecked: boolean; date: string; timeZone: string;
  already?: boolean; pointsAdded?: number;
}
export const checkinState = reactive({ totalDays: 0, todayChecked: false, date: '', timeZone: '', busy: false, error: '' });
function dateInZone(timeZone: string): string | null {
  if (!timeZone) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    return ['year', 'month', 'day'].map(key => parts.find(part => part.type === key)?.value).join('-');
  } catch { return null; }
}
try {
  const cached = uni.getStorageSync(CACHE_KEY);
  if (typeof cached?.totalDays === 'number') checkinState.totalDays = cached.totalDays;
  if (cached?.timeZone && cached.date === dateInZone(cached.timeZone)) {
    checkinState.date = cached.date; checkinState.timeZone = cached.timeZone;
    checkinState.todayChecked = cached.todayChecked === true;
  }
} catch { /* Cache is optional; the server remains authoritative. */ }
let inFlight: Promise<CheckinResult | null> | null = null;
let recentSuccess: { result: CheckinResult; at: number } | null = null;
/** Page navigation reuses confirmed state; actual app entry revalidates with the server. */
export function ensureDailyCheckin(options: { revalidate?: boolean } = {}): Promise<CheckinResult | null> {
  if (inFlight) return inFlight;
  const cloud = typeof wx !== 'undefined' ? wx.cloud : undefined;
  if (!cloud?.callFunction) return Promise.resolve(null);
  const today = dateInZone(checkinState.timeZone);
  // Tab/page recreation must not restart an already confirmed check-in. If Intl is
  // unavailable, retain the in-memory foreground-session result; App.onShow still
  // revalidates on every real entry. Persisted cache alone never skips the server.
  if (!options.revalidate && recentSuccess && (today === recentSuccess.result.date || today === null)) {
    return Promise.resolve({ ...recentSuccess.result, already: true, pointsAdded: 0 });
  }
  if (today && checkinState.date !== today) checkinState.todayChecked = false;
  checkinState.busy = !checkinState.todayChecked; checkinState.error = '';
  inFlight = Promise.resolve().then(async () => {
    const response: any = await cloud.callFunction({ name: 'checkinApi', data: { action: 'checkin' } });
    const result = response?.result as CheckinResult;
    if (!result || result.todayChecked !== true || !Number.isFinite(result.totalDays) || result.totalDays < 0
      || !/^\d{4}-\d{2}-\d{2}$/.test(result.date) || !result.timeZone) throw new Error('Invalid check-in response');
    checkinState.totalDays = result.totalDays; checkinState.todayChecked = true;
    checkinState.date = result.date; checkinState.timeZone = result.timeZone;
    try { uni.setStorageSync(CACHE_KEY, { totalDays: result.totalDays, todayChecked: true, date: result.date, timeZone: result.timeZone }); }
    catch { /* A cache error must not undo successful server check-in. */ }
    recentSuccess = { result, at: Date.now() };
    return result;
  }).catch(error => { checkinState.error = 'Unable to check in. Please try again.'; throw error;
  }).finally(() => { checkinState.busy = false; inFlight = null; });
  return inFlight;
}
