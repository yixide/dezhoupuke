import {spawn} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {randomBytes,scryptSync} from 'node:crypto';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {Table,rank,evaluate} from '../poker.js';

// This helper always uses loopback and separate disposable practice data.
const root=path.resolve(import.meta.dirname,'..'),data=path.join(root,'data','local-practice');
const base='http://localhost:3002',botName='陪练机器人';
mkdirSync(data,{recursive:true});
const keysFile=path.join(data,'credentials.json'),stateFile=path.join(data,'state.json');
let keys;
if(!existsSync(keysFile)||!existsSync(stateFile)){
  keys={name:'本地玩家',adminPassword:randomBytes(18).toString('base64url'),entryCode:randomBytes(18).toString('base64url'),botToken:randomBytes(32).toString('base64url')};
  const hash=value=>{const salt=randomBytes(16).toString('hex');return{salt,value:scryptSync(value,salt,32).toString('hex')};};
  const table=new Table();table.add('practice-human',keys.name);table.add('practice-bot',botName);
  const saved={config:{admin:hash(keys.adminPassword),entry:hash(keys.entryCode)},table,sessions:[[keys.botToken,{playerId:'practice-bot',admin:false}]]};
  writeFileSync(keysFile,JSON.stringify(keys),{mode:0o600});writeFileSync(stateFile,JSON.stringify(saved),{mode:0o600});
}else keys=JSON.parse(readFileSync(keysFile,'utf8'));

try{await fetch(base+'/api/status',{signal:AbortSignal.timeout(500)});throw Error('本地陪练端口 3002 已占用，请使用已有的陪练页面或先停止旧进程');}
catch(err){if(err.message.includes('已占用'))throw err;}
if(!keys.botToken2){keys.botToken2=randomBytes(32).toString('base64url');writeFileSync(keysFile,JSON.stringify(keys),{mode:0o600});}
const saved=JSON.parse(readFileSync(stateFile,'utf8')),practiceTable=new Table(saved.table);
if(!practiceTable.players.some(p=>p.id==='practice-bot2'))practiceTable.add('practice-bot2','陪练机器人2');
saved.table=practiceTable;
if(!saved.sessions.some(([token])=>token===keys.botToken2))saved.sessions.push([keys.botToken2,{playerId:'practice-bot2',admin:false}]);
writeFileSync(stateFile,JSON.stringify(saved),{mode:0o600});
const bots=[{token:keys.botToken},{token:keys.botToken2}];
const child=spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,HOST:'127.0.0.1',PORT:'3002',DATA_DIR:data,SECURE_COOKIE:'0',TRUST_PROXY:'0'},stdio:['ignore','ignore','inherit']});
const controller=new AbortController();let stopped=false;
function stop(){if(stopped)return;stopped=true;for(const bot of bots){clearTimeout(bot.timer);clearInterval(bot.heartbeat);}controller.abort();child.kill();}
process.on('SIGINT',()=>{stop();process.exit(0);});process.on('SIGTERM',()=>{stop();process.exit(0);});process.on('exit',stop);
child.on('error',err=>{console.error(err.message);stop();process.exitCode=1;});
child.on('exit',()=>{if(!stopped){stop();process.exitCode=1;}});
async function post(bot,route,body){
  const res=await fetch(base+'/api/'+route,{method:'POST',headers:{'Content-Type':'application/json',Cookie:`session=${bot.token}`},body:JSON.stringify(body),signal:controller.signal});
  if(!res.ok)throw Error((await res.json()).error||'机器人操作失败');
}
function choose(view){
  const legal=view.legal,me=view.players.find(p=>p.id===view.me),seat=view.hand.seats.find(s=>s.id===view.me);
  // Only use the bot's own cards and public board, never the saved deck or another hand.
  const [a,b]=seat.cards,community=view.hand.board;
  const strong=community.length>=3?evaluate([...seat.cards,...community]).name!=='高牌':rank(a)===rank(b)||Math.max(rank(a),rank(b))>=13;
  if(legal.toCall>Math.min(250,me.chips*.5)&&!strong)return{action:'fold'};
  if(strong&&legal.canRaise&&Math.random()<.22&&legal.minTo<=Math.min(200,legal.maxTo))return{action:'raise',amount:legal.minTo};
  return{action:'call'};
}
function update(bot,view){
  bot.latest=view;
  const humanOnline=view.players.some(p=>p.id==='practice-human'&&p.online);
  if(!bot.greeted&&humanOnline){bot.greeted=true;post(bot,'chat',{text:'大家好'}).catch(()=>{});}
  if(!view.running)bot.chatHand=null;
  if(view.hand?.done&&bot.chatHand!==view.hand.number){
    bot.chatHand=view.hand.number;
    if(view.hand.settlement?.rows.some(p=>p.id===view.me&&p.won))post(bot,'chat',{text:'承让啦'}).catch(()=>{});
  }
  const me=view.players.find(p=>p.id===view.me);
  if(me?.sittingOut&&humanOnline)post(bot,'resume',{}).catch(()=>{});
  const key=humanOnline&&view.running&&!view.paused&&view.legal?`${view.hand.number}:${view.hand.street}:${view.hand.currentBet}:${view.hand.turn}`:'';
  if(key===bot.turnKey)return;clearTimeout(bot.timer);bot.turnKey=key;
  if(!key)return;
  bot.timer=setTimeout(()=>{if(bot.latest?.legal&&bot.turnKey===key)post(bot,'action',choose(bot.latest)).catch(err=>console.error('本地陪练：'+err.message));},5000+Math.random()*2000);
}
for(let i=0;i<50;i++){
  try{const res=await fetch(base+'/api/status');if(res.ok)break;}catch{}
  if(i===49){stop();throw Error('本地陪练启动超时');}await delay(100);
}
console.log(`本地陪练已启动：${base}/（两位机器人在线，每次思考 5～7 秒）`);
async function runBot(bot){
bot.heartbeat=setInterval(()=>post(bot,'heartbeat',{}).catch(()=>{}),15000);
while(!stopped){
  try{
    const res=await fetch(base+'/api/events?v=2',{headers:{Cookie:`session=${bot.token}`},signal:controller.signal});
    if(!res.ok)throw Error('机器人身份已失效，请停止陪练后检查本地练习数据');
    let buffer='';const decoder=new TextDecoder();
    for await(const chunk of res.body){
      buffer+=decoder.decode(chunk,{stream:true});let end;
      while((end=buffer.indexOf('\n\n'))>=0){const event=buffer.slice(0,end);buffer=buffer.slice(end+2);const line=event.split('\n').find(s=>s.startsWith('data: '));if(line)update(bot,JSON.parse(line.slice(6)));}
    }
  }catch(err){if(stopped)break;console.error('本地陪练连接：'+err.message);}
  if(!stopped)await delay(1000);
}
}
await Promise.all(bots.map(runBot));
