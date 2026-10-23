export class PushToTalk {
  constructor({button,listenButton,status,api,notice,onSpeaker=()=>{}}){
    Object.assign(this,{button,listenButton,status,api,notice,onSpeaker});
    this.online=false;this.held=false;this.starting=false;this.speaker=null;this.sources=new Set();this.queue=[];this.generation=0;this.listening=true;
    try{this.listening=localStorage.getItem('holdem-voice-listen')!=='off';}catch{}
    button.onpointerdown=e=>{if(e.button!==0)return;e.preventDefault();button.setPointerCapture(e.pointerId);this.begin();};
    button.onpointerup=()=>this.end();button.onpointercancel=()=>this.end();button.onlostpointercapture=()=>this.end();
    button.onkeydown=e=>{if([' ','Enter'].includes(e.key)){e.preventDefault();if(!e.repeat)this.begin();}};
    button.onkeyup=e=>{if([' ','Enter'].includes(e.key)){e.preventDefault();this.end();}};
    button.oncontextmenu=e=>e.preventDefault();button.onblur=()=>this.end();
    listenButton.onclick=()=>{this.listening=!this.listening;try{localStorage.setItem('holdem-voice-listen',this.listening?'on':'off');}catch{}if(!this.listening)this.clearPlayback();else this.unlock();this.render();};
    document.addEventListener('pointerdown',()=>this.unlock(),{capture:true});document.addEventListener('keydown',()=>this.unlock(),{capture:true});
    document.addEventListener('visibilitychange',()=>{if(document.hidden)this.end();});
    window.addEventListener('blur',()=>this.end());window.addEventListener('pagehide',()=>{this.end();this.clearPlayback();});
    this.render();
  }
  async unlock(){
    try{
      if(!this.context){const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)return;this.context=new Audio();}
      if(this.context.state==='suspended')await this.context.resume();
    }catch{}this.render();
  }
  sync(speaker,me,online){
    this.me=me;this.online=online;this.speaker=online?speaker:null;
    if(!online){this.end();this.clearPlayback();}else if(this.id&&this.speaker?.id!==this.id)this.end();
    this.onSpeaker(this.speaker);this.render();
  }
  render(){
    this.button.disabled=!this.online||(!this.held&&!!this.speaker);
    this.button.textContent=this.held?(this.id?'🔴 松开结束':'🎙 正在准备…'):'🎙 按住说话';
    this.button.classList.toggle('recording',this.held&&!!this.id);this.button.setAttribute('aria-pressed',String(this.held&&!!this.id));
    this.listenButton.textContent=this.listening?'🔊 收听':'🔇 收听';this.listenButton.setAttribute('aria-pressed',String(this.listening));
    const message=this.held&&this.id?'正在向全桌说话 · 松开结束（最多30秒）':this.speaker?this.speaker.name+' 正在说话':!this.online?'连接牌桌后可语音':this.listening&&this.context?.state!=='running'?'点击页面开启收听':'按住说话，其他人实时收听';
    if(this.status.textContent!==message)this.status.textContent=message;
  }
  async begin(){
    if(this.held||this.starting||!this.online||this.speaker)return;
    if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia){this.notice('语音需要 HTTPS 安全连接，请从 https://'+location.host+' 打开');return;}
    this.held=true;this.starting=true;const generation=++this.generation;this.render();
    let stream;
    try{
      await this.unlock();if(!this.held||generation!==this.generation)return;
      if(!this.context?.audioWorklet)throw Error('当前浏览器不支持实时语音，请使用新版 Chrome、Edge 或 Safari');
      stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
      if(!this.held||generation!==this.generation){stream.getTracks().forEach(t=>t.stop());this.notice('麦克风已就绪，请再次按住说话');return;}
      this.stream=stream;
      this.workletLoaded??=this.context.audioWorklet.addModule('/voice-capture.js').catch(e=>{this.workletLoaded=null;throw e;});await this.workletLoaded;
      if(!this.held||generation!==this.generation)return;
      const result=await this.request('start');
      if(!this.held||generation!==this.generation){this.stopRequest(result.speaker.id);return;}
      this.id=result.speaker.id;this.speaker=result.speaker;this.seq=0;this.queue=[];
      this.input=this.context.createMediaStreamSource(stream);this.processor=new AudioWorkletNode(this.context,'voice-capture');
      this.silent=this.context.createGain();this.silent.gain.value=0;
      this.processor.port.onmessage=e=>{
        if(!this.held||!this.id)return;
        if(this.queue.length>=5){this.notice('网络较慢，已停止发言，请重试');this.end();return;}
        const bytes=new Uint8Array(e.data);let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);
        this.queue.push({id:this.id,seq:this.seq++,audio:btoa(binary)});this.pump();
      };
      this.input.connect(this.processor);this.processor.connect(this.silent);this.silent.connect(this.context.destination);
      for(const track of stream.getTracks())track.onended=()=>{if(this.held){this.notice('麦克风已断开');this.end();}};
      this.limitTimer=setTimeout(()=>{this.notice('本次发言已满30秒，松开后可再次说话');this.end();},29500);
      this.onSpeaker(this.speaker);this.render();
    }catch(error){
      stream?.getTracks().forEach(t=>t.stop());
      if(generation===this.generation){this.notice(error.name==='NotAllowedError'?'未获得麦克风权限，请在浏览器地址栏允许麦克风后重试':error.name==='NotFoundError'?'未找到麦克风，请连接设备后重试':error.message||'无法开启麦克风');this.end();}
    }finally{this.starting=false;this.render();}
  }
  async pump(){
    if(this.sending)return;this.sending=true;
    try{
      while(this.held&&this.queue.length){const chunk=this.queue.shift();try{await this.request('chunk',chunk);}catch(error){if(this.id===chunk.id){this.notice(error.message);this.end();}break;}}
    }finally{this.sending=false;}
  }
  async request(route,data={}){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);
    try{
      const response=await fetch('/api/voice/'+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),signal:controller.signal});
      const result=await response.json();if(!response.ok)throw Error(result.error||'语音连接失败');return result;
    }catch(error){if(error.name==='AbortError')throw Error('语音网络超时，请重新按住说话');throw error;}finally{clearTimeout(timer);}
  }
  stopRequest(id){if(id)fetch('/api/voice/stop',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id}),keepalive:true}).catch(()=>{});}
  end(){
    this.held=false;this.generation++;clearTimeout(this.limitTimer);const id=this.id;this.id=null;this.queue=[];
    if(this.processor){this.processor.port.onmessage=null;this.processor.disconnect();this.processor.port.close();this.processor=null;}
    this.input?.disconnect();this.input=null;this.silent?.disconnect();this.silent=null;
    this.stream?.getTracks().forEach(t=>{t.onended=null;t.stop();});this.stream=null;
    this.stopRequest(id);this.render();
  }
  receive(data){
    if(!this.online||data.playerId===this.me||!this.listening||this.context?.state!=='running')return;
    if(data.id===this.lastId&&data.seq<=this.lastSeq)return;
    this.lastId=data.id;this.lastSeq=data.seq;
    try{
      const raw=atob(data.audio);if(raw.length!==3200)return;
      const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0)),pcm=new DataView(bytes.buffer),ctx=this.context;
      if(this.nextPlay>ctx.currentTime+.65)return;
      const buffer=ctx.createBuffer(1,1600,16000),out=buffer.getChannelData(0);for(let i=0;i<1600;i++)out[i]=pcm.getInt16(i*2,true)/32768;
      const source=ctx.createBufferSource();source.buffer=buffer;source.connect(ctx.destination);
      const start=Math.max(ctx.currentTime+.06,this.nextPlay||0);source.start(start);this.nextPlay=start+.1;this.sources.add(source);
      source.onended=()=>{this.sources.delete(source);source.disconnect();};
    }catch{}
  }
  clearPlayback(){for(const s of this.sources){try{s.stop();}catch{}}this.sources.clear();this.nextPlay=0;}
}
