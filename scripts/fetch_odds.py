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
from google import genai
from google.genai import types
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
ODDS_API_KEY_2 = os.environ.get("ODDS_API_KEY_2", "")
ODDS_API_KEY_3 = os.environ.get("ODDS_API_KEY_3", "")
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_API_KEY_2 = os.environ.get("GEMINI_API_KEY_2", "") or os.environ.get("GEMINI_API_KEY2", "")
GEMINI_API_KEY_3 = os.environ.get("GEMINI_API_KEY_3", "") or os.environ.get("GEMINI_API_KEY3", "")
# DEBUG 模式: 設定為 true 時跳過 Odds API 呼叫，使用快取資料，只測試 AI 功能
DEBUG_SKIP_ODDS = os.environ.get("DEBUG_SKIP_ODDS", "").lower() in ("true", "1", "yes")

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

# 新聞 RSS 來源 (中文優先、英文補充)
NEWS_RSS = {
    "nba": [
        "https://tw.news.yahoo.com/rss/nba",
        "https://www.espn.com/espn/rss/nba/news",
        "https://sports.yahoo.com/nba/rss.xml",
    ],
    "soccer": [
        "https://tw.news.yahoo.com/rss/soccer",
        "http://feeds.bbci.co.uk/sport/football/rss.xml",
        "https://www.espn.com/espn/rss/soccer/news",
    ],
}

# 檔案路徑
DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
CURRENT_FILE = os.path.join(DATA_DIR, "current.json")
HISTORY_FILE_TEMPLATE = os.path.join(DATA_DIR, "archive", "{date}.json")


# ============================================================
# Odds API Key 管理器（支援多把 Key）
# ============================================================
class OddsApiKeyManager:
    """管理多把 Odds API Key，額度不足時自動切換"""
    def __init__(self):
        self.keys = []
        if ODDS_API_KEY:
            self.keys.append({"key": ODDS_API_KEY, "label": "Key-1", "remaining": 999})
        if ODDS_API_KEY_2:
            self.keys.append({"key": ODDS_API_KEY_2, "label": "Key-2", "remaining": 999})
        if ODDS_API_KEY_3:
            self.keys.append({"key": ODDS_API_KEY_3, "label": "Key-3", "remaining": 999})
        self.current_idx = 0
    
    def get_key(self):
        if not self.keys:
            return ""
        return self.keys[self.current_idx]["key"]
    
    def get_label(self):
        if not self.keys:
            return "N/A"
        return self.keys[self.current_idx]["label"]
    
    def update_remaining(self, remaining_str):
        if not self.keys:
            return
        try:
            remaining = int(remaining_str)
            self.keys[self.current_idx]["remaining"] = remaining
            if remaining < 20 and len(self.keys) > 1:
                next_idx = (self.current_idx + 1) % len(self.keys)
                if self.keys[next_idx]["remaining"] > 20:
                    print(f"  🔄 {self.get_label()} 剩餘 {remaining} 次，自動切換至 {self.keys[next_idx]['label']}")
                    self.current_idx = next_idx
        except (ValueError, TypeError):
            pass
    
    def get_total_remaining(self):
        return sum(k["remaining"] for k in self.keys)

key_manager = OddsApiKeyManager()


# ============================================================
# Gemini 雙 API Key 管理器
# ============================================================
class GeminiApiKeyManager:
    """管理雙 Gemini API Key，遇到 Quota 錯誤時自動切換"""
    def __init__(self):
        self.keys = []
        if GEMINI_API_KEY:
            self.keys.append({"key": GEMINI_API_KEY, "label": "GKey-1", "active": True})
        if GEMINI_API_KEY_2:
            self.keys.append({"key": GEMINI_API_KEY_2, "label": "GKey-2", "active": True})
        if GEMINI_API_KEY_3:
            self.keys.append({"key": GEMINI_API_KEY_3, "label": "GKey-3", "active": True})
        self.current_idx = 0
    
    def get_key(self):
        if not self.keys or not self.keys[self.current_idx]["active"]:
            return ""
        return self.keys[self.current_idx]["key"]
    
    def get_label(self):
        if not self.keys:
            return "N/A"
        return self.keys[self.current_idx]["label"]
        
    def switch_key(self, is_quota=False):
        if len(self.keys) > 1:
            if is_quota:
                self.keys[self.current_idx]["active"] = False
                print(f"  ❌ {self.keys[self.current_idx]['label']} 額度可能已滿，停用此 Key。")
            else:
                print(f"  🔄 {self.keys[self.current_idx]['label']} 觸發速率限制，暫時切換至下一把 Key。")

            for _ in range(len(self.keys)):
                self.current_idx = (self.current_idx + 1) % len(self.keys)
                if self.keys[self.current_idx]["active"]:
                    return True
        elif is_quota and self.keys:
            self.keys[self.current_idx]["active"] = False
        return False

    def reset(self):
        """重置所有 Key 為可用狀態 (用於翻譯和分析之間，避免連坐效應)"""
        for k in self.keys:
            k["active"] = True
        self.current_idx = 0
        if self.keys:
            print(f"  🔄 已重置 Gemini Key Manager ({len(self.keys)} 把 Key 全部回復可用)")

gemini_key_manager = GeminiApiKeyManager()


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
    """從 The Odds API 抓取某聯賽的賠率 (使用 Key Manager，401 時自動切換 Key)"""
    url = f"{ODDS_API_BASE}/{sport_key}/odds/"
    markets = "h2h,spreads,totals"
    league_name = LEAGUES.get(sport_key, sport_key)

    # v1.8.4: 遇 401/403 自動嘗試所有 Key
    for attempt in range(len(key_manager.keys)):
        params = {
            "apiKey": key_manager.get_key(),
            "regions": "us,eu",
            "markets": markets,
            "oddsFormat": "decimal",
        }

        try:
            resp = requests.get(url, params=params, timeout=30)
            if resp.status_code == 200:
                data = resp.json()
                remaining = resp.headers.get("x-requests-remaining", "?")
                key_manager.update_remaining(remaining)
                print(f"  ✅ {league_name}: 取得 {len(data)} 場比賽 ({key_manager.get_label()} 剩餘: {remaining})")
                return data, remaining
            elif resp.status_code == 422:
                print(f"  ⚠️ {league_name}: 目前無賽事")
                return [], "?"
            elif resp.status_code in (401, 403):
                print(f"  ⚠️ {league_name}: {key_manager.get_label()} 認證失敗 (HTTP {resp.status_code})")
                # 標記此 Key 已失效，嘗試下一把
                key_manager.keys[key_manager.current_idx]["remaining"] = 0
                next_idx = (key_manager.current_idx + 1) % len(key_manager.keys)
                if next_idx != key_manager.current_idx and key_manager.keys[next_idx]["remaining"] > 0:
                    print(f"  🔄 切換至 {key_manager.keys[next_idx]['label']} 重試...")
                    key_manager.current_idx = next_idx
                    continue
                else:
                    print(f"  ❌ {league_name}: 所有 Odds API Key 均認證失敗")
                    return [], "?"
            else:
                print(f"  ❌ {league_name}: API 錯誤 {resp.status_code}")
                return [], "?"
        except Exception as e:
            print(f"  ❌ {league_name}: 連線失敗 - {e}")
            return [], "?"

    print(f"  ❌ {league_name}: 所有 Key 嘗試完畢仍失敗")
    return [], "?"


def fetch_scores(sport_key):
    """從 The Odds API 抓取已結束比賽的比數 (daysFrom=3, 401 時自動切換 Key)"""
    url = f"{ODDS_API_BASE}/{sport_key}/scores/"
    league_name = LEAGUES.get(sport_key, sport_key)

    for attempt in range(len(key_manager.keys)):
        params = {
            "apiKey": key_manager.get_key(),
            "daysFrom": 3,
        }
        try:
            resp = requests.get(url, params=params, timeout=30)
            if resp.status_code == 200:
                data = resp.json()
                remaining = resp.headers.get("x-requests-remaining", "?")
                key_manager.update_remaining(remaining)
                completed = [g for g in data if g.get("completed")]
                print(f"  ✅ {league_name} 比數: {len(completed)} 場已結束 ({key_manager.get_label()} 剩餘: {remaining})")
                return completed, remaining
            elif resp.status_code in (401, 403):
                print(f"  ⚠️ {league_name} 比數: {key_manager.get_label()} 認證失敗 (HTTP {resp.status_code})")
                key_manager.keys[key_manager.current_idx]["remaining"] = 0
                next_idx = (key_manager.current_idx + 1) % len(key_manager.keys)
                if next_idx != key_manager.current_idx and key_manager.keys[next_idx]["remaining"] > 0:
                    print(f"  🔄 切換至 {key_manager.keys[next_idx]['label']} 重試...")
                    key_manager.current_idx = next_idx
                    continue
                else:
                    print(f"  ❌ {league_name} 比數: 所有 Key 認證失敗")
                    return [], "?"
            else:
                print(f"  ⚠️ {league_name} 比數: API 錯誤 {resp.status_code}")
                return [], "?"
        except Exception as e:
            print(f"  ❌ {league_name} 比數: 連線失敗 - {e}")
            return [], "?"

    return [], "?"


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
    """比對初盤與現盤，計算變動，累積盤口時序"""
    results = []
    now_str = get_now().strftime("%m/%d %H:%M")

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
            # 初始化盤口時序
            snapshot = {"time": now_str}
            snapshot.update(match["avg_odds"])
            match["odds_timeline"] = [snapshot]
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
            
            # 定義資金趨勢/價值注警示
            is_value_bet = False
            for team, pct in change_pct.items():
                if pct <= -5.0:
                    is_value_bet = True
            match["is_value_bet"] = is_value_bet
            
            # 累積盤口時序 (最多保留 20 個快照)
            timeline = existing_match.get("odds_timeline", [])
            snapshot = {"time": now_str}
            snapshot.update(match["avg_odds"])
            # 避免重複快照
            if not timeline or timeline[-1].get("time") != now_str:
                timeline.append(snapshot)
            match["odds_timeline"] = timeline[-20:]

        results.append(match)

    return results


def detect_sharp_moves(matches):
    """偵測急速盤口移動 (聪明錢訊號)"""
    for match in matches:
        timeline = match.get("odds_timeline", [])
        if len(timeline) < 2:
            continue
        
        sharp_moves = []
        latest = timeline[-1]
        prev = timeline[-2]
        
        for team in match.get("avg_odds", {}).keys():
            cur_price = latest.get(team, 0)
            prev_price = prev.get(team, 0)
            if prev_price <= 0 or cur_price <= 0:
                continue
            
            move_pct = round((cur_price - prev_price) / prev_price * 100, 2)
            
            if move_pct <= -8.0:
                level = "💰 聪明錢訊號" if move_pct <= -15.0 else "🔥 急速移動"
                sharp_moves.append({
                    "team": team,
                    "move_pct": move_pct,
                    "from": prev_price,
                    "to": cur_price,
                    "level": level,
                    "message": f"{team} 賠率 {prev_price:.2f}→{cur_price:.2f} ({move_pct:+.1f}%)"
                })
        
        if sharp_moves:
            match["sharp_moves"] = sharp_moves


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
    """從新聞中篩選出與兩隊相關的傷兵消息

    比對規則（較嚴格）：
    - 傷兵關鍵字：出現在 title 即可（title 是主題，更可靠）
    - 隊名比對：**僅在 title** 中尋找，避免 summary 順帶提及其他隊伍造成誤標
    """
    injury_alerts = []
    home_words = [w for w in home_team.lower().split() if len(w) > 3]
    away_words = [w for w in away_team.lower().split() if len(w) > 3]

    for item in news_items:
        title_lower = item.get("title", "").lower()
        summary_lower = item.get("summary", "").lower()

        # 傷兵關鍵字必須出現在 title（主題明確），summary 僅作備用
        has_injury_kw = (
            any(kw in title_lower for kw in INJURY_KEYWORDS)
            or any(kw in summary_lower for kw in INJURY_KEYWORDS)
        )
        if not has_injury_kw:
            continue

        # 隊名只在 title 比對：確保文章主角是這場比賽的隊伍
        related_team = None
        if home_words and any(w in title_lower for w in home_words):
            related_team = home_team
        elif away_words and any(w in title_lower for w in away_words):
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
    """取得 H2H 交手紀錄與雙方近5場戰績 (含主客場拆分)"""
    result = {
        "h2h_history": [],
        "home_form": {"record": "", "wins": 0, "losses": 0, "home_record": "", "away_record": "", "details": []},
        "away_form": {"record": "", "wins": 0, "losses": 0, "home_record": "", "away_record": "", "details": []},
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
        home_at_home = []  # 主場戰績
        home_at_away = []  # 客場戰績
        for ev in home_events[:5]:
            home_score = int(ev.get("intHomeScore", 0) or 0)
            away_score = int(ev.get("intAwayScore", 0) or 0)
            is_home = ev.get("idHomeTeam") == home_id
            team_score = home_score if is_home else away_score
            opp_score = away_score if is_home else home_score
            won = team_score > opp_score
            r = "W" if won else "L"
            home_record.append(r)
            if is_home:
                home_at_home.append(r)
            else:
                home_at_away.append(r)
            result["home_form"]["details"].append({
                "date": ev.get("dateEvent", ""),
                "opponent": ev.get("strAwayTeam") if is_home else ev.get("strHomeTeam"),
                "score": f"{home_score}-{away_score}",
                "result": r,
                "venue": "主" if is_home else "客"
            })
        
        result["home_form"]["record"] = "".join(home_record)
        result["home_form"]["wins"] = home_record.count("W")
        result["home_form"]["losses"] = home_record.count("L")
        result["home_form"]["home_record"] = "".join(home_at_home)
        result["home_form"]["away_record"] = "".join(home_at_away)
        
        # 從主隊的比賽中找 H2H (掃近期賽程作為補充)
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

    # 使用 TheSportsDB 專用 H2H endpoint 補充 (更準確，跨聯會也能找到)
    if home_id and away_id:
        try:
            h2h_url = f"{SPORTSDB_BASE}/eventsh2h.php"
            h2h_resp = requests.get(h2h_url, params={"id": home_id, "id2": away_id}, timeout=10)
            time_module.sleep(1)
            if h2h_resp.status_code == 200:
                h2h_data = h2h_resp.json()
                for ev in (h2h_data.get("results") or []):
                    ev_home = ev.get("strHomeTeam", "")
                    ev_away = ev.get("strAwayTeam", "")
                    h2h_entry = {
                        "date": ev.get("dateEvent", ""),
                        "home": ev_home,
                        "away": ev_away,
                        "score": f"{ev.get('intHomeScore', '?')}-{ev.get('intAwayScore', '?')}"
                    }
                    if h2h_entry not in result["h2h_history"]:
                        result["h2h_history"].append(h2h_entry)
        except Exception as e:
            print(f"    ⚠️ TheSportsDB H2H endpoint 失敗: {e}")
    
    # 取客隊近期比賽
    if away_id:
        away_events = fetch_team_last_events(away_id)
        time_module.sleep(1)
        
        away_record = []
        away_at_home = []
        away_at_away = []
        for ev in away_events[:5]:
            home_score = int(ev.get("intHomeScore", 0) or 0)
            away_score = int(ev.get("intAwayScore", 0) or 0)
            is_home = ev.get("idHomeTeam") == away_id
            team_score = home_score if is_home else away_score
            opp_score = away_score if is_home else home_score
            won = team_score > opp_score
            r = "W" if won else "L"
            away_record.append(r)
            if is_home:
                away_at_home.append(r)
            else:
                away_at_away.append(r)
            result["away_form"]["details"].append({
                "date": ev.get("dateEvent", ""),
                "opponent": ev.get("strAwayTeam") if is_home else ev.get("strHomeTeam"),
                "score": f"{home_score}-{away_score}",
                "result": r,
                "venue": "主" if is_home else "客"
            })
        
        result["away_form"]["record"] = "".join(away_record)
        result["away_form"]["wins"] = away_record.count("W")
        result["away_form"]["losses"] = away_record.count("L")
        result["away_form"]["home_record"] = "".join(away_at_home)
        result["away_form"]["away_record"] = "".join(away_at_away)
        
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
# 足球天氣模組 (Open-Meteo, 免費無需 Key)
# ============================================================
# 主要足球城市座標 (擴充用)
VENUE_COORDS = {
    # EPL
    "Arsenal": (51.555, -0.108), "Chelsea": (51.482, -0.191),
    "Liverpool": (53.431, -2.961), "Manchester City": (53.483, -2.200),
    "Manchester United": (53.463, -2.291), "Tottenham": (51.604, -0.066),
    "Aston Villa": (52.509, -1.885), "Newcastle": (54.976, -1.622),
    # La Liga
    "Barcelona": (41.381, 2.123), "Real Madrid": (40.453, -3.688),
    "Atletico Madrid": (40.436, -3.600),
    # Serie A
    "AC Milan": (45.478, 9.124), "Inter": (45.478, 9.124),
    "Juventus": (45.110, 7.641), "Roma": (41.934, 12.455), "Napoli": (40.828, 14.193),
    # Bundesliga
    "Bayern Munich": (48.219, 11.625), "Borussia Dortmund": (51.493, 7.452),
    # UCL common
    "Paris Saint-Germain": (48.842, 2.253), "PSG": (48.842, 2.253), 
    "Benfica": (38.753, -9.185), "Porto": (41.162, -8.584),
}

def get_venue_coords(team_name):
    """根據隊名查找球場座標"""
    for key, coords in VENUE_COORDS.items():
        if key.lower() in team_name.lower():
            return coords
    return None

def fetch_match_weather(home_team, commence_time):
    """用 Open-Meteo 取得比賽當地天氣 (僅足球)"""
    coords = get_venue_coords(home_team)
    if not coords:
        return None
    
    lat, lon = coords
    try:
        url = "https://api.open-meteo.com/v1/forecast"
        params = {
            "latitude": lat,
            "longitude": lon,
            "current": "temperature_2m,wind_speed_10m,rain,weather_code",
            "timezone": "auto"
        }
        resp = requests.get(url, params=params, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            current = data.get("current", {})
            temp = current.get("temperature_2m", 0)
            wind = current.get("wind_speed_10m", 0)
            rain = current.get("rain", 0)
            code = current.get("weather_code", 0)
            
            # 判斷天氣狀況
            if rain > 0 or code in [61, 63, 65, 80, 81, 82, 95, 96, 99]:
                condition = "🌧️ 雨天"
            elif wind > 30:
                condition = "💨 強風"
            elif code in [71, 73, 75, 85, 86]:
                condition = "❄️ 雪"
            elif code in [45, 48]:
                condition = "🌫️ 霧"
            else:
                condition = "☀️ 晴朗"
            
            weather = {
                "temp": round(temp, 1),
                "wind": round(wind, 1),
                "rain": round(rain, 1),
                "condition": condition,
                "impact": ""
            }
            
            # 評估對大小球的影響
            if rain > 2 or wind > 35:
                weather["impact"] = "⚠️ 天氣可能壓低進球數 (建議留意小分)"
            elif rain > 0 or wind > 25:
                weather["impact"] = "場地可能濕滑，對腳下技術要求較高"
            
            return weather
    except Exception as e:
        print(f"    ⚠️ 天氣查詢失敗 ({home_team}): {e}")
    return None


# ============================================================
# ATS 讓分勝率累積器 (種子階段)
# ============================================================
ATS_FILE = os.path.join(DATA_DIR, "ats_tracker.json")

def load_ats_data():
    """載入 ATS 累積資料"""
    return load_json(ATS_FILE) or {"teams": {}, "last_updated": ""}

def update_ats_tracker(matches):
    """將當前讓分盤口資訊寫入 ATS 追蹤器 (種子階段: 只記錄盤口，不記錄結果)"""
    ats = load_ats_data()
    now = get_now().isoformat()
    
    for match in matches:
        spreads = match.get("other_markets", {}).get("spreads", {})
        if not spreads:
            continue
        
        for team in [match["home_team"], match["away_team"]]:
            if team not in ats["teams"]:
                ats["teams"][team] = {"games_tracked": 0, "spreads_history": []}
            
            spread_info = spreads.get(team, {})
            if "point" in spread_info:
                ats["teams"][team]["spreads_history"].append({
                    "date": now[:10],
                    "opponent": match["away_team"] if team == match["home_team"] else match["home_team"],
                    "spread": spread_info["point"],
                    "match_id": match["id"],
                    "commence_time": match.get("commence_time", ""),
                })
                ats["teams"][team]["games_tracked"] = len(ats["teams"][team]["spreads_history"])
                # 只保留最近 50 筆
                ats["teams"][team]["spreads_history"] = ats["teams"][team]["spreads_history"][-50:]
    
    ats["last_updated"] = now
    save_json(ATS_FILE, ats)
    print(f"  📊 ATS 追蹤器已更新 ({len(ats['teams'])} 隊)")

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
# 新聞翻譯模組 (Gemini 批量翻譯)
# ============================================================
def translate_news_titles(news_dict):
    """用 Gemini 批量翻譯英文新聞標題為中文 (僅 1 次 API 呼叫)"""
    if not GEMINI_API_KEY:
        return news_dict
    
    # 收集所有英文標題
    all_titles = []
    title_map = {}  # index -> (category, item_index)
    
    for category in ["nba", "soccer"]:
        for i, item in enumerate(news_dict.get(category, [])):
            title = item.get("title", "")
            # 只翻譯英文標題 (簡單判斷: 包含拉丁字母且無中文)
            if title and any(c.isascii() and c.isalpha() for c in title) and not any('\u4e00' <= c <= '\u9fff' for c in title):
                idx = len(all_titles)
                all_titles.append(title)
                title_map[idx] = (category, i)
    
    if not all_titles:
        print("  ✅ 新聞全都是中文，無需翻譯")
        return news_dict
    
    print(f"  🌐 批量翻譯 {len(all_titles)} 則英文新聞標題...")
    
    # 組裝 prompt
    numbered = "\n".join([f"{i+1}. {t}" for i, t in enumerate(all_titles)])
    prompt = f"""請將以下英文體育新聞標題翻譯成繁體中文。
規則：
- 每行一則，格式為「編號. 中文翻譯」
- 保留人名與隊名的英文原文（括號內加中文）
- 簡潔流暢

{numbered}"""
    
    max_retries = 2 if len(gemini_key_manager.keys) > 1 else 1
    
    for attempt in range(max_retries):
        api_key = gemini_key_manager.get_key()
        if not api_key:
            print("  ⚠️ 無可用的 Gemini API Key 進行翻譯")
            break
            
        try:
            client = genai.Client(api_key=api_key)
            safety_settings = [
                types.SafetySetting(category="HARM_CATEGORY_DANGEROUS_CONTENT", threshold="BLOCK_NONE"),
                types.SafetySetting(category="HARM_CATEGORY_HATE_SPEECH", threshold="BLOCK_NONE"),
                types.SafetySetting(category="HARM_CATEGORY_HARASSMENT", threshold="BLOCK_NONE"),
                types.SafetySetting(category="HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold="BLOCK_NONE"),
            ]

            response = client.models.generate_content(
                model="gemini-2.5-flash-lite",
                contents=prompt,
                config=types.GenerateContentConfig(safety_settings=safety_settings)
            )

            # 處理安全過濾導致空回應的情況
            if not response.text:
                print("  ⚠️ 翻譯被安全過濾攔截或回應為空，保留英文原文")
                break
            translated = response.text.strip()
            if not translated:
                print("  ⚠️ 翻譯回傳空內容，保留英文原文")
                break

            # 解析翻譯結果
            for line in translated.split("\n"):
                line = line.strip()
                if not line:
                    continue
                # 解析 "1. 翻譯內容" 格式
                parts = line.split(".", 1)
                if len(parts) == 2:
                    try:
                        idx = int(parts[0].strip()) - 1
                        zh_title = parts[1].strip()
                        if idx in title_map and zh_title:
                            cat, item_idx = title_map[idx]
                            # 保留原文，加上翻譯
                            news_dict[cat][item_idx]["title_zh"] = zh_title
                            news_dict[cat][item_idx]["title_en"] = news_dict[cat][item_idx]["title"]
                            news_dict[cat][item_idx]["title"] = zh_title
                    except (ValueError, IndexError):
                        pass
            
            print(f"  ✅ 翻譯完成 ({gemini_key_manager.get_label()})")
            break # 成功，跳出重試迴圈
        except Exception as e:
            err_str = str(e).lower()
            print(f"  ⚠️ 翻譯失敗 ({gemini_key_manager.get_label()}): {str(e)[:60]}")
            if "quota" in err_str or "exhausted" in err_str:
                if gemini_key_manager.switch_key(is_quota=True):
                    continue
            elif "429" in err_str:
                if gemini_key_manager.switch_key(is_quota=False):
                    continue
            break
    
    return news_dict


# ============================================================
# AI 分析模組 (Gemini)
# ============================================================
def analyze_with_ai(matches_with_changes, news_items):
    """使用 Gemini AI 分析賠率變動原因"""
    print(f"  🔧 [AI DEBUG] GEMINI_API_KEY 存在: {bool(GEMINI_API_KEY)}")
    print(f"  🔧 [AI DEBUG] GEMINI_API_KEY_2 存在: {bool(GEMINI_API_KEY_2)}")
    print(f"  🔧 [AI DEBUG] Key Manager keys 數量: {len(gemini_key_manager.keys)}")
    for idx, k in enumerate(gemini_key_manager.keys):
        print(f"  🔧 [AI DEBUG]   Key #{idx}: {k['label']}, active={k['active']}, key={k['key'][:8]}...")

    if not GEMINI_API_KEY and not GEMINI_API_KEY_2 and not GEMINI_API_KEY_3:
        print("  ⚠️ 未設定 GEMINI API KEY，跳過 AI 分析")
        return add_fallback_analysis(matches_with_changes)

    if not matches_with_changes:
        return []

    # 新版 SDK safety settings
    safety_settings = [
        types.SafetySetting(category="HARM_CATEGORY_DANGEROUS_CONTENT", threshold="BLOCK_NONE"),
        types.SafetySetting(category="HARM_CATEGORY_HATE_SPEECH", threshold="BLOCK_NONE"),
        types.SafetySetting(category="HARM_CATEGORY_HARASSMENT", threshold="BLOCK_NONE"),
        types.SafetySetting(category="HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold="BLOCK_NONE"),
    ]

    results = []

    # v1.8.2: 載入歷史成績作為 AI 自我學習素材
    print("  📚 載入 AI 歷史成績進行自我反饋...")
    perf_stats = load_ai_performance_stats(days=14)
    if perf_stats and perf_stats.get("overall", {}).get("total", 0) > 0:
        print(f"  📊 歷史資料: {perf_stats['total_samples']} 場, 整體命中率 {perf_stats['overall'].get('pct', 'N/A')}%")
    else:
        print("  📊 歷史資料不足，跳過自我反饋（累積更多比賽後會啟用）")

    # v1.7.4: 升級至 Gemini 2.5 系列 (免費版額度: flash-lite 1000/日, flash 250/日)
    # 每次最多分析 3~7 場 (依 Key 數量)
    matches_with_changes.sort(
        key=lambda m: max(m.get("true_probs", {}).values(), default=50),
        reverse=True
    )
    matches_to_analyze = matches_with_changes[:3]
    print(f"  📊 共 {len(matches_with_changes)} 場符合條件，取前 {len(matches_to_analyze)} 場進行 AI 分析 (可用 Keys: {len(gemini_key_manager.keys)})")

    # v1.7.4: 升級至 Gemini 2.5 系列（舊版 2.0 將於 2026/6/1 下架）
    # flash-lite 額度最大 (1000 RPD)，優先使用；flash 次之 (250 RPD)
    MODEL_PRIORITY = ["gemini-2.5-flash-lite", "gemini-2.5-flash"]

    for i, match in enumerate(matches_to_analyze):
        # v1.8.2: 為每場比賽找出相似的歷史場次
        similar = find_similar_past_matches(match, days=30) if perf_stats else []
        perf_context = format_performance_context(perf_stats, similar) if perf_stats else ""
        prompt = build_analysis_prompt(match, news_items, performance_context=perf_context)
        success = False

        # v1.7.2 修復：每場比賽重置 Key Manager，避免上一場的失敗狀態汙染後續比賽
        gemini_key_manager.reset()

        # 外層：遍歷所有可用的 Key（最多試 key_count * 2 次）
        max_key_attempts = len(gemini_key_manager.keys) * 2 if gemini_key_manager.keys else 1
        for key_attempt in range(max_key_attempts):
            if success:
                break
            api_key = gemini_key_manager.get_key()
            key_label = gemini_key_manager.get_label()
            print(f"  🔧 [AI DEBUG] Key 嘗試 #{key_attempt+1}, api_key 存在: {bool(api_key)}, label: {key_label}")
            if not api_key:
                print(f"  🔧 [AI DEBUG] ❌ get_key() 返回空，所有 Key 已停用或不存在")
                break

            client = genai.Client(api_key=api_key)
            has_quota_error = False  # 此 Key 是否有任何 quota 錯誤

            # 內層：遍歷所有模型
            for model_name in MODEL_PRIORITY:
                try:
                    print(f"  🔧 [AI DEBUG] 呼叫 {model_name} (via {key_label})...")
                    response = client.models.generate_content(
                        model=model_name,
                        contents=prompt,
                        config=types.GenerateContentConfig(safety_settings=safety_settings)
                    )

                    # 安全地取得回應文字
                    if not response.text:
                        print(f"  ⚠️ {model_name}: 回應為空或被安全過濾攔截")
                        continue

                    analysis_text = response.text.strip()
                    if not analysis_text:
                        print(f"  ⚠️ {model_name}: 回應文字為空")
                        continue

                    match["ai_analysis"] = analysis_text
                    match["analysis_source"] = "gemini"
                    print(f"  🤖 [{i+1}/{len(matches_to_analyze)}] AI 分析完成 ({model_name} via {key_label}): {match['home_team']} vs {match['away_team']}")
                    success = True
                    break
                except Exception as e:
                    err_str = str(e).lower()
                    print(f"  ⚠️ {model_name} 失敗 ({key_label}): {str(e)[:150]}")

                    # v1.7.3: 優先判斷 404 (模型不存在)，避免被後面的 "rate" 誤匹配
                    if "404" in err_str or "not found" in err_str:
                        print(f"  🔧 [AI DEBUG] {model_name} 不存在 (404)，跳過此模型")
                        continue
                    elif "quota" in err_str or "exhausted" in err_str or "resource has been exhausted" in err_str:
                        print(f"  🔧 [AI DEBUG] {model_name} quota 耗盡，繼續嘗試下一個模型...")
                        has_quota_error = True
                        continue
                    elif "429" in err_str or "too many requests" in err_str or "rate limit" in err_str:
                        # 429 短暫 RPM 限制，等一下再試下一個 model
                        print(f"  ⏳ {model_name} 遇到 429 限流，等待 15 秒後試下一個模型...")
                        time_module.sleep(15)
                        continue
                    else:
                        print(f"  🔧 [AI DEBUG] 未知錯誤類型，試下一個 model")
                        continue

            # 所有模型都試完了：只要有 quota 錯誤就嘗試切換 Key
            if not success and has_quota_error:
                print(f"  🔧 [AI DEBUG] {key_label} 遭遇 quota 限制，嘗試切換 Key...")
                switched = gemini_key_manager.switch_key(is_quota=True)
                if not switched:
                    print(f"  🔧 [AI DEBUG] 無更多可用 Key，放棄此場分析")
                    break
            elif not success:
                # 全部都是非 quota 錯誤（如全部 404），不再重試
                print(f"  🔧 [AI DEBUG] 所有模型均非 quota 錯誤，不切 Key")
                break

        if not success:
            match["ai_analysis"] = "AI 每日免費額度已用完，明天會自動恢復。請參考勝率數據自行判斷。"
            match["analysis_source"] = "fallback"
            print(f"  ❌ [{i+1}/{len(matches_to_analyze)}] AI 分析失敗: {match['home_team']} vs {match['away_team']}")

        results.append(match)

        # 每次間隔 15 秒避免 RPM 限制
        if i < len(matches_to_analyze) - 1 and success:
            print(f"  ⏳ 等待 15 秒避免觸發速率限制...")
            time_module.sleep(15)

    return results


def build_analysis_prompt(match, news_items, performance_context=""):
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

    # 近期戰績 (含主客場拆分)
    home_form = match.get("home_form", {})
    away_form = match.get("away_form", {})
    form_text = f"- {home}: 近5場 {home_form.get('record', '未知')} ({home_form.get('wins', 0)}勝{home_form.get('losses', 0)}負)"
    if home_form.get("home_record"):
        form_text += f" | 主場 {home_form['home_record']}, 客場 {home_form.get('away_record', '')}"
    form_text += f"\n- {away}: 近5場 {away_form.get('record', '未知')} ({away_form.get('wins', 0)}勝{away_form.get('losses', 0)}負)"
    if away_form.get("home_record"):
        form_text += f" | 主場 {away_form['home_record']}, 客場 {away_form.get('away_record', '')}"

    # 盤口走勢
    timeline = match.get("odds_timeline", [])
    timeline_text = "僅有單一快照"
    if len(timeline) >= 2:
        timeline_text = ""
        for snap in timeline[-5:]:  # 最近5個快照
            parts = [f"{snap.get('time', '?')}:"]
            for team in current.keys():
                parts.append(f"{team}={snap.get(team, '?')}")
            timeline_text += " | ".join(parts) + "\n"

    # 急速移動
    sharp_text = "無"
    sharp = match.get("sharp_moves", [])
    if sharp:
        sharp_text = "\n".join([f"- {s['level']}: {s['message']}" for s in sharp])

    # 天氣 (足球)
    weather_text = "N/A"
    weather = match.get("weather")
    if weather:
        weather_text = f"{weather['condition']} | 氣溫 {weather['temp']}°C | 風速 {weather['wind']}km/h | 降雨 {weather['rain']}mm"
        if weather.get("impact"):
            weather_text += f"\n{weather['impact']}"

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

## 近期戰績 (含主客場拆分)
{form_text}

## 盤口走勢 (時序)
{timeline_text}

## 急速移動偵測
{sharp_text}

## 天氣 (足球)
{weather_text}

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

{performance_context}

## 你的任務
1. 結合所有資訊（勝率、盤口走勢、急速移動、傷兵、疲勞、主客場、H2H、天氣），在開頭給出【💡 投注推薦】。
2. 用 2~3 句話說明推薦原因，必須提到你考量了哪些關鍵因素。
3. 若有急速移動或聰明錢訊號，特別強調。若盤口走勢顯示單向大幅移動，分析可能原因。
4. 若有傷兵、背靠背、或惡劣天氣，必須提醒對盤口的影響。
5. 若【AI 自我學習參考】顯示當前勝率區間的歷史命中率偏低，請在分析中主動提醒，並降低信心程度。
6. 回答格式：第一行【💡 推薦：xxx】，第二行起說明原因。控制在 150 字以內。
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
# AI 自我反饋學習模組 (v1.8.2)
# ============================================================
def load_ai_performance_stats(days=14):
    """
    讀取最近 N 天的存檔，統計 AI 的歷史命中率。
    回傳一個包含多維度統計的字典，供 prompt 使用。
    """
    archive_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "archive")
    if not os.path.exists(archive_dir):
        return None

    now = datetime.now(timezone.utc)
    all_results = []

    for i in range(days):
        date = (now - timedelta(days=i)).strftime("%Y-%m-%d")
        filepath = os.path.join(archive_dir, f"{date}.json")
        if not os.path.exists(filepath):
            continue
        try:
            with open(filepath, "r", encoding="utf-8") as f:
                data = json.load(f)
            for m in data.get("matches", {}).values():
                result = m.get("ai_result")
                if result and result != "N/A":
                    home_prob = m.get("true_probs", {}).get(m.get("home_team"), 50)
                    away_prob = m.get("true_probs", {}).get(m.get("away_team"), 50)
                    fav_prob = max(home_prob, away_prob)
                    has_sharp = bool(m.get("sharp_moves"))
                    league = m.get("league", "")
                    all_results.append({
                        "result": result,
                        "fav_prob": fav_prob,
                        "has_sharp": has_sharp,
                        "league": league,
                        "date": date,
                        "home": m.get("home_team", ""),
                        "away": m.get("away_team", ""),
                    })
        except Exception:
            continue

    if not all_results:
        return None

    def calc_rate(subset):
        hits = sum(1 for r in subset if r["result"] == "HIT")
        total = sum(1 for r in subset if r["result"] in ("HIT", "MISS"))
        return (hits, total, round(hits / total * 100) if total > 0 else None)

    stats = {"total_samples": len(all_results)}

    # 整體命中率
    h, t, pct = calc_rate(all_results)
    stats["overall"] = {"hits": h, "total": t, "pct": pct}

    # 依聯賽分類
    stats["by_league"] = {}
    for league in set(r["league"] for r in all_results):
        subset = [r for r in all_results if r["league"] == league]
        h, t, pct = calc_rate(subset)
        if t >= 3:
            stats["by_league"][league] = {"hits": h, "total": t, "pct": pct}

    # 依勝率區間分類（僅統計大熱門）
    stats["by_prob_range"] = {}
    for lo, hi, label in [(60, 65, "60-65%"), (65, 70, "65-70%"), (70, 80, "70-80%"), (80, 100, "80%+")]:
        subset = [r for r in all_results if lo <= r["fav_prob"] < hi]
        h, t, pct = calc_rate(subset)
        if t >= 3:
            stats["by_prob_range"][label] = {"hits": h, "total": t, "pct": pct}

    # 有無急速移動的差異
    sharp_sub = [r for r in all_results if r["has_sharp"]]
    normal_sub = [r for r in all_results if not r["has_sharp"]]
    h, t, pct = calc_rate(sharp_sub)
    if t >= 3:
        stats["sharp_moves_rate"] = {"hits": h, "total": t, "pct": pct}
    h, t, pct = calc_rate(normal_sub)
    if t >= 3:
        stats["normal_rate"] = {"hits": h, "total": t, "pct": pct}

    # 近 3 天趨勢
    recent_cutoff = (now - timedelta(days=3)).strftime("%Y-%m-%d")
    recent = [r for r in all_results if r["date"] >= recent_cutoff]
    h, t, pct = calc_rate(recent)
    if t >= 2:
        stats["recent_3d"] = {"hits": h, "total": t, "pct": pct}

    return stats


def find_similar_past_matches(match, days=30, max_results=3):
    """
    在歷史存檔中找出與當前比賽條件相似的已完賽場次。
    相似條件：同聯賽 + 勝率區間相近 + 已有結果
    """
    archive_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "archive")
    if not os.path.exists(archive_dir):
        return []

    home = match.get("home_team", "")
    away = match.get("away_team", "")
    league = match.get("league", "")
    home_prob = match.get("true_probs", {}).get(home, 50)
    away_prob = match.get("true_probs", {}).get(away, 50)
    has_sharp = bool(match.get("sharp_moves"))

    now = datetime.now(timezone.utc)
    similar = []

    for i in range(1, days + 1):  # 從昨天往前找
        date = (now - timedelta(days=i)).strftime("%Y-%m-%d")
        filepath = os.path.join(archive_dir, f"{date}.json")
        if not os.path.exists(filepath):
            continue
        try:
            with open(filepath, "r", encoding="utf-8") as f:
                data = json.load(f)
            for m in data.get("matches", {}).values():
                if m.get("ai_result") not in ("HIT", "MISS"):
                    continue
                if m.get("league", "") != league:
                    continue
                m_home = m.get("home_team", "")
                m_away = m.get("away_team", "")
                m_home_prob = m.get("true_probs", {}).get(m_home, 50)
                m_away_prob = m.get("true_probs", {}).get(m_away, 50)
                # 勝率相差 ≤ 8% 視為相似
                if abs(m_home_prob - home_prob) <= 8 and abs(m_away_prob - away_prob) <= 8:
                    score = m.get("final_score", "?")
                    result_emoji = "✅" if m.get("ai_result") == "HIT" else "❌"
                    similar.append(
                        f"{result_emoji} {date}: {m_home}({m_home_prob:.0f}%) vs {m_away}({m_away_prob:.0f}%) → 比數:{score}"
                    )
                if len(similar) >= max_results:
                    break
        except Exception:
            continue
        if len(similar) >= max_results:
            break

    return similar


def format_performance_context(stats, similar_matches):
    """將歷史成績統計格式化為 prompt 可用的文字"""
    if not stats:
        return ""

    lines = [f"## AI 自我學習參考（過去 {stats.get('total_samples', 0)} 場歷史資料）"]

    overall = stats.get("overall", {})
    if overall.get("pct") is not None:
        trend = stats.get("recent_3d", {})
        trend_str = f"，近3天 {trend['pct']}%（{trend['total']}場）" if trend.get("pct") is not None else ""
        lines.append(f"- 整體命中率: {overall['pct']}%（{overall['total']}場）{trend_str}")

    # 本次聯賽的歷史表現
    by_league = stats.get("by_league", {})
    # 找比賽的聯賽（呼叫時從 match 傳入）
    for league, d in by_league.items():
        if d.get("pct") is not None:
            lines.append(f"- {league} 聯賽命中率: {d['pct']}%（{d['total']}場）")

    # 勝率區間分析
    by_prob = stats.get("by_prob_range", {})
    if by_prob:
        lines.append("- 依勝率區間命中率:")
        for label, d in sorted(by_prob.items()):
            if d.get("pct") is not None:
                flag = "⚠️ 謹慎" if d["pct"] < 50 else ("✅ 穩定" if d["pct"] >= 60 else "")
                lines.append(f"  • {label}: {d['pct']}%（{d['total']}場）{flag}")

    # 急速移動的影響
    sharp_rate = stats.get("sharp_moves_rate", {})
    normal_rate = stats.get("normal_rate", {})
    if sharp_rate.get("pct") is not None and normal_rate.get("pct") is not None:
        diff = sharp_rate["pct"] - normal_rate["pct"]
        diff_str = f"（{'高' if diff > 0 else '低'}於一般場次 {abs(diff)}%）"
        lines.append(f"- 有急速移動場次命中率: {sharp_rate['pct']}% {diff_str}")

    # 相似場次
    if similar_matches:
        lines.append("- 近期相似條件場次:")
        for s in similar_matches:
            lines.append(f"  {s}")

    lines.append("（請根據以上自我表現數據，調整本次分析的信心程度與措辭）")
    return "\n".join(lines)


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


def update_archive_scores(score_data):
    """用比數更新歷史存檔中的比賽紀錄"""
    if not score_data:
        return 0
    
    # 建立 id -> score 映射
    score_map = {}
    for game in score_data:
        gid = game.get("id")
        scores = game.get("scores", [])
        if gid and scores and game.get("completed"):
            score_map[gid] = {
                "completed": True,
                "scores": {s["name"]: s["score"] for s in scores},
                "last_update": game.get("last_update", ""),
            }
    
    if not score_map:
        return 0
    
    updated = 0
    # 搜尋最近 3 天的存檔
    for days_ago in range(4):
        date = (get_now() - timedelta(days=days_ago)).strftime("%Y-%m-%d")
        archive_path = HISTORY_FILE_TEMPLATE.format(date=date)
        archive = load_json(archive_path)
        if not archive:
            continue
        
        changed = False
        for match_id, match in archive.get("matches", {}).items():
            if match_id in score_map and not match.get("final_score"):
                sc = score_map[match_id]
                home = match.get("home_team", "")
                away = match.get("away_team", "")
                home_score = sc["scores"].get(home, "?")
                away_score = sc["scores"].get(away, "?")
                match["final_score"] = f"{home_score}-{away_score}"
                match["completed"] = True
                
                # 判定 AI 預測
                match["ai_result"] = judge_ai_recommendation(match, int(home_score or 0), int(away_score or 0))
                
                updated += 1
                changed = True
        
        if changed:
            save_json(archive_path, archive)
    
    return updated


def judge_ai_recommendation(match, home_score, away_score):
    """判定 AI 推薦是否命中"""
    analysis = match.get("ai_analysis", "")
    if not analysis or "fallback" in match.get("analysis_source", ""):
        return "N/A"
    
    # 嘗試解析推薦內容
    rec_match = re.search(r"【💡\s*推薦[：:]\s*(.+?)】", analysis)
    if not rec_match:
        return "N/A"
    
    rec = rec_match.group(1).strip()
    total_score = home_score + away_score
    
    # 判定讓分 (Spread)
    spread_match = re.search(r"主讓\s*([-+]?\d+\.?\d*)", rec)
    if spread_match:
        spread = float(spread_match.group(1))
        # 主隊得分 + 讓分 > 客隊得分 => 主讓命中
        if home_score + spread > away_score:
            return "HIT"
        elif home_score + spread < away_score:
            return "MISS"
        return "PUSH"
    
    # 判定大小 (Total)
    total_match = re.search(r"(大分|小分|大|小)\s*([\d.]+)", rec)
    if total_match:
        direction = total_match.group(1)
        line = float(total_match.group(2))
        if "大" in direction:
            return "HIT" if total_score > line else "MISS"
        else:
            return "HIT" if total_score < line else "MISS"
    
    # 判定獨贏
    home = match.get("home_team", "")
    away = match.get("away_team", "")
    if home in rec:
        return "HIT" if home_score > away_score else "MISS"
    if away in rec:
        return "HIT" if away_score > home_score else "MISS"
    
    return "N/A"

# ============================================================
# 主流程
# ============================================================
def main():
    print("=" * 60)
    print(f"🏀⚽ 運彩盤口變動追蹤器 - {get_now().strftime('%Y/%m/%d %H:%M')}")
    print("=" * 60)

    # ── DEBUG 環境診斷 ──
    print(f"\n🔧 環境診斷:")
    print(f"  GEMINI_API_KEY: {'✅ 已設定 (' + GEMINI_API_KEY[:8] + '...)' if GEMINI_API_KEY else '❌ 未設定'}")
    print(f"  GEMINI_API_KEY_2: {'✅ 已設定 (' + GEMINI_API_KEY_2[:8] + '...)' if GEMINI_API_KEY_2 else '❌ 未設定'}")
    print(f"  GEMINI_API_KEY_3: {'✅ 已設定 (' + GEMINI_API_KEY_3[:8] + '...)' if GEMINI_API_KEY_3 else '❌ 未設定 (選填)'}")
    print(f"  Gemini Key Manager: {len(gemini_key_manager.keys)} 把 Key")
    print(f"  DEBUG_SKIP_ODDS: {DEBUG_SKIP_ODDS}")

    # 1. 載入現有數據
    print("\n📂 載入現有數據...")
    existing_data = load_json(CURRENT_FILE)

    # 2. 決定本次要抓取的聯賽 (NBA + 輪替1個足球聯賽)
    soccer_league = get_current_soccer_league()
    leagues_to_fetch = ["basketball_nba", soccer_league]

    # ── DEBUG 模式: 跳過 Odds API，用快取資料 ──
    if DEBUG_SKIP_ODDS:
        print("\n🔧 [DEBUG] 跳過 Odds API 呼叫，使用快取資料測試 AI...")
        if existing_data and existing_data.get("matches"):
            all_matches = list(existing_data["matches"].values())
            api_remaining = "DEBUG"
            print(f"  📦 從快取載入 {len(all_matches)} 場比賽")
        else:
            print("\n⚠️ [DEBUG] 無快取資料，結束執行。請先正常執行一次以建立快取。")
            return

        matches_with_changes = all_matches
        significant = get_significant_changes(matches_with_changes)
        print(f"  📈 共 {len(significant)} 場比賽符合 AI 分析門檻 (勝率 ≥ 60%)")
    else:
        print(f"\n📡 本次抓取: NBA + {LEAGUES[soccer_league]}")
        key_count = len(key_manager.keys)
        mode_str = f"{key_count} Key 模式" if key_count >= 2 else "單 Key 模式"
        print(f"  🔑 Odds API Key 數量: {key_count} ({mode_str})")

        # 3. 抓取賠率
        print("\n📊 抓取最新賠率...")
        all_matches = []
        api_remaining = "?"
        for league_key in leagues_to_fetch:
            raw, remaining = fetch_odds(league_key)
            api_remaining = remaining
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

    # 5.1 翻譯英文新聞標題 (批量 1 次 API 呼叫)
    # 注意：翻譯失敗不應影響後續 AI 分析，所以用 try-except 包起來
    print("\n🌐 翻譯新聞標題...")
    try:
        news = translate_news_titles(news)
    except Exception as e:
        print(f"  ⚠️ 翻譯模組異常，保留英文原標題: {str(e)[:60]}")

    # 翻譯完成後等待 20 秒，避免跟後續的 AI 分析撞 RPM 限制
    print("  ⏳ 等待 20 秒緩衝 RPM...")
    time_module.sleep(20)

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

    # 5.8 急速盤口移動偵測
    print("\n🔥 偵測急速盤口移動...")
    detect_sharp_moves(matches_with_changes)
    sharp_count = sum(1 for m in matches_with_changes if m.get("sharp_moves"))
    if sharp_count:
        print(f"  🔥 發現 {sharp_count} 場有急速移動!")
    else:
        print("  ✅ 無急速移動")

    # 5.9 足球天氣查詢 (僅足球賽事)
    print("\n☁️ 查詢足球賽事天氣...")
    weather_count = 0
    for match in matches_with_changes:
        if "soccer" in match.get("sport_key", ""):
            weather = fetch_match_weather(match["home_team"], match.get("commence_time"))
            if weather:
                match["weather"] = weather
                weather_count += 1
                print(f"  {weather['condition']} {match['home_team']}: {weather['temp']}°C, 風速{weather['wind']}km/h")
    if weather_count == 0:
        print("  ✅ 無足球賽事或無天氣資料")

    # 6. AI 分析 (僅對有顯著變動的比賽)
    # 重要：重置 Gemini Key Manager，避免翻譯階段的失敗狀態「連坐」影響 AI 分析
    gemini_key_manager.reset()

    if significant:
        # v1.8.4: 智慧選取邏輯 — 分聯賽配額 + 優先分析尚未分析過的場次
        key_count = len(gemini_key_manager.keys)
        MAX_AI = 3 if key_count == 1 else (5 if key_count == 2 else 7)

        # 1. 分成 NBA 和足球兩組
        nba_matches = [m for m in significant if "nba" in m.get("sport_key", "").lower() or "basketball" in m.get("sport_key", "").lower()]
        soccer_matches = [m for m in significant if m not in nba_matches]

        # 2. 排序優先級：尚未分析過的排前面 → 再按勝率排
        def sort_key(m):
            already_analyzed = 1 if m.get("analysis_source") == "gemini" else 0
            max_prob = max(m.get("true_probs", {}).values(), default=50)
            return (already_analyzed, -max_prob)  # 未分析的排前面，同狀態內按勝率高排前

        nba_matches.sort(key=sort_key)
        soccer_matches.sort(key=sort_key)

        # 3. 分配配額：確保兩邊都有名額
        if nba_matches and soccer_matches:
            # 至少各保留 2 個名額（有足球時）
            soccer_quota = max(2, MAX_AI // 3)  # 至少 2 場足球
            nba_quota = MAX_AI - soccer_quota
            # 如果某邊不夠，把名額讓給另一邊
            if len(nba_matches) < nba_quota:
                soccer_quota += (nba_quota - len(nba_matches))
                nba_quota = len(nba_matches)
            if len(soccer_matches) < soccer_quota:
                nba_quota += (soccer_quota - len(soccer_matches))
                soccer_quota = len(soccer_matches)
        elif soccer_matches:
            soccer_quota = MAX_AI
            nba_quota = 0
        else:
            nba_quota = MAX_AI
            soccer_quota = 0

        ai_targets = nba_matches[:nba_quota] + soccer_matches[:soccer_quota]
        # 混合排序，讓分析結果交替出現
        ai_targets.sort(key=sort_key)

        nba_count = sum(1 for m in ai_targets if "nba" in m.get("sport_key", "").lower() or "basketball" in m.get("sport_key", "").lower())
        soccer_count = len(ai_targets) - nba_count
        print(f"\n🤖 啟動 AI 分析... (符合條件 {len(significant)} 場, 取 {len(ai_targets)} 場: NBA {nba_count} + 足球 {soccer_count})")

        # 根據聯賽類型選擇新聞
        consecutive_failures = 0
        for idx, match in enumerate(ai_targets):
            if "nba" in match.get("sport_key", ""):
                relevant_news = news["nba"]
            else:
                relevant_news = news["soccer"]
            print(f"\n  --- 分析第 {idx+1}/{len(ai_targets)} 場: {match['home_team']} vs {match['away_team']} ({match.get('league','')}) ---")
            analyze_with_ai([match], relevant_news)

            # 早停機制：連續 2 場都失敗就不再嘗試，節省時間
            if match.get("analysis_source") == "fallback":
                consecutive_failures += 1
                if consecutive_failures >= 2:
                    print(f"\n  🛑 連續 {consecutive_failures} 場 AI 分析失敗，判斷 quota 已耗盡，跳過剩餘場次")
                    for remaining in ai_targets[idx+1:]:
                        remaining["ai_analysis"] = "AI 每日免費額度已用完，明天會自動恢復。請參考勝率數據自行判斷。"
                        remaining["analysis_source"] = "fallback"
                    break
            else:
                consecutive_failures = 0

            # 每場之間間隔 10 秒避免 RPM
            if idx < len(ai_targets) - 1:
                print(f"  ⏳ 等待 10 秒避免 RPM 限制...")
                time_module.sleep(10)
        # 未被 AI 分析的 significant 比賽，給予基礎分析
        for match in significant:
            if match not in ai_targets and "ai_analysis" not in match:
                match["ai_analysis"] = "此場符合 AI 分析條件但因每次額度限制暫未分析，請參考勝率數據自行判斷。"
                match["analysis_source"] = "rule_based"
    else:
        print("\n✅ 無顯著變動，跳過 AI 分析")
        # 對所有比賽添加基礎分析
        add_fallback_analysis(matches_with_changes)

    # 7. 彙整並儲存
    print("\n💾 儲存數據...")
    output = build_output(matches_with_changes, news, significant)
    output["stats"]["api_remaining"] = api_remaining
    save_json(CURRENT_FILE, output)
    print(f"  ✅ 即時數據已更新: {CURRENT_FILE}")

    # 7.5 更新 ATS 追蹤器
    print("\n📊 更新 ATS 追蹤器...")
    update_ats_tracker(matches_with_changes)

    # 8. 歸檔歷史
    save_to_archive(output)

    # 9. 抓取比數並更新歷史 (回測 AI 預測)
    print("\n🏆 抓取最終比數...")
    all_scores = []
    for league_key in leagues_to_fetch:
        scores, _ = fetch_scores(league_key)
        all_scores.extend(scores)
        time_module.sleep(1)
    
    if all_scores:
        updated = update_archive_scores(all_scores)
        print(f"  ✅ 已更新 {updated} 場比賽的最終比數")
    else:
        print("  ℹ️ 無已結束的比賽")

    print("\n" + "=" * 60)
    print(f"✅ 完成！共處理 {len(all_matches)} 場比賽")
    print("=" * 60)


if __name__ == "__main__":
    main()
