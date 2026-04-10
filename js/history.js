// ============================================================
// History Controller (v1.6.0 - 含比數 + AI 回測)
// ============================================================
window.HistoryController = {
  init() {
    this.dateInput = document.getElementById('historyDate');
    this.grid = document.getElementById('historyGrid');
    
    // 設定預設日期為今天
    const today = new Date();
    this.dateInput.value = today.toISOString().split('T')[0];
    this.dateInput.max = today.toISOString().split('T')[0];
    
    // 事件綁定
    document.getElementById('prevDate').addEventListener('click', () => this.changeDate(-1));
    document.getElementById('nextDate').addEventListener('click', () => this.changeDate(1));
    this.dateInput.addEventListener('change', () => this.loadHistory());
    
    // 自動載入今天的資料
    this.loadHistory();
  },
  
  changeDate(days) {
    const current = new Date(this.dateInput.value);
    current.setDate(current.getDate() + days);
    
    // 不允許選擇未來日期
    const maxDate = new Date();
    if (current > maxDate) return;
    
    this.dateInput.value = current.toISOString().split('T')[0];
    this.loadHistory();
  },
  
  async loadHistory() {
    const dateStr = this.dateInput.value; // YYYY-MM-DD
    this.grid.innerHTML = `
      <div class="loading-state">
        <div class="spinner"></div>
        <p>載入 ${dateStr} 的歷史數據...</p>
      </div>
    `;
    
    try {
      const url = AppConfig.archivePath.replace('{date}', dateStr);
      const res = await fetch(url + '?t=' + new Date().getTime());
      
      if (!res.ok) {
        throw new Error('No historical data found');
      }
      
      const data = await res.json();
      this.render(data);
    } catch (e) {
      this.grid.innerHTML = `
        <div class="empty-state">
          <span class="empty-icon">📂</span>
          <p>找不到 ${dateStr} 的存檔紀錄。</p>
          <p style="font-size: 0.8rem; opacity: 0.7; margin-top: 0.5rem;">可能當日無賽事或系統尚未開始追蹤</p>
        </div>
      `;
    }
  },
  
  render(data) {
    if (!data || !data.matches) return;
    const matches = Object.values(data.matches);
    
    // 計算 AI 命中率
    const aiMatches = matches.filter(m => m.ai_result && m.ai_result !== 'N/A');
    const hits = aiMatches.filter(m => m.ai_result === 'HIT').length;
    const misses = aiMatches.filter(m => m.ai_result === 'MISS').length;
    const pushes = aiMatches.filter(m => m.ai_result === 'PUSH').length;
    const total = hits + misses;
    const pct = total > 0 ? Math.round((hits / total) * 100) : 0;
    
    // 排序：已完成的在前，有AI結果的優先
    matches.sort((a, b) => {
      // 有比數的排前面
      const aScore = a.final_score ? 1 : 0;
      const bScore = b.final_score ? 1 : 0;
      if (aScore !== bScore) return bScore - aScore;
      // 有顯著變動的排前面
      const aSig = isSignificantChange(a) ? 1 : 0;
      const bSig = isSignificantChange(b) ? 1 : 0;
      if (aSig !== bSig) return bSig - aSig;
      return new Date(a.commence_time) - new Date(b.commence_time);
    });
    
    // 統計頭部
    let statsHtml = '';
    if (aiMatches.length > 0) {
      const pctColor = pct >= 60 ? '#2ecc71' : pct >= 40 ? '#f39c12' : '#e74c3c';
      statsHtml = `
        <div class="history-stats">
          <div class="history-stat-card">
            <span class="stat-emoji">🤖</span>
            <span class="stat-detail">AI 戰績</span>
            <span class="stat-big" style="color: ${pctColor}">${hits} 勝 ${misses} 負${pushes > 0 ? ` ${pushes} 和` : ''}</span>
          </div>
          <div class="history-stat-card">
            <span class="stat-emoji">🎯</span>
            <span class="stat-detail">命中率</span>
            <span class="stat-big" style="color: ${pctColor}">${pct}%</span>
          </div>
          <div class="history-stat-card">
            <span class="stat-emoji">📊</span>
            <span class="stat-detail">追蹤賽事</span>
            <span class="stat-big">${matches.length}</span>
          </div>
          <div class="history-stat-card">
            <span class="stat-emoji">✅</span>
            <span class="stat-detail">已結束</span>
            <span class="stat-big">${matches.filter(m => m.final_score).length}</span>
          </div>
        </div>
      `;
    }
    
    // 渲染卡片 (加上比數與結果)
    const cardsHtml = matches.map(m => this.createHistoryCard(m)).join('');
    
    this.grid.innerHTML = statsHtml + cardsHtml;
  },
  
  createHistoryCard(match) {
    // 基礎卡片
    let cardHtml = createMatchCard(match);
    
    // 注入比數
    if (match.final_score) {
      const [homeScore, awayScore] = match.final_score.split('-');
      const scoreHtml = `
        <div class="final-score-overlay">
          <span class="score-label">FINAL</span>
          <span class="score-value">${homeScore} - ${awayScore}</span>
        </div>
      `;
      // 在卡片的 match-header 後面插入比數
      cardHtml = cardHtml.replace('</div><!-- match-header-end -->', `</div>${scoreHtml}`);
      
      // 如果沒找到標記，用 class 尋找
      if (!cardHtml.includes('final-score-overlay')) {
        // Fallback: 在第一個 match-teams 之前插入
        cardHtml = cardHtml.replace('<div class="match-teams">', `${scoreHtml}<div class="match-teams">`);
      }
    }
    
    // 注入 AI 結果標籤
    if (match.ai_result && match.ai_result !== 'N/A') {
      const resultClass = match.ai_result === 'HIT' ? 'result-hit' : 
                          match.ai_result === 'MISS' ? 'result-miss' : 'result-push';
      const resultEmoji = match.ai_result === 'HIT' ? '✅' : 
                          match.ai_result === 'MISS' ? '❌' : '➖';
      const resultText = match.ai_result === 'HIT' ? '命中' : 
                         match.ai_result === 'MISS' ? '未中' : '和局';
      const badgeHtml = `<div class="ai-result-badge ${resultClass}">${resultEmoji} ${resultText}</div>`;
      
      // 在卡片開頭插入
      cardHtml = cardHtml.replace('<div class="match-card', `${badgeHtml}<div class="match-card`);
      // 用 wrapper 包住
      cardHtml = `<div class="history-card-wrapper ${resultClass}-border">${cardHtml}</div>`;
    }
    
    return cardHtml;
  }
};
