export const SOURCES = [
  {
    id: 'diken',
    label: 'Diken',
    color: '#e07b39',
    url: 'https://www.diken.com.tr/feed/',
    via: 'direct',
  },
  {
    id: 'medyascope',
    label: 'Medyascope',
    color: '#7d2e5c',
    url: 'https://medyascope.tv/feed',
    via: 'direct',
  },
  {
    id: 'cumhuriyet',
    label: 'Cumhuriyet',
    color: '#c0392b',
    url: 'https://www.cumhuriyet.com.tr/rss',
    via: 'direct',
  },
  {
    id: 'sozcu',
    label: 'Sözcü',
    color: '#1a5276',
    url: 'https://www.sozcu.com.tr/rss/anasayfa.xml',
    via: 'direct',
  },
  {
    id: 'ntv',
    label: 'NTV',
    color: '#117a65',
    url: 'https://www.ntv.com.tr/dunya.rss',
    via: 'direct',
  },
  {
    id: 'bianet',
    label: 'Bianet',
    color: '#b07d12',
    url: 'https://bianet.org/bianet.rss',
    via: 'direct',
  },
  {
    id: 'bbc',
    label: 'BBC Türkçe',
    color: '#0d6e9e',
    url: 'https://feeds.bbci.co.uk/turkce/rss.xml',
    via: 'direct',
  },
  {
    id: 'dw',
    label: 'DW Türkçe',
    color: '#5c6b7a',
    url: 'https://rss.dw.com/xml/rss-tur-all',
    via: 'direct',
  },
  {
    id: 'sputnik',
    label: 'Sputnik TR',
    color: '#7a2626',
    url: 'https://sputniknews.com.tr/export/rss2/archive/index.xml',
    via: 'direct',
  },
  {
    id: 'hurriyet',
    label: 'Hürriyet',
    color: '#4a2d8b',
    url: 'https://www.hurriyet.com.tr/rss/anasayfa',
    via: 'direct',
  },
];

export const REFRESH_INTERVAL_MS = 20 * 60 * 1000; // 20 minutes
export const MAX_ITEMS_PER_SOURCE = 30;
