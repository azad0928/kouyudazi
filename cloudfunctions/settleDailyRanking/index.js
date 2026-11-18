const cloud = require('wx-server-sdk');
const {key,read,legacyId,transaction}=require('./common');
cloud.init({env:cloud.DYNAMIC_CURRENT_ENV});
const db=cloud.database();
const TIME_ZONE=process.env.LEARNING_TIME_ZONE||'Asia/Shanghai';
const START_DAY='2026-11-18',MIN_MS=300000;
const REWARDS=[100,70,50,30,30,20,20,20,20,20];
function day(now){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(now));
 return ['year','month','day'].map(k=>parts.find(p=>p.type===k).value).join('-');
}
function previousDay(date,n=1){const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-n);return d.toISOString().slice(0,10)}
async function ensureCollections(){
 for(const name of ['dailyListening','rankingSettlements','users','pointLogs','messages']){
  try{await db.collection(name).where({_id:'__probe__'}).limit(1).get()}
  catch(e){if(!/COLLECTION_NOT_EXIST|collection.*not.*exist/i.test(e.message||'')&&e.errCode!==-502005)throw e;
   try{await db.createCollection(name)}catch(x){if(!/exist/i.test(x.message||''))throw x}
  }
 }
}
async function settle(date,now){
 const sid=key('rankingSettlement',TIME_ZONE,date),ref=db.collection('rankingSettlements').doc(sid);
 let snapshot=await read(ref);
 if(snapshot?.status==='complete')return {date,already:true};
 if(!snapshot){
  const result=await db.collection('dailyListening').where({date,milliseconds:db.command.gt(MIN_MS-1)})
   .orderBy('milliseconds','desc').orderBy('lastCreditAt','asc').orderBy('_id','asc').limit(10).get();
  const winners=result.data.map((x,i)=>({openid:x._openid,rank:i+1,milliseconds:x.milliseconds,points:REWARDS[i]}));
  // Freeze a single immutable result before issuing any rewards.
  snapshot=await transaction(db,async tx=>{
   const t=tx.collection('rankingSettlements').doc(sid),old=await read(t);if(old)return old;
   const data={date,timeZone:TIME_ZONE,status:'pending',minimumSeconds:300,winners,createdAt:now};await t.set({data});return data;
  });
 }
 let issued=0;
 for(const winner of snapshot.winners){
  const uid=await legacyId(db,'users',winner.openid),rid=key('dailyRankingReward',TIME_ZONE,date,winner.openid);
  const granted=await transaction(db,async tx=>{
   const log=tx.collection('pointLogs').doc(rid);if(await read(log))return false;
   const userRef=tx.collection('users').doc(uid),user=await read(userRef);
   const balance=(Number(user?.points)||0)+winner.points;
   if(user)await userRef.update({data:{points:db.command.inc(winner.points)}});
   else await userRef.set({data:{_openid:winner.openid,nickName:'Listener',points:winner.points,createdAt:now}});
   await log.set({data:{_openid:winner.openid,type:'daily_ranking_reward',change:winner.points,
    reason:'Daily leaderboard · #'+winner.rank,rankingDate:date,rank:winner.rank,seconds:Math.floor(winner.milliseconds/1000),
    balanceAfter:balance,timeZone:TIME_ZONE,createdAt:now}});
   await tx.collection('messages').doc(rid).set({data:{_openid:winner.openid,type:'daily_ranking_reward',
    title:'🏆 昨日的坚持，收到奖励啦！',
    content:'你在 '+date+' 的学习时长榜中获得第 '+winner.rank+' 名，奖励 '+winner.points+' 积分已到账。每天听一点，进步就多一点。今天继续加油！',
    read:false,rankingDate:date,rank:winner.rank,points:winner.points,pointLogId:rid,timeZone:TIME_ZONE,createdAt:now}});
   return true;
  });
  if(granted)issued++;
 }
 await ref.update({data:{status:'complete',completedAt:now}});
 return {date,issued,winners:snapshot.winners.length};
}
exports.main=async event=>{
 const ctx=cloud.getWXContext(),caller=ctx.OPENID,e=event||{};
 // Timer detection must be tolerant: deployed logs show the hourly timer arriving
 // without the canonical Type/TriggerName shape, so the strict check made every
 // invocation fail with 430 UNAUTHORIZED and rankingSettlements was never created.
 // Accept any timer casing, and treat a caller-less invocation carrying no business
 // arguments as a timer tick. A real client call always has OPENID -> rejected below.
 const type=e.Type||e.type||'';
 const isTimer=(typeof type==='string'&&type.toLowerCase()==='timer')||
  (!caller&&!e.action&&!e.importId&&!e.date&&!e.force);
 if(caller||!isTimer)throw Error('UNAUTHORIZED');
 const now=Date.now(),today=day(now);
 await ensureCollections();
 // Hourly trigger catches Beijing midnight and retries interrupted payouts.
 // Bounded seven-day recovery also covers a missed timer invocation.
 const results=[];
 for(let n=7;n>=1;n--){const date=previousDay(today,n);if(date>=START_DAY)results.push(await settle(date,now))}
 console.log('[daily-ranking-settlement]',JSON.stringify({today,timeZone:TIME_ZONE,results}));
 return {today,timeZone:TIME_ZONE,results};
};
