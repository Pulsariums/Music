import { AppConfig, AppID } from './types';

export const REGISTERED_APPS: AppConfig[] = [
  {
    id: AppID.LYRICAL_MASTER,
    name: 'LyricalMaster',
    description: 'Yapay zeka destekli şarkı ezberleme ve karaoke asistanı.',
    icon: 'mic',
    color: 'from-purple-500 to-indigo-600'
  },
  {
    id: AppID.VOCAL_LAB,
    name: 'Vocal Lab',
    description: 'Ses ısınma ve tonlama egzersizleri (Beta).',
    icon: 'wave',
    color: 'from-emerald-500 to-teal-600'
  }
];

export const MOCK_LYRICS = `
(Verse 1)
Yola çıktım sabahın köründe
Güneş doğmadan düştüm yine
İçimde bir ses var, susmuyor hiç
Söyler şarkını, bitmez bu güç

(Chorus)
Haydi söyle, durma bağır
Sesin yankılansın dağlara
Ezberle hayatı, satır satır
Bırak aksın zaman, akışına
`;
