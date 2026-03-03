const API_BASE = '';

function esc(str) {
  if (str == null) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function escAttr(str) {
  if (str == null) return '';
  return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function safeSrc(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    if (u.protocol === 'https:' || u.protocol === 'http:') return url;
  } catch (e) {}
  return '';
}

async function apiFetch(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return res.json();
}

let currentUser = null;
let currentPage = 1;
let selectedAppId = '';
let apps = [];
let analyticsData = null;
let syncPollingInterval = null;
let selectedPlatformTab = 'android';
let ratingChart, sentimentChart, timelineChart, ratingBreakdownChart, monthlyRatingChart, reviewsSparkline, emotionChart, responseChart;

const colors = {
  primary: '#6366f1',
  purple: '#8b5cf6',
  success: '#10b981',
  warning: '#f59e0b',
  danger: '#ef4444',
  cyan: '#06b6d4',
  pink: '#ec4899',
  gradient: (ctx, c1, c2) => {
    const gradient = ctx.createLinearGradient(0, 0, 0, 300);
    gradient.addColorStop(0, c1);
    gradient.addColorStop(1, c2);
    return gradient;
  },
  ratings: ['#10b981', '#22c55e', '#f59e0b', '#f97316', '#ef4444'],
  grid: '#e2e8f0',
  text: '#64748b'
};

Chart.defaults.font.family = "'Plus Jakarta Sans', sans-serif";
Chart.defaults.color = colors.text;

document.addEventListener('DOMContentLoaded', () => {
  checkAuth();
});

async function checkAuth() {
  try {
    const response = await fetch(`${API_BASE}/api/auth/check`);
    const data = await response.json();
    
    if (!data.authenticated) {
      window.location.href = '/login';
      return;
    }
    
    currentUser = data.user;
    updateUserDisplay();
    loadApps();
    initNavigation();
    initEventListeners();
    startSyncPolling();
    if (data.requirePasswordChange) {
      forcePasswordChange();
    } else {
      hidePasswordChangeBanner();
    }
  } catch (error) {
    window.location.href = '/login';
  }
}

function updateUserDisplay() {
  const userInfo = document.getElementById('userInfo');
  if (userInfo && currentUser) {
    userInfo.innerHTML = `
      <span class="user-name">${esc(currentUser.username)}</span>
      <span class="user-role">${esc(currentUser.role)}</span>
    `;
  }
}

let passwordChangeRequired = false;

function forcePasswordChange() {
  passwordChangeRequired = true;
  showPasswordChangeBanner();
  showChangePasswordModal();
  const cancelBtn = document.getElementById('closeChangePasswordBtn');
  if (cancelBtn) cancelBtn.style.display = 'none';
  const modal = document.getElementById('changePasswordModal');
  if (modal) modal.classList.add('forced');
  const modalBanner = document.getElementById('modalPasswordBanner');
  if (modalBanner) modalBanner.style.display = 'flex';
}

function showPasswordChangeBanner() {
  const banner = document.getElementById('passwordChangeBanner');
  if (banner) banner.style.display = 'flex';
}

function hidePasswordChangeBanner() {
  const banner = document.getElementById('passwordChangeBanner');
  if (banner) banner.style.display = 'none';
}

function showChangePasswordModal() {
  const modal = document.getElementById('changePasswordModal');
  if (modal) modal.style.display = 'flex';
}

function hideChangePasswordModal() {
  if (passwordChangeRequired) return;
  const modal = document.getElementById('changePasswordModal');
  if (modal) modal.style.display = 'none';
  const form = document.getElementById('changePasswordForm');
  if (form) form.reset();
}

async function submitChangePassword(e) {
  e.preventDefault();
  const current = document.getElementById('changePasswordCurrent')?.value;
  const newPass = document.getElementById('changePasswordNew')?.value;
  const confirm = document.getElementById('changePasswordConfirm')?.value;
  if (!current || !newPass || !confirm) {
    showToast('Please fill all fields', 'error');
    return;
  }
  if (newPass.length < 6) {
    showToast('New password must be at least 6 characters', 'error');
    return;
  }
  if (newPass !== confirm) {
    showToast('New passwords do not match', 'error');
    return;
  }
  showLoader();
  try {
    const res = await fetch(`${API_BASE}/api/auth/change-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ currentPassword: current, newPassword: newPass })
    });
    const data = await res.json();
    if (data.success) {
      passwordChangeRequired = false;
      const modal = document.getElementById('changePasswordModal');
      if (modal) { modal.classList.remove('forced'); modal.style.display = 'none'; }
      const form = document.getElementById('changePasswordForm');
      if (form) form.reset();
      const cancelBtn = document.getElementById('closeChangePasswordBtn');
      if (cancelBtn) cancelBtn.style.display = '';
      const modalBanner = document.getElementById('modalPasswordBanner');
      if (modalBanner) modalBanner.style.display = 'none';
      hidePasswordChangeBanner();
      showToast('Password updated. Please sign in again.', 'success');
      setTimeout(() => logout(), 1500);
    } else {
      showToast(data.error || 'Failed to change password', 'error');
    }
  } catch (err) {
    showToast('Failed to change password', 'error');
  } finally {
    hideLoader();
  }
}

async function logout() {
  try {
    await fetch(`${API_BASE}/api/auth/logout`, { method: 'POST' });
  } catch (e) {}
  window.location.href = '/login';
}

function showSection(sectionName) {
  document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
  document.querySelector(`[data-section="${sectionName}"]`)?.classList.add('active');
  
  document.querySelectorAll('.section').forEach(sec => sec.classList.remove('active'));
  document.getElementById(`${sectionName}Section`)?.classList.add('active');
  
  const titles = { dashboard: 'Dashboard', reviews: 'Reviews', analytics: 'Analytics', apps: 'Apps' };
  document.getElementById('pageTitle').textContent = titles[sectionName] || sectionName;
  
  if (sectionName === 'reviews') loadAllReviews();
  if (sectionName === 'analytics') { loadAnalyticsCharts(); loadAppInfoForAnalytics(); }
  if (sectionName === 'apps') renderAppsList();
}

function initNavigation() {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      showSection(item.dataset.section);
    });
  });
}

function initEventListeners() {
  const refreshBtn = document.getElementById('refreshBtn');
  const exportBtn = document.getElementById('exportBtn');
  const addAppBtn = document.getElementById('addAppBtn');
  if (refreshBtn) refreshBtn.addEventListener('click', fetchReviews);
  if (exportBtn) exportBtn.addEventListener('click', exportCSV);
  if (addAppBtn) addAppBtn.addEventListener('click', (e) => { e.preventDefault(); addApp(); });

  document.getElementById('appSelect').addEventListener('change', (e) => {
    selectedAppId = e.target.value;
    document.getElementById('breadcrumbCurrent').textContent = selectedAppId 
      ? (apps.find(a => a.appId === selectedAppId)?.name || 'Selected App')
      : 'All Apps';
    loadDashboard();
  });
  
  const urlInput = document.getElementById('playStoreUrl');
  if (urlInput) urlInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') addApp(); });
  
  document.getElementById('searchInput').addEventListener('input', debounce(() => {
    currentPage = 1;
    loadAllReviews();
  }, 300));
  
  ['ratingFilter', 'sortFilter', 'orderFilter', 'sentimentFilter', 'emotionFilter', 'replyFilter'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('change', () => {
        currentPage = 1;
        loadAllReviews();
      });
    }
  });
  
  document.getElementById('analyzeSentimentBtn')?.addEventListener('click', analyzeSentiment);

  document.getElementById('showChangePasswordBtn')?.addEventListener('click', showChangePasswordModal);
  document.getElementById('closeChangePasswordBtn')?.addEventListener('click', hideChangePasswordModal);
  document.getElementById('changePasswordForm')?.addEventListener('submit', submitChangePassword);
  document.getElementById('changePasswordModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'changePasswordModal') hideChangePasswordModal();
  });
}

function startSyncPolling() {
  let completedApps = new Set();
  
  syncPollingInterval = setInterval(async () => {
    try {
      const response = await fetch(`${API_BASE}/api/sync-status`);
      const statuses = await response.json();
      
      let hasSyncing = false;
      let needsRefresh = false;
      
      for (const [appId, status] of Object.entries(statuses)) {
        if (status.status === 'syncing' || status.status === 'saving') {
          hasSyncing = true;
          completedApps.delete(appId);
          updateSyncProgress(appId, status);
        } else if (status.status === 'completed' && !completedApps.has(appId)) {
          completedApps.add(appId);
          updateSyncProgress(appId, status);
          needsRefresh = true;
        }
      }
      
      if (needsRefresh) {
        loadApps(true);
        if (!selectedAppId || completedApps.has(selectedAppId)) {
          loadDashboard();
        }
      }
      
      updateGlobalSyncIndicator(hasSyncing);
      if (hasSyncing) renderAppsList();
    } catch (error) {}
  }, 2000);
}

function updateGlobalSyncIndicator(syncing) {
  const indicator = document.getElementById('globalSyncIndicator');
  if (syncing) {
    indicator.innerHTML = '<div class="sync-dot" style="background:#f59e0b;"></div><span>Syncing...</span>';
  } else {
    indicator.innerHTML = '<div class="sync-dot"></div><span>All synced</span>';
  }
}

function updateSyncProgress(appId, status) {
  const app = apps.find(a => a.appId === appId);
  if (app) app.syncStatus = status;
}

async function loadApps(skipDashboard = false) {
  try {
    apps = await apiFetch(`${API_BASE}/api/apps`);
    
    const select = document.getElementById('appSelect');
    const currentValue = selectedAppId || select.value;
    
    select.innerHTML = '<option value="">All Apps</option>';
    apps.forEach(app => {
      const option = document.createElement('option');
      option.value = app.appId;
      const platformIcon = app.platform === 'ios' ? '🍎' : '🤖';
      option.textContent = `${platformIcon} ${app.name || app.appId}`;
      if (app.appId === currentValue) {
        option.selected = true;
      }
      select.appendChild(option);
    });
    if (currentValue && apps.some(a => a.appId === currentValue)) {
      select.value = currentValue;
      selectedAppId = currentValue;
    }
    
    document.getElementById('appsBadge').textContent = apps.length;
    
    if (!skipDashboard) {
      loadDashboard();
    }
    renderAppsList();
  } catch (error) {
    showToast('Failed to load apps', 'error');
  }
}

async function loadDashboard() {
  try {
    const params = selectedAppId ? `?appId=${selectedAppId}` : '';
    analyticsData = await apiFetch(`${API_BASE}/api/analytics${params}`);
    
    const total = analyticsData.totalReviews || 0;
    const positive = analyticsData.sentimentBreakdown?.find(s => s.sentiment === 'positive')?.count || 0;
    const negative = analyticsData.sentimentBreakdown?.find(s => s.sentiment === 'negative')?.count || 0;
    
    document.getElementById('totalReviews').textContent = total.toLocaleString();
    document.getElementById('avgRating').textContent = analyticsData.averageRating || '0.0';
    document.getElementById('positiveReviews').textContent = positive.toLocaleString();
    document.getElementById('negativeReviews').textContent = negative.toLocaleString();
    
    document.getElementById('reviewsBadge').textContent = total.toLocaleString();
    
    const posPercent = total > 0 ? ((positive / total) * 100).toFixed(0) : 0;
    const negPercent = total > 0 ? ((negative / total) * 100).toFixed(0) : 0;
    document.getElementById('positivePercent').textContent = `${posPercent}%`;
    document.getElementById('negativePercent').textContent = `${negPercent}%`;
    const responseMetrics = analyticsData.responseMetrics || {};
    document.getElementById('responseRate').textContent = `${responseMetrics.responseRate || 0}%`;
    document.getElementById('responseCount').textContent = 
      `${(responseMetrics.repliedReviews || 0).toLocaleString()} of ${(responseMetrics.totalReviews || 0).toLocaleString()} replied`;
    
    renderAvgStars(parseFloat(analyticsData.averageRating) || 0);
    renderReviewsSparkline(analyticsData.reviewsByMonth);
    renderTimelineChart(analyticsData.reviewsByMonth);
    renderRatingChart(analyticsData.ratingDistribution);
    renderSentimentChart(analyticsData.sentimentBreakdown, posPercent);
    renderRatingBars(analyticsData.ratingDistribution, total);
    renderKeywords(analyticsData.recentReviews);
    renderRecentReviews(analyticsData.recentReviews);
    renderEmotionChart(analyticsData.emotionBreakdown);
    renderResponseChart(responseMetrics);
  } catch (error) {
    showToast('Failed to load dashboard', 'error');
  }
}

function renderAvgStars(rating) {
  const container = document.getElementById('avgStars');
  const fullStars = Math.floor(rating);
  const hasHalf = rating % 1 >= 0.5;
  
  let html = '';
  for (let i = 0; i < 5; i++) {
    if (i < fullStars) {
      html += '<svg class="star" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';
    } else if (i === fullStars && hasHalf) {
      html += '<svg class="star" viewBox="0 0 24 24" fill="currentColor" style="opacity:0.5;"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';
    } else {
      html += '<svg class="star empty" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';
    }
  }
  container.innerHTML = html;
}

function renderReviewsSparkline(monthlyData) {
  const ctx = document.getElementById('reviewsSparkline')?.getContext('2d');
  if (!ctx) return;
  
  if (reviewsSparkline) reviewsSparkline.destroy();
  
  const data = monthlyData?.slice(-6).map(m => m.count) || [0];
  
  reviewsSparkline = new Chart(ctx, {
    type: 'line',
    data: {
      labels: data.map(() => ''),
      datasets: [{
        data,
        borderColor: '#3b82f6',
        borderWidth: 2,
        fill: true,
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        tension: 0.4,
        pointRadius: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: { x: { display: false }, y: { display: false } }
    }
  });
}

function renderTimelineChart(monthlyData) {
  const ctx = document.getElementById('timelineChart').getContext('2d');
  if (timelineChart) timelineChart.destroy();
  
  const labels = monthlyData?.map(m => {
    const [year, month] = m.month.split('-');
    return new Date(year, month - 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
  }) || [];
  
  timelineChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          type: 'bar',
          label: 'Reviews',
          data: monthlyData?.map(m => m.count) || [],
          backgroundColor: colors.gradient(ctx, 'rgba(99, 102, 241, 0.8)', 'rgba(139, 92, 246, 0.8)'),
          borderRadius: 6,
          borderSkipped: false,
          yAxisID: 'y',
          order: 2
        },
        {
          type: 'line',
          label: 'Avg Rating',
          data: monthlyData?.map(m => m.avgRating?.toFixed(2)) || [],
          borderColor: colors.warning,
          backgroundColor: 'transparent',
          borderWidth: 3,
          tension: 0.4,
          pointBackgroundColor: colors.warning,
          pointBorderColor: '#fff',
          pointBorderWidth: 2,
          pointRadius: 5,
          pointHoverRadius: 7,
          yAxisID: 'y1',
          order: 1
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#0f172a',
          titleFont: { size: 13, weight: 600 },
          bodyFont: { size: 12 },
          padding: 12,
          cornerRadius: 8,
          displayColors: true
        }
      },
      scales: {
        y: { beginAtZero: true, grid: { color: colors.grid }, ticks: { font: { size: 11 } } },
        y1: { position: 'right', min: 1, max: 5, grid: { drawOnChartArea: false }, ticks: { font: { size: 11 } } },
        x: { grid: { display: false }, ticks: { font: { size: 11 } } }
      }
    }
  });
}

function renderRatingChart(distribution) {
  const ctx = document.getElementById('ratingChart').getContext('2d');
  if (ratingChart) ratingChart.destroy();
  
  const data = [5, 4, 3, 2, 1].map(score => distribution?.find(d => d.score === score)?.count || 0);
  
  ratingChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: ['5★', '4★', '3★', '2★', '1★'],
      datasets: [{
        data,
        backgroundColor: colors.ratings,
        borderRadius: 8,
        borderSkipped: false
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { beginAtZero: true, grid: { color: colors.grid }, ticks: { font: { size: 11 } } },
        y: { grid: { display: false }, ticks: { font: { size: 12, weight: 600 } } }
      }
    }
  });
}

function renderRatingBars(distribution, total) {
  const container = document.getElementById('ratingBars');
  if (!container) return;
  
  const stars = [5, 4, 3, 2, 1];
  const barColors = ['#10b981', '#22c55e', '#f59e0b', '#f97316', '#ef4444'];
  
  container.innerHTML = stars.map((star, i) => {
    const count = distribution?.find(d => d.score === star)?.count || 0;
    const percent = total > 0 ? ((count / total) * 100).toFixed(1) : 0;
    return `
      <div class="rating-bar-row">
        <span class="rating-bar-label">${star} star</span>
        <div class="rating-bar-track">
          <div class="rating-bar-fill" style="width: ${percent}%; background: ${barColors[i]}"></div>
        </div>
        <span class="rating-bar-value">${percent}%</span>
      </div>
    `;
  }).join('');
}

function renderSentimentChart(sentimentData, positivePercent) {
  const ctx = document.getElementById('sentimentChart').getContext('2d');
  if (sentimentChart) sentimentChart.destroy();
  
  const positive = sentimentData?.find(s => s.sentiment === 'positive')?.count || 0;
  const neutral = sentimentData?.find(s => s.sentiment === 'neutral')?.count || 0;
  const negative = sentimentData?.find(s => s.sentiment === 'negative')?.count || 0;
  
  document.querySelector('#sentimentCenter .donut-value').textContent = `${positivePercent}%`;
  
  sentimentChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Positive', 'Neutral', 'Negative'],
      datasets: [{
        data: [positive, neutral, negative],
        backgroundColor: [colors.success, colors.warning, colors.danger],
        borderWidth: 0,
        hoverOffset: 8
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '72%',
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#0f172a',
          padding: 12,
          cornerRadius: 8
        }
      }
    }
  });
}

function renderKeywords(reviews) {
  const container = document.getElementById('keywordsCloud');
  if (!reviews || reviews.length === 0) {
    container.innerHTML = '<div class="keyword-loading">No reviews to analyze</div>';
    return;
  }
  
  const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'is', 'it', 'this', 'that', 'was', 'are', 'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'can', 'i', 'you', 'we', 'they', 'he', 'she', 'my', 'your', 'our', 'their', 'its', 'so', 'very', 'just', 'not', 'no', 'yes', 'all', 'any', 'some', 'more', 'most', 'other', 'than', 'then', 'when', 'where', 'which', 'who', 'why', 'how', 'what', 'if', 'because', 'as', 'from', 'up', 'out', 'about', 'into', 'over', 'after', 'been', 'being', 'get', 'got', 'like', 'use', 'used', 'using', 'work', 'works', 'working', 'app', 'apps', 'really', 'much', 'also', 'even', 'still', 'well', 'way', 'only', 'now', 'new', 'one', 'two', 'first', 'last', 'back', 'time', 'day', 'year', 'make', 'made', 'thing', 'things', 'good', 'great', 'best', 'bad', 'love', 'hate', 'need', 'want', 'know', 'see', 'look', 'find', 'give', 'take', 'come', 'go', 'say', 'said', 'think', 'thought', 'feel', 'try', 'let', 'put', 'keep', 'start', 'end']);
  
  const wordCounts = {};
  reviews.forEach(review => {
    if (!review.text) return;
    const words = review.text.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/);
    words.forEach(word => {
      if (word.length > 2 && !stopWords.has(word)) {
        wordCounts[word] = (wordCounts[word] || 0) + 1;
      }
    });
  });
  
  const sorted = Object.entries(wordCounts).sort((a, b) => b[1] - a[1]).slice(0, 15);
  if (sorted.length === 0) {
    container.innerHTML = '<div class="keyword-loading">Not enough data</div>';
    return;
  }
  
  const maxCount = sorted[0][1];
  container.innerHTML = sorted.map(([word, count], i) => {
    const size = count === maxCount ? 'large' : count >= maxCount * 0.5 ? 'medium' : '';
    return `<span class="keyword-tag ${size}">${esc(word)}</span>`;
  }).join('');
}

function renderEmotionChart(emotionData) {
  const ctx = document.getElementById('emotionChart')?.getContext('2d');
  if (!ctx) return;
  
  if (emotionChart) emotionChart.destroy();
  
  const emotionColors = {
    happy: '#fbbf24',
    satisfied: '#10b981',
    frustrated: '#ef4444',
    disappointed: '#ec4899',
    confused: '#6366f1'
  };
  
  const emotionIcons = {
    happy: '😄',
    satisfied: '👍',
    frustrated: '😤',
    disappointed: '😔',
    confused: '😕'
  };
  
  if (!emotionData || emotionData.length === 0) {
    const tagsContainer = document.getElementById('emotionTags');
    if (tagsContainer) tagsContainer.innerHTML = '<span class="keyword-loading">No emotion data available. Click Re-analyze to process reviews.</span>';
    return;
  }
  
  const labels = emotionData.map(e => e.emotion.charAt(0).toUpperCase() + e.emotion.slice(1));
  const data = emotionData.map(e => e.count);
  const bgColors = emotionData.map(e => emotionColors[e.emotion] || colors.primary);
  
  emotionChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: bgColors,
        borderRadius: 8,
        borderSkipped: false
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: 'y',
      plugins: { legend: { display: false } },
      scales: {
        x: { beginAtZero: true, grid: { color: colors.grid } },
        y: { grid: { display: false } }
      }
    }
  });
  
  const tagsContainer = document.getElementById('emotionTags');
  if (tagsContainer) {
    tagsContainer.innerHTML = emotionData.slice(0, 5).map(e => `
      <div class="emotion-tag ${e.emotion}">
        <span class="emotion-icon">${emotionIcons[e.emotion] || '😐'}</span>
        <span>${e.emotion}</span>
        <span class="emotion-count">${e.count}</span>
      </div>
    `).join('');
  }
}

function renderResponseChart(responseMetrics) {
  const ctx = document.getElementById('responseChart')?.getContext('2d');
  if (!ctx) return;
  
  if (responseChart) responseChart.destroy();
  
  const byRating = responseMetrics.byRating || [];
  const labels = byRating.map(r => `${r.score}★`);
  const responded = byRating.map(r => r.replied);
  const notResponded = byRating.map(r => r.total - r.replied);
  
  responseChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Responded',
          data: responded,
          backgroundColor: colors.success,
          borderRadius: { topLeft: 6, topRight: 6 },
          borderSkipped: false
        },
        {
          label: 'No Response',
          data: notResponded,
          backgroundColor: '#e2e8f0',
          borderRadius: { topLeft: 6, topRight: 6 },
          borderSkipped: false
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: { usePointStyle: true, font: { size: 11 } }
        }
      },
      scales: {
        x: { stacked: true, grid: { display: false } },
        y: { stacked: true, beginAtZero: true, grid: { color: colors.grid } }
      }
    }
  });
  
  const avgTimeEl = document.getElementById('avgResponseTime');
  if (avgTimeEl) {
    const days = responseMetrics.avgResponseDays;
    if (days) {
      avgTimeEl.textContent = days < 1 ? '< 1 day' : `${Math.round(days)} days`;
    } else {
      avgTimeEl.textContent = 'N/A';
    }
  }
}

async function analyzeSentiment() {
  showLoader();
  try {
    const res = await fetch(`${API_BASE}/api/analyze-sentiment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appId: selectedAppId || null })
    });
    const data = await res.json();
    if (data.success) {
      showToast(data.message, 'success');
      loadDashboard();
    } else {
      showToast(data.error || 'Failed to analyze', 'error');
    }
  } catch (e) {
    showToast('Failed to analyze sentiment', 'error');
  } finally {
    hideLoader();
  }
}

function renderRecentReviews(reviews) {
  const container = document.getElementById('recentReviewsList');
  if (!reviews || reviews.length === 0) {
    container.innerHTML = '<div class="empty-state"><p>No reviews yet. Add an app and sync to get started.</p></div>';
    return;
  }
  container.innerHTML = reviews.slice(0, 6).map(review => createReviewCard(review, !selectedAppId)).join('');
}

function createReviewCard(review, showAppBadge = false) {
  const stars = Array(5).fill(0).map((_, i) => 
    `<svg class="star ${i < review.score ? '' : 'empty'}" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`
  ).join('');
  
  const date = review.date ? new Date(review.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  const userImage = safeSrc(review.userImage) || `https://ui-avatars.com/api/?name=${encodeURIComponent(review.userName || 'U')}&background=6366f1&color=fff`;
  const appBadge = showAppBadge && review.appName ? `<span class="review-app-badge">${review.appIcon ? `<img src="${escAttr(safeSrc(review.appIcon))}">` : ''}${esc(review.appName)}</span>` : '';
  
  const sentimentIcon = { positive: '😊', neutral: '😐', negative: '😞' };
  const validSentiments = ['positive', 'neutral', 'negative'];
  const sentimentClass = validSentiments.includes(review.sentiment) ? review.sentiment : '';
  const sentimentBadge = sentimentClass
    ? `<span class="sentiment-badge ${sentimentClass}">${sentimentIcon[sentimentClass] || ''} ${sentimentClass}</span>` 
    : '';
  
  let emotionBadges = '';
  if (review.emotions) {
    try {
      const emotions = typeof review.emotions === 'string' ? JSON.parse(review.emotions) : review.emotions;
      if (emotions && emotions.length > 0) {
        emotionBadges = `<div class="emotion-badges">${emotions.slice(0, 2).map(e => 
          `<span class="emotion-mini-badge">${esc(e.emotion)}</span>`
        ).join('')}</div>`;
      }
    } catch (e) {}
  }
  
  const replyDate = review.replyDate ? new Date(review.replyDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  const developerReply = review.replyText ? `
    <div class="developer-reply">
      <div class="reply-header">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 10h10a8 8 0 0 1 8 8v4M3 10l6 6M3 10l6-6"/>
        </svg>
        <span class="reply-label">Developer Response</span>
        <span class="reply-date">${esc(replyDate)}</span>
      </div>
      <p class="reply-text">${esc(review.replyText)}</p>
    </div>
  ` : '';
  
  return `
    <div class="review-card ${review.replyText ? 'has-reply' : ''}">
      <div class="review-header">
        <div class="review-user">
          <img src="${escAttr(userImage)}" alt="" onerror="this.src='https://ui-avatars.com/api/?name=U&background=6366f1&color=fff'">
          <div class="review-user-info">
            <h4>${esc(review.userName || 'Anonymous')}${appBadge}</h4>
            <span>${esc(date)}</span>
          </div>
        </div>
        <div class="review-rating">${stars}</div>
      </div>
      <p class="review-text">${esc(review.text || 'No review text')}</p>
      <div class="review-badges">
        ${sentimentBadge}
        ${emotionBadges}
      </div>
      <div class="review-meta">
        ${review.version ? `<span>v${esc(review.version)}</span>` : ''}
        ${review.thumbsUp ? `<span>👍 ${parseInt(review.thumbsUp) || 0}</span>` : ''}
      </div>
      ${developerReply}
    </div>
  `;
}

async function loadAllReviews() {
  const search = document.getElementById('searchInput').value;
  const score = document.getElementById('ratingFilter').value;
  const sort = document.getElementById('sortFilter').value;
  const order = document.getElementById('orderFilter').value;
  const sentiment = document.getElementById('sentimentFilter')?.value || '';
  const emotion = document.getElementById('emotionFilter')?.value || '';
  const hasReply = document.getElementById('replyFilter')?.value || '';
  
  try {
    const params = new URLSearchParams({
      page: currentPage, limit: 20,
      ...(selectedAppId && { appId: selectedAppId }),
      ...(search && { search }),
      ...(score && { score }),
      ...(sentiment && { sentiment }),
      ...(emotion && { emotion }),
      ...(hasReply && { hasReply }),
      sort, order
    });
    
    const data = await apiFetch(`${API_BASE}/api/reviews?${params}`);
    const container = document.getElementById('allReviewsList');
    
    if (!data.reviews?.length) {
      container.innerHTML = '<div class="empty-state"><p>No reviews found.</p></div>';
      document.getElementById('pagination').innerHTML = '';
      return;
    }
    
    container.innerHTML = data.reviews.map(r => createReviewCard(r, !selectedAppId)).join('');
    renderPagination(data.pagination);
  } catch (error) {
    showToast('Failed to load reviews', 'error');
  }
}

function renderPagination(p) {
  const container = document.getElementById('pagination');
  if (p.pages <= 1) { container.innerHTML = ''; return; }
  
  let html = `<button ${p.page === 1 ? 'disabled' : ''} onclick="goToPage(${p.page - 1})">← Prev</button>`;
  const start = Math.max(1, p.page - 2), end = Math.min(p.pages, p.page + 2);
  for (let i = start; i <= end; i++) html += `<button class="${i === p.page ? 'active' : ''}" onclick="goToPage(${i})">${i}</button>`;
  html += `<button ${p.page === p.pages ? 'disabled' : ''} onclick="goToPage(${p.page + 1})">Next →</button>`;
  container.innerHTML = html;
}

function goToPage(page) { currentPage = page; loadAllReviews(); window.scrollTo({ top: 0, behavior: 'smooth' }); }

async function loadPlatformComparison() {
  const container = document.getElementById('comparisonGrid');
  
  try {
    const stats = await apiFetch(`${API_BASE}/api/platform-stats`);
    
    if (stats.android.apps === 0 && stats.ios.apps === 0) {
      container.innerHTML = '<div class="comparison-loading">Add apps from both platforms to see comparison</div>';
      return;
    }
    
    container.innerHTML = `
      <div class="comparison-column android">
        <div class="comparison-column-header">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.6 9.48l1.84-3.18c.16-.31.04-.69-.26-.85-.29-.15-.65-.06-.83.22l-1.88 3.24c-1.4-.59-2.96-.92-4.47-.92s-3.07.33-4.47.92L5.65 5.67c-.19-.29-.58-.38-.87-.2-.28.18-.37.54-.22.83L6.4 9.48C3.3 11.25 1.28 14.44 1 18h22c-.28-3.56-2.3-6.75-5.4-8.52zM7 15.25c-.69 0-1.25-.56-1.25-1.25s.56-1.25 1.25-1.25 1.25.56 1.25 1.25-.56 1.25-1.25 1.25zm10 0c-.69 0-1.25-.56-1.25-1.25s.56-1.25 1.25-1.25 1.25.56 1.25 1.25-.56 1.25-1.25 1.25z"/></svg>
          <h4>Android (Google Play)</h4>
        </div>
        <div class="comparison-stats">
          <div class="comparison-stat">
            <span class="comparison-stat-value">${stats.android.apps}</span>
            <span class="comparison-stat-label">Apps</span>
          </div>
          <div class="comparison-stat">
            <span class="comparison-stat-value">${stats.android.reviews.toLocaleString()}</span>
            <span class="comparison-stat-label">Reviews</span>
          </div>
          <div class="comparison-stat">
            <span class="comparison-stat-value">${stats.android.avgRating}★</span>
            <span class="comparison-stat-label">Avg Rating</span>
          </div>
          <div class="comparison-stat">
            <span class="comparison-stat-value">${stats.android.positiveRate}%</span>
            <span class="comparison-stat-label">Positive</span>
          </div>
        </div>
      </div>
      <div class="comparison-column ios">
        <div class="comparison-column-header">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/></svg>
          <h4>iOS (App Store)</h4>
        </div>
        <div class="comparison-stats">
          <div class="comparison-stat">
            <span class="comparison-stat-value">${stats.ios.apps}</span>
            <span class="comparison-stat-label">Apps</span>
          </div>
          <div class="comparison-stat">
            <span class="comparison-stat-value">${stats.ios.reviews.toLocaleString()}</span>
            <span class="comparison-stat-label">Reviews</span>
          </div>
          <div class="comparison-stat">
            <span class="comparison-stat-value">${stats.ios.avgRating}★</span>
            <span class="comparison-stat-label">Avg Rating</span>
          </div>
          <div class="comparison-stat">
            <span class="comparison-stat-value">${stats.ios.positiveRate}%</span>
            <span class="comparison-stat-label">Positive</span>
          </div>
        </div>
      </div>
    `;
  } catch (error) {
    container.innerHTML = '<div class="comparison-loading">Failed to load platform comparison</div>';
  }
}

async function loadAnalyticsCharts() {
  if (!analyticsData) return;
  
  loadPlatformComparison();
  
  const ctx1 = document.getElementById('ratingBreakdownChart').getContext('2d');
  const ctx2 = document.getElementById('monthlyRatingChart').getContext('2d');
  
  if (ratingBreakdownChart) ratingBreakdownChart.destroy();
  if (monthlyRatingChart) monthlyRatingChart.destroy();
  
  const total = analyticsData.ratingDistribution?.reduce((s, d) => s + d.count, 0) || 1;
  const breakdownData = [5,4,3,2,1].map(s => {
    const item = analyticsData.ratingDistribution?.find(d => d.score === s);
    return item ? ((item.count / total) * 100).toFixed(1) : 0;
  });
  
  ratingBreakdownChart = new Chart(ctx1, {
    type: 'polarArea',
    data: {
      labels: ['5★', '4★', '3★', '2★', '1★'],
      datasets: [{ data: breakdownData, backgroundColor: colors.ratings.map(c => c + 'cc') }]
    },
    options: {
      responsive: true,
      plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, font: { size: 11 } } } },
      scales: { r: { grid: { color: colors.grid }, ticks: { display: false } } }
    }
  });
  
  const monthLabels = analyticsData.reviewsByMonth?.map(m => {
    const [y, mo] = m.month.split('-');
    return new Date(y, mo - 1).toLocaleDateString('en-US', { month: 'short' });
  }) || [];
  
  monthlyRatingChart = new Chart(ctx2, {
    type: 'line',
    data: {
      labels: monthLabels,
      datasets: [{
        label: 'Avg Rating',
        data: analyticsData.reviewsByMonth?.map(m => m.avgRating?.toFixed(2)) || [],
        borderColor: colors.primary,
        backgroundColor: colors.gradient(ctx2, 'rgba(99, 102, 241, 0.2)', 'rgba(99, 102, 241, 0)'),
        fill: true,
        tension: 0.4,
        pointBackgroundColor: colors.primary,
        pointBorderColor: '#fff',
        pointBorderWidth: 2,
        pointRadius: 5
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        y: { min: 1, max: 5, grid: { color: colors.grid } },
        x: { grid: { display: false } }
      }
    }
  });
}

async function loadAppInfoForAnalytics() {
  const container = document.getElementById('appInfo');
  const subtitle = document.getElementById('appInfoSubtitle');
  
  if (!selectedAppId) {
    container.innerHTML = '<p class="info-placeholder">Select an app to view detailed information.</p>';
    subtitle.textContent = 'Details from App Store';
    return;
  }
  
  const app = apps.find(a => a.appId === selectedAppId);
  const platform = app?.platform || 'android';
  subtitle.textContent = platform === 'ios' ? 'Details from Apple App Store' : 'Details from Google Play Store';
  
  try {
    const response = await fetch(`${API_BASE}/api/app-info/${selectedAppId}`);
    const info = await response.json();
    
    const platformBadge = platform === 'ios' 
      ? '<span class="platform-badge ios" style="margin-left:8px">iOS</span>'
      : '<span class="platform-badge android" style="margin-left:8px">Android</span>';
    
    container.innerHTML = `
      <div class="app-info-item"><label>App Name</label><span>${info.title || 'N/A'}${platformBadge}</span></div>
      <div class="app-info-item"><label>Rating</label><span>${info.score?.toFixed(1) || 'N/A'} ⭐</span></div>
      <div class="app-info-item"><label>Total Ratings</label><span>${info.ratings?.toLocaleString() || 'N/A'}</span></div>
      <div class="app-info-item"><label>Reviews</label><span>${info.reviews?.toLocaleString() || 'N/A'}</span></div>
      ${platform === 'android' ? `<div class="app-info-item"><label>Installs</label><span>${info.installs || 'N/A'}</span></div>` : ''}
      <div class="app-info-item"><label>Version</label><span>${info.version || 'N/A'}</span></div>
      <div class="app-info-item"><label>Developer</label><span>${info.developer || 'N/A'}</span></div>
    `;
  } catch (error) {
    container.innerHTML = '<p class="info-placeholder">Failed to load app info.</p>';
  }
}

function getSyncStatusHtml(app) {
  const s = app.syncStatus;
  if (!s || s.status === 'idle') return '';
  if (s.status === 'syncing' || s.status === 'saving') {
    const pct = s.total > 0 ? Math.min(Math.round((s.progress / s.total) * 100), 100) : 0;
    return `<div class="sync-status syncing"><div class="sync-progress-bar"><div class="sync-progress-fill" style="width:${pct}%"></div></div><span class="sync-message">${s.message}</span></div>`;
  }
  if (s.status === 'completed') return `<div class="sync-status completed"><span class="sync-message">✓ ${s.message}</span></div>`;
  if (s.status === 'error') return `<div class="sync-status error"><span class="sync-message">⚠ ${s.message}</span></div>`;
  return '';
}

function renderPlatformAppCard(app) {
  const syncing = app.syncStatus?.status === 'syncing' || app.syncStatus?.status === 'saving';
  const syncMessage = app.syncStatus?.message || '';
  
  const safeAppId = escAttr(app.appId);
  const iconSrc = safeSrc(app.icon) || `https://ui-avatars.com/api/?name=${encodeURIComponent(app.name || 'A')}&background=6366f1&color=fff`;
  return `
    <div class="platform-app-card" data-app-id="${safeAppId}">
      <img class="app-icon" src="${escAttr(iconSrc)}" alt="" onerror="this.src='https://ui-avatars.com/api/?name=A&background=6366f1&color=fff'">
      <div class="app-details">
        <div class="app-name">${esc(app.name || app.appId)}</div>
        <div class="app-meta">
          <span>👤 ${esc(app.developer || 'Unknown')}</span>
          <span>💬 ${(parseInt(app.reviewCount) || 0).toLocaleString()}</span>
        </div>
      </div>
      ${syncing ? `
        <span class="sync-badge">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
          Syncing...
        </span>
      ` : `
        <div class="app-actions">
          <button class="btn-icon sync" onclick="syncApp('${safeAppId}')" title="Sync Reviews">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
          </button>
          <button class="btn-icon delete" onclick="deleteApp('${safeAppId}')" title="Remove App">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
          </button>
        </div>
      `}
    </div>
  `;
}

function selectPlatformTab(platform) {
  selectedPlatformTab = platform;
  document.querySelectorAll('.platform-tab').forEach((t) => t.classList.remove('active'));
  const activeTab = document.querySelector(`.platform-tab[data-platform="${platform}"]`);
  if (activeTab) activeTab.classList.add('active');
  const input = document.getElementById('playStoreUrl');
  const icon = document.getElementById('platformIcon');
  if (platform === 'ios') {
    if (input) input.placeholder = 'https://apps.apple.com/app/app-name/id123456789';
    if (icon) icon.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/></svg>';
  } else {
    if (input) input.placeholder = 'https://play.google.com/store/apps/details?id=...';
    if (icon) icon.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M17.6 9.48l1.84-3.18c.16-.31.04-.69-.26-.85-.29-.15-.65-.06-.83.22l-1.88 3.24c-1.4-.59-2.96-.92-4.47-.92s-3.07.33-4.47.92L5.65 5.67c-.19-.29-.58-.38-.87-.2-.28.18-.37.54-.22.83L6.4 9.48C3.3 11.25 1.28 14.44 1 18h22c-.28-3.56-2.3-6.75-5.4-8.52zM7 15.25c-.69 0-1.25-.56-1.25-1.25s.56-1.25 1.25-1.25 1.25.56 1.25 1.25-.56 1.25-1.25 1.25zm10 0c-.69 0-1.25-.56-1.25-1.25s.56-1.25 1.25-1.25 1.25.56 1.25 1.25-.56 1.25-1.25 1.25z"/></svg>';
  }
}

function renderAppsList() {
  const androidList = document.getElementById('androidAppsList');
  const iosList = document.getElementById('iosAppsList');
  if (!androidList || !iosList) return;
  const androidApps = apps.filter((a) => a.platform === 'android');
  const iosApps = apps.filter((a) => a.platform === 'ios');

  const countEl = document.getElementById('androidAppCount');
  const iosCountEl = document.getElementById('iosAppCount');
  if (countEl) countEl.textContent = `${androidApps.length} app${androidApps.length !== 1 ? 's' : ''}`;
  if (iosCountEl) iosCountEl.textContent = `${iosApps.length} app${iosApps.length !== 1 ? 's' : ''}`;

  const renderList = (list, items) => {
    if (items.length === 0) {
      list.innerHTML = '<div class="empty-state"><p>No apps added yet</p></div>';
      return;
    }
    list.innerHTML = items.map((app) => renderPlatformAppCard(app)).join('');
  };
  renderList(androidList, androidApps);
  renderList(iosList, iosApps);
}

async function addApp() {
  const input = document.getElementById('playStoreUrl');
  if (!input) return;
  const url = input.value.trim();
  if (!url) {
    showToast('Please enter a store URL', 'error');
    return;
  }
  const isAndroid = url.includes('play.google.com');
  const isIos = url.includes('apps.apple.com') || url.includes('itunes.apple.com');
  if (!isAndroid && !isIos) {
    showToast('Enter a valid Google Play or App Store URL', 'error');
    return;
  }
  showLoader();
  try {
    const res = await fetch(`${API_BASE}/api/apps`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ playStoreUrl: url })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`Added ${data.app.name || 'app'}`, 'success');
      input.value = '';
      loadApps();
    } else {
      showToast(data.error || 'Failed to add app', 'error');
    }
  } catch (e) {
    showToast('Failed to add app', 'error');
  } finally {
    hideLoader();
  }
}

async function syncApp(appId) {
  try {
    const res = await fetch(`${API_BASE}/api/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appId })
    });
    const data = await res.json();
    if (data.success) { showToast('Sync started', 'success'); loadApps(); }
    else showToast(data.message || 'Failed', 'error');
  } catch (e) { showToast('Failed to sync', 'error'); }
}

async function deleteApp(appId) {
  if (!confirm('Remove this app and all reviews?')) return;
  showLoader();
  try {
    const res = await fetch(`${API_BASE}/api/apps/${encodeURIComponent(appId)}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      showToast('App removed', 'success');
      if (selectedAppId === appId) { selectedAppId = ''; document.getElementById('appSelect').value = ''; }
      loadApps();
    } else showToast(data.error || 'Failed', 'error');
  } catch (e) { showToast('Failed to remove', 'error'); }
  finally { hideLoader(); }
}

async function fetchReviews() {
  if (!apps.length) { showToast('Add an app first', 'error'); return; }
  if (selectedAppId) { syncApp(selectedAppId); return; }
  try {
    const res = await fetch(`${API_BASE}/api/sync-all`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    const data = await res.json();
    if (data.success) { showToast(data.message, 'success'); loadApps(); }
    else showToast(data.error || 'Failed', 'error');
  } catch (e) { showToast('Failed', 'error'); }
}

function exportCSV() {
  window.location.href = `${API_BASE}/api/reviews/export/csv${selectedAppId ? `?appId=${selectedAppId}` : ''}`;
}

function showToast(msg, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = `toast ${type} show`;
  setTimeout(() => toast.classList.remove('show'), 3000);
}

function showLoader() { document.getElementById('loader').classList.add('show'); }
function hideLoader() { document.getElementById('loader').classList.remove('show'); }
function debounce(fn, wait) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
}
