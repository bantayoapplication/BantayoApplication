// ==================== FIREBASE CONFIGURATION ====================
const firebaseConfig = {
  apiKey: "AIzaSyC2WSefQ2Hs6S4AJBESDs4F5iJwPK7jVzU",
  authDomain: "bantayoapplication.firebaseapp.com",
  projectId: "bantayoapplication",
  storageBucket: "bantayoapplication.firebasestorage.app",
  messagingSenderId: "51777911890",
  appId: "1:51777911890:web:0c876b31a75ab8c0f7338b",
  measurementId: "G-5KJ7LE1KFF"
};

// Initialize Firebase & Cloud Firestore
if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}
const db = firebase.firestore();

// Application State
const DEFAULT_COORDS = { lat: 16.416, lng: 120.596 }; // Baguio City Center
let currentRole = 'resident';
let capturedImageData = null;
let currentGeoCoords = { ...DEFAULT_COORDS };
let geoSource = null; // 'photo' (EXIF) | 'camera' (live camera) | 'manual' (pinned / my location) | null (not set yet)
let pickerMapInstance = null;
let pickerMarkerInstance = null;
let hazardMapInstance = null;
const MAP_OUTSIDE_MSG = 'That spot is outside Baguio City. BANTAYO only covers Baguio, so please choose a location inside Baguio.';

let reports = [];
let myReports = [];
let announcements = [];     // barangay announcements (Firestore "announcements")
let currentTab = 'home';
let notices = [];           // removal notices the barangay sent to this person (Firestore "report_notices")

// Initialize Application & Real-time Database Listener
document.addEventListener('DOMContentLoaded', () => {
  registerServiceWorker();
  listenPWAInstall();
  listenOnlineStatus();
  initCloudReportsSync();
  initAnnouncementsSync();
  switchTab('home');
});

// The name shown for a signed-in user: their registered username, else the start of their email
function getDisplayName(user) {
  if (!user) return 'Resident';
  if (user.displayName) return user.displayName;
  return user.email ? user.email.split('@')[0] : 'Resident';
}

function filterPersonalReports() {
  const currentUser = firebase.auth().currentUser;
  if (currentUser) {
    myReports = reports.filter(
      r => r.userId === currentUser.uid || r.userEmail === currentUser.email
    );
  } else {
    myReports = [];
  }
}

// Re-draw whichever screen is open after new data arrives
function refreshActiveTab() {
  const content = document.getElementById('app-content');
  if (!content) return;
  if (currentTab === 'home') renderHome(content);
  else if (currentTab === 'map') renderMap(content);
  else if (currentTab === 'reports') renderReports(content);
  else if (currentTab === 'profile' && typeof window.renderProfileView === 'function') window.renderProfileView();
}

// Real-Time Cloud Synchronization Function
function initCloudReportsSync() {
  db.collection("hazard_reports").orderBy("createdAt", "desc").onSnapshot((snapshot) => {
    reports = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    filterPersonalReports();
    updateNotifBadge();
    refreshActiveTab();
  }, (error) => {
    console.warn("Firestore listener fallback / offline mode active:", error);
  });
}

// Barangay announcements
function initAnnouncementsSync() {
  db.collection("announcements").orderBy("createdAt", "desc").limit(50).onSnapshot((snapshot) => {
    announcements = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    updateNotifBadge();
    if (currentTab === 'reports') refreshActiveTab();
  }, (error) => {
    console.warn("Announcements listener unavailable (check the Firestore rule for 'announcements'):", error);
  });
}

// Notices sent privately to this person (for example: the barangay removed their report, with the reason)
let noticeSets = { byId: {}, byEmail: {} };
let noticeUnsubs = [];

function initNoticesSync(user) {
  noticeUnsubs.forEach(u => { try { u(); } catch (e) {} });
  noticeUnsubs = [];
  noticeSets = { byId: {}, byEmail: {} };
  notices = [];
  if (!user) return;

  const listen = (key) => (snapshot) => {
    noticeSets[key] = {};
    snapshot.docs.forEach(d => { noticeSets[key][d.id] = { id: d.id, ...d.data() }; });
    notices = Object.values(Object.assign({}, noticeSets.byId, noticeSets.byEmail));
    updateNotifBadge();
    if (currentTab === 'reports') refreshActiveTab();
  };
  const failed = (error) => console.warn("Removal notices unavailable (check the Firestore rule for 'report_notices'):", error);

  noticeUnsubs.push(db.collection("report_notices").where("userId", "==", user.uid).onSnapshot(listen('byId'), failed));
  if (user.email) {
    noticeUnsubs.push(db.collection("report_notices").where("userEmail", "==", user.email).onSnapshot(listen('byEmail'), failed));
  }
}

// Re-sync personal reports immediately once Firebase Auth resolves the user
firebase.auth().onAuthStateChanged((user) => {
  initNoticesSync(user);
  if (user) {
    filterPersonalReports();
    updateNotifBadge();
    if (currentTab === 'home' || currentTab === 'reports') refreshActiveTab();
  }
});

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(console.error);
  }
}

function listenPWAInstall() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    const installBtn = document.getElementById('pwa-install-btn');
    if (installBtn) {
      installBtn.classList.remove('hidden');
      installBtn.onclick = () => e.prompt();
    }
  });
}

function listenOnlineStatus() {
  const banner = document.getElementById('offline-banner');
  const update = () => navigator.onLine ? banner.classList.add('hidden') : banner.classList.remove('hidden');
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  update();
}

// Navigation Tab Switcher
function switchTab(tab) {
  const content = document.getElementById('app-content');
  currentTab = tab;
  stopWebcamStream();

  document.querySelectorAll('.nav-btn').forEach(btn => {
    if (btn.dataset.tab === tab) {
      btn.classList.add('text-blue-600', 'dark:text-blue-400');
      btn.classList.remove('text-slate-500', 'dark:text-slate-400');
    } else {
      btn.classList.remove('text-blue-600', 'dark:text-blue-400');
      btn.classList.add('text-slate-500', 'dark:text-slate-400');
    }
  });

  if (tab === 'home') renderHome(content);
  else if (tab === 'submit') renderSubmit(content);
  else if (tab === 'map') renderMap(content);
  else if (tab === 'reports') renderReports(content);
  else if (tab === 'profile') renderProfile(content);

  if (typeof lucide !== 'undefined') lucide.createIcons();
}

// Helper: Compress Base64 Images to fit Firestore size limit (< 1MB)
function compressBase64(base64Str, maxWidth = 600, quality = 0.6) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const scale = maxWidth / img.width;
      canvas.width = maxWidth;
      canvas.height = img.height * scale;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => reject(new Error('Image format not supported'));
    img.src = base64Str;
  });
}

// Colour of a status badge
function statusBadgeClass(status) {
  if (status === 'Pending') return 'bg-rose-50 dark:bg-rose-950/80 text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-800';
  if (status === 'In Progress') return 'bg-amber-50 dark:bg-amber-950/80 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800';
  return 'bg-emerald-50 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800';
}

// One of the signed-in user's own reports (used on Home and on the Profile screen)
function myReportCardHtml(r) {
  const status = r.status || 'Pending';
  return `
    <div class="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl flex items-center space-x-4 shadow-md transition-colors">
      <img src="${escHtml(r.image)}" class="w-16 h-16 object-cover rounded-xl flex-shrink-0 border border-slate-200 dark:border-slate-800" alt="Hazard Photo" />
      <div class="flex-1 min-w-0">
        <div class="flex justify-between items-start gap-2">
          <p class="text-xs font-bold text-slate-900 dark:text-white truncate">${escHtml(r.title)}</p>
          <span class="text-[10px] font-semibold px-2.5 py-0.5 rounded-md border flex-shrink-0 ${statusBadgeClass(status)}">${escHtml(status)}</span>
        </div>
        <p class="text-[11px] text-slate-600 dark:text-slate-400 truncate mt-0.5">📍 ${escHtml(r.location)}</p>
        <p class="text-[10px] text-slate-500 mt-1 line-clamp-1">${escHtml(r.description)}</p>
        <div class="flex items-center justify-between mt-1.5">
          <span class="text-[10px] text-slate-400">${escHtml(r.date || '')}</span>
          ${hasValidCoords(r) ? `<button onclick="openReportDirections('${escHtml(r.id)}')" class="text-[10px] font-bold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer">Show the way</button>` : ''}
        </div>
      </div>
    </div>`;
}

// ==================== STATUS LIGHTBOX ====================
// Tap Pending / In Progress / Resolved on Home to see those reports in a full-screen photo viewer
const LB_COLORS = { 'Pending': '#f59e0b', 'In Progress': '#3b82f6', 'Resolved': '#10b981' };
let lb = { status: null, list: [], index: 0 };

function openStatusLightbox(status) {
  filterPersonalReports();
  lb = { status: status, list: myReports.filter(r => (r.status || 'Pending') === status), index: 0 };
  renderLightbox();
  document.removeEventListener('keydown', lightboxKeys);
  document.addEventListener('keydown', lightboxKeys);
}

function closeStatusLightbox() {
  const el = document.getElementById('status-lightbox');
  if (el) el.remove();
  document.removeEventListener('keydown', lightboxKeys);
}

function lightboxKeys(e) {
  if (e.key === 'Escape') closeStatusLightbox();
  else if (e.key === 'ArrowRight') stepLightbox(1);
  else if (e.key === 'ArrowLeft') stepLightbox(-1);
}

function stepLightbox(direction) {
  if (lb.list.length < 2) return;
  lb.index = (lb.index + direction + lb.list.length) % lb.list.length;
  renderLightbox();
}

function renderLightbox() {
  let el = document.getElementById('status-lightbox');
  if (!el) {
    el = document.createElement('div');
    el.id = 'status-lightbox';
    el.style.cssText = 'position:fixed;inset:0;z-index:99990;background:rgba(2,6,23,.88);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:16px;';
    el.onclick = (e) => { if (e.target === el) closeStatusLightbox(); };
    document.body.appendChild(el);
  }

  const color = LB_COLORS[lb.status] || '#3b82f6';
  const r = lb.list[lb.index];
  const many = lb.list.length > 1;
  const circle = 'width:44px;height:44px;border-radius:9999px;background:rgba(15,23,42,.9);color:#fff;border:1px solid rgba(255,255,255,.15);font-size:18px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;';

  el.innerHTML = `
    <button onclick="closeStatusLightbox()" style="${circle}position:absolute;top:20px;right:20px;" title="Close">✕</button>
    ${many ? `
      <button onclick="stepLightbox(-1)" style="${circle}position:absolute;left:14px;top:50%;transform:translateY(-50%);" title="Previous">‹</button>
      <button onclick="stepLightbox(1)" style="${circle}position:absolute;right:14px;top:50%;transform:translateY(-50%);" title="Next">›</button>` : ''}
    <div style="max-width:min(86vw,720px);width:100%;text-align:center;">
      ${r ? `
        <div style="border:3px solid ${color};border-radius:14px;box-shadow:0 0 36px ${color}99;background:#020617;overflow:hidden;">
          <img src="${escHtml(r.image)}" alt="Report photo" style="display:block;width:100%;max-height:60vh;object-fit:contain;" />
        </div>
        <p style="margin-top:14px;font-size:18px;font-weight:800;color:#fff;">${escHtml(r.title)}</p>
        <p style="font-size:12px;color:#94a3b8;margin-top:2px;">${escHtml(r.location)}${r.date ? ' • ' + escHtml(r.date) : ''}</p>
        ${r.description ? `<p style="font-size:12px;color:#cbd5e1;margin:8px auto 0;max-width:520px;line-height:1.5;">${escHtml(r.description)}</p>` : ''}
        <div style="margin-top:12px;display:flex;align-items:center;justify-content:center;gap:10px;flex-wrap:wrap;">
          <span style="font-size:10px;font-weight:700;color:${color};border:1px solid ${color};border-radius:9999px;padding:3px 10px;">${escHtml(lb.status)}</span>
          ${many ? `<span style="font-size:11px;color:#94a3b8;">${lb.index + 1} of ${lb.list.length}</span>` : ''}
          ${hasValidCoords(r) ? `<button onclick="openReportDirections('${escHtml(r.id)}')" style="font-size:11px;font-weight:700;color:#fff;background:#2563eb;border:0;border-radius:9999px;padding:5px 14px;cursor:pointer;">Show the way</button>` : ''}
        </div>
      ` : `
        <div style="border:3px solid ${color};border-radius:14px;box-shadow:0 0 36px ${color}99;background:#0b1220;padding:56px 20px;">
          <p style="font-size:13px;color:#94a3b8;font-style:italic;">You have no ${escHtml(lb.status)} reports.</p>
        </div>
        <p style="margin-top:14px;font-size:18px;font-weight:800;color:#fff;">${escHtml(lb.status)}</p>
      `}
    </div>`;
}

// Screen 1: Personalized Resident Home Dashboard
function renderHome(container) {
  if (!container) return;
  container.className = "flex-1 overflow-y-auto p-4 md:p-8";

  filterPersonalReports();

  const user = firebase.auth().currentUser;
  const displayName = getDisplayName(user);
  const userEmail = user ? user.email : '';

  const pendingCount = myReports.filter(r => (r.status || 'Pending') === 'Pending').length;
  const inProgressCount = myReports.filter(r => r.status === 'In Progress').length;
  const resolvedCount = myReports.filter(r => r.status === 'Resolved').length;

  const shown = myReports.slice(0, 3);

  container.innerHTML = `
    <div class="space-y-6 md:space-y-0 md:grid md:grid-cols-12 md:gap-6">

      <!-- Left Column: Welcome & Quick Action -->
      <div class="md:col-span-4 space-y-4">
        <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-md transition-colors">
          <p class="text-xs text-blue-600 dark:text-blue-400 font-semibold uppercase tracking-wider">Personal Resident Dashboard</p>
          <h2 class="text-2xl font-black text-slate-900 dark:text-white mt-1 truncate">Hello, ${escHtml(displayName)}!</h2>
          <p class="text-[11px] text-slate-500 dark:text-slate-400 truncate">${escHtml(userEmail)}</p>
          <p class="text-xs text-slate-600 dark:text-slate-400 mt-3 leading-relaxed">Track the real-time status of the hazards you personally reported.</p>
          <button onclick="switchTab('submit')" class="mt-5 w-full bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold py-3 px-4 rounded-xl shadow-lg flex items-center justify-center space-x-2 transition cursor-pointer">
            <i data-lucide="camera" class="w-4 h-4"></i>
            <span>Report New Hazard with Photo</span>
          </button>
        </div>

        <!-- Personal Report Summary: tap a box to see those reports -->
        <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-md transition-colors">
          <h4 class="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-3">My Report Summary</h4>
          <div class="grid grid-cols-3 gap-2 text-center">
            <button type="button" onclick="openStatusLightbox('Pending')" class="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 cursor-pointer transition hover:scale-105">
              <div class="text-lg font-black text-amber-600 dark:text-amber-400">${pendingCount}</div>
              <div class="text-[10px] font-semibold text-amber-700 dark:text-amber-300">Pending</div>
            </button>
            <button type="button" onclick="openStatusLightbox('In Progress')" class="p-3 rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/60 cursor-pointer transition hover:scale-105">
              <div class="text-lg font-black text-blue-600 dark:text-blue-400">${inProgressCount}</div>
              <div class="text-[10px] font-semibold text-blue-700 dark:text-blue-300">In Progress</div>
            </button>
            <button type="button" onclick="openStatusLightbox('Resolved')" class="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/60 cursor-pointer transition hover:scale-105">
              <div class="text-lg font-black text-emerald-600 dark:text-emerald-400">${resolvedCount}</div>
              <div class="text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">Resolved</div>
            </button>
          </div>
        </div>
      </div>

      <!-- Right Column: My Submitted Reports -->
      <div class="md:col-span-8 space-y-3">
        <div class="flex justify-between items-center px-1">
          <h3 class="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wide">My Submitted Reports</h3>
          <span class="text-xs text-blue-600 dark:text-blue-400 font-semibold">${myReports.length} Personal Report${myReports.length === 1 ? '' : 's'}</span>
        </div>
        <div class="space-y-3">
          ${myReports.length === 0 ? `
            <div class="text-center py-12 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 space-y-2 shadow-md">
              <p class="text-xs text-slate-400 italic">You haven't submitted any hazard reports yet.</p>
              <button onclick="switchTab('submit')" class="text-xs text-blue-600 dark:text-blue-400 font-bold hover:underline cursor-pointer">Submit your first report →</button>
            </div>
          ` : shown.map(myReportCardHtml).join('')}
        </div>
        <button onclick="switchTab('profile')" class="w-full bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-bold py-3 rounded-xl border border-slate-300 dark:border-slate-700 transition cursor-pointer flex items-center justify-center gap-2">
          <i data-lucide="file-text" class="w-4 h-4"></i>
          <span>Show all my reports</span>
        </button>
      </div>

    </div>
  `;

  if (typeof lucide !== 'undefined') lucide.createIcons();
}

// Screen 2: Submit View
function renderSubmit(container) {
  container.className = "flex-1 overflow-y-auto p-4 md:p-8";
  capturedImageData = null;
  geoSource = null;
  currentGeoCoords = { ...DEFAULT_COORDS };

  container.innerHTML = `
    <form id="report-form" onsubmit="handleFormSubmit(event)" class="space-y-4 md:space-y-0 md:grid md:grid-cols-12 md:gap-6">

      <div class="md:col-span-6 space-y-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-md transition-colors">
        <h2 class="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider">Submit Hazard Report</h2>

        <div>
          <label class="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Report Title</label>
          <input required type="text" id="title" placeholder="e.g. Broken Canal Wall" class="w-full text-xs p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 text-slate-900 dark:text-white focus:border-blue-500 outline-none" />
        </div>

        <div>
          <label class="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Description</label>
          <textarea required id="desc" rows="3" placeholder="Details of the hazard..." class="w-full text-xs p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 text-slate-900 dark:text-white focus:border-blue-500 outline-none"></textarea>
        </div>
      </div>

      <div class="md:col-span-6 space-y-4">
        <div class="border border-slate-200 dark:border-slate-800 rounded-3xl p-5 text-center bg-white dark:bg-slate-900 shadow-md transition-colors">
          <div id="webcam-container" class="hidden mb-3 relative rounded-2xl overflow-hidden bg-black border border-slate-300 dark:border-slate-800">
            <video id="webcam-video" autoplay playsinline class="w-full h-40 object-cover"></video>
            <button type="button" onclick="snapWebcamPhoto()" class="absolute bottom-2 left-1/2 -translate-x-1/2 bg-rose-600 text-white text-xs font-bold px-4 py-1.5 rounded-full shadow">
              📸 Snap Photo
            </button>
          </div>

          <div id="photo-preview-container" class="hidden mb-3">
            <img id="photo-preview" class="w-full h-36 object-cover rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800" />
            <button type="button" onclick="retakePhoto()" class="mt-2 text-xs text-blue-600 dark:text-blue-400 font-semibold underline cursor-pointer">Retake / Change Photo</button>
          </div>

          <div id="camera-controls" class="space-y-2 py-2">
            <div class="flex justify-center space-x-3">
              <button type="button" onclick="startWebcam()" class="bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold px-4 py-2.5 rounded-xl shadow flex items-center space-x-1.5 transition cursor-pointer">
                <i data-lucide="camera" class="w-4 h-4"></i>
                <span>Live Camera</span>
              </button>

              <label class="cursor-pointer bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-semibold px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 flex items-center space-x-1.5 transition">
                <i data-lucide="upload" class="w-4 h-4"></i>
                <span>Upload File</span>
                <input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" onchange="handleImageCapture(event)" class="hidden" />
              </label>
            </div>
          </div>
        </div>

        <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 space-y-2 shadow-md transition-colors">
          <div id="picker-map" class="w-full h-48 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden"></div>
          <p id="geo-status" class="hidden text-[11px] text-amber-700 dark:text-amber-400"></p>
          <div id="geomapped-card" class="hidden"></div>
        </div>

        <button type="submit" id="submit-btn" class="w-full bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold py-3.5 rounded-xl shadow-lg transition cursor-pointer">
          Submit Report to Cloud Database
        </button>
      </div>

    </form>
  `;

  initPickerMap();
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

// Only problems are shown (outside Baguio, no GPS...). A good result is shown by the geomapped card.
function setGeoStatus(message) {
  const el = document.getElementById('geo-status');
  if (!el) return;
  const isWarning = String(message).indexOf('⚠️') === 0;
  el.innerText = isWarning ? message : '';
  el.classList.toggle('hidden', !isWarning);
}

function updatePickerMapPosition() {
  if (pickerMapInstance && pickerMarkerInstance) {
    const newLatLng = [currentGeoCoords.lat, currentGeoCoords.lng];
    pickerMapInstance.setView(newLatLng, 16);
    pickerMarkerInstance.setLatLng(newLatLng);
  }
  refreshGeomappedCard();
}

// A tap or drag on the picker map. Only spots inside Baguio are accepted.
function setManualPin(lat, lng) {
  if (!isInsideBaguio(lat, lng)) {
    setGeoStatus('⚠️ ' + MAP_OUTSIDE_MSG);
    if (pickerMarkerInstance) pickerMarkerInstance.setLatLng([currentGeoCoords.lat, currentGeoCoords.lng]);
    return;
  }
  currentGeoCoords.lat = lat;
  currentGeoCoords.lng = lng;
  geoSource = 'manual';
  if (pickerMarkerInstance) pickerMarkerInstance.setLatLng([lat, lng]);
  setGeoStatus(`Manually Tagged Pin: ${lat.toFixed(5)}° N, ${lng.toFixed(5)}° E`);
  refreshGeomappedCard();
}

function initPickerMap() {
  setTimeout(() => {
    const mapContainer = document.getElementById('picker-map');
    if (!mapContainer) return;

    if (pickerMapInstance) { try { pickerMapInstance.remove(); } catch (e) {} }

    pickerMapInstance = createBaguioMap(mapContainer, { center: currentGeoCoords, zoom: 16 });
    pickerMarkerInstance = L.marker([currentGeoCoords.lat, currentGeoCoords.lng], { draggable: true }).addTo(pickerMapInstance);

    pickerMapInstance.on('click', (e) => setManualPin(e.latlng.lat, e.latlng.lng));
    pickerMarkerInstance.on('dragend', () => {
      const p = pickerMarkerInstance.getLatLng();
      setManualPin(p.lat, p.lng);
    });
  }, 150);
}

// "Geomapped photo" card: the photo + its GPS point + a button that shows the way there
function refreshGeomappedCard() {
  const card = document.getElementById('geomapped-card');
  if (!card) return;

  if (!geoSource) {
    card.classList.add('hidden');
    card.innerHTML = '';
    return;
  }

  const sourceLabel = { photo: 'GPS read from the photo', camera: 'Live camera location', manual: 'Pinned on the map' }[geoSource] || 'Pinned';
  const lat = currentGeoCoords.lat, lng = currentGeoCoords.lng;
  const title = (document.getElementById('title') || {}).value || 'Hazard location';

  card.classList.remove('hidden');
  card.innerHTML = `
    <div class="flex items-center gap-3 p-3 rounded-2xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/30">
      ${capturedImageData ? `<img src="${capturedImageData}" alt="Geomapped photo" class="w-14 h-14 rounded-xl object-cover border border-emerald-200 dark:border-emerald-800 flex-shrink-0" />` : ''}
      <div class="flex-1 min-w-0 text-left">
        <p class="text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">✅ Photo geomapped</p>
        <p class="text-[11px] text-slate-700 dark:text-slate-300">${lat.toFixed(5)}° N, ${lng.toFixed(5)}° E</p>
        <p class="text-[10px] text-slate-500 dark:text-slate-400">${sourceLabel}</p>
      </div>
      <button type="button" onclick="showWayToCurrentPhoto()" class="flex-shrink-0 bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-bold px-3 py-2 rounded-xl shadow cursor-pointer">
        🧭 Show the way
      </button>
    </div>`;
  card.dataset.label = title;
}

function showWayToCurrentPhoto() {
  const card = document.getElementById('geomapped-card');
  const label = (card && card.dataset.label) || 'Hazard location';
  openDirections(currentGeoCoords.lat, currentGeoCoords.lng, label, capturedImageData);
}

// Directions for a report that is already saved (used by the map and the feed)
function openReportDirections(id) {
  const r = reports.find(x => x.id === id);
  if (!r || !hasValidCoords(r)) { alert('This report has no map location.'); return; }
  openDirections(r.lat, r.lng, r.title || r.location || 'Hazard location', r.image);
}

// ==================== CAMERA + PHOTO GEOTAG ====================

// Live Camera: uses the in-page camera where allowed (needs HTTPS), otherwise the phone's camera app
async function startWebcam() {
  if (/Android/i.test(navigator.userAgent) || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    triggerMobileCameraFallback();
    return;
  }

  const webcamContainer = document.getElementById('webcam-container');
  const video = document.getElementById('webcam-video');
  const controls = document.getElementById('camera-controls');

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    video.srcObject = stream;
    webcamContainer.classList.remove('hidden');
    controls.classList.add('hidden');
  } catch (err) {
    triggerMobileCameraFallback();
  }
}

function triggerMobileCameraFallback() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.capture = 'environment';
  input.onchange = (e) => handleImageCapture(e, true); // true = photo was just taken with the camera
  input.click();
}

async function snapWebcamPhoto() {
  const video = document.getElementById('webcam-video');
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth || 640;
  canvas.height = video.videoHeight || 480;

  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const rawData = canvas.toDataURL('image/jpeg');

  try {
    capturedImageData = await compressBase64(rawData);
  } catch (err) {
    alert('Could not process the camera image. Please try again.');
    return;
  }

  stopWebcamStream();
  document.getElementById('webcam-container').classList.add('hidden');
  document.getElementById('photo-preview').src = capturedImageData;
  document.getElementById('photo-preview-container').classList.remove('hidden');

  // A canvas snapshot has no EXIF, so use the phone's position at the moment of capture
  tagFromLiveCamera();
}

function stopWebcamStream() {
  const video = document.getElementById('webcam-video');
  if (video && video.srcObject) {
    video.srcObject.getTracks().forEach(track => track.stop());
    video.srcObject = null;
  }
}

// Device location (GPS). Used for Live Camera photos and the "Use my current location" button.
let lastGeoError = '';

function getDeviceLocationOnce() {
  lastGeoError = '';
  return new Promise((resolve) => {
    if (!window.isSecureContext) {
      lastGeoError = 'page is not HTTPS, so the browser blocks location';
      return resolve(null);
    }
    if (!navigator.geolocation) {
      lastGeoError = 'location is not supported here';
      return resolve(null);
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy
      }),
      (err) => {
        const reasons = { 1: 'permission denied', 2: 'position unavailable', 3: 'timed out' };
        lastGeoError = reasons[err.code] || err.message;
        resolve(null);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  });
}

async function tagFromLiveCamera() {
  setGeoStatus('📡 Getting the location for this live photo...');
  const pos = await getDeviceLocationOnce();

  if (pos && !isInsideBaguio(pos.lat, pos.lng)) {
    geoSource = null;
    refreshGeomappedCard();
    setGeoStatus('⚠️ Your location is outside Baguio City. ' + MAP_OUTSIDE_MSG + ' Tap the map to pin the hazard.');
  } else if (pos) {
    currentGeoCoords = { lat: pos.lat, lng: pos.lng };
    geoSource = 'camera';
    setGeoStatus(`📍 Live camera location: ${pos.lat.toFixed(5)}° N, ${pos.lng.toFixed(5)}° E (accuracy ±${Math.round(pos.accuracy)} m)`);
    updatePickerMapPosition();
  } else {
    geoSource = null;
    setGeoStatus(`⚠️ Could not get the location (${lastGeoError}). Tap the map or drag the pin to the hazard location.`);
  }
}

// One-tap fallback when the uploaded photo has no GPS (the location was stripped)
async function useMyLocation() {
  setGeoStatus('📡 Getting your location...');
  const pos = await getDeviceLocationOnce();

  if (pos && !isInsideBaguio(pos.lat, pos.lng)) {
    setGeoStatus('⚠️ Your current location is outside Baguio City. ' + MAP_OUTSIDE_MSG + ' Tap the map to pin the hazard.');
  } else if (pos) {
    currentGeoCoords = { lat: pos.lat, lng: pos.lng };
    geoSource = 'manual';
    setGeoStatus(`📍 Using your current location: ${pos.lat.toFixed(5)}° N, ${pos.lng.toFixed(5)}° E (accuracy ±${Math.round(pos.accuracy)} m)`);
    updatePickerMapPosition();
  } else {
    setGeoStatus(`⚠️ Could not get your location (${lastGeoError}). Tap the map or drag the pin instead.`);
  }
}

// Convert one ExifReader GPS tag to signed decimal degrees.
// ExifReader's `description` is already decimal degrees (always positive);
// the hemisphere (N/S, E/W) is stored in the separate *Ref tag.
function exifCoordToDecimal(tag, refTag) {
  if (!tag) return null;

  let val = Number(tag.description);

  // Fallback: degrees/minutes/seconds stored as [numerator, denominator] pairs
  if (!isFinite(val) && Array.isArray(tag.value)) {
    const part = (p) => Array.isArray(p) ? p[0] / p[1] : Number(p);
    val = part(tag.value[0]) + part(tag.value[1]) / 60 + part(tag.value[2]) / 3600;
  }
  if (!isFinite(val)) return null;

  let ref = '';
  if (refTag) {
    ref = Array.isArray(refTag.value) ? String(refTag.value[0]) : String(refTag.value || refTag.description || '');
  }
  ref = ref.trim().charAt(0).toUpperCase();

  return (ref === 'S' || ref === 'W') ? -Math.abs(val) : val;
}

function validCoords(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) &&
         Math.abs(lat) <= 90 && Math.abs(lng) <= 180 &&
         !(lat === 0 && lng === 0);
}

// Read GPS coordinates from the photo file's EXIF metadata (NOT the device location).
// Always resolves to { coords: {lat,lng} | null, note: string }.
function readPhotoGps(file) {
  return new Promise((resolve) => {
    if (typeof ExifReader === 'undefined') {
      return resolve({ coords: null, note: 'the EXIF library did not load, check your connection and reload' });
    }

    const r = new FileReader();
    r.onload = (e) => {
      try {
        const buffer = e.target.result;

        // Attempt 1: expanded mode (ExifReader already applies N/S, E/W signs)
        let names = [];
        try {
          const expanded = ExifReader.load(buffer, { expanded: true });
          const g = expanded.gps;
          if (g && validCoords(Number(g.Latitude), Number(g.Longitude))) {
            return resolve({ coords: { lat: Number(g.Latitude), lng: Number(g.Longitude) }, note: '' });
          }
          Object.keys(expanded).forEach(group => {
            if (expanded[group] && typeof expanded[group] === 'object') {
              names = names.concat(Object.keys(expanded[group]));
            }
          });
        } catch (e1) { /* fall through to flat mode */ }

        // Attempt 2: flat mode with manual hemisphere handling
        const tags = ExifReader.load(buffer);
        const lat = exifCoordToDecimal(tags.GPSLatitude, tags.GPSLatitudeRef);
        const lng = exifCoordToDecimal(tags.GPSLongitude, tags.GPSLongitudeRef);
        if (lat !== null && lng !== null && validCoords(lat, lng)) {
          return resolve({ coords: { lat, lng }, note: '' });
        }

        if (!names.length) names = Object.keys(tags);
        return resolve({
          coords: null,
          note: `${file.type || 'unknown type'}, ${Math.round(file.size / 1024)} KB, tags: ${names.slice(0, 12).join(', ') || 'none'}`
        });
      } catch (err) {
        resolve({ coords: null, note: `could not read metadata: ${err.message}` });
      }
    };
    r.onerror = () => resolve({ coords: null, note: 'could not read the file' });
    r.readAsArrayBuffer(file);
  });
}

// Compress the photo for preview / upload (this step strips EXIF, so GPS is read first)
function loadPhotoPreview(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = async function(e) {
      try {
        capturedImageData = await compressBase64(e.target.result);
        document.getElementById('photo-preview').src = capturedImageData;
        document.getElementById('photo-preview-container').classList.remove('hidden');
        document.getElementById('camera-controls').classList.add('hidden');
      } catch (err) {
        alert('This photo format cannot be used in this browser. Please try a JPEG photo.');
      }
      resolve();
    };
    reader.onerror = () => resolve();
    reader.readAsDataURL(file);
  });
}

// Handle Image Capture and EXIF GPS Data Extraction
async function handleImageCapture(event, fromCamera = false) {
  const input = event.target;
  const file = input.files && input.files[0];
  if (!file) return;

  setGeoStatus('🔍 Reading photo location...');

  const previewDone = loadPhotoPreview(file);
  const result = await readPhotoGps(file);

  if (result.coords && !isInsideBaguio(result.coords.lat, result.coords.lng)) {
    geoSource = null;
    refreshGeomappedCard();
    setGeoStatus(`⚠️ This photo's GPS (${result.coords.lat.toFixed(5)}° N, ${result.coords.lng.toFixed(5)}° E) is outside Baguio City. ` +
      `BANTAYO only accepts hazards inside Baguio. Use a photo taken in Baguio, or tap the map to pin the hazard.`);
  } else if (result.coords) {
    currentGeoCoords = result.coords;
    geoSource = 'photo';
    setGeoStatus(`📸 Photo Geotag Extracted: ${result.coords.lat.toFixed(5)}° N, ${result.coords.lng.toFixed(5)}° E`);
    updatePickerMapPosition();
  } else if (fromCamera) {
    // Photo was just taken with the camera but carries no GPS: use the phone's position right now
    await tagFromLiveCamera();
  } else {
    geoSource = null;
    setGeoStatus(
      `⚠️ No GPS found in this photo (${result.note}). The location was removed by the app or photo picker. ` +
      `Tap the map to pin the hazard. ` +
      `Tip: pick the original from My Files > DCIM/Camera, with Location tags turned on in your Camera settings.`
    );
  }

  await previewDone;
  refreshGeomappedCard();

  // Allow picking the same file again
  try { input.value = ''; } catch (e) {}
}

function retakePhoto() {
  capturedImageData = null;
  stopWebcamStream();
  if (geoSource === 'photo' || geoSource === 'camera') {
    geoSource = null;
    setGeoStatus('Upload or snap a photo to read its GPS location, or tap the map to pin the hazard.');
  }
  refreshGeomappedCard();
  document.getElementById('photo-preview-container').classList.add('hidden');
  document.getElementById('webcam-container').classList.add('hidden');
  document.getElementById('camera-controls').classList.remove('hidden');
}

// A report can only be drawn on the map if it has real numeric coordinates
function hasValidCoords(r) {
  if (!r || r.lat === null || r.lat === undefined || r.lat === '' || r.lng === null || r.lng === undefined || r.lng === '') return false;
  return Number.isFinite(Number(r.lat)) && Number.isFinite(Number(r.lng));
}

// Screen 3: Fullscreen Expanding GIS Map View
function renderMap(container) {
  if (!container) return;
  container.className = "flex-1 flex flex-col h-full p-4 overflow-hidden";

  const mappable = reports.filter(r => hasValidCoords(r) && isInsideBaguio(r.lat, r.lng));

  container.innerHTML = `
    <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 flex flex-col h-full shadow-md transition-colors">
      <div class="flex justify-between items-center mb-4 pb-3 border-b border-slate-200 dark:border-slate-800 flex-shrink-0">
        <div>
          <h2 class="text-xs md:text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider">Barangay Hazard Map</h2>
          <p class="text-[10px] text-slate-500 dark:text-slate-400">Baguio City only. Tap a pin, then "Show the way" for directions.</p>
        </div>
        <span class="text-[10px] bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-800 px-2.5 py-1 rounded-xl font-bold">${mappable.length} Active Pins</span>
      </div>
      <div id="map" class="w-full flex-1 min-h-[300px] rounded-2xl shadow-inner border border-slate-200 dark:border-slate-800 z-10"></div>
    </div>
  `;

  setTimeout(() => {
    const mapEl = document.getElementById('map');
    if (!mapEl) return;

    if (hazardMapInstance) {
      try { hazardMapInstance.remove(); } catch (e) {}
      hazardMapInstance = null;
    }

    const map = createBaguioMap(mapEl, { center: DEFAULT_COORDS, zoom: 15 });
    hazardMapInstance = map;

    const points = [];
    mappable.forEach(r => {
      // One bad report must never stop the rest of the pins from drawing
      try {
        const lat = Number(r.lat);
        const lng = Number(r.lng);
        const popupContent = `
          <div style="width: 180px; color: #0f172a; font-family: sans-serif;">
            <img src="${escHtml(r.image)}" style="width: 100%; height: 90px; object-fit: cover; border-radius: 6px; margin-bottom: 4px;" />
            <strong style="font-size: 12px; color: #1e3a8a;">${escHtml(r.title)}</strong>
            <p style="font-size: 10px; margin: 2px 0; color: #4b5563;">📍 ${escHtml(r.location)}</p>
            <span style="font-size: 9px; background: #dbeafe; color: #1e40af; padding: 2px 6px; border-radius: 4px; font-weight: bold;">Status: ${escHtml(r.status)}</span>
            <button onclick="openReportDirections('${escHtml(r.id)}')" style="display:block;width:100%;margin-top:6px;background:#2563eb;color:#fff;border:0;border-radius:8px;padding:6px 0;font-size:11px;font-weight:bold;cursor:pointer;">🧭 Show the way</button>
          </div>
        `;
        L.marker([lat, lng]).addTo(map).bindPopup(popupContent);
        points.push([lat, lng]);
      } catch (err) {
        console.warn('Skipped a report that could not be drawn:', r.id, err);
      }
    });

    // Zoom to where the reports actually are
    if (points.length) map.fitBounds(points, { padding: [40, 40], maxZoom: 17 });

    map.invalidateSize();
    setTimeout(() => map.invalidateSize(), 300);
  }, 150);
}

// ==================== NOTIFICATIONS ====================
// Two kinds: barangay announcements, and resolved hazards.
// A resolved hazard reads "Your report has been resolved" for the person who reported it,
// and "A hazard has been resolved" for everybody else.
function tsMillis(ts) {
  if (!ts) return 0;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (ts.seconds) return ts.seconds * 1000;
  return 0;
}

function buildNotifications() {
  const user = firebase.auth().currentUser;
  const items = [];

  announcements.forEach(a => {
    items.push({
      id: 'ann:' + a.id,
      type: 'announcement',
      title: a.title || 'Barangay announcement',
      message: a.message || '',
      time: tsMillis(a.createdAt)
    });
  });

  reports.filter(r => r.status === 'Resolved').forEach(r => {
    const time = tsMillis(r.resolvedAt) || tsMillis(r.createdAt);
    const mine = !!user && (r.userId === user.uid || r.userEmail === user.email);
    items.push({
      id: 'res:' + r.id + ':' + Math.floor(time / 1000),
      type: mine ? 'resolved-mine' : 'resolved',
      title: mine ? 'Your report has been resolved' : 'A hazard has been resolved',
      message: mine
        ? `The barangay marked your report "${r.title || 'Hazard'}" as resolved.`
        : `The barangay resolved a reported hazard${r.title ? ': "' + r.title + '"' : ''}.`,
      time: time
    });
  });

  notices.forEach(n => {
    items.push({
      id: 'del:' + n.id,
      type: 'deleted',
      title: 'Your report was removed',
      message: `The barangay removed your report "${n.reportTitle || 'Hazard'}". Reason: ${n.reason || 'No reason given.'}`,
      time: tsMillis(n.createdAt)
    });
  });

  items.sort((x, y) => y.time - x.time);
  return items;
}

// Which notifications this person has already read (kept on this device, per account)
function readStorageKey() {
  const u = firebase.auth().currentUser;
  return 'bantayo-read-' + (u ? u.uid : 'guest');
}
function getReadSet() {
  try { return new Set(JSON.parse(localStorage.getItem(readStorageKey()) || '[]')); }
  catch (e) { return new Set(); }
}
function saveReadSet(set) {
  try { localStorage.setItem(readStorageKey(), JSON.stringify(Array.from(set).slice(-500))); } catch (e) {}
}

function updateNotifBadge() {
  const badge = document.getElementById('notif-badge');
  if (!badge) return;
  const read = getReadSet();
  const unread = buildNotifications().filter(n => !read.has(n.id)).length;
  badge.innerText = unread > 99 ? '99+' : String(unread);
  badge.classList.toggle('hidden', unread === 0);
}

function markNotificationRead(id) {
  const read = getReadSet();
  if (read.has(id)) return;
  read.add(id);
  saveReadSet(read);
  updateNotifBadge();
  if (currentTab === 'reports') renderReports(document.getElementById('app-content'));
}

function markAllNotificationsRead() {
  const read = getReadSet();
  buildNotifications().forEach(n => read.add(n.id));
  saveReadSet(read);
  updateNotifBadge();
  if (currentTab === 'reports') renderReports(document.getElementById('app-content'));
}

function notificationHtml(n, isRead) {
  const meta = {
    'announcement': { icon: 'megaphone', label: 'Barangay Announcement', tone: 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/60 border-blue-200 dark:border-blue-900/70' },
    'resolved-mine': { icon: 'check-circle-2', label: 'Your Report', tone: 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 border-emerald-200 dark:border-emerald-900/70' },
    'deleted': { icon: 'trash-2', label: 'Report Removed', tone: 'text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/60 border-rose-200 dark:border-rose-900/70' },
    'resolved': { icon: 'shield-check', label: 'Hazard Resolved', tone: 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 border-emerald-200 dark:border-emerald-900/70' }
  }[n.type];

  const when = n.time
    ? new Date(n.time).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : '';

  return `
    <div onclick="markNotificationRead('${escHtml(n.id)}')"
         class="flex items-start gap-3 p-4 rounded-2xl border transition ${isRead
           ? 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 opacity-70'
           : 'bg-white dark:bg-slate-900 border-blue-300 dark:border-blue-800 border-l-4 border-l-blue-500 shadow-md cursor-pointer'}">
      <div class="w-9 h-9 rounded-xl border flex items-center justify-center flex-shrink-0 ${meta.tone}">
        <i data-lucide="${meta.icon}" class="w-4 h-4"></i>
      </div>
      <div class="flex-1 min-w-0">
        <div class="flex items-start justify-between gap-2">
          <p class="text-xs ${isRead ? 'font-semibold' : 'font-extrabold'} text-slate-900 dark:text-white">${escHtml(n.title)}</p>
          ${isRead
            ? '<span class="text-[9px] font-semibold text-slate-400 flex-shrink-0">✓ Read</span>'
            : '<span class="text-[9px] font-bold text-white bg-blue-600 px-2 py-0.5 rounded-full flex-shrink-0">NEW</span>'}
        </div>
        <p class="text-[11px] text-slate-600 dark:text-slate-300 mt-1 leading-relaxed">${escHtml(n.message)}</p>
        <p class="text-[10px] text-slate-400 mt-1.5">${escHtml(meta.label)}${when ? ' · ' + escHtml(when) : ''}</p>
      </div>
    </div>`;
}

// Screen 4: Notifications
function renderReports(container) {
  if (!container) return;
  container.className = "flex-1 overflow-y-auto p-4 md:p-8";

  const items = buildNotifications();
  const read = getReadSet();
  const unread = items.filter(n => !read.has(n.id)).length;

  container.innerHTML = `
    <div class="space-y-4 max-w-3xl mx-auto w-full">
      <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-md transition-colors">
        <div class="flex items-center justify-between gap-3 mb-4 pb-3 border-b border-slate-200 dark:border-slate-800">
          <div>
            <h2 class="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider">Notifications</h2>
            <p class="text-[10px] text-slate-500 dark:text-slate-400">${unread} unread · ${items.length} total</p>
          </div>
          ${unread > 0 ? `<button onclick="markAllNotificationsRead()" class="text-[11px] font-bold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer">Mark all as read</button>` : ''}
        </div>
        <div class="space-y-3">
          ${items.length === 0
            ? '<p class="text-xs text-slate-500 text-center py-12 italic">No notifications yet.</p>'
            : items.map(n => notificationHtml(n, read.has(n.id))).join('')}
        </div>
      </div>
    </div>
  `;

  if (typeof lucide !== 'undefined') lucide.createIcons();
}

// Screen 5: Profile View
function renderProfile(container) {
  if (typeof window.renderProfileView === 'function') {
    window.renderProfileView();
  }
}

// Form Submission: Saves directly to Firebase Cloud Firestore with user ID tagging
async function handleFormSubmit(e) {
  e.preventDefault();

  const user = firebase.auth().currentUser;
  if (!user) {
    alert('You must be signed in to submit a report.');
    window.location.href = 'login.html';
    return;
  }
  
  if (!geoSource) {
    alert('Please set the location: use a photo that has GPS data, tap "Use my current location", or tap the map to pin it.');
    return;
  }

  if (!isInsideBaguio(currentGeoCoords.lat, currentGeoCoords.lng)) {
    alert(MAP_OUTSIDE_MSG);
    return;
  }

  const submitBtn = document.getElementById('submit-btn');
  submitBtn.disabled = true;
  submitBtn.innerText = "Saving to Cloud Database...";

  const fallbackImg = "https://images.unsplash.com/photo-1544620347-c4fd4a3d5957?auto=format&fit=crop&w=400&q=80";
  
  const newReport = {
    userId: user.uid,
    userEmail: user.email,
    userName: getDisplayName(user),
    title: document.getElementById('title').value,
    category: 'Hazard',
    location: `${currentGeoCoords.lat.toFixed(5)}° N, ${currentGeoCoords.lng.toFixed(5)}° E`,
    lat: currentGeoCoords.lat,
    lng: currentGeoCoords.lng,
    geoSource: geoSource, // 'photo' | 'camera' | 'manual'
    status: "Pending",
    date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    description: document.getElementById('desc').value,
    image: capturedImageData || fallbackImg
  };

  try {
    await db.collection("hazard_reports").add(newReport);
    alert('Hazard Report successfully saved to Central Cloud Database!');
    switchTab('map');
  } catch (error) {
    console.error("Cloud database save failed:", error);
    alert("Failed to submit report. Please verify your internet connection or Firebase setup.");
    submitBtn.disabled = false;
    submitBtn.innerText = "Submit Report to Cloud Database";
  }
}

function toggleRole() {
  currentRole = currentRole === 'resident' ? 'official' : 'resident';
  const roleBadge = document.getElementById('role-badge');
  if (roleBadge) roleBadge.innerText = currentRole === 'official' ? 'Official Portal' : 'Resident';
  switchTab('home');
}