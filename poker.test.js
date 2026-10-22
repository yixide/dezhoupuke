import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Table,evaluate,deck,QUICK_CHATS} from './poker.js';
const c=s=>s.split(' ').map(x=>'SHCD'.indexOf(x[0])*13+'23456789TJQKA'.indexOf(x[1]));
test('完整牌型顺序、A2345、踢脚与七选五',()=>{
  const cases=['SA SK SQ SJ ST','SA HA CA DA S2','SA HA CA SK HK','SA SJ S8 S5 S2','S9 H8 C7 D6 S5','SA HA CA S9 H8','SA HA SK HK S8','SA HA SK H9 S8','SA HK S9 H8 C6'];
  for(let i=0;i<cases.length-1;i++)assert.ok(evaluate(c(cases[i])).score>evaluate(c(cases[i+1])).score);
  assert.equal(evaluate(c('SA H2 C3 D4 S5')).name,'顺子');
  assert.ok(evaluate(c('S6 H2 C3 D4 S5')).score>evaluate(c('SA H2 C3 D4 S5')).score);
  assert.ok(evaluate(c('SA HA SK H9 S8')).score>evaluate(c('SA HA SQ H9 S8')).score);
  assert.equal(evaluate(c('SA SK SQ SJ ST H2 C3')).name,'同花顺');
});
test('牌堆唯一，底牌隔离，单挑盲注与行动顺序',()=>{
  assert.equal(new Set(deck()).size,52);
  const t=new Table();t.add('a','甲');t.add('b','乙');t.start();
  assert.equal(t.players[0].chips,990);assert.equal(t.players[1].chips,980);assert.equal(t.hand.seats[t.hand.turn].id,'a');
  assert.deepEqual(t.view('a').hand.seats[1].cards,[null,null]);assert.equal(t.view('a').hand.seats[0].cards.length,2);
  t.act('a','call');assert.equal(t.hand.seats[t.hand.turn].id,'b');t.act('b','call');
  assert.equal(t.hand.street,1);assert.equal(t.hand.seats[t.hand.turn].id,'b');
});
test('非法操作没有改变筹码，结束后立即重置积分',()=>{
  const t=new Table();t.add('a','甲');t.add('b','乙');t.start();
  assert.throws(()=>t.act('b','raise',100));assert.throws(()=>t.act('a','raise',25));
  assert.throws(()=>t.act('a','raise',NaN));assert.equal(t.players[0].chips,990);
  t.act('a','raise',100);t.end();assert.deepEqual(t.players.map(p=>p.chips),[1000,1000]);
});

test('结束立即重置赢家、离线下场和中途加入者；自然结束后无需重新开场也可重置',()=>{
  const t=new Table();t.add('a','甲');t.add('b','乙');t.start();
  t.act('a','fold');assert.notEqual(t.players[0].chips,1000);
  t.add('c','迟到者');t.players[1].chips=0;t.players[1].eliminated=true;t.players[1].sittingOut=true;t.players[1].timeouts=2;
  const names=t.players.map(p=>[p.id,p.name]),history=t.history.length;
  t.end();assert.equal(t.running,false);assert.equal(t.hand,null);assert.equal(t.nextAt,0);
  assert.deepEqual(t.players.map(p=>[p.id,p.name]),names);assert.ok(t.history.length>history);
  assert.ok(t.players.every(p=>p.chips===1000&&!p.eliminated&&!p.waiting&&!p.sittingOut&&p.timeouts===0));
  t.players[0].chips=3000;t.players[1].chips=0;t.players[1].eliminated=true;
  t.end();assert.ok(t.players.every(p=>p.chips===1000&&!p.eliminated));
  const restored=new Table(JSON.parse(JSON.stringify(t)));assert.ok(restored.players.every(p=>p.chips===1000));
});

test('每轮操作显示跟注、弃牌、过牌、加注；换轮清理操作而弃牌保持',()=>{
  const t=new Table();['a','b','c','d'].forEach(id=>t.add(id,id));t.start();
  assert.equal(t.view('a').hand.seats.find(s=>s.id==='b').lastAction.text,'小盲 10');
  t.act('d','call');t.act('a','fold');t.act('b','call');
  let view=t.view('a');
  assert.equal(view.hand.seats.find(s=>s.id==='d').lastAction.text,'跟注 20');
  assert.equal(view.hand.seats.find(s=>s.id==='a').lastAction.text,'弃牌');
  const before=structuredClone(view.hand.actions);assert.throws(()=>t.act('d','raise',100));assert.deepEqual(t.view('a').hand.actions,before);
  t.act('c','call');view=t.view('a');assert.equal(view.hand.street,1);assert.deepEqual(view.hand.actions,[]);
  assert.equal(view.hand.seats.find(s=>s.id==='a').lastAction.text,'弃牌');
  assert.equal(view.hand.seats.find(s=>s.id==='d').lastAction,null);
  t.act('b','call');t.act('c','raise',60);t.act('d','raise',120);
  view=t.view('a');assert.deepEqual(view.hand.actions.map(x=>x.text),['过牌','下注 60','加注至 120']);
  assert.equal(view.hand.seats.find(s=>s.id==='b').lastAction.kind,'check');
  t.act('b','call');t.act('c','call');view=t.view('a');assert.equal(view.hand.street,2);assert.deepEqual(view.hand.actions,[]);
  assert.equal(view.hand.seats.find(s=>s.id==='a').lastAction.text,'弃牌');
  assert.ok(view.hand.seats.filter(s=>s.id!=='a').every(s=>s.lastAction===null));
  assert.ok(view.events.some(e=>e.text==='跟注 60'));
  assert.ok(view.events.every((e,i,a)=>!i||e.seq>a[i-1].seq));
});

test('快捷聊天校验身份、短语和冷却；气泡过期且事件序号在恢复后延续',()=>{
  const t=new Table();t.add('a','甲');t.add('b','乙');
  assert.throws(()=>t.chat('x',QUICK_CHATS[0]));assert.throws(()=>t.chat('a','<script>任意内容</script>'));
  assert.equal(t.eventSeq,0);t.chat('a','大家好');
  let v=t.view('b');assert.equal(v.players[0].chat.text,'大家好');assert.equal(v.events.at(-1).name,'甲');assert.equal(v.events.at(-1).type,'chat');
  assert.throws(()=>t.chat('a','好牌！'),/太快/);assert.equal(t.eventSeq,1);
  t.players[0].chat.at-=7000;assert.equal(t.view('b').players[0].chat,null);
  const restored=new Table(JSON.parse(JSON.stringify(t)));restored.chat('a','再来一手');assert.equal(restored.eventSeq,2);
  restored.start();assert.ok(restored.view('b').events.some(e=>e.type==='chat'&&e.seq===2));
});
test('短码 All-in 不重新开放已行动玩家的加注权',()=>{
  const t=new Table();['a','b','c'].forEach(id=>t.add(id,id));t.start();
  t.players.find(p=>p.id==='c').chips=10;
  t.act('a','call');t.act('b','call');t.act('c','raise',30);
  assert.equal(t.legal('a').canRaise,false);assert.equal(t.legal('a').toCall,10);
  assert.throws(()=>t.act('a','raise',100));
});
test('三人不同 All-in 筹码形成边池，未跟注部分退回',()=>{
  const t=new Table();['a','b','c'].forEach(id=>t.add(id,id));t.start();
  const h=t.hand;h.board=c('S2 H3 C7 D9 SJ');h.street=3;
  h.seats[0].cards=c('SA HA');h.seats[1].cards=c('SK HK');h.seats[2].cards=c('SQ HQ');
  h.seats.forEach((s,i)=>{s.total=[100,200,300][i];s.bet=s.total;t.player(s).chips=0;});
  t.finish(true);assert.deepEqual(t.players.map(p=>p.chips),[300,200,100]);
  const rows=t.view('a').hand.settlement.rows;
  assert.deepEqual(rows.map(p=>[p.id,p.place,p.won,p.refund,p.net]),[['a',1,300,0,200],['b',2,200,0,0],['c',3,0,100,-200]]);
  assert.ok(rows.every(p=>p.bestCards.length===5));
  assert.deepEqual(rows.map(p=>p.detail),['一对 A','一对 K','一对 Q']);
  assert.deepEqual(t.view('a').hand.settlement.pots.map(p=>[p.label,p.amount,p.winners.map(w=>w.id)]),[['主池',300,['a']],['边池 1',200,['b']]]);
});
test('公共牌平局分池，弃牌隐藏，零分下场',()=>{
  const t=new Table();['a','b','c'].forEach(id=>t.add(id,id));t.start();
  const h=t.hand;h.board=c('SA SK SQ SJ ST');h.street=3;
  h.seats.forEach((s,i)=>{s.cards=c(['H2 C3','H4 C5','H6 C7'][i]);s.total=1;t.player(s).chips=0;});h.seats[2].folded=true;
  t.finish(true);assert.deepEqual(t.players.map(p=>p.chips),[1,2,0]);assert.equal(t.players[2].eliminated,true);
  assert.deepEqual(t.view('a').hand.seats[2].cards,[null,null]);
  const rows=t.view('a').hand.settlement.rows;
  assert.deepEqual(rows.slice(0,2).map(p=>p.place),[1,1]);
  assert.equal(rows.find(p=>p.id==='c').bestCards.length,0);
});

test('结算比较不泄露未摊牌的底牌，退款不算赢家',()=>{
  const t=new Table();t.add('a','甲');t.add('b','乙');t.start();
  assert.equal(t.view('b').hand.settlement,null);
  t.act('a','raise',100);t.act('b','fold');
  const result=t.view('b').hand.settlement;
  assert.equal(result.showdown,false);assert.ok(result.rows.every(p=>p.bestCards.length===0&&p.place===null));
  const winner=result.rows.find(p=>p.id==='a');assert.equal(winner.won,40);assert.equal(winner.refund,80);assert.equal(winner.net,20);
  assert.deepEqual(t.view('b').hand.seats.find(p=>p.id==='a').cards,[null,null]);
});
test('局中加入下一手参与，原玩家积分不重置',()=>{
  const t=new Table();t.add('a','甲');t.add('b','乙');t.start();t.add('c','丙');
  assert.equal(t.hand.seats.length,2);assert.equal(t.view('c').players.find(p=>p.id==='c').waiting,true);
  t.act(t.hand.seats[t.hand.turn].id,'fold');const before=new Map(t.players.map(p=>[p.id,p.chips]));
  t.newHand();assert.equal(t.hand.seats.length,3);
  for(const s of t.hand.seats)assert.equal(t.player(s).chips+s.total,before.get(s.id));
  assert.equal(t.view('c').players.find(p=>p.id==='c').waiting,false);
});

test('离线缓冲后立即处理，后续只给在线玩家发牌，人数不足暂停而非重置',()=>{
  const t=new Table();['a','b','c'].forEach(id=>t.add(id,id));t.start();
  const away=t.hand.seats[t.hand.turn].id,online=id=>id!==away;
  assert.equal(t.tick(Date.now(),online,()=>false),false);
  assert.equal(t.tick(Date.now(),online,()=>true),true);
  assert.equal(t.players.find(p=>p.id===away).sittingOut,true);
  assert.equal(t.hand.seats.find(s=>s.id===away).folded,true);
  while(!t.hand.done)t.act(t.hand.seats[t.hand.turn].id,'call');
  t.newHand(online);assert.equal(t.hand.seats.length,2);assert.ok(t.hand.seats.every(s=>s.id!==away));
  while(!t.hand.done)t.act(t.hand.seats[t.hand.turn].id,'call');
  const chips=t.players.map(p=>p.chips),number=t.number;
  t.newHand(id=>id==='b');assert.equal(t.running,true);assert.equal(t.paused,true);assert.equal(t.number,number);
  assert.deepEqual(t.players.map(p=>p.chips),chips);
  t.resume(away);t.tick(Date.now(),()=>true,()=>true);assert.equal(t.paused,false);assert.equal(t.hand.seats.length,3);
});

test('全员离线冻结本手和计时，返回后继续，不空转或重置积分',()=>{
  const t=new Table();t.add('a','甲');t.add('b','乙');t.start();
  const before=JSON.stringify(t.hand),chips=t.players.map(p=>p.chips),now=Date.now();
  assert.equal(t.tick(now,()=>false,()=>true),true);
  assert.equal(t.tick(now+3600000,()=>false,()=>true),false);
  assert.equal(JSON.stringify(t.hand),before);assert.deepEqual(t.players.map(p=>p.chips),chips);
  assert.equal(t.view('a').legal,null);
  const deadline=t.hand.deadline;
  t.tick(now+3600000,()=>true,()=>true);assert.equal(t.paused,false);assert.equal(t.hand.deadline,deadline+3600000);
  assert.equal(t.number,1);
});

test('连续两次超时自动暂离，下一手不发牌，返回保持积分；主动操作清除计数',()=>{
  const t=new Table();['a','b','c'].forEach(id=>t.add(id,id));t.start();
  const away=t.hand.seats[t.hand.turn].id;
  for(let i=0;i<20&&!t.players.find(p=>p.id===away).sittingOut;i++){
    if(t.hand.done){t.newHand();continue;}
    const id=t.hand.seats[t.hand.turn].id;
    if(id===away)t.tick(t.hand.deadline,()=>true,()=>false);else t.act(id,'call');
  }
  const p=t.players.find(p=>p.id===away);assert.equal(p.timeouts,2);assert.equal(p.sittingOut,true);
  while(!t.hand.done){const id=t.hand.seats[t.hand.turn].id;if(id===away)t.tick(Date.now(),()=>true,()=>false);else t.act(id,'call');}
  t.newHand();assert.equal(t.hand.seats.length,2);const chips=p.chips;
  t.resume(away);assert.equal(p.timeouts,0);assert.equal(p.chips,chips);
  while(!t.hand.done)t.act(t.hand.seats[t.hand.turn].id,'call');t.newHand();assert.equal(t.hand.seats.length,3);
  p.timeouts=1;while(t.hand.seats[t.hand.turn].id!==away)t.act(t.hand.seats[t.hand.turn].id,'call');
  t.act(away,'call');assert.equal(p.timeouts,0);
});
test('200 场随机合法对局：守恒、可行动、能结束、记录无底牌泄露',()=>{
  for(let trial=0;trial<200;trial++){
    const t=new Table();for(let i=0;i<2+trial%8;i++)t.add(String(i),'玩家'+i);t.start();const total=t.players.length*1000;
    let steps=0;
    while(t.running&&steps++<3000){const h=t.hand;
      if(h.done){assert.equal(t.players.reduce((n,p)=>n+p.chips,0),total);t.newHand();continue;}
      assert.equal(t.players.reduce((n,p)=>n+p.chips,0)+h.seats.reduce((n,s)=>n+s.total,0),total);
      const id=h.seats[h.turn].id,l=t.legal(id);assert.ok(l);assert.ok(h.pending.includes(id));
      const n=Math.random();
      if(n<.15)t.act(id,'fold');else if(n<.5&&l.canRaise)t.act(id,'raise',n<.3?l.maxTo:Math.min(l.maxTo,l.minTo));else t.act(id,'call');
    }
    assert.ok(steps<3000);assert.equal(t.players.reduce((n,p)=>n+p.chips,0),total);
  }
});
