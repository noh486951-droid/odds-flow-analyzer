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
import time as time_module

# TheSportsDB 免費 API (不需註冊)
SPORTSDB_BASE = "https://www.thesportsdb.com/api/v1/json/3"
SPORTSDB_CACHE = {}  # team_name -> team_id cache

# 傷兵關鍵字
INJURY_KEYWORDS = [
    "injury", "injured", "out", "doubtful", "questionable",
    "ruled out", "miss", "sidelined", "hamstring", "ACL",
    "concussion", "day-to-day", "GTD", "ankle", "knee",
    "fracture", "sprain", "strain", "surgery", "rest",
    "load management", "dnp", "will not play", "expected to miss",
    "受傷", "缺陣", "傷停", "傷病", "休息"
]

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
    # 為避免部分聯賽或方案不支援 btts 導致 400 錯誤，統一使用標準盤口
    markets = "h2h,spreads,totals"

    params = {
        "apiKey": ODDS_API_KEY,
        "regions": "us,eu",
        "markets": markets,
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
        
        # 計算真實勝算(扣除水錢)
        def calc_probs(outcomes):
            implied_sum = sum(1/p for p in outcomes.values() if p > 0)
            return {k: round((1/p) / implied_sum * 100, 1) for k, p in outcomes.items() if p > 0 and implied_sum > 0}
            
        match["true_probs"] = calc_probs(avg_odds)
        
        # 計算其他盤口的真實機率寫入 other_markets
        for mk in ["spreads", "totals"]:
            if mk in other_markets and other_markets[mk]:
                market_probs = calc_probs({k: v.get("price", 0) for k, v in other_markets[mk].items()})
                for k in other_markets[mk]:
                    other_markets[mk][k]["prob"] = market_probs.get(k, 50.0)
                    
        match["other_markets"] = other_markets
        
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
    """篩選出勝率超過 60% 的比賽進行 AI 分析 (節省 Token)"""
    significant = []
    for match in matches:
        is_high_prob = False
        
        # 1. 檢查獨贏勝率
        for prob in match.get("true_probs", {}).values():
            if prob >= 60.0:
                is_high_prob = True
                break
                
        # 2. 檢查讓分/大小分勝率
        if not is_high_prob:
            other_mk = match.get("other_markets", {})
            for mk in ["spreads", "totals"]:
                if mk in other_mk:
                    for v in other_mk[mk].values():
                        if v.get("prob", 0) >= 60.0:
                            is_high_prob = True
                            break
                if is_high_prob:
                    break

        if is_high_prob:
            significant.append(match)
            
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


def filter_injury_news(news_items, home_team, away_team):
    """從新聞中篩選出與兩隊相關的傷兵消息"""
    injury_alerts = []
    home_words = home_team.lower().split()
    away_words = away_team.lower().split()
    
    for item in news_items:
        text = (item.get("title", "") + " " + item.get("summary", "")).lower()
        
        # 檢查是否包含傷兵關鍵字
        has_injury_kw = any(kw in text for kw in INJURY_KEYWORDS)
        if not has_injury_kw:
            continue
            
        # 檢查是否與某一隊相關
        related_team = None
        if any(w in text for w in home_words if len(w) > 3):
            related_team = home_team
        elif any(w in text for w in away_words if len(w) > 3):
            related_team = away_team
            
        if related_team:
            injury_alerts.append({
                "team": related_team,
                "title": item["title"],
                "link": item.get("link", ""),
            })
    
    return injury_alerts[:5]  # 最多5則


# ============================================================
# TheSportsDB 模組 (H2H + 近期戰績)
# ============================================================
def search_team_id(team_name):
    """從 TheSportsDB 搜尋隊伍 ID"""
    if team_name in SPORTSDB_CACHE:
        return SPORTSDB_CACHE[team_name]
    
    try:
        url = f"{SPORTSDB_BASE}/searchteams.php"
        resp = requests.get(url, params={"t": team_name}, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            teams = data.get("teams")
            if teams and len(teams) > 0:
                team_id = teams[0].get("idTeam")
                SPORTSDB_CACHE[team_name] = team_id
                return team_id
    except Exception as e:
        print(f"    ⚠️ TheSportsDB 搜尋失敗 ({team_name}): {e}")
    
    return None


def fetch_team_last_events(team_id, count=15):
    """取得某隊最近的比賽結果"""
    try:
        url = f"{SPORTSDB_BASE}/eventslast.php"
        resp = requests.get(url, params={"id": team_id}, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            return data.get("results", []) or []
    except Exception as e:
        print(f"    ⚠️ TheSportsDB 取近期賽事失敗: {e}")
    return []


def fetch_h2h_and_form(home_team, away_team):
    """取得 H2H 交手紀錄與雙方近5場戰績"""
    result = {
        "h2h_history": [],
        "home_form": {"record": "", "wins": 0, "losses": 0, "details": []},
        "away_form": {"record": "", "wins": 0, "losses": 0, "details": []},
    }
    
    # 搜尋隊伍 ID
    home_id = search_team_id(home_team)
    time_module.sleep(1)  # 避免速率限制
    away_id = search_team_id(away_team)
    time_module.sleep(1)
    
    if not home_id and not away_id:
        print(f"    ⚠️ 無法找到隊伍 ID: {home_team}, {away_team}")
        return result
    
    # 取主隊近期比賽
    if home_id:
        home_events = fetch_team_last_events(home_id)
        time_module.sleep(1)
        
        # 計算近5場戰績
        home_record = []
        for ev in home_events[:5]:
            home_score = int(ev.get("intHomeScore", 0) or 0)
            away_score = int(ev.get("intAwayScore", 0) or 0)
            is_home = ev.get("idHomeTeam") == home_id
            team_score = home_score if is_home else away_score
            opp_score = away_score if is_home else home_score
            won = team_score > opp_score
            home_record.append("W" if won else "L")
            result["home_form"]["details"].append({
                "date": ev.get("dateEvent", ""),
                "opponent": ev.get("strAwayTeam") if is_home else ev.get("strHomeTeam"),
                "score": f"{home_score}-{away_score}",
                "result": "W" if won else "L"
            })
        
        result["home_form"]["record"] = "".join(home_record)
        result["home_form"]["wins"] = home_record.count("W")
        result["home_form"]["losses"] = home_record.count("L")
        
        # 從主隊的比賽中找 H2H
        for ev in home_events:
            ev_home = ev.get("strHomeTeam", "")
            ev_away = ev.get("strAwayTeam", "")
            # 檢查是否是兩隊的交手
            teams_in_event = [ev_home.lower(), ev_away.lower()]
            if any(w in " ".join(teams_in_event) for w in away_team.lower().split() if len(w) > 3):
                h2h_entry = {
                    "date": ev.get("dateEvent", ""),
                    "home": ev_home,
                    "away": ev_away,
                    "score": f"{ev.get('intHomeScore', '?')}-{ev.get('intAwayScore', '?')}"
                }
                if h2h_entry not in result["h2h_history"]:
                    result["h2h_history"].append(h2h_entry)
    
    # 取客隊近期比賽
    if away_id:
        away_events = fetch_team_last_events(away_id)
        time_module.sleep(1)
        
        away_record = []
        for ev in away_events[:5]:
            home_score = int(ev.get("intHomeScore", 0) or 0)
            away_score = int(ev.get("intAwayScore", 0) or 0)
            is_home = ev.get("idHomeTeam") == away_id
            team_score = home_score if is_home else away_score
            opp_score = away_score if is_home else home_score
            won = team_score > opp_score
            away_record.append("W" if won else "L")
            result["away_form"]["details"].append({
                "date": ev.get("dateEvent", ""),
                "opponent": ev.get("strAwayTeam") if is_home else ev.get("strHomeTeam"),
                "score": f"{home_score}-{away_score}",
                "result": "W" if won else "L"
            })
        
        result["away_form"]["record"] = "".join(away_record)
        result["away_form"]["wins"] = away_record.count("W")
        result["away_form"]["losses"] = away_record.count("L")
        
        # 從客隊的比賽中補充 H2H
        for ev in away_events:
            ev_home = ev.get("strHomeTeam", "")
            ev_away = ev.get("strAwayTeam", "")
            teams_in_event = [ev_home.lower(), ev_away.lower()]
            if any(w in " ".join(teams_in_event) for w in home_team.lower().split() if len(w) > 3):
                h2h_entry = {
                    "date": ev.get("dateEvent", ""),
                    "home": ev_home,
                    "away": ev_away,
                    "score": f"{ev.get('intHomeScore', '?')}-{ev.get('intAwayScore', '?')}"
                }
                if h2h_entry not in result["h2h_history"]:
                    result["h2h_history"].append(h2h_entry)
    
    # H2H 按日期排序 (最新的在前)
    result["h2h_history"].sort(key=lambda x: x.get("date", ""), reverse=True)
    result["h2h_history"] = result["h2h_history"][:5]  # 最多5場
    
    return result


# ============================================================
# NBA 背靠背偵測
# ============================================================
def detect_back_to_back(matches):
    """偵測 NBA 背靠背第二場的疲勞隊伍"""
    # 只處理 NBA
    nba_matches = [m for m in matches if "nba" in m.get("sport_key", "").lower()]
    if len(nba_matches) < 2:
        return
    
    # 建立隊伍 -> 比賽時間的映射
    team_schedule = {}  # team -> list of (commence_time, match_ref)
    for match in nba_matches:
        ct = match.get("commence_time", "")
        if not ct:
            continue
        try:
            game_time = datetime.fromisoformat(ct.replace("Z", "+00:00"))
        except:
            continue
        
        for team in [match["home_team"], match["away_team"]]:
            if team not in team_schedule:
                team_schedule[team] = []
            team_schedule[team].append((game_time, match))
    
    # 檢查每隊是否有背靠背
    for team, games in team_schedule.items():
        games.sort(key=lambda x: x[0])
        for i in range(1, len(games)):
            time_diff = (games[i][0] - games[i-1][0]).total_seconds() / 3600
            if 18 <= time_diff <= 30:  # 18~30 小時間隔 = 背靠背
                match_ref = games[i][1]
                prev_match = games[i-1][1]
                prev_opponent = prev_match["away_team"] if prev_match["home_team"] == team else prev_match["home_team"]
                
                if "fatigue_alert" not in match_ref:
                    match_ref["fatigue_alert"] = []
                match_ref["fatigue_alert"].append({
                    "team": team,
                    "type": "b2b",
                    "message": f"背靠背第二場 (前一場 vs {prev_opponent})"
                })
                print(f"  😴 背靠背偵測: {team} (前一場 vs {prev_opponent})")


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
    
    # 使用字串字典形式設定 (避免套件版本匯入錯誤)
    safety_settings = [
        {"category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_NONE"},
        {"category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "BLOCK_NONE"},
        {"category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_NONE"},
        {"category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_NONE"},
    ]

    results = []
    import time
    
    # 免費版每日限制: gemini-2.0-flash ~1500次/天, gemini-2.5-flash 僅20次/天
    # 每次最多分析 3 場 (每天排程4次 = 最多12次/天，安全範圍內)
    matches_with_changes.sort(
        key=lambda m: max(m.get("true_probs", {}).values(), default=50),
        reverse=True
    )
    matches_to_analyze = matches_with_changes[:3]
    print(f"  📊 共 {len(matches_with_changes)} 場符合條件，取前 {len(matches_to_analyze)} 場進行 AI 分析")
    
    # 優先使用 gemini-2.0-flash (每日額度較高)，失敗才降級
    MODEL_PRIORITY = ["gemini-2.0-flash", "gemini-2.5-flash"]
    active_model = None
    for model_name in MODEL_PRIORITY:
        try:
            test_model = genai.GenerativeModel(model_name)
            test_response = test_model.generate_content("回答OK", safety_settings=safety_settings)
            if test_response.text:
                active_model = test_model
                print(f"  ✅ 使用模型: {model_name}")
                time.sleep(5)  # 測試也消耗配額，休息一下
                break
        except Exception as e:
            print(f"  ⚠️ {model_name} 不可用: {e}")
    
    if not active_model:
        print("  ❌ 所有 AI 模型都不可用，跳過分析")
        for match in matches_to_analyze:
            match["ai_analysis"] = "AI 每日免費額度已用完，明天會自動恢復。請參考勝率數據自行判斷。"
            match["analysis_source"] = "fallback"
            results.append(match)
        return results
    
    for i, match in enumerate(matches_to_analyze):
        prompt = build_analysis_prompt(match, news_items)
        try:
            response = active_model.generate_content(prompt, safety_settings=safety_settings)
            analysis_text = response.text.strip()
            match["ai_analysis"] = analysis_text
            match["analysis_source"] = "gemini"
            print(f"  🤖 [{i+1}/{len(matches_to_analyze)}] AI 分析完成: {match['home_team']} vs {match['away_team']}")
            
            # 每次間隔 15 秒避免 RPM 限制
            if i < len(matches_to_analyze) - 1:
                print(f"  ⏳ 等待 15 秒避免觸發速率限制...")
                time.sleep(15)
        except Exception as e:
            error_msg = str(e).replace('"', "'")
            print(f"  ⚠️ AI 分析失敗: {error_msg}")
            match["ai_analysis"] = f"AI 分析暫時無法使用 ({error_msg[:80]})。請參考勝率數據判斷。"
            match["analysis_source"] = "fallback"

        results.append(match)

    return results


def build_analysis_prompt(match, news_items):
    """建構 AI 分析的 Prompt (含傷兵/H2H/疲勞)"""
    home = match["home_team"]
    away = match["away_team"]
    league = match["league"]
    opening = match.get("opening_odds", {})
    current = match.get("avg_odds", {})
    change = match.get("odds_change", {})
    change_pct = match.get("change_pct", {})

    true_probs = match.get("true_probs", {})
    other_markets = match.get("other_markets", {})
    spreads = other_markets.get("spreads", {})
    totals = other_markets.get("totals", {})

    # 提取讓分和大小分
    spread_str = "無"
    for k, v in spreads.items():
        if "point" in v:
            spread_str = f"主讓 {v['point']}"
            break

    total_str = "無"
    for k, v in totals.items():
        if "point" in v:
            total_str = f"大小 {v['point']}"
            break

    # 組織新聞文字
    news_text = ""
    for item in news_items[:10]:
        news_text += f"- {item['title']}\n"

    # 傷兵資訊
    injury_text = "無已知傷兵消息"
    injuries = match.get("injury_alerts", [])
    if injuries:
        injury_text = "\n".join([f"- 🏥 [{inj['team']}] {inj['title']}" for inj in injuries])

    # 背靠背疲勞
    fatigue_text = "無"
    fatigue = match.get("fatigue_alert", [])
    if fatigue:
        fatigue_text = "\n".join([f"- 😴 {fa['team']}: {fa['message']}" for fa in fatigue])

    # H2H 歷史交手
    h2h_text = "無歷史交手資料"
    h2h = match.get("h2h_history", [])
    if h2h:
        h2h_text = "\n".join([f"- {h['date']}: {h['home']} vs {h['away']} ({h['score']})" for h in h2h])

    # 近期戰績
    home_form = match.get("home_form", {})
    away_form = match.get("away_form", {})
    form_text = f"- {home}: 近5場 {home_form.get('record', '未知')} ({home_form.get('wins', 0)}勝{home_form.get('losses', 0)}負)\n"
    form_text += f"- {away}: 近5場 {away_form.get('record', '未知')} ({away_form.get('wins', 0)}勝{away_form.get('losses', 0)}負)"

    prompt = f"""你是一位專業的運動彩券分析師，請用繁體中文回答。

## 比賽資訊
- 聯賽: {league}
- 主隊: {home} (真實勝率: {true_probs.get(home, '未知')}%)
- 客隊: {away} (真實勝率: {true_probs.get(away, '未知')}%)
- 開賽時間: {match.get('commence_time', '未知')}

## 附加盤口資訊
- 讓分盤: {spread_str}
- 大小分盤: {total_str}

## 傷兵快訊
{injury_text}

## 疲勞警示
{fatigue_text}

## 歷史交手紀錄
{h2h_text}

## 近期戰績
{form_text}

## 獨贏賠率變動
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
1. 結合「真實勝率」「讓分/大小」「傷兵」「疲勞」「近期戰績」「歷史交手」，在開頭給出【💡 投注推薦】（例如：【💡 推薦：主讓 -6.5】或【💡 推薦：大分 246.5】）。
2. 用 2~3 句話說明推薦原因，必須提到你考量了哪些關鍵因素（傷兵？背靠背？近期戰績？H2H？）。
3. 若有傷兵或背靠背疲勞，必須特別提醒其對盤口的可能影響。
4. 回答格式：第一行【💡 推薦：xxx】，第二行起說明原因。控制在 100 字以內。
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

    # 5.5 傷兵篩選
    print("\n🏥 篩選傷兵資訊...")
    all_news = news["nba"] + news["soccer"]
    injury_count = 0
    for match in matches_with_changes:
        injuries = filter_injury_news(all_news, match["home_team"], match["away_team"])
        if injuries:
            match["injury_alerts"] = injuries
            injury_count += len(injuries)
    print(f"  🏥 共發現 {injury_count} 則傷兵相關新聞")

    # 5.6 NBA 背靠背偵測
    print("\n😴 偵測 NBA 背靠背...")
    detect_back_to_back(matches_with_changes)

    # 5.7 TheSportsDB: H2H + 近5場戰績 (只對前8場比賽抓取，避免速率限制)
    print("\n📊 抓取 H2H 交手紀錄與近期戰績...")
    for i, match in enumerate(matches_with_changes[:8]):
        try:
            h2h_data = fetch_h2h_and_form(match["home_team"], match["away_team"])
            match["h2h_history"] = h2h_data["h2h_history"]
            match["home_form"] = h2h_data["home_form"]
            match["away_form"] = h2h_data["away_form"]
            form_home = h2h_data['home_form'].get('record', '')
            form_away = h2h_data['away_form'].get('record', '')
            h2h_count = len(h2h_data['h2h_history'])
            print(f"  [{i+1}] {match['home_team']}({form_home}) vs {match['away_team']}({form_away}), H2H: {h2h_count}場")
        except Exception as e:
            print(f"  ⚠️ H2H 抓取失敗 ({match['home_team']} vs {match['away_team']}): {e}")

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
