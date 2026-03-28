// Firebase Messaging Service Worker
// Verwerkt pushnotificaties op de achtergrond

importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyC6V0NOSgAtX_bDWezca-_F7gb3RANSens",
  authDomain: "goyer-golf-mp-ladder.firebaseapp.com",
  projectId: "goyer-golf-mp-ladder",
  storageBucket: "goyer-golf-mp-ladder.firebasestorage.app",
  messagingSenderId: "124116031878",
  appId: "1:124116031878:web:10d9b113b1afcd1dc73407"
});

const messaging = firebase.messaging();

// Achtergrond notificaties (app is gesloten of op achtergrond)
messaging.onBackgroundMessage((payload) => {
  const { title, body, icon } = payload.notification || {};
  self.registration.showNotification(title || '⛳ Goyer Golf MP Ladder', {
    body: body || '',
    icon: icon || '/icon-192.png',
    badge: '/icon-192.png',
    data: payload.data || {},
    actions: [{ action: 'open', title: 'Bekijk ladder' }]
  });
});

// Klik op notificatie opent de app
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      if (clientList.length > 0) {
        return clientList[0].focus();
      }
      return clients.openWindow('/');
    })
  );
});
