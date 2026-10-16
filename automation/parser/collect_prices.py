"""Offline SubBatch subtitle -> evidence-bearing quotation candidates. No network."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import unicodedata
import zipfile
from model_matcher import allowed_models, resolve as resolve_catalog, mentions as catalog_mentions, can_inherit, CATALOG

BV = re.compile(r"BV[0-9A-Za-z]{10}")
STAMP = re.compile(r"(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})")
CN = {c: i for i, c in enumerate("零一二三四五六七八九")}
CN.update({"〇": 0, "两": 2})
UNITS = {"十": 10, "百": 100, "千": 1000}
NUMBER = r"(?:\d+(?:\.\d{1,2})?|[零〇一二两三四五六七八九十百千]+(?:点[零〇一二两三四五六七八九]+)?)"
PRICE = re.compile(rf"(?<![\d.])({NUMBER})\s*(?:元|块)(?:钱)?|[¥￥]\s*({NUMBER})|(?:背刺|贝茨|贝斯|背驰|base|到手|券后|现价|降价|继续降|接着降|现在|百亿(?:现在|上)?|盒损|核损)(?:现在)?(?:的话)?(?:是)?\s*({NUMBER})(?=[了啦啊呢的整，。！？\s]|$)", re.I)
MODEL = re.compile(r"(?<![A-Za-z])(MGSD|MGEX|PGU|RE/?100|HG|RG|MG|PG|EG|SD|FM)\s*([^\s，,。；;：:、]{2,30})", re.I)

def amount(text):
    if re.fullmatch(r"\d+(?:\.\d+)?", text):
        return round(float(text) * 100)
    whole, _, decimal = text.partition("点")
    if not any(c in UNITS for c in whole):
        value = int("".join(str(CN[c]) for c in whole))
    else:
        value, digit = 0, 0
        for char in whole:
            if char in CN:
                digit = CN[char]
            elif char in UNITS:
                value += (digit or 1) * UNITS[char]
                digit = 0
        value += digit
    cents = int(("".join(str(CN[c]) for c in decimal) + "00")[:2]) if decimal else 0
    return value * 100 + cents

def time_seconds(text):
    match = STAMP.fullmatch(text.strip())
    if not match:
        raise ValueError("Invalid subtitle timestamp")
    h, m, s, ms = match.groups()
    return int(h) * 3600 + int(m) * 60 + int(s) + int(ms.ljust(3, "0")) / 1000

def segments(text):
    text = text.lstrip("\ufeff").replace("\r\n", "\n")
    cues = []
    for block in re.split(r"\n\s*\n", text.strip()):
        lines = block.splitlines()
        idx = next((i for i, line in enumerate(lines) if "-->" in line), None)
        if idx is not None:
            start, end = lines[idx].split("-->", 1)
            start, end = time_seconds(start), time_seconds(end.split()[0])
            if end < start:
                raise ValueError("Subtitle end precedes start")
            body = " ".join(lines[idx + 1:]).strip()
            if body:
                cues.append({"start": start, "end": end, "text": body})
    if cues:
        return cues
    # Plain SubBatch exports prepend metadata before this separator.
    if "字幕正文" in text:
        text = text.split("字幕正文", 1)[1].lstrip("-\n ")
    return [{"start": None, "end": None, "text": line.strip()} for line in text.splitlines() if line.strip()]

def extract_models(text):
    result = []
    for match in MODEL.finditer(text):
        grade = match[1].upper().replace("RE100", "RE/100")
        name = re.split(r"券后|到手|现价|价格|售价|只要|现在|目前|大概|约|背刺|降价|\d+元|[零一二两三四五六七八九十百千]+元", match[2], maxsplit=1)[0].strip()
        if len(name) >= 2:
            item = {"grade": grade, "modelName": name}
            if item not in result:
                result.append(item)
    return result

def analyse_video(video, origin):
    text = video.get("subtitleText", "")
    if not isinstance(text, str) or len(text) > 10_000_000:
        raise ValueError("Invalid or oversized subtitle text")
    cues = segments(text)
    catalog = allowed_models(str(video.get('title') or ''))
    candidates = []
    bvid = str(video.get("bvid", ""))
    page = int(video.get("page") or 1)
    base_issues = []
    if not BV.fullmatch(bvid):
        base_issues.append("missing_video_id")
    uid = str(video.get("sourceUid") or "")
    if not uid.isdigit():
        base_issues.append("missing_source_uid")
    published = video.get("publishedAt")
    try:
        if not published:
            raise ValueError()
        dt = datetime.fromisoformat(str(published).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            raise ValueError()
    except ValueError:
        base_issues.append("missing_or_invalid_publication_date")
    for idx, cue in enumerate(cues):
        normalized = unicodedata.normalize("NFKC", cue["text"])
        prices = list(PRICE.finditer(normalized))
        prior = cues[idx-1] if idx > 0 else None
        adjacent = prior is not None and cue['start'] is not None and prior['end'] is not None and 0 <= cue['start']-prior['end'] <= 6
        bare_price = False
        if not prices and adjacent and re.search(r'(?:背刺|贝茨|贝斯|背驰|降价|现在(?:是)?)\s*$', prior['text']):
            bare = re.match(rf'^\s*({NUMBER})(?=[了啦啊呢，。！？\s]|$)', normalized)
            if bare:
                prices = [bare]
                bare_price = True
        if not prices:
            continue
        for price in prices:
            evidence = normalized
            start, end = cue['start'], cue['end']
            matched, match_source = resolve_catalog(catalog, normalized, price.start(), prior['text'] if adjacent else None)
            # Amount-following a recognized price verb belongs to that model, not a grade-less title guess.
            models = [{ 'grade':m['grade'], 'modelName':m['modelName'] } for m in matched] if matched else extract_models(normalized)
            if match_source == 'adjacent' or (not models and adjacent and can_inherit(normalized)):
                evidence = unicodedata.normalize('NFKC', prior['text']) + ' ' + normalized
                start = prior['start']
                if not models:
                    models = extract_models(evidence)
            issues = list(base_issues)
            if len(models) != 1:
                issues.append('model_needs_review')
            if len(prices) != 1:
                issues.append('multiple_prices')
            if re.search(r'满\s*\d|减\s*\d|上下|左右|以下|以上|[到至~～-]\s*' + NUMBER + r'\s*(?:元|块)', evidence):
                issues.append('range_or_discount_conditions')
            if re.search(r'日元|JPY|美元|USD|港币|HKD', evidence, re.I):
                issues.append('currency_needs_review')
            if start is None:
                issues.append('no_timestamp')
            if re.search(r'售罄|盒损|核损|核隼|没运输|无运输|预定|订金|定金|补款', evidence) or any(m['titleCondition'] for m in matched):
                issues.append('availability_or_payment_conditions')
            relevant = evidence
            if len(matched) == 1:
                positions = [pos for m,pos in catalog_mentions(catalog, evidence) if m['modelName'] == matched[0]['modelName']]
                if positions:
                    relevant = evidence[max(positions):]
            if re.search(r'之前|上次|昨天|原来|曾经|过期', relevant):
                issues.append('historical_or_expired_price')
            if re.search(r'福袋|内容物', str(video.get('title') or '')):
                issues.append('bundle_not_individual_price')
            # A near-following sold-out statement applies only until another model starts.
            if len(matched) == 1 and cue['end'] is not None:
                for next_cue in cues[idx+1:idx+3]:
                    if next_cue['start'] is None or next_cue['start']-cue['end'] > 6 or catalog_mentions(catalog, next_cue['text']):
                        break
                    if '售罄' in next_cue['text']:
                        issues.append('availability_or_payment_conditions')
                        evidence += ' ' + next_cue['text']
                        end = next_cue['end']
            implicit = bare_price or (len(price.groups()) >= 3 and bool(price[3]))
            if implicit:
                issues.append('implicit_cny_unit')
            cents = amount(next(group for group in price.groups() if group))
            if not 100 <= cents <= 500000:
                continue
            key = json.dumps([bvid, page, video.get("language"), start, normalized, cents], ensure_ascii=False)
            candidates.append({
                "id": hashlib.sha256(key.encode()).hexdigest()[:20],
                "bvid": bvid, "page": page, "sourceUid": uid,
                "sourceAccount": str(video.get("sourceAccount") or ""),
                "videoTitle": str(video.get("title") or ""), "publishedAt": published,
                "videoUrl": f"https://www.bilibili.com/video/{bvid}/?p={page}" if BV.fullmatch(bvid) else None,
                "modelCandidates": models, "priceCents": cents, "currency": None if "currency_needs_review" in issues else "CNY",
                "priceType": "coupon" if re.search(r"券后|到手", evidence) else "observed",
                "priceLabel": '百亿（字幕原称）' if '百亿' in normalized[:price.end()] else '视频报价',
                "modelMatch": { 'method':'title_catalog_alias', 'version':CATALOG['version'], 'source':match_source } if len(matched) == 1 and match_source else None,
                "status": "candidate", "reviewRequired": True,
                "evidence": {"text": evidence, "startSeconds": start, "endSeconds": end, "subtitleKind": video.get("subtitleKind", "unknown"), "language": video.get("language", ""), "file": origin},
                "issues": list(dict.fromkeys(issues)),
            })
    return candidates, {"bvid": bvid, "page": page, "file": origin, "segments": len(cues), "candidates": len(candidates), "issues": base_issues}

def inputs(path, manifest):
    mapping = {}
    if manifest:
        obj = json.loads(Path(manifest).read_text(encoding="utf-8-sig"))
        mapping = {v["file"]: v for v in (obj["videos"] if isinstance(obj, dict) else obj)}
    def parse(name, raw):
        if len(raw) > 10_000_000:
            raise ValueError("Input file too large")
        text = raw.decode("utf-8-sig")
        if name.lower().endswith(".json"):
            obj = json.loads(text)
            if not isinstance(obj, dict) or not isinstance(obj.get("videos"), list):
                raise ValueError("Expected SubBatch collection bundle with videos array")
            return [(v, name) for v in obj["videos"]], obj.get("skipped", [])
        meta = dict(mapping.get(name, mapping.get(Path(name).name, {})))
        if not meta.get("bvid"):
            match = BV.search(name) or re.search(r"视频链接[：:]\s*https://www\.bilibili\.com/video/(BV[\da-zA-Z]{10})", text)
            meta["bvid"] = (match.group(1) if match.lastindex else match.group()) if match else ""
        meta["subtitleText"] = text
        return [(meta, name)], []
    files, skipped = [], []
    if path.is_dir():
        for file in sorted(path.rglob("*")):
            if file.is_file() and file.suffix.lower() in {".json", ".srt", ".txt", ".md"}:
                rows, misses = parse(file.relative_to(path).as_posix(), file.read_bytes())
                files.extend(rows); skipped.extend(misses)
    elif path.suffix.lower() == ".zip":
        with zipfile.ZipFile(path) as archive:
            if len(archive.infolist()) > 5000 or sum(i.file_size for i in archive.infolist()) > 100_000_000:
                raise ValueError("Archive exceeds import limits")
            for item in archive.infolist():
                if Path(item.filename).suffix.lower() in {".json", ".srt", ".txt", ".md"}:
                    rows, misses = parse(item.filename, archive.read(item))
                    files.extend(rows); skipped.extend(misses)
    else:
        files, skipped = parse(path.name, path.read_bytes())
    return files, skipped

def run():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("--manifest")
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    if args.output.exists() and any(args.output.iterdir()):
        parser.error("Output directory must be new or empty; do not overwrite earlier results")
    videos, skipped = inputs(args.input, args.manifest)
    candidates, audits = [], []
    for video, origin in videos:
        rows, audit = analyse_video(video, origin)
        candidates.extend(rows); audits.append(audit)
    dedup = {row["id"]: row for row in candidates}
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "candidates.json").write_text(json.dumps({"schemaVersion": 1, "generatedAt": datetime.now(timezone.utc).isoformat(), "candidates": list(dedup.values())}, ensure_ascii=False, indent=2), encoding="utf-8")
    report = {"videoInputs": len(videos), "candidateCount": len(dedup), "videosWithoutPrices": sum(a["candidates"] == 0 for a in audits), "skippedBySubBatch": skipped, "videos": audits, "published": False}
    (args.output / "audit.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"videoInputs": len(videos), "candidateCount": len(dedup), "output": str(args.output), "published": False}, ensure_ascii=False))

if __name__ == "__main__":
    run()
