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
// 隊名中英對照表 (v1.8.1)
// ============================================================
const TEAM_NAME_ZH = {
  // --- 世足國家隊 (FIFA World Cup) ---
  "Argentina": "阿根廷",
  "France": "法國",
  "Brazil": "巴西",
  "England": "英格蘭",
  "Spain": "西班牙",
  "Germany": "德國",
  "Portugal": "葡萄牙",
  "Netherlands": "荷蘭",
  "Italy": "義大利",
  "Croatia": "克羅埃西亞",
  "Belgium": "比利時",
  "Uruguay": "烏拉圭",
  "Colombia": "哥倫比亞",
  "Morocco": "摩洛哥",
  "Japan": "日本",
  "South Korea": "南韓",
  "United States": "美國",
  "Mexico": "墨西哥",
  "Senegal": "塞內加爾",
  "Switzerland": "瑞士",
  "Denmark": "丹麥",
  "Sweden": "瑞典",
  "Poland": "波蘭",
  "Serbia": "塞爾維亞",
  "Canada": "加拿大",
  "Australia": "澳洲",
  "Saudi Arabia": "沙烏地阿拉伯",
  "Iran": "伊朗",
  "Ecuador": "厄瓜多",
  "Ghana": "迦納",
  "Cameroon": "喀麥隆",
  "Qatar": "卡達",

  // --- 其他常用國家隊與本輪賽事隊伍 ---
  "Haiti": "海地",
  "Scotland": "蘇格蘭",
  "Turkey": "土耳其",
  "Egypt": "埃及",
  "Norway": "挪威",
  "Curaçao": "庫拉索",
  "Cape Verde": "維德角",
  "Wales": "威爾斯",
  "Ukraine": "烏克蘭",
  "Peru": "秘魯",
  "Chile": "智利",
  "Costa Rica": "哥斯大黎加",
  "New Zealand": "紐西蘭",
  "Algeria": "阿爾及利亞",
  "Tunisia": "突尼西亞",
  "Nigeria": "奈及利亞",
  "Austria": "奧地利",
  "Greece": "希臘",
  "Czech Republic": "捷克",
  "Czechia": "捷克",
  "Honduras": "宏都拉斯",
  "Panama": "巴拿馬",
  "Jamaica": "牙買加",
  "Iraq": "伊拉克",
  "Venezuela": "委內瑞拉",
  "Paraguay": "巴拉圭",
  "Bolivia": "玻利維亞",
  "Slovakia": "斯洛伐克",
  "Slovenia": "斯洛維尼亞",
  "Finland": "芬蘭",
  "Ireland": "愛爾蘭",
  "Northern Ireland": "北愛爾蘭",
  "Iceland": "冰島",
  "Romania": "羅馬尼亞",
  "Bulgaria": "保加利亞",
  "Hungary": "匈牙利",
  "Albania": "阿爾巴尼亞",
  "Georgia": "喬治亞",
  "North Macedonia": "北馬其頓",
  "Montenegro": "蒙特內哥羅",
  "Bosnia and Herzegovina": "波士尼亞與赫塞哥維納",
  "Bosnia & Herzegovina": "波士尼亞與赫塞哥維納",
  "South Africa": "南非",
  "Ivory Coast": "象牙海岸",
  "Côte d'Ivoire": "象牙海岸",
  "DR Congo": "民主剛果",
  "Jordan": "約旦",
  "USA": "美國",
  "Uzbekistan": "烏茲別克"
};

/** 取得中文隊名，找不到就回傳原文 */
function getTeamNameZh(engName) {
  return TEAM_NAME_ZH[engName] || engName;
}

/** 格式化為「中文 (英)」，用於顯示 */
function formatTeamName(engName) {
  const zh = TEAM_NAME_ZH[engName];
  return zh ? `${zh}` : engName;
}

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

  // 自動開啟導覽 (如果是第一次拜訪)
  if (localStorage.getItem('tour_completed') !== 'true') {
    setTimeout(startAppTour, 1500);
  }
});

function setupNavigation() {
  const navBtns = document.querySelectorAll('.nav-btn');
  const panels = document.querySelectorAll('.view-panel');
  
  navBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      const targetBtn = e.currentTarget;
      const targetView = targetBtn.getAttribute('data-view');
      
      // 如果按鈕是導覽，跳過面板切換與 active class 更新
      if (!targetView) return;
      
      // Update active button
      navBtns.forEach(b => b.classList.remove('active'));
      targetBtn.classList.add('active');
      AppState.activeView = targetView;
      
      panels.forEach(p => p.classList.remove('active'));
      document.getElementById(`view-${targetView}`).classList.add('active');
    });
  });

  // 綁定導覽按鈕
  const tourBtn = document.getElementById('nav-tour');
  if (tourBtn) {
    tourBtn.addEventListener('click', () => {
      startAppTour();
    });
  }
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
  
  // 渲染賽程表
  renderSchedule(data);
}

// ============================================================
// Shared UI Components
// ============================================================
function renderTrueProbsBar(trueProbs, homeTeam, awayTeam) {
  if (!trueProbs || Object.keys(trueProbs).length === 0) return '';
  
  const probHome = trueProbs[homeTeam] || 0;
  const probAway = trueProbs[awayTeam] || 0;
  const probDraw = trueProbs['Draw'] || trueProbs.Draw || 0;
  
  if (probHome === 0 && probAway === 0 && probDraw === 0) return '';
  
  const total = probHome + probAway + probDraw;
  const pctHome = total > 0 ? (probHome / total) * 100 : 0;
  const pctDraw = total > 0 ? (probDraw / total) * 100 : 0;
  const pctAway = total > 0 ? (probAway / total) * 100 : 0;
  
  let drawLabelHtml = '';
  let drawSegmentHtml = '';
  
  if (probDraw > 0) {
    drawLabelHtml = `
      <span class="prob-lbl-item draw-lbl">
        <span class="prob-dot" style="background-color: #94A3B8;"></span>
        和局 ${probDraw.toFixed(1)}%
      </span>
    `;
    drawSegmentHtml = `<div class="prob-seg seg-draw" style="width: ${pctDraw}%" title="和局 ${probDraw.toFixed(1)}%"></div>`;
  }
  
  return `
    <div class="true-prob-container">
      <div class="true-prob-header">
        <span class="prob-title-text">🤖 AI 真實勝率預測</span>
      </div>
      <div class="true-prob-bar">
        <div class="prob-seg seg-home" style="width: ${pctHome}%" title="主勝 ${probHome.toFixed(1)}%"></div>
        ${drawSegmentHtml}
        <div class="prob-seg seg-away" style="width: ${pctAway}%" title="客勝 ${probAway.toFixed(1)}%"></div>
      </div>
      <div class="true-prob-labels">
        <span class="prob-lbl-item home-lbl">
          <span class="prob-dot" style="background-color: #10B981;"></span>
          主勝 ${probHome.toFixed(1)}%
        </span>
        ${drawLabelHtml}
        <span class="prob-lbl-item away-lbl">
          <span class="prob-dot" style="background-color: #3B82F6;"></span>
          客勝 ${probAway.toFixed(1)}%
        </span>
      </div>
    </div>
  `;
}

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

    // 急速移動與反向指標標籤
    let sharpHtml = '';
    const sharp = match.sharp_moves || [];
    if (sharp.length > 0) {
      sharpHtml += sharp.map(s => 
        `<div class="alert-tag sharp-tag">${s.level}</div>`
      ).join('');
    }
    const rlm = match.reverse_line_movement || [];
    if (rlm.length > 0) {
      sharpHtml += `<div class="alert-tag sharp-tag">🚨 反向指標</div>`;
    }

    // 晉級與輪休標籤
    let advHtml = '';
    if (match.advancement_status) {
      advHtml = `<div class="alert-tag rotation-tag" title="${match.advancement_status}">⚠️ 輪休風險</div>`;
    }

    // Elo 差距標籤
    let eloHtml = '';
    if (Math.abs(match.elo_diff || 0) > 200) {
      eloHtml = `<div class="alert-tag" style="background:var(--primary);color:#fff;">⚔️ 實力懸殊</div>`;
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
    const probHtml = renderTrueProbsBar(match.true_probs, match.home_team, match.away_team);

    let aiHtml = '';
    if (match.ai_analysis) {
      // 美化 AI 錯誤訊息，把技術性英文換成中文提示
      let displayAnalysis = match.ai_analysis;
      if (displayAnalysis.includes('429') || displayAnalysis.includes('quota') || displayAnalysis.includes('exceeded')) {
        displayAnalysis = 'AI 分析今日已達免費額度上限，明日下午自動恢復。請參考勝率數據判斷。';
      } else if (displayAnalysis.includes('API 錯誤') || displayAnalysis.includes('failed')) {
        displayAnalysis = 'AI 分析暫時無法使用，請參考勝率數據判斷。';
      }
      
      // 擷取預測比分與大小球 Highlight
      let predictionHighlightsHtml = '';
      const scoreMatch = displayAnalysis.match(/【?🎯\s*預測比分：([^】\n]*)/);
      const ouMatch = displayAnalysis.match(/【?⚽\s*大小球推薦：([^】\n]*)/);
      
      let highlights = [];
      if (scoreMatch) {
        highlights.push(`🎯 預測比分：${scoreMatch[1].replace(/】/g, '').trim()}`);
      }
      if (ouMatch) {
        highlights.push(`⚽ 大小推薦：${ouMatch[1].replace(/】/g, '').trim()}`);
      }
      
      // 清理所有分析中含括號的欄位，以免顯示在卡片預覽文字中
      displayAnalysis = displayAnalysis
        .replace(/【?🤖\s*勝平負判斷：[^】\n]*】?/g, '')
        .replace(/【?🎯\s*最可能比分：[^】\n]*】?/g, '')
        .replace(/【?📊\s*至少1球機率：[^】\n]*】?/g, '')
        .replace(/【?📊\s*至少2球機率：[^】\n]*】?/g, '')
        .replace(/【?📊\s*雙方進球機率：[^】\n]*】?/g, '')
        .replace(/【?🎯\s*預測比分：[^】\n]*】?/g, '')
        .replace(/【?⚽\s*大小球推薦：[^】\n]*】?/g, '');
      
      if (highlights.length > 0) {
        predictionHighlightsHtml = `<div style="margin-top: 8px; display: flex; flex-direction: column; gap: 6px;">` +
          highlights.map(h => `<div style="padding: 6px; background: rgba(37, 99, 235, 0.08); border: 1px solid rgba(37, 99, 235, 0.15); border-radius: 6px; font-weight: bold; color: var(--primary); font-size: 0.95rem;">${h}</div>`).join('') +
          `</div>`;
      }

      const shortAnalysis = displayAnalysis.length > 120 
        ? displayAnalysis.substring(0, 120) + '...' 
        : displayAnalysis;
      aiHtml = `
        <div class="ai-analysis">
          <div class="ai-header">
            <span>🤖 AI 診斷分析</span>
          </div>
          <div class="ai-content">
            ${shortAnalysis}
            ${predictionHighlightsHtml}
          </div>
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
          ${advHtml}
          ${eloHtml}
          ${weatherHtml}
        </div>
        
        <div class="other-markets">
          ${otherMarketsHtml}
        </div>
        
        <div class="match-teams">
          <div class="team-row">
            <span class="team-name">${formatTeamName(match.home_team)} (主)</span>
            <div class="odds-box">
              <span class="odds-opening">${homeOpen.toFixed(2)}</span>
              <span class="odds-current">${homeOdds.toFixed(2)}</span>
              <span class="odds-change ${homeChange.cls}">${homeChange.icon}</span>
            </div>
          </div>
          <div class="team-row">
            <span class="team-name">${formatTeamName(match.away_team)} (客)</span>
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
        <div class="card-footer-hint" style="
          text-align: center;
          font-size: 0.95rem;
          font-weight: 700;
          color: #FFFFFF !important;
          background: linear-gradient(135deg, #2563EB, #3B82F6) !important;
          padding: 0.65rem;
          margin-top: 1rem;
          border-radius: 8px;
          box-shadow: 0 2px 4px rgba(37, 99, 235, 0.2);
          display: flex;
          justify-content: center;
          align-items: center;
          gap: 0.4rem;
          border: none !important;
          opacity: 1 !important;
          cursor: pointer;
        ">📋 點擊查看完整分析</div>
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
      ${h2h.map(h => `<tr><td>${h.date}</td><td>${formatTeamName(h.home)}</td><td class="h2h-score">${h.score}</td><td>${formatTeamName(h.away)}</td></tr>`).join('')}
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

      const homeChartSvg = makeTeamChart(homeVals, 'var(--primary)', formatTeamName(homeTeam));
      const awayChartSvg = makeTeamChart(awayVals, 'var(--warning)', formatTeamName(awayTeam));

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
    
    // Extract predicted score and over/under
    let modalHighlightsHtml = '';
    const scoreMatch = displayAnalysis.match(/【?🎯\s*預測比分：([^】\n]*)/);
    const ouMatch = displayAnalysis.match(/【?⚽\s*大小球推薦：([^】\n]*)/);
    let modalHighlights = [];
    
    if (scoreMatch) {
      modalHighlights.push(`<div style="flex: 1; min-width: 200px; padding: 0.75rem; background: rgba(37, 99, 235, 0.08); border: 1.5px solid rgba(37, 99, 235, 0.2); border-radius: 8px; font-weight: 800; color: var(--primary); text-align: center; font-size: 1.1rem;">🎯 預測比分：${scoreMatch[1].replace(/】/g, '').trim()}</div>`);
    }
    if (ouMatch) {
      modalHighlights.push(`<div style="flex: 1; min-width: 200px; padding: 0.75rem; background: rgba(16, 185, 129, 0.08); border: 1.5px solid rgba(16, 185, 129, 0.2); border-radius: 8px; font-weight: 800; color: #059669; text-align: center; font-size: 1.1rem;">⚽ 大小推薦：${ouMatch[1].replace(/】/g, '').trim()}</div>`);
    }
    
    if (modalHighlights.length > 0) {
      modalHighlightsHtml = `<div style="display: flex; gap: 0.75rem; margin-bottom: 1rem; flex-wrap: wrap;">${modalHighlights.join('')}</div>`;
    }

    // Extract table prediction fields
    const wdlMatch = displayAnalysis.match(/【?🤖\s*勝平負判斷：([^】\n]*)/);
    const optScoresMatch = displayAnalysis.match(/【?🎯\s*最可能比分：([^】\n]*)/);
    const prob1Match = displayAnalysis.match(/【?📊\s*至少1球機率：([^】\n]*)/);
    const prob2Match = displayAnalysis.match(/【?📊\s*至少2球機率：([^】\n]*)/);
    const bttsMatch = displayAnalysis.match(/【?📊\s*雙方進球機率：([^】\n]*)/);

    let aiPredictTable = '';
    if (wdlMatch || optScoresMatch || prob1Match || prob2Match || bttsMatch) {
      const wdl = wdlMatch ? wdlMatch[1].trim() : '--';
      const optScores = optScoresMatch ? optScoresMatch[1].trim() : '--';
      const prob1 = prob1Match ? prob1Match[1].trim() : '--';
      const prob2 = prob2Match ? prob2Match[1].trim() : '--';
      const btts = bttsMatch ? bttsMatch[1].trim() : '--';
      
      aiPredictTable = `
        <div class="ai-predict-table" style="width:100%; border:1px solid rgba(226, 232, 240, 0.8); border-radius:12px; background:var(--bg-main); overflow:hidden; margin-bottom:1.2rem; box-shadow:var(--shadow-sm);">
          <div class="table-grid-header" style="display:grid; grid-template-columns:repeat(5, 1fr); background:#0F172A; color:#FFFFFF; font-weight:700; padding:0.65rem; text-align:center; font-size:0.85rem; letter-spacing:0.5px;">
            <div>勝平負判斷</div>
            <div>最可能比分</div>
            <div>至少 1 球</div>
            <div>至少 2 球</div>
            <div>雙方進球</div>
          </div>
          <div class="table-grid-body" style="display:grid; grid-template-columns:repeat(5, 1fr); padding:0.85rem; text-align:center; font-weight:800; color:var(--text-main); background:var(--bg-card); align-items:center; font-size:0.95rem; border-top:1px solid rgba(226, 232, 240, 0.8);">
            <div style="color:#2563EB;">${wdl}</div>
            <div style="color:var(--text-main);">${optScores}</div>
            <div style="color:#10B981;">${prob1}</div>
            <div style="color:#F59E0B;">${prob2}</div>
            <div style="color:#EF4444;">${btts}</div>
          </div>
        </div>
      `;
    }

    // Clean up all prediction fields from textual paragraph
    displayAnalysis = displayAnalysis
      .replace(/【?🤖\s*勝平負判斷：[^】\n]*】?/g, '')
      .replace(/【?🎯\s*最可能比分：[^】\n]*】?/g, '')
      .replace(/【?📊\s*至少1球機率：[^】\n]*】?/g, '')
      .replace(/【?📊\s*至少2球機率：[^】\n]*】?/g, '')
      .replace(/【?📊\s*雙方進球機率：[^】\n]*】?/g, '')
      .replace(/【?🎯\s*預測比分：[^】\n]*】?/g, '')
      .replace(/【?⚽\s*大小球推薦：[^】\n]*】?/g, '');
    
    aiHtml = `
      ${modalHighlightsHtml}
      ${aiPredictTable}
      <div class="ai-content modal-ai">${displayAnalysis}</div>
    `;
  }

  // 晉級與輪休警告
  let advModalHtml = '';
  if (match.advancement_status) {
    advModalHtml = `
      <div class="modal-rotation-alert">
        <span class="warning-icon">⚠️</span>
        <div class="warning-content">
          <div class="warning-title">主力輪休／晉級狀態警示</div>
          <div class="warning-desc">${match.advancement_status}</div>
        </div>
      </div>
    `;
  }

  content.innerHTML = `
    <div class="modal-header-bar">
      <h2>${formatTeamName(match.home_team)} vs ${formatTeamName(match.away_team)}</h2>
      <button class="modal-close-btn" onclick="closeMatchDetail()">✕</button>
    </div>
    <div class="modal-meta">${match.league} | 開賽: ${formatTime(match.commence_time)}</div>

    ${renderTrueProbsBar(match.true_probs, match.home_team, match.away_team)}
    ${advModalHtml}

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
      ${renderFormDetail(match.home_form, formatTeamName(match.home_team))}
      ${renderFormDetail(match.away_form, formatTeamName(match.away_team))}
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
  
  renderList(newsData.world_cup, 'worldCupNewsList');
}

// ============================================================
// Schedule Rendering (Taiwan Time)
// ============================================================
function renderSchedule(data) {
  const container = document.getElementById('scheduleList');
  if (!container) return;
  if (!data || !data.matches || Object.keys(data.matches).length === 0) {
    container.innerHTML = '<div class="empty-state">目前無賽程資料</div>';
    return;
  }

  // 將 object 轉為 array 並按時間排序
  const matches = Object.values(data.matches).sort((a, b) => {
    return new Date(a.commence_time) - new Date(b.commence_time);
  });

  const formatter = new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });

  const html = matches.map(match => {
    const d = new Date(match.commence_time);
    let timeStr = formatter.format(d);
    // 替換 "週三" 為 "(三)"
    timeStr = timeStr.replace(/週(.)/, '($1)');

    return `
      <div class="schedule-item" onclick="openMatchDetail('${match.id}')" style="cursor:pointer;" title="點擊查看分析">
        <div class="schedule-time">${timeStr}</div>
        <div class="schedule-teams">
          ${formatTeamName(match.home_team)} <span style="color:var(--text-muted);font-size:0.9rem;margin:0 10px;">vs</span> ${formatTeamName(match.away_team)}
        </div>
        <div class="schedule-league">${match.league || '世足賽'}</div>
      </div>
    `;
  }).join('');

  container.innerHTML = html;
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

// ============================================================
// Onboarding Guided Tour
// ============================================================
let currentTourStep = 0;
const tourSteps = [
  {
    title: "👋 歡迎使用 Odds Flow 分析器",
    desc: "這是由 AI 驅動的運彩盤口分析系統，整合即時看板、盤口走勢、AI 數據預估對照表與串關計算。讓我用 30 秒帶您熟悉核心功能！",
    view: "dashboard",
    buttonText: "🚀 開始導覽"
  },
  {
    title: "📊 即時看板：變動與警示",
    desc: "在此展示所有進行中的賽事。當盤口賠率相較初盤有顯著變動時，系統會自動以紅框標示，並在卡片頂部亮起輪休、疲勞或資金流警示。",
    view: "dashboard",
    buttonText: "下一頁"
  },
  {
    title: "📅 智能篩選：精準過濾",
    desc: "您可以使用日期下拉選單，或點擊「💎 高勝率」快速過濾出任一盤口真實勝率 ≥ 60% 且具備 AI 分析的焦點賽事。",
    view: "dashboard",
    buttonText: "下一頁"
  },
  {
    title: "🤖 AI 勝率與預測數據表",
    desc: "每場比賽底部均有真實勝率體力條。點擊「查看完整分析」即可閱讀 AI 預估比分（含信心度）、大小球，以及本次新增的勝平負與進球率預估對照表！",
    view: "dashboard",
    buttonText: "下一頁"
  },
  {
    title: "📅 歷史回顧：回測與戰績",
    desc: "選擇過去的日期，即可查看完賽比數，並統計 AI 預測的精準命中率（包含命中、未中、和局）。AI 也會自動上網搜尋補全當日交手紀錄。",
    view: "history",
    buttonText: "下一頁"
  },
  {
    title: "🗓️ 台灣賽程：開賽追蹤",
    desc: "此專區將所有世足比賽時間自動轉換為台北時間 (UTC+8)，讓您隨時隨地精準掌握開賽時間。",
    view: "schedule",
    buttonText: "下一頁"
  },
  {
    title: "🧮 串關計算機：投注規劃",
    desc: "可自由新增多關賽事賠率，自動為您計算串關總倍率、投注總獎金與淨利潤，是您投注規劃的得力助手。",
    view: "calculator",
    buttonText: "下一頁"
  },
  {
    title: "🎉 導覽完成！",
    desc: "您已掌握 Odds Flow 的所有核心功能。隨時可以點擊導航欄最後的「重看導覽」按鈕再次閱讀。祝您投注順利、百戰百勝！",
    view: "dashboard",
    buttonText: "開始體驗"
  }
];

function startAppTour() {
  currentTourStep = 0;
  showTourStep(0);
}

function showTourStep(stepIndex) {
  const existing = document.getElementById('tour-guide-overlay');
  if (existing) existing.remove();

  if (stepIndex >= tourSteps.length) {
    localStorage.setItem('tour_completed', 'true');
    return;
  }

  const step = tourSteps[stepIndex];
  
  if (step.view) {
    const navBtn = document.getElementById(`nav-${step.view}`);
    if (navBtn) {
      navBtn.click();
    }
  }

  const overlay = document.createElement('div');
  overlay.id = 'tour-guide-overlay';
  overlay.style.cssText = `
    position: fixed; inset: 0; z-index: 9999;
    background: rgba(15, 23, 42, 0.4);
    display: flex; justify-content: center; align-items: flex-end;
    pointer-events: none;
    padding: 2rem;
  `;

  overlay.innerHTML = `
    <div style="
      background: #1E2442; border: 1.5px solid #6366F1; border-radius: 20px;
      max-width: 480px; width: 100%; padding: 1.75rem; position: relative;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5);
      animation: modalSlideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      display: flex; flex-direction: column; gap: 1rem;
      pointer-events: auto;
      color: #FFFFFF;
      font-family: system-ui, -apple-system, sans-serif;
    ">
      <!-- 步驟數 -->
      <div style="color: #818CF8; font-size: 0.85rem; font-weight: 700; letter-spacing: 1px;">
        第 ${stepIndex + 1} 步 / 共 ${tourSteps.length} 步
      </div>

      <!-- 標題 -->
      <h3 style="margin: 0; color: #FFFFFF; font-size: 1.25rem; font-weight: 800;">
        ${step.title}
      </h3>

      <!-- 說明文 -->
      <p style="margin: 0; color: #E2E8F0; font-size: 0.95rem; line-height: 1.55;">
        ${step.desc}
      </p>

      <!-- 按鈕區 -->
      <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 0.5rem;">
        <button id="tourSkipBtn" style="
          background: transparent; border: none; color: #94A3B8;
          font-size: 0.9rem; font-weight: 600; cursor: pointer; padding: 0.5rem;
          transition: color 0.2s;
        " onmouseover="this.style.color='#CBD5E1'" onmouseout="this.style.color='#94A3B8'">
          跳過導覽
        </button>
        <button id="tourNextBtn" style="
          background: linear-gradient(135deg, #818CF8, #6366F1); color: #FFFFFF;
          border: none; padding: 0.6rem 1.4rem; border-radius: 10px;
          font-weight: 700; cursor: pointer; transition: all 0.2s;
          font-size: 0.95rem; box-shadow: 0 4px 12px rgba(99, 102, 241, 0.35);
        " onmouseover="this.style.transform='translateY(-1px)'" onmouseout="this.style.transform='translateY(0)'">
          ${step.buttonText}
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  document.getElementById('tourSkipBtn').addEventListener('click', () => {
    overlay.remove();
    localStorage.setItem('tour_completed', 'true');
  });

  document.getElementById('tourNextBtn').addEventListener('click', () => {
    showTourStep(stepIndex + 1);
  });
}

