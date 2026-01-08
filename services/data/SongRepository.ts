
import { SongAnalysis, LyricLine } from "../../types";

// Simulate a database of songs
const MOCK_DB: Record<string, SongAnalysis> = {
  "gonul dagi": {
    title: "Gönül Dağı",
    artist: "Neşet Ertaş",
    bpm: 60,
    youtubeId: "Kz39lq55Cq4", // Neşet Ertaş - Gönül Dağı
    memorizationTips: [
      "Nakarat kısmındaki 'Vay vay' vurgularına dikkat et.",
      "Hüzünlü bir tonda, ağır tempoda oku.",
      "Her kıta sonundaki nefes aralıklarını ezberle."
    ],
    lyrics: [
      { text: "Gönül dağı yağmur yağmur boran olunca", isChorus: false },
      { text: "Akar can özümde sel gizli gizli", isChorus: false },
      { text: "Bir tenhada can cananı bulunca", isChorus: false },
      { text: "Sinemi yaralar yar oy yar oy", isChorus: true },
      { text: "Dil gizli gizli, dil gizli gizli", isChorus: true },
      { text: "Dost elinden gel olmazsa varılmaz", isChorus: false },
      { text: "Rızasız bahçenin gülü derilmez", isChorus: false },
      { text: "Kalpten kalbe bir yol vardır görülmez", isChorus: true },
      { text: "Gönülden gönüle gider yol gizli gizli", isChorus: true }
    ]
  },
  "uzun ince": {
    title: "Uzun İnce Bir Yoldayım",
    artist: "Aşık Veysel",
    bpm: 50,
    youtubeId: "J8aP4F6YdGE", // Tarkan Cover (Clear vocals) or Original
    memorizationTips: ["Metaforları hisset.", "Yolculuk temasını düşünerek oku."],
    lyrics: [
      { text: "Uzun ince bir yoldayım", isChorus: false },
      { text: "Gidiyorum gündüz gece", isChorus: false },
      { text: "Bilmiyorum ne haldeyim", isChorus: false },
      { text: "Gidiyorum gündüz gece", isChorus: true },
      { text: "Gündüz gece, gündüz gece", isChorus: true },
      { text: "Dünyaya geldiğim anda", isChorus: false },
      { text: "Yürüdüm aynı zamanda", isChorus: false },
      { text: "İki kapılı bir handa", isChorus: false },
      { text: "Gidiyorum gündüz gece", isChorus: true }
    ]
  },
  "sari gelin": {
    title: "Sarı Gelin",
    artist: "Anonim",
    bpm: 45,
    youtubeId: "mX4gEqi5QCE", // Yavuz Bingöl version
    memorizationTips: ["Erzurum şivesiyle oku.", "Uzun havalarda nefesini kontrol et."],
    lyrics: [
      { text: "Erzurum çarşı pazar", isChorus: false },
      { text: "Leylim aman, aman", isChorus: true },
      { text: "Sarı gelin", isChorus: true },
      { text: "İçinde bir kız gezer", isChorus: false },
      { text: "Ay nenen ölsün, sarı gelin", isChorus: true },
      { text: "Elinde divit kalem", isChorus: false },
      { text: "Katlime ferman yazar", isChorus: false }
    ]
  },
  "elfida": {
    title: "Elfida",
    artist: "Haluk Levent",
    bpm: 75,
    youtubeId: "B1i8iM0j1I0", // Haluk Levent Official
    memorizationTips: ["Rock tonlamasıyla vurgu yap.", "Nakaratı güçlü gir."],
    lyrics: [
      { text: "Yüzün geçmişten kalan", isChorus: false },
      { text: "Aşka tarif yazdıran", isChorus: false },
      { text: "Bir alaturka hüzün", isChorus: false },
      { text: "Yüzün kıyıma vuran", isChorus: false },
      { text: "Anne karnı huzur", isChorus: false },
      { text: "Çocukluğumun sesi", isChorus: false },
      { text: "Senden bana şimdi", isChorus: false },
      { text: "Zamanı sızdıran", isChorus: false },
      { text: "Elfida, bir belalı başımsın", isChorus: true },
      { text: "Elfida, beni fark etme sakın", isChorus: true },
      { text: "Omzumda iz bırakma", isChorus: true },
      { text: "Yüküm dünyaya yakın", isChorus: true }
    ]
  }
};

export const SongRepository = {
  /**
   * Simulates an asynchronous database lookup.
   */
  searchSong: async (query: string): Promise<SongAnalysis | null> => {
    // Simulate network latency (300ms) for realistic UI testing
    await new Promise(resolve => setTimeout(resolve, 300));
    
    const key = query.toLowerCase().trim();
    
    // Exact match check
    if (MOCK_DB[key]) {
      return MOCK_DB[key];
    }

    // Fuzzy Search (Contains)
    const foundKey = Object.keys(MOCK_DB).find(k => k.includes(key) || MOCK_DB[k].title.toLowerCase().includes(key));
    if (foundKey) {
        return MOCK_DB[foundKey];
    }
    
    return null;
  },

  /**
   * Creates a new song entry from raw text
   */
  createFromText: (title: string, artist: string, rawText: string, youtubeId?: string): SongAnalysis => {
      const lines = rawText.split('\n').filter(l => l.trim().length > 0);
      const lyrics: LyricLine[] = lines.map(line => ({
          text: line.trim(),
          isChorus: false // Default, user can't tag chorus easily in simple paste yet
      }));

      return {
          title,
          artist,
          bpm: 80, // Default BPM
          youtubeId: youtubeId || undefined,
          memorizationTips: ["Kendi eklediğin şarkı."],
          lyrics
      };
  }
};
