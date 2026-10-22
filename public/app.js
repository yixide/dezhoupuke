const $=id=>document.getElementById(id);
let state=null,source=null,online=false,lastHistory='',busy=false,toastTimer,clockOffset=0;
const positions=[[50,83],[19,82],[8,52],[20,17],[41,7],[63,7],[84,19],[93,53],[81,82]];
const ranks=['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
function el(tag,className,text){const n=document.createElement(tag);if(className)n.className=className;if(text!==undefined)n.textContent=text;return n;}
function cards(target,values,ghost=false){target.replaceChildren(...values.map(c=>{if(c===null)return el('div',ghost?'card ghost':'card back',ghost?'':'♠');const n=el('div',`card ${[1,3].includes(Math.floor(c/13))?'red':''}`,ranks[c%13]);n.append(el('span','','♠♥♣♦'[Math.floor(c/13)]));return n;}));}
function toast(message){$('toast').textContent=message;$('toast').style.display='block';clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').style.display='none',3500);}
async function api(route,data={}){const res=await fetch('/api/'+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const result=await res.json();if(!res.ok)throw Object.assign(Error(result.error||'请求失败'),{code:result.code,retryAfter:result.retryAfter});return result;}
function connect(){
  source?.close();const stream=source=new EventSource('/api/events?v=2');
  stream.onmessage=e=>{if(source!==stream)return;const next=JSON.parse(e.data);if(!next.historyReset)next.history=[...(state?.history||[]),...next.history].slice(-300);state=next;online=true;$('overlay').hidden=true;$('connection').classList.remove('offline');$('connection').textContent='已连接牌桌';render();};
  stream.onerror=async()=>{
    if(source!==stream)return;online=false;$('connection').classList.add('offline');$('connection').textContent='断线重连中…';updateActions();
    try{const r=await fetch('/api/status'),status=await r.json();if(source!==stream)return;if(!status.authenticated){stream.close();state=null;$('overlay').hidden=false;showJoin();$('login-error').textContent='登录身份已失效，请重新加入；原座位可能已在其他浏览器恢复';}}catch{}
  };
}
function render(){
  clockOffset=state.serverTime-Date.now();
  const s=state,h=s.hand,me=s.players.find(p=>p.id===s.me);
  if(!me){location.reload();return;}
  $('phase').textContent=h?`${h.done?'本手结束':['翻牌前','翻牌','转牌','河牌'][h.street]} · 第 ${h.number} 手`:'等待开场';
  cards($('board'),[...(h?.board||[]),...Array(5-(h?.board.length||0)).fill(null)],true);
  $('pot').textContent=(h?.pot||0).toLocaleString();
  $('table-message').textContent=h?.done?s.message:!s.running?s.message:`${s.players.find(p=>p.id===h?.turn)?.name||''} 正在思考`;
  $('hand-number').textContent=s.number?`第 ${s.number} 手`:'尚未开始';
  const mySeat=h?.seats.find(x=>x.id===s.me);
  $('my-name').textContent=me.name;
  $('my-score').textContent=me.chips.toLocaleString();
  cards($('my-cards'),mySeat?.cards||[null,null]);
  const mine=s.players.findIndex(p=>p.id===s.me),ordered=s.players.slice(mine).concat(s.players.slice(0,mine));
  const displaySeats=Array(9).fill(null);ordered.forEach((p,i)=>{displaySeats[Math.floor(i*9/ordered.length)]=p;});
  $('seats').replaceChildren(...Array.from({length:9},(_,i)=>{
    const p=displaySeats[i],x=h?.seats.find(x=>x.id===p?.id),seat=el('div','seat'+(!p?' empty-seat':'')+(p?.id===s.me?' self':'')+(h?.turn===p?.id?' active':'')+(x?.folded||p?.eliminated?' out':'')+(p?.online===false?' offline':''));
    seat.style.left=`clamp(var(--seat-edge-x), ${positions[i][0]}%, calc(100% - var(--seat-edge-x)))`;
    seat.style.top=`clamp(var(--seat-edge-y), ${positions[i][1]}%, calc(100% - var(--seat-edge-y)))`;
    const head=el('div','seat-head');
    if(!p){head.append(el('div','seat-name','空座'));seat.append(head);return seat;}
    head.title=p.online===false?'离线，可使用原名字和口令恢复':'在线';
    head.append(el('div','seat-name',p.name+(p.id===s.me?' · 你':'')),el('div','seat-score',p.chips.toLocaleString()));
    if(h?.dealer===p.id)head.append(el('div','dealer','D'));
    seat.append(head);
    const cs=el('div','cards');if(x)cards(cs,x.cards);seat.append(cs);
    seat.append(el('div','seat-status',p.online===false?'离线，可重连':p.eliminated?'已下场':p.waiting?'等待下次开场':x?.folded?'已弃牌':x&&p.chips===0?'All-in':h?.turn===p.id?'思考中':'已入座'));
    if(x?.bet&&!h.done)seat.append(el('div','bet',`已下 ${x.bet}`));return seat;
  }));
  const historyKey=JSON.stringify(s.history);
  if(historyKey!==lastHistory){lastHistory=historyKey;const box=$('history'),atBottom=box.scrollHeight-box.scrollTop-box.clientHeight<65;
    box.replaceChildren(...s.history.map(item=>{const row=el('div','history-entry');const date=new Date(item.at);row.append(el('time','',date.toLocaleTimeString('zh-CN',{hour12:false})),el('span','',item.text));return row;}));
    if(atBottom)box.scrollTop=box.scrollHeight;
  }
  $('admin-controls').hidden=!s.admin;$('become-admin').hidden=s.admin;$('role').textContent=s.admin?'管理员':'玩家';
  $('start').disabled=s.running||s.players.length<2||!online;$('end').disabled=!s.running||!online;
  $('remove-controls').replaceChildren();
  if(s.admin&&!s.running)s.players.filter(p=>p.id!==s.me).forEach(p=>{const row=el('div','remove-row');row.append(el('span','',p.name));const b=el('button','quiet','移除座位');b.onclick=()=>perform(()=>api('remove',{id:p.id}));row.append(b);$('remove-controls').append(row);});
  updateActions();
  updateClock();
}
function updateActions(){
  const s=state,l=s?.legal,enabled=!!l&&online&&!busy;
  for(const id of ['fold','call','raise','allin','amount'])$(id).disabled=!enabled;
  if(!s)return;
  const me=s.players.find(p=>p.id===s.me);
  $('action-hint').textContent=!online?'连接恢复后才能操作':!s.running?'等待管理员开始本场':me?.eliminated?'分数用完，本场已下场':me?.waiting?'本场已经开始，等待下一场':s.hand?.done?'本手已结算，稍后自动继续':l?(l.toCall?`轮到你 · 需跟注 ${l.call} 分`:'轮到你 · 可以过牌'): '等待其他玩家行动';
  $('call').textContent=l?.toCall?`跟注 ${l.call}`:'过牌';
  if(l){$('raise').disabled=!enabled||!l.canRaise;$('amount').disabled=!enabled||!l.canRaise;$('allin').disabled=!enabled||(!l.canRaise&&l.maxTo>s.hand.currentBet);
    const min=Math.min(l.minTo,l.maxTo);$('amount').min=min;$('amount').max=l.maxTo;
    if(!Number.isInteger(Number($('amount').value))||Number($('amount').value)<min||Number($('amount').value)>l.maxTo)$('amount').value=min;
  }
}
async function perform(fn){if(busy)return;busy=true;updateActions();try{await fn();}catch(e){toast(e.message);}finally{busy=false;updateActions();}}
$('join-form').onsubmit=async e=>{
  e.preventDefault();$('login-error').textContent='';
  const payload={name:$('name').value.trim(),password:$('password').value,admin:$('admin-login').checked};
  const controls=[...$('join-form').elements];controls.forEach(c=>c.disabled=true);
  try{
    let retries=0,result;
    while(true){try{result=await api('join',payload);break;}catch(err){
      if(err.code!=='reconnect_wait'||retries++>=2)throw err;
      $('login-error').textContent=err.message;
      await new Promise(resolve=>setTimeout(resolve,Math.min(5000,Math.max(1,err.retryAfter)*1000)));
    }}
    try{localStorage.setItem('holdem-name',payload.name);}catch{}
    $('password').value='';connect();if(result.resumed)toast('已恢复原来的座位和积分');
  }catch(err){$('login-error').textContent=err.message;}finally{controls.forEach(c=>c.disabled=false);}
};
$('admin-login').onchange=()=>{$('password-label').textContent=$('admin-login').checked?'管理员密码':'入口令';$('password').placeholder=$('admin-login').checked?'输入管理员密码':'向管理员获取';};
$('setup-form').onsubmit=async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;try{await api('setup',{key:$('setup-key').value,adminPassword:$('setup-password').value,entryCode:$('setup-code').value});$('setup-form').reset();showJoin();toast('设置完成，请用管理员身份加入');$('admin-login').checked=true;$('admin-login').onchange();}catch(err){$('login-error').textContent=err.message;}finally{b.disabled=false;}};
function showJoin(){$('join-form').hidden=false;$('setup-form').hidden=true;$('login-title').textContent='朋友，到你入座了。';$('login-desc').textContent='一个名字，一个口令，就能坐到一起。';$('login-error').textContent='';}
$('fold').onclick=()=>perform(()=>api('action',{action:'fold'}));
$('call').onclick=()=>perform(()=>api('action',{action:'call'}));
$('raise').onclick=()=>perform(()=>api('action',{action:'raise',amount:Number($('amount').value)}));
$('allin').onclick=()=>perform(()=>api('action',state.legal.maxTo>state.hand.currentBet?{action:'raise',amount:state.legal.maxTo}:{action:'call'}));
$('start').onclick=()=>perform(()=>api('start'));
$('end').onclick=()=>$('end-dialog').showModal();$('cancel-end').onclick=()=>$('end-dialog').close();
$('confirm-end').onclick=()=>perform(async()=>{await api('end');$('end-dialog').close();});
$('code-form').onsubmit=e=>{e.preventDefault();perform(async()=>{await api('code',{entryCode:$('entry-code').value});$('entry-code').value='';toast('入口令已修改，已入座玩家不受影响');});};
$('become-admin').onclick=()=>$('admin-dialog').showModal();$('cancel-admin').onclick=()=>$('admin-dialog').close();
$('show-rankings').onclick=()=>$('rankings-dialog').showModal();
$('close-rankings').onclick=()=>$('rankings-dialog').close();
$('open-app-window').onclick=()=>{
  const popup=window.open('/', 'friends-holdem-window', 'popup=yes,width=400,height=300,toolbar=no,menubar=no,location=no,status=no,scrollbars=no,resizable=yes');
  if(!popup){toast('弹窗被拦截，请允许此网站弹出窗口后重试');return;}
  // Features describe the content area; resizeTo requests the user's 400x300 OUTER window.
  try{popup.resizeTo(400,300);popup.focus();}catch{}
};
function setSidebar(open){document.body.classList.toggle('sidebar-open',open);$('toggle-sidebar').setAttribute('aria-expanded',String(open));}
const compactToolbar=matchMedia('(max-width:600px), (max-height:300px)');
let toolbarPinned=false;
function setToolbar(open){document.body.classList.toggle('tools-open',open);$('toggle-tools').setAttribute('aria-expanded',String(open));$('toggle-tools').setAttribute('aria-label',open?'收起顶部功能':'展开顶部功能');}
function closeToolbar(){toolbarPinned=false;setToolbar(false);}
$('toggle-tools').onclick=()=>{toolbarPinned=!toolbarPinned;setToolbar(toolbarPinned);};
document.querySelector('header').addEventListener('pointerenter',e=>{if(compactToolbar.matches&&e.pointerType==='mouse')setToolbar(true);});
document.querySelector('header').addEventListener('pointerleave',()=>{if(!toolbarPinned&&!$('header-tools').contains(document.activeElement))setToolbar(false);});
$('header-tools').addEventListener('click',e=>{if(e.target.closest('button'))closeToolbar();});
document.addEventListener('pointerdown',e=>{if(!e.target.closest('header'))closeToolbar();});
compactToolbar.addEventListener('change',closeToolbar);
$('toggle-sidebar').onclick=()=>setSidebar(!document.body.classList.contains('sidebar-open'));
$('close-sidebar').onclick=()=>{setSidebar(false);$('toggle-sidebar').focus();};
document.addEventListener('keydown',e=>{if(e.key==='Escape'){setSidebar(false);closeToolbar();}});
document.querySelector('.play-area').addEventListener('pointerdown',()=>setSidebar(false));
$('admin-form').onsubmit=e=>{e.preventDefault();perform(async()=>{await api('admin',{password:$('admin-pass').value});$('admin-pass').value='';$('admin-dialog').close();});};
function updateClock(){
  const h=state?.hand,clock=$('clock');
  clock.hidden=!h||h.done||!state.running;
  if(clock.hidden)return;
  const seconds=Math.max(0,Math.ceil((h.deadline-Date.now()-clockOffset)/1000));
  const mine=h.turn===state.me;
  $('clock-seconds').textContent=seconds;
  $('clock-label').textContent=mine?'轮到你':'行动剩余';
  clock.classList.toggle('your-turn',mine);
  clock.classList.toggle('urgent',seconds<=10);
  clock.setAttribute('aria-label',`${mine?'轮到你，':'行动'}剩余 ${seconds} 秒`);
}
setInterval(updateClock,250);
setInterval(()=>{if(online&&state)api('heartbeat').catch(()=>{});},15000);
window.addEventListener('pagehide',()=>{online=false;source?.close();});
window.addEventListener('pageshow',e=>{if(e.persisted&&state)connect();});
try{$('name').value=localStorage.getItem('holdem-name')||'';}catch{}
try{const res=await fetch('/api/status');const s=await res.json();if(!s.configured){$('join-form').hidden=true;$('setup-form').hidden=false;$('login-title').textContent='先把牌桌准备好。';$('login-desc').textContent='首次设置仅由管理员完成，密钥见服务器终端。';}else if(s.authenticated)connect();else showJoin();}catch{$('login-error').textContent='无法连接服务器，请稍后刷新';}
