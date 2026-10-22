import http from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Table } from './poker.js';

const root=path.dirname(fileURLToPath(import.meta.url));
const data=process.env.DATA_DIR||path.join(root,'data');mkdirSync(data,{recursive:true,mode:0o700});
const savePath=path.join(data,'state.json');
let saved=existsSync(savePath)?JSON.parse(readFileSync(savePath,'utf8')):{};
let config=saved.config||null;
const table=new Table(saved.table);
const sessions=new Map(saved.sessions||[]), streams=new Set(), attempts=new Map();
const reconnectGrace=Number(process.env.RECONNECT_GRACE_MS)||5000;
const presence=new Map(table.players.map(p=>[p.id,{lastSeen:0,offlineAt:Date.now()}]));
function hasConnection(id){return [...streams].some(c=>c.session.playerId===id);}
function touch(id){const now=Date.now();presence.set(id,{lastSeen:now,offlineAt:hasConnection(id)?null:now});}
function connectionState(id){
  const p=presence.get(id)||{lastSeen:0,offlineAt:Date.now()};
  const connections=[...streams].filter(c=>c.session.playerId===id);
  const online=connections.some(c=>!c.heartbeat)||(connections.length>0&&Date.now()-p.lastSeen<90000);
  const since=p.offlineAt??p.lastSeen+90000;
  return {online,retryAfter:online?0:Math.max(0,Math.ceil((since+reconnectGrace-Date.now())/1000))};
}
const bootstrap=process.env.SETUP_KEY||randomBytes(18).toString('base64url');
const hash=s=>{const salt=randomBytes(16).toString('hex');return {salt,value:scryptSync(s,salt,32).toString('hex')};};
const verify=(s,h)=>!!h&&timingSafeEqual(scryptSync(s,h.salt,32),Buffer.from(h.value,'hex'));
const persist=()=>{writeFileSync(savePath+'.tmp',JSON.stringify({config,table,sessions:[...sessions]}),{mode:0o600});renameSync(savePath+'.tmp',savePath);};
function snapshot(session){const view=table.view(session.playerId);view.players.forEach(p=>p.online=connectionState(p.id).online);return {...view,me:session.playerId,admin:!!session.admin,serverTime:Date.now()};}
function broadcast(except){persist();for(const c of streams){if(c===except)continue;const view=snapshot(c.session);view.history=view.history.filter(x=>x.seq>c.seq);view.historyReset=false;c.seq=table.logSeq;c.res.write(`data: ${JSON.stringify(view)}\n\n`);}}
function send(res,code,obj,headers={}){res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers});res.end(JSON.stringify(obj));}
function requireAdmin(s){if(!s?.admin)throw Error('需要管理员权限');}
function pass(value,label,min=4){if(typeof value!=='string'||value.length<min||value.length>100)throw Error(`${label}需要 ${min}～100 个字符`);return value;}
function sessionFor(req){const token=/\bsession=([a-zA-Z0-9_-]+)/.exec(req.headers.cookie||'')?.[1];return sessions.get(token);}
function acceptedAuth(req){const a=attempts.get(req.socket.remoteAddress);if(a)a.count=Math.max(0,a.count-1);}
async function body(req){let text='';for await(const chunk of req){text+=chunk;if(text.length>4096)throw Error('请求过大');}return JSON.parse(text||'{}');}
const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  const url=new URL(req.url,'http://localhost'),route=url.pathname;
  try{
    if(req.method==='GET'&&route==='/api/status'){const s=sessionFor(req);send(res,200,{configured:!!config,authenticated:!!s,name:s?table.players.find(p=>p.id===s.playerId)?.name:null,online:s?connectionState(s.playerId).online:false});return;}
    if(req.method==='GET'&&route==='/api/events'){
      const session=sessionFor(req);if(!session){send(res,401,{error:'请先加入牌桌'});return;}
      res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});
      const client={res,session,seq:table.logSeq,heartbeat:url.searchParams.get('v')==='2'};streams.add(client);touch(session.playerId);
      res.write(`data: ${JSON.stringify({...snapshot(session),historyReset:true})}\n\n`);broadcast(client);
      req.on('close',()=>{streams.delete(client);if(!hasConnection(session.playerId)){const p=presence.get(session.playerId);if(p)p.offlineAt=Date.now();}broadcast();});return;
    }
    if(req.method==='POST'&&route.startsWith('/api/')){
      if(req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host){send(res,403,{error:'请求来源无效'});return;}
      if(['/api/setup','/api/join','/api/admin'].includes(route)){
        const ip=req.socket.remoteAddress,now=Date.now();let a=attempts.get(ip);
        if(!a||now-a.since>60000){a={since:now,count:0};attempts.set(ip,a);}
        if(++a.count>15){send(res,429,{error:'尝试次数过多，请一分钟后再试'});return;}
      }
      const b=await body(req),s=sessionFor(req);
      if(route==='/api/setup'){
        if(config)throw Error('管理员已设置');
        if(typeof b.key!=='string'||b.key!==bootstrap)throw Error('初始化密钥错误，请查看服务器启动终端');
        config={admin:hash(pass(b.adminPassword,'管理员密码',8)),entry:hash(pass(b.entryCode,'入口令'))};acceptedAuth(req);persist();send(res,200,{ok:true});return;
      }
      if(!config)throw Error('请先完成管理员设置');
      if(route==='/api/join'){
        if(s&&table.players.some(p=>p.id===s.playerId)){acceptedAuth(req);touch(s.playerId);send(res,200,{ok:true,resumed:true});return;}
        const admin=b.admin===true,secret=typeof b.password==='string'?b.password:'';
        if(secret.length>100||!verify(secret,admin?config.admin:config.entry))throw Error(admin?'管理员密码错误':'入口令错误');
        acceptedAuth(req);
        const name=typeof b.name==='string'?b.name.trim():'';if(!name||name.length>16)throw Error('名字需要 1～16 个字符');
        const existing=table.players.find(p=>p.name===name);
        let id;
        if(existing){
          const status=connectionState(existing.id);
          if(status.online){send(res,409,{error:'这个名字仍在线，请关闭原页面后再重连；同一浏览器可直接刷新恢复',code:'name_online'});return;}
          if(status.retryAfter){send(res,409,{error:`原连接刚断开，${status.retryAfter} 秒后自动恢复座位`,code:'reconnect_wait',retryAfter:status.retryAfter});return;}
          if(!admin&&[...sessions.values()].some(x=>x.playerId===existing.id&&x.admin))throw Error('这是管理员座位，请勾选“我是管理员”并使用管理员密码恢复');
          id=existing.id;
          for(const [token,previous]of sessions)if(previous.playerId===id)sessions.delete(token);
          for(const c of [...streams])if(c.session.playerId===id){streams.delete(c);c.res.end();}
          table.log(`${name} 断线重连，恢复原座位与积分`);
        }else{id=randomBytes(12).toString('hex');table.add(id,name);}
        const token=randomBytes(32).toString('base64url');sessions.set(token,{playerId:id,admin});
        touch(id);
        send(res,200,{ok:true,resumed:!!existing},{'Set-Cookie':`session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${process.env.SECURE_COOKIE==='1'?'; Secure':''}`});broadcast();return;
      }
      if(!s){send(res,401,{error:'请先加入牌桌'});return;}
      touch(s.playerId);
      if(route==='/api/heartbeat'){send(res,200,{ok:true});return;}
      if(route==='/api/action')table.act(s.playerId,b.action,b.amount);
      else if(route==='/api/start'){requireAdmin(s);table.start();}
      else if(route==='/api/end'){requireAdmin(s);table.end();}
      else if(route==='/api/code'){requireAdmin(s);config.entry=hash(pass(b.entryCode,'入口令'));table.log('管理员已修改入口令');}
      else if(route==='/api/admin'){if(typeof b.password!=='string'||b.password.length>100||!verify(b.password,config.admin))throw Error('管理员密码错误');acceptedAuth(req);s.admin=true;}
      else if(route==='/api/remove'){
        requireAdmin(s);if(table.running)throw Error('请先结束本场，再移除座位');
        if(b.id===s.playerId)throw Error('不能移除自己');
        table.players=table.players.filter(p=>p.id!==b.id);table.players.forEach((p,i)=>p.seat=i);
        presence.delete(b.id);
        for(const [token,x] of sessions)if(x.playerId===b.id)sessions.delete(token);
        for(const c of streams)if(c.session.playerId===b.id){c.res.end();streams.delete(c);}
      }else throw Error('接口不存在');
      broadcast();send(res,200,{ok:true});return;
    }
    if(req.method==='GET'&&['/','/index.html','/app.js','/style.css'].includes(route)){
      const file=route==='/'?'index.html':route.slice(1);
      res.writeHead(200,{'Content-Type':file.endsWith('.js')?'text/javascript; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8','Cache-Control':'no-cache'});res.end(readFileSync(path.join(root,'public',file)));return;
    }
    send(res,404,{error:'不存在'});
  }catch(err){send(res,400,{error:err.message||'操作失败'});}
});
const timer=setInterval(()=>{
  try{
    const h=table.hand;
    if(table.running&&h&&!h.done&&Date.now()>=h.deadline){const id=h.seats[h.turn].id,l=table.legal(id);table.log('行动超时，自动处理');table.act(id,l.toCall?'fold':'call');broadcast();}
    else if(table.running&&h?.done&&Date.now()>=table.nextAt){table.newHand();broadcast();}
  }catch(e){console.error(e);}
},1000);
const heartbeat=setInterval(()=>{for(const c of streams)c.res.write(': heartbeat\n\n');for(const [ip,a]of attempts)if(Date.now()-a.since>60000)attempts.delete(ip);},20000);
server.listen(Number(process.env.PORT)||3000,process.env.HOST||'0.0.0.0',()=>{
  console.log(`朋友德州已启动：http://localhost:${server.address().port}`);
  if(!config)console.log(`首次初始化密钥（只交给管理员）：${bootstrap}`);
});
function stop(){clearInterval(timer);clearInterval(heartbeat);persist();for(const c of streams)c.res.end();server.close(()=>process.exit(0));}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
