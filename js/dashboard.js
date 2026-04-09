// ============================================================
// Dashboard Controller
// ============================================================
window.DashboardController = {
  init() {
    this.currentFilter = 'all';
    this.grid = document.getElementById('matchesGrid');
    this.filterBtns = document.querySelectorAll('#leagueFilter .filter-btn');
    
    // Listen for data loaded event
    document.addEventListener('dataLoaded', (e) => {
      this.render(e.detail);
    });
    
    // Setup filters
    this.filterBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        this.filterBtns.forEach(b => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        this.currentFilter = e.currentTarget.getAttribute('data-league');
        if (AppState.currentData) {
          this.render(AppState.currentData);
        }
      });
    });
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
    
    // 排序：有顯著變動的(有AI分析的)排前面，然後按時間排序
    filtered.sort((a, b) => {
      const aSig = isSignificantChange(a) ? 1 : 0;
      const bSig = isSignificantChange(b) ? 1 : 0;
      if (aSig !== bSig) return bSig - aSig;
      return new Date(a.commence_time) - new Date(b.commence_time);
    });
    
    if (filtered.length === 0) {
      this.grid.innerHTML = '<div class="empty-state">此分類目前無賽事</div>';
      return;
    }
    
    this.grid.innerHTML = filtered.map(m => createMatchCard(m)).join('');
  }
};
