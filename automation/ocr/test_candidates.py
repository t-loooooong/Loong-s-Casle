import unittest
from candidates import parse_frames

SOURCE={'bvid':'BV19FJX6QEpk','page':1,'sourceUid':'382486276'}
CATALOG=[{'grade':'RE/100','modelName':'维基纳','aliases':['维基纳']}]
def line(text,y):return {'text':text,'words':[{'y':y}]}
def frame(seconds=1,price='¥154',title='万代 RE/100 维基纳',extra=''):
    return {'file':f'frame-{seconds:04d}.jpg','seconds':seconds,'width':788,'height':1708,'lines':[line(price,924),line(title,1122),line(extra,1240)]}
class CandidatesTest(unittest.TestCase):
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
