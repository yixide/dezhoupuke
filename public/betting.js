// Range inputs use the small blind as an absolute grid, including after odd raises.
export function raiseSlider(legal,smallBlind,value) {
  if(!legal?.canRaise||!Number.isSafeInteger(smallBlind)||smallBlind<1)return null;
  const min=Math.ceil(legal.minTo/smallBlind)*smallBlind,max=Math.floor(legal.maxTo/smallBlind)*smallBlind;
  if(min>max)return null;
  const rounded=Number.isFinite(value)?Math.round(value/smallBlind)*smallBlind:min;
  return {min,max,step:smallBlind,value:Math.max(min,Math.min(max,rounded))};
}
