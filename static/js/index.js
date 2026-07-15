// Anniversary Configuration: April 27, 2026 (Month is 0-indexed, so 3 is April)
const anniversaryDate = new Date(2026, 3, 27, 16, 0, 0); 

function formatDateForDisplay(dateStr) {
    if (!dateStr) return '';
    // Convert YYYY-MM-DD (backend format) to DD.MM.YYYY (user display format)
    if (dateStr.includes('-')) {
        const parts = dateStr.split('-');
        if (parts.length === 3) {
            return `${parts[2]}.${parts[1]}.${parts[0]}`;
        }
    }
    return dateStr;
}

function updateCounter() {
    const heroContainer = document.getElementById('hero-counter');
    if (!heroContainer) return;

    const now = new Date();
    if (now < anniversaryDate) return;

    let tempDate = new Date(anniversaryDate);
    let years = 0;
    let months = 0;

    while (true) {
        let nextYear = new Date(tempDate);
        nextYear.setFullYear(nextYear.getFullYear() + 1);
        if (nextYear <= now) { years++; tempDate = nextYear; } else { break; }
    }
    while (true) {
        let nextMonth = new Date(tempDate);
        nextMonth.setMonth(nextMonth.getMonth() + 1);
        if (nextMonth <= now) { months++; tempDate = nextMonth; } else { break; }
    }

    const oneDay = 24 * 60 * 60 * 1000;
    let totalDays = Math.floor((now - tempDate) / oneDay);
    
    let weeks = Math.floor(totalDays / 7);
    let days = totalDays % 7;

    let remMs = (now - tempDate) % oneDay;
    let hours = Math.floor(remMs / (60 * 60 * 1000));
    let minutes = Math.floor((remMs % (60 * 60 * 1000)) / (60 * 1000));

    const isMobile = window.innerWidth <= 450;

    let html = `
        <div class="counter-segment"><span class="counter-value">${years}</span><span class="counter-label">Jahre</span></div>
        <div class="counter-segment"><span class="counter-value">${months}</span><span class="counter-label">Monate</span></div>
    `;

    if (!isMobile) {
        html += `
            <div class="counter-segment"><span class="counter-value">${weeks}</span><span class="counter-label">Wochen</span></div>
            <div class="counter-segment"><span class="counter-value">${days}</span><span class="counter-label">Tage</span></div>
            <div class="counter-segment"><span class="counter-value">${hours}</span><span class="counter-label">Stunden</span></div>
            <div class="counter-segment"><span class="counter-value">${minutes}</span><span class="counter-label">Minuten</span></div>
        `;
    } else {
        html += `<div class="counter-segment"><span class="counter-value">${totalDays}</span><span class="counter-label">Tage</span></div>`;
    }

    heroContainer.innerHTML = html;
}

function setupModal() {
    const modal = document.getElementById('entry-modal');
    const openBtn = document.getElementById('open-modal-btn');
    const closeBtn = document.getElementById('close-modal-btn');

    if (!modal || !openBtn || !closeBtn) return;

    openBtn.addEventListener('click', () => modal.classList.add('is-active'));
    closeBtn.addEventListener('click', () => modal.classList.remove('is-active'));

    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.classList.remove('is-active');
    });
}

let currentSelectedEntry = null;
let globalEntriesData = [];

function getEntryIdFromUrl() {
    const value = new URLSearchParams(window.location.search).get('id');
    const parsed = parseInt(value, 10);
    return Number.isNaN(parsed) ? null : parsed;
}

function clearEntryIdFromUrl() {
    const url = new URL(window.location.href);
    if (!url.searchParams.has('id')) return;
    url.searchParams.delete('id');
    history.replaceState({}, '', url);
}

function getReminderTargetName() {
    return window.currentUser === 'nathan' ? 'Luisa' : 'Nathan';
}

function updateReminderButtonLabel() {
    const button = document.getElementById('detail-remind-btn');
    const targetName = getReminderTargetName();
    if (button) {
        button.innerHTML = `Mit ${targetName} erinnern <i class="fa-solid fa-bell"></i>`;
    }
}

function closeDetailModal() {
    document.getElementById('detail-modal')?.classList.remove('is-active');
    clearEntryIdFromUrl();
}

function closeReminderModal() {
    document.getElementById('remind-modal')?.classList.remove('is-active');
}

function openReminderModal(entry) {
    if (!entry) return;
    currentSelectedEntry = entry;
    document.getElementById('remind-message').value = '';
    document.getElementById('remind-modal-title').textContent = `Mit ${getReminderTargetName()} erinnern`;
    document.getElementById('detail-modal')?.classList.remove('is-active');
    document.getElementById('remind-modal').classList.add('is-active');
}

function setupLazyLoading() {
    const images = document.querySelectorAll('.card-image-wrapper img[data-src]');

    const imageObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (!entry.isIntersecting) return;

            const img = entry.target;
            if (!img.hasAttribute('data-src')) return;

            img.src = img.getAttribute('data-src');
            img.removeAttribute('data-src');

            if (img.complete && img.src) {
                img.style.opacity = '1';
                img.parentElement.style.filter = 'none';
            }

            observer.unobserve(img);
        });
    }, {
        rootMargin: "0px 0px 200px 0px"
    });

    images.forEach(img => imageObserver.observe(img));
}

function loadEntries() {
    const container = document.getElementById('entries-container');
    if (!container) return;

    const isGallery = window.location.pathname === '/gallery';
    const endpoint = isGallery ? '/api/entries' : '/api/entries?limit=3';

    fetch(endpoint)
        .then(res => res.json())
        .then(data => {
            container.innerHTML = ''; 
            globalEntriesData = data.entries;

            if (data.entries.length === 0) {
                container.innerHTML = `<p style="text-align:center; color:var(--text-muted); width:100%; padding: var(--space-4);">Hier ist es noch ganz leer... Lass uns schnell die erste gemeinsame Erinnerung reinschreiben! ✨</p>`;
                return;
            }

            data.entries.forEach(entry => {
                let imgHTML = '';
                
                if (entry.image_url) {
                    // Apply dynamic Low Quality Image Placeholder (LQIP)
                    const placeholderStyle = entry.img_placeholder_str 
                        ? `style="background-image: url('${entry.img_placeholder_str}'); background-size: cover; filter: blur(10px); transform: scale(1.05); transition: filter 0.6s ease;"` 
                        : '';
                    
                    if (isGallery) {
                        imgHTML = `
                        <div class="card-image-wrapper" ${placeholderStyle}>
                            <img data-src="${entry.image_url}" alt="${entry.title}" style="opacity: 0; transition: opacity 0.5s ease; width:100%; height:100%; object-fit:cover;" onload="this.style.opacity='1'; this.parentElement.style.filter='none';" onerror="this.style.opacity='1'; this.parentElement.style.filter='none'; this.classList.add('image-error');">
                        </div>`;
                    } else {
                        imgHTML = `
                        <div class="card-image-wrapper" ${placeholderStyle}>
                            <img src="${entry.image_url}" alt="${entry.title}" style="opacity: 0; transition: opacity 0.5s ease; width:100%; height:100%; object-fit:cover;" onload="this.style.opacity='1'; this.parentElement.style.filter='none';" onerror="this.style.opacity='1'; this.parentElement.style.filter='none'; this.classList.add('image-error');">
                        </div>`;
                    }
                }

                const cardHTML = `
                    <div class="memory-card" data-id="${entry.id}">
                        ${imgHTML}
                        <div class="card-content">
                            <div class="card-header-flex">
                                <h4 class="card-title">${entry.title}</h4>
                                <span class="card-date">${formatDateForDisplay(entry.date)}</span>
                            </div>
                        </div>
                    </div>
                `;
                container.insertAdjacentHTML('beforeend', cardHTML);
            });

            // Fallback: If images are already fully loaded (e.g. from browser cache)
            // Critical fix: Ensure they have a valid 'src' (are not currently lazy loading via data-src) before forcing opacity = 1
            container.querySelectorAll('.card-image-wrapper img').forEach(img => {
                if (img.getAttribute('src') && img.complete) {
                    img.style.opacity = '1';
                    if (img.parentElement) img.parentElement.style.filter = 'none';
                }
            });

            if (isGallery) {
                setupLazyLoading();
            }
            setupInteractionFeatures();

            const requestedEntryId = getEntryIdFromUrl();
            if (requestedEntryId) {
                const requestedEntry = data.entries.find(entry => entry.id === requestedEntryId);
                if (requestedEntry) {
                    openDetailModal(requestedEntry);
                }
            }
        })
        .catch(err => {
            console.error("Fehler beim Laden:", err);
            container.innerHTML = `<p style="text-align:center; color:var(--text-muted); width:100%; padding: var(--space-4);">Die Erinnerungen konnten gerade nicht geladen werden. Bitte lade die Seite neu.</p>`;
        });
}

function openDetailModal(entry) {
    currentSelectedEntry = entry;
    document.getElementById('detail-title').textContent = entry.title;
    document.getElementById('detail-date').textContent = formatDateForDisplay(entry.date);
    document.getElementById('detail-text').textContent = entry.text;
    updateReminderButtonLabel();
    
    const imgContainer = document.getElementById('detail-image-container');
    
    if (entry.image_url) {
        const placeholderStyle = entry.img_placeholder_str 
            ? `background-image: url('${entry.img_placeholder_str}'); background-size: cover; filter: blur(15px); transform: scale(1.05); transition: filter 0.5s ease;` 
            : '';
            
        imgContainer.innerHTML = `
            <div style="width:100%; max-height:400px; overflow:hidden; border-radius:var(--radius-md); margin-bottom:var(--space-3); ${placeholderStyle}">
                <img src="${entry.image_url}" style="width:100%; max-height:400px; object-fit:cover; opacity: 0; transition: opacity 0.4s ease;" onload="this.style.opacity='1'; this.parentElement.style.filter='none';" onerror="this.style.opacity='1'; this.parentElement.style.filter='none'; this.classList.add('image-error');">
            </div>`;

        const modalImg = imgContainer.querySelector('img');
        if (modalImg && modalImg.complete) {
            modalImg.style.opacity = '1';
            if (modalImg.parentElement) modalImg.parentElement.style.filter = 'none';
        }
    } else {
        imgContainer.innerHTML = '';
    }
    
    document.getElementById('detail-modal').classList.add('is-active');
}

function setupInteractionFeatures() {
    const cards = document.querySelectorAll('.memory-card');
    const contextMenu = document.getElementById('context-menu');
    
    document.addEventListener('click', () => { contextMenu.style.display = 'none'; });

    cards.forEach(card => {
        const id = parseInt(card.getAttribute('data-id'));
        const entry = globalEntriesData.find(e => e.id === id);
        
        let pressTimer;
        let isLongPress = false;

        const startPress = (e) => {
            isLongPress = false;
            pressTimer = setTimeout(() => {
                isLongPress = true;
                currentSelectedEntry = entry;
                
                const pageX = e.pageX || (e.touches ? e.touches[0].pageX : 0);
                const pageY = e.pageY || (e.touches ? e.touches[0].pageY : 0);
                
                contextMenu.style.top = `${pageY}px`;
                contextMenu.style.left = `${pageX}px`;
                contextMenu.style.display = 'block';
            }, 700);
        };

        const cancelPress = () => { clearTimeout(pressTimer); };

        card.addEventListener('mousedown', startPress);
        card.addEventListener('mouseup', cancelPress);
        card.addEventListener('mouseleave', cancelPress);
        
        card.addEventListener('touchstart', startPress);
        card.addEventListener('touchend', cancelPress);
        card.addEventListener('touchmove', cancelPress);

        card.addEventListener('click', (e) => {
            if (isLongPress || contextMenu.style.display === 'block') {
                e.preventDefault();
                return;
            }
            window.location.href = `/gallery?id=${entry.id}`;
        });
    });
}

function openEditModal(entry) {
    const editForm = document.getElementById('edit-form');
    editForm.action = `/edit_entry/${entry.id}`;
    
    document.getElementById('edit-title').value = entry.title;
    document.getElementById('edit-text').value = entry.text;
    document.getElementById('edit-date').value = entry.date;
    
    document.getElementById('detail-modal').classList.remove('is-active');
    document.getElementById('edit-modal').classList.add('is-active');
}

function deleteEntryHandler(entryId) {
    if (confirm("Möchtest du diese wunderschöne Erinnerung wirklich unwiderruflich löschen? 😢")) {
        fetch(`/delete_entry/${entryId}`, { method: 'DELETE' })
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    location.reload();
                }
            })
            .catch(err => console.error("Fehler beim Löschen:", err));
    }
}

function setupManagementModals() {
    document.getElementById('close-detail-btn')?.addEventListener('click', closeDetailModal);
    document.getElementById('close-edit-btn')?.addEventListener('click', () => document.getElementById('edit-modal').classList.remove('is-active'));
    document.getElementById('close-remind-modal-btn')?.addEventListener('click', closeReminderModal);

    document.getElementById('detail-edit-btn')?.addEventListener('click', () => openEditModal(currentSelectedEntry));
    document.getElementById('detail-delete-btn')?.addEventListener('click', () => deleteEntryHandler(currentSelectedEntry.id));
    document.getElementById('detail-remind-btn')?.addEventListener('click', () => openReminderModal(currentSelectedEntry));

    document.getElementById('context-edit')?.addEventListener('click', () => openEditModal(currentSelectedEntry));
    document.getElementById('context-delete')?.addEventListener('click', () => deleteEntryHandler(currentSelectedEntry.id));
}

function setupTheme() {
    const toggleBtn = document.getElementById('theme-toggle-btn');
    if (!toggleBtn) return;

    const currentTheme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', currentTheme);
    updateThemeIcon(currentTheme);

    toggleBtn.addEventListener('click', () => {
        const theme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('theme', theme);
        updateThemeIcon(theme);
    });
}

function updateThemeIcon(theme) {
    const icon = document.querySelector('#theme-toggle-btn i');
    if (!icon) return;
    if (theme === 'dark') {
        icon.className = 'fa-solid fa-sun';
    } else {
        icon.className = 'fa-solid fa-moon';
    }
}

function setHeroTitle() {
    const titles = [
        "Zusammen seit...",
        "Wie lange wir schon Hand in Hand gehen...",
        "Unsere gemeinsame Reise begann vor...",
        "Das Glück begann vor..."
    ];
    const randomIndex = Math.floor(Math.random() * titles.length);
    const heroTitle = document.getElementById('hero-title');
    if (heroTitle) {
        heroTitle.textContent = titles[randomIndex];
    }
}

function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

const VAPID_PUBLIC_KEY = "BJ4spcyHbbYUVPNydj2awOhbFg5G1D3pPhHcvFjouMNoikZKakB0sjxn-UBRhibHueVcVhSsMoFga0YIddTkwbc";

let pushServiceWorkerRegistration = null;

function canUsePushNotifications() {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

function openPushModal(message) {
    const modal = document.getElementById('push-modal');
    const text = document.getElementById('push-modal-text');
    if (text && message) {
        text.textContent = message;
    }
    if (modal) {
        modal.classList.add('is-active');
    }
}

function closePushModal() {
    document.getElementById('push-modal')?.classList.remove('is-active');
}

async function registerPushServiceWorker() {
    if (!pushServiceWorkerRegistration) {
        pushServiceWorkerRegistration = await navigator.serviceWorker.register('/sw.js');
        console.log('Service Worker registriert.');
    }
    return pushServiceWorkerRegistration;
}

async function syncPushSubscription(subscription) {
    const payload = {
        user: window.currentUser || null,
        subscription: subscription
    };

    await fetch('/api/subscribe', {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: {
            'Content-Type': 'application/json'
        }
    });
    console.log('Push-Abo erfolgreich an Server übertragen.');
}

async function enablePushNotifications() {
    if (!canUsePushNotifications()) {
        openPushModal('Dein Browser unterstützt Push-Benachrichtigungen nicht.');
        return;
    }

    try {
        const register = await registerPushServiceWorker();
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
            openPushModal('Ohne erlaubte Benachrichtigungen kann ich nichts schicken. Bitte erlaube Push-Benachrichtigungen.');
            return;
        }

        let subscription = await register.pushManager.getSubscription();
        if (!subscription) {
            subscription = await register.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
            });
        }

        await syncPushSubscription(subscription);
        closePushModal();
    } catch (error) {
        console.error('Fehler bei der Push-Registrierung:', error);
        openPushModal('Die Aktivierung ist fehlgeschlagen. Bitte versuche es noch einmal.');
    }
}

async function initPushNotifications() {
    if (!canUsePushNotifications()) {
        return;
    }

    try {
        const register = await registerPushServiceWorker();
        const subscription = await register.pushManager.getSubscription();

        if (subscription) {
            await syncPushSubscription(subscription);
            return;
        }

        if (Notification.permission === 'granted') {
            openPushModal('Benachrichtigungen sind noch nicht eingerichtet. Bitte aktiviere sie einmal per Klick.');
            return;
        }

        if (Notification.permission === 'default') {
            openPushModal('Damit iOS Push-Benachrichtigungen zulässt, musst du sie per Klick aktivieren.');
            return;
        }

        openPushModal('Benachrichtigungen sind im Browser deaktiviert. Bitte aktiviere sie in den Einstellungen oder per Klick hier.');
    } catch (error) {
        console.error('Fehler beim Vorbereiten der Push-Benachrichtigungen:', error);
    }
}

async function sendReminderPush() {
    if (!currentSelectedEntry) return;

    const messageInput = document.getElementById('remind-message');
    const message = messageInput ? messageInput.value.trim() : '';

    try {
        const response = await fetch(`/api/remind/${currentSelectedEntry.id}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ message })
        });

        const data = await response.json();
        if (!response.ok || !data.success) {
            throw new Error(data.error || 'Reminder konnte nicht gesendet werden.');
        }

        closeReminderModal();
    } catch (error) {
        console.error('Fehler beim Erinnern:', error);
        openPushModal('Die Erinnerung konnte nicht gesendet werden. Bitte versuche es noch einmal.');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    // Set default creation form date to today
    const dateInput = document.getElementById("date");
    if (dateInput) {
        dateInput.value = new Date().toISOString().split("T")[0];
    }

    setHeroTitle();
    updateCounter();
    setInterval(updateCounter, 60000); 
    
    setupModal();
    setupManagementModals(); 
    loadEntries();
    setupTheme();
    initPushNotifications();

    document.getElementById('enable-push-btn')?.addEventListener('click', enablePushNotifications);
    document.getElementById('close-push-modal-btn')?.addEventListener('click', closePushModal);
    document.getElementById('send-remind-btn')?.addEventListener('click', sendReminderPush);
    document.getElementById('push-modal')?.addEventListener('click', (e) => {
        if (e.target.id === 'push-modal') {
            closePushModal();
        }
    });
    document.getElementById('remind-modal')?.addEventListener('click', (e) => {
        if (e.target.id === 'remind-modal') {
            closeReminderModal();
        }
    });
});
