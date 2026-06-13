// 註冊 Service Worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').then(reg => {
      console.log('ServiceWorker 註冊成功:', reg.scope);
    }).catch(err => {
      console.log('ServiceWorker 註冊失敗:', err);
    });
  });
}

// Android: 攔截安裝提示
let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  showAndroidInstallPrompt();
});

function showAndroidInstallPrompt() {
  // 如果已經安裝或被關閉過，就不再顯示
  if (localStorage.getItem('pwa_prompt_dismissed')) return;

  const banner = document.createElement('div');
  banner.className = 'pwa-banner';
  banner.innerHTML = `
    <div class="pwa-content">
      <span class="pwa-icon">⚽</span>
      <div>
        <div class="pwa-title">取得全螢幕體驗</div>
        <div class="pwa-desc">一鍵安裝世足分析 App</div>
      </div>
    </div>
    <div class="pwa-actions">
      <button id="pwaInstallBtn" class="pwa-btn-install">安裝</button>
      <button id="pwaCloseBtn" class="pwa-btn-close">✕</button>
    </div>
  `;
  document.body.appendChild(banner);

  document.getElementById('pwaInstallBtn').addEventListener('click', async () => {
    banner.remove();
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      console.log(`User response to the install prompt: ${outcome}`);
      deferredPrompt = null;
    }
  });

  document.getElementById('pwaCloseBtn').addEventListener('click', () => {
    banner.remove();
    localStorage.setItem('pwa_prompt_dismissed', 'true');
  });
}

// iOS: 偵測並顯示教學
function showIosInstallPrompt() {
  const isIos = /iphone|ipad|ipod/.test(window.navigator.userAgent.toLowerCase());
  const isInStandaloneMode = ('standalone' in window.navigator) && (window.navigator.standalone);

  if (isIos && !isInStandaloneMode) {
    if (localStorage.getItem('ios_pwa_dismissed')) return;

    const modal = document.createElement('div');
    modal.className = 'pwa-ios-modal';
    modal.innerHTML = `
      <div class="pwa-ios-content">
        <button id="iosPwaCloseBtn" class="pwa-btn-close" style="position:absolute; right:10px; top:10px; color:#fff;">✕</button>
        <h3>💡 蘋果用戶專屬</h3>
        <p>想要獲得全螢幕的 App 體驗嗎？</p>
        <ol style="text-align:left; margin:10px 0 10px 20px; font-size:0.9rem;">
          <li>點擊瀏覽器底部的 <strong>分享</strong> 按鈕 <svg viewBox="0 0 50 50" width="16" height="16" style="vertical-align:middle"><path fill="currentColor" d="M25,2 L25,25 M15,12 L25,2 L35,12 M10,20 L10,40 C10,45 15,48 25,48 C35,48 40,45 40,40 L40,20" stroke="currentColor" stroke-width="4" fill="none"/></svg></li>
          <li>往下滑動並選擇 <strong>「加入主畫面」</strong> ⊕</li>
        </ol>
      </div>
    `;
    document.body.appendChild(modal);

    document.getElementById('iosPwaCloseBtn').addEventListener('click', () => {
      modal.remove();
      localStorage.setItem('ios_pwa_dismissed', 'true');
    });
  }
}

// 畫面載入後檢查
window.addEventListener('DOMContentLoaded', () => {
  showIosInstallPrompt();
});
