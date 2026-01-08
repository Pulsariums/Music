import { InstrumentPreset, SustainMode } from "../../types";

const makePreset = (
  id: string, 
  name: string, 
  category: string,
  mode: SustainMode, 
  ratio: number, // Tension (0.125 = 1:1, 0.25=1:2 etc)
  hardness: number, // Modulation Index
  attack: number, 
  decay: number, 
  sustain: number, 
  release: number,
  reverb: number
): InstrumentPreset => ({
  id, name, category, sustainMode: mode,
  physics: {
    tension: ratio,
    hammerHardness: hardness,
    attackTime: attack,
    decayTime: decay,
    sustainLevel: sustain,
    releaseTime: release,
    reverbMix: reverb
  }
});

export const PRESETS: Record<string, InstrumentPreset> = {
  // --- 1. STANDARD ACOUSTIC PIANOS (The Core Collection) ---
  // Grand Pianos
  CONCERT_GRAND: makePreset('concert_grand', 'Concert Grand (Steinway)', '1. Standard Pianos', SustainMode.NATURAL, 0.125, 0.6, 0.01, 2.5, 0.4, 0.8, 0.3),
  STUDIO_GRAND: makePreset('studio_grand', 'Studio Grand (Yamaha)', '1. Standard Pianos', SustainMode.NATURAL, 0.125, 0.5, 0.01, 1.8, 0.5, 0.5, 0.2),
  MELLOW_GRAND: makePreset('mellow_grand', 'Mellow Grand', '1. Standard Pianos', SustainMode.NATURAL, 0.125, 0.2, 0.05, 2.0, 0.6, 0.6, 0.2),
  BRIGHT_GRAND: makePreset('bright_grand', 'Bright Pop Grand', '1. Standard Pianos', SustainMode.NATURAL, 0.125, 0.85, 0.005, 1.5, 0.5, 0.4, 0.2),
  JAZZ_GRAND: makePreset('jazz_grand', 'Jazz Trio Piano', '1. Standard Pianos', SustainMode.NATURAL, 0.125, 0.45, 0.01, 1.2, 0.5, 0.25, 0.1),
  
  // Upright Pianos
  UPRIGHT_VINTAGE: makePreset('upright_vintage', 'Vintage Upright', '1. Standard Pianos', SustainMode.NATURAL, 0.124, 0.4, 0.02, 1.0, 0.4, 0.3, 0.1),
  UPRIGHT_BAR: makePreset('upright_bar', 'Saloon Piano', '1. Standard Pianos', SustainMode.NATURAL, 0.126, 0.7, 0.01, 0.8, 0.6, 0.2, 0.1),
  HONKY_TONK: makePreset('honky_tonk', 'Honky Tonk', '1. Standard Pianos', SustainMode.NATURAL, 0.128, 0.9, 0.01, 0.5, 0.7, 0.2, 0.05),
  BROKEN_PIANO: makePreset('broken_piano', 'Old School Hall', '1. Standard Pianos', SustainMode.NATURAL, 0.123, 0.3, 0.05, 0.6, 0.3, 0.2, 0.4),
  
  // Character Pianos
  INTIMATE_FELT: makePreset('intimate_felt', 'Felt Piano (Cinematic)', '1. Standard Pianos', SustainMode.NATURAL, 0.125, 0.15, 0.1, 1.5, 0.3, 1.0, 0.1),
  DREAM_PIANO: makePreset('dream_piano', 'Dreamscape Piano', '1. Standard Pianos', SustainMode.NATURAL, 0.125, 0.3, 0.05, 3.0, 0.7, 2.0, 0.6),
  COMPRESSED_POP: makePreset('compressed_pop', 'Radio Ready', '1. Standard Pianos', SustainMode.NATURAL, 0.125, 0.9, 0.001, 1.0, 0.8, 0.1, 0.1),
  LOFI_KEYS: makePreset('lofi_keys', 'Lo-Fi Chill', '1. Standard Pianos', SustainMode.NATURAL, 0.122, 0.2, 0.1, 0.5, 0.4, 0.5, 0.2),

  // --- 2. ELECTRIC KEYS ---
  RHODES_MK1: makePreset('rhodes_mk1', 'Rhodes MK1', '2. Electric Keys', SustainMode.NATURAL, 0.125, 0.3, 0.03, 2.5, 0.7, 0.5, 0.3),
  RHODES_BARK: makePreset('rhodes_bark', 'Rhodes Bark', '2. Electric Keys', SustainMode.NATURAL, 0.125, 0.8, 0.01, 0.8, 0.6, 0.3, 0.2),
  WURLI_TREM: makePreset('wurli_trem', 'Wurli Tremolo', '2. Electric Keys', SustainMode.NATURAL, 0.25, 0.5, 0.02, 0.6, 0.5, 0.2, 0.2),
  DX7_BALLAD: makePreset('dx7_ballad', 'DX7 Ballad', '2. Electric Keys', SustainMode.NATURAL, 0.5, 0.4, 0.05, 3.0, 0.6, 0.8, 0.5),
  DX7_CRYSTAL: makePreset('dx7_crystal', 'DX7 Crystal', '2. Electric Keys', SustainMode.NATURAL, 3.5, 0.6, 0.01, 2.0, 0.2, 1.0, 0.4),
  CLAV_FUNK: makePreset('clav_funk', 'Funky Clav', '2. Electric Keys', SustainMode.PERCUSSIVE, 0.3, 1.0, 0.001, 0.3, 0.0, 0.1, 0.05),

  // --- 3. ORCHESTRAL & STRINGS ---
  VIOLIN_SOLO: makePreset('violin_solo', 'Violin Solo', '3. Orchestral', SustainMode.INFINITE, 0.125, 0.6, 0.3, 0.5, 0.9, 0.4, 0.4),
  STRING_ENSEMBLE: makePreset('string_ens', 'String Ensemble', '3. Orchestral', SustainMode.INFINITE, 0.126, 0.4, 0.6, 1.0, 0.8, 1.0, 0.6),
  HARP: makePreset('harp', 'Harp', '3. Orchestral', SustainMode.PERCUSSIVE, 0.125, 0.4, 0.02, 1.5, 0.0, 0.8, 0.5),
  FLUTE: makePreset('flute', 'Flute', '3. Orchestral', SustainMode.INFINITE, 0.125, 0.15, 0.1, 0.3, 0.9, 0.2, 0.3),
  BRASS_SECTION: makePreset('brass', 'Brass Section', '3. Orchestral', SustainMode.NATURAL, 0.125, 1.2, 0.05, 0.5, 0.8, 0.3, 0.4),

  // --- 4. SYNTH & PADS ---
  WARM_PAD: makePreset('warm_pad', 'Warm Pad', '4. Synth Pads', SustainMode.INFINITE, 0.126, 0.3, 0.5, 1.0, 0.8, 1.5, 0.5),
  SPACE_VOX: makePreset('space_vox', 'Space Vox', '4. Synth Pads', SustainMode.INFINITE, 0.251, 0.4, 1.5, 2.0, 0.7, 2.5, 0.8),
  SAW_LEAD: makePreset('saw_lead', 'Saw Lead', '4. Synth Leads', SustainMode.INFINITE, 0.125, 1.5, 0.005, 0.2, 0.8, 0.2, 0.2),
  
  // --- 5. BASS ---
  ACOUSTIC_BASS: makePreset('acoustic_bass', 'Upright Bass', '5. Bass', SustainMode.PERCUSSIVE, 0.125, 0.4, 0.05, 0.8, 0.0, 0.3, 0.1),
  SUB_BASS: makePreset('sub_bass', 'Sub Bass', '5. Bass', SustainMode.NATURAL, 0.125, 0.05, 0.05, 0.5, 1.0, 0.2, 0.0),

  // --- 6. MALLETS ---
  VIBRAPHONE: makePreset('vibraphone', 'Vibraphone', '6. Mallets', SustainMode.PERCUSSIVE, 0.85, 0.5, 0.01, 3.0, 0.0, 0.8, 0.4),
  MARIMBA: makePreset('marimba', 'Marimba', '6. Mallets', SustainMode.PERCUSSIVE, 0.6, 0.8, 0.005, 0.4, 0.0, 0.15, 0.1),
  XYLOPHONE: makePreset('xylophone', 'Xylophone', '6. Mallets', SustainMode.PERCUSSIVE, 0.9, 1.0, 0.001, 0.2, 0.0, 0.1, 0.05),
  KALIMBA: makePreset('kalimba', 'Kalimba', '6. Mallets', SustainMode.PERCUSSIVE, 0.13, 0.4, 0.02, 0.5, 0.0, 0.2, 0.1),
  MUSIC_BOX: makePreset('music_box', 'Music Box', '6. Mallets', SustainMode.PERCUSSIVE, 2.0, 0.5, 0.005, 1.5, 0.0, 0.5, 0.0),
};