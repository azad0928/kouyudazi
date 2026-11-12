<template><image class="profile-icon" :src="'/static/profile-icons/'+tone+'/'+name+'.png'" mode="aspectFit"/></template>
<script setup lang="ts">withDefaults(defineProps<{name:string;tone?:string}>(),{tone:'purple'});</script>
<style scoped>.profile-icon{display:block;width:100%;height:100%}</style>
