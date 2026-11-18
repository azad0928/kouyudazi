const cloud = require('wx-server-sdk');
const {key, read, transaction} = require('./common');
cloud.init({env:cloud.DYNAMIC_CURRENT_ENV});
const db=cloud.database(),COL='dailyListening';
const TIME_ZONE=process.env.LEARNING_TIME_ZONE || 'Asia/Shanghai';
function serverDay(now){
 const p=new Intl.DateTimeFormat('en-CA',{timeZone:TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(now));
 return ['year','month','day'].map(k=>p.find(x=>x.type===k).value).join('-');
}
async function ensureCollection(){
 try{await db.collection(COL).where({date:'__probe__'}).limit(1).get()}
 catch(e){if(!/COLLECTION_NOT_EXIST|collection.*not.*exist/i.test(e.message||'') && e.errCode!==-502005)throw e;
  try{await db.createCollection(COL)}catch(createError){if(!/exist/i.test(createError.message||''))throw createError}
 }
}
async function publicProfile(openid,isSelf){
 const r=await db.collection('users').where({_openid:openid}).limit(1).get();const u=r.data[0]||{};
 const avatarIndex=Math.max(0,Math.min(11,Number(u.avatarIndex)||0));
 return {name:String(u.nickName||'Listener').slice(0,20),avatarIndex,isSelf};
}
exports.main=async event=>{
 const openid=cloud.getWXContext().OPENID;if(!openid)throw Error('UNAUTHORIZED');
 const now=Date.now(),date=serverDay(now),id=key('daily',date,openid),ref=db.collection(COL).doc(id);
 if(!['heartbeat','getToday'].includes(event?.action))throw Error('UNKNOWN_ACTION');
 await ensureCollection();
 if(event.action==='heartbeat'){
  const sid=String(event.sessionId||''),sequence=Number(event.sequence),total=Number(event.totalMs);
  if(!/^[a-z0-9-]{8,80}$/.test(sid)||!Number.isSafeInteger(sequence)||sequence<1||!Number.isSafeInteger(total)||total<0||total>86400000)throw Error('INVALID_HEARTBEAT');
  const token=key(sid);
  const result=await transaction(db,async tx=>{
   const r=tx.collection(COL).doc(id),old=await read(r),seen=old?.sessions?.[token];
   if(seen&&sequence<=seen.sequence)return {milliseconds:old.milliseconds,duplicate:true};
   // New sessions establish a baseline; only subsequent observed playback counts.
   const increment=seen?Math.max(0,total-seen.totalMs):0;
   const elapsed=old?Math.max(0,now-(old.observedAt||old.lastCreditAt)-(old.milliseconds||0)):0;
   const credited=Math.min(increment,elapsed,60000);
   const sessions={...(old?.sessions||{}),[token]:{sequence,totalMs:Math.max(total,seen?.totalMs||0),at:now}};
   const compact=Object.fromEntries(Object.entries(sessions).sort((a,b)=>b[1].at-a[1].at).slice(0,128));
   const milliseconds=(old?.milliseconds||0)+credited;
   await r.set({data:{_openid:openid,date,milliseconds,observedAt:old?.observedAt||now,lastCreditAt:credited>0?now:(old?.lastCreditAt||now),sessions:compact,updatedAt:now}});
   return {milliseconds,creditedMs:credited,duplicate:false};
  });
  return {date,timeZone:TIME_ZONE,...result};
 }
 const criteria={date,milliseconds:db.command.gt(0)};
 const [leaders,count,mine]=await Promise.all([
  db.collection(COL).where(criteria).orderBy('milliseconds','desc').orderBy('lastCreditAt','asc').orderBy('_id','asc').limit(3).get(),
  db.collection(COL).where(criteria).count(),read(ref)
 ]);
 let userRank=null;
 if(mine?.milliseconds>0){
  const [ahead,ties]=await Promise.all([
   db.collection(COL).where({date,milliseconds:db.command.gt(mine.milliseconds)}).count(),
   db.collection(COL).where(db.command.or([{date,milliseconds:mine.milliseconds,lastCreditAt:db.command.lt(mine.lastCreditAt)},{date,milliseconds:mine.milliseconds,lastCreditAt:mine.lastCreditAt,_id:db.command.lt(id)}])).count()
  ]);userRank=ahead.total+ties.total+1;
 }
 const top=await Promise.all(leaders.data.map(async(row,i)=>({rank:i+1,seconds:Math.floor(row.milliseconds/1000),...await publicProfile(row._openid,row._openid===openid)})));
 return {date,timeZone:TIME_ZONE,top,participants:count.total,userRank,mySeconds:Math.floor((mine?.milliseconds||0)/1000)};
};
