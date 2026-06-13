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

// ============================================================
//  版本更新說明 + PWA 引導
// ============================================================
const CURRENT_VERSION = "1.9.3";

function showReleaseNotes() {
  // 每個版本只顯示一次
  if (localStorage.getItem('release_notes_seen') === CURRENT_VERSION) {
    checkAndShowPWA();
    return;
  }

  const overlay = document.createElement('div');
  overlay.id = 'release-notes-overlay';
  overlay.style.cssText = `
    position:fixed; inset:0; z-index:9999;
    background:rgba(0,0,0,0.6);
    display:flex; justify-content:center; align-items:center;
    backdrop-filter:blur(4px);
  `;
  overlay.innerHTML = `
    <div style="
      background:#FFFFFF; border:2px solid #D1D5DB; border-radius:16px;
      max-width:480px; width:90%; padding:2rem; position:relative;
      box-shadow:0 20px 60px rgba(0,0,0,0.3); animation:modalSlideIn 0.3s ease;
    ">
      <div style="text-align:center; margin-bottom:1.5rem;">
        <div style="font-size:2.5rem; margin-bottom:0.5rem;">⚽</div>
        <h2 style="color:#1F2937; font-size:1.5rem; font-weight:800; margin-bottom:0.25rem;">
          Odds Flow v${CURRENT_VERSION}
        </h2>
        <p style="color:#6B7280; font-size:0.9rem;">世足盤口分析系統已更新</p>
      </div>

      <div style="background:#F9FAFB; border:1px solid #E5E7EB; border-radius:12px; padding:1.25rem; margin-bottom:1.5rem;">
        <div style="font-size:0.85rem; color:#6B7280; font-weight:600; margin-bottom:0.75rem; text-transform:uppercase; letter-spacing:1px;">更新內容</div>
        <ul style="list-style:none; padding:0; margin:0; display:flex; flex-direction:column; gap:0.6rem;">
          <li style="display:flex; align-items:center; gap:0.5rem; font-size:1rem; color:#1F2937;">
            <span style="background:#DBEAFE; color:#2563EB; width:28px; height:28px; border-radius:8px; display:flex; align-items:center; justify-content:center; font-size:0.85rem; flex-shrink:0;">🎨</span>
            全新 UI 介面大改版
          </li>
          <li style="display:flex; align-items:center; gap:0.5rem; font-size:1rem; color:#1F2937;">
            <span style="background:#D1FAE5; color:#16A34A; width:28px; height:28px; border-radius:8px; display:flex; align-items:center; justify-content:center; font-size:0.85rem; flex-shrink:0;">🤖</span>
            AI 整合網友風向分析
          </li>
          <li style="display:flex; align-items:center; gap:0.5rem; font-size:1rem; color:#1F2937;">
            <span style="background:#FEF3C7; color:#D97706; width:28px; height:28px; border-radius:8px; display:flex; align-items:center; justify-content:center; font-size:0.85rem; flex-shrink:0;">🗓️</span>
            台灣賽程表 (UTC+8)
          </li>
          <li style="display:flex; align-items:center; gap:0.5rem; font-size:1rem; color:#1F2937;">
            <span style="background:#FCE7F3; color:#DB2777; width:28px; height:28px; border-radius:8px; display:flex; align-items:center; justify-content:center; font-size:0.85rem; flex-shrink:0;">📱</span>
            支援手機 App 模式
          </li>
          <li style="display:flex; align-items:center; gap:0.5rem; font-size:1rem; color:#1F2937;">
            <span style="background:#E0E7FF; color:#4F46E5; width:28px; height:28px; border-radius:8px; display:flex; align-items:center; justify-content:center; font-size:0.85rem; flex-shrink:0;">📊</span>
            歷史回顧擴充 (11~13號)
          </li>
        </ul>
      </div>

      <button id="closeNotesBtn" style="
        width:100%; background:#1F2937; color:#FFFFFF;
        padding:0.9rem; border:none; border-radius:10px;
        font-size:1.1rem; cursor:pointer; font-weight:700;
        transition:all 0.2s;
      " onmouseover="this.style.background='#374151'" onmouseout="this.style.background='#1F2937'">
        開始使用
      </button>
    </div>
  `;
  document.body.appendChild(overlay);

  document.getElementById('closeNotesBtn').addEventListener('click', () => {
    overlay.remove();
    localStorage.setItem('release_notes_seen', CURRENT_VERSION);
    setTimeout(checkAndShowPWA, 500);
  });
}

function checkAndShowPWA() {
  const ua = window.navigator.userAgent.toLowerCase();
  const isIos = /iphone|ipad|ipod/.test(ua);
  const isInStandaloneMode = ('standalone' in window.navigator) && (window.navigator.standalone);
  const isAndroidStandalone = window.matchMedia('(display-mode: standalone)').matches;

  if (isInStandaloneMode || isAndroidStandalone) return;

  if (isIos) {
    showIosInstallPrompt();
  } else if (/android|mobile/.test(ua)) {
    if (deferredPrompt) {
      showAndroidInstallPrompt();
    } else {
      showGenericMobilePrompt();
    }
  }
}

function showAndroidInstallPrompt() {
  if (localStorage.getItem('pwa_prompt_dismissed')) return;
  const banner = createPwaBanner(
    '取得全螢幕 App 體驗',
    '一鍵安裝到手機桌面',
    true
  );
  document.body.appendChild(banner);
}

function showGenericMobilePrompt() {
  if (localStorage.getItem('pwa_prompt_dismissed')) return;
  const banner = createPwaBanner(
    '取得全螢幕 App 體驗',
    '點擊瀏覽器選單 (⋮) → 「加到主畫面」',
    false
  );
  document.body.appendChild(banner);
}

function createPwaBanner(title, desc, hasInstall) {
  const banner = document.createElement('div');
  banner.className = 'pwa-banner';
  banner.innerHTML = `
    <div class="pwa-content">
      <span class="pwa-icon">⚽</span>
      <div>
        <div class="pwa-title">${title}</div>
        <div class="pwa-desc">${desc}</div>
      </div>
    </div>
    <div class="pwa-actions">
      ${hasInstall ? '<button id="pwaInstallBtn" class="pwa-btn-install">安裝</button>' : ''}
      <button class="pwa-btn-close" onclick="this.closest(\'.pwa-banner\').remove(); localStorage.setItem(\'pwa_prompt_dismissed\',\'true\');">✕</button>
    </div>
  `;

  if (hasInstall) {
    setTimeout(() => {
      const btn = document.getElementById('pwaInstallBtn');
      if (btn) {
        btn.addEventListener('click', async () => {
          banner.remove();
          if (deferredPrompt) {
            deferredPrompt.prompt();
            await deferredPrompt.userChoice;
            deferredPrompt = null;
          }
        });
      }
    }, 100);
  }
  return banner;
}

function showIosInstallPrompt() {
  if (localStorage.getItem('ios_pwa_dismissed')) return;

  const modal = document.createElement('div');
  modal.style.cssText = `
    position:fixed; inset:0; z-index:9999;
    background:rgba(0,0,0,0.6);
    display:flex; justify-content:center; align-items:flex-end;
    backdrop-filter:blur(4px);
  `;
  modal.innerHTML = `
    <div style="
      background:#FFFFFF; width:100%; padding:2rem;
      border-radius:20px 20px 0 0; position:relative;
      box-shadow:0 -10px 30px rgba(0,0,0,0.2);
    ">
      <button id="iosPwaCloseBtn" style="
        position:absolute; right:15px; top:15px;
        background:#E5E7EB; border:none; width:32px; height:32px;
        border-radius:50%; font-size:1.2rem; cursor:pointer; color:#6B7280;
      ">✕</button>

      <h3 style="color:#1F2937; margin-bottom:0.75rem; font-size:1.3rem; font-weight:700; text-align:center;">
        📱 加入主畫面
      </h3>
      <p style="color:#6B7280; margin-bottom:1rem; text-align:center; font-size:0.95rem;">
        享受無干擾的全螢幕 App 體驗
      </p>

      <div style="background:#F9FAFB; padding:1.25rem; border-radius:12px; border:1px solid #E5E7EB;">
        <ol style="margin:0 0 0 1.25rem; font-size:1.05rem; color:#1F2937; line-height:2;">
          <li>點擊底部 <strong>分享按鈕</strong> ⬆️</li>
          <li>選擇 <strong>「加入主畫面」</strong> ➕</li>
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

// 頁面載入後啟動
window.addEventListener('DOMContentLoaded', () => {
  setTimeout(showReleaseNotes, 800);
});
