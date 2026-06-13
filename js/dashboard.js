// ============================================================
// Dashboard Controller
// ============================================================
window.DashboardController = {
  init() {
    this.currentFilter = 'all';
    this.isHighProbMode = false;
    this.selectedDate = 'all';
    this.grid = document.getElementById('matchesGrid');
    
    // League Filters (Excluding toggle buttons)
    this.leagueBtns = document.querySelectorAll('#leagueFilter .filter-btn:not(.toggle-btn)');
    
    // High Prob Toggle
    this.highProbBtn = document.getElementById('highProbFilter');
    
    // Date Dropdown Filter
    this.dateFilter = document.getElementById('dateFilter');
    
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
    
    // Setup date filter dropdown listener
    if (this.dateFilter) {
      this.dateFilter.addEventListener('change', (e) => {
        this.selectedDate = e.target.value;
        if (AppState.currentData) {
          this.render(AppState.currentData);
        }
      });
    }
    
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
    
    // Helper to get local date string in Taipei timezone
    const getLocalDateStr = (isoString) => {
      const d = new Date(isoString);
      const formatter = new Intl.DateTimeFormat('zh-TW', {
        timeZone: 'Asia/Taipei',
        month: 'numeric',
        day: 'numeric',
        weekday: 'short'
      });
      return formatter.format(d).replace(/週(.)/, '($1)');
    };
    
    // Populate date dropdown once or when matches list loads
    if (this.dateFilter && !this.isPopulatingDates) {
      this.isPopulatingDates = true;
      const currentVal = this.dateFilter.value || 'all';
      
      const sortedAllMatches = Object.values(data.matches).sort((a, b) => new Date(a.commence_time) - new Date(b.commence_time));
      const uniqueDates = [];
      sortedAllMatches.forEach(m => {
        const dStr = getLocalDateStr(m.commence_time);
        if (!uniqueDates.includes(dStr)) {
          uniqueDates.push(dStr);
        }
      });
      
      let optionsHtml = '<option value="all">全部日期</option>';
      uniqueDates.forEach(date => {
        optionsHtml += `<option value="${date}">${date}</option>`;
      });
      this.dateFilter.innerHTML = optionsHtml;
      
      if (uniqueDates.includes(currentVal)) {
        this.dateFilter.value = currentVal;
        this.selectedDate = currentVal;
      } else {
        this.dateFilter.value = 'all';
        this.selectedDate = 'all';
      }
      this.isPopulatingDates = false;
    }
    
    const matches = Object.values(data.matches);
    let filtered = matches;
    
    // 1. Filter by League
    if (this.currentFilter !== 'all') {
      filtered = matches.filter(m => {
        const league = (m.league || '').toLowerCase();
        const filter = this.currentFilter.toLowerCase();
        if (filter === 'world_cup') {
          return league.includes('world') || league.includes('世足') || league.includes('fifa');
        }
        return league.includes(filter);
      });
    }
    
    // 2. Filter by Date
    if (this.selectedDate && this.selectedDate !== 'all') {
      filtered = filtered.filter(m => {
        return getLocalDateStr(m.commence_time) === this.selectedDate;
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
