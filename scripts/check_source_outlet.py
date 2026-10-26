"""source オンライン（https://www.source-jp.com/）のアウトレットページを監視し、
新着商品があれば Gmail（SMTP）で要約付きメールを送る。

- data/source-outlet.json : 前回取得した商品のスナップショット（URLをキーに差分を判定）
- 要約は外部APIを使わず、商品名・価格・商品ページ本文から機械的に作成する

環境変数:
  GMAIL_USER          送信元 Gmail アドレス
  GMAIL_APP_PASSWORD  Gmail のアプリパスワード（16桁）
  MAIL_TO             送信先（カンマ区切りで複数可）

使い方:
  python scripts/check_source_outlet.py            # 通常実行（新着があればメール送信）
  python scripts/check_source_outlet.py --dry-run  # メールを送らず本文を表示（状態も保存しない）
"""
import json
import os
import re
import smtplib
import sys
import time
from collections import Counter
from datetime import datetime, timedelta, timezone
from email.mime.text import MIMEText
from email.utils import formatdate
from pathlib import Path
from urllib.parse import parse_qs, urljoin, urlparse

import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "source-outlet.json"

URL = "https://www.source-jp.com/view/category/ct87"
UA = "Mozilla/5.0 (compatible; outlet-monitor/1.0; personal use)"
JST = timezone(timedelta(hours=9))
MAX_PAGES = 10         # カテゴリ一覧の最大巡回ページ数
MAX_DETAIL_FETCH = 20  # 要約のために詳細ページを取得する最大件数
ITEM_RE = re.compile(r"/view/item/[0-9A-Za-z_-]+")
PRICE_RE = re.compile(r"(?:[¥￥]\s*([0-9][0-9,]*)|([0-9][0-9,]*)\s*円)")


def get_soup(url):
    r = requests.get(url, headers={"User-Agent": UA}, timeout=30)
    r.raise_for_status()
    # r.content を渡すと meta charset（EUC-JP / Shift_JIS 等）を自動判別してくれる
    return BeautifulSoup(r.content, "html.parser")


def clean(text):
    return re.sub(r"\s+", " ", text or "").strip()


def item_key(href):
    return ITEM_RE.search(urlparse(href).path).group(0)


def item_container(a):
    """商品リンクを含み、他の商品リンクを含まない最も外側の要素を返す。"""
    key = item_key(a["href"])
    node = a
    while node.parent is not None and node.parent.name not in ("body", "html", "[document]"):
        keys = {item_key(x["href"]) for x in node.parent.find_all("a", href=ITEM_RE)}
        if keys != {key}:
            break
        node = node.parent
    return node


def parse_prices(text):
    vals = []
    for m in PRICE_RE.finditer(text):
        v = int((m.group(1) or m.group(2)).replace(",", ""))
        if v >= 10:  # 「1円」などのノイズを除外
            vals.append(v)
    return vals


def clean_name(text):
    """一覧のリンク文字列から SOLD OUT 表記・状態・価格以降を取り除き、(商品名, 状態) を返す。"""
    t = re.sub(r"^\s*SOLD\s*OUT\s*", "", text, flags=re.I)
    t = re.split(r"\s*(?:通常価格|[¥￥]\s*[0-9]|[0-9][0-9,]*\s*円|[0-9]+%\s*OFF)", t)[0]
    m = re.search(r"\s*コンディション[：:]\s*(\S+)", t)
    condition = m.group(1) if m else ""
    if m:
        t = t[:m.start()] + t[m.end():]
    return clean(t), condition


def parse_list_page(soup, base_url):
    items = {}
    links = soup.find_all("a", href=ITEM_RE)
    # カテゴリ内の商品リンクには category_page_id が付く。付いていないものは
    # おすすめ・ランキング等の別枠なので、付いたリンクがあればそれだけを対象にする
    cat_id = urlparse(URL).path.rstrip("/").rsplit("/", 1)[-1]
    in_cat = [a for a in links if f"category_page_id={cat_id}" in a["href"]]
    for a in in_cat or links:
        url = urljoin(base_url, a["href"]).split("#")[0]
        key = item_key(url)
        if key in items:
            continue
        box = item_container(a)
        # 商品名: リンク文字列 → 画像の alt → title 属性の順で探す
        name = ""
        for x in box.find_all("a", href=ITEM_RE):
            t = clean(x.get_text())
            if t and not PRICE_RE.fullmatch(t) and len(t) > len(name):
                name = t
        if not name:
            img = box.find("img", alt=True)
            name = clean(img["alt"]) if img else clean(a.get("title"))
        name, condition = clean_name(name)
        prices = parse_prices(box.get_text(" "))
        items[key] = {
            "url": url,
            "name": name or "(商品名不明)",
            "condition": condition,
            "price": min(prices) if prices else None,
            "regular_price": max(prices) if len(prices) > 1 and max(prices) > min(prices) else None,
            "sold_out": bool(re.search(r"SOLD\s*OUT|売り切れ|品切れ|在庫なし", box.get_text(" "), re.I)),
        }
    return items


def page_links(soup, base_url):
    """同じカテゴリの別ページ（?page=N 等）へのリンクを集める。"""
    base = urlparse(base_url)
    links = set()
    for a in soup.find_all("a", href=True):
        u = urlparse(urljoin(base_url, a["href"]))
        if u.netloc == base.netloc and u.path == base.path and u.query:
            q = parse_qs(u.query)
            if any(k in q for k in ("page", "p", "pageno")):
                links.add(u.geturl())
    return links


def fetch_items():
    items, seen, queue = {}, set(), [URL]
    while queue and len(seen) < MAX_PAGES:
        url = queue.pop(0)
        if url in seen:
            continue
        seen.add(url)
        soup = get_soup(url)
        for k, v in parse_list_page(soup, url).items():
            items.setdefault(k, v)
        queue.extend(sorted(page_links(soup, url) - seen))
        time.sleep(1)
    return items


# ---------- APIキー不要の要約 ----------

def split_sentences(text):
    parts = re.split(r"(?<=[。！？!?])\s*|\n+", text)
    # 価格が2つ以上並ぶ行（価格帯の絞り込みメニュー等）や【…】付きの商品名（関連商品欄）は本文ではないので除く
    return [clean(p) for p in parts if 15 <= len(clean(p)) <= 200 and len(PRICE_RE.findall(p)) < 2 and "【" not in p]


def char_bigrams(s):
    s = re.sub(r"[\s、。・「」『』（）()【】\[\]!！?？:：/／,，.．\-ー~〜]", "", s)
    return [s[i:i + 2] for i in range(len(s) - 1)]


def extractive_summary(text, n=2):
    """文字bigramの出現頻度で文をスコアリングし、上位の文を元の順で返す。"""
    sents = split_sentences(text)
    if not sents:
        return ""
    freq = Counter(g for s in sents for g in char_bigrams(s))
    scored = []
    for i, s in enumerate(sents):
        grams = char_bigrams(s)
        score = sum(freq[g] for g in grams) / (len(grams) or 1)
        scored.append((score, i, s))
    top = sorted(sorted(scored, reverse=True)[:n], key=lambda x: x[1])
    return " ".join(s for _, _, s in top)


def item_summary(url):
    try:
        soup = get_soup(url)
    except requests.RequestException:
        return ""
    for sel in ('meta[name="description"]', 'meta[property="og:description"]'):
        m = soup.select_one(sel)
        desc = clean(m.get("content")) if m else ""
        if len(desc) >= 20:
            return desc
    for t in soup(["script", "style", "noscript", "header", "footer", "nav"]):
        t.decompose()
    return extractive_summary(soup.get_text("\n"))


def strip_boilerplate(items, limit=150):
    """各商品の概要から、多くの商品に共通する定型文（「本商品は展示品です」等）を除いて短くする。"""
    def sents(text):
        text = re.sub(r"^「[^」]*」\s*(?:は、?)?", "", text)  # 冒頭の「商品名」(は、)
        return [x for x in re.split(r"(?<=。)", text) if x.strip()]

    tail = Counter()
    for it in items:
        tail.update({x.strip()[-15:] for x in sents(it.get("summary", ""))})
    for it in items:
        if not it.get("summary"):
            continue
        name = it["name"]
        kept = [x.strip() for x in sents(it["summary"])
                if not (len(items) >= 3 and tail[x.strip()[-15:]] >= 3)]
        text = " ".join(kept)
        if text.startswith(name):  # 説明文が商品名から始まる場合は重複部分を削る
            text = text[len(name):].strip()
        it["summary"] = text[:limit] + ("…" if len(text) > limit else "")


def count_by(values, n=6):
    c = Counter(v for v in values if v)
    return "、".join(f"{k} {v}件" for k, v in c.most_common(n))


def label_of(name):
    m = re.match(r"【\s*([^】]+?)\s*】", name)
    return m.group(1) if m else ""


def series_of(name):
    # 「PURO/プーロ」「Y HOPE/ワイホープ」「SALA」のような英大文字のシリーズ名
    m = re.search(r"(?<![A-Za-z0-9])((?:[A-Z] )?[A-Z]{3,})(?![A-Za-z0-9])", re.sub(r"【[^】]*】", "", name))
    return m.group(1) if m else ""


def yen(v):
    return f"{v:,}円" if v is not None else "価格不明"


def overall_summary(new_items, total):
    lines = [f"・アウトレットページに新着商品が {len(new_items)} 件ありました（掲載中 合計 {total} 件）。"]
    prices = [i["price"] for i in new_items if i["price"]]
    if prices:
        rng = yen(min(prices)) if min(prices) == max(prices) else f"{yen(min(prices))} 〜 {yen(max(prices))}"
        lines.append(f"・新着の価格帯: {rng}")
    offs = [1 - i["price"] / i["regular_price"] for i in new_items if i["price"] and i["regular_price"]]
    if offs:
        lines.append(f"・割引率: 平均 約{round(sum(offs) / len(offs) * 100)}%"
                     f"（最大 約{round(max(offs) * 100)}%）")
    labels = count_by(label_of(i["name"]) for i in new_items)
    if labels:
        lines.append(f"・種別: {labels}")
    series = count_by(series_of(i["name"]) for i in new_items)
    if series:
        lines.append(f"・シリーズ: {series}")
    conds = count_by(i.get("condition") for i in new_items)
    if conds:
        lines.append(f"・状態: {conds}")
    sold = sum(i["sold_out"] for i in new_items)
    if sold:
        lines.append(f"・販売中 {len(new_items) - sold} 件 / 売り切れ表示 {sold} 件")
    return "\n".join(lines)


def build_body(new_items, total, first_run):
    now = datetime.now(JST).strftime("%Y-%m-%d %H:%M")
    head = (f"【監視開始】現在掲載中の商品一覧です（{now} JST 時点）。次回以降は新着のみお知らせします。"
            if first_run else f"{now} JST 時点のチェック結果です。")
    out = [head, "", "■ 要約", overall_summary(new_items, total), "", "■ 新着商品"]
    for n, it in enumerate(new_items, 1):
        price = yen(it["price"])
        if it["regular_price"]:
            off = round((1 - it["price"] / it["regular_price"]) * 100)
            price += f"（通常 {yen(it['regular_price'])} → 約{off}%OFF）"
        out.append(f"{n}. {it['name']}{' [SOLD OUT]' if it['sold_out'] else ''}")
        out.append(f"   価格: {price}")
        if it.get("condition"):
            out.append(f"   状態: {it['condition']}")
        if it.get("summary"):
            out.append(f"   概要: {it['summary']}")
        out.append(f"   {it['url']}")
    out += ["", f"一覧ページ: {URL}", "", "※ このメールは GitHub Actions により自動送信されています。"]
    return "\n".join(out)


def send_mail(subject, body):
    user = os.environ["GMAIL_USER"]
    password = os.environ["GMAIL_APP_PASSWORD"].replace(" ", "")
    to = [a.strip() for a in os.environ["MAIL_TO"].split(",") if a.strip()]
    msg = MIMEText(body, "plain", "utf-8")
    msg["Subject"] = subject
    msg["From"] = user
    msg["To"] = ", ".join(to)
    msg["Date"] = formatdate(localtime=True)
    with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=30) as s:
        s.login(user, password)
        s.sendmail(user, to, msg.as_string())


def main():
    dry_run = "--dry-run" in sys.argv
    items = fetch_items()
    if not items:
        print("ERROR: 商品を1件も取得できませんでした（サイト構造変更・アクセス拒否の可能性）")
        sys.exit(1)

    first_run = not DATA.exists()
    old = {} if first_run else json.loads(DATA.read_text(encoding="utf-8"))
    new_keys = [k for k in items if k not in old]
    print(f"取得 {len(items)} 件 / 新着 {len(new_keys)} 件")

    if new_keys:
        # 販売中の商品を先に並べる
        new_items = sorted((items[k] for k in new_keys), key=lambda i: i["sold_out"])
        for it in [i for i in new_items if not i["sold_out"]][:MAX_DETAIL_FETCH]:
            it["summary"] = item_summary(it["url"])
            time.sleep(1)
        strip_boilerplate(new_items)
        subject = (f"[source アウトレット] 監視開始（掲載 {len(items)} 件）" if first_run
                   else f"[source アウトレット] 新着 {len(new_keys)} 件 ({datetime.now(JST):%Y-%m-%d})")
        body = build_body(new_items, len(items), first_run)
        if dry_run:
            print(subject + "\n\n" + body)
            return
        send_mail(subject, body)
        print("メール送信完了")

    if not dry_run:
        # 一度消えて再掲載された商品を「新着」と誤判定しないよう、過去分も残す
        merged = {**old, **{k: {"name": v["name"], "url": v["url"]} for k, v in items.items()}}
        DATA.parent.mkdir(exist_ok=True)
        DATA.write_text(json.dumps(merged, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
