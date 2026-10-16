import unittest
from collect_prices import amount, segments, analyse_video

def sample(text):
    return {"bvid": "BV1CVdmB5E8P", "sourceUid": "382486276", "publishedAt": "2026-10-16T12:00:00+08:00", "subtitleText": text}

class Tests(unittest.TestCase):
    def test_chinese_prices(self):
        for text, cents in [("二百四十七", 24700), ("两百零五", 20500), ("一千零五十", 105000), ("二四七", 24700), ("一百二十点五", 12050), ("247.50", 24750)]:
            self.assertEqual(amount(text), cents)

    def test_timestamp(self):
        self.assertEqual(segments("1\n00:00:02,500 --> 00:00:05,000\nHG柯西 到手247元")[0]["start"], 2.5)

    def test_candidate_not_verified(self):
        rows, _ = analyse_video(sample("HG柯西 到手二百四十七元"), "fixture")
        self.assertEqual(rows[0]["priceCents"], 24700)
        self.assertEqual(rows[0]["status"], "candidate")
        self.assertTrue(rows[0]["reviewRequired"])

    def test_adjacent_cues(self):
        rows, _ = analyse_video(sample("1\n00:00:00,000 --> 00:00:02,000\nHG柯西\n\n2\n00:00:02,000 --> 00:00:04,000\n到手247元"), "fixture")
        self.assertEqual(rows[0]["modelCandidates"][0]["modelName"], "柯西")
        self.assertEqual(rows[0]["evidence"]["startSeconds"], 0)

    def test_far_cues_not_joined(self):
        rows, _ = analyse_video(sample("1\n00:00:00,000 --> 00:00:02,000\nHG柯西\n\n2\n00:00:20,000 --> 00:00:24,000\n247元"), "fixture")
        self.assertEqual(rows[0]["modelCandidates"], [])

    def test_multiple_models(self):
        rows, _ = analyse_video(sample("HG柯西、RG海牛到手247元"), "fixture")
        self.assertIn("model_needs_review", rows[0]["issues"])

    def test_ranges_and_foreign_currency(self):
        for text, issue in [("HG柯西 200到300元", "range_or_discount_conditions"), ("HG柯西 100美元", "currency_needs_review")]:
            rows, _ = analyse_video(sample(text), "fixture")
            if rows:
                self.assertIn(issue, rows[0]["issues"])

    def test_missing_metadata(self):
        rows, _ = analyse_video({"subtitleText": "HG柯西247元"}, "fixture")
        self.assertIn("missing_source_uid", rows[0]["issues"])
        self.assertIsNone(rows[0]["videoUrl"])

    def test_no_invented_price(self):
        rows, _ = analyse_video(sample("HG柯西 1/144 再版降价"), "fixture")
        self.assertEqual(rows, [])

    def test_spoken_prices_without_currency_unit(self):
        for text, cents in [("空降百世背刺170了", 17000), ("BC的元祖背刺19了", 1900), ("百亿八十七", 8700)]:
            rows, _ = analyse_video(sample(text), "fixture")
            self.assertEqual(rows[0]["priceCents"], cents)
            self.assertIn("implicit_cny_unit", rows[0]["issues"])
            self.assertTrue(rows[0]["reviewRequired"])

    def test_promotion_numbers_are_not_prices(self):
        for text in ["双11的活动", "送你好几10亿", "模型是1/144", "7号机", "三斤榴莲"]:
            self.assertEqual(analyse_video(sample(text), "fixture")[0], [])

    def test_title_gated_asr_alias(self):
        v=sample('1\n00:00:01,000 --> 00:00:03,000\n空降百世背刺170了')
        v['title']='mg空降百式背刺，午间羊毛。'
        row=analyse_video(v,'fixture')[0][0]
        self.assertEqual(row['modelCandidates'],[{'grade':'MG','modelName':'空降百式'}])
        self.assertEqual(row['modelMatch']['method'],'title_catalog_alias')
        self.assertIn('implicit_cny_unit',row['issues'])
        v['title']='hg路西法背刺'
        self.assertEqual(analyse_video(v,'fixture')[0][0]['modelCandidates'],[])

    def test_new_unknown_subject_does_not_inherit_previous_model(self):
        v=sample('00:00:01,000 --> 00:00:02,000\n水扎古背刺70啊\n\n00:00:02,000 --> 00:00:04,000\n这还得等加萨基日贝茨62了')
        v['title']='hg水扎古、加撒c背刺'
        rows=analyse_video(v,'fixture')[0]
        self.assertEqual(rows[0]['modelCandidates'][0]['modelName'],'水扎古')
        self.assertEqual(rows[1]['modelCandidates'],[])

    def test_new_recognized_subject_and_latin_digits(self):
        v=sample('00:00:01,000 --> 00:00:02,000\n路西法背刺90了\n\n00:00:02,000 --> 00:00:04,000\n百一十八十七GP03base60了')
        v['title']='hg路西法、gp03背刺'
        rows=analyse_video(v,'fixture')[0]
        self.assertEqual(rows[1]['modelCandidates'][0]['modelName'],'GP03')

    def test_channel_price_uses_only_adjacent_same_part(self):
        v=sample('00:00:01,000 --> 00:00:02,000\n空降百世背刺170了\n\n00:00:02,000 --> 00:00:04,000\n百亿是169')
        v['title']='mg空降百式'
        rows=analyse_video(v,'fixture')[0]
        self.assertEqual(rows[1]['modelCandidates'][0]['modelName'],'空降百式')
        self.assertEqual(rows[1]['priceLabel'],'百亿（字幕原称）')

    def test_box_condition_and_fukubukuro_block_public_quote(self):
        v=sample('00:00:01,000 --> 00:00:02,000\n核损的德莱森降价105了')
        v['title']='hg盒损德莱森降价'
        self.assertIn('availability_or_payment_conditions',analyse_video(v,'fixture')[0][0]['issues'])
        v['title']='2026福袋内容物 hg德莱森'
        self.assertIn('bundle_not_individual_price',analyse_video(v,'fixture')[0][0]['issues'])

    def test_grade_not_inferred_from_different_series(self):
        v=sample('00:00:01,000 --> 00:00:02,000\n卡碧尼背刺100了')
        v['title']='hg卡碧尼'
        self.assertEqual(analyse_video(v,'fixture')[0][0]['modelCandidates'],[])

if __name__ == "__main__":
    unittest.main()
