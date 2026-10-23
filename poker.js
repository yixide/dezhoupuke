import { randomInt, randomUUID } from 'node:crypto';

export function deck() {
  const cards = Array.from({length:52}, (_, i) => i);
  for (let i=51;i>0;i--) { const j=randomInt(i+1); [cards[i],cards[j]]=[cards[j],cards[i]]; }
  return cards;
}
export const rank = c => c%13+2;
export const suit = c => Math.floor(c/13);
export const cardText = c => '♠♥♣♦'[suit(c)] + ({11:'J',12:'Q',13:'K',14:'A'}[rank(c)] || rank(c));
export const categories = ['高牌','一对','两对','三条','顺子','同花','葫芦','四条','同花顺'];
export const QUICK_CHATS=['大家好','到你了','我想一想','快一点吧','这手不错','好牌！','谢谢','不好意思','承让啦','再来一手'];
export const SMALL_BLIND=10,BIG_BLIND=20;
const BLIND_LEVELS=[10,20,30,50,100,150,200,300,500,1000,1500,2000,3000,5000,10000,20000,50000,100000];
export function blindsForHand(number){const level=Math.min(BLIND_LEVELS.length-1,Math.max(0,Math.floor((number-1)/5)));return {small:BLIND_LEVELS[level],big:BLIND_LEVELS[level]*2,level:level+1};}
const score = values => values.concat(Array(6-values.length).fill(0)).reduce((v,n)=>v*15+n,0);
function five(cards) {
  const rs=cards.map(rank).sort((a,b)=>b-a);
  const counts=new Map(); rs.forEach(r=>counts.set(r,(counts.get(r)||0)+1));
  const groups=[...counts].sort((a,b)=>b[1]-a[1]||b[0]-a[0]);
  const unique=[...new Set(rs)];
  let straight=unique.length===5 && unique[0]-unique[4]===4 ? unique[0] : 0;
  if (unique.join(',')==='14,5,4,3,2') straight=5;
  const flush=cards.every(c=>suit(c)===suit(cards[0]));
  if(flush&&straight) return [8,straight];
  if(groups[0][1]===4) return [7,groups[0][0],groups[1][0]];
  if(groups[0][1]===3&&groups[1][1]===2) return [6,groups[0][0],groups[1][0]];
  if(flush) return [5,...rs];
  if(straight) return [4,straight];
  if(groups[0][1]===3) return [3,groups[0][0],...groups.slice(1).map(g=>g[0])];
  if(groups[0][1]===2&&groups[1][1]===2) return [2,...groups.slice(0,2).map(g=>g[0]),groups[2][0]];
  if(groups[0][1]===2) return [1,groups[0][0],...groups.slice(1).map(g=>g[0])];
  return [0,...rs];
}
export function evaluate(cards) {
  if(cards.length<5) throw Error('至少需要五张牌');
  let best={score:-1};
  for(let a=0;a<cards.length-4;a++) for(let b=a+1;b<cards.length-3;b++)
    for(let c=b+1;c<cards.length-2;c++) for(let d=c+1;d<cards.length-1;d++)
      for(let e=d+1;e<cards.length;e++) {
        const chosen=[cards[a],cards[b],cards[c],cards[d],cards[e]], values=five(chosen), n=score(values);
        if(n>best.score) best={score:n,name:categories[values[0]],cards:chosen};
      }
  return best;
}
function handDescription(cards) {
  const v=five(cards),face=n=>({11:'J',12:'Q',13:'K',14:'A'}[n]||n),name=categories[v[0]];
  if(v[0]===8&&v[1]===14)return '皇家同花顺';
  if(v[0]===1||v[0]===3||v[0]===7)return `${name} ${face(v[1])}`;
  if(v[0]===2)return `两对 ${face(v[1])} / ${face(v[2])}`;
  if(v[0]===6)return `葫芦 ${face(v[1])} 带 ${face(v[2])}`;
  return `${name} · ${face(v[1])} 高`;
}

export class Table {
  constructor(saved) {
    Object.assign(this,{players:[],running:false,hand:null,number:0,dealer:-1,history:[],message:'等待管理员开始',nextAt:0,events:[],eventSeq:0,topUps:[],topUpSeq:0},saved);
    if(this.hand&&!this.hand.id)this.hand.id=randomUUID();
    if(this.hand){this.hand.smallBlind??=SMALL_BLIND;this.hand.bigBlind??=BIG_BLIND;this.hand.blindLevel??=1;}
    for(const p of this.players)if(!Number.isInteger(p.avatarHue)||p.avatarHue<0||p.avatarHue>=360)p.avatarHue=randomInt(360);
    this.history=this.history.map((entry,i)=>({...entry,seq:entry.seq??i+1}));
    this.logSeq=Math.max(this.logSeq||0,0,...this.history.map(x=>x.seq));
  }
  log(text) { this.history.push({at:Date.now(),text,seq:++this.logSeq}); this.history=this.history.slice(-300); }
  emit(type,details){const event={...details,type,seq:++this.eventSeq,at:Date.now()};this.events.push(event);this.events=this.events.slice(-50);return event;}
  chat(id,text){
    const p=this.players.find(p=>p.id===id);if(!p)throw Error('请先加入牌桌');
    if(!QUICK_CHATS.includes(text))throw Error('请选择一条快捷聊天');
    if(p.chat&&Date.now()-p.chat.at<3000)throw Error('消息发送太快，请稍等 3 秒');
    const event=this.emit('chat',{id,name:p.name,text});p.chat={text,at:event.at,seq:event.seq};
    this.log(`${p.name}：${text}`);
  }
  add(id,name) {
    if(this.players.length>=9) throw Error('牌桌已满（最多 9 人）');
    if(this.players.some(p=>p.name===name)) throw Error('该名字已被使用，请换一个');
    const p={id,name,avatarHue:randomInt(360),chips:1000,seat:this.players.length,waiting:this.running}; this.players.push(p);
    this.log(`${name} 加入牌桌${this.running?'，下一手参与':''}`); return p;
  }
  requestTopUp(id,amount) {
    const p=this.players.find(p=>p.id===id);if(!p)throw Error('请先加入牌桌');
    if(!Number.isSafeInteger(amount)||amount<1||amount>100000)throw Error('补分数量需为 1～100000 的整数');
    if(this.topUps.some(r=>r.playerId===id&&['pending','approved'].includes(r.status)))throw Error('已有补分申请等待处理或到账');
    this.topUps=this.topUps.filter(r=>['pending','approved'].includes(r.status)).concat(this.topUps.filter(r=>!['pending','approved'].includes(r.status)).slice(-90));
    this.topUps.push({id:++this.topUpSeq,playerId:id,name:p.name,amount,status:'pending',at:Date.now()});
    this.log(`${p.name} 申请补分 ${amount}，等待管理员审批`);
  }
  reviewTopUp(requestId,approve,reviewerId) {
    if(typeof approve!=='boolean')throw Error('请选择同意或拒绝');
    const r=this.topUps.find(r=>r.id===requestId);if(!r||r.status!=='pending')throw Error('申请已处理或不存在');
    if(!this.players.some(p=>p.id===r.playerId))throw Error('该玩家已离开牌桌');
    const total=this.players.reduce((n,p)=>n+p.chips+(p.nextStartTopUp||0),0)+(this.hand&&!this.hand.done?this.hand.seats.reduce((n,s)=>n+s.total,0):0)+this.topUps.filter(r=>r.status==='approved').reduce((n,r)=>n+r.amount,0);
    if(approve&&!Number.isSafeInteger(total+r.amount))throw Error('积分总额超出上限');
    r.status=approve?'approved':'rejected';r.reviewedAt=Date.now();r.reviewerId=reviewerId;
    this.log(`管理员${approve?'同意':'拒绝'} ${r.name} 补分 ${r.amount}${approve&&this.hand&&!this.hand.done?'，本手结算后到账':''}`);
    if(!this.hand||this.hand.done)this.applyTopUps();
  }
  applyTopUps() {
    for(const r of this.topUps.filter(r=>r.status==='approved')){
      const p=this.players.find(p=>p.id===r.playerId);
      if(!p){r.status='cancelled';continue;}
      p.chips+=r.amount;p.eliminated=false;p.sittingOut=false;p.timeouts=0;
      if(!this.running)p.nextStartTopUp=(p.nextStartTopUp||0)+r.amount;
      r.status='applied';r.appliedAt=Date.now();this.log(`${p.name} 补分 ${r.amount} 已到账`);
    }
  }
  cancelTopUps(playerId) {
    for(const r of this.topUps)if((!playerId||r.playerId===playerId)&&['pending','approved'].includes(r.status)){
      r.status='cancelled';this.log(`${r.name} 的补分申请已取消（${playerId?'座位移除':'本场重置'}）`);
    }
  }
  showCards(id,handId,indices) {
    const h=this.hand,s=h?.seats.find(s=>s.id===id);
    if(!h||h.id!==handId||!s)throw Error('手牌已变化，请重新选择亮牌');
    if(!Array.isArray(indices)||!indices.length||indices.length>2||indices.some(i=>i!==0&&i!==1)||new Set(indices).size!==indices.length)throw Error('请选择一张或两张手牌');
    const added=indices.filter(i=>!s.shown?.includes(i));if(!added.length)return;
    s.shown=[...new Set([...(s.shown||[]),...added])].sort();
    this.log(`${this.player(s).name} 主动亮牌 ${added.map(i=>cardText(s.cards[i])).join(' ')}`);
  }
  potRaiseTo(id,denominator) {
    if(![4,3,2,1].includes(denominator))throw Error('无效的底池比例');
    const l=this.legal(id);if(!l?.canRaise||!this.hand.pending.includes(id))throw Error('当前不能加注');
    const pot=this.hand.seats.reduce((n,s)=>n+s.total,0);
    const seat=this.hand.seats.find(s=>s.id===id);
    return Math.min(l.maxTo,Math.max(l.minTo,seat.bet+Math.ceil(pot/denominator)));
  }
  react(id,targetId,kind) {
    const from=this.players.find(p=>p.id===id),target=this.players.find(p=>p.id===targetId);
    if(!from||!target)throw Error('玩家已离开牌桌');
    if(!['egg','flower'].includes(kind))throw Error('请选择扔鸡蛋或送花');
    if(from.lastReactionAt&&Date.now()-from.lastReactionAt<3000)throw Error('互动太快，请稍等 3 秒');
    const text=kind==='egg'?`向 ${target.name} 扔了一个鸡蛋`:`送给 ${target.name} 一朵花`;
    const event=this.emit('reaction',{id,name:from.name,targetId,targetName:target.name,kind,text});
    from.lastReactionAt=event.at;target.reaction=event;this.log(`${from.name} ${text}`);
  }
  start(online=()=>true) {
    if(this.running) throw Error('本场已开始');
    if(this.players.length<2) throw Error('至少需要两个人才能开始');
    if(this.players.filter(p=>online(p.id)).length<2)throw Error('至少需要两位在线玩家才能开始');
    this.players.forEach(p=>{p.chips=1000+(p.nextStartTopUp||0);p.nextStartTopUp=0;p.eliminated=false;p.waiting=false;p.sittingOut=false;p.timeouts=0;});
    this.paused=false;this.pausedAt=0;
    this.running=true; this.number=0; this.dealer=-1; this.hand=null; this.nextAt=0;
    this.log('新的一场开始，基础积分每人 1000 分，保留开场前已批准补分，盲注 10 / 20'); this.newHand(online);
  }
  end() {
    this.cancelTopUps();
    if(this.hand&&!this.hand.done)this.log('管理员结束本场：撤销当前未完成手牌');
    this.players.forEach(p=>{p.chips=1000;p.nextStartTopUp=0;p.eliminated=false;p.waiting=false;p.sittingOut=false;p.timeouts=0;});
    this.log('管理员结束并重置积分，所有玩家恢复为 1000 分');
    this.running=false;this.hand=null;this.nextAt=0;this.paused=false;this.pausedAt=0; this.message='所有玩家积分已重置为 1000，等待管理员开始';
  }
  newHand(online=()=>true,now=Date.now()) {
    if(!this.running) return;
    const eligible=this.players.filter(p=>p.chips>0&&!p.eliminated);
    if(eligible.length<2) {this.running=false;this.paused=false;this.nextAt=0;this.message=eligible.length?`${eligible[0].name} 赢得本场`:'本场结束';this.log(this.message);return;}
    const active=eligible.filter(p=>!p.sittingOut&&online(p.id));
    if(active.length<2){this.pause(now);return;}
    this.paused=false;this.pausedAt=0;
    this.players.forEach(p=>p.waiting=false);
    do {this.dealer=(this.dealer+1)%this.players.length;} while(!active.includes(this.players[this.dealer]));
    const order=[];for(let i=0;i<this.players.length;i++){const p=this.players[(this.dealer+i)%this.players.length];if(active.includes(p))order.push(p);}
    const cards=deck(),blinds=blindsForHand(this.number+1),previousBig=this.hand?.bigBlind||BIG_BLIND;
    if(blinds.big!==previousBig)this.log(`盲注升至第 ${blinds.level} 档：${blinds.small} / ${blinds.big}，从第 ${this.number+1} 手生效`);
    this.hand={id:randomUUID(),number:++this.number,smallBlind:blinds.small,bigBlind:blinds.big,blindLevel:blinds.level,seats:order.map(p=>({id:p.id,cards:[cards.pop(),cards.pop()],shown:[],total:0,bet:0,folded:false,lastActionBet:null})),deck:cards,board:[],street:0,currentBet:blinds.big,minRaise:blinds.big,pending:[],turn:0,done:false,reveal:false,result:[],deadline:0};
    const h=this.hand; const sb=order.length===2?0:1,bb=order.length===2?1:2;
    this.recordAction(order[sb].id,'blind',`小盲 ${this.pay(sb,blinds.small)}`);
    this.recordAction(order[bb].id,'blind',`大盲 ${this.pay(bb,blinds.big)}`);
    h.pending=h.seats.filter(s=>this.player(s).chips>0).map(s=>s.id);
    this.log(`第 ${h.number} 手开始，${order[0].name} 为庄家；${order[sb].name} 小盲，${order[bb].name} 大盲`);
    this.setTurn((bb+1)%order.length);this.advance();
  }
  pause(now) {
    if(!this.paused){this.paused=true;this.pausedAt=now;this.log('牌局暂停，等待在线玩家返回');}
  }
  resume(id) {
    const p=this.players.find(p=>p.id===id);
    if(!p||p.eliminated)throw Error('分数用完，本场已下场');
    p.sittingOut=false;p.timeouts=0;this.log(`${p.name} 返回牌桌，下一手参与`);
  }
  tick(now,online,offlineReady) {
    if(!this.running)return false;
    const h=this.hand;
    if(!this.players.some(p=>online(p.id))){const changed=!this.paused;this.pause(now);return changed;}
    if(this.paused){
      if(!h||h.done){
        if(this.players.filter(p=>p.chips>0&&!p.eliminated&&!p.sittingOut&&online(p.id)).length<2)return false;
        this.newHand(online,now);return true;
      }
      if(h.transitionAt)h.transitionAt+=now-this.pausedAt;else h.deadline+=now-this.pausedAt;
      this.paused=false;this.pausedAt=0;this.log('玩家返回，继续本手');
      return true;
    }
    if(!h||h.done){if(!h||now>=this.nextAt){this.newHand(online,now);return true;}return false;}
    if(h.transitionAt){
      if(now<h.transitionAt)return false;
      h.transitionAt=0;this.advance(h.turn,true);return true;
    }
    const id=h.seats[h.turn].id,disconnected=!online(id)&&offlineReady(id);
    const p=this.players.find(p=>p.id===id),l=this.legal(id),wasAway=!!p.sittingOut;
    if(now<h.deadline&&!disconnected&&!wasAway)return false;
    p.timeouts=(p.timeouts||0)+1;
    if(!wasAway&&(disconnected||p.timeouts>=2)){p.sittingOut=true;this.log(`${p.name} ${disconnected?'离线':'连续两次行动超时'}，已暂离，后续不再发牌`);}
    this.log(`${p.name} ${disconnected?'离线':wasAway?'暂离':'行动超时'}，自动${l.toCall?'弃牌':'过牌'}`);
    this.act(id,l.toCall?'fold':'call',undefined,true);return true;
  }
  player(s) {return this.players.find(p=>p.id===s.id);}
  recordAction(id,kind,text,automatic=false) {
    const s=this.hand.seats.find(s=>s.id===id),entry={id,name:this.player(s).name,kind,text:(automatic?'自动':'')+text,street:this.hand.street,at:Date.now()};
    s.lastAction=entry;s.recentAction=entry;(this.hand.actions??=[]).push(entry);
    this.emit('action',entry);
  }
  pay(index,amount) {const s=this.hand.seats[index],p=this.player(s),n=Math.min(p.chips,amount);p.chips-=n;s.bet+=n;s.total+=n;return n;}
  setTurn(from) {
    const h=this.hand;
    for(let i=0;i<h.seats.length;i++){const n=(from+i)%h.seats.length;if(h.pending.includes(h.seats[n].id)){h.turn=n;h.firstToAct??=h.seats[n].id;h.deadline=Date.now()+45000;return;}}
  }
  legal(id) {
    const h=this.hand;if(!h||h.done||h.transitionAt||h.seats[h.turn]?.id!==id)return null;
    const s=h.seats[h.turn],p=this.player(s),call=Math.max(0,h.currentBet-s.bet);
    const opponentCanBet=h.seats.some(x=>x.id!==id&&!x.folded&&this.player(x).chips>0);
    return {call:Math.min(call,p.chips),toCall:call,minTo:h.currentBet+h.minRaise,maxTo:s.bet+p.chips,
      canRaise:opponentCanBet&&(s.lastActionBet===null||h.currentBet-s.lastActionBet>=h.minRaise)&&s.bet+p.chips>h.currentBet};
  }
  act(id,action,amount,automatic=false) {
    const h=this.hand,l=this.legal(id);if(!l||!h.pending.includes(id))throw Error('还没轮到你');
    const i=h.turn,s=h.seats[i],p=this.player(s);let text,kind=action;
    if(action==='fold'){s.folded=true;text='弃牌';this.log(`${p.name} 弃牌`);}
    else if(action==='call') {const n=this.pay(i,l.call);s.lastActionBet=h.currentBet;text=n?`跟注 ${n}${p.chips===0?'（All-in）':''}`:'过牌';kind=p.chips===0?'allin':n?'call':'check';this.log(`${p.name} ${text}`);}
    else if(action==='raise') {
      if(!l.canRaise)throw Error('当前不能加注');
      if(!Number.isSafeInteger(amount)||amount<=h.currentBet||amount>l.maxTo||(amount<l.minTo&&amount!==l.maxTo))throw Error(`加注总额至少 ${l.minTo}，不足时只能 All-in`);
      const delta=amount-h.currentBet,full=delta>=h.minRaise,opening=h.currentBet===0;
      this.pay(i,amount-s.bet);h.currentBet=amount;if(full)h.minRaise=delta;s.lastActionBet=amount;
      h.pending=h.seats.filter(x=>!x.folded&&x.id!==id&&this.player(x).chips>0&&(full||x.bet<h.currentBet||h.pending.includes(x.id))).map(x=>x.id);
      this.log(`${p.name} ${p.chips===0?'All-in':'下注 / 加注'}至 ${amount}`);
      text=p.chips===0?`All-in 至 ${amount}`:opening?`下注 ${amount}`:`加注至 ${amount}`;kind=p.chips===0?'allin':'raise';
    }else throw Error('无效操作');
    this.recordAction(id,kind,text,automatic);
    if(!automatic)p.timeouts=0;
    h.pending=h.pending.filter(x=>x!==id);this.advance((i+1)%h.seats.length);
  }
  advance(from=this.hand.turn,afterDelay=false) {
    const h=this.hand;
    const live=h.seats.filter(s=>!s.folded);
    if(live.length===1){this.finish(false);return;}
    h.pending=h.pending.filter(id=>{const s=h.seats.find(x=>x.id===id);return !s.folded&&this.player(s).chips>0;});
    const able=live.filter(s=>this.player(s).chips>0);
    if(able.length<=1) h.pending=h.pending.filter(id=>h.seats.find(s=>s.id===id).bet<h.currentBet);
    if(h.pending.length){this.setTurn(from);return;}
    if(!afterDelay){h.transitionAt=Date.now()+3000;h.deadline=0;return;}
    if(h.street===3){this.finish(true);return;}
    h.street++;h.deck.pop(); const count=h.street===1?3:1;
    for(let i=0;i<count;i++)h.board.push(h.deck.pop());
    h.seats.forEach(s=>{s.bet=0;s.lastActionBet=null;if(!s.folded)s.lastAction=null;});h.actions=[];h.firstToAct=null;h.currentBet=0;h.minRaise=h.bigBlind;
    this.log(`${['','翻牌','转牌','河牌'][h.street]}：${h.board.map(cardText).join(' ')}`);
    h.pending=able.map(s=>s.id);this.advance(1%h.seats.length);
  }
  finish(reveal) {
    const h=this.hand;h.done=true;h.reveal=reveal;h.deadline=0;
    h.pots=[];
    const live=h.seats.filter(s=>!s.folded),scores=new Map(live.map(s=>[s.id,reveal?evaluate([...s.cards,...h.board]):{score:0,name:'其余玩家弃牌'}]));
    const levels=[...new Set(h.seats.map(s=>s.total).filter(Boolean))].sort((a,b)=>a-b);let prev=0;
    const wins=new Map();
    for(const level of levels){
      const contributors=h.seats.filter(s=>s.total>=level),pot=(level-prev)*contributors.length;prev=level;
      // Uncalled excess is always returned, even to a player who later folded.
      if(contributors.length===1){const s=contributors[0];this.player(s).chips+=pot;h.result.push({name:this.player(s).name,amount:pot,label:'退还未被跟注部分'});continue;}
      const eligible=contributors.filter(s=>!s.folded);
      if(!eligible.length)throw Error('无合法底池归属');
      const best=Math.max(...eligible.map(s=>scores.get(s.id).score));
      // Odd chips go clockwise from the button.
      const winners=h.seats.slice(1).concat(h.seats[0]).filter(s=>eligible.includes(s)&&scores.get(s.id).score===best);
      h.pots.push({label:h.pots.length?`边池 ${h.pots.length}`:'主池',amount:pot,winners:winners.map((s,i)=>({id:s.id,name:this.player(s).name,amount:Math.floor(pot/winners.length)+(i<pot%winners.length?1:0)}))});
      winners.forEach((s,i)=>{const n=Math.floor(pot/winners.length)+(i<pot%winners.length?1:0);this.player(s).chips+=n;wins.set(s.id,(wins.get(s.id)||0)+n);});
    }
    for(const [id,amount] of wins){const p=this.players.find(p=>p.id===id);h.result.push({name:p.name,amount,label:scores.get(id).name});}
    if(reveal)for(const s of live)this.log(`${this.player(s).name} 摊牌 ${s.cards.map(cardText).join(' ')} · ${scores.get(s.id).name}`);
    h.result.forEach(r=>this.log(`${r.name} ${r.label==='退还未被跟注部分'?'收回':'赢得'} ${r.amount} 分 · ${r.label}`));
    this.applyTopUps();
    this.players.filter(p=>p.chips===0&&!p.eliminated).forEach(p=>{p.eliminated=true;this.log(`${p.name} 分数用完，已下场`);});
    this.message=h.result.map(r=>`${r.name} +${r.amount}（${r.label}）`).join('；');this.nextAt=Date.now()+7000;
  }
  view(id) {
    const h=this.hand;
    const legal=this.paused?null:this.legal(id);
    const blinds=h?{small:h.smallBlind,big:h.bigBlind,level:h.blindLevel}:blindsForHand(1);
    const blindHand=h?.number||0,nextBlindHand=blindsForHand(blindHand+1).big!==blinds.big?blindHand+1:Math.floor(Math.max(0,blindHand-1)/5)*5+6;
    const nextBlinds=blindsForHand(nextBlindHand);
    if(legal?.canRaise)legal.potRaises=[4,3,2,1].map(denominator=>{
      const amount=this.potRaiseTo(id,denominator),seat=h.seats.find(s=>s.id===id),contribution=amount-seat.bet,requested=Math.ceil(h.seats.reduce((n,s)=>n+s.total,0)/denominator);
      return {denominator,amount,contribution,requested,limit:contribution<requested?'allin':contribution>requested?'minimum':null};
    });
    let settlement=null;
    if(h?.done){
      const shown=h.reveal?h.seats.filter(s=>!s.folded).map(s=>({id:s.id,...evaluate([...s.cards,...h.board])})).sort((a,b)=>b.score-a.score):[];
      const strengths=[...new Set(shown.map(s=>s.score))];
      const rows=h.seats.map(s=>{
        const p=this.player(s),best=shown.find(x=>x.id===s.id),receipts=h.result.filter(r=>r.name===p.name);
        const won=receipts.filter(r=>r.label!=='退还未被跟注部分').reduce((n,r)=>n+r.amount,0),refund=receipts.filter(r=>r.label==='退还未被跟注部分').reduce((n,r)=>n+r.amount,0);
        const wheel=best&&[4,8].includes(five(best.cards)[0])&&five(best.cards)[1]===5;
        return {id:s.id,name:p.name,place:best?strengths.indexOf(best.score)+1:null,label:s.folded?'已弃牌':best?.name||'其余玩家弃牌',detail:best?handDescription(best.cards):'',bestCards:best?best.cards.slice().sort((a,b)=>(wheel&&rank(b)===14?1:rank(b))-(wheel&&rank(a)===14?1:rank(a))):[],won,refund,net:won+refund-s.total};
      }).sort((a,b)=>(a.place??99)-(b.place??99)||b.won-a.won);
      settlement={showdown:!!h.reveal,rows,pots:h.pots||[]};
    }
    return {running:this.running,paused:!!this.paused,smallBlind:blinds.small,blinds:{...blinds,nextHand:nextBlindHand,next:nextBlinds,atMaximum:blinds.big===BLIND_LEVELS.at(-1)*2},number:this.number,message:this.message,nextAt:this.nextAt,eventSeq:this.eventSeq,events:this.events,quickChats:QUICK_CHATS,
      players:this.players.map(p=>({id:p.id,name:p.name,avatarHue:p.avatarHue,chips:p.chips,seat:p.seat,eliminated:!!p.eliminated,sittingOut:!!p.sittingOut,waiting:!!(this.running&&!h?.seats.some(s=>s.id===p.id)),chat:p.chat&&Date.now()-p.chat.at<6000?p.chat:null,reaction:p.reaction&&Date.now()-p.reaction.at<6000?p.reaction:null})),
      history:this.history,
      hand:h?{id:h.id,number:h.number,board:h.board,street:h.street,currentBet:h.currentBet,pot:h.done?0:h.seats.reduce((n,s)=>n+s.total,0),done:h.done,deadline:h.deadline,transitionAt:h.transitionAt||0,
        turn:h.done||h.transitionAt?null:h.seats[h.turn]?.id,firstToAct:h.done?null:h.firstToAct||null,dealer:h.seats[0].id,result:h.result,settlement,actions:h.actions||[],
        seats:h.seats.map(s=>({id:s.id,bet:s.bet,total:s.total,folded:s.folded,shown:h.reveal&&!s.folded?[0,1]:s.shown||[],lastAction:s.lastAction||null,recentAction:s.recentAction||null,cards:s.cards.map((c,i)=>s.id===id||(h.reveal&&!s.folded)||s.shown?.includes(i)?c:null)}))}:null,
      legal};
  }
}
