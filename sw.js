const CACHE_NAME = 'toeic-app-v2';
const URLS_TO_CACHE = [
    './',
    './index.html',
    'https://cdn.tailwindcss.com',
    'https://cdn.jsdelivr.net/npm/sortablejs@1.15.6/Sortable.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(URLS_TO_CACHE))
    );
});

self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request).then(response => {
            return response || fetch(event.request);
        })
    );
});
