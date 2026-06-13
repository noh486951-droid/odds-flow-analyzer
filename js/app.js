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
      const scoreMatch = displayAnalysis.match(/預測比分：([^】\n]*)/);
      const ouMatch = displayAnalysis.match(/大小球推薦：([^】\n]*)/);
      
      let highlights = [];
      if (scoreMatch) {
        highlights.push(`🎯 預測比分：${scoreMatch[1].replace(/】/g, '').trim()}`);
        displayAnalysis = displayAnalysis.replace(/【?🎯\s*預測比分：[^】\n]*】?/g, '');
      }
      if (ouMatch) {
        highlights.push(`⚽ 大小推薦：${ouMatch[1].replace(/】/g, '').trim()}`);
        displayAnalysis = displayAnalysis.replace(/【?⚽\s*大小球推薦：[^】\n]*】?/g, '');
      }
      
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
    const scoreMatch = displayAnalysis.match(/預測比分：([^】\n]*)/);
    const ouMatch = displayAnalysis.match(/大小球推薦：([^】\n]*)/);
    let modalHighlights = [];
    
    if (scoreMatch) {
      modalHighlights.push(`<div style="flex: 1; min-width: 200px; padding: 0.75rem; background: rgba(37, 99, 235, 0.08); border: 1.5px solid rgba(37, 99, 235, 0.2); border-radius: 8px; font-weight: 800; color: var(--primary); text-align: center; font-size: 1.1rem;">🎯 預測比分：${scoreMatch[1].replace(/】/g, '').trim()}</div>`);
      displayAnalysis = displayAnalysis.replace(/【?🎯\s*預測比分：[^】\n]*】?/g, '');
    }
    if (ouMatch) {
      modalHighlights.push(`<div style="flex: 1; min-width: 200px; padding: 0.75rem; background: rgba(16, 185, 129, 0.08); border: 1.5px solid rgba(16, 185, 129, 0.2); border-radius: 8px; font-weight: 800; color: #059669; text-align: center; font-size: 1.1rem;">⚽ 大小推薦：${ouMatch[1].replace(/】/g, '').trim()}</div>`);
      displayAnalysis = displayAnalysis.replace(/【?⚽\s*大小球推薦：[^】\n]*】?/g, '');
    }
    
    if (modalHighlights.length > 0) {
      modalHighlightsHtml = `<div style="display: flex; gap: 0.75rem; margin-bottom: 1rem; flex-wrap: wrap;">${modalHighlights.join('')}</div>`;
    }
    
    aiHtml = `
      ${modalHighlightsHtml}
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
