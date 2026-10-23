import {RoomAudio} from './audio.js';
import {PushToTalk} from './voice-client.js';
import {raiseSlider} from './betting.js';
const $=id=>document.getElementById(id);
let state=null,source=null,online=false,lastHistory='',busy=false,toastTimer,clockOffset=0,lastSettlement=null,shownSettlement=null,autoSettlementOpen=false;
let liveEventSeq=null,sliderKey='',chatSending=false;
let showHandId=null,showSelection=new Set();
let reactionTarget=null,pendingReactions=[],reactionUntil=0,turnPromptKey='',nextTurnSound=0;
const turnBanner=document.createElement('div');turnBanner.className='turn-banner';turnBanner.hidden=true;turnBanner.setAttribute('role','status');document.querySelector('.action-panel').prepend(turnBanner);
const positions=[[50,83],[19,82],[8,52],[20,17],[41,7],[63,7],[84,19],[93,53],[81,82]];
const ranks=['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
const blindProgress=document.createElement('small');blindProgress.className='blind-progress';document.querySelector('.blind').append(blindProgress);
function el(tag,className,text){const n=document.createElement(tag);if(className)n.className=className;if(text!==undefined)n.textContent=text;return n;}
const chatOpen=el('button','hint-tool','💬 聊天');chatOpen.id='open-chat';chatOpen.setAttribute('aria-label','打开快捷聊天');
const soundToggle=el('button','hint-tool');soundToggle.id='toggle-sound';soundToggle.setAttribute('aria-label','切换牌桌音效和聊天语音');
const roomAudio=new RoomAudio(status=>{soundToggle.title=status==='就绪'?'牌桌音效和聊天语音已开启':status;});
function updateSoundButton(){soundToggle.textContent=roomAudio.enabled?'🔊':'🔇';soundToggle.setAttribute('aria-pressed',String(roomAudio.enabled));}
updateSoundButton();soundToggle.title='点击页面后启用牌桌音效与聊天语音';
soundToggle.onclick=()=>{roomAudio.toggle();updateSoundButton();};
document.addEventListener('pointerdown',()=>roomAudio.prime(),{capture:true});document.addEventListener('keydown',()=>roomAudio.prime(),{capture:true});
const voiceButton=el('button','quiet voice-hold','🎙 按住说话'),voiceListen=el('button','quiet','🔊 收听'),voiceStatus=el('span','voice-status');
voiceButton.id='voice-hold';voiceButton.title='按住说话，松开结束；也可聚焦后按住空格';voiceStatus.setAttribute('role','status');voiceListen.setAttribute('aria-label','切换玩家语音收听');
const voiceTools=el('div','voice-tools');voiceTools.append(voiceButton,voiceListen,voiceStatus);document.querySelector('.table-tools').after(voiceTools);
const voice=new PushToTalk({button:voiceButton,listenButton:voiceListen,status:voiceStatus,api,notice:toast,onSpeaker:speaker=>{
  for(const avatar of document.querySelectorAll('.seat-avatar'))avatar.classList.toggle('voice-speaking',avatar.dataset.player===speaker?.playerId);
}});
function processEvents(next){
  if(next.historyReset||liveEventSeq===null){liveEventSeq=next.eventSeq||0;return;}
  if(next.hand&&state?.hand){
    const changedHand=next.hand.id!==state.hand.id;
    if(changedHand||next.hand.street!==state.hand.street)roomAudio.enqueue({kind:'deal',at:Date.now()});
    else if(next.hand.done&&!state.hand.done)roomAudio.enqueue({kind:'win',at:Date.now()});
  }else if(next.hand&&!state?.hand)roomAudio.enqueue({kind:'deal',at:Date.now()});
  for(const event of next.events||[])if(event.seq>liveEventSeq&&Date.now()+clockOffset-event.at<10000){
    roomAudio.enqueue({...event,at:event.at-clockOffset});
    if(event.type==='reaction')pendingReactions.push(event);
  }
  liveEventSeq=Math.max(liveEventSeq,next.eventSeq||0);
}
function syncRaiseLabel(){const value=Number($('amount').value);$('amount-value').textContent=raiseSlider(state?.legal,state?.smallBlind)?value.toLocaleString():'—';$('amount').setAttribute('aria-valuetext',`加注至 ${value} 分，每档 ${state?.smallBlind||10} 分`);}
$('amount').oninput=()=>{const range=raiseSlider(state?.legal,state?.smallBlind,Number($('amount').value));if(range)$('amount').value=range.value;syncRaiseLabel();};
const potLabels={4:'1/4 池',3:'1/3 池',2:'1/2 池',1:'满池'};
for(const denominator of [4,3,2,1]){
  const button=el('button','quiet',potLabels[denominator]);button.dataset.fraction=denominator;button.disabled=true;
  button.onclick=()=>perform(()=>api('action',{action:'raise',potFraction:denominator,handId:state.hand.id,street:state.hand.street,currentBet:state.hand.currentBet}));$('pot-presets').append(button);
}
const reactionDialog=el('dialog');reactionDialog.id='reaction-dialog';reactionDialog.setAttribute('aria-labelledby','reaction-title');
const reactionHeading=el('div','settlement-heading'),reactionTitle=el('h2');reactionTitle.id='reaction-title';
const closeReaction=el('button','quiet','关闭');closeReaction.onclick=()=>reactionDialog.close();reactionHeading.append(reactionTitle,closeReaction);
const reactionChoices=el('div','reaction-choices'),reactionNote=el('p','chat-note','纯表情互动，不扣积分；每 3 秒可发送一次。');
reactionDialog.append(reactionHeading,reactionNote,reactionChoices);document.body.append(reactionDialog);
const reactionAnnounce=el('div','sr-only');reactionAnnounce.setAttribute('role','status');document.body.append(reactionAnnounce);
for(const [kind,label] of [['egg','🥚 扔鸡蛋'],['flower','🌹 送花']]){
  const button=el('button','quiet',label);button.onclick=()=>{
    const targetId=reactionTarget;
    perform(async()=>{await api('reaction',{targetId,kind});reactionUntil=Date.now()+3000;reactionDialog.close();});
  };reactionChoices.append(button);
}
function updateReactionControls(){
  const target=state?.players.find(p=>p.id===reactionTarget);
  if(reactionDialog.open&&!target)reactionDialog.close();
  for(const button of reactionChoices.children)button.disabled=!online||busy||!target||Date.now()<reactionUntil;
}
function openReaction(player){reactionTarget=player.id;reactionTitle.textContent=`与 ${player.name} 互动`;updateReactionControls();reactionDialog.showModal();}
function burstEgg(targetId,fallback,reduced){
  const target=[...document.querySelectorAll('.seat-avatar')].find(n=>n.dataset.player===targetId);
  const rect=target?.getBoundingClientRect(),point=rect?{x:rect.left+rect.width/2,y:rect.top+rect.height/2}:fallback;
  const burst=el('div','egg-burst');burst.setAttribute('aria-hidden','true');
  burst.style.left=point.x+'px';burst.style.top=point.y+'px';document.body.append(burst);
  const splash=el('span','egg-splash');burst.append(splash);
  roomAudio.enqueue({kind:'egg-impact',at:Date.now()});
  splash.animate(reduced?[{opacity:.95},{opacity:0}]:[
    {transform:'scale(.15)',opacity:0},{transform:'scale(1.2)',opacity:1,offset:.12},
    {transform:'scale(1)',opacity:.95,offset:.3},{transform:'translateY(6px) scale(1.03)',opacity:.85,offset:.72},
    {transform:'translateY(12px) scale(1.08)',opacity:0}
  ],{duration:reduced?900:1700,easing:'ease-out'}).finished.then(()=>burst.remove(),()=>burst.remove());
  if(reduced)return;
  for(let i=0;i<18;i++){
    const shell=i%3===0,fragment=el('i',shell?'egg-shell':'egg-drop');burst.append(fragment);
    const angle=i/18*Math.PI*2,reach=28+Math.random()*38,dx=Math.cos(angle)*reach,dy=Math.sin(angle)*reach,spin=Math.round(Math.random()*260-130);
    fragment.animate([
      {transform:'translate(0,0) rotate(0deg) scale(.3)',opacity:1},
      {transform:'translate('+dx+'px,'+dy+'px) rotate('+spin+'deg) scale(1)',opacity:1,offset:.45},
      {transform:'translate('+(dx*1.22)+'px,'+(dy+32)+'px) rotate('+(spin*1.7)+'deg) scale(.6)',opacity:0}
    ],{duration:650+Math.random()*400,easing:'cubic-bezier(.16,.7,.4,1)',fill:'forwards'});
  }
}
function animateReaction(event){
  const avatars=[...document.querySelectorAll('.seat-avatar')],from=avatars.find(n=>n.dataset.player===event.id),to=avatars.find(n=>n.dataset.player===event.targetId);
  reactionAnnounce.textContent=event.name+' '+event.text;
  if(!from||!to||document.querySelectorAll('.reaction-flight,.egg-burst').length>=12)return;
  const a=from.getBoundingClientRect(),b=to.getBoundingClientRect(),flight=el('div','reaction-flight',event.kind==='egg'?'🥚':'🌹');flight.setAttribute('aria-hidden','true');
  const start={x:a.left+a.width/2,y:a.top+a.height/2},end={x:b.left+b.width/2,y:b.top+b.height/2};
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(event.kind==='egg'&&reduced){burstEgg(event.targetId,end,true);return;}
  flight.style.left=start.x+'px';flight.style.top=start.y+'px';document.body.append(flight);
  const dx=end.x-start.x,dy=end.y-start.y;
  const frames=event.kind==='egg'?[
    {transform:'translate(0,0) rotate(-25deg) scale(.75)',opacity:1},
    {transform:'translate('+(dx*.5)+'px,'+(dy*.5-65)+'px) rotate(100deg) scale(1.1)',offset:.5,opacity:1},
    {transform:'translate('+dx+'px,'+dy+'px) rotate(220deg) scale(1)',opacity:1}
  ]:reduced?[{transform:'translate('+dx+'px,'+dy+'px)',opacity:1},{transform:'translate('+dx+'px,'+dy+'px)',opacity:0}]:[
    {transform:'translate(0,0) scale(.7)',opacity:1},
    {transform:'translate('+(dx*.5)+'px,'+(dy*.5-50)+'px) rotate(-20deg) scale(1.2)',offset:.45,opacity:1},
    {transform:'translate('+dx+'px,'+dy+'px) rotate(10deg) scale(1.6)',offset:.8,opacity:1},
    {transform:'translate('+dx+'px,'+dy+'px) scale(2)',opacity:0}];
  flight.animate(frames,{duration:event.kind==='egg'?650:reduced?500:1200,easing:'ease-in-out'}).finished.then(()=>{
    flight.remove();if(event.kind==='egg')burstEgg(event.targetId,end,false);
  },()=>flight.remove());
}
const topUpLabels={pending:'等待管理员审批',approved:'已同意，本手结算后到账',applied:'已到账',rejected:'管理员已拒绝',cancelled:'已取消'};
function renderTopUps(){
  const requests=state?.topUps||[],mine=requests.filter(r=>r.playerId===state.me).sort((a,b)=>b.id-a.id),active=mine.find(r=>['pending','approved'].includes(r.status)),latest=active||mine[0];
  $('submit-topup').disabled=!online||busy||!!active;$('topup-amount').disabled=!!active||busy;
  $('my-topup-status').textContent=latest?`你的申请：${latest.amount.toLocaleString()} 分 · ${topUpLabels[latest.status]}`:'每次可申请 1～100,000 分。';
  const pending=requests.filter(r=>r.status==='pending');
  $('open-topup').textContent=state.admin&&pending.length?`补分审批 (${pending.length})`:'申请补分';
  $('topup-indicator').textContent=active?topUpLabels[active.status]:'';
  $('topup-review').hidden=!state.admin;
  $('topup-requests').replaceChildren(...pending.map(r=>{
    const row=el('div','topup-request'),info=el('div');info.append(el('strong','',r.name),el('span','',`申请 ${r.amount.toLocaleString()} 分`));row.append(info);
    for(const approve of [true,false]){const b=el('button',approve?'':'quiet',approve?'同意':'拒绝');b.disabled=!online||busy;b.onclick=()=>perform(()=>api('topup/review',{requestId:r.id,approve}));row.append(b);}return row;
  }));
  if(!pending.length)$('topup-requests').append(el('p','subtle','暂无待审批申请'));
}
$('open-topup').onclick=()=>{renderTopUps();$('topup-dialog').showModal();};
$('close-topup').onclick=()=>$('topup-dialog').close();
$('topup-form').onsubmit=e=>{e.preventDefault();perform(async()=>{await api('topup/request',{amount:Number($('topup-amount').value)});toast('补分申请已提交，等待管理员审批');});};
function renderShowCards(){
  if(!$('show-dialog').open)return;
  const h=state?.hand,seat=h?.seats.find(s=>s.id===state.me);
  if(!seat||h.id!==showHandId){$('show-dialog').close();showSelection.clear();toast('手牌已变化，请重新选择亮牌');return;}
  const shown=seat.shown||[];shown.forEach(i=>showSelection.delete(i));
  $('show-card-choices').replaceChildren(...seat.cards.map((card,index)=>{
    const button=el('button','show-card-choice'+(showSelection.has(index)?' selected':'')),face=el('span','cards');cards(face,[card]);
    button.setAttribute('aria-label',`第 ${index+1} 张：${ranks[card%13]}${'♠♥♣♦'[Math.floor(card/13)]}${shown.includes(index)?'，已公开':''}`);
    button.setAttribute('aria-pressed',String(shown.includes(index)||showSelection.has(index)));button.disabled=!online||busy||shown.includes(index);
    button.append(face,el('span','',shown.includes(index)?'已公开':showSelection.has(index)?'已选择':'点击选择'));
    button.onclick=()=>{showSelection.has(index)?showSelection.delete(index):showSelection.add(index);renderShowCards();};return button;
  }));
  $('confirm-show').disabled=!online||busy||!showSelection.size;$('show-both').disabled=!online||busy||shown.length===2;
}
$('open-show').onclick=()=>{showHandId=state.hand.id;showSelection.clear();$('show-dialog').showModal();renderShowCards();};
$('close-show').onclick=()=>$('show-dialog').close();
function revealCards(indices){const handId=showHandId;perform(async()=>{await api('show',{handId,indices});$('show-dialog').close();toast('所选手牌已向全桌公开');});}
$('confirm-show').onclick=()=>revealCards([...showSelection]);$('show-both').onclick=()=>revealCards([0,1]);
chatOpen.onclick=()=>{
  if(!online)return;
  $('chat-choices').replaceChildren(...(state?.quickChats||[]).map(text=>{const button=el('button','quiet',text);button.disabled=chatSending;button.onclick=async()=>{
    if(chatSending)return;chatSending=true;$('chat-dialog').close();
    try{await api('chat',{text});}catch(err){toast(err.message);}finally{chatSending=false;}
  };return button;}));$('chat-dialog').showModal();
};
$('close-chat').onclick=()=>$('chat-dialog').close();
function positionChatBubbles(){
  for(const bubble of document.querySelectorAll('.chat-bubble')){
    bubble.style.marginLeft='0px';const r=bubble.getBoundingClientRect();bubble.style.marginLeft=`${r.left<4?4-r.left:r.right>innerWidth-4?innerWidth-4-r.right:0}px`;
  }
}
window.addEventListener('resize',positionChatBubbles);
const settlementPreview=el('div','settlement-preview');settlementPreview.hidden=true;document.querySelector('.table-center').append(settlementPreview);
const signed=n=>`${n>0?'+':''}${n.toLocaleString()}`;
function showSettlement(summary=false){
  if(!lastSettlement)return;
  summary=summary===true;autoSettlementOpen=summary;
  $('settlement-dialog').classList.toggle('summary-mode',summary);
  $('settlement-title').textContent=`第 ${lastSettlement.number} 手 · ${summary?'结算前三名':'完整结算'}`;
  document.querySelector('#settlement-dialog .settlement-note').textContent=summary?'按牌力排列；收入为赢得的底池，尚未扣除下注。':'摊牌按牌力从大到小排列，相同名次为平手；边池可能由不同玩家赢得。退回未跟注部分不算获胜。';
  const pots=el('div','pot-breakdown');
  (lastSettlement.pots||[]).forEach(p=>pots.append(el('div','',`${p.label} ${p.amount} 分 → ${p.winners.map(w=>`${w.name} ${w.amount} 分`).join('、')}`)));
  const ranked=lastSettlement.rows.filter(p=>p.place!==null),rows=summary?(ranked.length?ranked.slice(0,3):lastSettlement.rows.filter(p=>p.won)):lastSettlement.rows;
  $('settlement-rows').replaceChildren(...(summary?[]:[pots]),...rows.map(p=>{
    const row=el('section','settlement-row'+(p.won?' winner':'')),heading=el('div','result-heading');
    heading.append(el('strong','',`${p.place?`第 ${p.place} 名 · `:''}${p.name}`),el('span','result-net',`收入 +${p.won.toLocaleString()} 分`));
    row.append(heading,el('div','result-label',`${p.won?(summary?'🏆 ':'🏆 收取底池 '+p.won.toLocaleString()+' 分 · '):''}${p.detail||p.label}`));
    if(p.bestCards.length){const best=el('div','best-five');cards(best,p.bestCards);row.append(best);}
    row.append(el('small','result-profit',`本手净变化 ${signed(p.net)} 分`));
    if(p.refund)row.append(el('small','',`另退还未被跟注的 ${p.refund} 分`));
    return row;
  }));
  if(summary){const more=el('button','quiet all-results','查看全部结算');more.onclick=()=>showSettlement(false);$('settlement-rows').append(more);}
  if(!$('settlement-dialog').open)$('settlement-dialog').showModal();
}
$('close-settlement').onclick=()=>{autoSettlementOpen=false;$('settlement-dialog').close();};
function renderSettlement(){
  const h=state.hand,result=h?.settlement;
  settlementPreview.hidden=!result;document.querySelector('.table-center').classList.toggle('is-settled',!!result);
  if(!result){shownSettlement=null;if(autoSettlementOpen){$('settlement-dialog').close();autoSettlementOpen=false;}return;}
  lastSettlement={...result,number:h.number};
  const title=el('strong','settlement-winners',result.rows.filter(p=>p.won).map(p=>`🏆 ${p.name} 收入 +${p.won.toLocaleString()}`).join('；')||'本手结算');
  const list=el('div','settlement-order');
  result.rows.filter(p=>p.place).slice(0,3).forEach(p=>list.append(el('div','',`${p.place}. ${p.name} · ${p.detail||p.label} · 收入 +${p.won.toLocaleString()}`)));
  const button=el('button','quiet settlement-details','查看牌型 / 结算');button.onclick=showSettlement;
  settlementPreview.replaceChildren(title,list,button);
  if(shownSettlement!==h.number){shownSettlement=h.number;showSettlement(true);}
}
function cards(target,values,ghost=false){target.replaceChildren(...values.map(c=>{if(c===null)return el('div',ghost?'card ghost':'card back',ghost?'':'♠');const n=el('div',`card ${[1,3].includes(Math.floor(c/13))?'red':''}`,ranks[c%13]);n.append(el('span','','♠♥♣♦'[Math.floor(c/13)]));return n;}));}
function toast(message){$('toast').textContent=message;$('toast').style.display='block';clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').style.display='none',3500);}
async function api(route,data={}){const res=await fetch('/api/'+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const result=await res.json();if(!res.ok)throw Object.assign(Error(result.error||'请求失败'),{code:result.code,retryAfter:result.retryAfter});return result;}
function connect(){
  source?.close();const stream=source=new EventSource('/api/events?v=2');
  stream.addEventListener('voice-state',e=>{if(source===stream){const data=JSON.parse(e.data);if(state)state.voice=data.speaker;voice.sync(data.speaker,state?.me,online);}});
  stream.addEventListener('voice-audio',e=>{if(source===stream)voice.receive(JSON.parse(e.data));});
  stream.onmessage=e=>{if(source!==stream)return;const next=JSON.parse(e.data);processEvents(next);if(!next.historyReset)next.history=[...(state?.history||[]),...next.history].slice(-300);state=next;online=true;$('overlay').hidden=true;document.body.classList.remove('login-mode');document.title='同桌 · 朋友德州';$('connection').classList.remove('offline');$('connection').textContent='已连接牌桌';render();};
  stream.onerror=async()=>{
    if(source!==stream)return;online=false;voice.sync(null,state?.me,false);$('connection').classList.add('offline');$('connection').textContent='断线重连中…';updateActions();
    try{const r=await fetch('/api/status'),status=await r.json();if(source!==stream)return;if(!status.authenticated){stream.close();state=null;$('overlay').hidden=false;showJoin();$('login-error').textContent='登录身份已失效，请重新验证；该身份可能已在其他浏览器恢复';}}catch{}
  };
}
function render(){
  clockOffset=state.serverTime-Date.now();
  const s=state,h=s.hand,me=s.players.find(p=>p.id===s.me);
  if(!me){location.reload();return;}
  document.querySelector('.blind strong').textContent=`${s.blinds.small} / ${s.blinds.big}`;
  blindProgress.textContent=s.blinds.atMaximum?'已达最高档':`第 ${s.blinds.level} 档 · 第 ${s.blinds.nextHand} 手 ${s.blinds.next.small}/${s.blinds.next.big}`;
  document.querySelector('.chip-label').textContent=`盲注 ${s.blinds.small}/${s.blinds.big} · 每5手涨盲`;
  document.querySelector('.chip-label').title=blindProgress.textContent;
  $('phase').textContent=h?`第 ${h.number} 手${h.done?' · 本手结束':''}`:'等待开场';
  cards($('board'),[...(h?.board||[]),...Array(5-(h?.board.length||0)).fill(null)],true);
  $('pot').textContent=(h?.pot||0).toLocaleString();
  $('table-message').textContent=s.paused?'牌局暂停，等待至少两位在线玩家参与':h?.done?s.message:!s.running?s.message:h?.transitionAt?'本轮操作展示中，3 秒后继续':`${s.players.find(p=>p.id===h?.turn)?.name||''} 正在思考`;
  $('hand-number').textContent=s.number?`第 ${s.number} 手`:'尚未开始';
  const mySeat=h?.seats.find(x=>x.id===s.me);
  renderSettlement();
  $('my-name').textContent=me.name;
  $('my-score').textContent=me.chips.toLocaleString();
  cards($('my-cards'),mySeat?.cards||[null,null]);
  [...$('my-cards').children].forEach((card,i)=>{if(mySeat?.shown?.includes(i)){card.classList.add('public-card');card.title='这张牌已向全桌公开';}});
  const mine=s.players.findIndex(p=>p.id===s.me),ordered=s.players.slice(mine).concat(s.players.slice(0,mine));
  const displaySeats=Array(9).fill(null);ordered.forEach((p,i)=>{displaySeats[Math.floor(i*9/ordered.length)]=p;});
  $('seats').replaceChildren(...Array.from({length:9},(_,i)=>{
    const p=displaySeats[i],x=h?.seats.find(x=>x.id===p?.id),result=h?.settlement?.rows.find(r=>r.id===p?.id),seat=el('div','seat'+(!p?' empty-seat':'')+(p?.id===s.me?' self':'')+(p&&online&&s.running&&!s.paused&&!h?.done&&!h?.transitionAt&&h?.turn===p.id?' active':'')+(x?.folded||p?.eliminated?' out':'')+(p?.online===false?' offline':'')+(result?.won?' winner':''));
    seat.style.left=`clamp(var(--seat-edge-x), ${positions[i][0]}%, calc(100% - var(--seat-edge-x)))`;
    seat.style.top=`clamp(var(--seat-edge-y), ${positions[i][1]}%, calc(100% - var(--seat-edge-y)))`;
    const head=el('div','seat-head');
    if(!p){head.append(el('div','seat-name','空座'));seat.append(head);return seat;}
    head.title=p.online===false?'离线，可使用原名字和口令恢复':'在线';
    if(h?.turn===p.id&&p.id!==s.me&&!s.paused){
      const timer=el('div','seat-timer');timer.setAttribute('role','timer');
      timer.append($('clock').querySelector('svg').cloneNode(true),el('strong','seat-seconds','45'),el('span','','秒'));head.append(timer);
    }
    const name=el('button','seat-name seat-avatar',p.name+(p.id===s.me?' · 你':''));
    name.style.setProperty('--avatar-hue',p.avatarHue);name.dataset.player=p.id;name.title=`点击 ${p.name} 的头像：扔鸡蛋 / 送花`;
    name.setAttribute('aria-label',`${p.name}的头像，互动`);name.setAttribute('aria-haspopup','dialog');name.disabled=!online;name.onclick=()=>openReaction(p);
    if(h?.firstToAct===p.id){const first=el('span','first-actor','先手');first.title='本轮第一个行动的人';name.prepend(first);}
    if(x&&!x.folded&&!h.done&&p.chips===0){
      name.classList.add('all-in-avatar');name.setAttribute('aria-label',p.name+'的头像，All-in，互动');
      const flames=el('span','avatar-flames');flames.setAttribute('aria-hidden','true');
      for(let f=0;f<4;f++)flames.append(el('i','','🔥'));name.append(flames);
    }
    if(seat.classList.contains('active')){const prompt=el('span','turn-seat-label','▶ 请操作');head.append(prompt);}
    head.append(name,el('div','seat-score',p.chips.toLocaleString()));
    if(p.reaction){const badge=el('div','seat-reaction',p.reaction.kind==='egg'?'🍳':'🌹');badge.dataset.expires=p.reaction.at+6000;badge.title=`${p.reaction.name} ${p.reaction.text}`;head.append(badge);}
    if(x&&(!h.done||x.folded)){
      const recent=!x.lastAction&&!x.folded&&x.recentAction?.street<h.street?x.recentAction:null;
      const action=x.folded?'弃牌':x.lastAction?.text||recent?.text||(p.chips===0?'All-in':'');
      if(action){
        const badge=el('div',`seat-action action-${x.folded?'fold':x.lastAction?.kind||recent?.kind||'allin'}${recent?' action-recent':''}`,action);
        badge.title=action;head.append(badge);
        const trail=(h.actions||[]).filter(a=>a.id===p.id).map(a=>a.text).join(' → ');
        if(trail)badge.title=`本轮操作：${trail}`;
      }
    }
    if(x){
      const wagers=el('div','seat-wagers');wagers.classList.toggle('settled',!!h.done);
      wagers.setAttribute('aria-label',`${p.name}：本轮下注 ${x.bet} 分，本手累计下注 ${x.total} 分`);
      wagers.title=`本轮下注 ${x.bet.toLocaleString()} 分；本手累计下注 ${x.total.toLocaleString()} 分`;
      const addWager=(label,amount,className)=>{const row=el('div',className);row.append(el('span','',label),el('strong','',amount.toLocaleString()));wagers.append(row);};
      if(!h.done)addWager('本轮',x.bet,'wager-round');
      addWager(h.done?'本手已下':'累计',x.total,'wager-total');head.append(wagers);
    }
    if(h?.dealer===p.id){const dealer=el('div','dealer','庄');dealer.title='庄家（D），不一定是第一个行动的人';dealer.setAttribute('aria-label','庄家');head.append(dealer);}
    seat.append(head);
    if(result?.won){head.append(el('span','winner-badge','🏆 胜出'));head.append(el('div','seat-gain',`收入 +${result.won.toLocaleString()}`));}
    if(p.chat&&p.chat.at+6000>Date.now()+clockOffset){
      const bubble=el('div','chat-bubble');bubble.dataset.expires=p.chat.at+6000;bubble.setAttribute('role','status');
      bubble.append(el('strong','',p.name),el('span','',p.chat.text));head.append(bubble);
    }
    const cs=el('div','cards');if(x)cards(cs,x.cards);seat.append(cs);
    seat.append(el('div','seat-status',result?`${result.place?`第 ${result.place} 名 · `:''}${result.detail||result.label}`:p.online===false?'离线，可重连':p.eliminated?'已下场':p.sittingOut?'暂离':p.waiting?'下一手加入':x?.folded?'已弃牌':x&&p.chips===0?'All-in':h?.turn===p.id?'思考中':'已入座'));
    return seat;
  }));
  voice.sync(s.voice,s.me,online);
  positionChatBubbles();
  const historyKey=JSON.stringify(s.history);
  if(historyKey!==lastHistory){lastHistory=historyKey;const box=$('history'),atBottom=box.scrollHeight-box.scrollTop-box.clientHeight<65;
    box.replaceChildren(...s.history.map(item=>{const row=el('div','history-entry');const date=new Date(item.at);row.append(el('time','',date.toLocaleTimeString('zh-CN',{hour12:false})),el('span','',item.text));return row;}));
    if(atBottom)box.scrollTop=box.scrollHeight;
  }
  $('admin-controls').hidden=!s.admin;$('become-admin').hidden=s.admin;$('role').textContent=s.admin?'管理员':'玩家';
  $('start').disabled=s.running||s.players.length<2||!online;$('end').disabled=!s.players.length||!online;$('end').textContent=s.running?'结束并重置':'重置积分';
  $('remove-controls').replaceChildren();
  if(s.admin&&!s.running)s.players.filter(p=>p.id!==s.me).forEach(p=>{const row=el('div','remove-row');row.append(el('span','',p.name));const b=el('button','quiet','移除座位');b.onclick=()=>{removeId=p.id;$('remove-name').textContent=p.name;$('remove-dialog').showModal();};row.append(b);$('remove-controls').append(row);});
  updateActions();
  updateClock();
  pendingReactions.splice(0).forEach(animateReaction);
}
function updateActions(){
  const s=state,l=s?.legal,enabled=!!l&&online&&!busy;
  for(const id of ['fold','call','raise','allin','amount'])$(id).disabled=!enabled;
  for(const button of $('pot-presets').children){
    const preset=l?.potRaises?.find(p=>p.denominator===Number(button.dataset.fraction));button.disabled=!enabled||!preset||s?.players.find(p=>p.id===s.me)?.sittingOut;
    const limit=preset?.limit==='minimum'?'最小加注':preset?.limit==='allin'?'All-in':'';
    button.replaceChildren(el('span','',potLabels[button.dataset.fraction]),el('small','',preset?`投入 ${preset.contribution}${limit?' · '+limit:''}`:'—'));
    button.title=preset?`本次投入 ${preset.contribution} 分，加注至 ${preset.amount} 分；按当前底池比例计算${limit?'（'+limit+'限制）':''}`:'轮到你且允许加注时可用';
    button.setAttribute('aria-label',`${potLabels[button.dataset.fraction]}${preset?`，投入 ${preset.contribution} 分${limit?'，'+limit:''}`:''}`);
  }
  if(!s)return;
  const me=s.players.find(p=>p.id===s.me);
  $('open-topup').disabled=!online||busy;
  const ownSeat=s.hand?.seats.find(p=>p.id===s.me);
  $('open-show').disabled=!online||busy||!ownSeat||ownSeat.shown?.length===2;
  renderTopUps();renderShowCards();updateReactionControls();
  $('action-hint').textContent=!online?'连接恢复后才能操作':!s.running?'等待管理员开始本场':me?.eliminated?'分数用完，本场已下场':me?.sittingOut?'已暂离，点击“返回牌桌”后下一手参与':s.paused?'牌局暂停，等待在线玩家返回':me?.waiting?'下一手自动加入，现有积分不重置':s.hand?.done?'本手已结算，稍后自动继续':s.hand?.transitionAt?'本轮操作展示中，稍后继续':l?(l.toCall?`轮到你 · 需跟注 ${l.call} 分`:'轮到你 · 可以过牌'): '等待其他玩家行动';
  if(lastSettlement){const review=el('button','review-result',s.hand?.done?'查看结算':'上手结算');review.onclick=showSettlement;$('action-hint').append(review);}
  chatOpen.disabled=!online;$('action-hint').append(chatOpen,soundToggle);
  $('call').textContent=me?.sittingOut?'返回牌桌':l?.toCall?`跟注 ${l.call}`:'过牌';
  if(me?.sittingOut){for(const id of ['fold','raise','allin','amount'])$(id).disabled=true;$('call').disabled=!online||busy;return;}
  if(l){
    const key=`${s.hand.id}:${s.hand.street}:${s.hand.currentBet}:${l.maxTo}`,range=raiseSlider(l,s.smallBlind,sliderKey===key?Number($('amount').value):undefined);
    $('raise').disabled=!enabled||!range;$('amount').disabled=!enabled||!range;$('allin').disabled=!enabled||(!l.canRaise&&l.maxTo>s.hand.currentBet);
    $('amount').min=range?.min||0;$('amount').max=range?.max||0;$('amount').step=s.smallBlind;$('amount').value=range?.value||0;sliderKey=key;
  }else{sliderKey='';$('amount').min=0;$('amount').max=0;$('amount').value=0;}
  syncRaiseLabel();
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
$('admin-login').onchange=()=>{$('password-label').textContent=$('admin-login').checked?'管理员密码':'访问口令';$('password').placeholder=$('admin-login').checked?'输入管理员密码':'输入访问口令';};
$('setup-form').onsubmit=async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;try{await api('setup',{key:$('setup-key').value,adminPassword:$('setup-password').value,entryCode:$('setup-code').value});$('setup-form').reset();showJoin();toast('设置完成，请用管理员身份加入');$('admin-login').checked=true;$('admin-login').onchange();}catch(err){$('login-error').textContent=err.message;}finally{b.disabled=false;}};
function showJoin(){document.body.classList.add('login-mode');document.title='团队工作区';$('join-form').hidden=false;$('setup-form').hidden=true;$('login-title').textContent='团队工作区';$('login-desc').textContent='输入显示名称和访问口令，继续使用。';$('login-error').textContent='';$('admin-login').onchange();}
$('fold').onclick=()=>perform(()=>api('action',{action:'fold'}));
$('call').onclick=()=>perform(()=>state.players.find(p=>p.id===state.me)?.sittingOut?api('resume'):api('action',{action:'call'}));
let removeId=null;
$('cancel-remove').onclick=()=>$('remove-dialog').close();
$('confirm-remove').onclick=()=>perform(async()=>{await api('remove',{id:removeId});$('remove-dialog').close();removeId=null;});
$('raise').onclick=()=>perform(()=>api('action',{action:'raise',amount:Number($('amount').value)}));
$('allin').onclick=()=>perform(()=>api('action',state.legal.maxTo>state.hand.currentBet?{action:'raise',amount:state.legal.maxTo}:{action:'call'}));
$('start').onclick=()=>perform(()=>api('start'));
$('end').onclick=()=>{document.querySelector('#end-dialog h2').textContent=state.running?'结束本场并重置积分？':'重置所有玩家积分？';$('confirm-end').textContent=state.running?'结束并重置':'重置积分';$('end-dialog').showModal();};$('cancel-end').onclick=()=>$('end-dialog').close();
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
  updateReactionControls();
  for(const badge of document.querySelectorAll('.seat-reaction'))badge.hidden=Date.now()+clockOffset>=Number(badge.dataset.expires);
  for(const bubble of document.querySelectorAll('.chat-bubble'))bubble.hidden=Date.now()+clockOffset>=Number(bubble.dataset.expires);
  const h=state?.hand,clock=$('clock');
  const active=online&&!!h&&!h.done&&!h.transitionAt&&state.running&&!state.paused,mine=active&&h.turn===state.me;
  const secondsLeft=active?Math.max(0,Math.ceil((h.deadline-Date.now()-clockOffset)/1000)):0;
  const needsAction=mine&&!!state.legal&&!busy&&secondsLeft>0;
  document.body.classList.toggle('needs-action',needsAction);document.body.classList.toggle('turn-urgent',needsAction&&secondsLeft<=10);
  turnBanner.hidden=!needsAction;
  if(needsAction){
    const key=h.id+':'+h.street+':'+h.deadline;
    if(key!==turnPromptKey){turnPromptKey=key;nextTurnSound=0;turnBanner.textContent='轮到你了 · 请下注、过牌或弃牌';}
    document.title='⏰ 轮到你了 · 剩余 '+secondsLeft+' 秒';
    if(roomAudio.ready&&roomAudio.enabled&&Date.now()>=nextTurnSound){roomAudio.enqueue({kind:'turn',at:Date.now()});nextTurnSound=Date.now()+(secondsLeft<=10?3000:6000);}
  }else{turnPromptKey='';nextTurnSound=0;if(state)document.title='同桌 · 朋友德州';}
  if(!active)for(const seat of document.querySelectorAll('.seat.active'))seat.classList.remove('active');
  clock.hidden=!mine;
  if(!active)return;
  const seconds=Math.max(0,Math.ceil((h.deadline-Date.now()-clockOffset)/1000));
  const seatClock=document.querySelector('.seat-timer');
  if(seatClock){seatClock.querySelector('.seat-seconds').textContent=seconds;seatClock.classList.toggle('urgent',seconds<=10);seatClock.setAttribute('aria-label',`行动剩余 ${seconds} 秒`);}
  $('clock-seconds').textContent=seconds;
  $('clock-label').textContent=mine?'轮到你':'行动剩余';
  clock.classList.toggle('your-turn',mine);
  clock.classList.toggle('urgent',seconds<=10);
  clock.setAttribute('aria-label',`${mine?'轮到你，':'行动'}剩余 ${seconds} 秒`);
}
setInterval(updateClock,250);
setInterval(()=>{if(online&&state)api('heartbeat').catch(()=>{});},15000);
window.addEventListener('pagehide',()=>{online=false;voice.sync(null,state?.me,false);source?.close();});
window.addEventListener('pageshow',e=>{if(e.persisted&&state)connect();});
try{$('name').value=localStorage.getItem('holdem-name')||'';}catch{}
try{const res=await fetch('/api/status');const s=await res.json();if(!s.configured){$('join-form').hidden=true;$('setup-form').hidden=false;$('login-title').textContent='初始化工作区';$('login-desc').textContent='首次设置仅由管理员完成，密钥见服务器终端。';}else if(s.authenticated)connect();else showJoin();}catch{$('login-error').textContent='无法连接服务器，请稍后刷新';}
