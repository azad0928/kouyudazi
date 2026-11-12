from pathlib import Path
r=Path('/Users/yacheng/Documents/Work Space/kouyudazi/src')
p=r/'pages/lesson/detail.vue';s=p.read_text();Path('work/play-edge-approved/detail-before.vue').write_text(s)
for cls in ['reference-play','reading-play']:
 needle=f'<button class="{cls}"'
 assert s.count(needle)==1
 s=s.replace(needle,needle+' :class="{\'play-edge-loading\':isThisLessonLoading}"',1)
for size in ['34','32']:
 needle=f'<PlaybackGlyph :loading="isThisLessonLoading" :playing="isThisLessonPlaying" :size="{size}"/>'
 assert s.count(needle)==1
 s=s.replace(needle,needle.replace('/>',' edge-loading/>'),1)
s+='''
<style scoped>
/* Loading decoration is contained inside the existing play buttons. */
.reference-play,.reading-player .reading-play{position:relative}
.reference-play.play-edge-loading::before,.reading-play.play-edge-loading::before{content:'';position:absolute;inset:0;border-radius:50%;pointer-events:none;background:conic-gradient(from 0deg,transparent 0deg,transparent 180deg,rgba(255,207,0,.2) 225deg,#ffe666 295deg,#fff9d1 332deg,#fff 349deg,transparent 352deg);-webkit-mask:radial-gradient(farthest-side,transparent calc(100% - 3px),#000 calc(100% - 2.5px));mask:radial-gradient(farthest-side,transparent calc(100% - 3px),#000 calc(100% - 2.5px));animation:play-edge-orbit 1.5s linear infinite}
@keyframes play-edge-orbit{to{transform:rotate(360deg)}}
@media(prefers-reduced-motion:reduce){.reference-play.play-edge-loading::before,.reading-play.play-edge-loading::before{animation:none}}
</style>
'''
p.write_text(s)
p=r/'components/PlaybackGlyph.vue';s=p.read_text();Path('work/play-edge-approved/glyph-before.vue').write_text(s)
s=s.replace('v-if="loading"','v-if="loading && !edgeLoading"').replace('v-else-if="playing"','v-else-if="playing && !loading"').replace('loading?:boolean;playing?:boolean;size:number','loading?:boolean;playing?:boolean;size:number;edgeLoading?:boolean')
p.write_text(s)
