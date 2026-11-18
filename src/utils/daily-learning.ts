import { reactive } from 'vue';
export interface DailyLeader { rank:number; name:string; avatarIndex:number; seconds:number; isSelf?:boolean }
export interface DailyLeaderboard { date:string; timeZone:string; top:DailyLeader[]; participants:number; userRank:number|null; mySeconds:number }
export const dailyRanking=reactive({data:null as DailyLeaderboard|null,loading:false,error:''});
let rankFlight:Promise<void>|null=null,lastRankAt=0;
let sessionId='',sequence=0,totalMs=0,reportFlight:Promise<void>|null=null;
let timer:ReturnType<typeof setTimeout>|null=null,active=false,blockedUntil=0,acknowledgedMs=-1;
const cloud=()=>typeof wx!=='undefined'?wx.cloud:undefined;
export async function loadDailyLeaderboard(force=false):Promise<void>{
 if(rankFlight)return rankFlight;
 if(!force&&dailyRanking.data&&Date.now()-lastRankAt<30000)return;
 const c=cloud();if(!c?.callFunction)return;
 dailyRanking.loading=true;dailyRanking.error='';
 rankFlight=Promise.resolve().then(async()=>{try{
  const r:any=await c.callFunction({name:'leaderboardApi',data:{action:'getToday'}});const d=r?.result;
  if(!d||!Array.isArray(d.top)||!Number.isFinite(d.participants))throw Error('Invalid ranking response');
  dailyRanking.data=d;lastRankAt=Date.now();
 }catch{dailyRanking.error='榜单暂不可用，点击重试';}finally{dailyRanking.loading=false;rankFlight=null;}});
 return rankFlight;
}
export function recordDailyListening(seconds:number){
 if(active&&Number.isFinite(seconds)&&seconds>0)totalMs+=Math.round(Math.min(2,seconds)*1000);
}
export function flushDailyListening(force=false):Promise<void>{
 if(reportFlight)return reportFlight;
 const c=cloud();if(!sessionId||Date.now()<blockedUntil||!c?.callFunction||(!force&&acknowledgedMs===totalMs))return Promise.resolve();
 const payload={action:'heartbeat',sessionId,sequence:++sequence,totalMs:Math.min(86400000,totalMs)};
 reportFlight=Promise.resolve().then(async()=>{try{
  await c.callFunction({name:'leaderboardApi',data:payload});acknowledgedMs=payload.totalMs;lastRankAt=0;
 }catch{blockedUntil=Date.now()+60000;}finally{reportFlight=null;if(!active&&totalMs>payload.totalMs&&Date.now()>=blockedUntil)void flushDailyListening();}});
 return reportFlight;
}
function schedule(){if(timer)clearTimeout(timer);timer=setTimeout(()=>{timer=null;if(active){void flushDailyListening();schedule();}},10000);}
export function startDailyListening(){
 active=true;
 if(!sessionId)sessionId=Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,12);
 void flushDailyListening(true);
 schedule();
}
export function pauseDailyListening(){active=false;if(timer){clearTimeout(timer);timer=null;}void flushDailyListening();}
