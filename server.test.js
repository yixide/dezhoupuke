import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
const freePort=()=>new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
test('真实 HTTP 多人流程、权限、底牌隔离、口令变更和重启恢复',async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'holdem-test-')),port=await freePort(),base=`http://127.0.0.1:${port}`;let child;const held=[];
  async function boot(){child=spawn(process.execPath,['server.js'],{cwd:import.meta.dirname,env:{...process.env,DATA_DIR:dir,PORT:String(port),HOST:'127.0.0.1',SETUP_KEY:'test-initialization-key',SECURE_COOKIE:'0'},stdio:['ignore','pipe','pipe']});
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('启动超时')),6000);child.once('error',reject);child.stdout.on('data',chunk=>{if(chunk.toString().includes('已启动')){clearTimeout(timer);resolve();}});});
  }
  async function stop(){held.splice(0).forEach(c=>c.abort());if(!child)return;const current=child;child=null;await new Promise(resolve=>{current.once('exit',resolve);current.kill();});}
  async function hold(cookie){const controller=new AbortController();held.push(controller);const res=await fetch(base+'/api/events?v=2',{headers:{Cookie:cookie},signal:controller.signal});await res.body.getReader().read();}
  async function post(route,data={},cookie=''){const res=await fetch(base+'/api/'+route,{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(data)});return {status:res.status,cookie:res.headers.get('set-cookie')?.split(';')[0],body:await res.json()};}
  async function snapshot(cookie){const controller=new AbortController();const res=await fetch(base+'/api/events',{headers:{Cookie:cookie},signal:controller.signal});assert.equal(res.status,200);const reader=res.body.getReader();let text='';try{while(!text.includes('\n\n'))text+=new TextDecoder().decode((await reader.read()).value);return JSON.parse(text.split('data: ')[1].split('\n')[0]);}finally{controller.abort();}}
  try{
    await boot();assert.equal((await fetch(base+'/')).status,200);
    assert.equal((await fetch(base+'/audio.js')).status,200);
    assert.equal((await fetch(base+'/friends-holdem-desktop.zip')).status,404);
    assert.equal((await fetch(base+'/data/state.json')).status,404);
    assert.equal((await fetch(base+'/api/events')).status,401);
    assert.equal((await post('setup',{key:'wrong',adminPassword:'test-admin-password',entryCode:'test-code'})).status,400);
    assert.equal((await post('setup',{key:'test-initialization-key',adminPassword:'test-admin-password',entryCode:'test-code'})).status,200);
    assert.equal((await post('join',{name:'陌生人',password:'wrong'})).status,400);
    const admin=(await post('join',{name:'测试管理员',admin:true,password:'test-admin-password'})).cookie;
    const friend=(await post('join',{name:'测试朋友',password:'test-code'})).cookie;
    assert.ok(admin);assert.ok(friend);
    await hold(admin);await hold(friend);
    assert.equal((await post('join',{name:'测试朋友',password:'test-code'})).status,409);
    assert.equal((await post('start',{},friend)).status,400);
    assert.equal((await post('start',{},admin)).status,200);
    let a=await snapshot(admin),b=await snapshot(friend);
    assert.ok(a.admin);assert.equal(b.admin,false);assert.equal(a.running,true);
    assert.deepEqual(a.hand.seats.find(s=>s.id===b.me).cards,[null,null]);
    assert.deepEqual(b.hand.seats.find(s=>s.id===a.me).cards,[null,null]);
    const tokenById={[a.me]:admin,[b.me]:friend};
    for(let i=0;i<12&&!a.hand.done;i++){
      assert.equal((await post('action',{action:'call'},tokenById[a.hand.turn])).status,200);a=await snapshot(admin);
    }
    assert.equal(a.hand.done,true);assert.equal(a.players.reduce((n,p)=>n+p.chips,0),2000);
    assert.equal(a.hand.board.length,5);assert.ok(a.history.some(x=>x.text.includes('摊牌')));
    const deltaController=new AbortController();
    try{
      const deltaResponse=await fetch(base+'/api/events',{headers:{Cookie:admin},signal:deltaController.signal});
      const deltaReader=deltaResponse.body.getReader();let buffer='';
      async function nextEvent(){while(!buffer.includes('\n\n'))buffer+=new TextDecoder().decode((await deltaReader.read()).value);const split=buffer.indexOf('\n\n');const event=JSON.parse(buffer.slice(0,split).split('data: ')[1]);buffer=buffer.slice(split+2);return event;}
      const initial=await nextEvent();assert.equal(initial.historyReset,true);
      assert.equal((await post('code',{entryCode:'new-test-code'},admin)).status,200);
      let delta=await nextEvent();while(!delta.history.length)delta=await nextEvent();assert.equal(delta.historyReset,false);assert.equal(delta.history.length,1);assert.ok(delta.history[0].seq>initial.history.at(-1).seq);
    }finally{deltaController.abort();}
    assert.equal((await post('join',{name:'迟到的朋友',password:'test-code'})).status,400);
    assert.equal((await post('join',{name:'迟到的朋友',password:'new-test-code'})).status,200);
    assert.equal((await post('end',{},admin)).status,200);
    const before=await snapshot(admin);
    await stop();await boot();const after=await snapshot(admin);
    const persisted=players=>players.map(({online,...p})=>p);
    assert.deepEqual(persisted(after.players),persisted(before.players));assert.deepEqual(after.history,before.history);assert.equal(after.admin,true);
    const csrf=await fetch(base+'/api/start',{method:'POST',headers:{Cookie:admin,Origin:'https://other.example'},body:'{}'});assert.equal(csrf.status,403);
  }finally{await stop();rmSync(dir,{recursive:true,force:true});}
});

async function connectionFixture(extraEnv={}){
  const dir=mkdtempSync(path.join(tmpdir(),'holdem-reconnect-')),port=await freePort(),base=`http://127.0.0.1:${port}`;
  const child=spawn(process.execPath,['server.js'],{cwd:import.meta.dirname,env:{...process.env,DATA_DIR:dir,PORT:String(port),HOST:'127.0.0.1',SETUP_KEY:'reconnect-test-key',SECURE_COOKIE:'0',RECONNECT_GRACE_MS:'120',...extraEnv},stdio:['ignore','pipe','pipe']});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('启动超时')),6000);child.once('error',reject);child.stdout.on('data',chunk=>{if(chunk.toString().includes('已启动')){clearTimeout(timer);resolve();}});});
  async function post(route,data={},cookie='',headers={}){const res=await fetch(base+'/api/'+route,{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie,...headers},body:JSON.stringify(data)});return{status:res.status,body:await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0]};}
  async function status(cookie){return(await fetch(base+'/api/status',{headers:{Cookie:cookie}})).json();}
  async function stream(cookie){
    const controller=new AbortController();const response=await fetch(base+'/api/events?v=2',{headers:{Cookie:cookie},signal:controller.signal});assert.equal(response.status,200);
    const reader=response.body.getReader();let buffer='';
    async function next(){while(true){while(!buffer.includes('\n\n')){const chunk=await reader.read();if(chunk.done)throw Error('连接结束');buffer+=new TextDecoder().decode(chunk.value);}const split=buffer.indexOf('\n\n'),message=buffer.slice(0,split);buffer=buffer.slice(split+2);const data=message.split('\n').find(s=>s.startsWith('data: '));if(data)return JSON.parse(data.slice(6));}}
    return{state:await next(),next,close:()=>controller.abort()};
  }
  async function offline(cookie){for(let i=0;i<100;i++){if(!(await status(cookie)).online)return;await delay(10);}throw Error('旧连接未下线');}
  async function close(){await new Promise(resolve=>{child.once('exit',resolve);child.kill();});rmSync(dir,{recursive:true,force:true});}
  await post('setup',{key:'reconnect-test-key',adminPassword:'test-admin-password',entryCode:'test-code'});
  return{post,status,stream,offline,close};
}

test('同名在线保护、多标签页、离线恢复积分手牌及旧 Cookie 失效',async()=>{
  const f=await connectionFixture(),opened=[];
  try{
    const admin=(await f.post('join',{name:'管理员',admin:true,password:'test-admin-password'})).cookie;
    const old=(await f.post('join',{name:'朋友',password:'test-code'})).cookie;
    const adminStream=await f.stream(admin);opened.push(adminStream);
    const one=await f.stream(old),two=await f.stream(old);opened.push(one,two);
    assert.equal((await f.post('join',{name:'朋友',password:'test-code'})).body.code,'name_online');
    one.close();assert.equal((await f.status(old)).online,true);
    assert.equal((await f.post('join',{name:'朋友',password:'test-code'})).body.code,'name_online');
    assert.equal((await f.post('join',{},old)).body.resumed,true);
    await f.post('start',{},admin);
    const during=await f.stream(old);opened.push(during);
    const before=during.state,player=before.players.find(p=>p.id===before.me);
    assert.equal(player.chips,980);
    const originalCards=before.hand.seats.find(s=>s.id===before.me).cards;
    two.close();during.close();await f.offline(old);
    assert.equal((await f.post('join',{name:'朋友',password:'test-code'})).body.code,'reconnect_wait');
    await delay(150);
    const restored=await f.post('join',{name:'朋友',password:'test-code'});
    assert.equal(restored.status,200);assert.equal(restored.body.resumed,true);
    assert.notEqual(restored.cookie,old);assert.equal((await f.status(old)).authenticated,false);
    assert.equal((await f.post('action',{action:'fold'},old)).status,401);
    const recovered=await f.stream(restored.cookie);opened.push(recovered);
    assert.equal(recovered.state.me,before.me);assert.equal(recovered.state.admin,false);
    assert.equal(recovered.state.players.length,2);assert.equal(recovered.state.players.find(p=>p.id===before.me).chips,980);
    assert.deepEqual(recovered.state.hand.seats.find(s=>s.id===before.me).cards,originalCards);
    assert.equal((await f.post('join',{name:'朋友',password:'test-code'})).body.code,'name_online');
    adminStream.close();await f.offline(admin);await delay(150);
    assert.match((await f.post('join',{name:'管理员',password:'test-code'})).body.error,/管理员密码/);
    const restoredAdmin=await f.post('join',{name:'管理员',admin:true,password:'test-admin-password'});
    assert.equal(restoredAdmin.status,200);assert.equal((await f.status(admin)).authenticated,false);
    const owner=await f.stream(restoredAdmin.cookie);opened.push(owner);assert.equal(owner.state.admin,true);
  }finally{opened.forEach(s=>s.close());await f.close();}
});

test('满桌九人也能同名恢复，不新增座位或重置积分',async()=>{
  const f=await connectionFixture(),opened=[];
  try{
    let first;
    for(let i=0;i<9;i++){const result=await f.post('join',{name:'玩家'+i,password:'test-code'});assert.equal(result.status,200);if(i===0)first=result.cookie;}
    const old=await f.stream(first);opened.push(old);const id=old.state.me;old.close();await f.offline(first);await delay(150);
    let resumed;
    for(let i=0;i<9;i++){const result=await f.post('join',{name:'玩家'+i,password:'test-code'});assert.equal(result.status,200);if(i===0)resumed=result;}
    const current=await f.stream(resumed.cookie);opened.push(current);assert.equal(current.state.me,id);assert.equal(current.state.players.length,9);
    for(let i=0;i<10;i++)assert.equal((await f.post('join',{name:'猜口令',password:'wrong-code'})).status,400);
    assert.equal((await f.post('join',{name:'猜口令',password:'wrong-code'})).status,429);
    assert.equal((await f.post('join',{name:'正确口令也要等待',password:'test-code'})).status,429);
  }finally{opened.forEach(s=>s.close());await f.close();}
});

test('真实 HTTP 中途入座下一手发牌，不重开或重置积分',async()=>{
  const f=await connectionFixture(),opened=[];
  try{
    const admin=(await f.post('join',{name:'管理员',admin:true,password:'test-admin-password'})).cookie;
    const friend=(await f.post('join',{name:'朋友',password:'test-code'})).cookie;
    assert.match((await f.post('start',{},admin)).body.error,/在线玩家/);
    const a=await f.stream(admin),b=await f.stream(friend);opened.push(a,b);
    assert.equal((await f.post('start',{},admin)).status,200);
    const late=(await f.post('join',{name:'新同事',password:'test-code'})).cookie;
    const c=await f.stream(late);opened.push(c);
    assert.equal(c.state.hand.seats.length,2);assert.equal(c.state.players.find(p=>p.id===c.state.me).waiting,true);
    const tokens=new Map([[a.state.me,admin],[b.state.me,friend]]);
    assert.equal((await f.post('action',{action:'fold'},tokens.get(c.state.hand.turn))).status,200);
    let settled=await c.next();while(!settled.hand.done)settled=await c.next();
    const chips=new Map(settled.players.map(p=>[p.id,p.chips]));
    let next=await c.next();while(next.number<2)next=await c.next();
    assert.equal(next.running,true);assert.equal(next.hand.seats.length,3);
    for(const s of next.hand.seats)assert.equal(next.players.find(p=>p.id===s.id).chips+s.total,chips.get(s.id));
    assert.equal(next.players.find(p=>p.id===next.me).waiting,false);
  }finally{opened.forEach(s=>s.close());await f.close();}
});

test('Nginx 代理按真实 IP 分开计数，默认不信任伪造的 IP 头',async()=>{
  for(const trust of ['0','1']){
    const f=await connectionFixture({TRUST_PROXY:trust});
    try{
      for(let i=0;i<10;i++)assert.equal((await f.post('join',{name:'猜密码',password:'wrong'},'',{'X-Real-IP':'192.0.2.1'})).status,400);
      assert.equal((await f.post('join',{name:'猜密码',password:'wrong'},'',{'X-Real-IP':'192.0.2.1'})).status,429);
      assert.equal((await f.post('join',{name:'另一个同事',password:'test-code'},'',{'X-Real-IP':'192.0.2.2'})).status,trust==='1'?200:429);
    }finally{await f.close();}
  }
});

test('快捷聊天真实双人同步：身份取自 Cookie、限制刷屏、重连不重复发送旧事件',async()=>{
  const f=await connectionFixture(),opened=[];
  try{
    assert.equal((await f.post('chat',{text:'大家好'})).status,401);
    const a=(await f.post('join',{name:'甲',password:'test-code'})).cookie,b=(await f.post('join',{name:'乙',password:'test-code'})).cookie;
    const first=await f.stream(a),second=await f.stream(b);opened.push(first,second);
    assert.equal((await f.post('chat',{text:'任意内容'},a)).status,400);
    assert.equal((await f.post('chat',{text:'大家好',name:'冒名',id:second.state.me},a)).status,200);
    let update=await second.next();while(!update.events?.length)update=await second.next();
    assert.equal(update.events.length,1);assert.equal(update.events[0].name,'甲');assert.equal(update.events[0].id,first.state.me);
    assert.equal(update.players.find(p=>p.id===first.state.me).chat.text,'大家好');
    assert.equal((await f.post('chat',{text:'好牌！'},a)).status,400);
    const reload=await f.stream(b);opened.push(reload);assert.equal(reload.state.historyReset,true);const seq=reload.state.eventSeq;
    assert.equal((await f.post('chat',{text:'到你了'},b)).status,200);
    let next=await reload.next();while(!next.events?.length)next=await reload.next();
    assert.ok(next.events.every(e=>e.seq>seq));assert.deepEqual(next.events.map(e=>e.text),['到你了']);
  }finally{opened.forEach(s=>s.close());await f.close();}
});
