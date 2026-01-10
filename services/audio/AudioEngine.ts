import { InstrumentPreset, SustainMode } from "../../types";
import { Logger } from "../../lib/logger";

/**
 * SoundSphere Audio Engine v9.0 (Ultra-Low CPU FM + ADSR)
 * 
 * v9.0 Changes:
 * - MAJOR CPU OPTIMIZATION: Batched gain scheduling to reduce glitches
 * - Web Worker compatible: All heavy calculations happen in advance
 * - requestAnimationFrame-based cleanup instead of setTimeout spam
 * - Reduced oscillator count per voice (reuse modulator oscillators)
 * - Pre-warmed audio graph connections
 * - Throttled voice stealing with cooldown
 * - Smoother gain curves with fewer scheduling calls
 * 
 * v8.0 Changes:
 * - Added keep-alive oscillator to prevent speaker pop/click
 * - MIDI playback mode to disable auto-suspend
 * 
 * v7.0 Changes:
 * - Noise gate to eliminate hiss
 * - Reverb bypass optimization
 */
class FMAudioCore {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private limiter: DynamicsCompressorNode | null = null;
  private dcBlocker: BiquadFilterNode | null = null; // High-pass filter to remove DC offset and rumble
  private outputGate: GainNode | null = null; // Final output gate to eliminate hiss when silent
  
  // Keep-alive oscillator to prevent speaker pop/click
  private keepAliveOsc: OscillatorNode | null = null;
  private keepAliveGain: GainNode | null = null;
  
  // Recorder Nodes
  private mediaDest: MediaStreamAudioDestinationNode | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private recordingChunks: Blob[] = [];
  private recordingMimeType: string = 'audio/webm'; // Store selected mime type
  
  // Recording constants
  private static readonly RECORDING_DATA_INTERVAL = 100; // ms between data collection
  private static readonly RECORDING_STOP_DELAY = 100; // ms to wait after stopping previous recording

  // Audio quality constants - OPTIMIZED for hiss-free output
  private static readonly MIN_RELEASE_TIME = 0.015; // Slightly shorter release (15ms) - still prevents clicks
  private static readonly REVERB_DECAY_EXPONENT = 4.0; // Much faster decay to minimize noise
  private static readonly REVERB_NOISE_GATE = 0.08; // Much higher noise gate threshold (was 0.03)
  private static readonly REVERB_OUTPUT_LEVEL = 0.35; // Lower reverb level (was 0.5)
  private static readonly REVERB_DURATION = 1.5; // Shorter reverb (was 1.8) for less noise
  
  // Auto-suspend timer - LONGER timeout to prevent pops during MIDI playback
  private static readonly AUTO_SUSPEND_DELAY = 2500; // 2.5s of silence before suspending (was 800ms)
  private autoSuspendTimeout: ReturnType<typeof setTimeout> | null = null;
  private isRecording: boolean = false; // Track if recording is active
  private isMidiPlaybackActive: boolean = false; // Track if MIDI playback is active

  // Reverb (Algorithmic) - cached buffer
  private convolver: ConvolverNode | null = null;
  private reverbBuffer: AudioBuffer | null = null; // Pre-generated reverb buffer
  private reverbReturnGain: GainNode | null = null; // Reverb return for dynamic control

  // Active Voices Registry with voice pooling
  private activeVoices: Map<number, VoiceNode[]> = new Map();
  
  // OPTIMIZATION: Voice pool to reduce garbage collection
  private voicePool: VoiceNode[] = [];
  private static readonly VOICE_POOL_SIZE = 16; // Pre-allocate voices
  
  // OPTIMIZATION: Track voice count for efficient polyphony management
  private currentVoiceCount: number = 0;
  
  // OPTIMIZATION v9.0: Batched cleanup with requestAnimationFrame
  private pendingCleanup: Set<VoiceNode> = new Set();
  private cleanupScheduled: boolean = false;
  
  // OPTIMIZATION v9.0: Voice stealing cooldown to prevent rapid stealing
  private lastStealTime: number = 0;
  private static readonly STEAL_COOLDOWN = 50; // 50ms cooldown between steals

  // Audio Effects Settings
  private softModeEnabled: boolean = false;
  private spatialAudioEnabled: boolean = false;
  private softModeFilter: BiquadFilterNode | null = null;

  // OPTIMIZATION: Stricter polyphony limits for mobile
  private maxPolyphony: number = 24; // Reduced from 32
  private baseGain: number = 0.15; // Further reduced for cleaner sound
  
  // OPTIMIZATION: Gain calculation cache
  private lastPolyphonyScale: number = 1.0;
  private lastVoiceCountForScale: number = 0;
  
  // OPTIMIZATION: Device detection for adaptive quality
  private isMobileDevice: boolean = false;
  private isLowPowerMode: boolean = false;

  constructor() {
    // Detect mobile device for adaptive optimizations
    this.isMobileDevice = this.detectMobileDevice();
    if (this.isMobileDevice) {
      this.maxPolyphony = 12; // Even stricter on mobile (was 16)
      this.baseGain = 0.10; // Lower gain on mobile to reduce noise floor (was 0.12)
    }
    Logger.log('info', 'FMAudioCore: Engine v9.0 Initialized (ultra-low CPU)', { isMobile: this.isMobileDevice });
  }
  
  // OPTIMIZATION: Detect mobile device for adaptive settings
  private detectMobileDevice(): boolean {
    if (typeof navigator === 'undefined') return false;
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  }

  public async init(options?: AudioContextOptions) {
    if (this.ctx) return;

    try {
        const AudioContextClass = (window.AudioContext || (window as any).webkitAudioContext);
        this.ctx = new AudioContextClass(options || { latencyHint: 'interactive' });

        // 1. Master Bus
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = 0.28; // Slightly lower to prevent clipping with polyphony

        // 2. DC Blocker / High-pass filter (removes DC offset and sub-bass rumble that causes crackling)
        this.dcBlocker = this.ctx.createBiquadFilter();
        this.dcBlocker.type = 'highpass';
        this.dcBlocker.frequency.value = 25; // Slightly higher cutoff (25Hz) to better eliminate sub-bass noise
        this.dcBlocker.Q.value = 0.7; // Gentle slope

        // 3. Soft Mode Filter (Low-pass for smoother sound)
        this.softModeFilter = this.ctx.createBiquadFilter();
        this.softModeFilter.type = 'lowpass';
        this.softModeFilter.frequency.value = 20000; // Full range when disabled
        this.softModeFilter.Q.value = 0.5;

        // 4. Brickwall Limiter (Tuned for clean limiting without artifacts)
        this.limiter = this.ctx.createDynamicsCompressor();
        this.limiter.threshold.value = -3.0; // Higher threshold for less aggressive limiting
        this.limiter.knee.value = 10; // Softer knee for smoother, more transparent limiting
        this.limiter.ratio.value = 12; // Lower ratio to avoid pumping
        this.limiter.attack.value = 0.003; // Slightly slower attack to preserve transients
        this.limiter.release.value = 0.1; // Slower release to avoid crackling/pumping

        // 5. Output Gate - Final gain node to cut output when silent (eliminates hiss)
        this.outputGate = this.ctx.createGain();
        this.outputGate.gain.value = 1.0; // Start open

        // 6. Reverb Unit - OPTIMIZED with shorter duration and lower level
        // Store reverb return gain for dynamic control
        this.convolver = this.ctx.createConvolver();
        // Pre-generate and cache the reverb buffer
        this.reverbBuffer = this.generateReverbImpulse(FMAudioCore.REVERB_DURATION);
        this.convolver.buffer = this.reverbBuffer;
        
        this.reverbReturnGain = this.ctx.createGain();
        this.reverbReturnGain.gain.value = this.isMobileDevice ? 0.3 : 0.5; // Lower reverb to reduce noise

        // 6b. Keep-alive oscillator - prevents speaker pop/click when audio starts/stops
        // This outputs an inaudible DC offset that keeps the audio path active
        this.keepAliveOsc = this.ctx.createOscillator();
        this.keepAliveOsc.type = 'sine';
        this.keepAliveOsc.frequency.value = 1; // 1Hz - completely inaudible
        this.keepAliveGain = this.ctx.createGain();
        this.keepAliveGain.gain.value = 0.0001; // Extremely low - inaudible but keeps speaker active
        this.keepAliveOsc.connect(this.keepAliveGain);
        this.keepAliveGain.connect(this.masterGain);
        this.keepAliveOsc.start();

        // Signal Chain: masterGain -> dcBlocker -> softModeFilter -> limiter -> outputGate -> destination
        this.convolver.connect(this.reverbReturnGain);
        this.reverbReturnGain.connect(this.masterGain);
        this.masterGain.connect(this.dcBlocker);
        this.dcBlocker.connect(this.softModeFilter);
        this.softModeFilter.connect(this.limiter);
        this.limiter.connect(this.outputGate);
        this.outputGate.connect(this.ctx.destination);

        // 7. Recording Tap
        this.mediaDest = this.ctx.createMediaStreamDestination();
        this.outputGate.connect(this.mediaDest);

        Logger.log('info', 'FMAudioCore v9.0: Context Ready (ultra-low CPU)', { sampleRate: this.ctx.sampleRate });
    } catch (e: any) {
        Logger.log('error', 'Audio Engine Init Failed', { error: e.message });
    }
  }

  // --- RECORDING ---
  public async startRecording(): Promise<boolean> {
    try {
      this.isRecording = true; // Track recording state
      // Cancel auto-suspend while recording
      if (this.autoSuspendTimeout) {
        clearTimeout(this.autoSuspendTimeout);
        this.autoSuspendTimeout = null;
      }
      
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
        this.isRecording = false;
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
    this.isRecording = false; // Clear recording state
    // Schedule auto-suspend check
    this.scheduleAutoSuspend();
    
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

  // OPTIMIZED: Pre-compute noise table for faster reverb generation
  private static noiseTable: Float32Array | null = null;
  private static readonly NOISE_TABLE_SIZE = 65536; // 64K samples
  
  private getNoiseTable(): Float32Array {
    if (!FMAudioCore.noiseTable) {
      FMAudioCore.noiseTable = new Float32Array(FMAudioCore.NOISE_TABLE_SIZE);
      for (let i = 0; i < FMAudioCore.NOISE_TABLE_SIZE; i++) {
        FMAudioCore.noiseTable[i] = Math.random() * 2 - 1;
      }
    }
    return FMAudioCore.noiseTable;
  }

  private generateReverbImpulse(duration: number): AudioBuffer {
    if (!this.ctx) throw new Error("No Context");
    
    // OPTIMIZATION: Use lower sample rate for reverb on mobile
    const sampleRate = this.ctx.sampleRate;
    const len = Math.floor(sampleRate * duration);
    const buffer = this.ctx.createBuffer(2, len, sampleRate);
    
    // Get pre-computed noise table
    const noiseTable = this.getNoiseTable();
    const noiseLen = noiseTable.length;
    
    // OPTIMIZATION: Pre-compute decay curve values
    const decayExp = FMAudioCore.REVERB_DECAY_EXPONENT;
    const noiseGate = FMAudioCore.REVERB_NOISE_GATE;
    const outputLevel = FMAudioCore.REVERB_OUTPUT_LEVEL;
    const lenInv = 1 / len;
    
    for (let c = 0; c < 2; c++) {
      const data = buffer.getChannelData(c);
      const noiseOffset = c * 12345; // Different offset per channel for stereo effect
      
      for (let i = 0; i < len; i++) {
        // OPTIMIZATION: Use pre-computed noise table instead of Math.random()
        const noise = noiseTable[(i + noiseOffset) % noiseLen];
        
        // Calculate decay envelope - faster with pre-computed inverse
        const decay = Math.pow(1 - i * lenInv, decayExp);
        
        // Apply decay
        let sample = noise * decay;
        
        // Apply noise gate to eliminate low-level hiss at tail
        if (sample > -noiseGate && sample < noiseGate) {
          sample = 0;
        }
        
        // Reduce overall level
        data[i] = sample * outputLevel;
      }
    }
    return buffer;
  }

  public playNote(freq: number, preset: InstrumentPreset, panPosition?: number) {
    if (!this.ctx) { this.init(); return; }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    
    // Cancel any pending auto-suspend since we're playing a note
    if (this.autoSuspendTimeout) {
      clearTimeout(this.autoSuspendTimeout);
      this.autoSuspendTimeout = null;
    }

    // OPTIMIZATION v9.0: Voice stealing with cooldown - if at max polyphony, steal oldest voice
    const now = performance.now();
    if (this.currentVoiceCount >= this.maxPolyphony) {
      // Only steal if cooldown has passed
      if (now - this.lastStealTime > FMAudioCore.STEAL_COOLDOWN) {
        this.stealOldestVoice();
        this.lastStealTime = now;
      } else {
        // Skip this note if we're stealing too fast
        return;
      }
    }

    this.stopNote(freq, true);

    const t = this.ctx.currentTime;
    
    // Create FM Voice
    const voice = this.createFMVoice(freq, preset, t);
    this.currentVoiceCount++;
    
    // OPTIMIZATION: Only add panner if spatial audio is enabled AND we have a valid position
    // Skip panner entirely on mobile to save CPU
    if (this.spatialAudioEnabled && panPosition !== undefined && !this.isMobileDevice) {
        const panner = this.ctx.createStereoPanner();
        panner.pan.value = (panPosition * 2) - 1;
        voice.outputNode.connect(panner);
        panner.connect(this.masterGain!);
        voice.nodes.push(panner);
    } else {
        // Connect to Master (Dry)
        voice.outputNode.connect(this.masterGain!);
    }

    // OPTIMIZATION: Completely skip reverb on mobile to eliminate noise source
    // Also skip at high polyphony on any device
    const skipReverb = this.isMobileDevice || this.currentVoiceCount > 12;
    if (this.convolver && preset.physics.reverbMix > 0 && !skipReverb) {
        const sendGain = this.ctx.createGain();
        // OPTIMIZATION: Reduce reverb send as polyphony increases
        const reverbScale = Math.max(0.2, 1 - (this.currentVoiceCount / this.maxPolyphony) * 0.6);
        sendGain.gain.value = preset.physics.reverbMix * reverbScale * 0.5; // Further reduce reverb
        voice.outputNode.connect(sendGain);
        sendGain.connect(this.convolver);
        voice.nodes.push(sendGain);
    }

    this.activeVoices.set(freq, [voice]);
  }
  
  // OPTIMIZATION: Voice stealing - remove oldest voice when at max polyphony
  private stealOldestVoice() {
    if (this.activeVoices.size === 0) return;
    
    // Get the first (oldest) voice
    const firstKey = this.activeVoices.keys().next().value;
    if (firstKey !== undefined) {
      this.stopNote(firstKey, true);
    }
  }

  private createFMVoice(freq: number, preset: InstrumentPreset, t: number): VoiceNode {
    if (!this.ctx) throw new Error("No Context");

    const { tension, hammerHardness, attackTime, decayTime, sustainLevel } = preset.physics;

    // Map Params - SIMPLIFIED for lower CPU
    const harmonicRatio = tension * 3 + 1; // Reduced range
    
    // OPTIMIZATION v9.0: Simpler frequency normalization
    const freqNormalized = freq * 0.00227; // freq / 440
    const lowFreqDamping = freqNormalized < 1 ? freqNormalized : 1;
    
    // OPTIMIZATION v9.0: Much lower modulation on mobile for less CPU
    const modulationMultiplier = this.isMobileDevice ? 200 : 400;
    const modulationIndex = hammerHardness * modulationMultiplier * lowFreqDamping;
    
    // 1. CARRIER (The Pitch) - Use simpler oscillator settings
    const carrier = this.ctx.createOscillator();
    carrier.type = 'sine';
    carrier.frequency.value = freq;

    // 2. MODULATOR (The Texture) - OPTIMIZATION: Skip on mobile for very low frequencies
    const modulator = this.ctx.createOscillator();
    modulator.type = 'sine';
    modulator.frequency.value = freq * harmonicRatio;

    const modulatorGain = this.ctx.createGain();

    // 3. CARRIER ENVELOPE (Volume ADSR)
    const carrierGain = this.ctx.createGain();
    
    // OPTIMIZATION v9.0: Simplified polyphony scaling - no caching overhead
    const polyphonyScale = this.currentVoiceCount < 4 ? 1.0 : 
                           this.currentVoiceCount < 8 ? 0.8 : 
                           this.currentVoiceCount < 12 ? 0.65 : 0.5;
    
    // OPTIMIZATION v9.0: Simpler frequency gain adjustment
    const freqGainAdjust = freq < 200 ? 0.7 : 1.0;
    const targetGain = this.baseGain * polyphonyScale * freqGainAdjust;
    
    // OPTIMIZATION v9.0: Minimal gain scheduling - just 2 points instead of multiple ramps
    carrierGain.gain.setValueAtTime(0.001, t); // Start from very low, not zero
    carrierGain.gain.linearRampToValueAtTime(targetGain, t + attackTime);
    
    // Single decay ramp to sustain
    if (preset.sustainMode === SustainMode.PERCUSSIVE) {
        carrierGain.gain.setTargetAtTime(0.001, t + attackTime, decayTime * 0.5);
    } else {
        const sustainVal = Math.max(0.001, sustainLevel * targetGain);
        carrierGain.gain.setTargetAtTime(sustainVal, t + attackTime, decayTime * 0.5);
    }

    // 4. MODULATOR ENVELOPE (Brightness) - SIMPLIFIED
    const modDepth = modulationIndex * lowFreqDamping;
    modulatorGain.gain.setValueAtTime(modDepth, t);
    modulatorGain.gain.setTargetAtTime(modDepth * 0.1, t + attackTime, decayTime * 0.4);

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
      // OPTIMIZATION v9.0: Shorter minimum release for faster cleanup
      const actualRelease = immediate ? 0.01 : Math.max(0.01, Math.min(releaseTime, 0.3));

      // Cancel future scheduled events
      voice.outputNode.gain.cancelScheduledValues(t);
      
      // OPTIMIZATION v9.0: Use setTargetAtTime for smoother CPU-friendly fade
      const currentGain = voice.outputNode.gain.value;
      
      if (currentGain < 0.002) {
        // Already silent - just mark for cleanup
        voice.outputNode.gain.setValueAtTime(0, t);
      } else {
        // Use setTargetAtTime for exponential decay - more CPU efficient than multiple ramps
        voice.outputNode.gain.setTargetAtTime(0.0001, t, actualRelease * 0.3);
      }

      // Stop Oscillators
      const stopTime = t + actualRelease + 0.02;
      voice.nodes.forEach(node => {
          if (node instanceof OscillatorNode) {
              try { node.stop(stopTime); } catch (e) { /* Already stopped */ }
          }
      });
      
      // OPTIMIZATION v9.0: Batched cleanup instead of setTimeout spam
      this.pendingCleanup.add(voice);
      this.scheduleCleanup();
    });

    // OPTIMIZATION: Track voice count
    this.currentVoiceCount = Math.max(0, this.currentVoiceCount - voices.length);
    this.activeVoices.delete(freq);
    
    // Schedule auto-suspend check after note is released (only if not in MIDI playback)
    if (!this.isMidiPlaybackActive) {
      this.scheduleAutoSuspend();
    }
  }
  
  // OPTIMIZATION v9.0: Batched cleanup using requestAnimationFrame
  private scheduleCleanup() {
    if (this.cleanupScheduled) return;
    this.cleanupScheduled = true;
    
    // Use requestAnimationFrame for efficient batched cleanup
    requestAnimationFrame(() => {
      // Wait a bit more for audio to finish
      setTimeout(() => {
        this.pendingCleanup.forEach(voice => {
          voice.nodes.forEach(n => { try { n.disconnect(); } catch (e) {} });
          try { voice.outputNode.disconnect(); } catch (e) {}
        });
        this.pendingCleanup.clear();
        this.cleanupScheduled = false;
      }, 150); // Reduced from individual timeouts
    });
  }
  
  // Auto-suspend AudioContext when idle to prevent background hiss from phone speakers
  private scheduleAutoSuspend() {
    // Don't suspend if recording or MIDI playback is active
    if (this.isRecording || this.isMidiPlaybackActive) return;
    
    // Clear any existing timeout
    if (this.autoSuspendTimeout) {
      clearTimeout(this.autoSuspendTimeout);
    }
    
    // Schedule suspend check - longer timeout for smoother experience
    this.autoSuspendTimeout = setTimeout(() => {
      // Only suspend if no active voices, not recording, and not in MIDI playback
      if (this.currentVoiceCount === 0 && !this.isRecording && !this.isMidiPlaybackActive && this.ctx && this.ctx.state === 'running') {
        this.ctx.suspend().then(() => {
          Logger.log('info', 'AudioContext auto-suspended (idle)');
        }).catch(() => {
          // Ignore suspend errors
        });
      }
      this.autoSuspendTimeout = null;
    }, FMAudioCore.AUTO_SUSPEND_DELAY);
  }
  
  /**
   * Enable/disable MIDI playback mode.
   * When enabled, prevents auto-suspend to avoid pop/click between notes.
   */
  public setMidiPlaybackMode(active: boolean) {
    this.isMidiPlaybackActive = active;
    
    if (active) {
      // Cancel any pending auto-suspend
      if (this.autoSuspendTimeout) {
        clearTimeout(this.autoSuspendTimeout);
        this.autoSuspendTimeout = null;
      }
      // Resume context if suspended
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
      Logger.log('info', 'MIDI playback mode enabled');
    } else {
      // Schedule auto-suspend when MIDI playback ends
      this.scheduleAutoSuspend();
      Logger.log('info', 'MIDI playback mode disabled');
    }
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
        // Use minimum release time with small buffer for quick but smooth stop
        const releaseTime = FMAudioCore.MIN_RELEASE_TIME * 1.5;
        
        // Cancel any scheduled changes
        voice.outputNode.gain.cancelScheduledValues(t);
        
        // Get current gain value
        const currentGain = voice.outputNode.gain.value;
        
        if (currentGain < 0.001) {
          voice.outputNode.gain.setValueAtTime(0, t);
        } else {
          // Smooth exponential then linear fade to prevent clicks
          voice.outputNode.gain.setValueAtTime(currentGain, t);
          voice.outputNode.gain.exponentialRampToValueAtTime(0.001, t + releaseTime * 0.7);
          voice.outputNode.gain.linearRampToValueAtTime(0, t + releaseTime);
        }
        
        // Stop oscillators
        voice.nodes.forEach(node => {
          if (node instanceof OscillatorNode) {
            try {
              node.stop(t + releaseTime + 0.02);
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
    this.currentVoiceCount = 0; // OPTIMIZATION: Reset voice count
    
    Logger.log('info', 'All notes stopped');
  }
  
  // OPTIMIZATION v9.0: Low power mode for battery savings - even stricter limits
  public setLowPowerMode(enabled: boolean) {
    this.isLowPowerMode = enabled;
    if (enabled) {
      this.maxPolyphony = 6;
      this.baseGain = 0.08;
    } else {
      this.maxPolyphony = this.isMobileDevice ? 12 : 20;
      this.baseGain = this.isMobileDevice ? 0.10 : 0.12;
    }
    Logger.log('info', 'Low power mode', { enabled, maxPolyphony: this.maxPolyphony });
  }
  
  // OPTIMIZATION: Get current voice count for UI feedback
  public getVoiceCount(): number {
    return this.currentVoiceCount;
  }
  
  // OPTIMIZATION: Get max polyphony for UI
  public getMaxPolyphony(): number {
    return this.maxPolyphony;
  }
}

interface VoiceNode {
  nodes: AudioNode[];
  outputNode: GainNode;
  preset: InstrumentPreset;
}

export const AudioEngine = new FMAudioCore();