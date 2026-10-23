import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {VoiceRoom} from './voice.js';

test('voice relay authenticates ownership, serializes speaker and chunks, expires locks without persisting audio',()=>{
  let now=100000;const events=[],room=new VoiceRoom((...e)=>events.push(e),()=>now),audio=Buffer.alloc(3200).toString('base64');
  const a=room.start('a','甲');assert.equal(room.state().name,'甲');assert.throws(()=>room.start('b','乙'),/正在说话/);
  assert.throws(()=>room.chunk('b',{id:a.id,seq:0,audio}),/发言已结束/);
  assert.throws(()=>room.chunk('a',{id:a.id,seq:0,audio:'!'.repeat(4268)}),/格式/);
  room.chunk('a',{id:a.id,seq:0,audio});assert.equal(events.at(-1)[0],'voice-audio');assert.equal(events.at(-1)[2],'a');
  assert.throws(()=>room.chunk('a',{id:a.id,seq:0,audio}),/顺序/);
  room.stop('b',a.id);assert.equal(room.state().id,a.id);
  for(let seq=1;seq<6;seq++)room.chunk('a',{id:a.id,seq,audio});assert.throws(()=>room.chunk('a',{id:a.id,seq:6,audio}),/过快/);
  now+=2600;assert.equal(room.state(),null);assert.equal(events.at(-1)[0],'voice-state');
  const b=room.start('b','乙');room.stop('a',a.id);assert.equal(room.state().id,b.id);
  now+=30001;room.expire();assert.equal(room.state(),null);
  room.start('a','甲');room.disconnect('a');assert.equal(room.state(),null);
});

test('capture worklet produces bounded 100ms little-endian PCM at common device sample rates',()=>{
  for(const rate of [44100,48000]){
    let Capture;const frames=[];const context={AudioWorkletProcessor:class{constructor(){this.port={postMessage:b=>frames.push(b)};}},sampleRate:rate,registerProcessor:(name,ctor)=>{assert.equal(name,'voice-capture');Capture=ctor;},ArrayBuffer,DataView,Math};
    vm.runInNewContext(readFileSync(new URL('./public/voice-capture.js',import.meta.url),'utf8'),context);
    const processor=new Capture();for(let offset=0;offset<rate;offset+=128)processor.process([[new Float32Array(Math.min(128,rate-offset)).fill(.5)]]);
    assert.equal(frames.length,10);for(const frame of frames){assert.equal(frame.byteLength,3200);const view=new DataView(frame);for(let i=0;i<1600;i++)assert.equal(view.getInt16(i*2,true),16384);}
  }
});

test('releasing during microphone permission or server setup never leaves the microphone active',async()=>{
  const {PushToTalk}=await import('./public/voice-client.js');
  const originalWindow=globalThis.window,originalDocument=globalThis.document,originalNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator');
  const control=()=>({classList:{toggle(){}},setAttribute(){},textContent:''});
  globalThis.window={isSecureContext:true,addEventListener(){}};globalThis.document={addEventListener(){}};
  try{
    for(const phase of ['permission','server','denied']){
      let grant,reply,stopped=0;const ended=[],notices=[],stream={getTracks:()=>[{stop:()=>stopped++}]};
      Object.defineProperty(globalThis,'navigator',{configurable:true,value:{mediaDevices:{getUserMedia:()=>phase==='permission'?new Promise(resolve=>grant=resolve):phase==='denied'?Promise.reject(Object.assign(Error('denied'),{name:'NotAllowedError'})):Promise.resolve(stream)}}});
      const client=new PushToTalk({button:control(),listenButton:control(),status:control(),notice:s=>notices.push(s)});
      client.online=true;client.context={state:'running',audioWorklet:{addModule:async()=>{}}};client.unlock=async()=>{};client.stopRequest=id=>{if(id)ended.push(id);};client.request=()=>new Promise(resolve=>reply=resolve);
      const pending=client.begin();for(let i=0;i<8;i++)await Promise.resolve();
      client.end();if(grant)grant(stream);if(reply)reply({speaker:{id:'late-grant'}});await pending;
      assert.equal(client.held,false);assert.equal(client.id,null);assert.equal(client.stream,null);
      if(phase!=='denied')assert.equal(stopped,1);else assert.ok(notices.some(s=>s.includes('权限')));
      if(phase==='server')assert.deepEqual(ended,['late-grant']);
    }
  }finally{globalThis.window=originalWindow;globalThis.document=originalDocument;if(originalNavigator)Object.defineProperty(globalThis,'navigator',originalNavigator);else delete globalThis.navigator;}
});
