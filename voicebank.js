(() => {
"use strict";
const $=id=>document.getElementById(id);
const state={entries:new Map(),files:new Map(),rows:[],audioUrl:null,archive:null};
const MAX_ARCHIVE=1024*1024*1024,MAX_ENTRIES=50000,MAX_TEXT=16*1024*1024;
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
 if(blob.size>MAX_ARCHIVE)throw Error("ZIPは1GB以下のものを選択してください。");
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
   total+=usize;if(total>2*1024*1024*1024)throw Error("展開後の合計サイズが2GBを超えます。");
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
async function loadFiles(files,mode){
 stopSinging();decodedCache.clear();state.entries.clear();state.files.clear();state.rows=[];state.archive=null;$("vbStatus").textContent="音源を調べています…";$("vbRows").replaceChildren();
 const list=Array.from(files||[]);if(!list.length)throw Error("ファイルが選択されていません。");
 if(mode==="zip"){
  state.archive=list[0];state.entries=await readZip(list[0]);const oto=[...state.entries.values()].filter(e=>e.name.toLowerCase().endsWith("oto.ini"));
  if(!oto.length)throw Error("ZIP内にoto.iniが見つかりません。音源フォルダごとZIPにしてください。");
  for(const e of oto){if(e.usize>MAX_TEXT)throw Error("oto.iniが大きすぎます（16MB上限）。");const raw=await(await zipFile(e)).arrayBuffer();let txt;try{txt=new TextDecoder("utf-8",{fatal:true}).decode(raw);}catch(_){txt=new TextDecoder("shift_jis").decode(raw);}const dir=e.name.slice(0,e.name.lastIndexOf("/")+1);state.rows.push(...parseOto(txt,dir));}
 }else{
  for(const f of list){const path=norm(f.webkitRelativePath||f.name);if(path.toLowerCase().endsWith(".wav"))state.files.set(path,f);}
  const oto=list.filter(f=>f.name.toLowerCase()==="oto.ini");if(!oto.length)throw Error("選択フォルダ内にoto.iniが見つかりません。音源の一番上のフォルダを選択してください。");
  for(const f of oto){const path=norm(f.webkitRelativePath||f.name),dir=path.slice(0,path.lastIndexOf("/")+1),raw=await f.arrayBuffer();let txt;try{txt=new TextDecoder("utf-8",{fatal:true}).decode(raw);}catch(_){txt=new TextDecoder("shift_jis").decode(raw);}state.rows.push(...parseOto(txt,dir));}
 }
 if(!state.rows.length)throw Error("oto.iniは見つかりましたが、有効な設定行がありません。");
 const missing=state.rows.filter(r=>!state.files.has(r.file)&&!state.entries.has(r.file)).length;render();
 $("vbStatus").textContent="読み込み完了！ oto.ini "+state.rows.length+"件 / WAV "+(state.files.size+[...state.entries.keys()].filter(x=>x.toLowerCase().endsWith(".wav")).length)+"件 / WAV欠損参照 "+missing+"件。音源データは端末内で処理され、サーバーには送信されません。";
}
$("vbZip").addEventListener("change",async e=>{try{await loadFiles(e.target.files,"zip");}catch(err){$("vbStatus").textContent="読み込みエラー: "+err.message;}e.target.value="";});
$("vbFolder").addEventListener("change",async e=>{try{await loadFiles(e.target.files,"folder");}catch(err){$("vbStatus").textContent="読み込みエラー: "+err.message;}e.target.value="";});
$("vbClear").addEventListener("click",()=>{stopSinging();decodedCache.clear();state.entries.clear();state.files.clear();state.rows=[];state.archive=null;if(state.audioUrl)URL.revokeObjectURL(state.audioUrl);state.audioUrl=null;$("vbAudio").removeAttribute("src");$("vbAudio").classList.add("hidden");$("vbRows").replaceChildren();$("vbSummary").textContent="音源はまだ読み込まれていません。";$("vbStatus").textContent="読み込みデータを消去しました。";});

const decodedCache=new Map();let synthContext=null,synthSources=[];
function noteHz(p){const m=String(p||"").trim().toUpperCase().match(/^([A-G])([#B]?)(-?\d)$/);if(!m)return 0;const sem={C:0,D:2,E:4,F:5,G:7,A:9,B:11}[m[1]]+(m[2]==="#"?1:m[2]==="B"?-1:0);return 440*Math.pow(2,((Number(m[3])+1)*12+sem-69)/12);}
function vowelOf(s){
 const t=String(s||"").trim().normalize("NFC").toLowerCase();
 if(!t)return "";
 const last=t.slice(-1);
 const kana={a:"あかがさざただなはばぱまやらわぁゃゎ",i:"いきぎしじちぢにひびぴみりゐぃ",u:"うくぐすずつづぬふぶぷむゆるぅゅ",e:"えけげせぜてでねへべぺめれゑぇ",o:"おこごそぞとどのほぼぽもよろをぉょ"};
 for(const [v,chars] of Object.entries(kana))if(chars.includes(last))return v;
 const roman=t.match(/[aiueo]$/);return roman?roman[0]:"";
}
function aliasKey(s){return String(s||"").normalize("NFC").trim().replace(/\\s+/g," ").toLowerCase();}
function chooseRow(lyric,previous,first=false){
 const target=String(lyric||"").trim().normalize("NFC"),prev=vowelOf(previous),candidates=[];
 if(prev)candidates.push(prev+" "+target,prev+target,prev+"-"+target,prev+"_"+target);
 if(first||!prev)candidates.push("- "+target,"-"+target,"_ "+target,"_"+target);
 candidates.push(target);
 const lookup=new Map();
 for(const row of state.rows){const key=aliasKey(row.alias);if(!lookup.has(key))lookup.set(key,row);}
 for(const candidate of candidates){const row=lookup.get(aliasKey(candidate));if(row)return row;}
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
function chooseRow(lyric,previous){
 const target=String(lyric||"").trim().normalize("NFC"),prev=vowelOf(previous);
 const candidates=prev?[prev+" "+target,prev+target]:["- "+target,"-"+target];
 for(const alias of candidates){const r=state.rows.find(x=>x.alias.normalize("NFC")===alias);if(r)return r;}
 return state.rows.find(x=>x.alias.normalize("NFC")===target)||null;
}
async function playNotes(notes,options={}){
 if(!state.rows.length)throw Error("先にUTAU音源を読み込んでください。");
 if(!Array.isArray(notes)||!notes.length)throw Error("曲に音符がありません。");
 const AC=window.AudioContext||window.webkitAudioContext;if(!AC)throw Error("音声再生に対応していません。");
 synthContext=synthContext||new AC();await synthContext.resume();
 synthSources.forEach(s=>{try{s.stop()}catch(_){}});synthSources=[];
 const ordered=notes.slice().sort((a,b)=>Number(a.start)-Number(b.start)),plans=[],missing=[];let previous="",previousEnd=-Infinity;
 for(const n of ordered){
  const start=Math.max(0,Number(n.start)||0),beats=Math.max(.05,Number(n.beats)||1);
  const first=start-previousEnd>.05,row=chooseRow(n.lyric,first?"":previous,first);
  previous=n.lyric;previousEnd=start+beats;
  if(!row||!row.valid){missing.push(String(n.lyric||"（空欄）"));continue;}
  try{const buffer=await sampleBuffer(row.file);plans.push({n,row,buffer,start,beats});}catch(e){missing.push(String(n.lyric||"（WAV読込失敗）"));}
 }
 if(missing.length)throw Error("対応する原音が見つからない音符があります: "+[...new Set(missing)].slice(0,8).join("、"));
 if(!plans.length)throw Error("再生できる原音がありません。");
 const bpm=Math.max(40,Math.min(240,Number(options.bpm)||120)),unit=60/bpm,volume=Math.max(0,Math.min(100,Number(options.volume??35)))/100*.65,now=synthContext.currentTime+.08;
 for(let i=0;i<plans.length;i++){
  const {n,row,buffer,start,beats}=plans[i],next=plans[i+1],hz=noteHz(n.pitch);if(!hz)continue;
  const folderPitch=row.file.split("/").find(part=>/^[A-G](?:#|b)?-?\d$/i.test(part));
  const root=folderPitch?noteHz(folderPitch[1]):noteHz("C4"),rate=Math.max(.5,Math.min(2.0,hz/(root||noteHz("C4"))));
  const offset=Math.min(Math.max(0,row.offset/1000),Math.max(0,buffer.duration-.02)),tail=Math.max(0,Math.abs(row.cutoff)/1000),available=Math.max(.02,buffer.duration-offset-tail);
  const noteStart=now+start*unit,pre=Math.max(0,row.preutterance/1000),startAt=Math.max(now,noteStart-pre);
  const nominalEnd=noteStart+beats*unit,nextStart=next?now+next.start*unit:nominalEnd;
  const connected=!!next&&next.start<=start+beats+.02,overlap=connected?Math.max(0,next.row.overlap/1000):0;
  const endAt=connected?Math.min(nominalEnd+overlap,nextStart+overlap):nominalEnd;
  const targetDuration=Math.max(.08,endAt-startAt),sourceDuration=Math.min(available,targetDuration*rate);
  const actualEnd=startAt+sourceDuration/rate,fadeIn=Math.min(.025,targetDuration*.12),fadeOut=Math.min(.045,targetDuration*.2);
  const source=synthContext.createBufferSource(),gain=synthContext.createGain();source.buffer=buffer;source.playbackRate.setValueAtTime(rate,startAt);
  gain.gain.setValueAtTime(0,startAt);gain.gain.linearRampToValueAtTime(volume,startAt+fadeIn);
  gain.gain.setValueAtTime(volume,Math.max(startAt+fadeIn,actualEnd-fadeOut));gain.gain.linearRampToValueAtTime(0,actualEnd);
  source.connect(gain).connect(synthContext.destination);source.start(startAt,offset,sourceDuration);synthSources.push(source);
 }
 return {scheduled:plans.length};
}
function stopSinging(){synthSources.forEach(s=>{try{s.stop()}catch(_){}});synthSources=[];}
window.VoiceBankStudioVoicebank={isReady:()=>state.rows.length>0,playNotes,stop:stopSinging};

})();