"""公式サイト（フコク赤ちゃん＆キッズクラブ）のお知らせを取得し、
変化があればトップページの「今月の公式トピック」表と sitemap.xml を更新する。

- data/official-news.json : 前回取得したお知らせのスナップショット
- index.html              : <!-- official-news:start/end --> の間を再生成
- 新着があった場合、new_items.md（リポジトリ外へ出力）に記事化メモを書き出す
"""
import json
import re
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "official-news.json"
INDEX = ROOT / "index.html"
SITEMAP = ROOT / "sitemap.xml"
NEW_ITEMS_MD = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("/tmp/new_items.md")

URL = "https://act.fukoku-life.co.jp/club/index"
UA = "sukusuku-lab.com news monitor (personal fan site; contact: sukusuku.club.lab@gmail.com)"
JST = timezone(timedelta(hours=9))


def fetch_items():
    r = requests.get(URL, headers={"User-Agent": UA}, timeout=30)
    r.raise_for_status()
    soup = BeautifulSoup(r.text, "html.parser")
    items = []
    for art in soup.select("section.top-news article.news-inner > article"):
        date_el = art.select_one("div.date")
        txt_el = art.select_one("div.txt")
        if not date_el or not txt_el:
            continue
        date = date_el.get_text(strip=True)
        text = re.sub(r"\s+", "", txt_el.get_text())
        if re.match(r"\d{4}\.\d{2}\.\d{2}", date) and text:
            items.append({"date": date, "text": text})
    return items[:8]


def render_block(items):
    first = items[0]["date"].split(".")  # ["2026","07","09"]
    heading = f"今月の公式トピック（{int(first[0])}年{int(first[1])}月）"
    rows = []
    for it in items[:5]:
        _, m, d = it["date"].split(".")
        rows.append(f"    <tr><th>{int(m)}/{int(d)}</th><td>{it['text']}</td></tr>")
    rows_str = "\n".join(rows)
    return (
        "<!-- official-news:start -->\n"
        f"  <h2>{heading}</h2>\n"
        '  <div class="table-scroll"><table>\n'
        f"{rows_str}\n"
        "  </table></div>\n"
        "<!-- official-news:end -->"
    )


def main():
    items = fetch_items()
    if len(items) < 2:
        print("ERROR: お知らせの取得数が異常に少ないため更新を中止します（サイト構造変更の可能性）")
        sys.exit(1)

    old = json.loads(DATA.read_text(encoding="utf-8")) if DATA.exists() else []
    if items == old:
        print("no change")
        return

    # スナップショット保存
    DATA.parent.mkdir(exist_ok=True)
    DATA.write_text(json.dumps(items, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    # index.html のトピック表を差し替え
    html = INDEX.read_text(encoding="utf-8")
    new_html = re.sub(
        r"<!-- official-news:start -->.*?<!-- official-news:end -->",
        lambda _: render_block(items),
        html,
        flags=re.S,
    )
    if new_html == html:
        print("ERROR: index.html にマーカーが見つかりません")
        sys.exit(1)
    INDEX.write_text(new_html, encoding="utf-8")

    # sitemap のトップページ lastmod を今日に
    today = datetime.now(JST).strftime("%Y-%m-%d")
    sm = SITEMAP.read_text(encoding="utf-8")
    sm = re.sub(
        r"(<loc>https://sukusuku-lab\.com/</loc>\s*<lastmod>)[\d-]+(</lastmod>)",
        rf"\g<1>{today}\g<2>",
        sm,
    )
    SITEMAP.write_text(sm, encoding="utf-8")

    # 新着（前回に無かった項目）を記事化メモとして出力
    old_keys = {(o["date"], o["text"]) for o in old}
    fresh = [it for it in items if (it["date"], it["text"]) not in old_keys]
    lines = ["公式サイトのお知らせに新着がありました。トップページのトピック表は自動更新済みです。", ""]
    lines += [f"- **{it['date']}** {it['text']}" for it in fresh]
    lines += ["", "記事化（体験談・解説ページ化）を検討してください。", f"公式: {URL}"]
    NEW_ITEMS_MD.write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(f"updated: {len(fresh)} new item(s)")


if __name__ == "__main__":
    main()
