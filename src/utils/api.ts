export async function allPages(name: string, action: string, extra: any = {}) {
  let cursor = '',
    out: any[] = [];
  const seen = new Set<string>();
  do {
    const res: any = await wx.cloud.callFunction({
      name,
      data: {
        action,
        ...extra,
        cursor
      }
    });
    const r = res.result || {};
    out.push(...(r.records || r.list || []));
    cursor = r.nextCursor || '';
    if (seen.has(cursor)) throw new Error('Invalid pagination cursor');
    seen.add(cursor);
  } while (cursor);
  return out;
}
export function requestId() {
  return Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 12);
}
export function studyError(e: any) {
  const m = String(e?.errMsg || e?.message || e);
  if (m.includes('STUDY_NOT_CONFIGURED')) return 'Practice is not configured. Please contact support.';
  if(m.includes('INVALID_STUDY_CONTENT'))return 'Practice could not be prepared. Tap to retry.';
  if(m.includes('STUDY_HTTP_'))return 'Practice is unavailable. Tap to retry.';
  if (m.includes('STUDY_BUSY')) return 'This lesson is being prepared. Try again shortly.';
  if (m.includes('LESSON_NOT_FOUND')) return 'This lesson is unavailable.';
  return 'Unable to load content. Check your connection.';
}
export async function studyContent(lessonId: string, kind: string, extra: any = {}) {
  const r: any = await wx.cloud.callFunction({
    name: 'processImport',
    data: {
      action: 'study',
      lessonId,
      kind,
      ...extra
    }
  });
  if(r.result?.error){console.warn('[study]',r.result.error);throw new Error(r.result.error)}
  if(!r.result?.content)throw new Error('INVALID_STUDY_CONTENT');
  return r.result.content;
}
