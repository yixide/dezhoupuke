import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Table,evaluate,deck} from './poker.js';
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
test('非法操作没有改变筹码，结束退回下注',()=>{
  const t=new Table();t.add('a','甲');t.add('b','乙');t.start();
  assert.throws(()=>t.act('b','raise',100));assert.throws(()=>t.act('a','raise',25));
  assert.throws(()=>t.act('a','raise',NaN));assert.equal(t.players[0].chips,990);
  t.act('a','raise',100);t.end();assert.deepEqual(t.players.map(p=>p.chips),[1000,1000]);
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
});
test('公共牌平局分池，弃牌隐藏，零分下场',()=>{
  const t=new Table();['a','b','c'].forEach(id=>t.add(id,id));t.start();
  const h=t.hand;h.board=c('SA SK SQ SJ ST');h.street=3;
  h.seats.forEach((s,i)=>{s.cards=c(['H2 C3','H4 C5','H6 C7'][i]);s.total=1;t.player(s).chips=0;});h.seats[2].folded=true;
  t.finish(true);assert.deepEqual(t.players.map(p=>p.chips),[1,2,0]);assert.equal(t.players[2].eliminated,true);
  assert.deepEqual(t.view('a').hand.seats[2].cards,[null,null]);
});
test('局中加入仅旁观，下一整场才能参与',()=>{
  const t=new Table();t.add('a','甲');t.add('b','乙');t.start();t.add('c','丙');
  t.act(t.hand.seats[t.hand.turn].id,'fold');t.newHand();assert.equal(t.hand.seats.length,2);
  t.end();t.start();assert.equal(t.hand.seats.length,3);assert.ok(t.players.every(p=>p.chips>=980));
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
