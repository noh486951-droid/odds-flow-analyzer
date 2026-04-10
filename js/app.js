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
  
  // 初始化各模組 (必須在抓資料之前，建立事件監聽)
  if (window.DashboardController) DashboardController.init();
  if (window.HistoryController) HistoryController.init();
  if (window.CalculatorController) CalculatorController.init();

  // 載入即時數據
  await fetchCurrentData();
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
  document.getElementById('statApiRemaining').textContent = data.stats?.api_remaining || '-';
  
  // 渲染新聞
  renderNews(data.news);
}

// ============================================================
// Shared UI Components
// ============================================================
function createMatchCard(match) {
  try {
    const isSig = isSignificantChange(match) ? 'is-significant' : '';
    const homeOdds = match.avg_odds?.[match.home_team] || 0;
    const awayOdds = match.avg_odds?.[match.away_team] || 0;
    
    const homeOpen = match.opening_odds?.[match.home_team] || homeOdds;
    const awayOpen = match.opening_odds?.[match.away_team] || awayOdds;
    
    const homeChange = calculateChangeClass(homeOdds, homeOpen);
    const awayChange = calculateChangeClass(awayOdds, awayOpen);

    // 價值注徽章
    const isValueBetHtml = match.is_value_bet ? '<div class="value-bet-badge">💎 價值注警示</div>' : '';

    // 顯著變動標籤 (對應左側紅色邊框)
    const isSigBadgeHtml = isSig ? '<div class="sig-change-badge" title="賠率在開盤後已出現大幅移動（變動幅度 > 5%）">📉 盤口急變</div>' : '';

    // 傷兵標籤
    let injuryHtml = '';
    const injuries = match.injury_alerts || [];
    if (injuries.length > 0) {
      injuryHtml = `<div class="alert-tag injury-tag">🏥 傷兵 ${injuries.length} 則</div>`;
    }

    // 疲勞標籤
    let fatigueHtml = '';
    const fatigue = match.fatigue_alert || [];
    if (fatigue.length > 0) {
      fatigueHtml = fatigue.map(f => 
        `<div class="alert-tag fatigue-tag">😴 ${f.team} 背靠背</div>`
      ).join('');
    }

    // 急速移動標籤
    let sharpHtml = '';
    const sharp = match.sharp_moves || [];
    if (sharp.length > 0) {
      sharpHtml = sharp.map(s => 
        `<div class="alert-tag sharp-tag">${s.level}</div>`
      ).join('');
    }

    // 天氣標籤 (足球)
    let weatherHtml = '';
    if (match.weather) {
      const w = match.weather;
      weatherHtml = `<div class="alert-tag weather-tag">${w.condition} ${w.temp}°C</div>`;
    }

    // 近期戰績
    let formHtml = '';
    const homeForm = match.home_form?.record || '';
    const awayForm = match.away_form?.record || '';
    if (homeForm || awayForm) {
      const renderDots = (record) => record.split('').map(r => 
        `<span class="form-dot ${r === 'W' ? 'form-win' : 'form-loss'}">${r}</span>`
      ).join('');
      formHtml = `
        <div class="form-row">
          <span class="form-label">近況</span>
          <span class="form-dots">${renderDots(homeForm)}</span>
          <span class="form-vs">vs</span>
          <span class="form-dots">${renderDots(awayForm)}</span>
        </div>
      `;
    }

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

    const getGoldClass = (prob) => prob >= 60.0 ? 'gold-prob' : '';

    if (Object.keys(spreads).length > 0) {
      const pt = getPoint(spreads);
      const homeProb = spreads[match.home_team]?.prob;
      const hcClass = homeProb && homeProb >= 60.0 ? 'gold-prob' : '';
      const probStr = homeProb ? ` (過盤率 <span class="${hcClass}">${homeProb.toFixed(1)}%</span>)` : '';
      if (pt !== '') otherMarketsHtml += `<span class="market-tag">主讓 ${pt > 0 ? '+'+pt : pt}${probStr}</span>`;
    }
    if (Object.keys(totals).length > 0) {
      const pt = getPoint(totals);
      const overProb = totals['Over']?.prob;
      const ocClass = overProb && overProb >= 60.0 ? 'gold-prob' : '';
      const probStr = overProb ? ` (大分勝率 <span class="${ocClass}">${overProb.toFixed(1)}%</span>)` : '';
      if (pt !== '') otherMarketsHtml += `<span class="market-tag">大小 ${pt}${probStr}</span>`;
    }
    if (Object.keys(btts).length > 0) {
      const yesPrice = btts['Yes']?.price;
      const yesProb = btts['Yes']?.prob;
      const ycClass = yesProb && yesProb >= 60.0 ? 'gold-prob' : '';
      const probStr = yesProb ? ` (勝率 <span class="${ycClass}">${yesProb.toFixed(1)}%</span>)` : '';
      if (yesPrice) otherMarketsHtml += `<span class="market-tag">雙進(是) ${yesPrice}${probStr}</span>`;
    }

    // 勝率進度條
    let probHtml = '';
    if (match.true_probs && Object.keys(match.true_probs).length > 0) {
      const probHome = match.true_probs[match.home_team] || 50;
      const probAway = match.true_probs[match.away_team] || 50;
      probHtml = `
        <div class="prob-container">
          <div class="prob-labels">
            <span class="${getGoldClass(probHome)}" style="color: var(--primary)">${probHome.toFixed(1)}%</span>
            <span class="prob-title">AI 真實勝率</span>
            <span class="${getGoldClass(probAway)}" style="color: var(--warning)">${probAway.toFixed(1)}%</span>
          </div>
          <div class="prob-bar">
            <div class="prob-fill" style="width: ${probHome}%"></div>
          </div>
        </div>
      `;
    }

    let aiHtml = '';
    if (match.ai_analysis) {
      // 美化 AI 錯誤訊息，把技術性英文換成中文提示
      let displayAnalysis = match.ai_analysis;
      if (displayAnalysis.includes('429') || displayAnalysis.includes('quota') || displayAnalysis.includes('exceeded')) {
        displayAnalysis = 'AI 分析今日已達免費額度上限，明日下午自動恢復。請參考勝率數據判斷。';
      } else if (displayAnalysis.includes('API 錯誤') || displayAnalysis.includes('failed')) {
        displayAnalysis = 'AI 分析暫時無法使用，請參考勝率數據判斷。';
      }
      const shortAnalysis = displayAnalysis.length > 120 
        ? displayAnalysis.substring(0, 120) + '...' 
        : displayAnalysis;
      aiHtml = `
        <div class="ai-analysis">
          <div class="ai-header">
            <span>🤖 AI 診斷分析</span>
          </div>
          <div class="ai-content">${shortAnalysis}</div>
        </div>
      `;
    }

    return `
      <div class="match-card ${isSig}" onclick="openMatchDetail('${match.id}')" style="cursor:pointer" title="點擊查看詳情">
        ${isValueBetHtml}
        ${isSigBadgeHtml}
        <div class="match-header">
          <span class="match-league">${match.league || '未知聯賽'}</span>
          <span>開賽: ${formatTime(match.commence_time)}</span>
        </div>

        <div class="alert-tags">
          ${injuryHtml}
          ${fatigueHtml}
          ${sharpHtml}
          ${weatherHtml}
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
        
        ${formHtml}
        ${probHtml}
        ${aiHtml}

        <div class="card-footer-hint">📋 點擊查看完整分析</div>
      </div>
    `;
  } catch (error) {
    console.error("Error generating match card for " + match?.id, error);
    return `<div class="match-card"><div class="empty-state">賽事資料載入錯誤</div></div>`;
  }
}

// ============================================================
// Match Detail Modal
// ============================================================
function openMatchDetail(matchId) {
  if (!AppState.currentData?.matches?.[matchId]) return;
  const match = AppState.currentData.matches[matchId];
  
  const modal = document.getElementById('matchDetailModal');
  const content = document.getElementById('modalContent');
  
  // H2H
  let h2hHtml = '<p class="modal-empty">近期賽程中查無交手記錄（跨聯會對陣或本季首次相遇）</p>';
  const h2h = match.h2h_history || [];
  if (h2h.length > 0) {
    h2hHtml = `<table class="h2h-table">
      <tr><th>日期</th><th>主隊</th><th>比分</th><th>客隊</th></tr>
      ${h2h.map(h => `<tr><td>${h.date}</td><td>${h.home}</td><td class="h2h-score">${h.score}</td><td>${h.away}</td></tr>`).join('')}
    </table>`;
  }

  // Recent form
  const renderFormDetail = (form, teamName) => {
    if (!form?.details?.length) return `<p class="modal-empty">${teamName}: 無近期資料</p>`;
    const dots = (form.record || '').split('').map(r =>
      `<span class="form-dot ${r === 'W' ? 'form-win' : 'form-loss'}">${r}</span>`
    ).join('');
    // 主客場拆分
    const homeRec = form.home_record || '';
    const awayRec = form.away_record || '';
    const splitHtml = (homeRec || awayRec)
      ? `<div class="form-split">主場 <span class="form-split-rec">${homeRec || '-'}</span> ／ 客場 <span class="form-split-rec">${awayRec || '-'}</span></div>`
      : '';
    const details = form.details.map(d =>
      `<div class="form-detail-row"><span>${d.date}</span><span>${d.venue ? `[${d.venue}]` : ''} vs ${d.opponent}</span><span class="${d.result === 'W' ? 'form-win' : 'form-loss'}">${d.score} (${d.result})</span></div>`
    ).join('');
    return `<div class="form-section"><h4>${teamName} ${dots} (${form.wins}勝${form.losses}負)</h4>${splitHtml}${details}</div>`;
  };

  // Injuries
  let injuryHtml = '<p class="modal-empty">無已知傷兵消息</p>';
  const injuries = match.injury_alerts || [];
  if (injuries.length > 0) {
    injuryHtml = injuries.map(inj => 
      `<div class="injury-item"><span class="injury-team">${inj.team}</span><a href="${inj.link}" target="_blank">${inj.title}</a></div>`
    ).join('');
  }

  // Fatigue
  let fatigueHtml = '';
  const fatigue = match.fatigue_alert || [];
  if (fatigue.length > 0) {
    fatigueHtml = `<div class="modal-section"><h3>😴 疲勞警示</h3>` +
      fatigue.map(f => `<div class="fatigue-item">${f.team}: ${f.message}</div>`).join('') +
      `</div>`;
  }

  // 盤口走勢圖 (mini chart)
  let timelineHtml = '';
  const timeline = match.odds_timeline || [];
  if (timeline.length >= 1) {
    const homeTeam = match.home_team;
    const awayTeam = match.away_team;
    const homeVals = timeline.map(s => s[homeTeam] || 0).filter(v => v > 0);
    const awayVals = timeline.map(s => s[awayTeam] || 0).filter(v => v > 0);

    // 資料點不足或完全無變動時，改顯示文字提示
    const homeRange = homeVals.length >= 2 ? Math.max(...homeVals) - Math.min(...homeVals) : 0;
    const awayRange = awayVals.length >= 2 ? Math.max(...awayVals) - Math.min(...awayVals) : 0;
    const hasEnoughData = homeVals.length >= 3 || awayVals.length >= 3;
    const hasVariance = homeRange >= 0.02 || awayRange >= 0.02;

    if (!hasEnoughData || !hasVariance) {
      const snapshotCount = timeline.length;
      timelineHtml = `
        <div class="modal-section">
          <h3>📈 盤口走勢</h3>
          <div class="timeline-pending">資料累積中（目前 ${snapshotCount} 筆快照，需至少 3 筆且有變動才顯示圖表）</div>
        </div>
      `;
    } else {
      // 各隊獨立 Y 軸：讓每條線的變動幅度填滿圖表高度，即使賠率只差 0.01 也看得出來
      const makeTeamChart = (vals, color, teamName) => {
        if (vals.length < 2) return '';
        const vMin = Math.min(...vals);
        const vMax = Math.max(...vals);
        // 動態 padding：變動幅度越小，padding 越小，使微小變動仍可見
        const rawRange = vMax - vMin;
        const pad = rawRange < 0.01 ? 0.005 : rawRange * 0.25;
        const scaledMin = vMin - pad;
        const scaledMax = vMax + pad;
        const range = scaledMax - scaledMin || 0.01;

        const pts = vals.map((v, i) => {
          const x = (i / (vals.length - 1)) * 280;
          const y = 36 - ((v - scaledMin) / range) * 30;
          return `${x},${y}`;
        }).join(' ');

        const dots = vals.map((v, i) => {
          const x = (i / (vals.length - 1)) * 280;
          const y = 36 - ((v - scaledMin) / range) * 30;
          return `<circle cx="${x}" cy="${y}" r="3" fill="${color}"><title>${v.toFixed(2)}</title></circle>`;
        }).join('');

        const trendLabel = rawRange >= 0.01
          ? (vals[vals.length - 1] > vals[0] ? ' ↑' : ' ↓')
          : ' →';
        const rangeLabel = rawRange >= 0.01 ? `${vMin.toFixed(2)}–${vMax.toFixed(2)}` : `${vMin.toFixed(2)} (無變動)`;

        return `
          <div class="team-chart-wrap">
            <div class="team-chart-label" style="color:${color}">${teamName} <span class="team-chart-range">${rangeLabel}${trendLabel}</span></div>
            <svg class="timeline-chart" viewBox="0 0 280 40" preserveAspectRatio="none">
              <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2"/>
              ${dots}
            </svg>
          </div>
        `;
      };

      const homeChartSvg = makeTeamChart(homeVals, 'var(--primary)', homeTeam);
      const awayChartSvg = makeTeamChart(awayVals, 'var(--warning)', awayTeam);

      timelineHtml = `
        <div class="modal-section">
          <h3>📈 盤口走勢（各隊獨立比例）</h3>
          ${homeChartSvg}
          ${awayChartSvg}
          <div class="timeline-labels">
            ${timeline.map(s => `<span>${s.time}</span>`).join('')}
          </div>
        </div>
      `;
    }
  }

  // 急速移動
  let sharpModalHtml = '';
  const sharpMoves = match.sharp_moves || [];
  if (sharpMoves.length > 0) {
    sharpModalHtml = `<div class="modal-section"><h3>🔥 急速移動偵測</h3>` +
      sharpMoves.map(s => `<div class="sharp-item">${s.level}: ${s.message}</div>`).join('') +
      `</div>`;
  }

  // 天氣
  let weatherModalHtml = '';
  if (match.weather) {
    const w = match.weather;
    weatherModalHtml = `<div class="modal-section"><h3>☁️ 比賽天氣</h3>
      <div class="weather-info">
        <span class="weather-condition">${w.condition}</span>
        <span>氣溫 ${w.temp}°C | 風速 ${w.wind}km/h | 降雨 ${w.rain}mm</span>
        ${w.impact ? `<div class="weather-impact">${w.impact}</div>` : ''}
      </div>
    </div>`;
  }

  // AI Analysis
  let aiHtml = '<p class="modal-empty">此場比賽未觸發 AI 分析</p>';
  if (match.ai_analysis) {
    let displayAnalysis = match.ai_analysis;
    if (displayAnalysis.includes('429') || displayAnalysis.includes('quota') || displayAnalysis.includes('exceeded')) {
      displayAnalysis = 'AI 分析今日已達免費額度上限，明日下午自動恢復。請參考勝率數據判斷。';
    } else if (displayAnalysis.includes('API 錯誤') || displayAnalysis.includes('failed')) {
      displayAnalysis = 'AI 分析暫時無法使用，請參考勝率數據判斷。';
    }
    aiHtml = `<div class="ai-content modal-ai">${displayAnalysis}</div>`;
  }

  // Prob bar
  const probHome = match.true_probs?.[match.home_team] || 50;
  const probAway = match.true_probs?.[match.away_team] || 50;
  const getGoldClass = (prob) => prob >= 60.0 ? 'gold-prob' : '';

  content.innerHTML = `
    <div class="modal-header-bar">
      <h2>${match.home_team} vs ${match.away_team}</h2>
      <button class="modal-close-btn" onclick="closeMatchDetail()">✕</button>
    </div>
    <div class="modal-meta">${match.league} | 開賽: ${formatTime(match.commence_time)}</div>

    <div class="modal-prob-bar">
      <div class="prob-labels">
        <span class="${getGoldClass(probHome)}" style="color:var(--primary)">${probHome.toFixed(1)}%</span>
        <span class="prob-title">真實勝率</span>
        <span class="${getGoldClass(probAway)}" style="color:var(--warning)">${probAway.toFixed(1)}%</span>
      </div>
      <div class="prob-bar"><div class="prob-fill" style="width:${probHome}%"></div></div>
    </div>

    ${fatigueHtml}
    ${sharpModalHtml}
    ${weatherModalHtml}

    <div class="modal-section">
      <h3>🏥 傷兵快訊</h3>
      ${injuryHtml}
    </div>

    <div class="modal-section">
      <h3>🤖 AI 完整分析</h3>
      ${aiHtml}
    </div>

    <div class="modal-section">
      <h3>📊 歷史交手紀錄</h3>
      ${h2hHtml}
    </div>

    ${timelineHtml}

    <div class="modal-section">
      <h3>🔥 近期戰績</h3>
      ${renderFormDetail(match.home_form, match.home_team)}
      ${renderFormDetail(match.away_form, match.away_team)}
    </div>
  `;

  modal.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeMatchDetail() {
  document.getElementById('matchDetailModal').classList.remove('active');
  document.body.style.overflow = '';
}

// ESC 鍵關閉 Modal
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeMatchDetail();
});

function calculateChangeClass(current, open) {
  const diff = current - open;
  if (diff > 0.05) return { cls: 'change-up', icon: '↑' };
  if (diff < -0.05) return { cls: 'change-down', icon: '↓' };
  return { cls: 'change-none', icon: '→' };
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
  document.addEventListener('mousemove', (e) => {
    const x = (e.clientX / window.innerWidth) * 100;
    const y = (e.clientY / window.innerHeight) * 100;
    container.style.background = `
      radial-gradient(circle at ${x}% ${y}%, rgba(88, 166, 255, 0.08) 0%, transparent 40%),
      radial-gradient(circle at ${100-x}% ${100-y}%, rgba(63, 185, 80, 0.05) 0%, transparent 50%)
    `;
  });
}
