#!/usr/bin/env python3
"""
Odds Flow Analyzer - 運彩盤口變動追蹤器
自動抓取 NBA/足球賠率、偵測變動、抓新聞、AI 分析原因
"""

import os
import json
import re
import requests
import feedparser
import google.generativeai as genai
from datetime import datetime, timezone, timedelta

# ============================================================
# 設定區
# ============================================================
ODDS_API_KEY = os.environ.get("ODDS_API_KEY", "")
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")

# 台北時區 (UTC+8)
TZ_TAIPEI = timezone(timedelta(hours=8))

# The Odds API 設定
ODDS_API_BASE = "https://api.the-odds-api.com/v4/sports"

# 要追蹤的聯賽 (輪替策略: 每次抓 NBA + 1個足球聯賽)
LEAGUES = {
    "basketball_nba": "NBA",
    "soccer_epl": "英超 EPL",
    "soccer_spain_la_liga": "西甲 La Liga",
    "soccer_uefa_champs_league": "歐冠 UCL",
    "soccer_italy_serie_a": "義甲 Serie A",
    "soccer_germany_bundesliga": "德甲 Bundesliga",
}

# 足球聯賽輪替清單
SOCCER_LEAGUES = [
    "soccer_epl",
    "soccer_spain_la_liga",
    "soccer_uefa_champs_league",
    "soccer_italy_serie_a",
    "soccer_germany_bundesliga",
]

# 變動門檻 (超過此值才觸發 AI 分析)
ODDS_CHANGE_THRESHOLD = 0.05  # 5%

# 新聞 RSS 來源
NEWS_RSS = {
    "nba": [
        "https://www.espn.com/espn/rss/nba/news",
        "https://sports.yahoo.com/nba/rss.xml",
    ],
    "soccer": [
        "http://feeds.bbci.co.uk/sport/football/rss.xml",
        "https://www.espn.com/espn/rss/soccer/news",
    ],
}

# 檔案路徑
DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
CURRENT_FILE = os.path.join(DATA_DIR, "current.json")
HISTORY_FILE_TEMPLATE = os.path.join(DATA_DIR, "archive", "{date}.json")


# ============================================================
# 工具函數
# ============================================================
def get_now():
    """取得台北時間"""
    return datetime.now(TZ_TAIPEI)


def load_json(filepath):
    """安全載入 JSON"""
    if os.path.exists(filepath):
        with open(filepath, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def save_json(filepath, data):
    """儲存 JSON"""
    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def get_current_soccer_league():
    """根據當前時間輪替足球聯賽，節省 API 額度"""
    now = get_now()
    # 用小時數決定輪替哪個聯賽
    index = (now.hour // 3) % len(SOCCER_LEAGUES)
    return SOCCER_LEAGUES[index]


# ============================================================
# The Odds API 模組
# ============================================================
def fetch_odds(sport_key):
    """從 The Odds API 抓取某聯賽的賠率"""
    url = f"{ODDS_API_BASE}/{sport_key}/odds/"
    params = {
        "apiKey": ODDS_API_KEY,
        "regions": "us,eu",
        "markets": "h2h,spreads,totals,btts",
        "oddsFormat": "decimal",
    }

    try:
        resp = requests.get(url, params=params, timeout=30)
        if resp.status_code == 200:
            data = resp.json()
            remaining = resp.headers.get("x-requests-remaining", "?")
            print(f"  ✅ {LEAGUES.get(sport_key, sport_key)}: 取得 {len(data)} 場比賽 (剩餘額度: {remaining})")
            return data
        elif resp.status_code == 422:
            print(f"  ⚠️ {LEAGUES.get(sport_key, sport_key)}: 目前無賽事")
            return []
        else:
            print(f"  ❌ {LEAGUES.get(sport_key, sport_key)}: API 錯誤 {resp.status_code}")
            return []
    except Exception as e:
        print(f"  ❌ {LEAGUES.get(sport_key, sport_key)}: 連線失敗 - {e}")
        return []


def parse_odds_data(raw_data, sport_key):
    """解析原始賠率數據為統一格式"""
    matches = []
    for event in raw_data:
        match = {
            "id": event.get("id", ""),
            "sport_key": sport_key,
            "league": LEAGUES.get(sport_key, sport_key),
            "home_team": event.get("home_team", ""),
            "away_team": event.get("away_team", ""),
            "commence_time": event.get("commence_time", ""),
            "bookmakers": [],
        }

        for bookmaker in event.get("bookmakers", []):
            bm = {
                "name": bookmaker.get("title", ""),
                "markets": {},
            }
            for market in bookmaker.get("markets", []):
                market_key = market.get("key", "")
                outcomes = {}
                for outcome in market.get("outcomes", []):
                    name = outcome.get("name", "")
                    price = outcome.get("price", 0)
                    point = outcome.get("point", None)
                    outcomes[name] = {"price": price}
                    if point is not None:
                        outcomes[name]["point"] = point
                bm["markets"][market_key] = outcomes
            match["bookmakers"].append(bm)

        # 計算平均賠率 (取所有博彩商的平均)
        avg_odds, other_markets = calculate_average_odds(match)
        match["avg_odds"] = avg_odds
        match["other_markets"] = other_markets
        
        # 計算真實勝算(扣除水錢)
        implied_sum = sum(1/p for p in avg_odds.values() if p > 0)
        true_probs = {}
        for team, p in avg_odds.items():
            if p > 0 and implied_sum > 0:
                true_probs[team] = round((1/p) / implied_sum * 100, 1)
        match["true_probs"] = true_probs
        
        matches.append(match)

    return matches


def calculate_average_odds(match):
    """計算所有博彩商的平均賠率並提取其他盤口資料"""
    h2h_totals = {}
    h2h_counts = {}
    other_markets = {"spreads": {}, "totals": {}, "btts": {}}

    for bm in match.get("bookmakers", []):
        markets = bm.get("markets", {})
        h2h = markets.get("h2h", {})
        for team, data in h2h.items():
            price = data.get("price", 0)
            if price > 0:
                h2h_totals[team] = h2h_totals.get(team, 0) + price
                h2h_counts[team] = h2h_counts.get(team, 0) + 1
        
        # 抓取第一家有開盤的資料做代表
        for mk in ["spreads", "totals", "btts"]:
            if not other_markets[mk] and mk in markets:
                other_markets[mk] = markets[mk]

    avg = {}
    for team in h2h_totals:
        avg[team] = round(h2h_totals[team] / h2h_counts[team], 3)

    return avg, other_markets


# ============================================================
# 初盤鎖定與變動偵測
# ============================================================
def detect_changes(current_matches, existing_data):
    """比對初盤與現盤，計算變動"""
    results = []

    for match in current_matches:
        match_id = match["id"]
        existing_match = existing_data.get("matches", {}).get(match_id, None)

        if existing_match is None:
            # 新比賽：鎖定為初盤
            match["opening_odds"] = match["avg_odds"].copy()
            match["odds_change"] = {}
            match["change_pct"] = {}
            match["is_new"] = True
            match["first_seen"] = get_now().isoformat()
        else:
            # 已知比賽：比對變動
            match["opening_odds"] = existing_match.get("opening_odds", match["avg_odds"])
            match["first_seen"] = existing_match.get("first_seen", get_now().isoformat())
            match["is_new"] = False

            change = {}
            change_pct = {}
            for team, current_price in match["avg_odds"].items():
                opening_price = match["opening_odds"].get(team, current_price)
                diff = round(current_price - opening_price, 3)
                pct = round((diff / opening_price) * 100, 2) if opening_price != 0 else 0
                change[team] = diff
                change_pct[team] = pct

            match["odds_change"] = change
            match["change_pct"] = change_pct
            
            # 定義資金趨勢/價值注警示 (賠率下降 >= 5% 視為顯著的 Smart Money Move)
            is_value_bet = False
            for team, pct in change_pct.items():
                if pct <= -5.0:
                    is_value_bet = True
            match["is_value_bet"] = is_value_bet

        results.append(match)

    return results


def get_significant_changes(matches):
    """篩選出有顯著賠率變動的比賽"""
    significant = []
    for match in matches:
        for team, pct in match.get("change_pct", {}).items():
            if abs(pct) >= ODDS_CHANGE_THRESHOLD * 100:
                significant.append(match)
                break
    return significant


# ============================================================
# 新聞抓取模組
# ============================================================
def fetch_news(category="nba", max_items=15):
    """從 RSS 抓取最新體育新聞"""
    news_items = []
    rss_urls = NEWS_RSS.get(category, [])

    for url in rss_urls:
        try:
            feed = feedparser.parse(url)
            for entry in feed.entries[:max_items]:
                news_items.append({
                    "title": entry.get("title", ""),
                    "link": entry.get("link", ""),
                    "published": entry.get("published", ""),
                    "summary": entry.get("summary", "")[:200],
                })
        except Exception as e:
            print(f"  ⚠️ 新聞抓取失敗: {url} - {e}")

    # 去重 (根據標題)
    seen = set()
    unique = []
    for item in news_items:
        if item["title"] not in seen:
            seen.add(item["title"])
            unique.append(item)

    return unique[:20]


# ============================================================
# AI 分析模組 (Gemini)
# ============================================================
def analyze_with_ai(matches_with_changes, news_items):
    """使用 Gemini AI 分析賠率變動原因"""
    if not GEMINI_API_KEY:
        print("  ⚠️ 未設定 GEMINI_API_KEY，跳過 AI 分析")
        return add_fallback_analysis(matches_with_changes)

    if not matches_with_changes:
        return []

    genai.configure(api_key=GEMINI_API_KEY)
    model = genai.GenerativeModel("gemini-2.0-flash")

    results = []
    for match in matches_with_changes:
        prompt = build_analysis_prompt(match, news_items)
        try:
            response = model.generate_content(prompt)
            analysis_text = response.text.strip()
            match["ai_analysis"] = analysis_text
            match["analysis_source"] = "gemini"
            print(f"  🤖 AI 分析完成: {match['home_team']} vs {match['away_team']}")
        except Exception as e:
            print(f"  ⚠️ AI 分析失敗: {e}")
            match["ai_analysis"] = "AI 分析暫時無法使用，請參考新聞連結自行判斷。"
            match["analysis_source"] = "fallback"

        results.append(match)

    return results


def build_analysis_prompt(match, news_items):
    """建構 AI 分析的 Prompt"""
    home = match["home_team"]
    away = match["away_team"]
    league = match["league"]
    opening = match.get("opening_odds", {})
    current = match.get("avg_odds", {})
    change = match.get("odds_change", {})
    change_pct = match.get("change_pct", {})

    # 組織新聞文字
    news_text = ""
    for item in news_items[:10]:
        news_text += f"- {item['title']}\n"

    prompt = f"""你是一位專業的運動彩券分析師，請用繁體中文回答。

## 比賽資訊
- 聯賽: {league}
- 主隊: {home}
- 客隊: {away}
- 開賽時間: {match.get('commence_time', '未知')}

## 賠率變動
"""
    for team in current:
        op = opening.get(team, "N/A")
        cur = current.get(team, "N/A")
        ch = change.get(team, 0)
        pct = change_pct.get(team, 0)
        direction = "↑" if ch > 0 else "↓" if ch < 0 else "→"
        prompt += f"- {team}: 初盤 {op} → 現盤 {cur} ({direction} {ch:+.3f}, {pct:+.2f}%)\n"

    prompt += f"""
## 最新相關新聞
{news_text}

## 你的任務
1. 根據賠率變動及勝率數據，簡要用 1-2 句話說明哪支球隊勝算較大，以及變動原因。
2. 若發現賠率明顯下降，可提醒這可能是價值注或聰明錢的流向。
3. 如果新聞無佐證，誠實回答「無明顯新聞佐證，可能為資金流動所致」。
4. 回答格式：直接給出結論，不要加前綴。
"""
    return prompt


def add_fallback_analysis(matches):
    """無 AI 時的備用分析"""
    for match in matches:
        reasons = []
        for team, pct in match.get("change_pct", {}).items():
            if pct > 5:
                reasons.append(f"{team} 賠率上升 {pct:.1f}%，市場看淡該隊表現")
            elif pct < -5:
                reasons.append(f"{team} 賠率下降 {abs(pct):.1f}%，市場看好該隊表現")

        if reasons:
            match["ai_analysis"] = "；".join(reasons) + "。（系統自動判斷，建議搭配新聞自行分析）"
        else:
            match["ai_analysis"] = "賠率變動幅度不大，市場尚無明顯傾向。"
        match["analysis_source"] = "rule_based"

    return matches


# ============================================================
# 資料彙整與儲存
# ============================================================
def build_output(all_matches, news, significant_matches):
    """彙整所有資料為最終輸出格式"""
    now = get_now()

    output = {
        "last_updated": now.isoformat(),
        "last_updated_display": now.strftime("%Y/%m/%d %H:%M (台北時間)"),
        "matches": {},
        "leagues": {},
        "news": {
            "nba": [],
            "soccer": [],
        },
        "significant_changes": [],
        "stats": {
            "total_matches": len(all_matches),
            "significant_changes_count": len(significant_matches),
        },
    }

    # 按聯賽分組
    for match in all_matches:
        match_id = match["id"]
        league = match.get("league", "未知")

        # 清理 bookmakers 資料以節省空間 (只保留前3家)
        if len(match.get("bookmakers", [])) > 3:
            match["bookmakers"] = match["bookmakers"][:3]

        output["matches"][match_id] = match

        if league not in output["leagues"]:
            output["leagues"][league] = []
        output["leagues"][league].append(match_id)

    # 新聞
    output["news"]["nba"] = news.get("nba", [])[:10]
    output["news"]["soccer"] = news.get("soccer", [])[:10]

    # 顯著變動
    output["significant_changes"] = [m["id"] for m in significant_matches]

    return output


def save_to_archive(output):
    """將當前數據存入歷史檔案"""
    today = get_now().strftime("%Y-%m-%d")
    archive_path = HISTORY_FILE_TEMPLATE.format(date=today)

    # 如果今天已有歷史檔案，合併
    existing_archive = load_json(archive_path)
    if existing_archive:
        # 合併 matches
        existing_matches = existing_archive.get("matches", {})
        existing_matches.update(output.get("matches", {}))
        output["matches"] = existing_matches

        # 更新聯賽索引
        for league, ids in output.get("leagues", {}).items():
            existing_ids = existing_archive.get("leagues", {}).get(league, [])
            merged = list(set(existing_ids + ids))
            output["leagues"][league] = merged

    # 添加快照時間戳
    snapshots = existing_archive.get("snapshots", [])
    snapshots.append({
        "time": get_now().isoformat(),
        "matches_count": len(output.get("matches", {})),
    })
    output["snapshots"] = snapshots

    save_json(archive_path, output)
    print(f"  📦 歷史檔案已儲存: {archive_path}")


# ============================================================
# 主流程
# ============================================================
def main():
    print("=" * 60)
    print(f"🏀⚽ 運彩盤口變動追蹤器 - {get_now().strftime('%Y/%m/%d %H:%M')}")
    print("=" * 60)

    # 1. 載入現有數據
    print("\n📂 載入現有數據...")
    existing_data = load_json(CURRENT_FILE)

    # 2. 決定本次要抓取的聯賽 (NBA + 輪替1個足球聯賽)
    soccer_league = get_current_soccer_league()
    leagues_to_fetch = ["basketball_nba", soccer_league]
    print(f"\n📡 本次抓取: NBA + {LEAGUES[soccer_league]}")

    # 3. 抓取賠率
    print("\n📊 抓取最新賠率...")
    all_matches = []
    for league_key in leagues_to_fetch:
        raw = fetch_odds(league_key)
        if raw:
            parsed = parse_odds_data(raw, league_key)
            all_matches.extend(parsed)

    if not all_matches:
        print("\n⚠️ 本次無賽事數據，結束執行")
        return

    # 4. 偵測變動
    print("\n🔍 偵測賠率變動...")
    matches_with_changes = detect_changes(all_matches, existing_data)
    significant = get_significant_changes(matches_with_changes)
    print(f"  📈 共 {len(significant)} 場比賽有顯著變動")

    # 5. 抓取新聞
    print("\n📰 抓取最新新聞...")
    news = {
        "nba": fetch_news("nba"),
        "soccer": fetch_news("soccer"),
    }
    print(f"  NBA 新聞: {len(news['nba'])} 則, 足球新聞: {len(news['soccer'])} 則")

    # 6. AI 分析 (僅對有顯著變動的比賽)
    if significant:
        print("\n🤖 啟動 AI 分析...")
        # 根據聯賽類型選擇新聞
        for match in significant:
            if "nba" in match.get("sport_key", ""):
                relevant_news = news["nba"]
            else:
                relevant_news = news["soccer"]
            analyze_with_ai([match], relevant_news)
    else:
        print("\n✅ 無顯著變動，跳過 AI 分析")
        # 對所有比賽添加基礎分析
        add_fallback_analysis(matches_with_changes)

    # 7. 彙整並儲存
    print("\n💾 儲存數據...")
    output = build_output(matches_with_changes, news, significant)
    save_json(CURRENT_FILE, output)
    print(f"  ✅ 即時數據已更新: {CURRENT_FILE}")

    # 8. 歸檔歷史
    save_to_archive(output)

    print("\n" + "=" * 60)
    print(f"✅ 完成！共處理 {len(all_matches)} 場比賽")
    print("=" * 60)


if __name__ == "__main__":
    main()
