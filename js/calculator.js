// ============================================================
// Parlay Calculator Controller
// ============================================================
window.CalculatorController = {
  init() {
    this.container = document.getElementById('parlayLegs');
    this.btnAdd = document.getElementById('addLegBtn');
    this.betInput = document.getElementById('betAmount');
    
    this.legCount = 0;
    
    // Bind events
    this.btnAdd.addEventListener('click', () => this.addLeg());
    this.betInput.addEventListener('input', () => this.calculate());
    
    // Add two default legs
    this.addLeg();
    this.addLeg();
  },
  
  addLeg() {
    this.legCount++;
    const id = `leg-${Date.now()}`;
    
    const div = document.createElement('div');
    div.className = 'leg-item';
    div.id = id;
    div.innerHTML = `
      <input type="number" class="calc-input leg-odds" placeholder="輸入賠率 (如: 1.85)" step="0.01" min="1.01">
      <button class="btn-remove-leg" onclick="CalculatorController.removeLeg('${id}')">×</button>
    `;
    
    this.container.appendChild(div);
    
    // Add event listener to the new input
    const input = div.querySelector('.leg-odds');
    input.addEventListener('input', () => this.calculate());
  },
  
  removeLeg(id) {
    const el = document.getElementById(id);
    if (el && this.container.children.length > 1) {
      el.remove();
      this.calculate();
    }
  },
  
  calculate() {
    const betAmount = parseFloat(this.betInput.value) || 0;
    const inputs = this.container.querySelectorAll('.leg-odds');
    
    let totalMultiplier = 1;
    let validLegs = 0;
    
    inputs.forEach(input => {
      const odds = parseFloat(input.value);
      if (odds > 1) {
        totalMultiplier *= odds;
        validLegs++;
      }
    });
    
    if (validLegs === 0) {
      document.getElementById('totalMultiplier').textContent = '-';
      document.getElementById('totalPayout').textContent = 'NT$ -';
      document.getElementById('totalProfit').textContent = 'NT$ -';
      return;
    }
    
    const payout = betAmount * totalMultiplier;
    const profit = payout - betAmount;
    
    document.getElementById('totalMultiplier').textContent = `${totalMultiplier.toFixed(2)}x`;
    document.getElementById('totalPayout').textContent = `NT$ ${payout.toFixed(0)}`;
    document.getElementById('totalProfit').textContent = `NT$ ${profit.toFixed(0)}`;
  }
};
