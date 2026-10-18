"""Portrait shopping-page OCR candidates. Unsupported layouts never become usable prices."""
import argparse
import json
import re
import unicodedata
from pathlib import Path

def compact(text):
    return re.sub(r'\s+', '', unicodedata.normalize('NFKC', text)).lower()

def parse_frames(frames, source, catalog):
    groups, rejected = {}, []
    for frame in frames:
        width, height = frame.get('width', 0), frame.get('height', 0)
        if not width or height / width < 1.5:
            rejected.append({'seconds':frame['seconds'], 'reason':'unsupported_layout'})
            continue
        prices, titles, conditions, overlay = [], [], [], []
        for line in frame['lines']:
            if not line['words']:
                continue
            text = compact(line['text'])
            y = min(word['y'] for word in line['words']) / height
            if .50 <= y <= .59 and re.search(r'[¥￥]\d', text):
                prices.append(text)
            if .60 <= y <= .73 and re.search(r're/100|hgce|mg|rg|mb|万代', text):
                titles.append(text)
            if .57 <= y <= .62:
                conditions.append(text)
            if .68 <= y <= .80:
                overlay.append(text)
        # A price needs one matching product title; lottery amounts alone are not model prices.
        if len(prices) != 1 or not titles:
            continue
        price_line, title = prices[0], ' '.join(titles)
        if re.search(r'抽奖|津贴|券包|抢购', title):
            continue
        grade_match = re.search(r're/100|mgsd|mgex|pgu|hgce|hg|rg|mg|pg|eg|fm|mb', title)
        if not grade_match:
            continue
        grade = {'re/100':'RE/100','hgce':'HG'}.get(grade_match[0], grade_match[0].upper())
        matches = []
        for model in catalog:
            if model['grade'] == grade and any(compact(alias) in title for alias in model['aliases']):
                if not any(m['modelName'] == model['modelName'] and m['grade'] == grade for m in matches):
                    matches.append(model)
        if len(matches) != 1:
            rejected.append({'seconds':frame['seconds'],'reason':'unknown_or_ambiguous_model','text':title,'priceText':price_line})
            continue
        match = re.search(r'[¥￥](\d+(?:\.\d{1,2})?)', price_line)
        if not match:
            continue
        cents = round(float(match[1]) * 100)
        if not 100 <= cents <= 500000:
            continue
        model = matches[0]
        issues = []
        qualifiers = re.findall(r'透明|电镀|限定|最终决战|ver\.?ka|[23]\.0', title)
        if any(word not in compact(model['modelName']) for word in qualifiers):
            rejected.append({'seconds':frame['seconds'],'reason':'unmatched_variant','text':title,'priceText':price_line})
            continue
        if re.search(r'[¥￥]\d+(?:\.\d+)?(?:[-~～至到]\d|起|以上|以下)', price_line):
            issues.append('screen_price_range')
        if len(re.findall(r'[¥￥]\d', price_line))>1 and '券前' not in price_line:
            issues.append('screen_multiple_prices')
        # Product identity must not be inferred from a broad, version-less nickname alone.
        if model['modelName'] in ['海盗','复刻元祖','七号机','零号机']:
            issues.append('model_variant_needs_review')
        if re.search(r'定金|订金|补款|预售|预定|福袋|随机|售罄|盒损|核损', title):
            issues.append('screen_conditions_need_review')
        if re.search(r'盒损|核损|售罄|定金|订金|补款', ''.join(overlay)):
            issues.append('screen_conditions_need_review')
        if re.search(r'日元|美元|港币|jpy|usd|hkd', title+price_line):
            issues.append('currency_needs_review')
        identity = (grade, model['modelName'], cents, 'coupon' if '券后' in price_line else 'observed')
        row = groups.setdefault(identity, {'bvid':source['bvid'],'page':source['page'],'sourceUid':source['sourceUid'],
            'modelCandidates':[{'grade':grade,'modelName':model['modelName']}], 'priceCents':cents,'currency':'CNY',
            'priceType':identity[3], 'priceLabel':'画面券后价' if '券后' in price_line else '画面拼单/售价',
            'modelMatch':{'method':'screen_title_catalog'},'channels':['visual'],'issues':[],
            'evidence':{'text':title+' | '+price_line+' | '+' '.join(conditions), 'startSeconds':frame['seconds'],
                        'endSeconds':frame['seconds'],'visualFrames':[]}})
        row['evidence']['endSeconds'] = frame['seconds']
        row['evidence']['visualFrames'].append({'file':frame['file'],'seconds':frame['seconds']})
        row['issues'] = list(dict.fromkeys(row['issues']+issues))
    results = list(groups.values())
    for row in results:
        frames = row['evidence']['visualFrames']
        if len(frames) < 2 or frames[-1]['seconds']-frames[0]['seconds'] < .5:
            row['issues'].append('single_frame_only')
    return results, rejected

def main():
    args = argparse.ArgumentParser()
    args.add_argument('--audit', required=True, type=Path)
    args.add_argument('--catalog', required=True, type=Path)
    options = args.parse_args()
    root = options.audit
    source = json.loads((root/'source.json').read_text(encoding='utf-8'))
    catalog = json.loads(options.catalog.read_text(encoding='utf-8'))['models']
    extra = json.loads(Path(__file__).with_name('models.json').read_text(encoding='utf-8'))['models']
    models = [{'modelName':m['modelName'],'grade':m['grade'],'aliases':m.get('title',[])} for m in catalog]+extra
    rows, rejected = parse_frames(json.loads((root/'ocr-results.json').read_text(encoding='utf-8-sig')),source,models)
    (root/'visual-candidates.json').write_text(json.dumps({'candidates':rows,'rejected':rejected},ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'candidates':len(rows),'rejected':len(rejected)}))

if __name__ == '__main__':
    main()
