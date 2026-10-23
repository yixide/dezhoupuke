import {randomUUID} from 'node:crypto';

// Ephemeral, single-speaker relay. PCM never enters saved table state/history.
export class VoiceRoom {
  constructor(emit,now=Date.now){this.emit=emit;this.now=now;this.active=null;this.nextStart=new Map();}
  state(){this.expire();return this.active?{id:this.active.id,playerId:this.active.playerId,name:this.active.name,until:this.active.until}:null;}
  expire(){if(this.active&&(this.now()>this.active.idleUntil||this.now()>=this.active.until))this.release();for(const [id,at]of this.nextStart)if(this.now()-at>60000)this.nextStart.delete(id);}
  release(){if(!this.active)return;this.active=null;this.emit('voice-state',{speaker:null});}
  disconnect(id){if(this.active?.playerId===id)this.release();}
  start(playerId,name){
    this.expire();if(this.active)throw Error(`${this.active.name} 正在说话，请稍后再按`);
    const now=this.now();if(now<(this.nextStart.get(playerId)||0))throw Error('请稍候再说话');
    this.nextStart.set(playerId,now+800);
    this.active={id:randomUUID(),playerId,name,until:now+30000,idleUntil:now+5000,seq:-1,tokens:6,updated:now};
    const speaker=this.state();this.emit('voice-state',{speaker});return speaker;
  }
  chunk(playerId,b){
    this.expire();const a=this.active,now=this.now();
    if(!a||a.playerId!==playerId||b.id!==a.id)throw Error('发言已结束，请重新按住说话');
    if(!Number.isSafeInteger(b.seq)||b.seq!==a.seq+1)throw Error('语音片段顺序错误');
    if(typeof b.audio!=='string'||b.audio.length!==4268||!/^[-A-Za-z0-9+/]+={0,2}$/.test(b.audio))throw Error('语音格式错误');
    const pcm=Buffer.from(b.audio,'base64');if(pcm.length!==3200||pcm.toString('base64')!==b.audio)throw Error('语音格式错误');
    a.tokens=Math.min(6,a.tokens+(now-a.updated)/100);a.updated=now;
    if(a.tokens<1)throw Error('语音发送过快');
    a.tokens--;a.seq=b.seq;a.idleUntil=Math.min(now+2500,a.until);
    this.emit('voice-audio',{id:a.id,playerId,name:a.name,seq:b.seq,audio:b.audio},playerId);
  }
  stop(playerId,id){if(this.active?.playerId===playerId&&this.active.id===id)this.release();}
}
