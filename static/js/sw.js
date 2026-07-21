// sw.js - Service Worker für Hintergrund-Push-Nachrichten
self.addEventListener('push', function(event) {
    let data = { title: 'Neue Erinnerung!', body: 'Es gibt etwas Neues im Tagebuch! ✨', isTest: false };

    if (event.data) {
        try {
            data = event.data.json();
        } catch (e) {
            data.body = event.data.text();
        }
    }

    // Check if any client is focused
    event.waitUntil(
        clients.matchAll({
            type: 'window',
            includeUncontrolled: true
        }).then(function(clientList) {
            // Find a focused client
            let focusedClient = clientList.find(function(client) {
                return client.focused === true;
            });

            // If app is focused and it's NOT a test notification, send message to client for in-app notification
            if (focusedClient && !data.isTest) {
                focusedClient.postMessage({
                    type: 'PUSH_NOTIFICATION',
                    title: data.title,
                    body: data.body,
                    url: data.url || '/'
                });
                return Promise.resolve();
            }

            // Otherwise show native notification (or if it's a test notification)
            const options = {
                body: data.body,
                icon: '/static/icons/icon-192.png',
                badge: '/static/icons/badge-72.png',
                vibrate: [100, 50, 100],
                data: {
                    url: data.url || '/'
                }
            };

            return self.registration.showNotification(data.title, options);
        })
    );
});

// Bei Klick auf die Benachrichtigung die Seite öffnen
self.addEventListener('notificationclick', function(event) {
    event.notification.close();
    event.waitUntil(
        clients.openWindow(event.notification.data.url)
    );
});