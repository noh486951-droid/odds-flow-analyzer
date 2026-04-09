// ============================================================
// History Controller
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
    
    matches.sort((a, b) => {
      const aSig = isSignificantChange(a) ? 1 : 0;
      const bSig = isSignificantChange(b) ? 1 : 0;
      if (aSig !== bSig) return bSig - aSig;
      return new Date(a.commence_time) - new Date(b.commence_time);
    });
    
    this.grid.innerHTML = matches.map(m => createMatchCard(m)).join('');
  }
};
