// ============================================================
// Shared State & Global Configuration
// ============================================================
const AppConfig = {
  dataPath: 'data/current.json',
  archivePath: 'data/archive/{date}.json'
};

const AppState = {
  currentData: null,
  activeView: 'dashboard'
};

// ============================================================
// Initialization & Navigation
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  setupNavigation();
  initParticles();
  
  // 載入即時數據
  await fetchCurrentData();
  
  // 初始化各模組
  if (window.DashboardController) DashboardController.init();
  if (window.HistoryController) HistoryController.init();
  if (window.CalculatorController) CalculatorController.init();
});

function setupNavigation() {
  const navBtns = document.querySelectorAll('.nav-btn');
  const panels = document.querySelectorAll('.view-panel');
  
  navBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      // Update active button
      navBtns.forEach(b => b.classList.remove('active'));
      const targetBtn = e.currentTarget;
      targetBtn.classList.add('active');
      
      // Update active panel
      const targetView = targetBtn.getAttribute('data-view');
      AppState.activeView = targetView;
      
      panels.forEach(p => p.classList.remove('active'));
      document.getElementById(`view-${targetView}`).classList.add('active');
    });
  });
}

// ============================================================
// Data Fetching
// ============================================================
async function fetchCurrentData() {
  try {
    const response = await fetch(AppConfig.dataPath + '?t=' + new Date().getTime());
    if (!response.ok) throw new Error('Data not found');
    
    const data = await response.json();
    AppState.currentData = data;
    updateGlobalUI(data);
    
    // 如果數據載入成功，觸發自定義事件通知其他模組
    document.dispatchEvent(new CustomEvent('dataLoaded', { detail: data }));
  } catch (error) {
    console.error('Error fetching current data:', error);
    document.getElementById('updateTime').textContent = '⚠️ 無法載入最新數據';
    document.getElementById('matchesGrid').innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">❌</span>
        <p>系統尚未建立初始數據，請等待排程更新或手動執行拉取指令。</p>
      </div>
    `;
  }
}

function updateGlobalUI(data) {
  // 更新時間
  document.getElementById('updateTime').textContent = `最後更新: ${data.last_updated_display}`;
  
  // 更新統計橫幅
  document.getElementById('statTotalMatches').textContent = data.stats.total_matches;
  document.getElementById('statSignificant').textContent = data.stats.significant_changes_count;
  document.getElementById('statLeagues').textContent = Object.keys(data.leagues || {}).length;
  
  // 渲染新聞
  renderNews(data.news);
}

// ============================================================
// Shared UI Components
// ============================================================
function createMatchCard(match) {
  const isSig = isSignificantChange(match) ? 'is-significant' : '';
  const homeOdds = match.avg_odds?.[match.home_team] || 0;
  const awayOdds = match.avg_odds?.[match.away_team] || 0;
  
  const homeOpen = match.opening_odds?.[match.home_team] || homeOdds;
  const awayOpen = match.opening_odds?.[match.away_team] || awayOdds;
  
  const homeChange = calculateChangeClass(homeOdds, homeOpen);
  const awayChange = calculateChangeClass(awayOdds, awayOpen);

  // 價值注徽章
  const isValueBetHtml = match.is_value_bet ? '<div class="value-bet-badge">💎 價值注警示</div>' : '';

  // 其他盤口 (讓分、大小、雙進)
  let otherMarketsHtml = '';
  const spreads = match.other_markets?.spreads || {};
  const totals = match.other_markets?.totals || {};
  const btts = match.other_markets?.btts || {};
  
  const getPoint = (obj) => {
    for (let k in obj) {
      if (obj[k].point !== undefined) return obj[k].point;
    }
    return '';
  };

  if (Object.keys(spreads).length > 0) {
    const pt = getPoint(spreads);
    if (pt !== '') otherMarketsHtml += `<span class="market-tag">主讓 ${pt > 0 ? '+'+pt : pt}</span>`;
  }
  if (Object.keys(totals).length > 0) {
    const pt = getPoint(totals);
    if (pt !== '') otherMarketsHtml += `<span class="market-tag">大小 ${pt}</span>`;
  }
  if (Object.keys(btts).length > 0) {
    const yesPrice = btts['Yes']?.price;
    if (yesPrice) otherMarketsHtml += `<span class="market-tag">雙進(是) ${yesPrice}</span>`;
  }

  // 勝率進度條
  let probHtml = '';
  if (match.true_probs && Object.keys(match.true_probs).length > 0) {
    const probHome = match.true_probs[match.home_team] || 50;
    const probAway = match.true_probs[match.away_team] || 50;
    probHtml = `
      <div class="prob-container">
        <div class="prob-labels">
          <span style="color: var(--primary)">${probHome.toFixed(1)}%</span>
          <span class="prob-title">AI 真實勝率</span>
          <span style="color: var(--warning)">${probAway.toFixed(1)}%</span>
        </div>
        <div class="prob-bar">
          <div class="prob-fill" style="width: ${probHome}%"></div>
        </div>
      </div>
    `;
  }

  let aiHtml = '';
  if (match.ai_analysis) {
    aiHtml = `
      <div class="ai-analysis">
        <div class="ai-header">
          <span>🤖 AI 診斷分析</span>
        </div>
        <div class="ai-content">${match.ai_analysis}</div>
      </div>
    `;
  }

  return `
    <div class="match-card ${isSig}">
      ${isValueBetHtml}
      <div class="match-header">
        <span class="match-league">${match.league || '未知聯賽'}</span>
        <span>開賽: ${formatTime(match.commence_time)}</span>
      </div>
      
      <div class="other-markets">
        ${otherMarketsHtml}
      </div>
      
      <div class="match-teams">
        <div class="team-row">
          <span class="team-name">${match.home_team} (主)</span>
          <div class="odds-box">
            <span class="odds-opening">${homeOpen.toFixed(2)}</span>
            <span class="odds-current">${homeOdds.toFixed(2)}</span>
            <span class="odds-change ${homeChange.cls}">${homeChange.icon}</span>
          </div>
        </div>
        <div class="team-row">
          <span class="team-name">${match.away_team} (客)</span>
          <div class="odds-box">
            <span class="odds-opening">${awayOpen.toFixed(2)}</span>
            <span class="odds-current">${awayOdds.toFixed(2)}</span>
            <span class="odds-change ${awayChange.cls}">${awayChange.icon}</span>
          </div>
        </div>
      </div>
      
      ${probHtml}
      ${aiHtml}
    </div>
  `;
}

function calculateChangeClass(current, open) {
  const diff = current - open;
  if (diff > 0.05) return { cls: 'change-up', icon: '↑' };
  if (diff < -0.05) return { cls: 'change-down', icon: '↓' };
  return { cls: 'change-none', icon: '-' };
}

function isSignificantChange(match) {
  const pcts = match.change_pct || {};
  return Object.values(pcts).some(val => Math.abs(val) > 5);
}

function formatTime(isoString) {
  if (!isoString) return '--';
  const d = new Date(isoString);
  return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

// ============================================================
// News Rendering
// ============================================================
function renderNews(newsData) {
  if (!newsData) return;
  
  const renderList = (items, containerId) => {
    const container = document.getElementById(containerId);
    if (!items || items.length === 0) {
      container.innerHTML = '<div class="empty-state">目前無最新新聞</div>';
      return;
    }
    
    container.innerHTML = items.map(item => `
      <a href="${item.link}" target="_blank" class="news-item">
        <div class="news-title">${item.title}</div>
        <div class="news-meta">發布時間: ${new Date(item.published).toLocaleString()}</div>
      </a>
    `).join('');
  };
  
  renderList(newsData.nba, 'nbaNewsList');
  renderList(newsData.soccer, 'soccerNewsList');
}

// ============================================================
// Visual Effects
// ============================================================
function initParticles() {
  const container = document.getElementById('bgParticles');
  // 簡單的滑鼠追蹤微光效果
  document.addEventListener('mousemove', (e) => {
    const x = (e.clientX / window.innerWidth) * 100;
    const y = (e.clientY / window.innerHeight) * 100;
    container.style.background = `
      radial-gradient(circle at ${x}% ${y}%, rgba(88, 166, 255, 0.08) 0%, transparent 40%),
      radial-gradient(circle at ${100-x}% ${100-y}%, rgba(63, 185, 80, 0.05) 0%, transparent 50%)
    `;
  });
}
