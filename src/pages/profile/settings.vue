<template><view class="settings-v3"><text class="settings-subtitle">A comfortable rhythm, your way.</text>
<text class="section-label">LISTENING</text><view class="settings-group"><view class="setting-row" @click="speed"><text>Playback speed</text><text class="setting-value">{{store.preferences.speed}}× ›</text></view><view class="setting-row"><text>Follow the audio</text><switch :checked="store.preferences.autoScroll" color="#281247" @change="change('autoScroll',$event.detail.value)"/></view></view>
<text class="section-label">READING</text><view class="settings-group"><view class="setting-row" @click="textSize"><text>Text size</text><text class="setting-value">{{store.preferences.fontSize<=28?'Small':store.preferences.fontSize<=32?'Medium':store.preferences.fontSize<=36?'Large':'Extra large'}} ›</text></view><view class="setting-row"><text>Highlight key words</text><switch :checked="store.preferences.showVocab" color="#281247" @change="change('showVocab',$event.detail.value)"/></view><view class="setting-row"><text>Translation tools</text><switch :checked="store.preferences.showTranslation" color="#281247" @change="change('showTranslation',$event.detail.value)"/></view></view>
<text class="section-label">YOUR DATA</text><view class="settings-group data-group"><view class="setting-row"><text>Saved on this device</text><button class="sync-button" :disabled="syncing" @click="sync">{{syncing?'Syncing…':'Sync now'}}</button></view><text class="help-text">{{syncMessage||store.syncError||vocab.syncError||'Keep progress and vocabulary together.'}}</text></view>
<text class="section-label">HELP & ABOUT</text><view class="settings-group"><view class="setting-row" @click="expanded=expanded==='guide'?'':'guide'"><text>How to learn</text><text class="setting-value">{{expanded==='guide'?'−':'+'}}</text></view><view v-if="expanded==='guide'" class="expanded-copy"><text>01 / Just listen</text><view>Start with an easy lesson. Hide the transcript and slow the audio down when needed.</view><text>02 / Read, then repeat</text><view>Tap words to explore their meaning. Speak along, or repeat after each sentence.</view><text>03 / Make it stick</text><view>Try the lesson questions, save new words, and come back for a quick review.</view></view><view class="setting-row" @click="expanded=expanded==='feedback'?'':'feedback'"><text>Feedback</text><text class="setting-value">{{expanded==='feedback'?'−':'+'}}</text></view><view v-if="expanded==='feedback'" class="expanded-copy">Copy a template and share it with the product team. Remove any device details you prefer not to share.<button class="sync-button feedback-button" @click="copyFeedback">Copy feedback template</button></view><view class="setting-row" @click="expanded=expanded==='privacy'?'':'privacy'"><text>Privacy & learning services</text><text class="setting-value">{{expanded==='privacy'?'−':'+'}}</text></view><view v-if="expanded==='privacy'" class="expanded-copy">Profile details, saved lessons and credits are stored in the cloud. Sync uploads progress and vocabulary to your account. Translation and practice requests send relevant text to the learning service. Imports use a speech service. Translations and practice use AI assistance and may contain errors. Scanned PDFs are not supported. Failed imports restore the applicable credit. The operator must provide a complete privacy policy before public launch.</view></view><text class="settings-footer">LISTENGLISH · LISTEN. REPEAT. LEARN.</text></view></template>
<script setup lang="ts">
import { ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
const expanded=ref('');
onLoad((query)=>{if(query?.section==='guide')expanded.value='guide'});
function textSize(){const sizes=[28,32,36,40];uni.showActionSheet({itemList:['Small','Medium','Large','Extra large'],success:r=>change('fontSize',sizes[r.tapIndex])});}
import { useLearningStore } from '@/stores/learning';
import { useVocabStore } from '@/stores/vocab';
const store = useLearningStore(),
  vocab = useVocabStore();
store.load();
vocab.load();
const syncing = ref(false),
  syncMessage = ref('');
function change(key: string, value: any) {
  store.preference({
    [key]: value
  });
}
function speed() {
  const speeds = [.5, .75, 1, 1.25, 1.5, 2];
  uni.showActionSheet({
    itemList: speeds.map(x => x + '×'),
    success: r => change('speed', speeds[r.tapIndex])
  });
}
async function sync() {
  if (syncing.value) return;
  syncing.value = true;
  await Promise.all([store.sync(), vocab.sync()]);
  syncing.value = false;
  syncMessage.value = store.syncError || vocab.syncError || 'All caught up.';
}
function copyFeedback() {
  const device = uni.getDeviceInfo();
  uni.setClipboardData({
    data: `Page:\nSteps:\nExpected:\nActual:\nDevice:${device.platform} ${device.model}\nDo not include passwords or payment details.`
  });
}
</script>
<style scoped>.settings-v3{padding:22rpx 30rpx 65rpx;background:#faf8fc;min-height:100vh;color:#32213f}.settings-subtitle{font-size:24rpx;color:#9a8ba5;display:block;margin:5rpx 0 32rpx}.section-label{display:block;font-size:19rpx;color:#a393af;letter-spacing:2rpx;margin:28rpx 4rpx 13rpx}.settings-group{background:#fff;border:1rpx solid #e9e1ee;border-radius:20rpx;padding:0 25rpx;overflow:hidden}.setting-row{display:flex;align-items:center;justify-content:space-between;min-height:94rpx;border-bottom:1rpx solid #f0eaf4;font-size:25rpx}.setting-row:last-child{border:0}.setting-value{font-size:23rpx;color:#9987a6}.setting-row switch{transform:scale(.78);transform-origin:right center}.sync-button{margin:0;background:#fff;border:1rpx solid #dcd0e6;border-radius:13rpx;color:#56386c;font-size:22rpx;padding:10rpx 23rpx;line-height:1.6}.sync-button::after{border:0}.data-group{padding-bottom:22rpx}.data-group .setting-row{border:0}.help-text{display:block;color:#a093aa;font-size:22rpx;line-height:1.6}.expanded-copy{color:#8b7c97;font-size:24rpx;line-height:1.85;padding:22rpx 0;border-bottom:1rpx solid #eee7f3}.expanded-copy>text{display:block;color:#533766;font-weight:600;margin-top:16rpx}.feedback-button{margin:20rpx 0;width:100%;background:#faf8fc}.settings-footer{display:block;text-align:center;margin:40rpx 0 0;font-size:17rpx;letter-spacing:1.5rpx;color:#b4a6bf}</style>