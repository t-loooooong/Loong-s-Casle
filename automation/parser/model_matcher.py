"""Versioned, title-gated nickname matching. Never match across parts or by title alone."""
import json
from pathlib import Path
import re
import unicodedata

CATALOG = json.loads(Path(__file__).with_name('model_catalog.json').read_text(encoding='utf-8'))
GRADE = re.compile(r'(?<![a-z])(mgsd|mgex|pgu|re/?100|hg|rg|mg|pg|eg|sd|fm|re|mb|shf|frs|30mf|bc|ss86)(?![a-z])', re.I)

def normalize(text):
    return unicodedata.normalize('NFKC', text).lower()

def allowed_models(title):
    title = normalize(title)
    result = []
    for model in CATALOG['models']:
        if model.get('requiredVariant') and any(v.upper()!=model['requiredVariant'] for v in re.findall(r'f0[0-9](?![a-z0-9])', title)):
            continue
        found = [(title.find(alias), alias) for alias in model['title'] if alias in title]
        if not found:
            continue
        pos, alias = min(found)
        grades = list(GRADE.finditer(title[:pos]))
        # A directly adjacent Latin grade is also recognized (mg空降百式).
        grade = grades[-1][1].upper() if grades else None
        grade = 'RE/100' if grade in ('RE', 'RE100') else grade
        if model['grade'] != 'OTHER' and grade != model['grade']:
            continue
        result.append({**model, 'titleCondition': bool(re.search(r'盒损|核损|售罄', title[max(0,pos-4):pos]))})
    return result

def mentions(models, text, before=None):
    text = normalize(text)
    result = []
    for model in models:
        matches = []
        for alias in model['spoken']:
            # Numeric/Latin aliases cannot match a suffix of 12号机 or 10号机.
            pattern = (r'(?<![a-z0-9])' if re.match('[a-z0-9]', alias) else '') + re.escape(alias)
            for match in re.finditer(pattern, text):
                if before is None or match.end() <= before:
                    matches.append(match)
        if matches:
            result.append((model, max(matches, key=lambda m:m.end()).start()))
    return result

def resolve(models, current, price_start, prior=None):
    found = mentions(models, current, price_start)
    source = 'current'
    if not found and prior is not None and can_inherit(current):
        # Never attach an old amount to a model mentioned AFTER that amount.
        if mentions(models, current):
            return [], None
        found = mentions(models, prior)
        source = 'adjacent'
    selected = [{ 'modelName':m['modelName'], 'grade':m['grade'], 'titleCondition':m['titleCondition'], 'requiredVariant':m.get('requiredVariant') } for m,_ in found]
    return selected, source if len(selected) == 1 else None

def can_inherit(text):
    # A new unrecognized subject must not inherit the previous model's price.
    return bool(re.match(r'^\s*(?:百亿|券后|到手|现在|现价|背刺|贝茨|贝斯|背驰|降价|盒损|核损|[0-9]+[了啦啊呢])', normalize(text)))
