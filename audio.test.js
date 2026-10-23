import test from 'node:test';
import assert from 'node:assert/strict';
import {RoomAudio} from './public/audio.js';

test('audio uses layered effects without action narration, limits stale events, and stops on mute',()=>{
  const originalWindow=globalThis.window,originalStorage=globalThis.localStorage;
  const spoken=[],nodes=[];
  const param=()=>({value:0,setValueAtTime(v){assert.ok(Number.isFinite(v));},exponentialRampToValueAtTime(v){assert.ok(Number.isFinite(v)&&v>0);}});
  const node=()=>{const n={connect(){},disconnect(){},start(){this.started=true;},stop(){this.stopped=true;},frequency:param(),gain:param(),Q:param()};nodes.push(n);return n;};
  class Context{
    state='running';currentTime=0;sampleRate=44100;
    createGain(){return node();}createOscillator(){return node();}createBufferSource(){return node();}createBiquadFilter(){return node();}
    createDynamicsCompressor(){return {...node(),threshold:param(),knee:param(),ratio:param()};}
    createBuffer(n,length){return {getChannelData:()=>new Float32Array(length)};}
  }
  globalThis.localStorage={getItem:()=>null,setItem(){}};
  globalThis.window={AudioContext:Context,SpeechSynthesisUtterance:class{constructor(text){this.text=text;}},speechSynthesis:{getVoices:()=>[{lang:'zh-CN',name:'Chinese'},{lang:'zh-CN',name:'Xiaoxiao Natural'}],speak:u=>spoken.push(u),cancel(){}}};
  try{
    const audio=new RoomAudio();audio.prime();
    for(const kind of ['fold','check','call','raise','allin','deal','win','egg','egg-impact','flower','turn']){
      audio.context.currentTime+=1;const before=nodes.length;
      audio.enqueue({type:kind==='egg'||kind==='flower'?'reaction':'action',kind,at:Date.now()});
      assert.ok(nodes.length>before,kind+' produces an effect');
      for(const source of [...audio.sources])source.onended();
    }
    assert.equal(spoken.length,0,'ordinary actions are not spoken');
    const before=nodes.length;audio.enqueue({kind:'raise',at:Date.now()-10000});assert.equal(nodes.length,before);
    audio.context.currentTime+=1;audio.enqueue({type:'chat',text:'打得不错',at:Date.now()});
    assert.equal(spoken[0].text,'打得不错');assert.equal(spoken[0].voice.name,'Xiaoxiao Natural');
    const sources=[...audio.sources];audio.toggle();assert.equal(audio.enabled,false);assert.equal(audio.current,null);assert.equal(audio.sources.size,0);assert.ok(sources.every(n=>n.stopped));
    const mutedCount=nodes.length;audio.enqueue({kind:'turn',at:Date.now()});assert.equal(nodes.length,mutedCount);
  }finally{globalThis.window=originalWindow;globalThis.localStorage=originalStorage;}
});
