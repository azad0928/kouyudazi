from pathlib import Path
root=Path('/Users/yacheng/Documents/Work Space/kouyudazi')
p=root/'src/utils/cover.ts';s=p.read_text()
pos=s.index('// Be conservative')
s=s[:pos]+'''/** Local-only diagnostics: never record signed query strings or account information. */
export function reportCover(stage:string, id:string, error:any='', source='') {
 const host=/^https:\\/\\/([^/?#]+)/.exec(source)?.[1] || '';
 const message=String(error?.errMsg || error?.message || error || '').replace(/https?:\\/\\/[^\\s"']+/g, value=>value.split('?')[0]).slice(0,220);
 const item={at:Date.now(),stage,file:id.split('/').pop()?.split('?')[0] || '',host,message};
 console.warn('[Cover]',JSON.stringify(item));
 try {const old=uni.getStorageSync('coverDiagnosticsV1');uni.setStorageSync('coverDiagnosticsV1',[...(Array.isArray(old)?old:[]).slice(-39),item])}catch{}
}
''' +s[pos:]
s=s.replace("if (result.statusCode !== 200 || !result.tempFilePath) return finish()", "if (result.statusCode !== 200 || !result.tempFilePath) {reportCover('download-http',fileID,'HTTP '+result.statusCode,tempUrl);return finish()}")
s=s.replace("success: () => {knownLocal.set(fileID, path); finish(path)}, fail: () => finish()}) } catch {finish()}","success: () => {knownLocal.set(fileID, path); finish(path)}, fail: (error:any) => {reportCover('save-file',fileID,error,tempUrl);finish(result.tempFilePath)}}) } catch(error) {reportCover('save-file',fileID,error,tempUrl);finish(result.tempFilePath)}")
s=s.replace("}, fail: () => finish()})\n      } catch { finish() }", "}, fail: (error:any) => {reportCover('download',fileID,error,tempUrl);finish()}})\n      } catch(error) {reportCover('download',fileID,error,tempUrl);finish()}")
s=s.replace("urls = response.result?.urls || {}; storeUrls(urls);", "urls = response.result?.urls || {}; storeUrls(urls);\n      for(const [id] of entries)if(!urls[id])reportCover('sign-empty',id,'getAudioUrl returned no URL');")
s=s.replace("} catch {} finally {\n      for (const [id, resolve]", "} catch(error) {for(const [id] of entries)reportCover('sign-function',id,error)} finally {\n      for (const [id, resolve]")
p.write_text(s)
p=root/'src/components/CoverImage.vue';s=p.read_text()
s=s.replace(':key="source"', ':key="imageRequest" :data-cover-request="imageRequest"')
s=s.replace('<text v-if="!compact" class="cover-caption">Cover unavailable</text>', '<text v-if="!compact" class="cover-caption">Cover unavailable</text><text v-if="!compact" class="cover-error-code">{{failureStage}}</text>')
s=s.replace('loadCoverSources,invalidateCover}', 'loadCoverSources,invalidateCover,reportCover}')
s=s.replace("const source=ref(''),status=", "const imageRequest=ref(0),failureStage=ref('');\nconst source=ref(''),status=")
s=s.replace("const token=++generation,id=props.src||'';", "const token=++generation,id=props.src||'';imageRequest.value=token;failureStage.value='';")
s=s.replace("if(!id || id==='/static/cover-default.jpg'){status.value='failed';return}", "if(!id || id==='/static/cover-default.jpg'){failureStage.value='No cover';status.value='failed';return}")
s=s.replace("generation++;source.value='';status.value='failed'}},30000)", "reportCover('timeout',id,'Cover not displayed within 30s',source.value);failureStage.value='Loading timed out';generation++;source.value='';status.value='failed'}},30000)")
s=s.replace("else {clearTimer();status.value='failed'}", "else {clearTimer();failureStage.value='URL unavailable';status.value='failed'}")
s=s.replace("}catch{if(token===generation){clearTimer();status.value='failed'}}", "}catch(error){if(token===generation){reportCover('resolve',id,error);clearTimer();failureStage.value='Unable to load';status.value='failed'}}")
s=s.replace("if(status.value!=='loading' || (event?.detail?.src && event.detail.src!==source.value))return;", "if(status.value!=='loading' || String(event?.currentTarget?.dataset?.coverRequest)!==String(imageRequest.value))return;")
s=s.replace(" clearTimer();\n if(props.src?.startsWith", " clearTimer();reportCover('image-decode',props.src||'',event?.detail?.errMsg||'Image failed to render',source.value);failureStage.value='Image unavailable';\n if(props.src?.startsWith")
s=s.replace('.cover-caption{', '.cover-error-code{font-family:Arial,sans-serif;color:#91869c;font-size:11px}.cover-caption{')
p.write_text(s)
