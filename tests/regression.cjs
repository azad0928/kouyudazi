const {test}=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')
const root=path.resolve(__dirname,'..')
const ts=require('typescript')
const common=require('../cloudfunctions/importApi/common')
function database(seed={}){
 let state=structuredClone(seed),tail=Promise.resolve()
 const compare=(value,test)=>{
  if(test&&test.$op){if(test.$op==='neq')return value!==test.v;if(test.$op==='lt')return value<test.v;if(test.$op==='gt')return value>test.v;if(test.$op==='in')return test.v.includes(value)}
  return value===test
 }
 const matches=(row,q)=>{if(q?.$or)return q.$or.some(x=>matches(row,x));if(q?.$and)return q.$and.every(x=>matches(row,x));return Object.entries(q||{}).every(([k,v])=>compare(k.split('.').reduce((a,x)=>a?.[x],row),v))}
 const command={inc:n=>({$inc:n}),neq:v=>({$op:'neq',v}),lt:v=>({$op:'lt',v}),gt:v=>({$op:'gt',v}),in:v=>({$op:'in',v}),or:(...xs)=>({$or:Array.isArray(xs[0])?xs[0]:xs}),and:(...xs)=>({$and:Array.isArray(xs[0])?xs[0]:xs})}
 function col(name,get){
  return {doc(id){return {async get(){return {data:structuredClone(get()[name]?.[id]||null)}},async set({data}){get()[name]||={};get()[name][id]={...structuredClone(data),_id:id}},async update({data}){const row=get()[name]?.[id];if(!row)throw Error('missing document');for(const [k,v] of Object.entries(data))row[k]=v?.$inc!==undefined?(row[k]||0)+v.$inc:structuredClone(v);return {stats:{updated:1}}},async remove(){delete get()[name][id]}}},where(q){let orders=[],count=100,skip=0;const query={orderBy(k,d){orders.push([k,d]);return query},limit(n){count=n;return query},skip(n){skip=n;return query},async get(){let data=Object.values(get()[name]||{}).filter(r=>matches(r,q));data.sort((a,b)=>{for(const [k,d] of orders){if(a[k]!==b[k])return (a[k]<b[k]?-1:1)*(d==='desc'?-1:1)}return 0});return {data:structuredClone(data.slice(skip,skip+count))}},async count(){return {total:Object.values(get()[name]||{}).filter(r=>matches(r,q)).length}},async update({data}){for(const row of Object.values(get()[name]||{}).filter(r=>matches(r,q)))Object.assign(row,data)}};return query},async add({data}){const id='id_'+Math.random();await col(name,get).doc(id).set({data});return {_id:id}}}
 }
 const db={command,collection:name=>col(name,()=>state),runTransaction(fn){const promise=tail.then(async()=>{let draft=structuredClone(state);const r=await fn({collection:name=>col(name,()=>draft)});state=draft;return r});tail=promise.catch(()=>{});return promise},state:()=>state}
 return db
}
function backend(name,db,openid='user',exportsExtra='',Clock=Date){
 const cloud={DYNAMIC_CURRENT_ENV:'mock',init(){},database:()=>db,getWXContext:()=>({OPENID:openid}),getTempFileURL:async({fileList})=>({fileList:fileList.map(x=>({fileID:x.fileID,status:0,tempFileURL:'https://mock/'+x.fileID}))}),deleteFile:async()=>{},openapi:{security:{msgSecCheck:async()=>({})}}}
 const folder=path.join(root,'cloudfunctions',name),code=fs.readFileSync(path.join(folder,'index.js'),'utf8')
 const sandbox={exports:{},console,Date:Clock,Buffer,Intl,URL,process:{env:{ADMIN_OPENIDS:'admin'}},setTimeout,clearTimeout,require(n){if(n==='wx-server-sdk')return cloud;if(n==='./common')return common;if(n==='mammoth'||n==='pdf-parse'||n==='jpeg-js')return {};if(name==='processImport'&&n.startsWith('./')&&n!=='./common')return new Proxy({}, {get:()=>()=>({})});return require(n.startsWith('.')?path.join(folder,n):n)}}
 vm.runInNewContext(code+'\n'+exportsExtra,sandbox)
 return {main:sandbox.exports.main,extra:sandbox.exports,cloud}
}
test('server date cannot be forged and concurrent check-in grants once',async()=>{
 const db=database({users:{u:{_id:'u',_openid:'user',points:0}}}),api=backend('checkinApi',db)
 const [a,b]=await Promise.all([api.main({action:'checkin',date:'2099-12-31'}),api.main({action:'checkin',date:'1900-01-01'})])
 assert.notEqual(a.date,'2099-12-31');assert.equal(Object.keys(db.state().checkins).length,1);assert.equal(db.state().users.u.points,10);assert.equal(a.pointsAdded+b.pointsAdded,10)
})
test('private file URL is denied; approved course media is allowed',async()=>{
 const db=database({imports:{a:{_openid:'other',status:'done',lesson:{audioUrl:'cloud://private'}},b:{_openid:'other',status:'done',officialStatus:'approved',lesson:{audioUrl:'cloud://public'}}}}),api=backend('getAudioUrl',db)
 await assert.rejects(()=>api.main({fileID:'cloud://private'}),/FORBIDDEN/)
 assert.match((await api.main({fileID:'cloud://public'})).tempFileURL,/mock/)
 const batch=await api.main({fileIDs:['cloud://private','cloud://public']});assert.deepEqual(Object.keys(batch.urls),['cloud://public'])
})
test('concurrent create requests debit free quota only once',async()=>{
 const db=database(),api=backend('importApi',db),prefix=common.key('user')
 const make=id=>api.main({action:'create',requestId:id,fileName:'lesson.txt',fileID:`cloud://mock/imports/source/${prefix}/${id}.txt`})
 const [a,b]=await Promise.all([make('same_request_123'),make('same_request_123')]);assert.equal(a.id,b.id);assert.equal(Object.keys(db.state().imports).length,1)
 await assert.rejects(()=>make('another_request_123'),/QUOTA_EXHAUSTED/)
 assert.equal(Object.values(db.state().quotas)[0].freeUsed,1)
})
test('redemption is idempotent and balance cannot be spent twice',async()=>{
 const db=database({users:{u:{_id:'u',_openid:'user',points:100}}}),api=backend('importApi',db)
 await Promise.all([api.main({action:'redeemPoints',requestId:'request_1234'}),api.main({action:'redeemPoints',requestId:'request_1234'})])
 assert.equal(db.state().users.u.points,0);assert.equal(Object.values(db.state().quotas)[0].pointsRemaining,1)
 await assert.rejects(()=>api.main({action:'redeemPoints',requestId:'request_5678'}),/POINTS_NOT_ENOUGH/)
})
test('monthly failure restores exactly once and preserves changed windows',async()=>{
 for(const sameWindow of [true,false]){
 const db=database({imports:{i:{_id:'i',_openid:'user',status:'processing',quotaDebit:{type:'monthly',qid:'q',window:100,refunded:false}}},quotas:{q:{_id:'q',_openid:'user',membership:{type:'monthly',monthlyStart:sameWindow?100:200,monthlyUsed:3}}}})
 const api=backend('processImport',db,'user','exports.refund=failRecord')
 await Promise.all([api.extra.refund('i','FAILED','monthly','user'),api.extra.refund('i','FAILED','monthly','user')])
 assert.equal(db.state().quotas.q.membership.monthlyUsed,sameWindow?2:3)
 assert.equal(db.state().quotas.q.pointsRemaining||0,sameWindow?0:1)
 }
})
test('shared records cannot be deleted or resubmitted',async()=>{
 const db=database({imports:{i:{_id:'i',_openid:'user',status:'done',officialStatus:'approved'}}}),api=backend('importApi',db)
 await assert.rejects(()=>api.main({action:'delete',importId:'i'}),/SHARED_RECORD_LOCKED/)
 await assert.rejects(()=>api.main({action:'applyOfficial',importId:'i',level:'B1'}),/ALREADY_SHARED/)
 assert.equal(db.state().imports.i.officialStatus,'approved')
})
test('course detail includes published level and cursor exposes all records',async()=>{
 const imports={};for(let n=0;n<67;n++)imports['i'+String(n).padStart(3,'0')]={_id:'i'+String(n).padStart(3,'0'),_openid:'user',createdAt:100+Math.floor(n/2),status:'done',officialStatus:'approved',officialLevel:'B1',lessonId:'l'+n,title:'Course '+n,lesson:{id:'l'+n,audioUrl:'https://mock/audio',duration:60}}
 const api=backend('importApi',database({imports}));assert.equal((await api.main({action:'getLesson',lessonId:'l1'})).lesson.level,'B1')
 let cursor='',ids=[];do{const r=await api.main({action:'listOfficial',cursor});ids.push(...r.records.map(r=>r.lessonId));cursor=r.nextCursor}while(cursor)
 assert.equal(ids.length,67);assert.equal(new Set(ids).size,67)
})
test('duplicate favorite removals remain removed',async()=>{
 const db=database(),api=backend('userApi',db)
 await api.main({action:'setFavorite',lessonId:'l',favored:true,title:'Lesson'})
 await Promise.all([api.main({action:'setFavorite',lessonId:'l',favored:false}),api.main({action:'setFavorite',lessonId:'l',favored:false})])
 assert.equal((await api.main({action:'listFavorites'})).list.length,0)
})
test('payment delivery grants once across duplicate notifications',async()=>{
 const db=database({orders:{o:{_id:'o',_openid:'user',productId:'singleimport',buyQuantity:1,status:'created'}}}),api=backend('payApi',db,'user','exports.deliver=deliverOrder')
 const order=structuredClone(db.state().orders.o)
 await Promise.all([api.extra.deliver(order,'wx1'),api.extra.deliver(order,'wx1')])
 assert.equal(Object.values(db.state().quotas)[0].singleRemaining,1);assert.equal(db.state().orders.o.status,'delivered')
})
function audio(audioOptionHandler){
 const daily={records:[],starts:0,pauses:0};let now=Date.now();class Clock extends Date{constructor(...args){super(...(args.length?args:[now]))}static now(){return now}}
 const callbacks={},actions=[],progress={},prefs={speed:1},player={src:'',currentTime:0,onPlay:f=>callbacks.play=f,onWaiting:f=>callbacks.wait=f,onPause:f=>callbacks.pause=f,onStop:f=>callbacks.stop=f,onTimeUpdate:f=>callbacks.time=f,onSeeked:f=>callbacks.seek=f,onEnded:f=>callbacks.end=f,onError:f=>callbacks.error=f,play(){actions.push('play')},pause(){actions.push('pause');callbacks.pause?.()},stop(){actions.push('stop');callbacks.stop?.()},seek(t){actions.push(['seek',t])}}
 let resolveCloud
 const uni={createInnerAudioContext:()=>player,showToast(){}}
 const learning={progress,preferences:prefs,load(){},update(l,pos,delta,ended){progress[l.id]={position:pos,completed:!!ended}},sync(){},preference(p){Object.assign(prefs,p)}}
 const sandbox={exports:{},console,Date:Clock,uni,wx:{setInnerAudioOption:options=>{actions.push(['audioOptions',options.obeyMuteSwitch]);if(audioOptionHandler)audioOptionHandler(options);else options.complete?.()},cloud:{callFunction:()=>new Promise(r=>resolveCloud=r)}},require:n=>n==='@/utils/daily-learning'?{startDailyListening(){daily.starts++},pauseDailyListening(){daily.pauses++},recordDailyListening(n){daily.records.push(n)}}:n==='pinia'?{defineStore:(_id,f)=>f}:n==='vue'?{ref:value=>({value}),computed:f=>({get value(){return f()}})}:n==='./learning'?{useLearningStore:()=>learning}:{getLocalAudio:async()=>null,cacheAudioLocally:async()=>{},dropLocalAudio(){}}}
 const code=ts.transpileModule(fs.readFileSync(path.join(root,'src/stores/audio.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;vm.runInNewContext(code,sandbox)
 return {store:sandbox.exports.useAudioStore(),actions,player,callbacks,progress,daily,advance:ms=>{now+=ms},resolve:()=>resolveCloud}
}
test('stopping during audio resolution invalidates the old request',async()=>{
 const a=audio();a.store.loadLesson({id:'a',title:'A',duration:60,audioUrl:'cloud://a'});const pending=a.store.toggle();await new Promise(setImmediate);a.store.stop();a.resolve()({result:{tempFileURL:'https://mock/a'}});await pending;assert.equal(a.actions.filter(x=>x==='play').length,0);assert.equal(a.player.src,'')
})
test('switching lessons prevents stale audio and restores saved progress',async()=>{
 const a=audio();a.store.loadLesson({id:'a',title:'A',duration:60,audioUrl:'cloud://a'});const p=a.store.toggle();await new Promise(setImmediate);a.progress.b={position:25};a.store.loadLesson({id:'b',title:'B',duration:90,audioUrl:'https://mock/b'});a.resolve()({result:{tempFileURL:'https://mock/a'}});await p;assert.equal(a.actions.filter(x=>x==='play').length,0);assert.equal(a.store.rawCurrentTime.value,25);await a.store.toggle();assert.equal(a.player.startTime,25);a.store.setSpeed(1.5);assert.equal(a.player.playbackRate,1.5)
})
function vocabStore(){
 const storage={},requests=[];let fail=false
 const uni={getStorageSync:k=>storage[k],setStorageSync(k,v){if(fail)throw Error('disk full');storage[k]=structuredClone(v)},showToast(){}}
 const sandbox={exports:{},console,Date,uni,wx:{cloud:{callFunction:()=>new Promise(resolve=>requests.push(resolve))}},require:n=>n==='pinia'?{defineStore:(_id,options)=>()=>{const store=options.state();for(const [name,fn]of Object.entries(options.actions))store[name]=fn.bind(store);return store}}:require(n)}
 const code=ts.transpileModule(fs.readFileSync(path.join(root,'src/stores/vocab.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;vm.runInNewContext(code,sandbox)
 return {store:sandbox.exports.useVocabStore(),requests,fail:()=>fail=true}
}
test('failed vocabulary persistence rolls back and reports failure',()=>{
 const v=vocabStore();v.fail();assert.throws(()=>v.store.toggle({word:'test',meaningCn:'测试',pos:'n',lessonId:'a',lessonTitle:'A'}),/Unable to save/);assert.equal(v.store.saved.length,0)
})
test('a sync response does not overwrite words added while it was in flight',async()=>{
 const v=vocabStore();v.store.toggle({word:'one',meaningCn:'一',pos:'n',lessonId:'a',lessonTitle:'A'});v.store.toggle({word:'two',meaningCn:'二',pos:'n',lessonId:'a',lessonTitle:'A'});v.requests[0]({result:{state:{vocab:{}}}});await new Promise(setImmediate);assert.equal(v.store.saved.length,2)
})
test('study state merge keeps newer progress from another device',async()=>{
 const stamp=Date.now()-1000,db=database({users:{u:{_id:'u',_openid:'user',studyState:{progress:{a:{updatedAt:stamp,position:30}},vocab:{}}}}}),api=backend('userApi',db)
 await api.main({action:'syncStudy',state:{progress:{a:{updatedAt:stamp-100,position:5}}}})
 assert.equal(db.state().users.u.studyState.progress.a.position,30)
})

// HTTP packets may split a Chinese character between buffers.
test('study responses preserve Chinese across split UTF-8 packets',async()=>{
 const {PassThrough}=require('node:stream'),{EventEmitter}=require('node:events');
 const encoded=Buffer.from(JSON.stringify({success:true,result:{translated_text:'年度最大促销'}}));
 const split=encoded.indexOf(Buffer.from('年'))+1;
 const sandbox={exports:{},console,Buffer,process:{env:{CF_ACCOUNT_ID:'test',CF_API_TOKEN:'test'}},require(n){
  if(n==='wx-server-sdk'||n==='./common')return {};
  if(n==='https')return {request(options,callback){const req=new EventEmitter();req.setTimeout=()=>{};req.destroy=e=>req.emit('error',e);req.end=()=>{const res=new PassThrough();res.statusCode=200;callback(res);res.write(encoded.subarray(0,split));res.end(encoded.subarray(split))};return req}};
  return require(n)
 }};
 vm.runInNewContext(fs.readFileSync(path.join(root,'cloudfunctions/processImport/study.js'),'utf8')+'\nexports.request=request',sandbox);
 const result=await sandbox.exports.request(null,'The Biggest Sale of the Year');
 assert.equal(result.translation,'年度最大促销');
});

function coverCache(options={}){
 const files=new Set(),storage={},calls=[],downloads=[];let active=0,peak=0,fail=false;
 const disk={accessSync(p){if(!files.has(p))throw Error('missing')},mkdirSync(){},copyFile({destPath,success}){files.add(destPath);success()},unlinkSync(p){files.delete(p)}};
 const uni={getStorageSync:k=>storage[k],setStorageSync:(k,v)=>storage[k]=v,downloadFile(o){downloads.push(o.url);peak=Math.max(peak,++active);setTimeout(()=>{active--;o.success({statusCode:fail?500:200,tempFilePath:'/tmp/image'})},options.delay||5)}};
 const wx={env:{USER_DATA_PATH:'/device'},getFileSystemManager:()=>disk,cloud:{async callFunction({data}){calls.push([...data.fileIDs]);return {result:{urls:Object.fromEntries(data.fileIDs.map(id=>[id,'https://images/'+encodeURIComponent(id)+'?t='+Math.floor(Date.now()/1000)]))}}}}};
 const sandbox={exports:{},console,Date,uni,wx,setTimeout,clearTimeout};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,'src/utils/cover.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,sandbox);
 return {api:sandbox.exports,files,storage,calls,downloads,peak:()=>peak,fail:v=>fail=v};
}
test('cached cover renders immediately without signing or downloading',async()=>{
 const c=coverCache(),id='cloud://cached',path=c.api.coverLocalPath(id),ready=[];c.files.add(path);
 const pending=c.api.loadCoverSources([id],(key,src)=>ready.push(src));
 assert.deepEqual(ready,[path]);await pending;assert.equal(c.calls.length,0);assert.equal(c.downloads.length,0);
});
test('cover requests across pages share signing and download; concurrency stays bounded',async()=>{
 const c=coverCache({delay:10}),ids=['cloud://a','cloud://b','cloud://c'],ready=[];
 await Promise.all([c.api.loadCoverSources(ids,(id,src)=>ready.push(src)),c.api.loadCoverSources([ids[0]],()=>{})]);
 assert.equal(c.calls.length,1);assert.equal(c.downloads.length,3);assert.equal(c.peak(),2);assert.equal(ready.length,3);
 await c.api.loadCoverSources(ids,()=>{});assert.equal(c.calls.length,1);assert.equal(c.downloads.length,3);
});
test('a fresh cached URL still gets persisted locally without another cloud call',async()=>{
 const c=coverCache(),id='cloud://fresh';c.storage[c.api.COVER_URLS_CACHE_KEY]={urls:{[id]:'https://images/fresh?t='+Math.floor(Date.now()/1000)}};
 await c.api.loadCoverSources([id],()=>{});assert.equal(c.calls.length,0);assert.equal(c.downloads.length,1);assert.ok(c.api.cachedCover(id));
});
test('bad cover cache can be discarded and repaired without changing its original',async()=>{
 const c=coverCache(),id='cloud://repair';await c.api.loadCoverSources([id],()=>{});const path=c.api.cachedCover(id);assert.ok(path);
 c.api.invalidateCover(id);assert.equal(c.api.cachedCover(id),'');assert.equal(c.files.has(path),false);
 await c.api.loadCoverSources([id],()=>{});assert.equal(c.calls.length,2);assert.equal(c.downloads.length,2);assert.equal(c.api.cachedCover(id),path);
});

function automaticCheckin({call,cache={},failCache=false,noCloud=false,noIntl=false,initialNow=Date.now()}={}){
 const saved=[];let calls=0,now=initialNow
 class Clock extends Date{constructor(...args){super(...(args.length?args:[now]))}static now(){return now}}
 const sandbox={exports:{},Date:Clock,Intl:noIntl?undefined:Intl,Promise,Number,Error,console,
  uni:{getStorageSync:()=>cache,setStorageSync:(key,value)=>{if(failCache)throw new Error('storage full');saved.push({key,value})}},
  require:n=>{if(n==='vue')return {reactive:x=>x};throw new Error(n)}}
 if(!noCloud)sandbox.wx={cloud:{callFunction:args=>{calls++;return call(args)}}}
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,'src/utils/checkin.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,sandbox)
 return {api:sandbox.exports,saved,advance:ms=>{now+=ms},get calls(){return calls}}
}
const checkinResult=(overrides={})=>({totalDays:4,todayChecked:true,date:'2026-11-17',timeZone:'America/Toronto',pointsAdded:10,...overrides})
test('foreground and page check-in callers share one request and use server date',async()=>{
 let finish
 const a=automaticCheckin({call:args=>{assert.equal(args.data.action,'checkin');assert.equal(args.data.date,undefined);return new Promise(resolve=>finish=resolve)}})
 const first=a.api.ensureDailyCheckin(),second=a.api.ensureDailyCheckin();assert.equal(first,second)
 await new Promise(setImmediate);assert.equal(a.calls,1);assert.equal(a.api.checkinState.busy,true)
 finish({result:checkinResult()});await first
 assert.equal(a.api.checkinState.busy,false);assert.equal(a.api.checkinState.totalDays,4)
 assert.equal(a.saved[0].value.date,'2026-11-17');assert.equal(a.saved[0].value.timeZone,'America/Toronto')
})
test('failed automatic check-in is not marked successful and can retry',async()=>{
 let failing=true
 const a=automaticCheckin({call:async()=>{if(failing)throw new Error('offline');return {result:checkinResult()}}})
 await assert.rejects(a.api.ensureDailyCheckin(),/offline/);assert.equal(a.api.checkinState.todayChecked,false);assert.equal(a.api.checkinState.busy,false)
 failing=false;await a.api.ensureDailyCheckin();assert.equal(a.calls,2);assert.equal(a.api.checkinState.error,'');assert.equal(a.api.checkinState.todayChecked,true)
})
test('cache write errors do not undo successful check-ins and next entry rechecks server day',async()=>{
 let day='2026-11-17'
 const a=automaticCheckin({initialNow:Date.UTC(2026,10,17,12),failCache:true,call:async()=>({result:checkinResult({date:day,timeZone:'UTC'})})})
 await a.api.ensureDailyCheckin();assert.equal(a.api.checkinState.todayChecked,true)
 a.advance(86400000);day='2026-11-18';await a.api.ensureDailyCheckin();assert.equal(a.api.checkinState.date,day);assert.equal(a.calls,2)
})
test('non-WeChat and malformed cloud responses never claim a successful check-in',async()=>{
 const absent=automaticCheckin({noCloud:true});assert.equal(await absent.api.ensureDailyCheckin(),null)
 const a=automaticCheckin({call:async()=>({result:{}})});await assert.rejects(a.api.ensureDailyCheckin(),/Invalid check-in response/);assert.equal(a.api.checkinState.todayChecked,false)
})

test('Courses and profile navigation reuse the same confirmed day even after the old cooldown',async()=>{
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'UTC',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
 const a=automaticCheckin({call:async()=>({result:checkinResult({date:today,timeZone:'UTC'})})})
 await a.api.ensureDailyCheckin();const second=await a.api.ensureDailyCheckin();assert.equal(a.calls,1);assert.equal(second.already,true);assert.equal(second.pointsAdded,0)
 a.advance(30*60*1000);await a.api.ensureDailyCheckin();assert.equal(a.calls,1)
 await a.api.ensureDailyCheckin({revalidate:true});assert.equal(a.calls,2)
})

test('platforms without Intl reuse only in-memory session success and revalidate on real app entry',async()=>{
 const a=automaticCheckin({noIntl:true,call:async()=>({result:checkinResult()})})
 await a.api.ensureDailyCheckin();a.advance(3600000);await a.api.ensureDailyCheckin();assert.equal(a.calls,1)
 await a.api.ensureDailyCheckin({revalidate:true});assert.equal(a.calls,2)
})
test('confirmed check-in revalidation stays silent while still calling the server',async()=>{
 let resolve
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'UTC',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
 let first=true
 const a=automaticCheckin({call:()=>{if(first){first=false;return Promise.resolve({result:checkinResult({date:today,timeZone:'UTC'})})}return new Promise(r=>resolve=r)}})
 await a.api.ensureDailyCheckin();const p=a.api.ensureDailyCheckin({revalidate:true});await new Promise(setImmediate)
 assert.equal(a.api.checkinState.busy,false);resolve({result:checkinResult({date:today,timeZone:'UTC',already:true,pointsAdded:0})});await p;assert.equal(a.calls,2)
})

function leaderboardClock(){let now=Date.UTC(2030,4,20,12);class Clock extends Date{constructor(...args){super(...(args.length?args:[now]))}static now(){return now}}return {Clock,advance:ms=>{now+=ms}}}
test('daily leaderboard rejects unauthenticated and malformed heartbeats',async()=>{
 const db=database();await assert.rejects(backend('leaderboardApi',db,'').main({action:'getToday'}),/UNAUTHORIZED/)
 await assert.rejects(backend('leaderboardApi',db).main({action:'heartbeat',sessionId:'bad',sequence:1,totalMs:100}),/INVALID_HEARTBEAT/)
})
test('daily listening establishes a baseline, ignores retries and caps concurrent devices to elapsed time',async()=>{
 const clock=leaderboardClock(),db=database(),api=backend('leaderboardApi',db,'user','',clock.Clock)
 const hit=(sessionId,sequence,totalMs)=>api.main({action:'heartbeat',sessionId,sequence,totalMs})
 await hit('session-one',1,0);await hit('session-two',1,0);clock.advance(10000)
 await Promise.all([hit('session-one',2,10000),hit('session-two',2,10000)])
 assert.equal(Object.values(db.state().dailyListening)[0].milliseconds,10000)
 assert.equal((await hit('session-one',2,10000)).duplicate,true)
 clock.advance(5000);await hit('session-one',3,999999)
 assert.equal(Object.values(db.state().dailyListening)[0].milliseconds,15000)
})
test('daily leaderboard returns real top three, deterministic own rank, participant count and no private IDs',async()=>{
 const date='2030-05-20',db=database({users:{a:{_id:'a',_openid:'private-a',nickName:'Mia',avatarIndex:3},b:{_id:'b',_openid:'private-b',nickName:'Luna',avatarIndex:2},c:{_id:'c',_openid:'private-c',nickName:'Leo',avatarIndex:4}},dailyListening:{
  a:{_id:'a',_openid:'private-a',date,milliseconds:42000},b:{_id:'b',_openid:'private-b',date,milliseconds:28000},c:{_id:'c',_openid:'private-c',date,milliseconds:21000},[common.key('daily',date,'user')]:{_id:common.key('daily',date,'user'),_openid:'user',date,milliseconds:10000},zero:{_id:'zero',_openid:'not-learning',date,milliseconds:0},old:{_id:'old',_openid:'old-person',date:'2030-05-19',milliseconds:999999}}})
 const clock=leaderboardClock(),r=await backend('leaderboardApi',db,'user','',clock.Clock).main({action:'getToday'})
 assert.equal(r.participants,4);assert.equal(r.userRank,4);assert.deepEqual(Array.from(r.top,p=>p.name),['Mia','Luna','Leo']);assert.equal(r.top[0].seconds,42)
 assert.equal(JSON.stringify(r).includes('private-a'),false);assert.equal(JSON.stringify(r).includes('_openid'),false)
})
test('daily leaderboard rolls over using server date and does not import previous-day cumulative seconds',async()=>{
 const clock=leaderboardClock(),db=database(),api=backend('leaderboardApi',db,'user','',clock.Clock)
 await api.main({action:'heartbeat',sessionId:'session-one',sequence:1,totalMs:0,date:'2099-01-01'});clock.advance(10000)
 await api.main({action:'heartbeat',sessionId:'session-one',sequence:2,totalMs:10000});assert.equal((await api.main({action:'getToday'})).participants,1)
 clock.advance(86400000);const empty=await api.main({action:'getToday'});assert.equal(empty.participants,0);assert.equal(empty.userRank,null);assert.equal(empty.top.length,0)
 const first=await api.main({action:'heartbeat',sessionId:'session-one',sequence:3,totalMs:999999});assert.equal(first.milliseconds,0)
})
test('daily ranking counts wall time at 2x playback, not audio duration or buffering',async()=>{
 const a=audio();a.store.loadLesson({id:'daily',title:'Daily',duration:200,audioUrl:'https://mock/daily'});a.store.setSpeed(2);await a.store.toggle();a.callbacks.play();a.callbacks.seek();a.advance(1000);a.player.currentTime=2;a.callbacks.time()
 assert.equal(a.daily.starts,1);assert.equal(a.daily.records.at(-1),1)
 a.callbacks.wait();a.advance(4000);a.callbacks.time();assert.equal(a.daily.records.at(-1),0)
 a.callbacks.pause();assert.ok(a.daily.pauses>0)
})
function dailyClient(call){
 const requests=[],timers=new Map();let timerId=0
 const sandbox={exports:{},console,Date,Math,Number,Promise,Error,wx:{cloud:{callFunction:args=>{requests.push(args.data);return call?call(args.data):Promise.resolve({result:{}})}}},setTimeout:f=>{timers.set(++timerId,f);return timerId},clearTimeout:id=>timers.delete(id),require:n=>{if(n==='vue')return {reactive:x=>x};throw Error(n)}}
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,'src/utils/daily-learning.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,sandbox)
 return {api:sandbox.exports,requests,timers}
}
test('daily client starts at zero, flushes actual listening and stops counting while paused',async()=>{
 const c=dailyClient();c.api.startDailyListening();await c.api.flushDailyListening();assert.equal(c.requests[0].totalMs,0)
 c.api.recordDailyListening(1.25);c.api.recordDailyListening(1.25);c.api.pauseDailyListening();await c.api.flushDailyListening();assert.equal(c.requests.at(-1).totalMs,2500)
 const n=c.requests.length;c.api.recordDailyListening(2);await c.api.flushDailyListening();assert.equal(c.requests.length,n);assert.equal(c.timers.size,0)
})
test('ranking retries after a synchronous SDK failure and preserves a real empty board',async()=>{
 let fail=true;const c=dailyClient(()=>{if(fail)throw Error('SDK not ready');return Promise.resolve({result:{date:'2030-05-20',timeZone:'America/Toronto',top:[],participants:0,userRank:null,mySeconds:0}})})
 await c.api.loadDailyLeaderboard(true);assert.ok(c.api.dailyRanking.error)
 fail=false;await c.api.loadDailyLeaderboard(true);assert.equal(c.requests.length,2);assert.equal(c.api.dailyRanking.error,'');assert.equal(c.api.dailyRanking.data.participants,0)
})

test('iOS silent-mode option completes before playback and is reapplied on resume',async()=>{
 let finish;const a=audio(options=>{finish=options.complete});a.store.loadLesson({id:'silent',duration:60,audioUrl:'https://mock/silent'});
 const start=a.store.toggle();await new Promise(setImmediate);
 assert.equal(a.actions.includes('play'),false);assert.deepEqual(a.actions.at(-1),['audioOptions',false]);
 finish();await start;assert.equal(a.actions.at(-1),'play');assert.equal(a.player.obeyMuteSwitch,false);
 a.store.pause();const resume=a.store.toggle();await new Promise(setImmediate);assert.equal(a.actions.at(-1)[0],'audioOptions');finish();await resume;assert.equal(a.actions.at(-1),'play');
});
test('pausing while iOS audio settings are pending prevents late playback',async()=>{
 let finish;const a=audio(options=>{finish=options.complete});a.store.loadLesson({id:'silent',duration:60,audioUrl:'https://mock/silent'});
 const start=a.store.toggle();await new Promise(setImmediate);a.store.pause();finish();await start;
 assert.equal(a.actions.includes('play'),false);
});

const rewardEvent={Type:'Timer',TriggerName:'settleDailyRankingHourly'};
function rewardClock(iso='2026-11-18T16:00:00Z'){return class extends Date{constructor(...a){super(...(a.length?a:[iso]))}static now(){return Date.parse(iso)}}}
function rewardsApi(db,Clock=rewardClock()){
 const api=backend('settleDailyRanking',db,'','',Clock);api.cloud.getWXContext=()=>({SOURCE:'wx_trigger'});return api;
}
test('ranking settlement pays exact top-ten tiers once with matching unread messages and ledger entries',async()=>{
 const rows={},users={};for(let i=0;i<12;i++){const id='u'+i;rows[id]={_id:id,_openid:id,date:'2026-11-18',milliseconds:900000-i*1000,lastCreditAt:i};users[id]={_id:id,_openid:id,points:10}}
 rows.short={_id:'short',_openid:'short',date:'2026-11-18',milliseconds:299999};
 const db=database({dailyListening:rows,users}),api=rewardsApi(db);
 await Promise.all([api.main(rewardEvent),api.main(rewardEvent)]);
 const logs=Object.values(db.state().pointLogs),messages=Object.values(db.state().messages);
 assert.equal(logs.length,10);assert.equal(messages.length,10);assert.equal(logs.reduce((n,x)=>n+x.change,0),380);
 assert.deepEqual(logs.sort((a,b)=>a.rank-b.rank).map(x=>x.change),[100,70,50,30,30,20,20,20,20,20]);
 for(const log of logs){assert.equal(db.state().users[log._openid].points,10+log.change);const m=messages.find(x=>x.pointLogId===log._id);assert.equal(m.read,false);assert.equal(m.points,log.change);assert.equal(m.rank,log.rank)}
 assert.equal(db.state().users.u10.points,10);await api.main(rewardEvent);assert.equal(Object.keys(db.state().pointLogs).length,10);
});
test('reward eligibility includes exactly five minutes; ties prefer first reach time; only completed days settle',async()=>{
 const date='2026-11-18',db=database({dailyListening:{z:{_id:'z',_openid:'early',date,milliseconds:300000,lastCreditAt:10},a:{_id:'a',_openid:'late',date,milliseconds:300000,lastCreditAt:20},s:{_id:'s',_openid:'short',date,milliseconds:299999,lastCreditAt:1},today:{_id:'today',_openid:'today',date:'2026-11-19',milliseconds:999999},history:{_id:'history',_openid:'history',date:'2026-11-17',milliseconds:999999}}});
 await rewardsApi(db).main(rewardEvent);const logs=Object.values(db.state().pointLogs).sort((a,b)=>a.rank-b.rank);
 assert.deepEqual(logs.map(x=>x._openid),['early','late']);assert.deepEqual(logs.map(x=>x.change),[100,70]);
});
test('client-spoofed timer cannot issue rewards',async()=>{
 const db=database();for(const ctx of [{SOURCE:'wx_client',OPENID:'user'},{SOURCE:'wx_devtools'},{SOURCE:'wx_client,scf'},{SOURCE:'wx_trigger',OPENID:'user'}]){
  const api=rewardsApi(db);api.cloud.getWXContext=()=>ctx;await assert.rejects(()=>api.main(rewardEvent),/UNAUTHORIZED/)
 }assert.deepEqual(db.state(),{});
});
test('partial reward failure resumes frozen winners without duplicate balances, logs or messages',async()=>{
 const date='2026-11-18',db=database({dailyListening:{a:{_id:'a',_openid:'a',date,milliseconds:900000,lastCreditAt:10},b:{_id:'b',_openid:'b',date,milliseconds:800000,lastCreditAt:20}}});
 const original=db.runTransaction;let n=0;db.runTransaction=fn=>{if(++n===3)return Promise.reject(Error('temporary failure'));return original(fn)};
 const api=rewardsApi(db);await assert.rejects(()=>api.main(rewardEvent),/temporary failure/);
 assert.equal(Object.keys(db.state().pointLogs).length,1);db.runTransaction=original;await api.main(rewardEvent);
 assert.equal(Object.keys(db.state().pointLogs).length,2);assert.equal(Object.keys(db.state().messages).length,2);
 assert.equal(Object.values(db.state().users).reduce((s,u)=>s+u.points,0),170);
});
test('local-midnight settlement respects Beijing time and does not award today early',async()=>{
 const date='2026-11-18',seed={dailyListening:{a:{_id:'a',_openid:'a',date,milliseconds:300000,lastCreditAt:10}}};
 const db=database(seed);await rewardsApi(db,rewardClock('2026-11-18T15:59:59Z')).main(rewardEvent);assert.equal(Object.keys(db.state().pointLogs||{}).length,0);
 await rewardsApi(db,rewardClock('2026-11-18T16:00:00Z')).main(rewardEvent);assert.equal(Object.keys(db.state().pointLogs).length,1);
});
test('daily board uses the same first-reached tie order as settlement',async()=>{
 const date='2030-05-20',id=common.key('daily',date,'user');const db=database({dailyListening:{z:{_id:'z',_openid:'early',date,milliseconds:300000,lastCreditAt:1},a:{_id:'a',_openid:'late',date,milliseconds:300000,lastCreditAt:3},[id]:{_id:id,_openid:'user',date,milliseconds:300000,lastCreditAt:2}}});
 const r=await backend('leaderboardApi',db,'user','',leaderboardClock().Clock).main({action:'getToday'});assert.equal(r.userRank,2);assert.equal(r.top[1].isSelf,true);
});
