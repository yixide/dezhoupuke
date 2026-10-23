// All table effects are synthesized locally; no audio downloads or paid services.
export class RoomAudio {
  constructor(onStatus=()=>{}) {
    this.onStatus=onStatus;this.enabled=true;this.ready=false;this.queue=[];this.current=null;this.sources=new Set();this.lastEffect=-Infinity;
    try{this.enabled=localStorage.getItem('holdem-sound')!=='off';}catch{}
  }
  prime(){
    try{
      if(!this.context){
        const Audio=window.AudioContext||window.webkitAudioContext;
        if(Audio){
          const ctx=this.context=new Audio();this.master=ctx.createGain();this.master.gain.value=.55;
          const limiter=ctx.createDynamicsCompressor();limiter.threshold.value=-20;limiter.knee.value=12;limiter.ratio.value=8;
          this.master.connect(limiter);limiter.connect(ctx.destination);
          this.noise=ctx.createBuffer(1,Math.ceil(ctx.sampleRate*.3),ctx.sampleRate);
          const data=this.noise.getChannelData(0);for(let i=0;i<data.length;i++)data[i]=Math.random()*2-1;
        }
      }
      if(this.context?.state==='suspended')this.context.resume().catch(()=>{});
    }catch{}
    if(!this.ready){this.ready=true;this.onStatus(this.enabled?'就绪':'已静音');}
  }
  toggle(){
    this.prime();this.enabled=!this.enabled;
    try{localStorage.setItem('holdem-sound',this.enabled?'on':'off');}catch{}
    if(!this.enabled){
      this.queue=[];this.current=null;clearTimeout(this.watchdog);window.speechSynthesis?.cancel();
      for(const source of this.sources){try{source.stop();}catch{}}this.sources.clear();
    }
    this.onStatus(this.enabled?'就绪':'已静音');return this.enabled;
  }
  enqueue(event){
    if(!this.enabled||!this.ready||event.kind==='blind'||Date.now()-event.at>4000)return;
    this.effect(event);
    // Short table sounds replace robotic narration of every bet and player name.
    if(event.type!=='chat')return;
    this.queue.push(event);this.queue=this.queue.slice(-2);this.drain();
  }
  note(frequency,delay,duration,volume=.12,type='sine',endFrequency=frequency){
    const ctx=this.context,source=ctx.createOscillator();source.type=type;
    const start=ctx.currentTime+delay;source.frequency.setValueAtTime(frequency,start);source.frequency.exponentialRampToValueAtTime(endFrequency,start+duration);
    this.play(source,start,duration,volume);
  }
  rustle(delay,duration,frequency=1800,volume=.15){
    const ctx=this.context,source=ctx.createBufferSource(),filter=ctx.createBiquadFilter();
    source.buffer=this.noise;filter.type='bandpass';filter.frequency.value=frequency;filter.Q.value=.7;
    source.connect(filter);this.play(source,ctx.currentTime+delay,duration,volume,filter);
  }
  play(source,start,duration,volume,output=source){
    const gain=this.context.createGain();gain.gain.setValueAtTime(.0001,start);gain.gain.exponentialRampToValueAtTime(volume,start+.006);gain.gain.exponentialRampToValueAtTime(.0001,start+duration);
    output.connect(gain);gain.connect(this.master);this.sources.add(source);
    source.onended=()=>{this.sources.delete(source);source.disconnect();if(output!==source)output.disconnect();gain.disconnect();};
    source.start(start);source.stop(start+duration+.01);
  }
  effect(event){
    try{
      const ctx=this.context;if(!ctx||ctx.state!=='running'||this.sources.size>24)return;
      if(ctx.currentTime-this.lastEffect<.09)return;this.lastEffect=ctx.currentTime;
      const kind=event.type==='chat'?'chat':event.kind;
      const jitter=()=>.96+Math.random()*.08;
      const chip=(delay=0)=>{this.note(1750*jitter(),delay,.065,.1,'triangle',1100);this.rustle(delay,.045,3200,.07);};
      if(kind==='fold'){this.rustle(0,.14,1100,.17);this.rustle(.05,.13,700,.1);}
      else if(kind==='check'){this.note(190,0,.09,.2,'sine',90);this.note(180,.105,.08,.14,'sine',85);}
      else if(['call','raise','allin'].includes(kind)){
        const count=kind==='allin'?5:kind==='raise'?3:2;for(let i=0;i<count;i++)chip(i*.055);
        if(kind==='allin')this.note(330,.16,.28,.09,'sine',440);
      }else if(kind==='deal'){for(let i=0;i<3;i++)this.rustle(i*.09,.085,1800*jitter(),.13);}
      else if(kind==='turn'){this.note(660,0,.2,.12);this.note(880,.16,.24,.1);}
      else if(kind==='win'){[523.25,659.25,783.99].forEach((f,i)=>this.note(f,i*.085,.32,.09));}
      else if(kind==='egg'){this.rustle(0,.18,1400,.1);}
      else if(kind==='egg-impact'){this.rustle(0,.045,3800,.22);this.note(190,.02,.14,.2,'sine',55);this.rustle(.035,.2,650,.22);this.rustle(.09,.12,1200,.12);}
      else if(kind==='flower'){[880,1174.66,1318.51].forEach((f,i)=>this.note(f,i*.08,.28,.07));}
      else if(kind==='chat'){this.note(660,0,.12,.055);}
    }catch{}
  }
  drain(){
    if(this.current||!this.enabled||!this.queue.length)return;
    const event=this.queue.shift();if(Date.now()-event.at>4000){this.drain();return;}
    const synth=window.speechSynthesis;if(!synth||!window.SpeechSynthesisUtterance){this.drain();return;}
    const utterance=new window.SpeechSynthesisUtterance(event.text);this.current=utterance;
    utterance.lang='zh-CN';utterance.rate=1;utterance.pitch=1;utterance.volume=.65;
    const score=v=>(/zh[-_]CN/i.test(v.lang)?4:0)+(/natural|neural|xiaoxiao|xiaoyi|tingting|ting-ting|自然/i.test(v.name)?8:0)+(v.default?1:0);
    const voice=synth.getVoices().filter(v=>/^zh/i.test(v.lang)).sort((a,b)=>score(b)-score(a))[0];if(voice)utterance.voice=voice;
    const finish=()=>{if(this.current!==utterance)return;clearTimeout(this.watchdog);this.current=null;this.onStatus('就绪');this.drain();};
    utterance.onstart=()=>this.onStatus(`聊天：${event.text}`);utterance.onend=finish;utterance.onerror=finish;
    this.watchdog=setTimeout(()=>{if(this.current!==utterance)return;this.current=null;synth.cancel();this.onStatus('就绪');this.drain();},6000);
    try{synth.speak(utterance);}catch{finish();}
  }
}
