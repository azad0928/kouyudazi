<template>
  <view class="lesson-cover-media" :class="{compact, 'is-ready': status==='ready'}">
    <view v-if="status==='loading'" class="cover-loading" role="status" aria-label="Loading cover">
      <image class="cover-symbol" src="/static/cover-loading.png" mode="aspectFit" />
      <text v-if="!compact" class="cover-caption">Loading cover…</text>
      <view class="cover-sweep" />
    </view>
    <image v-if="source" :key="imageRequest" :data-cover-request="imageRequest" class="cover-photo" :class="{'is-visible':status==='ready'}" :src="source" mode="aspectFill" @load="onLoad" @error="onError" />
    <view v-if="status==='failed'" class="cover-failed">
      <text v-if="!compact" class="cover-caption">Cover unavailable</text><text v-if="!compact" class="cover-error-code">{{failureStage}}</text>
      <button class="cover-retry" aria-label="Retry loading cover" @click.stop="retry">{{compact?'↻':'Try again'}}</button>
    </view>
  </view>
</template>
<script setup lang="ts">
import {ref,watch,onBeforeUnmount} from 'vue';
import {cachedCover,loadCoverSources,invalidateCover,reportCover} from '@/utils/cover';
const props=withDefaults(defineProps<{src?:string|null;compact?:boolean}>(),{compact:false});
const imageRequest=ref(0),failureStage=ref('');
const source=ref(''),status=ref<'loading'|'ready'|'failed'>('loading');
let generation=0, attempts=0, timer:ReturnType<typeof setTimeout>|undefined;
function clearTimer(){if(timer)clearTimeout(timer);timer=undefined}
async function resolveCover(){
 const token=++generation,id=props.src||'';imageRequest.value=token;failureStage.value='';
 clearTimer();source.value='';status.value='loading';
 if(!id || id==='/static/cover-default.jpg'){failureStage.value='No cover';status.value='failed';return}
 timer=setTimeout(()=>{if(token===generation){reportCover('timeout',id,'Cover not displayed within 30s',source.value);failureStage.value='Loading timed out';generation++;source.value='';status.value='failed'}},30000);
 const cached=cachedCover(id);
 if(cached){source.value=cached;return}
 try{
  let ready='';
  await loadCoverSources([id],(_id,path)=>{ready=path});
  if(token!==generation)return;
  if(ready)source.value=ready;
  else {clearTimer();failureStage.value='URL unavailable';status.value='failed'}
 }catch(error){if(token===generation){reportCover('resolve',id,error);clearTimer();failureStage.value='Unable to load';status.value='failed'}}
}
function onLoad(event:any){
 if(status.value!=='loading' || String(event?.currentTarget?.dataset?.coverRequest)!==String(imageRequest.value))return;
 clearTimer();status.value='ready';
}
function onError(event:any){
 if(status.value!=='loading' || String(event?.currentTarget?.dataset?.coverRequest)!==String(imageRequest.value))return;
 clearTimer();reportCover('image-decode',props.src||'',event?.detail?.errMsg||'Image failed to render',source.value);failureStage.value='Image unavailable';
 if(props.src?.startsWith('cloud://') && attempts++<1){invalidateCover(props.src);void resolveCover()}
 else{generation++;source.value='';status.value='failed'}
}
function retry(){attempts=0;if(props.src?.startsWith('cloud://'))invalidateCover(props.src);void resolveCover()}
watch(()=>props.src,()=>{attempts=0;void resolveCover()},{immediate:true});
onBeforeUnmount(()=>{generation++;clearTimer()});
</script>
<style scoped>
.lesson-cover-media{position:relative;display:block;width:100%;height:100%;overflow:hidden;background:#f3f0f7}
.cover-loading,.cover-failed{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:22rpx;background:#f3f0f7}
.cover-symbol{width:78rpx;height:64rpx;opacity:.65}
.cover-error-code{font-family:Arial,sans-serif;color:#91869c;font-size:11px}.cover-caption{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#91869c;font-size:23rpx;letter-spacing:.2rpx}
.cover-sweep{position:absolute;inset:0;background:linear-gradient(110deg,transparent 20%,rgba(255,255,255,.72) 45%,transparent 70%);transform:translateX(-110%);animation:cover-shimmer 2.4s ease-in-out infinite;pointer-events:none}
.cover-photo{position:absolute;inset:0;width:100%;height:100%;opacity:0;transition:opacity .24s ease}
.cover-photo.is-visible{opacity:1}
.cover-failed{z-index:1;gap:14rpx}
.cover-retry{margin:0;padding:8rpx 24rpx;line-height:1.6;font-size:22rpx;color:#675077;background:#fff;border:1rpx solid #e3dce9;border-radius:12rpx;min-height:72rpx;display:flex;align-items:center;justify-content:center}
.cover-retry::after{border:0}.compact .cover-symbol{width:42%;height:36%}.compact .cover-retry{padding:0;width:100%;height:100%;min-height:0;border:0;background:transparent;font-size:32rpx}
@keyframes cover-shimmer{0%,15%{transform:translateX(-110%)}75%,100%{transform:translateX(110%)}}
@media(prefers-reduced-motion:reduce){.cover-sweep{animation:none}.cover-photo{transition:none}}
</style>
