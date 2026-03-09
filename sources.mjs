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
    color: '#2471a3',
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
];

export const REFRESH_INTERVAL_MS = 20 * 60 * 1000; // 20 minutes
export const MAX_ITEMS_PER_SOURCE = 30;
