<template><view class="sentence-progress" :style="{background:'conic-gradient(#281247 '+(fraction*360)+'deg, rgba(40,18,71,.18) 0deg)'}" role="progressbar" aria-label="Sentence playback progress" :aria-valuenow="Math.round(fraction*100)" aria-valuemin="0" aria-valuemax="100"><view class="sentence-progress-center">{{count}}</view></view></template>
<script setup lang="ts">
import {ref,computed,watch,onBeforeUnmount} from 'vue';
const props=defineProps<{elapsed:number;duration:number;running:boolean;rate:number;count:number}>();
const fraction=ref(0);
let anchor=Date.now(),elapsed=0,timer:ReturnType<typeof setInterval>|undefined;
function paint(){const extra=props.running?Math.min(.35,(Date.now()-anchor)/1000)*props.rate:0;fraction.value=Math.max(0,Math.min(1,(elapsed+extra)/Math.max(.05,props.duration)))}
watch(()=>[props.elapsed,props.duration,props.running,props.rate],()=>{anchor=Date.now();elapsed=props.elapsed;paint();if(timer)clearInterval(timer);timer=props.running?setInterval(paint,40):undefined},{immediate:true});
onBeforeUnmount(()=>{if(timer)clearInterval(timer)});
</script>
<style scoped>
.sentence-progress{width:28px;height:28px;flex:none;border-radius:50%;padding:3px;box-sizing:border-box;display:flex;align-items:center;justify-content:center;transform:rotate(0deg)}.sentence-progress-center{width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#ffcf00;border-radius:50%;color:#281247;font-size:12px;font-weight:650}
</style>
