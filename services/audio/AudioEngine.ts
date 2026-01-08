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
  private recordingMimeType: string = 'audio/webm'; // Store selected mime type
  
  // Recording constants
  private static readonly RECORDING_DATA_INTERVAL = 100; // ms between data collection
  private static readonly RECORDING_STOP_DELAY = 100; // ms to wait after stopping previous recording

  // Reverb (Algorithmic)
  private convolver: ConvolverNode | null = null;

  // Active Voices Registry
  private activeVoices: Map<number, VoiceNode[]> = new Map();

  // Audio Effects Settings
  private softModeEnabled: boolean = false;
  private spatialAudioEnabled: boolean = false;
  private softModeFilter: BiquadFilterNode | null = null;

  // Polyphony management - prevent clipping when many notes play
  private maxPolyphony: number = 32;
  private baseGain: number = 0.25; // Per-voice base gain

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
        this.masterGain.gain.value = 0.30; // Lower to prevent clipping with polyphony

        // 2. Soft Mode Filter (Low-pass for smoother sound)
        this.softModeFilter = this.ctx.createBiquadFilter();
        this.softModeFilter.type = 'lowpass';
        this.softModeFilter.frequency.value = 20000; // Full range when disabled
        this.softModeFilter.Q.value = 0.5;

        // 3. Brickwall Limiter (Very aggressive to prevent crackling)
        this.limiter = this.ctx.createDynamicsCompressor();
        this.limiter.threshold.value = -6.0; // Lower threshold catches more peaks
        this.limiter.knee.value = 6; // Softer knee for smoother limiting
        this.limiter.ratio.value = 20; 
        this.limiter.attack.value = 0.0005; // Very fast attack to catch transients
        this.limiter.release.value = 0.025; // Faster release to avoid pumping

        // 4. Reverb Unit
        this.convolver = this.ctx.createConvolver();
        this.convolver.buffer = this.generateReverbImpulse(3.0);
        
        const reverbReturn = this.ctx.createGain();
        reverbReturn.gain.value = 1.0; 

        // Graph: masterGain -> softModeFilter -> limiter -> destination
        this.convolver.connect(reverbReturn);
        reverbReturn.connect(this.masterGain);
        this.masterGain.connect(this.softModeFilter);
        this.softModeFilter.connect(this.limiter);
        this.limiter.connect(this.ctx.destination);

        // 5. Recording Tap
        this.mediaDest = this.ctx.createMediaStreamDestination();
        this.limiter.connect(this.mediaDest);

        Logger.log('info', 'FMAudioCore: Context Ready', { sampleRate: this.ctx.sampleRate });
    } catch (e: any) {
        Logger.log('error', 'Audio Engine Init Failed', { error: e.message });
    }
  }

  // --- RECORDING ---
  public async startRecording(): Promise<boolean> {
    try {
      // Ensure audio context is initialized
      if (!this.ctx) {
        await this.init();
      }
      
      // Resume context if suspended (browser autoplay policy)
      if (this.ctx && this.ctx.state === 'suspended') {
        await this.ctx.resume();
      }
      
      // Wait a bit for mediaDest to be ready
      if (!this.mediaDest) {
        Logger.log('error', 'Recording failed: mediaDest not available after init');
        return false;
      }
      
      // Stop any existing recording
      if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
        this.mediaRecorder.stop();
        await new Promise(resolve => setTimeout(resolve, FMAudioCore.RECORDING_STOP_DELAY));
      }
      
      this.recordingChunks = [];
      
      // Try different mime types for browser compatibility
      const mimeTypes = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
        'audio/mp4'
      ];
      
      let selectedMimeType = '';
      for (const mimeType of mimeTypes) {
        if (MediaRecorder.isTypeSupported(mimeType)) {
          selectedMimeType = mimeType;
          break;
        }
      }
      
      if (!selectedMimeType) {
        Logger.log('error', 'No supported audio format found for recording');
        return false;
      }
      
      // Store selected mime type for stopRecording
      this.recordingMimeType = selectedMimeType;
      
      this.mediaRecorder = new MediaRecorder(this.mediaDest.stream, { mimeType: selectedMimeType });
      this.mediaRecorder.ondataavailable = (evt) => {
         if (evt.data.size > 0) this.recordingChunks.push(evt.data);
      };
      this.mediaRecorder.start(FMAudioCore.RECORDING_DATA_INTERVAL);
      Logger.log('info', 'Recording started', { mimeType: selectedMimeType });
      return true;
    } catch (e: any) {
      Logger.log('error', 'Failed to start recording', { error: e.message });
      return false;
    }
  }

  public async stopRecording(): Promise<Blob | null> {
    if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') return null;
    return new Promise((resolve) => {
        if (!this.mediaRecorder) return resolve(null);
        this.mediaRecorder.onstop = () => {
            // Use the same mime type that was selected during startRecording
            const blob = new Blob(this.recordingChunks, { type: this.recordingMimeType });
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

  public playNote(freq: number, preset: InstrumentPreset, panPosition?: number) {
    if (!this.ctx) { this.init(); return; }
    if (this.ctx.state === 'suspended') this.ctx.resume();

    this.stopNote(freq, true);

    const t = this.ctx.currentTime;
    
    // Create FM Voice
    const voice = this.createFMVoice(freq, preset, t);
    
    // Apply Spatial Audio (Panning) if enabled
    if (this.spatialAudioEnabled && panPosition !== undefined && this.ctx) {
        const panner = this.ctx.createStereoPanner();
        // panPosition: 0 = left edge, 1 = right edge
        // Convert to -1 (left) to +1 (right)
        panner.pan.value = (panPosition * 2) - 1;
        voice.outputNode.connect(panner);
        panner.connect(this.masterGain!);
        voice.nodes.push(panner);
    } else {
        // Connect to Master (Dry)
        voice.outputNode.connect(this.masterGain!);
    }

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
    
    // Reduce modulation for low frequencies to prevent distortion
    // Low frequencies need much less modulation to sound clean
    const freqNormalized = Math.min(1, Math.max(0.1, freq / 440)); // Normalize around A4
    const lowFreqDamping = Math.pow(freqNormalized, 0.5); // Square root for smoother curve
    const modulationIndex = hammerHardness * 600 * lowFreqDamping; // Reduced base and damped for low freqs
    
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
    
    // Calculate dynamic gain based on polyphony to prevent clipping
    const activeVoiceCount = this.activeVoices.size + 1;
    const polyphonyScale = Math.min(1.0, 3 / Math.sqrt(activeVoiceCount)); // More aggressive scaling
    
    // Low frequencies need slightly less gain to prevent muddiness
    const freqGainAdjust = freq < 200 ? 0.8 : (freq < 400 ? 0.9 : 1.0);
    const targetGain = this.baseGain * polyphonyScale * freqGainAdjust;
    
    // Initial State
    carrierGain.gain.setValueAtTime(0, t);
    
    // Attack Phase - use scaled gain
    carrierGain.gain.linearRampToValueAtTime(targetGain, t + attackTime);
    
    // Decay & Sustain Phase
    if (preset.sustainMode === SustainMode.PERCUSSIVE) {
        // Percussive sounds ignore sustainLevel and fade out completely
        carrierGain.gain.exponentialRampToValueAtTime(0.001, t + attackTime + decayTime);
    } else {
        // Natural/Infinite sounds drop to sustain level (scaled)
        const sustainVal = Math.max(0.001, sustainLevel * targetGain);
        carrierGain.gain.exponentialRampToValueAtTime(sustainVal, t + attackTime + decayTime);
    }

    // 4. MODULATOR ENVELOPE (Brightness ADSR)
    // Reduced modulation depth for cleaner sound, especially on low frequencies
    const modDepth = modulationIndex * (1 + (300/freq)) * lowFreqDamping; 
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

  public setSoftMode(enabled: boolean) {
    this.softModeEnabled = enabled;
    if (this.softModeFilter) {
      // When soft mode is enabled, cut high frequencies for smoother sound
      this.softModeFilter.frequency.value = enabled ? 4000 : 20000;
      this.softModeFilter.Q.value = enabled ? 0.7 : 0.5;
    }
  }

  public getSoftMode(): boolean {
    return this.softModeEnabled;
  }

  public setSpatialAudio(enabled: boolean) {
    this.spatialAudioEnabled = enabled;
  }

  public getSpatialAudio(): boolean {
    return this.spatialAudioEnabled;
  }

  /**
   * Stop all currently playing notes immediately.
   * Use this when navigating away or when the user wants to stop all sound.
   */
  public stopAllNotes() {
    if (!this.ctx) return;
    
    const t = this.ctx.currentTime;
    
    // Iterate through all active voices and stop them
    for (const [freq, voices] of this.activeVoices.entries()) {
      voices.forEach(voice => {
        const releaseTime = 0.05; // Quick fade out to avoid pops
        
        // Fade out the voice quickly
        voice.outputNode.gain.setValueAtTime(voice.outputNode.gain.value, t);
        voice.outputNode.gain.linearRampToValueAtTime(0, t + releaseTime);
        
        // Stop oscillators
        voice.nodes.forEach(node => {
          if (node instanceof OscillatorNode) {
            try {
              node.stop(t + releaseTime + 0.01);
            } catch (e) {
              // Already stopped
            }
          }
        });
        
        // Schedule cleanup
        setTimeout(() => {
          voice.nodes.forEach(n => {
            try { n.disconnect(); } catch (e) {}
          });
          try { voice.outputNode.disconnect(); } catch (e) {}
        }, (releaseTime * 1000) + 100);
      });
    }
    
    // Clear all active voices
    this.activeVoices.clear();
    
    Logger.log('info', 'All notes stopped');
  }
}

interface VoiceNode {
  nodes: AudioNode[];
  outputNode: GainNode;
  preset: InstrumentPreset;
}

export const AudioEngine = new FMAudioCore();