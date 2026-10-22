// Browser speech synthesis needs a click or key press before it can speak.
export class RoomAudio {
  constructor(onStatus=()=>{}) {
    this.onStatus=onStatus;this.enabled=true;this.ready=false;this.queue=[];this.current=null;
    try{this.enabled=localStorage.getItem('holdem-sound')!=='off';}catch{}
  }
  prime(){
    if(this.ready)return;this.ready=true;
    try{const Audio=window.AudioContext||window.webkitAudioContext;if(Audio){this.context=new Audio();this.context.resume().catch(()=>{});}}catch{}
    this.onStatus(this.enabled?'就绪':'已静音');
  }
  toggle(){
    this.prime();this.enabled=!this.enabled;
    try{localStorage.setItem('holdem-sound',this.enabled?'on':'off');}catch{}
    if(!this.enabled){this.queue=[];this.current=null;clearTimeout(this.watchdog);window.speechSynthesis?.cancel();}
    this.onStatus(this.enabled?'就绪':'已静音');return this.enabled;
  }
  enqueue(event){
    if(!this.enabled||!this.ready||event.kind==='blind')return;
    this.queue.push(event);this.queue=this.queue.slice(-3);this.drain();
  }
  beep(event){
    try{
      const ctx=this.context;if(!ctx||ctx.state!=='running')return;
      const osc=ctx.createOscillator(),gain=ctx.createGain(),now=ctx.currentTime;
      osc.type='sine';osc.frequency.value=event.type==='chat'?880:({fold:240,check:400,call:520,raise:680,allin:760}[event.kind]||520);
      gain.gain.setValueAtTime(.001,now);gain.gain.exponentialRampToValueAtTime(.09,now+.01);gain.gain.exponentialRampToValueAtTime(.001,now+.16);
      osc.connect(gain);gain.connect(ctx.destination);osc.start(now);osc.stop(now+.17);
    }catch{}
  }
  drain(){
    if(this.current||!this.enabled||!this.queue.length)return;
    const event=this.queue.shift();if(Date.now()-event.at>10000){this.drain();return;}
    const text=event.type==='chat'?`${event.name}说，${event.text}`:`${event.name}，${event.text}`;
    if(!window.speechSynthesis||!window.SpeechSynthesisUtterance){this.beep(event);this.drain();return;}
    const utterance=new SpeechSynthesisUtterance(text);this.current=utterance;
    utterance.lang='zh-CN';utterance.rate=1.15;
    const voice=speechSynthesis.getVoices().find(v=>v.lang.toLowerCase().startsWith('zh'));if(voice)utterance.voice=voice;
    const finish=()=>{if(this.current!==utterance)return;clearTimeout(this.watchdog);this.current=null;this.onStatus('就绪');this.drain();};
    utterance.onstart=()=>this.onStatus(`正在播报：${text}`);
    utterance.onend=finish;utterance.onerror=()=>{if(this.current!==utterance)return;this.beep(event);finish();};
    this.watchdog=setTimeout(()=>{if(this.current!==utterance)return;speechSynthesis.cancel();this.beep(event);finish();},8000);
    try{speechSynthesis.speak(utterance);}catch{this.beep(event);finish();}
  }
}
