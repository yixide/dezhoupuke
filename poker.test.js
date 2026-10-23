import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Table,evaluate,deck,QUICK_CHATS,blindsForHand} from './poker.js';
import {raiseSlider} from './public/betting.js';
function flush(t){while(t.hand?.transitionAt)t.tick(t.hand.transitionAt,()=>true,()=>false);}
function act(t,...args){t.act(...args);flush(t);}
function tick(t,...args){const changed=t.tick(...args);flush(t);return changed;}
const c=s=>s.split(' ').map(x=>'SHCD'.indexOf(x[0])*13+'23456789TJQKA'.indexOf(x[1]));

test('每5手涨盲，换街最小加注和拖条同步；重启不重复涨盲，重置回10/20',()=>{
  assert.deepEqual([1,5,6,10,11,16,21].map(n=>blindsForHand(n).small),[10,10,20,20,30,50,100]);
  const t=new Table();t.add('a','甲');t.add('b','乙');t.start();
  for(let n=1;n<=5;n++){
    assert.equal(t.hand.number,n);assert.equal(t.hand.bigBlind,20);t.act(t.hand.seats[t.hand.turn].id,'fold');
    if(n===5){assert.equal(t.view('a').blinds.nextHand,6);assert.equal(t.view('a').smallBlind,10);}
    t.newHand();
  }
  assert.equal(t.hand.number,6);assert.equal(t.hand.currentBet,40);assert.equal(t.hand.minRaise,40);
  assert.equal(t.hand.seats.reduce((n,s)=>n+s.total,0),60);assert.equal(t.view('a').smallBlind,20);
  const restored=new Table(JSON.parse(JSON.stringify(t)));assert.equal(restored.hand.bigBlind,40);assert.equal(restored.number,6);
  assert.equal(raiseSlider(restored.legal(restored.hand.seats[restored.hand.turn].id),restored.view('a').smallBlind).step,20);
  act(restored,restored.hand.seats[restored.hand.turn].id,'call');act(restored,restored.hand.seats[restored.hand.turn].id,'call');
  assert.equal(restored.hand.street,1);assert.equal(restored.hand.minRaise,40);
  restored.end();assert.equal(restored.view('a').smallBlind,10);assert.equal(restored.view('a').blinds.nextHand,6);restored.start();assert.equal(restored.hand.number,1);assert.equal(restored.hand.bigBlind,20);
  const legacy=JSON.parse(JSON.stringify(t));delete legacy.hand.smallBlind;delete legacy.hand.bigBlind;delete legacy.hand.blindLevel;
  const old=new Table(legacy);assert.equal(old.hand.bigBlind,20);assert.equal(old.view('a').blinds.nextHand,7);
  old.act(old.hand.seats[old.hand.turn].id,'fold');old.newHand();assert.equal(old.hand.bigBlind,40);
});

test('补分必须审批，校验金额、重复申请及重复审批；开场前到账的补分会保留',()=>{
  const t=new Table();t.add('a','甲');t.add('b','乙');
  for(const amount of [0,-1,1.5,100001,'1000',NaN])assert.throws(()=>t.requestTopUp('a',amount));
  assert.throws(()=>t.requestTopUp('absent',100));
  t.requestTopUp('a',500);assert.equal(t.players[0].chips,1000);
  assert.throws(()=>t.requestTopUp('a',100));assert.throws(()=>t.reviewTopUp(1,'true','b'));
  t.reviewTopUp(1,false,'b');assert.equal(t.players[0].chips,1000);
  t.requestTopUp('a',500);t.reviewTopUp(2,true,'b');assert.equal(t.players[0].chips,1500);
  assert.throws(()=>t.reviewTopUp(2,true,'b'));assert.equal(t.players[0].chips,1500);
  t.start();assert.equal(t.players[0].chips+t.hand.seats[0].total,1500);
  t.end();t.start();assert.equal(t.players[0].chips+t.hand.seats[0].total,1000);
});

test('All-in 中批准补分不改变本手行动或边池；结算后到账且重启不重复加分',()=>{
  const t=new Table();['a','b','c'].forEach(id=>t.add(id,id));t.start();
  t.act('a','raise',1000);t.requestTopUp('a',600);t.reviewTopUp(1,true,'b');
  assert.equal(t.players[0].chips,0);assert.equal(t.topUps[0].status,'approved');
  assert.throws(()=>t.requestTopUp('a',50));
  const restored=new Table(JSON.parse(JSON.stringify(t)));
  restored.act('b','call');restored.act('c','call');flush(restored);
  assert.equal(restored.hand.done,true);assert.equal(restored.hand.pots[0].amount,3000);
  assert.equal(restored.players.reduce((n,p)=>n+p.chips,0),3600);
  assert.equal(restored.topUps[0].status,'applied');assert.equal(restored.players[0].eliminated,false);
  const again=new Table(JSON.parse(JSON.stringify(restored)));again.applyTopUps();
  assert.equal(again.players.reduce((n,p)=>n+p.chips,0),3600);
});

test('重置和移除座位取消未完成申请；补分可让已下场玩家下一手回桌',()=>{
  const t=new Table();t.add('a','甲');t.add('b','乙');t.start();
  t.requestTopUp('a',100);t.reviewTopUp(1,true,'b');t.requestTopUp('b',200);t.end();
  assert.ok(t.topUps.every(r=>r.status==='cancelled'));assert.ok(t.players.every(p=>p.chips===1000));
  t.requestTopUp('a',100);t.cancelTopUps('a');assert.throws(()=>t.reviewTopUp(3,true,'b'));
  t.start();t.act('a','fold');t.players[0].chips=0;t.players[0].eliminated=true;
  t.requestTopUp('a',500);t.reviewTopUp(4,true,'b');assert.equal(t.players[0].chips,500);
  t.newHand();assert.ok(t.hand.seats.some(s=>s.id==='a'));
});

test('随时亮一张再亮两张，仅公开所选牌；持久化、弃牌和跨局请求安全',()=>{
  const t=new Table();['a','b','c'].forEach(id=>t.add(id,id));t.start();const handId=t.hand.id;
  const original=t.hand.seats.find(s=>s.id==='b').cards.slice(),turn=t.hand.turn;
  for(const indices of [[],[2],[-1],['0'],[0,0],[0,1,0],null])assert.throws(()=>t.showCards('b',handId,indices));
  t.showCards('b',handId,[1]);assert.equal(t.hand.turn,turn);
  assert.deepEqual(t.view('a').hand.seats.find(s=>s.id==='b').cards,[null,original[1]]);
  assert.deepEqual(t.view('b').hand.seats.find(s=>s.id==='b').cards,original);
  assert.ok(!t.history.at(-1).text.includes('undefined'));
  const restored=new Table(JSON.parse(JSON.stringify(t)));restored.showCards('b',handId,[0,1]);
  assert.deepEqual(restored.view('c').hand.seats.find(s=>s.id==='b').cards,original);
  const logs=restored.history.length;restored.showCards('b',handId,[1]);assert.equal(restored.history.length,logs);
  restored.act('a','fold');restored.act('b','fold');
  assert.deepEqual(restored.view('c').hand.seats.find(s=>s.id==='b').cards,original);
  restored.showCards('a',handId,[0]);assert.equal(restored.view('c').hand.seats[0].cards[1],null);
  restored.end();restored.start();assert.notEqual(restored.hand.id,handId);
  assert.throws(()=>restored.showCards('b',handId,[0]));
  assert.deepEqual(restored.view('a').hand.seats.find(s=>s.id==='b').cards,[null,null]);
  restored.add('late','迟到');assert.throws(()=>restored.showCards('late',restored.hand.id,[0]));
});

test('底池快捷加注：本次投入为当前底池比例、向上取整、最小加注和 All-in 限制',()=>{
  const t=new Table();t.add('a','甲');t.add('b','乙');t.start();
  assert.deepEqual([4,3,2,1].map(d=>t.potRaiseTo('a',d)),[40,40,40,40]);
  t.act('a','raise',100);
  assert.deepEqual([4,3,2,1].map(d=>t.potRaiseTo('b',d)),[180,180,180,180]);
  assert.equal(t.view('b').legal.potRaises[3].amount,180);
  assert.equal(t.view('b').legal.potRaises[3].limit,'minimum');
  assert.throws(()=>t.potRaiseTo('a',1));assert.throws(()=>t.potRaiseTo('b',0));assert.throws(()=>t.potRaiseTo('b','2'));
  t.players[1].chips=120;assert.equal(t.potRaiseTo('b',1),140);
  t.act('b','raise',t.potRaiseTo('b',1));assert.equal(t.players[1].chips,0);
  assert.throws(()=>t.potRaiseTo('a',1));
  const u=new Table();u.add('a','甲');u.add('b','乙');u.start();u.act('a','raise',101);
  assert.equal(u.potRaiseTo('b',1),182);
  act(u,'b','call');assert.equal(u.hand.currentBet,0);
  assert.deepEqual([4,3,2,1].map(d=>u.potRaiseTo('b',d)),[51,68,101,202]);
});

test('底池100、需跟20且已下20时，满池实际扣100而不是140；每个比例预览等于扣款',()=>{
  const t=new Table();t.add('a','甲');t.add('b','乙');t.start();
  Object.assign(t.hand,{currentBet:40,minRaise:20,turn:0,pending:['a','b']});
  Object.assign(t.hand.seats[0],{bet:20,total:40});Object.assign(t.hand.seats[1],{bet:40,total:60});
  t.players[0].chips=960;t.players[1].chips=940;
  assert.deepEqual(t.view('a').legal.potRaises.map(p=>p.contribution),[40,40,50,100]);
  for(const denominator of [4,3,2,1]){
    const copy=new Table(JSON.parse(JSON.stringify(t))),preview=copy.view('a').legal.potRaises.find(p=>p.denominator===denominator),before=copy.players[0].chips;
    copy.act('a','raise',copy.potRaiseTo('a',denominator));
    assert.equal(before-copy.players[0].chips,preview.contribution);assert.equal(copy.hand.currentBet,preview.amount);
    assert.equal(copy.hand.seats.reduce((n,s)=>n+s.total,0),100+preview.contribution);
  }
  t.players[0].chips=70;const cap=t.view('a').legal.potRaises[3];assert.equal(cap.contribution,70);assert.equal(cap.limit,'allin');
});

test('拖条按小盲整数倍取整，不足合法整档只可使用 All-in',()=>{
  const legal={canRaise:true,minTo:41,maxTo:997};
  assert.deepEqual(raiseSlider(legal,10),{min:50,max:990,step:10,value:50});
  for(let value=41;value<=997;value++){const s=raiseSlider(legal,10,value);assert.equal(s.value%10,0);assert.ok(s.value>=41&&s.value<=997);}
  assert.equal(raiseSlider({...legal,maxTo:49},10),null);
  assert.equal(raiseSlider({...legal,maxTo:40},10),null);
  assert.equal(raiseSlider({...legal,canRaise:false},10),null);
  assert.deepEqual(raiseSlider({canRaise:true,minTo:13,maxTo:24},5,21),{min:15,max:20,step:5,value:20});
});

test('随机名字头像保持稳定；鸡蛋鲜花互动校验身份、限速并不影响牌局积分',()=>{
  const t=new Table();t.add('a','甲');t.add('b','乙');t.start();
  assert.ok(t.players.every(p=>Number.isInteger(p.avatarHue)&&p.avatarHue>=0&&p.avatarHue<360));
  const hues=t.players.map(p=>p.avatarHue),before=JSON.stringify(t.hand),chips=t.players.map(p=>p.chips);
  assert.throws(()=>t.react('x','b','egg'));assert.throws(()=>t.react('a','x','egg'));assert.throws(()=>t.react('a','b','invalid'));
  t.react('a','b','egg');assert.equal(t.view('b').players[1].reaction.kind,'egg');assert.equal(t.events.at(-1).id,'a');assert.equal(t.events.at(-1).targetId,'b');
  assert.throws(()=>t.react('a','b','flower'),/3 秒/);t.players[0].lastReactionAt-=3001;t.react('a','b','flower');
  assert.equal(t.view('a').players[1].reaction.kind,'flower');assert.equal(JSON.stringify(t.hand),before);assert.deepEqual(t.players.map(p=>p.chips),chips);
  const restored=new Table(JSON.parse(JSON.stringify(t)));assert.deepEqual(restored.players.map(p=>p.avatarHue),hues);assert.throws(()=>restored.react('a','b','egg'),/3 秒/);
  restored.players[1].reaction.at-=6001;assert.equal(restored.view('a').players[1].reaction,null);
  const old=new Table({players:[{id:'old',name:'旧玩家',chips:77}]});assert.equal(old.players[0].chips,77);assert.ok(Number.isInteger(old.players[0].avatarHue));
});

test('最后操作保留三秒后才发下一轮公共牌并开始计时；停顿可恢复且不能抢先行动',()=>{
  const t=new Table();t.add('a','甲');t.add('b','乙');t.start();
  t.act('a','call');t.act('b','call');
  const until=t.hand.transitionAt,view=t.view('a');
  assert.ok(until>=Date.now()+2900);assert.equal(t.hand.street,0);
  assert.equal(view.hand.turn,null);assert.equal(view.hand.deadline,0);assert.equal(view.legal,null);
  assert.equal(view.hand.seats[1].lastAction.text,'过牌');assert.equal(view.hand.board.length,0);
  assert.throws(()=>t.act('b','call'),/还没轮到你/);
  const restored=new Table(JSON.parse(JSON.stringify(t)));
  assert.equal(restored.tick(until-1,()=>true,()=>false),false);
  assert.equal(restored.hand.seats[1].lastAction.text,'过牌');
  assert.equal(restored.tick(until,()=>true,()=>false),true);
  assert.equal(restored.hand.street,1);assert.equal(restored.hand.board.length,3);
  assert.equal(restored.view('b').hand.turn,'b');assert.ok(restored.legal('b'));
  assert.ok(restored.hand.deadline>=Date.now()+44900);
  // 全员离线时，展示阶段也冻结，返回后继续剩余展示时间。
  t.tick(until-2000,()=>false,()=>false);
  t.tick(until+8000,()=>true,()=>false);
  assert.equal(t.hand.transitionAt,until+10000);
  assert.equal(t.tick(until+9999,()=>true,()=>false),false);
  assert.equal(t.tick(until+10000,()=>true,()=>false),true);
  while(!restored.hand.done){
    const h=restored.hand;
    if(h.transitionAt){assert.equal(restored.legal('a'),null);restored.tick(h.transitionAt,()=>true,()=>false);}
    else restored.act(h.seats[h.turn].id,'call');
  }
  assert.equal(restored.players.reduce((n,p)=>n+p.chips,0),2000);
});
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
  assert.equal(t.view('a').hand.firstToAct,'a');
  assert.deepEqual(t.view('a').hand.seats[1].cards,[null,null]);assert.equal(t.view('a').hand.seats[0].cards.length,2);
  act(t,'a','call');assert.equal(t.hand.seats[t.hand.turn].id,'b');act(t,'b','call');
  assert.equal(t.hand.street,1);assert.equal(t.hand.seats[t.hand.turn].id,'b');
  assert.equal(t.view('a').hand.firstToAct,'b');
});
test('非法操作没有改变筹码，结束后立即重置积分',()=>{
  const t=new Table();t.add('a','甲');t.add('b','乙');t.start();
  assert.throws(()=>act(t,'b','raise',100));assert.throws(()=>act(t,'a','raise',25));
  assert.throws(()=>act(t,'a','raise',NaN));assert.equal(t.players[0].chips,990);
  act(t,'a','raise',100);t.end();assert.deepEqual(t.players.map(p=>p.chips),[1000,1000]);
});

test('结束立即重置赢家、离线下场和中途加入者；自然结束后无需重新开场也可重置',()=>{
  const t=new Table();t.add('a','甲');t.add('b','乙');t.start();
  act(t,'a','fold');assert.notEqual(t.players[0].chips,1000);
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
  assert.equal(t.view('a').hand.firstToAct,'d');assert.equal(t.view('a').hand.dealer,'a');
  assert.equal(t.view('a').hand.seats.find(s=>s.id==='b').lastAction.text,'小盲 10');
  act(t,'d','call');act(t,'a','fold');act(t,'b','call');
  let view=t.view('a');
  assert.equal(view.hand.seats.find(s=>s.id==='d').lastAction.text,'跟注 20');
  assert.equal(view.hand.seats.find(s=>s.id==='a').lastAction.text,'弃牌');
  const before=structuredClone(view.hand.actions);assert.throws(()=>act(t,'d','raise',100));assert.deepEqual(t.view('a').hand.actions,before);
  act(t,'c','call');view=t.view('a');assert.equal(view.hand.street,1);assert.deepEqual(view.hand.actions,[]);
  assert.equal(view.hand.seats.find(s=>s.id==='c').recentAction.text,'过牌');
  assert.equal(view.hand.seats.find(s=>s.id==='c').recentAction.street,0);
  t.hand.seats.find(s=>s.id==='c').recentAction.at-=7000;
  assert.equal(t.view('a').hand.seats.find(s=>s.id==='c').recentAction.text,'过牌');
  assert.equal(t.view('a').hand.firstToAct,'b');
  assert.equal(view.hand.seats.find(s=>s.id==='a').lastAction.text,'弃牌');
  assert.equal(view.hand.seats.find(s=>s.id==='d').lastAction,null);
  act(t,'b','call');act(t,'c','raise',60);act(t,'d','raise',120);
  view=t.view('a');assert.deepEqual(view.hand.actions.map(x=>x.text),['过牌','下注 60','加注至 120']);
  assert.equal(view.hand.seats.find(s=>s.id==='b').lastAction.kind,'check');
  act(t,'b','call');act(t,'c','call');view=t.view('a');assert.equal(view.hand.street,2);assert.deepEqual(view.hand.actions,[]);
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
  act(t,'a','call');act(t,'b','call');act(t,'c','raise',30);
  assert.equal(t.legal('a').canRaise,false);assert.equal(t.legal('a').toCall,10);
  assert.throws(()=>act(t,'a','raise',100));
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
  act(t,'a','raise',100);act(t,'b','fold');
  const result=t.view('b').hand.settlement;
  assert.equal(result.showdown,false);assert.ok(result.rows.every(p=>p.bestCards.length===0&&p.place===null));
  const winner=result.rows.find(p=>p.id==='a');assert.equal(winner.won,40);assert.equal(winner.refund,80);assert.equal(winner.net,20);
  assert.deepEqual(t.view('b').hand.seats.find(p=>p.id==='a').cards,[null,null]);
});
test('局中加入下一手参与，原玩家积分不重置',()=>{
  const t=new Table();t.add('a','甲');t.add('b','乙');t.start();t.add('c','丙');
  assert.equal(t.hand.seats.length,2);assert.equal(t.view('c').players.find(p=>p.id==='c').waiting,true);
  act(t,t.hand.seats[t.hand.turn].id,'fold');const before=new Map(t.players.map(p=>[p.id,p.chips]));
  t.newHand();assert.equal(t.hand.seats.length,3);
  for(const s of t.hand.seats)assert.equal(t.player(s).chips+s.total,before.get(s.id));
  assert.equal(t.view('c').players.find(p=>p.id==='c').waiting,false);
});

test('离线缓冲后立即处理，后续只给在线玩家发牌，人数不足暂停而非重置',()=>{
  const t=new Table();['a','b','c'].forEach(id=>t.add(id,id));t.start();
  const away=t.hand.seats[t.hand.turn].id,online=id=>id!==away;
  assert.equal(tick(t,Date.now(),online,()=>false),false);
  assert.equal(tick(t,Date.now(),online,()=>true),true);
  assert.equal(t.players.find(p=>p.id===away).sittingOut,true);
  assert.equal(t.hand.seats.find(s=>s.id===away).folded,true);
  while(!t.hand.done)act(t,t.hand.seats[t.hand.turn].id,'call');
  t.newHand(online);assert.equal(t.hand.seats.length,2);assert.ok(t.hand.seats.every(s=>s.id!==away));
  while(!t.hand.done)act(t,t.hand.seats[t.hand.turn].id,'call');
  const chips=t.players.map(p=>p.chips),number=t.number;
  t.newHand(id=>id==='b');assert.equal(t.running,true);assert.equal(t.paused,true);assert.equal(t.number,number);
  assert.deepEqual(t.players.map(p=>p.chips),chips);
  t.resume(away);tick(t,Date.now(),()=>true,()=>true);assert.equal(t.paused,false);assert.equal(t.hand.seats.length,3);
});

test('全员离线冻结本手和计时，返回后继续，不空转或重置积分',()=>{
  const t=new Table();t.add('a','甲');t.add('b','乙');t.start();
  const before=JSON.stringify(t.hand),chips=t.players.map(p=>p.chips),now=Date.now();
  assert.equal(tick(t,now,()=>false,()=>true),true);
  assert.equal(tick(t,now+3600000,()=>false,()=>true),false);
  assert.equal(JSON.stringify(t.hand),before);assert.deepEqual(t.players.map(p=>p.chips),chips);
  assert.equal(t.view('a').legal,null);
  const deadline=t.hand.deadline;
  tick(t,now+3600000,()=>true,()=>true);assert.equal(t.paused,false);assert.equal(t.hand.deadline,deadline+3600000);
  assert.equal(t.number,1);
});

test('连续两次超时自动暂离，下一手不发牌，返回保持积分；主动操作清除计数',()=>{
  const t=new Table();['a','b','c'].forEach(id=>t.add(id,id));t.start();
  const away=t.hand.seats[t.hand.turn].id;
  for(let i=0;i<20&&!t.players.find(p=>p.id===away).sittingOut;i++){
    if(t.hand.done){t.newHand();continue;}
    const id=t.hand.seats[t.hand.turn].id;
    if(id===away)tick(t,t.hand.deadline,()=>true,()=>false);else act(t,id,'call');
  }
  const p=t.players.find(p=>p.id===away);assert.equal(p.timeouts,2);assert.equal(p.sittingOut,true);
  while(!t.hand.done){const id=t.hand.seats[t.hand.turn].id;if(id===away)tick(t,Date.now(),()=>true,()=>false);else act(t,id,'call');}
  t.newHand();assert.equal(t.hand.seats.length,2);const chips=p.chips;
  t.resume(away);assert.equal(p.timeouts,0);assert.equal(p.chips,chips);
  while(!t.hand.done)act(t,t.hand.seats[t.hand.turn].id,'call');t.newHand();assert.equal(t.hand.seats.length,3);
  p.timeouts=1;while(t.hand.seats[t.hand.turn].id!==away)act(t,t.hand.seats[t.hand.turn].id,'call');
  act(t,away,'call');assert.equal(p.timeouts,0);
});
test('200 场随机合法对局：守恒、可行动、能结束、记录无底牌泄露',()=>{
  for(let trial=0;trial<200;trial++){
    const t=new Table();for(let i=0;i<2+trial%8;i++)t.add(String(i),'玩家'+i);t.start();const total=t.players.length*1000;
    let steps=0;
    while(t.running&&steps++<3000){const h=t.hand;
      if(h.done){assert.equal(t.players.reduce((n,p)=>n+p.chips,0),total);t.newHand();continue;}
      if(h.transitionAt){assert.equal(t.view(h.seats[0].id).legal,null);flush(t);continue;}
      assert.equal(t.players.reduce((n,p)=>n+p.chips,0)+h.seats.reduce((n,s)=>n+s.total,0),total);
      const id=h.seats[h.turn].id,l=t.legal(id);assert.ok(l);assert.ok(h.pending.includes(id));
      const n=Math.random();
      if(n<.15)act(t,id,'fold');else if(n<.5&&l.canRaise)act(t,id,'raise',n<.3?l.maxTo:Math.min(l.maxTo,l.minTo));else act(t,id,'call');
    }
    assert.ok(steps<3000);assert.equal(t.players.reduce((n,p)=>n+p.chips,0),total);
  }
});
