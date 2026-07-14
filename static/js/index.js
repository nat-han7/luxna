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
        })
        .catch(err => console.error("Fehler beim Laden:", err));
}

function openDetailModal(entry) {
    currentSelectedEntry = entry;
    document.getElementById('detail-title').textContent = entry.title;
    document.getElementById('detail-date').textContent = formatDateForDisplay(entry.date);
    document.getElementById('detail-text').textContent = entry.text;
    
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
            openDetailModal(entry);
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
    document.getElementById('close-detail-btn')?.addEventListener('click', () => document.getElementById('detail-modal').classList.remove('is-active'));
    document.getElementById('close-edit-btn')?.addEventListener('click', () => document.getElementById('edit-modal').classList.remove('is-active'));

    document.getElementById('detail-edit-btn')?.addEventListener('click', () => openEditModal(currentSelectedEntry));
    document.getElementById('detail-delete-btn')?.addEventListener('click', () => deleteEntryHandler(currentSelectedEntry.id));

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
});
