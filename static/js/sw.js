// sw.js - Service Worker für Hintergrund-Push-Nachrichten
self.addEventListener('push', function(event) {
    let data = { title: 'Neue Erinnerung!', body: 'Es gibt etwas Neues im Tagebuch! ✨' };

    if (event.data) {
        try {
            data = event.data.json();
        } catch (e) {
            data.body = event.data.text();
        }
    }

    const options = {
        body: data.body,
        icon: '/static/icons/icon-192.png', // Pfad zu einem Icon deiner Wahl
        badge: '/static/icons/badge-72.png',
        vibrate: [100, 50, 100],
        data: {
            url: data.url || '/'
        }
    };

    event.waitUntil(
        self.registration.showNotification(data.title, options)
    );
});

// Bei Klick auf die Benachrichtigung die Seite öffnen
self.addEventListener('notificationclick', function(event) {
    event.notification.close();
    event.waitUntil(
        clients.openWindow(event.notification.data.url)
    );
});