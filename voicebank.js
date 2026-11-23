(() => {
"use strict";
const $=id=>document.getElementById(id);
const state={entries:new Map(),files:new Map(),rows:[],prefixMap:new Map(),audioUrl:null,archive:null};
const MAX_ARCHIVE=800*1024*1024,MAX_ENTRIES=50000,MAX_TEXT=16*1024*1024;
const VOICEBANK_DB="VoiceBankStudioLocalBanks",VOICEBANK_STORE="banks";
function openVoicebankDB(){
 return new Promise((resolve,reject)=>{
  if(!("indexedDB" in window)){reject(Error("このブラウザでは端末内保存を利用できません。"));return;}
  const request=indexedDB.open(VOICEBANK_DB,1);
  request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains(VOICEBANK_STORE))db.createObjectStore(VOICEBANK_STORE);};
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>reject(request.error||Error("端末内保存を開けません。"));
 });
}
async function saveVoicebankArchive(file){
 const db=await openVoicebankDB();
 try{await new Promise((resolve,reject)=>{const tx=db.transaction(VOICEBANK_STORE,"readwrite");tx.objectStore(VOICEBANK_STORE).put({blob:file,name:file.name,type:file.type||"application/zip",savedAt:Date.now()},"active");tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error||Error("音源保存に失敗しました。"));tx.onabort=()=>reject(tx.error||Error("音源保存が中断されました。"));});}
 finally{db.close();}
}
async function getVoicebankArchive(){
 const db=await openVoicebankDB();
 try{return await new Promise((resolve,reject)=>{const tx=db.transaction(VOICEBANK_STORE,"readonly"),request=tx.objectStore(VOICEBANK_STORE).get("active");request.onsuccess=()=>resolve(request.result||null);request.onerror=()=>reject(request.error||Error("保存音源を読み込めません。"));});}
 finally{db.close();}
}
async function deleteVoicebankArchive(){
 const db=await openVoicebankDB();
 try{await new Promise((resolve,reject)=>{const tx=db.transaction(VOICEBANK_STORE,"readwrite");tx.objectStore(VOICEBANK_STORE).delete("active");tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error||Error("保存音源を削除できません。"));});}
 finally{db.close();}
}
const norm=s=>String(s||"").replace(/\\/g,"/").replace(/^\/+/,"");
function parseOto(text,prefix){
 const rows=[],lines=text.replace(/^\uFEFF/,"").split(/\r?\n/);
 for(let i=0;i<lines.length;i++){
  const line=lines[i].trim();if(!line||line.startsWith(";")||line.startsWith("#"))continue;
  const p=line.split(",");if(p.length<2)continue;
  const eq=p[0].indexOf("="),file=norm((eq>=0?p[0].slice(0,eq):p[0]).trim());
  const alias=(eq>=0?p[0].slice(eq+1):p[1]).trim();
  const base=eq>=0?p.slice(1):p.slice(2),values=base.slice(0,5).map(v=>v.trim()===""?0:Number(v));
  rows.push({alias:alias||file,file:norm(prefix+file),offset:values[0]||0,consonant:values[1]||0,cutoff:values[2]||0,preutterance:values[3]||0,overlap:values[4]||0,line:i+1,valid:values.length===5&&values.every(Number.isFinite)});
 }
 return rows;
}
async function inflateRaw(bytes){
 if(!("DecompressionStream" in window))throw Error("このブラウザはZIP展開機能に未対応です。フォルダ読み込みをお試しください。");
 try{return await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer();}
 catch(e){throw Error("ZIPの圧縮方式を展開できません。通常のZIP形式か確認してください。");}
}
async function readZip(blob){
 if(blob.size>MAX_ARCHIVE)throw Error("ZIPは800MB以下のものを選択してください。");
 const tail=await blob.slice(Math.max(0,blob.size-65557)).arrayBuffer(),v=new DataView(tail);let end=-1;
 for(let i=tail.byteLength-22;i>=0;i--)if(v.getUint32(i,true)===0x06054b50){end=i;break;}
 if(end<0)throw Error("ZIPの目次が見つかりません。破損または非対応形式の可能性があります。");
 const count=v.getUint16(end+10,true),size=v.getUint32(end+12,true),offset=v.getUint32(end+16,true);
 if(count===0xffff||size===0xffffffff||offset===0xffffffff)throw Error("64bit ZIPは現在未対応です。");
 if(count>MAX_ENTRIES)throw Error("ファイル数が多すぎます（上限50000件）。");
 const cd=await blob.slice(offset,offset+size).arrayBuffer(),d=new DataView(cd),b=new Uint8Array(cd),decoder=new TextDecoder("utf-8"),entries=new Map();let p=0,total=0;
 for(let n=0;n<count;n++){
  if(d.getUint32(p,true)!==0x02014b50)throw Error("ZIPの目次データが不正です。");
  const flags=d.getUint16(p+8,true),method=d.getUint16(p+10,true),csize=d.getUint32(p+20,true),usize=d.getUint32(p+24,true),nl=d.getUint16(p+28,true),el=d.getUint16(p+30,true),cl=d.getUint16(p+32,true),local=d.getUint32(p+42,true);
  const nameBytes=b.slice(p+46,p+46+nl),name=norm(new TextDecoder((flags&0x800)?"utf-8":"shift_jis").decode(nameBytes));
  if(name&&!name.endsWith("/")){
   if(name.split("/").some(x=>x===".."||x==="."))throw Error("不正なファイルパスを含むZIPです。");
   if(flags&1)throw Error("暗号化ZIPには対応していません。");
   if(method!==0&&method!==8)throw Error("未対応の圧縮方式を含んでいます。");
   total+=usize;if(total>1024*1024*1024)throw Error("展開後の合計サイズが1GBを超えます。");
   entries.set(name,{name,method,csize,usize,local});
  }
  p+=46+nl+el+cl;
 }
 return entries;
}
async function zipFile(e){
 const h=await state.archive.slice(e.local,e.local+30).arrayBuffer(),d=new DataView(h);
 if(d.getUint32(0,true)!==0x04034b50)throw Error("ZIPファイルの位置情報が不正です。");
 const start=e.local+30+d.getUint16(26,true)+d.getUint16(28,true),compressed=await state.archive.slice(start,start+e.csize).arrayBuffer();
 const result=e.method===0?compressed:await inflateRaw(compressed);
 if(result.byteLength!==e.usize)throw Error("展開サイズが一致しません。ZIPが破損している可能性があります。");
 return new Blob([result]);
}
function render(){
 const root=$("vbRows");root.replaceChildren();const wavCount=state.files.size+[...state.entries.keys()].filter(x=>x.toLowerCase().endsWith(".wav")).length;
 $("vbSummary").textContent="oto.ini項目: "+state.rows.length+"件 / WAV: "+wavCount+"件";
 const frag=document.createDocumentFragment();
 state.rows.slice(0,5000).forEach(r=>{
  const el=document.createElement("div");el.className="vb-entry";const info=document.createElement("div"),strong=document.createElement("strong"),small=document.createElement("small");
  strong.textContent=r.alias;small.textContent=r.file+" · offset "+r.offset+" / consonant "+r.consonant+" / cutoff "+r.cutoff+" / preutterance "+r.preutterance+" / overlap "+r.overlap;info.append(strong,small);
  const play=document.createElement("button");play.type="button";play.textContent="▶ 試聴";play.disabled=!state.files.has(r.file)&&!state.entries.has(r.file);play.addEventListener("click",()=>preview(r.file,play));
  const status=document.createElement("span");status.className="vb-state";status.textContent=play.disabled?"WAVなし":(r.valid?"OK":"数値要確認");el.append(info,status,play);frag.append(el);
 });
 root.append(frag);if(state.rows.length>5000)$("vbSummary").textContent+=" / 表示は先頭5000件";
}
async function preview(path,button){
 try{button.disabled=true;button.textContent="準備中…";let blob=state.files.get(path);if(!blob){const e=state.entries.get(path);if(!e)throw Error("WAVが見つかりません");blob=await zipFile(e);}
  if(state.audioUrl)URL.revokeObjectURL(state.audioUrl);state.audioUrl=URL.createObjectURL(blob);const audio=$("vbAudio");audio.src=state.audioUrl;audio.classList.remove("hidden");await audio.play();button.textContent="▶ 再試聴";
 }catch(e){$("vbStatus").textContent="試聴エラー: "+e.message;button.textContent="▶ 試聴";}finally{button.disabled=false;}
}
async function loadFiles(files,mode,options={}){
 stopSinging();decodedCache.clear();state.entries.clear();state.files.clear();state.rows=[];state.prefixMap.clear();state.archive=null;$("vbStatus").textContent="音源を調べています…";$("vbRows").replaceChildren();
 const list=Array.from(files||[]);if(!list.length)throw Error("ファイルが選択されていません。");
 if(mode==="zip"){
  state.archive=list[0];state.entries=await readZip(list[0]);const oto=[...state.entries.values()].filter(e=>e.name.toLowerCase().endsWith("oto.ini"));
  if(!oto.length)throw Error("ZIP内にoto.iniが見つかりません。音源フォルダごとZIPにしてください。");
  const readText=async e=>{const raw=await(await zipFile(e)).arrayBuffer();try{return new TextDecoder("utf-8",{fatal:true}).decode(raw);}catch(_){return new TextDecoder("shift_jis").decode(raw);}};
  for(const e of oto){if(e.usize>MAX_TEXT)throw Error("oto.iniが大きすぎます（16MB上限）。");const txt=await readText(e),dir=e.name.slice(0,e.name.lastIndexOf("/")+1);state.rows.push(...parseOto(txt,dir));}
  const pm=[...state.entries.values()].filter(e=>e.name.toLowerCase().endsWith("/prefix.map")||e.name.toLowerCase()==="prefix.map").sort((a,b)=>a.name.length-b.name.length)[0];
  if(pm)parsePrefixMap(await readText(pm));
 }else{
  for(const f of list){const path=norm(f.webkitRelativePath||f.name);if(path.toLowerCase().endsWith(".wav"))state.files.set(path,f);}
  const oto=list.filter(f=>f.name.toLowerCase()==="oto.ini");if(!oto.length)throw Error("選択フォルダ内にoto.iniが見つかりません。音源の一番上のフォルダを選択してください。");
  const readText=async f=>{const raw=await f.arrayBuffer();try{return new TextDecoder("utf-8",{fatal:true}).decode(raw);}catch(_){return new TextDecoder("shift_jis").decode(raw);}};
  for(const f of oto){const path=norm(f.webkitRelativePath||f.name),dir=path.slice(0,path.lastIndexOf("/")+1);state.rows.push(...parseOto(await readText(f),dir));}
  const pm=list.filter(f=>f.name.toLowerCase()==="prefix.map").sort((a,b)=>(a.webkitRelativePath||a.name).length-(b.webkitRelativePath||b.name).length)[0];
  if(pm)parsePrefixMap(await readText(pm));
 }
 if(!state.rows.length)throw Error("oto.iniは見つかりましたが、有効な設定行がありません。");
 const missing=state.rows.filter(r=>!state.files.has(r.file)&&!state.entries.has(r.file)).length;render();
 $("vbStatus").textContent="読み込み完了！ oto.ini "+state.rows.length+"件 / WAV "+(state.files.size+[...state.entries.keys()].filter(x=>x.toLowerCase().endsWith(".wav")).length)+"件 / WAV欠損参照 "+missing+"件。音源データは端末内で処理され、サーバーには送信されません。";
 if(mode==="zip"&&options.persist!==false){
  $("vbStatus").textContent+="\n端末内ストレージへ音源ZIPを保存しています…";
  try{await saveVoicebankArchive(list[0]);$("vbStatus").textContent+="\n端末内保存完了。次回起動時に自動復元します。";}
  catch(error){$("vbStatus").textContent+="\n端末内保存は未完了（"+error.message+"）。この画面を閉じると再読み込みが必要です。";}
 }
}
$("vbZip").addEventListener("change",async e=>{try{await loadFiles(e.target.files,"zip");}catch(err){$("vbStatus").textContent="読み込みエラー: "+err.message;}e.target.value="";});
$("vbFolder").addEventListener("change",async e=>{try{await loadFiles(e.target.files,"folder");}catch(err){$("vbStatus").textContent="読み込みエラー: "+err.message;}e.target.value="";});
$("vbClear").addEventListener("click",()=>{deleteVoicebankArchive().catch(()=>{});stopSinging();decodedCache.clear();state.entries.clear();state.files.clear();state.rows=[];state.prefixMap.clear();state.archive=null;if(state.audioUrl)URL.revokeObjectURL(state.audioUrl);state.audioUrl=null;$("vbAudio").removeAttribute("src");$("vbAudio").classList.add("hidden");$("vbRows").replaceChildren();$("vbSummary").textContent="音源はまだ読み込まれていません。";$("vbStatus").textContent="読み込みデータを消去しました。";});

const decodedCache=new Map();let synthContext=null,synthSources=[];
function noteHz(p){const m=String(p||"").trim().toUpperCase().match(/^([A-G])([#B]?)(-?\d)$/);if(!m)return 0;const sem={C:0,D:2,E:4,F:5,G:7,A:9,B:11}[m[1]]+(m[2]==="#"?1:m[2]==="B"?-1:0);return 440*Math.pow(2,((Number(m[3])+1)*12+sem-69)/12);}
function vowelOf(s){
 const t=String(s||"").trim().normalize("NFC").toLowerCase();
 if(!t)return "";
 if(t==="ng")return "N";
 const last=t.slice(-1);
 const kana={
  a:"ぁあかがさざただなはばぱまゃやらわァアカガサザタダナハバパマャヤラワ",
  e:"ぇえけげせぜてでねへべぺめれゑェエケゲセゼテデネヘベペメレヱ",
  i:"ぃいきぎしじちぢにひびぴみりゐィイキギシジチヂニヒビピミリヰ",
  o:"ぉおこごそぞとどのほぼぽもょよろをォオコゴソゾトドノホボポモョヨロヲ",
  u:"ぅうくぐすずつづぬふぶぷむゅゆるゔゥウクグスズツヅヌフブプムュユルヴ"
 };
 for(const [v,chars] of Object.entries(kana))if(chars.includes(last))return v;
 if(last==="ん")return "n";
 if(last==="ン")return "N";
 const roman=t.match(/[aiueo]$/);return roman?roman[0]:"";
}
function aliasKey(s){
 return String(s||"").normalize("NFC").trim().toLowerCase()
  .replaceAll("\t"," ").replaceAll("\r"," ").replaceAll("\n"," ")
  .split(" ").filter(Boolean).join(" ");
}
function pitchNumber(p){
 const m=String(p||"").trim().toUpperCase().match(/^([A-G])([#B]?)(-?\d)$/);if(!m)return null;
 const sem={C:0,D:2,E:4,F:5,G:7,A:9,B:11}[m[1]]+(m[2]==="#"?1:m[2]==="B"?-1:0);
 return (Number(m[3])+1)*12+sem;
}
function parsePrefixMap(text){
 state.prefixMap.clear();
 for(const line of String(text||"").replace(/^\uFEFF/,"").split(/\r?\n/)){
  if(!line.trim()||line.trim().startsWith(";"))continue;
  const fields=line.split("\t");
  const note=(fields[0]||"").trim(),m=note.match(/^([A-G])([#B]?)(-?\d)$/i);
  if(!m)continue;
  const prefix=String(fields[1]||"").trim(),suffix=String(fields[2]||"").trim();
  state.prefixMap.set(pitchNumber(note),{prefix,suffix,note});
 }
}
function chooseRow(lyric,previous,first,pitch){
 const target=String(lyric||"").trim().normalize("NFC"),prev=vowelOf(previous);
 if(!target)return null;
 const candidates=prev?[prev+" "+target,"* "+target,target,"- "+target,prev+target,prev+"-"+target,prev+"_"+target]:["- "+target,target,"-"+target,"_ "+target,"_"+target];
 const midi=pitchNumber(pitch),mapped=midi===null?null:state.prefixMap.get(midi);
 const lookup=new Map();
 for(const row of state.rows){const key=aliasKey(row.alias);if(!lookup.has(key))lookup.set(key,[]);lookup.get(key).push(row);}
 const variants=[];
 if(mapped){
  for(const c of candidates)variants.push(mapped.prefix+c+mapped.suffix);
 }
 for(const c of candidates)variants.push(c);
 for(const candidate of variants){
  const rows=lookup.get(aliasKey(candidate));if(!rows||!rows.length)continue;
  if(rows.length===1)return rows[0];
  if(midi!==null){
   const ranked=rows.map(row=>{
    const match=row.file.match(/(?:^|\/)([A-G])([#B]?)(-?\d)(?:\/|$)/i);
    const root=match?pitchNumber(match[1]+match[2]+match[3]):null;
    return {row,distance:root===null?Infinity:Math.abs(root-midi)};
   }).sort((a,b)=>a.distance-b.distance);
   if(Number.isFinite(ranked[0].distance))return ranked[0].row;
  }
  return rows[0];
 }
 return null;
}
async function sampleBuffer(path){
 if(decodedCache.has(path))return decodedCache.get(path);
 let blob=state.files.get(path);if(!blob){const entry=state.entries.get(path);if(!entry)throw Error("原音WAVが見つかりません: "+path);blob=await zipFile(entry);}
 const AC=window.AudioContext||window.webkitAudioContext;if(!AC)throw Error("このブラウザは音声合成に対応していません。");
 synthContext=synthContext||new AC();if(synthContext.state==="suspended")await synthContext.resume();
 const buffer=await synthContext.decodeAudioData(await blob.arrayBuffer());
 decodedCache.set(path,buffer);
 if(decodedCache.size>48)decodedCache.delete(decodedCache.keys().next().value);
 return buffer;
}
async function playNotes(notes,options={}){
 if(!state.rows.length)throw Error("先にUTAU音源を読み込んでください。");
 if(!Array.isArray(notes)||!notes.length)throw Error("曲に音符がありません。");
 const AC=window.AudioContext||window.webkitAudioContext;if(!AC)throw Error("音声再生に対応していません。");
 synthContext=synthContext||new AC();await synthContext.resume();
 synthSources.forEach(s=>{try{s.stop()}catch(_){}});synthSources=[];
 const octave=Math.max(-2,Math.min(2,Number(options.octave)||0));
 const transposePitch=p=>{const midi=pitchNumber(p);if(midi===null)return p;const names=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'],value=midi+octave*12;return names[((value%12)+12)%12]+(Math.floor(value/12)-1);};
 const ordered=notes.slice().sort((a,b)=>Number(a.start)-Number(b.start)),plans=[],missing=[];let previous="",previousEnd=-Infinity;
 for(const n of ordered){
  const start=Math.max(0,Number(n.start)||0),beats=Math.max(.05,Number(n.beats)||1);
  const first=start-previousEnd>.05,playPitch=transposePitch(n.pitch),row=chooseRow(n.lyric,first?"":previous,first,playPitch);
  previous=n.lyric;previousEnd=start+beats;
  if(!row||!row.valid){missing.push(String(n.lyric||"（空欄）"));continue;}
  try{const buffer=await sampleBuffer(row.file);plans.push({n,row,buffer,start,beats,playPitch});}catch(e){missing.push(String(n.lyric||"（WAV読込失敗）"));}
 }
 if(missing.length)throw Error("対応する原音が見つからない音符があります: "+[...new Set(missing)].slice(0,8).join("、"));
 if(!plans.length)throw Error("再生できる原音がありません。");
 const bpm=Math.max(40,Math.min(240,Number(options.bpm)||120)),unit=60/bpm,volume=Math.max(0,Math.min(100,Number(options.volume??35)))/100*.65,now=synthContext.currentTime+.08;
 const invalidPitch=plans.filter(p=>!noteHz(p.n.pitch)).map(p=>String(p.n.pitch||"（空欄）"));
 if(invalidPitch.length)throw Error("音程の形式を確認してください: "+[...new Set(invalidPitch)].slice(0,8).join("、")+"。例：C4 / D#4 / F#3");
 if(!plans.length)throw Error("再生できる原音がありません。歌詞とoto.iniのエイリアスを確認してください。");
 for(let i=0;i<plans.length;i++){
  const {n,row,buffer,start,beats,playPitch}=plans[i],next=plans[i+1],hz=noteHz(playPitch);
  const folderPitch=row.file.split("/").find(part=>/^[A-G](?:#|b)?-?\d$/i.test(part));
  const root=folderPitch?noteHz(folderPitch):noteHz("C4"),rate=Math.max(.5,Math.min(2.0,hz/(root||noteHz("C4"))));
  const offset=Math.min(Math.max(0,row.offset/1000),Math.max(0,buffer.duration-.02)),tail=Math.max(0,Math.abs(row.cutoff)/1000),available=Math.max(.02,buffer.duration-offset-tail);
  // Beta playback is monophonic: do not let preutterance/overlap start the next
  // pitch early or extend the previous pitch into it. Full UTAU VCV crossfading
  // needs a resampler/phonemizer and otherwise sounds like simultaneous singers.
  const noteStart=now+start*unit,startAt=noteStart;
  const nominalEnd=noteStart+beats*unit,nextStart=next?now+next.start*unit:nominalEnd;
  const endAt=next?Math.min(nominalEnd,nextStart):nominalEnd;
  const targetDuration=Math.max(.02,endAt-startAt),sourceDuration=Math.min(available,targetDuration*rate);
  const actualEnd=startAt+sourceDuration/rate,fadeIn=Math.min(.025,targetDuration*.12),fadeOut=Math.min(.045,targetDuration*.2);
  const source=synthContext.createBufferSource(),gain=synthContext.createGain();source.buffer=buffer;source.playbackRate.setValueAtTime(rate,startAt);
  gain.gain.setValueAtTime(0,startAt);gain.gain.linearRampToValueAtTime(volume,startAt+fadeIn);
  gain.gain.setValueAtTime(volume,Math.max(startAt+fadeIn,actualEnd-fadeOut));gain.gain.linearRampToValueAtTime(0,actualEnd);
  source.connect(gain).connect(synthContext.destination);source.start(startAt,offset,sourceDuration);synthSources.push(source);
 }
 return {scheduled:plans.length,aliases:plans.map(p=>p.row.alias)};
}
function stopSinging(){synthSources.forEach(s=>{try{s.stop()}catch(_){}});synthSources=[];}
window.VoiceBankStudioVoicebank={isReady:()=>state.rows.length>0,getArchiveFile:()=>state.archive,getAliases:()=>state.rows.map(row=>row.alias),playNotes,stop:stopSinging,getStatus:()=>({otoEntries:state.rows.length,prefixMapEntries:state.prefixMap.size,zipLoaded:!!state.archive})};
(async()=>{
 try{
  const saved=await getVoicebankArchive();if(!saved||!saved.blob||!saved.blob.size)return;
  if(state.rows.length)return;
  $("vbStatus").textContent="端末内に保存されたUTAU音源を復元しています…";
  const file=new File([saved.blob],saved.name||"saved-voicebank.zip",{type:saved.type||"application/zip"});
  await loadFiles([file],"zip",{persist:false});
  $("vbStatus").textContent+="\n保存済み音源を復元しました。再アップロードは不要です。";
 }catch(error){$("vbStatus").textContent="保存済み音源の自動復元に失敗しました: "+error.message+"。必要ならZIPを再選択してください。";}
})();

})();