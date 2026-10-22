import { randomInt } from 'node:crypto';

export function deck() {
  const cards = Array.from({length:52}, (_, i) => i);
  for (let i=51;i>0;i--) { const j=randomInt(i+1); [cards[i],cards[j]]=[cards[j],cards[i]]; }
  return cards;
}
export const rank = c => c%13+2;
export const suit = c => Math.floor(c/13);
export const cardText = c => '♠♥♣♦'[suit(c)] + ({11:'J',12:'Q',13:'K',14:'A'}[rank(c)] || rank(c));
export const categories = ['高牌','一对','两对','三条','顺子','同花','葫芦','四条','同花顺'];
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

export class Table {
  constructor(saved) {
    Object.assign(this,{players:[],running:false,hand:null,number:0,dealer:-1,history:[],message:'等待管理员开始',nextAt:0},saved);
    this.history=this.history.map((entry,i)=>({...entry,seq:entry.seq??i+1}));
    this.logSeq=Math.max(this.logSeq||0,0,...this.history.map(x=>x.seq));
  }
  log(text) { this.history.push({at:Date.now(),text,seq:++this.logSeq}); this.history=this.history.slice(-300); }
  add(id,name) {
    if(this.players.length>=9) throw Error('牌桌已满（最多 9 人）');
    if(this.players.some(p=>p.name===name)) throw Error('该名字已被使用，请换一个');
    const p={id,name,chips:1000,seat:this.players.length,waiting:this.running}; this.players.push(p);
    this.log(`${name} 加入牌桌${this.running?'，等待下次整场开始':''}`); return p;
  }
  start() {
    if(this.running) throw Error('本场已开始');
    if(this.players.length<2) throw Error('至少需要两个人才能开始');
    this.players.forEach(p=>{p.chips=1000;p.eliminated=false;p.waiting=false;});
    this.running=true; this.number=0; this.dealer=-1; this.hand=null; this.nextAt=0;
    this.log('新的一场开始，每人 1000 分，盲注 10 / 20'); this.newHand();
  }
  end() {
    if(!this.running) throw Error('当前没有进行中的牌局');
    if(this.hand&&!this.hand.done) {
      for(const x of this.hand.seats) this.players.find(p=>p.id===x.id).chips+=x.total;
      this.log('管理员结束本场：当前未完成手牌撤销，退还本手全部下注');
    } else this.log('管理员结束本场');
    this.running=false;this.hand=null;this.nextAt=0; this.message='本场已结束，等待管理员重新开始';
  }
  newHand() {
    if(!this.running) return;
    const active=this.players.filter(p=>p.chips>0&&!p.eliminated&&!p.waiting);
    if(active.length<2) {this.running=false;this.nextAt=0;this.message=active.length?`${active[0].name} 赢得本场`:'本场结束';this.log(this.message);return;}
    do {this.dealer=(this.dealer+1)%this.players.length;} while(!active.includes(this.players[this.dealer]));
    const order=[];for(let i=0;i<this.players.length;i++){const p=this.players[(this.dealer+i)%this.players.length];if(active.includes(p))order.push(p);}
    const cards=deck();
    this.hand={number:++this.number,seats:order.map(p=>({id:p.id,cards:[cards.pop(),cards.pop()],total:0,bet:0,folded:false,lastActionBet:null})),deck:cards,board:[],street:0,currentBet:20,minRaise:20,pending:[],turn:0,done:false,reveal:false,result:[],deadline:0};
    const h=this.hand; const sb=order.length===2?0:1,bb=order.length===2?1:2;
    this.pay(sb,10);this.pay(bb,20);h.pending=h.seats.filter(s=>this.player(s).chips>0).map(s=>s.id);
    this.log(`第 ${h.number} 手开始，${order[0].name} 为庄家；${order[sb].name} 小盲，${order[bb].name} 大盲`);
    this.setTurn((bb+1)%order.length);this.advance();
  }
  player(s) {return this.players.find(p=>p.id===s.id);}
  pay(index,amount) {const s=this.hand.seats[index],p=this.player(s),n=Math.min(p.chips,amount);p.chips-=n;s.bet+=n;s.total+=n;return n;}
  setTurn(from) {
    const h=this.hand;
    for(let i=0;i<h.seats.length;i++){const n=(from+i)%h.seats.length;if(h.pending.includes(h.seats[n].id)){h.turn=n;h.deadline=Date.now()+45000;return;}}
  }
  legal(id) {
    const h=this.hand;if(!h||h.done||h.seats[h.turn]?.id!==id)return null;
    const s=h.seats[h.turn],p=this.player(s),call=Math.max(0,h.currentBet-s.bet);
    const opponentCanBet=h.seats.some(x=>x.id!==id&&!x.folded&&this.player(x).chips>0);
    return {call:Math.min(call,p.chips),toCall:call,minTo:h.currentBet+h.minRaise,maxTo:s.bet+p.chips,
      canRaise:opponentCanBet&&(s.lastActionBet===null||h.currentBet-s.lastActionBet>=h.minRaise)&&s.bet+p.chips>h.currentBet};
  }
  act(id,action,amount) {
    const h=this.hand,l=this.legal(id);if(!l||!h.pending.includes(id))throw Error('还没轮到你');
    const i=h.turn,s=h.seats[i],p=this.player(s);
    if(action==='fold'){s.folded=true;this.log(`${p.name} 弃牌`);}
    else if(action==='call') {const n=this.pay(i,l.call);s.lastActionBet=h.currentBet;this.log(`${p.name} ${n?`跟注 ${n}${p.chips===0?'（All-in）':''}`:'过牌'}`);}
    else if(action==='raise') {
      if(!l.canRaise)throw Error('当前不能加注');
      if(!Number.isSafeInteger(amount)||amount<=h.currentBet||amount>l.maxTo||(amount<l.minTo&&amount!==l.maxTo))throw Error(`加注总额至少 ${l.minTo}，不足时只能 All-in`);
      const delta=amount-h.currentBet,full=delta>=h.minRaise;
      this.pay(i,amount-s.bet);h.currentBet=amount;if(full)h.minRaise=delta;s.lastActionBet=amount;
      h.pending=h.seats.filter(x=>!x.folded&&x.id!==id&&this.player(x).chips>0&&(full||x.bet<h.currentBet||h.pending.includes(x.id))).map(x=>x.id);
      this.log(`${p.name} ${p.chips===0?'All-in':'下注 / 加注'}至 ${amount}`);
    }else throw Error('无效操作');
    h.pending=h.pending.filter(x=>x!==id);this.advance((i+1)%h.seats.length);
  }
  advance(from=this.hand.turn) {
    const h=this.hand;
    const live=h.seats.filter(s=>!s.folded);
    if(live.length===1){this.finish(false);return;}
    h.pending=h.pending.filter(id=>{const s=h.seats.find(x=>x.id===id);return !s.folded&&this.player(s).chips>0;});
    const able=live.filter(s=>this.player(s).chips>0);
    if(able.length<=1) h.pending=h.pending.filter(id=>h.seats.find(s=>s.id===id).bet<h.currentBet);
    if(h.pending.length){this.setTurn(from);return;}
    if(h.street===3){this.finish(true);return;}
    h.street++;h.deck.pop(); const count=h.street===1?3:1;
    for(let i=0;i<count;i++)h.board.push(h.deck.pop());
    h.seats.forEach(s=>{s.bet=0;s.lastActionBet=null;});h.currentBet=0;h.minRaise=20;
    this.log(`${['','翻牌','转牌','河牌'][h.street]}：${h.board.map(cardText).join(' ')}`);
    h.pending=able.map(s=>s.id);this.advance(1%h.seats.length);
  }
  finish(reveal) {
    const h=this.hand;h.done=true;h.reveal=reveal;h.deadline=0;
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
      winners.forEach((s,i)=>{const n=Math.floor(pot/winners.length)+(i<pot%winners.length?1:0);this.player(s).chips+=n;wins.set(s.id,(wins.get(s.id)||0)+n);});
    }
    for(const [id,amount] of wins){const p=this.players.find(p=>p.id===id);h.result.push({name:p.name,amount,label:scores.get(id).name});}
    if(reveal)for(const s of live)this.log(`${this.player(s).name} 摊牌 ${s.cards.map(cardText).join(' ')} · ${scores.get(s.id).name}`);
    h.result.forEach(r=>this.log(`${r.name} ${r.label==='退还未被跟注部分'?'收回':'赢得'} ${r.amount} 分 · ${r.label}`));
    this.players.filter(p=>p.chips===0&&!p.eliminated).forEach(p=>{p.eliminated=true;this.log(`${p.name} 分数用完，已下场`);});
    this.message=h.result.map(r=>`${r.name} +${r.amount}（${r.label}）`).join('；');this.nextAt=Date.now()+7000;
  }
  view(id) {
    const h=this.hand;
    return {running:this.running,number:this.number,message:this.message,nextAt:this.nextAt,
      players:this.players.map(p=>({id:p.id,name:p.name,chips:p.chips,seat:p.seat,eliminated:!!p.eliminated,waiting:!!(this.running&&!h?.seats.some(s=>s.id===p.id))})),
      history:this.history,
      hand:h?{number:h.number,board:h.board,street:h.street,currentBet:h.currentBet,pot:h.done?0:h.seats.reduce((n,s)=>n+s.total,0),done:h.done,deadline:h.deadline,
        turn:h.done?null:h.seats[h.turn]?.id,dealer:h.seats[0].id,result:h.result,
        seats:h.seats.map(s=>({id:s.id,bet:s.bet,total:s.total,folded:s.folded,cards:s.id===id||(h.reveal&&!s.folded)?s.cards:[null,null]}))}:null,
      legal:this.legal(id)};
  }
}
