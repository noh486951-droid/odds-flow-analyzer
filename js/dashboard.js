// ============================================================
// Dashboard Controller
// ============================================================
window.DashboardController = {
  init() {
    this.currentFilter = 'all';
    this.isHighProbMode = false;
    this.grid = document.getElementById('matchesGrid');
    
    // League Filters (Excluding toggle buttons)
    this.leagueBtns = document.querySelectorAll('#leagueFilter .filter-btn:not(.toggle-btn)');
    
    // High Prob Toggle
    this.highProbBtn = document.getElementById('highProbFilter');
    
    // Listen for data loaded event
    document.addEventListener('dataLoaded', (e) => {
      this.render(e.detail);
    });
    
    // Setup league filters
    this.leagueBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        this.leagueBtns.forEach(b => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        this.currentFilter = e.currentTarget.getAttribute('data-league');
        if (AppState.currentData) {
          this.render(AppState.currentData);
        }
      });
    });
    
    // Setup high probability toggle
    if (this.highProbBtn) {
      this.highProbBtn.addEventListener('click', (e) => {
        this.isHighProbMode = !this.isHighProbMode;
        if (this.isHighProbMode) {
          this.highProbBtn.classList.add('active-toggle');
        } else {
          this.highProbBtn.classList.remove('active-toggle');
        }
        if (AppState.currentData) {
          this.render(AppState.currentData);
        }
      });
    }
  },
  
  render(data) {
    if (!data || !data.matches) {
      this.grid.innerHTML = '<div class="empty-state">暫無比賽數據</div>';
      return;
    }
    
    const matches = Object.values(data.matches);
    let filtered = matches;
    
    if (this.currentFilter !== 'all') {
      filtered = matches.filter(m => {
        const league = (m.league || '').toLowerCase();
        const filter = this.currentFilter.toLowerCase();
        // 如果是 soccer，涵蓋所有包含 'epl', 'la liga', 'ucl' 等的聯賽
        if (filter === 'soccer') {
          return !league.includes('nba') && !league.includes('basketball');
        }
        return league.includes(filter);
      });
    }
    
    // High Probability Filter (> 60% win rate + AI analysis)
    if (this.isHighProbMode) {
      filtered = filtered.filter(m => {
        let isHighProb = false;
        
        // 1. Check true_probs
        if (m.true_probs) {
           for (const prob of Object.values(m.true_probs)) {
               if (prob >= 60.0) isHighProb = true;
           }
        }
        
        // 2. Check other_markets (spreads/totals/btts)
        if (!isHighProb && m.other_markets) {
           for (const mk of ["spreads", "totals", "btts"]) {
               if (m.other_markets[mk]) {
                   for (const val of Object.values(m.other_markets[mk])) {
                       if (val.prob && val.prob >= 60.0) {
                           isHighProb = true;
                       }
                   }
               }
           }
        }
        
        if (!isHighProb) return false;
        
        // 3. 確保 AI 有實際分析過 (排除 rule_based 及額度已用滿的情況)
        if (!m.ai_analysis || m.analysis_source === 'rule_based' || m.ai_analysis.includes('429') || m.ai_analysis.includes('quota') || m.ai_analysis.includes('exceeded') || m.ai_analysis.includes('額度已用完')) {
            return false;
        }

        return true;
      });
    }
    
    // 排序：有顯著變動的(有AI分析的)排前面，然後按時間排序
    filtered.sort((a, b) => {
      const aSig = isSignificantChange(a) ? 1 : 0;
      const bSig = isSignificantChange(b) ? 1 : 0;
      if (aSig !== bSig) return bSig - aSig;
      return new Date(a.commence_time) - new Date(b.commence_time);
    });
    
    if (filtered.length === 0) {
      const msg = this.isHighProbMode ? '此分類目前無 AI 勝率高於 60% 的焦點賽事' : '此分類目前無賽事';
      this.grid.innerHTML = `<div class="empty-state">${msg}</div>`;
      return;
    }
    
    this.grid.innerHTML = filtered.map(m => createMatchCard(m)).join('');
  }
};
