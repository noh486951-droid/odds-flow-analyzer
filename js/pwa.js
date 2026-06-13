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
const CURRENT_VERSION = "2.0.0";

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
            <span style="background:#E0E7FF; color:#4F46E5; width:28px; height:28px; border-radius:8px; display:flex; align-items:center; justify-content:center; font-size:0.85rem; flex-shrink:0;">🚀</span>
            新增功能導覽 (點擊導航欄最後「重看導覽」可重播)
          </li>
          <li style="display:flex; align-items:center; gap:0.5rem; font-size:1rem; color:#1F2937;">
            <span style="background:#D1FAE5; color:#16A34A; width:28px; height:28px; border-radius:8px; display:flex; align-items:center; justify-content:center; font-size:0.85rem; flex-shrink:0;">🤖</span>
            新增 AI 數據預估對照表 (勝平負/最可能比分/進球率)
          </li>
          <li style="display:flex; align-items:center; gap:0.5rem; font-size:1rem; color:#1F2937;">
            <span style="background:#FEF3C7; color:#D97706; width:28px; height:28px; border-radius:8px; display:flex; align-items:center; justify-content:center; font-size:0.85rem; flex-shrink:0;">🎯</span>
            AI 預測比分包含信心百分比與聯網 H2H 歷史補全
          </li>
          <li style="display:flex; align-items:center; gap:0.5rem; font-size:1rem; color:#1F2937;">
            <span style="background:#DBEAFE; color:#2563EB; width:28px; height:28px; border-radius:8px; display:flex; align-items:center; justify-content:center; font-size:0.85rem; flex-shrink:0;">🎨</span>
            即時看板導航按鈕黑色底高級感優化
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

  // 如果已經是獨立應用模式，則不用提示
  if (isInStandaloneMode || isAndroidStandalone) return;

  // 如果是行動裝置，顯示統一的安裝引導視窗
  if (isIos || /android|mobile/.test(ua)) {
    showUnifiedPwaModal();
  }
}

function showUnifiedPwaModal() {
  if (localStorage.getItem('pwa_prompt_dismissed') === 'true') return;

  const overlay = document.createElement('div');
  overlay.id = 'pwa-guide-overlay';
  overlay.style.cssText = `
    position: fixed; inset: 0; z-index: 9999;
    background: rgba(15, 23, 42, 0.65);
    display: flex; justify-content: center; align-items: center;
    backdrop-filter: blur(8px);
    padding: 1.25rem;
  `;

  overlay.innerHTML = `
    <div style="
      background: #FFFFFF; border: 1px solid rgba(226, 232, 240, 0.8); border-radius: 20px;
      max-width: 540px; width: 100%; padding: 1.75rem; position: relative;
      box-shadow: 0 25px 50px -12px rgba(15, 23, 42, 0.3);
      animation: modalSlideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      display: flex; flex-direction: column; gap: 1.25rem;
      font-family: system-ui, -apple-system, sans-serif;
    ">
      <!-- 關閉按鈕 -->
      <button id="pwaCloseBtn" style="
        position: absolute; right: 16px; top: 16px;
        background: #F1F5F9; border: none; width: 32px; height: 32px;
        border-radius: 50%; font-size: 1rem; cursor: pointer; color: #64748B;
        display: flex; align-items: center; justify-content: center;
        transition: all 0.2s;
      " onmouseover="this.style.background='#E2E8F0'" onmouseout="this.style.background='#F1F5F9'">✕</button>

      <!-- 頭部 -->
      <div style="text-align: center;">
        <span style="font-size: 2.5rem;">📱</span>
        <h2 style="color: #0F172A; font-size: 1.35rem; font-weight: 800; margin-top: 0.5rem; margin-bottom: 0.25rem;">
          安裝 Odds Flow Web App
        </h2>
        <p style="color: #64748B; font-size: 0.85rem; line-height: 1.45; max-width: 400px; margin: 0 auto;">
          將程式加入主畫面，享有全螢幕、獨立視窗與更流暢的運彩分析體驗
        </p>
      </div>

      <!-- 雙欄內容 -->
      <div class="pwa-columns-wrap" style="
        display: grid; grid-template-columns: 1fr 1fr; gap: 1.25rem;
        border-top: 1px solid #F1F5F9; border-bottom: 1px solid #F1F5F9;
        padding: 1.25rem 0;
      ">
        <!-- Android 欄位 -->
        <div style="
          background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 12px;
          padding: 1rem; display: flex; flex-direction: column; gap: 0.75rem;
        ">
          <h3 style="color: #10B981; font-size: 0.95rem; font-weight: 800; display: flex; align-items: center; gap: 0.35rem; margin: 0;">
            🤖 Android 系統
          </h3>
          <div style="font-size: 0.85rem; color: #334155; line-height: 1.6; flex: 1; display: flex; flex-direction: column; gap: 0.5rem;">
            <p style="margin: 0; font-weight: bold; color: #0F172A;">推薦方式：</p>
            ${deferredPrompt ? `
              <button id="pwaOneClickInstallBtn" style="
                width: 100%; background: #10B981; color: #FFFFFF;
                border: none; padding: 0.55rem; border-radius: 8px;
                font-weight: 700; cursor: pointer; transition: all 0.2s;
                font-size: 0.85rem; text-align: center;
                box-shadow: 0 4px 10px rgba(16, 185, 129, 0.2);
              " onmouseover="this.style.background='#059669'" onmouseout="this.style.background='#10B981'">
                ⚡ 一鍵快速安裝
              </button>
            ` : `
              <span style="color:#64748B; font-size: 0.8rem; display:block; background:#E2E8F0; padding:6px 8px; border-radius:6px; text-align:center; font-weight: 600;">
                ( 點擊下方按鈕即可安裝 )
              </span>
            `}
            
            <p style="margin: 0.25rem 0 0 0; border-top: 1px dashed #CBD5E1; padding-top: 0.5rem; font-weight: bold; color: #0F172A;">手動安裝方式：</p>
            <ol style="margin: 0; padding-left: 1.1rem; display: flex; flex-direction: column; gap: 0.35rem; font-size: 0.8rem; color: #475569;">
              <li>點擊 Chrome 右上角選單按鈕（<code>⋮</code> 圖示）</li>
              <li>選擇 <strong>「加到主畫面」</strong> 或 <strong>「安裝應用程式」</strong></li>
            </ol>
          </div>
        </div>

        <!-- iOS 欄位 -->
        <div style="
          background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 12px;
          padding: 1rem; display: flex; flex-direction: column; gap: 0.75rem;
        ">
          <h3 style="color: #2563EB; font-size: 0.95rem; font-weight: 800; display: flex; align-items: center; gap: 0.35rem; margin: 0;">
            🍎 iOS / iPhone
          </h3>
          <div style="font-size: 0.85rem; color: #334155; line-height: 1.6; flex: 1; display: flex; flex-direction: column; gap: 0.5rem;">
            <p style="margin: 0; font-weight: bold; color: #0F172A;">Safari 安裝步驟：</p>
            <ol style="margin: 0; padding-left: 1.1rem; display: flex; flex-direction: column; gap: 0.45rem; font-size: 0.8rem; color: #475569;">
              <li>使用 Safari 瀏覽器打開本站</li>
              <li>點擊底部工具列的 <strong>「分享」</strong> 按鈕（⬆️ 分享圖示）</li>
              <li>在選單中向下滑動，點擊 <strong>「加入主畫面」</strong>（➕ 圖示）</li>
              <li>確認名稱並點擊右上角的 <strong>「新增」</strong></li>
            </ol>
          </div>
        </div>
      </div>

      <!-- 底部按鈕 -->
      <button id="pwaCloseNotesBtn" style="
        width: 100%; background: #0F172A; color: #FFFFFF;
        padding: 0.8rem; border: none; border-radius: 10px;
        font-size: 0.95rem; cursor: pointer; font-weight: 700;
        transition: all 0.2s;
      " onmouseover="this.style.background='#1E293B'" onmouseout="this.style.background='#0F172A'">
        我知道了，暫不安裝
      </button>
    </div>
  `;

  // 手機版自動垂直排列樣式
  const style = document.createElement('style');
  style.innerHTML = `
    @media (max-width: 520px) {
      .pwa-columns-wrap {
        grid-template-columns: 1fr !important;
        gap: 1rem !important;
      }
    }
  `;
  document.head.appendChild(style);
  document.body.appendChild(overlay);

  const close = () => {
    overlay.remove();
    style.remove();
    localStorage.setItem('pwa_prompt_dismissed', 'true');
  };

  document.getElementById('pwaCloseBtn').addEventListener('click', close);
  document.getElementById('pwaCloseNotesBtn').addEventListener('click', close);

  const oneClickBtn = document.getElementById('pwaOneClickInstallBtn');
  if (oneClickBtn) {
    oneClickBtn.addEventListener('click', async () => {
      overlay.remove();
      style.remove();
      if (deferredPrompt) {
        deferredPrompt.prompt();
        await deferredPrompt.userChoice;
        deferredPrompt = null;
      }
    });
  }
}color:#1F2937; line-height:2;">
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
