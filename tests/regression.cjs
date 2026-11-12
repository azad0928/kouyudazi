const {test}=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')
const root=path.resolve(__dirname,'..')
const ts=require('typescript')
const common=require('../cloudfunctions/importApi/common')
function database(seed={}){
 let state=structuredClone(seed),tail=Promise.resolve()
 const compare=(value,test)=>{
  if(test&&test.$op){if(test.$op==='neq')return value!==test.v;if(test.$op==='lt')return value<test.v;if(test.$op==='in')return test.v.includes(value)}
  return value===test
 }
 const matches=(row,q)=>{if(q?.$or)return q.$or.some(x=>matches(row,x));if(q?.$and)return q.$and.every(x=>matches(row,x));return Object.entries(q||{}).every(([k,v])=>compare(k.split('.').reduce((a,x)=>a?.[x],row),v))}
 const command={inc:n=>({$inc:n}),neq:v=>({$op:'neq',v}),lt:v=>({$op:'lt',v}),in:v=>({$op:'in',v}),or:(...xs)=>({$or:Array.isArray(xs[0])?xs[0]:xs}),and:(...xs)=>({$and:Array.isArray(xs[0])?xs[0]:xs})}
 function col(name,get){
  return {doc(id){return {async get(){return {data:structuredClone(get()[name]?.[id]||null)}},async set({data}){get()[name]||={};get()[name][id]={...structuredClone(data),_id:id}},async update({data}){const row=get()[name]?.[id];if(!row)throw Error('missing document');for(const [k,v] of Object.entries(data))row[k]=v?.$inc!==undefined?(row[k]||0)+v.$inc:structuredClone(v);return {stats:{updated:1}}},async remove(){delete get()[name][id]}}},where(q){let orders=[],count=100,skip=0;const query={orderBy(k,d){orders.push([k,d]);return query},limit(n){count=n;return query},skip(n){skip=n;return query},async get(){let data=Object.values(get()[name]||{}).filter(r=>matches(r,q));data.sort((a,b)=>{for(const [k,d] of orders){if(a[k]!==b[k])return (a[k]<b[k]?-1:1)*(d==='desc'?-1:1)}return 0});return {data:structuredClone(data.slice(skip,skip+count))}},async count(){return {total:Object.values(get()[name]||{}).filter(r=>matches(r,q)).length}},async update({data}){for(const row of Object.values(get()[name]||{}).filter(r=>matches(r,q)))Object.assign(row,data)}};return query},async add({data}){const id='id_'+Math.random();await col(name,get).doc(id).set({data});return {_id:id}}}
 }
 const db={command,collection:name=>col(name,()=>state),runTransaction(fn){const promise=tail.then(async()=>{let draft=structuredClone(state);const r=await fn({collection:name=>col(name,()=>draft)});state=draft;return r});tail=promise.catch(()=>{});return promise},state:()=>state}
 return db
}
function backend(name,db,openid='user',exportsExtra=''){
 const cloud={DYNAMIC_CURRENT_ENV:'mock',init(){},database:()=>db,getWXContext:()=>({OPENID:openid}),getTempFileURL:async({fileList})=>({fileList:fileList.map(x=>({fileID:x.fileID,status:0,tempFileURL:'https://mock/'+x.fileID}))}),deleteFile:async()=>{},openapi:{security:{msgSecCheck:async()=>({})}}}
 const folder=path.join(root,'cloudfunctions',name),code=fs.readFileSync(path.join(folder,'index.js'),'utf8')
 const sandbox={exports:{},console,Date,Buffer,Intl,URL,process:{env:{ADMIN_OPENIDS:'admin'}},setTimeout,clearTimeout,require(n){if(n==='wx-server-sdk')return cloud;if(n==='./common')return common;if(n==='mammoth'||n==='pdf-parse'||n==='jpeg-js')return {};if(name==='processImport'&&n.startsWith('./')&&n!=='./common')return new Proxy({}, {get:()=>()=>({})});return require(n.startsWith('.')?path.join(folder,n):n)}}
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
function audio(){
 const callbacks={},actions=[],progress={},prefs={speed:1},player={src:'',currentTime:0,onPlay:f=>callbacks.play=f,onWaiting:f=>callbacks.wait=f,onPause:f=>callbacks.pause=f,onStop:f=>callbacks.stop=f,onTimeUpdate:f=>callbacks.time=f,onSeeked:f=>callbacks.seek=f,onEnded:f=>callbacks.end=f,onError:f=>callbacks.error=f,play(){actions.push('play')},pause(){actions.push('pause');callbacks.pause?.()},stop(){actions.push('stop');callbacks.stop?.()},seek(t){actions.push(['seek',t])}}
 let resolveCloud
 const uni={createInnerAudioContext:()=>player,showToast(){}}
 const learning={progress,preferences:prefs,load(){},update(l,pos,delta,ended){progress[l.id]={position:pos,completed:!!ended}},sync(){},preference(p){Object.assign(prefs,p)}}
 const sandbox={exports:{},console,Date,uni,wx:{cloud:{callFunction:()=>new Promise(r=>resolveCloud=r)}},require:n=>n==='pinia'?{defineStore:(_id,f)=>f}:n==='vue'?{ref:value=>({value}),computed:f=>({get value(){return f()}})}:n==='./learning'?{useLearningStore:()=>learning}:{getLocalAudio:async()=>null,cacheAudioLocally:async()=>{},dropLocalAudio(){}}}
 const code=ts.transpileModule(fs.readFileSync(path.join(root,'src/stores/audio.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;vm.runInNewContext(code,sandbox)
 return {store:sandbox.exports.useAudioStore(),actions,player,callbacks,progress,resolve:()=>resolveCloud}
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
