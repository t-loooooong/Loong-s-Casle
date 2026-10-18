import unittest
import json
from pathlib import Path
from candidates import parse_frames

SOURCE={'bvid':'BV19FJX6QEpk','page':1,'sourceUid':'382486276'}
CATALOG=[{'grade':'RE/100','modelName':'维基纳','aliases':['维基纳']}]
def line(text,y):return {'text':text,'words':[{'y':y}]}
def frame(seconds=1,price='¥154',title='万代 RE/100 维基纳',extra=''):
    return {'file':f'frame-{seconds:04d}.jpg','seconds':seconds,'width':788,'height':1708,'lines':[line(price,924),line(title,1122),line(extra,1240)]}
class CandidatesTest(unittest.TestCase):
    def test_whole_video_four_product_panels_regression(self):
        # Reduced, manually checked OCR panel text from BV1junG67Eup. All product
        # panels must pass together, not just the most recently reported model.
        candidates=[Path(__file__).resolve().parents[2]/'subbatch-price-collector/scripts/model_catalog.json',Path(__file__).resolve().parents[1]/'parser/model_catalog.json']
        catalog_path=next(p for p in candidates if p.exists())
        catalog=[{**m,'aliases':m['title']} for m in json.loads(catalog_path.read_text(encoding='utf-8'))['models']]
        frames=[]
        for second,price,title in [(1,'¥103','万代HGUC0291/144MSA0011ExS高达拼装模型'),(4,'¥77','万代HGHGFC1191/144美少女诺贝尔高达机动武斗'),(8,'¥90','现货速发万代HGUC1151/144DeltaPlus德尔塔百式'),(11,'¥85','HGUC2331/144闪光的哈萨维梅萨F01高达拼装模型')]:
            frames.extend([frame(second,price,title),frame(second+1,price,title)])
        rows,_=parse_frames(frames,SOURCE,catalog)
        self.assertEqual({r['modelCandidates'][0]['modelName']:r['priceCents'] for r in rows},{'Ex-S高达':10300,'诺贝尔高达':7700,'德尔塔Plus':9000,'梅萨F01':8500})
        self.assertTrue(all(not r['issues'] for r in rows))
    def test_hguc_title_without_brand_and_confirmed_messer_variant(self):
        catalog=[{'grade':'HG','modelName':'梅萨F01','aliases':['梅萨'],'requiredVariant':'F01'}]
        title='HGUC2331/144闪光的哈萨维梅萨F01高达拼装模型'
        rows,_=parse_frames([frame(11,'¥85',title),frame(12,'¥85',title)],SOURCE,catalog)
        self.assertEqual(rows[0]['priceCents'],8500);self.assertEqual(rows[0]['issues'],[])
        self.assertTrue(rows[0]['modelMatch']['variantConfirmed'])
        for title in ['HGUC梅萨F02高达','HGUC梅萨高达']:
            rows,_=parse_frames([frame(11,'¥85',title),frame(12,'¥85',title)],SOURCE,catalog)
            self.assertEqual(rows,[])
    def test_overlay_separate_box_price_does_not_poison_normal_price(self):
        frames=[frame(4,'¥77'),frame(5,'¥77'),frame(6,'¥77',extra='盒损是75百亻4'),frame(7,'¥77',extra='盒损是75百亻4')]
        rows,_=parse_frames(frames,SOURCE,CATALOG)
        self.assertEqual(rows[0]['priceCents'],7700);self.assertEqual(rows[0]['issues'],[])
        self.assertEqual(rows[0]['alternativePrices'][0]['priceCents'],7500)
        self.assertTrue(rows[0]['alternativePrices'][0]['reviewRequired'])
        self.assertNotIn(7400,[a['priceCents'] for a in rows[0]['alternativePrices']])
    def test_overlay_own_price_or_ambiguous_box_conditions_stay_pending(self):
        for extra in ['盒损是77','盒损是75-80','盒损是七十五','定金是75','盒损','盒损是0']:
            rows,_=parse_frames([frame(4,'¥77',extra=extra),frame(5,'¥77',extra=extra)],SOURCE,CATALOG)
            self.assertIn('screen_conditions_need_review',rows[0]['issues'])
    def test_delta_english_shop_title_and_two_frames(self):
        catalog=[{'grade':'HG','modelName':'德尔塔Plus','aliases':['德尔塔plus','delta plus']}]
        title='现货速发 万代 HGUC115 1/144 DeltaPlus 德尔塔百式 A1'
        rows,_=parse_frames([frame(8,'¥90',title),frame(9,'¥90',title)],SOURCE,catalog)
        self.assertEqual(rows[0]['modelCandidates'][0]['modelName'],'德尔塔Plus')
        self.assertEqual(rows[0]['priceCents'],9000);self.assertEqual(rows[0]['issues'],[])
        for title in ['万代HG德尔塔百式','万代HGDeltaPlus限定','万代HGnotdeltaplus']:
            rows,_=parse_frames([frame(8,'¥90',title),frame(9,'¥90',title)],SOURCE,catalog)
            self.assertEqual(rows,[])
    def test_exs_is_not_suffix_matched_to_s_gundam(self):
        catalog=[{'grade':'HG','modelName':'S高达','aliases':['s高达']}]
        for title in ['万代HGUC ExS高达','万代HGUC Ex-S高达']:
            rows,_=parse_frames([frame(title=title)],SOURCE,catalog)
            self.assertEqual(rows,[])
    def test_repeat_stability_and_main_price(self):
        result,_=parse_frames([frame(1),frame(2)],SOURCE,CATALOG)
        self.assertEqual(len(result),1);self.assertEqual(result[0]['priceCents'],15400);self.assertEqual(result[0]['issues'],[])
    def test_single_frame(self):
        result,_=parse_frames([frame()],SOURCE,CATALOG);self.assertIn('single_frame_only',result[0]['issues'])
    def test_lottery_rejected(self):
        result,_=parse_frames([frame(title='抽奖2026元津贴')],SOURCE,CATALOG);self.assertEqual(result,[])
    def test_unknown_name_is_not_invented(self):
        result,audit=parse_frames([frame(title='万代MG未见过的商品')],SOURCE,CATALOG)
        self.assertEqual(result,[]);self.assertEqual(audit[0]['reason'],'unknown_or_ambiguous_model')
    def test_landscape_layout_is_not_assumed(self):
        f=frame();f['width']=1920;f['height']=1080
        result,audit=parse_frames([f],SOURCE,CATALOG);self.assertEqual(result,[]);self.assertEqual(audit[0]['reason'],'unsupported_layout')
    def test_conditions_do_not_promote_a_deposit_or_damaged_box_price(self):
        for word in ['盒损','定金','补款']:
            result,_=parse_frames([frame(1,extra=word),frame(2,extra=word)],SOURCE,CATALOG)
            self.assertIn('screen_conditions_need_review',result[0]['issues'])
    def test_coupon_price_not_pre_coupon_amount_or_small_discount(self):
        result,_=parse_frames([frame(1,'券后¥154 券前¥159'),frame(2,'券后¥154 券前¥159')],SOURCE,CATALOG)
        self.assertEqual(result[0]['priceCents'],15400);self.assertEqual(result[0]['priceType'],'coupon')
    def test_unlabelled_ranges_and_multiple_prices_require_review(self):
        for text in ['¥100-200','¥100起','¥100 ¥200']:
            result,_=parse_frames([frame(1,text),frame(2,text)],SOURCE,CATALOG)
            self.assertTrue(result[0]['issues'])
    def test_unmapped_versions_do_not_invent_a_generic_product_identity(self):
        result,audit=parse_frames([frame(title='万代RE/100维基纳透明限定')],SOURCE,CATALOG)
        self.assertEqual(result,[]);self.assertEqual(audit[0]['reason'],'unmatched_variant')
if __name__=='__main__':unittest.main()
