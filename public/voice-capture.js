// Native-rate microphone input -> mono 16 kHz PCM, in independent 100 ms frames.
class VoiceCapture extends AudioWorkletProcessor {
  constructor(){super();this.frame=new ArrayBuffer(3200);this.view=new DataView(this.frame);this.index=0;this.sum=0;this.count=0;this.phase=0;}
  process(inputs){
    const input=inputs[0]?.[0];if(!input)return true;
    for(const value of input){
      this.sum+=value;this.count++;this.phase+=16000;
      if(this.phase>=sampleRate){
        this.phase-=sampleRate;const sample=Math.max(-1,Math.min(1,this.sum/this.count));this.sum=0;this.count=0;
        this.view.setInt16(this.index*2,Math.round(sample*(sample<0?32768:32767)),true);
        if(++this.index===1600){this.port.postMessage(this.frame,[this.frame]);this.frame=new ArrayBuffer(3200);this.view=new DataView(this.frame);this.index=0;}
      }
    }
    return true;
  }
}
registerProcessor('voice-capture',VoiceCapture);
