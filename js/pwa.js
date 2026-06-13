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
});

function showReleaseNotes() {
  const version = "1.8.5";
  if (localStorage.getItem('release_notes_seen') === version) {
    checkAndShowPWA();
    return;
  }

  const modal = document.createElement('div');
  modal.className = 'pwa-ios-modal'; // 重用黑色半透明背景
  modal.style.zIndex = '3000';
  modal.style.alignItems = 'center';
  modal.innerHTML = `
    <div class="modal-card" style="position:relative; z-index:3001; max-width:500px; width:90%; padding:2rem; text-align:left; background:var(--bg-card); border-radius:16px; border:1px solid var(--border);">
      <h2 style="color:var(--primary); margin-bottom:1rem; font-size:1.5rem; text-align:center;">🎉 版本更新 v1.8.5</h2>
      <ul style="line-height:1.8; margin-left:1.5rem; color:var(--text-main); font-size:1.05rem; margin-bottom:1.5rem;">
        <li>✨ <strong>全新明亮主題</strong>：清晰好閱讀，不傷眼</li>
        <li>📱 <strong>App 模式</strong>：支援一鍵安裝到手機桌面</li>
        <li>🗓️ <strong>台灣賽程表</strong>：自動轉換本地時間 (UTC+8)</li>
        <li>🤖 <strong>AI 搜網升級</strong>：自動參考網路鄉民看好度與風向</li>
        <li>📊 <strong>歷史回顧擴充</strong>：新增 12、13 號賽事回顧</li>
      </ul>
      <button id="closeNotesBtn" style="width:100%; background:var(--primary); color:#fff; padding:1rem; border:none; border-radius:8px; font-size:1.1rem; cursor:pointer; font-weight:bold; box-shadow:0 4px 12px rgba(37, 99, 235, 0.3);">開始體驗</button>
    </div>
  `;
  document.body.appendChild(modal);

  document.getElementById('closeNotesBtn').addEventListener('click', () => {
    modal.remove();
    localStorage.setItem('release_notes_seen', version);
    setTimeout(checkAndShowPWA, 600); // 關閉後再顯示 PWA 提示
  });
}

function checkAndShowPWA() {
  const isIos = /iphone|ipad|ipod/.test(window.navigator.userAgent.toLowerCase());
  const isInStandaloneMode = ('standalone' in window.navigator) && (window.navigator.standalone);

  if (isInStandaloneMode) return; // 已經是 App 模式就不干擾

  if (isIos) {
    showIosInstallPrompt();
  } else {
    const isMobile = /android|mobile/.test(window.navigator.userAgent.toLowerCase());
    if (deferredPrompt) {
      showAndroidInstallPrompt();
    } else if (isMobile) {
      showGenericAndroidPrompt();
    }
  }
}

function showAndroidInstallPrompt() {
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
      console.log(\`User response to the install prompt: \${outcome}\`);
      deferredPrompt = null;
    }
  });

  document.getElementById('pwaCloseBtn').addEventListener('click', () => {
    banner.remove();
    localStorage.setItem('pwa_prompt_dismissed', 'true');
  });
}

function showGenericAndroidPrompt() {
  if (localStorage.getItem('pwa_prompt_dismissed')) return;
  const banner = document.createElement('div');
  banner.className = 'pwa-banner';
  banner.innerHTML = `
    <div class="pwa-content">
      <span class="pwa-icon">⚽</span>
      <div>
        <div class="pwa-title">取得全螢幕 App 體驗</div>
        <div class="pwa-desc">點擊瀏覽器選單 (⋮) 選擇「加到主畫面」</div>
      </div>
    </div>
    <div class="pwa-actions">
      <button id="pwaCloseBtn" class="pwa-btn-close">✕</button>
    </div>
  `;
  document.body.appendChild(banner);
  document.getElementById('pwaCloseBtn').addEventListener('click', () => {
    banner.remove();
    localStorage.setItem('pwa_prompt_dismissed', 'true');
  });
}

function showIosInstallPrompt() {
  if (localStorage.getItem('ios_pwa_dismissed')) return;

  const modal = document.createElement('div');
  modal.className = 'pwa-ios-modal';
  modal.innerHTML = `
    <div class="pwa-ios-content">
      <button id="iosPwaCloseBtn" class="pwa-btn-close" style="position:absolute; right:15px; top:15px; color:var(--text-muted);">✕</button>
      <h3 style="color:var(--text-main); margin-bottom:10px;">💡 蘋果手機專屬</h3>
      <p style="color:var(--text-muted); margin-bottom:15px;">想要獲得無干擾的全螢幕 App 體驗嗎？</p>
      <div style="background:rgba(0,0,0,0.05); padding:1rem; border-radius:12px;">
        <ol style="text-align:left; margin:0 0 0 20px; font-size:1rem; color:var(--text-main); line-height:1.6;">
          <li>點擊瀏覽器底部的 <strong>分享</strong> 按鈕 <svg viewBox="0 0 50 50" width="18" height="18" style="vertical-align:middle; color:var(--primary);"><path fill="currentColor" d="M25,2 L25,25 M15,12 L25,2 L35,12 M10,20 L10,40 C10,45 15,48 25,48 C35,48 40,45 40,40 L40,20" stroke="currentColor" stroke-width="4" fill="none"/></svg></li>
          <li>往下滑動並選擇 <strong>「加入主畫面」</strong> ⊕</li>
        </ol>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  document.getElementById('iosPwaCloseBtn').addEventListener('click', () => {
    modal.remove();
    localStorage.setItem('ios_pwa_dismissed', 'true');
  });
}

window.addEventListener('DOMContentLoaded', () => {
  // 延遲 800 毫秒後顯示版本說明，避免網頁還沒渲染完就跳出
  setTimeout(showReleaseNotes, 800);
});
