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

let reports = [];
let myReports = [];
let currentTab = 'home';

// Initialize Application & Real-time Database Listener
document.addEventListener('DOMContentLoaded', () => {
  registerServiceWorker();
  listenPWAInstall();
  listenOnlineStatus();
  initCloudReportsSync();
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

// Real-Time Cloud Synchronization Function
function initCloudReportsSync() {
  db.collection("hazard_reports").orderBy("createdAt", "desc").onSnapshot((snapshot) => {
    reports = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    filterPersonalReports();
    
    const content = document.getElementById('app-content');
    const activeTab = currentTab;
    if (activeTab === 'home') renderHome(content);
    else if (activeTab === 'map') renderMap(content);
    else if (activeTab === 'reports') renderReports(content);
  }, (error) => {
    console.warn("Firestore listener fallback / offline mode active:", error);
  });
}

// Re-sync personal reports immediately once Firebase Auth resolves the user
firebase.auth().onAuthStateChanged((user) => {
  if (user) {
    filterPersonalReports();
    const content = document.getElementById('app-content');
    const activeTab = currentTab;
    if (content && (!activeTab || activeTab === 'home')) {
      renderHome(content);
    }
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
  const update = () => {
    navigator.onLine ? banner.classList.add('hidden') : banner.classList.remove('hidden');
    if (currentTab === 'home') renderHome(document.getElementById('app-content'));
  };
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  update();
}

// Navigation Tab Switcher
function switchTab(tab) {
  const content = document.getElementById('app-content');
  stopWebcamStream();

  currentTab = tab;
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('nav-active', btn.dataset.tab === tab);
  });
  if (typeof closeNav === 'function') closeNav();

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

// ---------- Resident dashboard helpers ----------
function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function reportDate(r) {
  try {
    const d = r.createdAt && r.createdAt.toDate ? r.createdAt.toDate() : (r.createdAt ? new Date(r.createdAt) : null);
    return d && !isNaN(d) ? d : null;
  } catch (e) { return null; }
}

function fmtReportDate(r) {
  const d = reportDate(r);
  if (!d) return 'Just now';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + ' • ' +
         d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function timeAgo(r) {
  const d = reportDate(r);
  if (!d) return 'just now';
  const m = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm ago';
  const h = Math.round(m / 60);
  if (h < 24) return h + 'h ago';
  return Math.round(h / 24) + 'd ago';
}

function statusChip(status) {
  const s = status || 'Pending';
  const cls = s === 'Pending' ? 'chip-pending' : s === 'In Progress' ? 'chip-progress' : 'chip-resolved';
  return `<span class="chip ${cls}">${escHtml(s)}</span>`;
}

// Screen 1: Personalized Resident Home Dashboard
function renderHome(container) {
  if (!container) return;
  container.className = "flex-1 overflow-y-auto p-4 md:p-6";

  filterPersonalReports();

  const user = firebase.auth().currentUser;
  const displayName = getDisplayName(user);

  const pendingCount = myReports.filter(r => (r.status || 'Pending') === 'Pending').length;
  const inProgressCount = myReports.filter(r => r.status === 'In Progress').length;
  const resolvedCount = myReports.filter(r => r.status === 'Resolved').length;

  const recent = myReports.slice(0, 3);
  // Alerts = the newest unresolved reports from the whole community (real data)
  const alerts = reports.filter(r => (r.status || 'Pending') !== 'Resolved').slice(0, 3);
  const online = navigator.onLine;

  container.innerHTML = `
    <div class="dash max-w-6xl mx-auto w-full space-y-4 md:space-y-5">

      <!-- Hero -->
      <section class="hero">
        <svg class="hero-art" viewBox="0 0 800 260" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
          <defs>
            <linearGradient id="hg-sky" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stop-color="#2a1f6b"/><stop offset=".55" stop-color="#6b4fc9"/><stop offset="1" stop-color="#a587e8"/>
            </linearGradient>
            <linearGradient id="hg-m1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3b2d8a"/><stop offset="1" stop-color="#1b1450"/></linearGradient>
            <linearGradient id="hg-m2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#241a66"/><stop offset="1" stop-color="#0e0a33"/></linearGradient>
          </defs>
          <rect width="800" height="260" fill="url(#hg-sky)"/>
          <ellipse cx="560" cy="140" rx="260" ry="38" fill="#c9b6ff" opacity=".18"/>
          <path d="M0 190 L120 120 L190 160 L300 70 L420 165 L520 105 L640 175 L760 120 L800 150 L800 260 L0 260Z" fill="url(#hg-m1)"/>
          <path d="M0 225 L90 180 L200 215 L330 165 L470 220 L600 185 L720 220 L800 195 L800 260 L0 260Z" fill="url(#hg-m2)"/>
          <g fill="#0a0726" opacity=".9">
            <path d="M40 260 L52 215 L64 260Z"/><path d="M70 260 L84 200 L98 260Z"/><path d="M110 260 L120 222 L130 260Z"/>
            <path d="M700 260 L714 205 L728 260Z"/><path d="M735 260 L746 218 L757 260Z"/><path d="M768 260 L782 200 L796 260Z"/>
          </g>
          <g fill="#ffd98a" opacity=".85">
            <rect x="380" y="228" width="3" height="3"/><rect x="396" y="222" width="3" height="3"/><rect x="412" y="232" width="3" height="3"/>
            <rect x="430" y="226" width="3" height="3"/><rect x="448" y="234" width="3" height="3"/><rect x="466" y="224" width="3" height="3"/>
            <rect x="486" y="230" width="3" height="3"/><rect x="505" y="236" width="3" height="3"/>
          </g>
        </svg>
        <div class="hero-shade"></div>
        <div class="hero-text">
          <h2 class="hero-title">Hello, ${escHtml(displayName)}!</h2>
          <p class="hero-sub">Stay informed. Stay prepared.</p>
          <span class="hero-bar"></span>
        </div>
        <svg class="hero-shield" viewBox="0 0 100 116" aria-hidden="true">
          <defs><linearGradient id="hg-sh" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8f7dff"/><stop offset="1" stop-color="#4b3bd6"/></linearGradient></defs>
          <path d="M50 4 L92 20 V58 C92 84 74 102 50 112 C26 102 8 84 8 58 V20Z" fill="url(#hg-sh)" fill-opacity=".45" stroke="#b3a6ff" stroke-width="4" stroke-linejoin="round"/>
          <path d="M30 58 L45 73 L72 42" fill="none" stroke="#e9e4ff" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </section>

      <!-- Quick actions -->
      <section class="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <button onclick="switchTab('submit')" class="qa qa-primary"><i data-lucide="megaphone" class="w-5 h-5"></i><span>Report Hazard</span><i data-lucide="arrow-right" class="w-4 h-4 ml-auto"></i></button>
        <button onclick="switchTab('map')" class="qa"><i data-lucide="map-pin" class="w-5 h-5"></i><span>View Map</span><i data-lucide="arrow-right" class="w-4 h-4 ml-auto"></i></button>
        <button onclick="switchTab('reports')" class="qa"><i data-lucide="file-text" class="w-5 h-5"></i><span>My Reports</span><i data-lucide="arrow-right" class="w-4 h-4 ml-auto"></i></button>
      </section>

      <!-- Stat cards -->
      <section class="grid grid-cols-3 gap-2 sm:gap-3">
        <div class="stat stat-warn">
          <div class="stat-ico"><i data-lucide="alert-triangle" class="w-5 h-5 sm:w-7 sm:h-7"></i></div>
          <div><div class="stat-num">${pendingCount}</div><div class="stat-lbl">Active Hazard</div></div>
          <svg class="spark" viewBox="0 0 100 30" preserveAspectRatio="none"><path d="M0 26 C15 28 20 12 35 18 S60 26 72 12 S90 6 100 2" fill="none" stroke="#f5b73b" stroke-width="2.5" stroke-linecap="round"/></svg>
        </div>
        <div class="stat stat-prog">
          <div class="stat-ico"><i data-lucide="check" class="w-5 h-5 sm:w-7 sm:h-7"></i></div>
          <div><div class="stat-num">${inProgressCount}</div><div class="stat-lbl">In Progress</div></div>
          <svg class="spark" viewBox="0 0 100 30" preserveAspectRatio="none"><path d="M0 24 C15 26 25 10 40 16 S65 28 78 14 S92 8 100 4" fill="none" stroke="#2fd08a" stroke-width="2.5" stroke-linecap="round"/></svg>
        </div>
        <div class="stat stat-done">
          <div class="stat-ico"><i data-lucide="check-circle-2" class="w-5 h-5 sm:w-7 sm:h-7"></i></div>
          <div><div class="stat-num">${resolvedCount}</div><div class="stat-lbl">Resolved</div></div>
          <svg class="spark" viewBox="0 0 100 30" preserveAspectRatio="none"><path d="M0 26 C18 24 24 14 40 20 S66 24 80 10 S94 8 100 3" fill="none" stroke="#8b7cff" stroke-width="2.5" stroke-linecap="round"/></svg>
        </div>
      </section>

      <!-- Recent reports + Alerts -->
      <section class="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div class="panel lg:col-span-3">
          <div class="panel-head">
            <div class="flex items-center gap-2"><i data-lucide="clock" class="w-5 h-5 text-indigo-300"></i><h3>Recent Reports</h3></div>
            <button onclick="switchTab('reports')" class="link-btn">View All <i data-lucide="arrow-right" class="w-4 h-4"></i></button>
          </div>
          ${recent.length === 0 ? `
            <div class="empty">
              <p>You haven't submitted any hazard reports yet.</p>
              <button onclick="switchTab('submit')" class="link-btn">Submit your first report <i data-lucide="arrow-right" class="w-4 h-4"></i></button>
            </div>` : recent.map(r => `
            <div class="rep">
              <img src="${r.image}" alt="Hazard photo" />
              <div class="min-w-0 flex-1">
                <p class="rep-title">${escHtml(r.title)}</p>
                <div class="mt-1">${statusChip(r.status)}</div>
                <p class="rep-meta">📍 ${escHtml(r.location)}</p>
                <p class="rep-meta">${escHtml(fmtReportDate(r))}</p>
              </div>
              <i data-lucide="chevron-right" class="w-5 h-5 text-indigo-300 flex-shrink-0"></i>
            </div>`).join('')}
        </div>

        <div id="alerts-panel" class="panel lg:col-span-2">
          <div class="panel-head">
            <div class="flex items-center gap-2"><i data-lucide="megaphone" class="w-5 h-5 text-indigo-300"></i><h3>Alerts</h3>${alerts.length ? `<span class="badge">${alerts.length}</span>` : ''}</div>
          </div>
          ${alerts.length === 0 ? `<div class="empty"><p>No active hazards in the community right now.</p></div>` : alerts.map(r => `
            <div class="alert-row">
              <div class="alert-ico ${(r.status || 'Pending') === 'Pending' ? 'alert-red' : 'alert-blue'}"><i data-lucide="${(r.status || 'Pending') === 'Pending' ? 'alert-circle' : 'info'}" class="w-4 h-4"></i></div>
              <div class="min-w-0 flex-1">
                <div class="flex justify-between gap-2"><p class="alert-title truncate">${escHtml(r.title)}</p><span class="alert-time">${timeAgo(r)}</span></div>
                <p class="alert-desc">${escHtml(r.status || 'Pending')} • ${escHtml(r.location)}</p>
              </div>
            </div>`).join('')}
        </div>
      </section>

      <!-- System status -->
      <section class="panel status-bar">
        <div class="flex items-center gap-3">
          <svg viewBox="0 0 40 46" class="w-9 h-10 flex-shrink-0" aria-hidden="true"><path d="M20 2 L37 8 V22 C37 33 30 40 20 44 C10 40 3 33 3 22V8Z" fill="#1f9d63" stroke="#5be3a3" stroke-width="2.5" stroke-linejoin="round"/><path d="M12 22 L18 28 L29 15" fill="none" stroke="#eafff4" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <div>
            <p class="status-lbl">System Status</p>
            <p class="status-val ${online ? 'is-on' : 'is-off'}"><span class="dot"></span>${online ? 'Online' : 'Offline'}</p>
          </div>
        </div>
        <div class="status-sep"></div>
        <div class="flex items-center gap-3">
          <i data-lucide="clock" class="w-6 h-6 text-indigo-300 flex-shrink-0"></i>
          <div>
            <p class="status-lbl">Last Updated</p>
            <p class="status-time">${escHtml(new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }))} • ${escHtml(new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }))}</p>
          </div>
        </div>
      </section>
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
          <label class="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Incident Category</label>
          <select required id="cat" class="w-full text-xs p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 text-slate-900 dark:text-white focus:border-blue-500 outline-none">
            <option>Road & Drainage</option>
            <option>Landslide Risk</option>
            <option>Infrastructure / Streetlight</option>
            <option>Uncollected Debris</option>
          </select>
        </div>

        <div>
          <label class="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Report Title</label>
          <input required type="text" id="title" placeholder="e.g. Broken Canal Wall" class="w-full text-xs p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 text-slate-900 dark:text-white focus:border-blue-500 outline-none" />
        </div>

        <div>
          <label class="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Location Address / Landmark</label>
          <input required type="text" id="loc" placeholder="e.g. Purok 3 near Bayan Park" class="w-full text-xs p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 text-slate-900 dark:text-white focus:border-blue-500 outline-none" />
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
            <div class="flex flex-wrap justify-center gap-2">
              <button type="button" onclick="startWebcam()" class="bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold px-4 py-2.5 rounded-xl shadow flex items-center space-x-1.5 transition cursor-pointer">
                <i data-lucide="camera" class="w-4 h-4"></i>
                <span>Live Camera</span>
              </button>

              <label class="cursor-pointer bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-semibold px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 flex items-center space-x-1.5 transition">
                <i data-lucide="upload" class="w-4 h-4"></i>
                <span>Upload File</span>
                <input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" onchange="handleImageCapture(event)" class="hidden" />
              </label>

              <!-- Android: opens the system file browser instead of the photo picker, which can remove GPS -->
              <label id="browse-files-btn" class="hidden cursor-pointer bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-semibold px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 flex items-center space-x-1.5 transition">
                <i data-lucide="folder-open" class="w-4 h-4"></i>
                <span>Browse Files</span>
                <input type="file" accept="*/*" onchange="handleImageCapture(event)" class="hidden" />
              </label>
            </div>
            <p id="android-hint" class="hidden text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed">📱 Android: to keep the photo's GPS location, tap <b>Browse Files</b> and pick the photo from Internal storage › DCIM › Camera.</p>
          </div>
        </div>

        <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 space-y-2 shadow-md transition-colors">
          <div class="flex justify-between items-center">
            <span class="text-xs font-bold text-blue-600 dark:text-blue-400 flex items-center gap-1">
              <i data-lucide="navigation" class="w-3.5 h-3.5"></i> GIS Geotag Status
            </span>
            <span class="text-[10px] text-slate-500 dark:text-slate-400">From photo GPS or map pin</span>
          </div>
          <p id="geo-status" class="text-[11px] text-slate-600 dark:text-slate-400">Upload or snap a photo to read its GPS location, or tap the map to pin the hazard.</p>
          <button type="button" onclick="useMyLocation()" class="w-full bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-semibold py-2 rounded-xl border border-slate-300 dark:border-slate-700 transition cursor-pointer">
            📍 Use my current location
          </button>
          <div id="picker-map" class="w-full h-32 rounded-2xl border border-slate-200 dark:border-slate-800"></div>
        </div>

        <button type="submit" id="submit-btn" class="w-full bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold py-3.5 rounded-xl shadow-lg transition cursor-pointer">
          Submit Report to Cloud Database
        </button>
      </div>

    </form>
  `;

  if (/Android/i.test(navigator.userAgent)) {
    ['browse-files-btn', 'android-hint'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.remove('hidden');
    });
  }

  initPickerMap();
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function setGeoStatus(message) {
  const el = document.getElementById('geo-status');
  if (el) el.innerText = message;
}

function updatePickerMapPosition() {
  if (pickerMapInstance && pickerMarkerInstance) {
    const newLatLng = [currentGeoCoords.lat, currentGeoCoords.lng];
    pickerMapInstance.setView(newLatLng, 16);
    pickerMarkerInstance.setLatLng(newLatLng);
  }
}

function initPickerMap() {
  setTimeout(() => {
    const mapContainer = document.getElementById('picker-map');
    if (!mapContainer) return;
    
    if (pickerMapInstance) pickerMapInstance.remove();

    pickerMapInstance = L.map('picker-map').setView([currentGeoCoords.lat, currentGeoCoords.lng], 16);
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(pickerMapInstance);

    pickerMarkerInstance = L.marker([currentGeoCoords.lat, currentGeoCoords.lng], { draggable: true }).addTo(pickerMapInstance);

    setTimeout(() => pickerMapInstance && pickerMapInstance.invalidateSize(), 300);

    pickerMapInstance.on('click', (e) => {
      currentGeoCoords.lat = e.latlng.lat;
      currentGeoCoords.lng = e.latlng.lng;
      geoSource = 'manual';
      pickerMarkerInstance.setLatLng(e.latlng);
      setGeoStatus(`Manually Tagged Pin: ${currentGeoCoords.lat.toFixed(5)}° N, ${currentGeoCoords.lng.toFixed(5)}° E`);
    });

    pickerMarkerInstance.on('dragend', () => {
      const position = pickerMarkerInstance.getLatLng();
      currentGeoCoords.lat = position.lat;
      currentGeoCoords.lng = position.lng;
      geoSource = 'manual';
      setGeoStatus(`Manually Tagged Pin: ${currentGeoCoords.lat.toFixed(5)}° N, ${currentGeoCoords.lng.toFixed(5)}° E`);
    });
  }, 150);
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
  let input = document.getElementById('camera-capture-input');
  if (!input) {
    input = document.createElement('input');
    input.type = 'file';
    input.id = 'camera-capture-input';
    input.accept = 'image/*';
    input.setAttribute('capture', 'environment');
    input.style.display = 'none';
    // true = photo was just taken with the camera
    input.addEventListener('change', (e) => handleImageCapture(e, true));
    document.body.appendChild(input);   // must stay in the page, or Android can drop the result
  }
  input.value = '';
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

  if (pos) {
    currentGeoCoords = { lat: pos.lat, lng: pos.lng };
    geoSource = 'camera';
    setGeoStatus(`📍 Live camera location: ${pos.lat.toFixed(5)}° N, ${pos.lng.toFixed(5)}° E (accuracy ±${Math.round(pos.accuracy)} m)`);
    updatePickerMapPosition();
  } else {
    geoSource = null;
    setGeoStatus(`⚠️ Could not get the location (${lastGeoError}). Tap "Use my current location", or tap the map or drag the pin to the hazard location.`);
  }
}

// One-tap fallback when the uploaded photo has no GPS (the location was stripped)
async function useMyLocation() {
  setGeoStatus('📡 Getting your location...');
  const pos = await getDeviceLocationOnce();

  if (pos) {
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
        const everyTag = names.concat(Object.keys(tags));
        const cameraTags = ['Make', 'Model', 'DateTimeOriginal', 'DateTime', 'ExposureTime', 'FNumber', 'ISOSpeedRatings', 'FocalLength'];
        return resolve({
          coords: null,
          hadExif: everyTag.some(n => cameraTags.includes(n)),
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

  const looksLikeImage = /^image\//.test(file.type) || /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name || '');
  if (!looksLikeImage) {
    alert('Please choose a photo (JPG, PNG, WebP or HEIC).');
    try { input.value = ''; } catch (e) {}
    return;
  }

  setGeoStatus('🔍 Reading photo location...');

  const previewDone = loadPhotoPreview(file);
  const result = await readPhotoGps(file);

  if (result.coords) {
    currentGeoCoords = result.coords;
    geoSource = 'photo';
    setGeoStatus(`📸 Photo Geotag Extracted: ${result.coords.lat.toFixed(5)}° N, ${result.coords.lng.toFixed(5)}° E`);
    updatePickerMapPosition();
  } else if (fromCamera) {
    // Photo was just taken with the camera but carries no GPS: use the phone's position right now
    await tagFromLiveCamera();
  } else {
    geoSource = null;
    const onAndroid = /Android/i.test(navigator.userAgent);
    let why;
    if (result.hadExif) {
      why = onAndroid
        ? `The camera details are there but the GPS is not, so your phone's photo picker removed the location. Tap "Browse Files" and pick this photo from Internal storage > DCIM > Camera.`
        : `The camera details are there but the GPS is not, so the location was removed or was never recorded (check that Location tags are on in your Camera settings).`;
    } else {
      why = `This file has no camera data at all. It may be a screenshot, a download, or a copy sent through a chat app. Use the original photo from DCIM/Camera.`;
    }
    setGeoStatus(`⚠️ No GPS found. ${why} Or tap "Use my current location", or tap the map to pin the hazard. (${result.note})`);
  }

  await previewDone;

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

  const mappable = reports.filter(hasValidCoords);

  container.innerHTML = `
    <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 flex flex-col h-full shadow-md transition-colors">
      <div class="flex justify-between items-center mb-4 pb-3 border-b border-slate-200 dark:border-slate-800 flex-shrink-0">
        <div>
          <h2 class="text-xs md:text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider">Barangay GIS Hazard Map</h2>
          <p class="text-[10px] text-slate-500 dark:text-slate-400">Real-time spatial visualization of community reports.</p>
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

    const map = L.map('map').setView([DEFAULT_COORDS.lat, DEFAULT_COORDS.lng], 15);
    hazardMapInstance = map;

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    const points = [];
    mappable.forEach(r => {
      // One bad report must never stop the rest of the pins from drawing
      try {
        const lat = Number(r.lat);
        const lng = Number(r.lng);
        const popupContent = `
          <div style="width: 180px; color: #0f172a; font-family: sans-serif;">
            <img src="${r.image}" style="width: 100%; height: 90px; object-fit: cover; border-radius: 6px; margin-bottom: 4px;" />
            <strong style="font-size: 12px; color: #1e3a8a;">${r.title}</strong>
            <p style="font-size: 10px; margin: 2px 0; color: #4b5563;">📍 ${r.location}</p>
            <span style="font-size: 9px; background: #dbeafe; color: #1e40af; padding: 2px 6px; border-radius: 4px; font-weight: bold;">Status: ${r.status}</span>
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

// Screen 4: Central Incident Feed View
function renderReports(container) {
  container.className = "flex-1 overflow-y-auto p-4 md:p-8";
  container.innerHTML = `
    <div class="space-y-4 max-w-5xl mx-auto w-full">
      <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-md transition-colors">
        <h2 class="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider mb-4 pb-3 border-b border-slate-200 dark:border-slate-800">Community Reports Feed</h2>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          ${reports.length === 0 ? '<p class="text-xs text-slate-500 text-center py-12 col-span-2 italic">No reports submitted yet.</p>' : reports.map(r => `
            <div class="p-4 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl space-y-3 shadow-sm transition-colors">
              <div class="flex justify-between items-start">
                <span class="text-[10px] font-bold text-blue-700 dark:text-blue-400 uppercase bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 px-2 py-0.5 rounded-md">${r.category || 'Hazard'}</span>
                <span class="text-[10px] font-semibold px-2.5 py-0.5 rounded-md border ${r.status === 'Pending' ? 'bg-rose-50 dark:bg-rose-950/80 text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-800' : r.status === 'In Progress' ? 'bg-amber-50 dark:bg-amber-950/80 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800' : 'bg-emerald-50 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800'}">${r.status}</span>
              </div>
              <img src="${r.image}" class="w-full h-40 object-cover rounded-xl border border-slate-200 dark:border-slate-800" alt="Report Attachment" />
              <p class="text-xs font-bold text-slate-900 dark:text-white">${r.title}</p>
              <p class="text-[11px] text-slate-600 dark:text-slate-300">${r.description}</p>
              <div class="flex justify-between text-[10px] text-slate-500 pt-2 border-t border-slate-200 dark:border-slate-900">
                <span>📍 ${r.location}</span>
                <span>GPS: ${hasValidCoords(r) ? Number(r.lat).toFixed(3) + ', ' + Number(r.lng).toFixed(3) : 'not set'}</span>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;
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

  const submitBtn = document.getElementById('submit-btn');
  submitBtn.disabled = true;
  submitBtn.innerText = "Saving to Cloud Database...";

  const fallbackImg = "https://images.unsplash.com/photo-1544620347-c4fd4a3d5957?auto=format&fit=crop&w=400&q=80";
  
  const newReport = {
    userId: user.uid,
    userEmail: user.email,
    userName: getDisplayName(user),
    title: document.getElementById('title').value,
    category: document.getElementById('cat').value,
    location: document.getElementById('loc').value,
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