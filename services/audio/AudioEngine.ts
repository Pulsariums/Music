import { InstrumentPreset, SustainMode } from "../../types";
import { Logger } from "../../lib/logger";

/**
 * SoundSphere Audio Engine v5.0 (FM + ADSR)
 * 
 * Major Upgrade:
 * - Implemented full ADSR (Attack, Decay, Sustain, Release) envelope shaping.
 * - This allows for "Slow" sounds (Violins/Pads) and "Sharp" sounds (Plucks/Drums).
 */
class FMAudioCore {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private limiter: DynamicsCompressorNode | null = null;
  
  // Recorder Nodes
  private mediaDest: MediaStreamAudioDestinationNode | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private recordingChunks: Blob[] = [];

  // Reverb (Algorithmic)
  private convolver: ConvolverNode | null = null;

  // Active Voices Registry
  private activeVoices: Map<number, VoiceNode[]> = new Map();

  constructor() {
    Logger.log('info', 'FMAudioCore: Engine v5 Initialized');
  }

  public async init(options?: AudioContextOptions) {
    if (this.ctx) return;

    try {
        const AudioContextClass = (window.AudioContext || (window as any).webkitAudioContext);
        this.ctx = new AudioContextClass(options || { latencyHint: 'interactive' });

        // 1. Master Bus
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = 0.4; 

        // 2. Brickwall Limiter
        this.limiter = this.ctx.createDynamicsCompressor();
        this.limiter.threshold.value = -1.0; 
        this.limiter.knee.value = 0;
        this.limiter.ratio.value = 20; 
        this.limiter.attack.value = 0.001; 
        this.limiter.release.value = 0.1;

        // 3. Reverb Unit
        this.convolver = this.ctx.createConvolver();
        this.convolver.buffer = this.generateReverbImpulse(3.0);
        
        const reverbReturn = this.ctx.createGain();
        reverbReturn.gain.value = 1.0; 

        // Graph
        this.convolver.connect(reverbReturn);
        reverbReturn.connect(this.masterGain);
        this.masterGain.connect(this.limiter);
        this.limiter.connect(this.ctx.destination);

        // 4. Recording Tap
        this.mediaDest = this.ctx.createMediaStreamDestination();
        this.limiter.connect(this.mediaDest);

        Logger.log('info', 'FMAudioCore: Context Ready', { sampleRate: this.ctx.sampleRate });
    } catch (e: any) {
        Logger.log('error', 'Audio Engine Init Failed', { error: e.message });
    }
  }

  // --- RECORDING ---
  public startRecording() {
    if (!this.mediaDest) return;
    this.recordingChunks = [];
    const mimeType = 'audio/webm;codecs=opus';
    this.mediaRecorder = new MediaRecorder(this.mediaDest.stream, { mimeType });
    this.mediaRecorder.ondataavailable = (evt) => {
       if (evt.data.size > 0) this.recordingChunks.push(evt.data);
    };
    this.mediaRecorder.start();
  }

  public async stopRecording(): Promise<Blob | null> {
    if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') return null;
    return new Promise((resolve) => {
        if (!this.mediaRecorder) return resolve(null);
        this.mediaRecorder.onstop = () => {
            const blob = new Blob(this.recordingChunks, { type: 'audio/webm' });
            this.recordingChunks = [];
            resolve(blob);
        };
        this.mediaRecorder.stop();
    });
  }

  // --- FM SYNTHESIS LOGIC ---

  private generateReverbImpulse(duration: number): AudioBuffer {
    if (!this.ctx) throw new Error("No Context");
    const len = this.ctx.sampleRate * duration;
    const buffer = this.ctx.createBuffer(2, len, this.ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const data = buffer.getChannelData(c);
      for (let i = 0; i < len; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
      }
    }
    return buffer;
  }

  public playNote(freq: number, preset: InstrumentPreset) {
    if (!this.ctx) { this.init(); return; }
    if (this.ctx.state === 'suspended') this.ctx.resume();

    this.stopNote(freq, true);

    const t = this.ctx.currentTime;
    
    // Create FM Voice
    const voice = this.createFMVoice(freq, preset, t);
    
    // Connect to Master (Dry)
    voice.outputNode.connect(this.masterGain!);

    // Connect to Reverb (Wet)
    if (this.convolver && preset.physics.reverbMix > 0) {
        const sendGain = this.ctx.createGain();
        sendGain.gain.value = preset.physics.reverbMix; 
        voice.outputNode.connect(sendGain);
        sendGain.connect(this.convolver);
    }

    this.activeVoices.set(freq, [voice]);
  }

  private createFMVoice(freq: number, preset: InstrumentPreset, t: number): VoiceNode {
    if (!this.ctx) throw new Error("No Context");

    const { tension, hammerHardness, attackTime, decayTime, sustainLevel } = preset.physics;

    // Map Params
    const harmonicRatio = tension * 4 + 0.5; // Controls Timbre
    const modulationIndex = hammerHardness * 1000; // Controls Brightness
    
    // 1. CARRIER (The Pitch)
    const carrier = this.ctx.createOscillator();
    carrier.type = 'sine';
    carrier.frequency.value = freq;

    // 2. MODULATOR (The Texture)
    const modulator = this.ctx.createOscillator();
    modulator.type = 'sine';
    modulator.frequency.value = freq * harmonicRatio;

    const modulatorGain = this.ctx.createGain();

    // 3. CARRIER ENVELOPE (Volume ADSR)
    const carrierGain = this.ctx.createGain();
    
    // Initial State
    carrierGain.gain.setValueAtTime(0, t);
    
    // Attack Phase
    // Use slightly exponential attack for natural feel
    carrierGain.gain.linearRampToValueAtTime(1.0, t + attackTime);
    
    // Decay & Sustain Phase
    if (preset.sustainMode === SustainMode.PERCUSSIVE) {
        // Percussive sounds ignore sustainLevel and fade out completely
        carrierGain.gain.exponentialRampToValueAtTime(0.001, t + attackTime + decayTime);
    } else {
        // Natural/Infinite sounds drop to sustain level
        const sustainVal = Math.max(0.001, sustainLevel); // prevent 0 for exponential ramp
        carrierGain.gain.exponentialRampToValueAtTime(sustainVal, t + attackTime + decayTime);
    }

    // 4. MODULATOR ENVELOPE (Brightness ADSR)
    // Brighter sounds have higher modulation index
    // The "Wub" effect comes from changing this envelope
    const modDepth = modulationIndex * (1 + (500/freq)); 
    modulatorGain.gain.setValueAtTime(0, t);
    modulatorGain.gain.linearRampToValueAtTime(modDepth, t + attackTime);
    
    // Brightness usually decays faster than volume
    const brightnessDecay = decayTime * 0.8; 
    modulatorGain.gain.exponentialRampToValueAtTime(modDepth * 0.1, t + attackTime + brightnessDecay);

    // Wiring
    modulator.connect(modulatorGain);
    modulatorGain.connect(carrier.frequency);
    carrier.connect(carrierGain);

    carrier.start(t);
    modulator.start(t);

    return {
      nodes: [carrier, modulator, modulatorGain, carrierGain],
      outputNode: carrierGain,
      preset: preset
    };
  }

  public stopNote(freq: number, immediate = false) {
    if (!this.ctx) return;
    const voices = this.activeVoices.get(freq);
    if (!voices) return;

    const t = this.ctx.currentTime;

    voices.forEach(voice => {
      const { releaseTime } = voice.preset.physics;
      const actualRelease = immediate ? 0.05 : releaseTime;

      // Cancel future scheduled events
      voice.outputNode.gain.cancelScheduledValues(t);
      
      // Grab current value to prevent popping
      const currentGain = voice.outputNode.gain.value;
      voice.outputNode.gain.setValueAtTime(currentGain, t);
      
      // Release Fade
      voice.outputNode.gain.linearRampToValueAtTime(0, t + actualRelease);

      // Stop Oscillators
      voice.nodes.forEach(node => {
          if (node instanceof OscillatorNode) {
              node.stop(t + actualRelease + 0.1);
          }
      });
      
      // Cleanup
      setTimeout(() => {
        voice.nodes.forEach(n => n.disconnect());
        voice.outputNode.disconnect();
      }, (actualRelease * 1000) + 200);
    });

    this.activeVoices.delete(freq);
  }

  public resume() {
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  public setVolume(value: number) {
    if (this.masterGain) {
      // Clamp between 0 and 1
      const clampedValue = Math.max(0, Math.min(1, value));
      this.masterGain.gain.value = clampedValue;
    }
  }

  public getVolume(): number {
    return this.masterGain?.gain.value ?? 0.4;
  }
}

interface VoiceNode {
  nodes: AudioNode[];
  outputNode: GainNode;
  preset: InstrumentPreset;
}

export const AudioEngine = new FMAudioCore();