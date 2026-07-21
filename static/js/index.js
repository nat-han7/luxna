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
let chatRefreshInterval = null;
let chatReminderEntriesLoaded = false;

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

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function formatChatTimestamp(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('de-DE', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    }).format(date);
}

function getChatLabel(username) {
    if (!username) return 'Unbekannt';
    if (username === window.currentUser) return 'Du';
    if (username === 'nathan') return 'Nathan';
    if (username === 'luisa') return 'Luisa';
    return username;
}

async function loadChatReminderEntries() {
    const select = document.getElementById('chat-remind-entry');
    if (!select || chatReminderEntriesLoaded) return;

    try {
        const response = await fetch('/api/entries?limit=20');
        const data = await response.json();
        const entries = data.entries || [];

        select.innerHTML = '';
        if (!entries.length) {
            select.innerHTML = '<option value="" disabled selected>Keine Einträge vorhanden</option>';
            select.disabled = true;
            return;
        }

        select.disabled = false;
        select.insertAdjacentHTML('beforeend', '<option value="" disabled selected>Eintrag auswählen</option>');
        entries.forEach(entry => {
            const option = document.createElement('option');
            option.value = entry.id;
            option.textContent = `${formatDateForDisplay(entry.date)} - ${entry.title}`;
            select.appendChild(option);
        });
        chatReminderEntriesLoaded = true;
    } catch (error) {
        console.error('Fehler beim Laden der Einträge für Erinnerungen:', error);
    }
}

function renderChatMessages(messages) {
    const container = document.getElementById('chat-messages');
    if (!container) return;

    if (!messages || messages.length === 0) {
        container.innerHTML = `
            <div class="chat-empty">
                <strong>Noch keine Nachricht</strong>
                <div>Schick den ersten Gruß oder erinnere direkt an einen gemeinsamen Moment.</div>
            </div>
        `;
        return;
    }

    container.innerHTML = messages.map(message => {
        const isReminder = message.kind === 'reminder';
        const isSelf = message.sender === window.currentUser;
        const bubbleClasses = ['chat-bubble'];
        if (isSelf) bubbleClasses.push('is-self');
        if (isReminder) bubbleClasses.push('is-reminder');

        const body = isReminder
            ? message.entry_title
                ? `${message.message || 'Eine Erinnerung'}`
                : (message.message || 'Eine Erinnerung')
            : (message.message || '');

        const reminderLink = isReminder && message.entry_id
            ? `<a class="chat-link" href="/gallery?id=${message.entry_id}"><i class="fa-solid fa-arrow-up-right-from-square"></i> Eintrag öffnen</a>`
            : '';

        const deliveryStatus = isSelf && message.delivery_status
            ? `<span class="chat-status">${escapeHtml(message.delivery_status)}</span>`
            : '';

        return `
            <article class="${bubbleClasses.join(' ')}">
                <div class="chat-meta">
                    <span class="chat-sender">${escapeHtml(getChatLabel(message.sender))}${isReminder ? ' · Erinnerung' : ''}</span>
                    <span class="chat-meta-right">
                        <span>${escapeHtml(formatChatTimestamp(message.created_at))}</span>
                        ${deliveryStatus}
                    </span>
                </div>
                <div class="chat-text">${escapeHtml(body)}</div>
                ${reminderLink}
            </article>
        `;
    }).join('');

    container.scrollTop = container.scrollHeight;
}
async function loadChatMessages() {
    const container = document.getElementById('chat-messages');
    if (!container) return;

    try {
        const response = await fetch('/api/chat/messages');
        const data = await response.json();
        renderChatMessages(data.messages || []);
    } catch (error) {
        console.error('Fehler beim Laden des Chats:', error);
        container.innerHTML = `<div class="chat-empty">Der Chat konnte gerade nicht geladen werden. Bitte lade die Seite neu.</div>`;
    }
}

async function sendChatMessage() {
    const input = document.getElementById('chat-input');
    if (!input) return;

    const message = input.value.trim();
    if (!message) return;

    try {
        const response = await fetch('/api/chat/send', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ message })
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
            throw new Error(data.error || 'Chat message failed');
        }
        input.value = '';
        await loadChatMessages();
    } catch (error) {
        console.error('Fehler beim Senden der Nachricht:', error);
    }
}

async function openChatReminderModal() {
    const modal = document.getElementById('chat-remind-modal');
    if (!modal) return;
    await loadChatReminderEntries();
    modal.classList.add('is-active');
}

function closeChatReminderModal() {
    document.getElementById('chat-remind-modal')?.classList.remove('is-active');
}

async function sendChatReminder() {
    const entrySelect = document.getElementById('chat-remind-entry');
    const messageInput = document.getElementById('chat-remind-message');
    if (!entrySelect || !entrySelect.value) return;

    try {
        const response = await fetch(`/api/remind/${entrySelect.value}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ message: messageInput ? messageInput.value.trim() : '' })
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
            throw new Error(data.error || 'Reminder failed');
        }
        if (messageInput) messageInput.value = '';
        closeChatReminderModal();
        await loadChatMessages();
    } catch (error) {
        console.error('Fehler beim Senden der Erinnerung:', error);
    }
}

function initChatPage() {
    const messagesContainer = document.getElementById('chat-messages');
    if (!messagesContainer) return;

    document.getElementById('chat-form')?.addEventListener('submit', (e) => {
        e.preventDefault();
        sendChatMessage();
    });

    document.getElementById('chat-input')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendChatMessage();
        }
    });

    document.getElementById('chat-open-remind-btn')?.addEventListener('click', openChatReminderModal);
    document.getElementById('chat-remind-shortcut')?.addEventListener('click', openChatReminderModal);
    document.getElementById('close-chat-remind-btn')?.addEventListener('click', closeChatReminderModal);
    document.getElementById('chat-send-remind-btn')?.addEventListener('click', sendChatReminder);
    document.getElementById('chat-remind-modal')?.addEventListener('click', (e) => {
        if (e.target.id === 'chat-remind-modal') {
            closeChatReminderModal();
        }
    });

    loadChatMessages();
    chatRefreshInterval = setInterval(loadChatMessages, 5000);
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
                container.innerHTML = `<p style="text-align:center; color:var(--text-muted); width:100%; padding: var(--space-4);">Hier ist es noch ganz leer... Lass uns schnell die erste gemeinsame Erinnerung reinschreiben! âœ¨</p>`;
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

                const timeAgoHTML = entry.time_ago 
                    ? `<span class="card-time-ago" style="font-size: 0.75rem; color: var(--accent); font-weight: 600; background: rgba(255, 77, 109, 0.1); padding: 2px 8px; border-radius: 12px;">${entry.time_ago}</span>` 
                    : '';
                
                const cardHTML = `
                    <div class="memory-card" data-id="${entry.id}">
                        ${imgHTML}
                        <div class="card-content">
                            <div class="card-header-flex">
                                <h4 class="card-title">${entry.title}</h4>
                                <span class="card-date">${formatDateForDisplay(entry.date)}</span>
                            </div>
                            ${timeAgoHTML ? `<div style="margin-top: var(--space-2);">${timeAgoHTML}</div>` : ''}
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
    if (confirm("Möchtest du diese wunderschöne Erinnerung wirklich unwiderruflich löschen?")) {
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

const VAPID_PUBLIC_KEY = window.vapidPublicKey || "";
const PUSH_VAPID_KEY_STORAGE = 'push_vapid_public_key';

let pushServiceWorkerRegistration = null;
let currentPushStatus = 'inactive';

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
    localStorage.setItem('push_modal_dismissed', 'true');
}

function closePushInfoModal() {
    document.getElementById('push-info-modal')?.classList.remove('is-active');
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
    try {
        localStorage.setItem(PUSH_VAPID_KEY_STORAGE, VAPID_PUBLIC_KEY);
    } catch (error) {
        console.warn('Konnte die Push-Key-Version nicht speichern:', error);
    }
    console.log('Push-Abo erfolgreich an Server übertragen.');
}

async function getCurrentPushSubscription(register) {
    let subscription = await register.pushManager.getSubscription();

    if (subscription) {
        try {
            const storedKey = localStorage.getItem(PUSH_VAPID_KEY_STORAGE);
            if (!storedKey || storedKey !== VAPID_PUBLIC_KEY) {
                await subscription.unsubscribe();
                subscription = null;
            }
        } catch (error) {
            console.warn('Konnte die gespeicherte Push-Key-Version nicht lesen:', error);
        }
    }

    if (!subscription) {
        subscription = await register.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
        });
    }

    return subscription;
}

function updatePushStatusUI(status) {
    currentPushStatus = status;
    const btn = document.getElementById('push-status-btn');
    const dot = btn ? btn.querySelector('.push-dot') : null;
    const icon = btn ? btn.querySelector('i') : null;

    if (!btn) return;

    if (status === 'active') {
        if (icon) {
            icon.className = 'fa-solid fa-bell';
            icon.style.color = 'var(--accent)';
        }
        if (dot) dot.style.display = 'none';
        btn.title = 'Push-Benachrichtigungen aktiv';
    } else if (status === 'denied') {
        if (icon) {
            icon.className = 'fa-solid fa-bell-slash';
            icon.style.color = 'var(--text-muted)';
        }
        if (dot) dot.style.display = 'none';
        btn.title = 'Push-Benachrichtigungen blockiert';
    } else if (status === 'ios-not-pwa') {
        if (icon) {
            icon.className = 'fa-regular fa-bell';
            icon.style.color = 'var(--text-muted)';
        }
        if (dot) {
            dot.style.display = 'block';
            dot.style.backgroundColor = '#e53e3e';
        }
        btn.title = 'Push aktivieren (iOS Home-Bildschirm benötigt)';
    } else if (status === 'unsupported' || status === 'unconfigured') {
        if (icon) {
            icon.className = 'fa-solid fa-bell-slash';
            icon.style.color = 'var(--text-muted)';
        }
        if (dot) dot.style.display = 'none';
        btn.title = 'Push nicht unterstützt';
    } else {
        // Inactive / default state
        if (icon) {
            icon.className = 'fa-regular fa-bell';
            icon.style.color = 'var(--text-main)';
        }
        if (dot) {
            dot.style.display = 'block';
            dot.style.backgroundColor = 'var(--accent)';
        }
        btn.title = 'Push-Benachrichtigungen einrichten';
    }
}

function handlePushStatusClick() {
    if (currentPushStatus === 'active') {
        document.getElementById('push-info-modal')?.classList.add('is-active');
    } else if (currentPushStatus === 'denied') {
        openPushModal('Du hast Benachrichtigungen für diese Seite blockiert. Bitte setze die Berechtigungen in deinen Browser-Einstellungen zurück (Klick auf das Schloss-Symbol neben der URL) und klicke hier erneut, um sie zu aktivieren. 💕');
    } else if (currentPushStatus === 'ios-not-pwa') {
        openPushModal('Auf dem iPhone/iPad unterstützt Safari Push-Benachrichtigungen nur, wenn die Seite als App auf dem Home-Bildschirm installiert ist.\n\nFüge uns hinzu: Tippe auf Teilen (Viereck mit Pfeil) -> Zum Home-Bildschirm und öffne das Memorybook von dort. 💕');
    } else if (currentPushStatus === 'unsupported' || currentPushStatus === 'unconfigured') {
        openPushModal('Dein aktueller Browser unterstützt leider keine Push-Benachrichtigungen oder die Serverkonfiguration fehlt. Bitte verwende Safari (iOS), Chrome oder Firefox. 🥺');
    } else {
        openPushModal('Damit du Benachrichtigungen für neue Erinnerungen und Nachrichten erhältst, aktiviere sie bitte per Klick.');
    }
}

async function sendTestPushNotification() {
    const btn = document.getElementById('send-test-push-btn');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = 'Sendet... <i class="fa-solid fa-spinner fa-spin"></i>';
    }
    try {
        const response = await fetch('/api/push/test', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        const data = await response.json();
        if (response.ok && data.success) {
            alert('Test-Benachrichtigung wurde gesendet! Sie sollte in wenigen Sekunden ankommen. 🔔');
        } else {
            throw new Error(data.error || 'Request failed');
        }
    } catch (err) {
        console.error('Test push error:', err);
        alert('Test-Benachrichtigung fehlgeschlagen. Bitte stelle sicher, dass dein Gerät Internetverbindung hat.');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = 'Test-Benachrichtigung senden <i class="fa-solid fa-paper-plane"></i>';
        }
        document.getElementById('push-info-modal')?.classList.remove('is-active');
    }
}

async function forceReRegisterPush() {
    const consent = confirm('Möchtest du das aktuelle Push-Abonnement zurücksetzen und neu registrieren?');
    if (!consent) return;

    document.getElementById('push-info-modal')?.classList.remove('is-active');
    updatePushStatusUI('inactive');

    try {
        if ('serviceWorker' in navigator) {
            const register = await navigator.serviceWorker.ready;
            const subscription = await register.pushManager.getSubscription();
            if (subscription) {
                await subscription.unsubscribe();
                console.log('Altes Push-Abo gelöscht.');
            }
        }
        localStorage.removeItem(PUSH_VAPID_KEY_STORAGE);
        await enablePushNotifications();
    } catch (error) {
        console.error('Resetting subscription failed:', error);
        openPushModal('Zurücksetzen fehlgeschlagen. Versuche es über den normalen Aktivieren-Button.');
    }
}

async function enablePushNotifications() {
    if (!canUsePushNotifications()) {
        openPushModal('Dein Browser unterstützt Push-Benachrichtigungen nicht.');
        return;
    }

    if (!VAPID_PUBLIC_KEY) {
        openPushModal('Push-Benachrichtigungen sind serverseitig nicht konfiguriert.');
        return;
    }

    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    const isStandalone = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
    if (isIOS && !isStandalone) {
        openPushModal('Um Benachrichtigungen auf dem iPhone zu aktivieren, füge diese Seite zuerst über den Teilen-Button zum Home-Bildschirm hinzu und öffne sie von dort als App. 💕');
        return;
    }

    try {
        const register = await registerPushServiceWorker();
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
            openPushModal('Ohne erlaubte Benachrichtigungen können wir keine Push-Nachrichten senden. Bitte erlaube Benachrichtigungen in deinen Website-Einstellungen.');
            updatePushStatusUI('denied');
            return;
        }

        const subscription = await register.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
        });

        await syncPushSubscription(subscription);
        closePushModal();
        updatePushStatusUI('active');
        alert('Super! Benachrichtigungen wurden erfolgreich aktiviert. 💕');
    } catch (error) {
        console.error('Fehler bei der Push-Registrierung:', error);
        openPushModal('Die Aktivierung ist fehlgeschlagen. Bitte versuche es noch einmal.');
        updatePushStatusUI('inactive');
    }
}

async function initPushNotifications() {
    if (!canUsePushNotifications()) {
        updatePushStatusUI('unsupported');
        return;
    }

    if (!VAPID_PUBLIC_KEY) {
        updatePushStatusUI('unconfigured');
        return;
    }

    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    const isStandalone = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
    if (isIOS && !isStandalone) {
        updatePushStatusUI('ios-not-pwa');
        return;
    }

    try {
        const register = await registerPushServiceWorker();
        let subscription = await register.pushManager.getSubscription();

        if (subscription) {
            try {
                const storedKey = localStorage.getItem(PUSH_VAPID_KEY_STORAGE);
                if (!storedKey || storedKey !== VAPID_PUBLIC_KEY) {
                    console.log('VAPID-Key geändert. Setze Abo zurück...');
                    await subscription.unsubscribe();
                    subscription = null;
                }
            } catch (error) {
                console.warn('Fehler beim Prüfen des gespeicherten Keys:', error);
            }
        }

        if (subscription) {
            await syncPushSubscription(subscription);
            updatePushStatusUI('active');
            return;
        }

        if (Notification.permission === 'granted') {
            try {
                const newSub = await register.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
                });
                await syncPushSubscription(newSub);
                updatePushStatusUI('active');
            } catch (subErr) {
                console.error('Fehler beim automatischen Abonnieren trotz Berechtigung:', subErr);
                updatePushStatusUI('inactive');
            }
        } else if (Notification.permission === 'denied') {
            updatePushStatusUI('denied');
        } else {
            updatePushStatusUI('inactive');
            const promptDismissed = localStorage.getItem('push_modal_dismissed');
            if (!promptDismissed) {
                openPushModal('Damit du Benachrichtigungen für neue Erinnerungen und Nachrichten erhältst, aktiviere sie bitte per Klick.');
            }
        }
    } catch (error) {
        console.error('Fehler beim Vorbereiten der Push-Benachrichtigungen:', error);
        updatePushStatusUI('inactive');
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

let chatUnreadInterval = null;
let inAppNotificationTimeout = null;
let currentNotificationUrl = null;

function isChatFocused() {
    // Check if we're on the chat page
    return window.location.pathname === '/chat';
}

function showInAppNotification(title, body, url = '/') {
    // Don't show in-app notification if chat is focused
    if (isChatFocused()) {
        return;
    }

    const notification = document.getElementById('in-app-notification');
    const titleEl = document.getElementById('in-app-title');
    const bodyEl = document.getElementById('in-app-body');
    
    if (!notification || !titleEl || !bodyEl) return;
    
    titleEl.textContent = title;
    bodyEl.textContent = body;
    currentNotificationUrl = url;
    
    notification.classList.add('is-visible');
    
    // Auto-hide after 5 seconds
    clearTimeout(inAppNotificationTimeout);
    inAppNotificationTimeout = setTimeout(() => {
        notification.classList.remove('is-visible');
    }, 5000);
}

function hideInAppNotification() {
    const notification = document.getElementById('in-app-notification');
    if (notification) {
        notification.classList.remove('is-visible');
    }
    clearTimeout(inAppNotificationTimeout);
    currentNotificationUrl = null;
}

function handleNotificationClick() {
    if (currentNotificationUrl) {
        window.location.href = currentNotificationUrl;
    }
    hideInAppNotification();
}

// Listen for messages from service worker
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', function(event) {
        if (event.data && event.data.type === 'PUSH_NOTIFICATION') {
            showInAppNotification(event.data.title, event.data.body, event.data.url);
        }
    });
}

// PWA Install Prompt with beforeinstallprompt
let deferredPrompt = null;
let pwaInstallDismissed = false;

function showPWAInstallBanner() {
    const banner = document.getElementById('pwa-install-banner');
    if (banner && !pwaInstallDismissed) {
        banner.style.display = 'block';
    }
}

function hidePWAInstallBanner() {
    const banner = document.getElementById('pwa-install-banner');
    if (banner) {
        banner.style.display = 'none';
    }
}

function dismissPWAInstallBanner() {
    pwaInstallDismissed = true;
    localStorage.setItem('pwa_install_dismissed', Date.now().toString());
    hidePWAInstallBanner();
}

// Listen for beforeinstallprompt event
window.addEventListener('beforeinstallprompt', (e) => {
    console.log('beforeinstallprompt event fired');
    // Prevent Chrome 67 and earlier from automatically showing the prompt
    e.preventDefault();
    
    // Stash the event so it can be triggered later
    deferredPrompt = e;
    
    // Check if user has dismissed it recently
    const dismissed = localStorage.getItem('pwa_install_dismissed');
    if (dismissed) {
        const dismissedTime = parseInt(dismissed, 10);
        const oneWeek = 7 * 24 * 60 * 60 * 1000;
        if (Date.now() - dismissedTime < oneWeek) {
            console.log('PWA install dismissed recently, not showing banner');
            return; // Don't show if dismissed less than a week ago
        }
    }
    
    // Show the install banner after a short delay
    setTimeout(() => {
        console.log('Showing PWA install banner');
        showPWAInstallBanner();
    }, 2000);
});

// Listen for app installed event
window.addEventListener('appinstalled', () => {
    // Clear the deferredPrompt
    deferredPrompt = null;
    // Hide the banner
    hidePWAInstallBanner();
});

// Handle install button click
document.getElementById('pwa-install-btn')?.addEventListener('click', async (e) => {
    if (!deferredPrompt) {
        return;
    }
    
    // Show the install prompt
    deferredPrompt.prompt();
    
    // Wait for the user to respond to the prompt
    const { outcome } = await deferredPrompt.userChoice;
    
    // Clear the deferredPrompt
    deferredPrompt = null;
    
    // Hide the banner regardless of outcome
    hidePWAInstallBanner();
    
    // Log the outcome
    console.log(`User response to install prompt: ${outcome}`);
});

// Handle dismiss button click
document.getElementById('pwa-install-dismiss-btn')?.addEventListener('click', dismissPWAInstallBanner);

function initPWAInstallPrompt() {
    // Check if already installed as PWA
    const isStandalone = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
    if (isStandalone) {
        return;
    }
    
    // The beforeinstallprompt event will handle showing the banner
    // No need for manual detection anymore
}

async function checkUnreadChatCount() {
    try {
        const response = await fetch('/api/chat/unread_count');
        if (!response.ok) return;
        const data = await response.json();
        const count = data.unread_count || 0;

        const desktopBadge = document.getElementById('chat-badge-desktop');
        const mobileBadge = document.getElementById('chat-badge-mobile');

        if (count > 0) {
            if (desktopBadge) {
                desktopBadge.textContent = count;
                desktopBadge.style.display = 'flex';
            }
            if (mobileBadge) {
                mobileBadge.textContent = count;
                mobileBadge.style.display = 'flex';
            }
        } else {
            if (desktopBadge) desktopBadge.style.display = 'none';
            if (mobileBadge) mobileBadge.style.display = 'none';
        }
    } catch (error) {
        console.warn('Konnte Anzahl ungelesener Nachrichten nicht abrufen:', error);
    }
}

function initChatBadgePolling() {
    checkUnreadChatCount();
    chatUnreadInterval = setInterval(checkUnreadChatCount, 5000);
}

function initBottomNavActiveState() {
    const currentPath = window.location.pathname;
    const items = document.querySelectorAll('.bottom-nav-item');
    items.forEach(item => {
        const href = item.getAttribute('href');
        if (currentPath === href) {
            item.classList.add('is-active');
        } else {
            item.classList.remove('is-active');
        }
    });
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
    initChatPage();
    initChatBadgePolling();
    initBottomNavActiveState();
    initPWAInstallPrompt();

    document.getElementById('enable-push-btn')?.addEventListener('click', enablePushNotifications);
    document.getElementById('close-push-modal-btn')?.addEventListener('click', closePushModal);
    document.getElementById('send-remind-btn')?.addEventListener('click', sendReminderPush);
    
    // Status button and testing actions
    document.getElementById('push-status-btn')?.addEventListener('click', handlePushStatusClick);
    document.getElementById('send-test-push-btn')?.addEventListener('click', sendTestPushNotification);
    document.getElementById('disable-push-local-btn')?.addEventListener('click', forceReRegisterPush);
    document.getElementById('close-push-info-modal-btn')?.addEventListener('click', closePushInfoModal);

    document.getElementById('in-app-close-btn')?.addEventListener('click', hideInAppNotification);
    
    // Make the entire notification clickable
    const inAppNotification = document.getElementById('in-app-notification');
    if (inAppNotification) {
        inAppNotification.addEventListener('click', (e) => {
            // Don't navigate if clicking the close button
            if (e.target.closest('#in-app-close-btn')) {
                return;
            }
            handleNotificationClick();
        });
    }

    document.getElementById('push-modal')?.addEventListener('click', (e) => {
        if (e.target.id === 'push-modal') {
            closePushModal();
        }
    });
    document.getElementById('push-info-modal')?.addEventListener('click', (e) => {
        if (e.target.id === 'push-info-modal') {
            closePushInfoModal();
        }
    });
    document.getElementById('remind-modal')?.addEventListener('click', (e) => {
        if (e.target.id === 'remind-modal') {
            closeReminderModal();
        }
    });
});

window.addEventListener('beforeunload', () => {
    if (chatRefreshInterval) {
        clearInterval(chatRefreshInterval);
    }
    if (chatUnreadInterval) {
        clearInterval(chatUnreadInterval);
    }
});
