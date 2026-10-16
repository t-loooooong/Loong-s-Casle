/* GUNPLA_AUTO_BACKGROUND_V1 -- no browser credential data leaves this extension. */
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (!['gunplaAutoTracks', 'gunplaAutoContent', 'gunplaAutoAudio'].includes(message.action)) return;
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('auto.html')) {
    reply({ success: false, message: '仅允许专用采集页请求' }); return;
  }
  (async () => {
    if (!/^BV[0-9A-Za-z]{10}$/.test(message.bvid) || !/^\d+$/.test(String(message.cid))) throw Error('无效视频标识');
    const info = await getBilibiliVideoInfo(message.bvid);
    if (!info?.success || String(info.full_data?.owner?.mid) !== '382486276' || info.isChargeExclusive) throw Error('来源或公开视频权限校验失败');
    if (!info.full_data.pages?.some(p => String(p.cid) === String(message.cid) && p.duration <= 1800)) throw Error('分P校验失败');
    if (message.action === 'gunplaAutoTracks') {
      const result = await getBilibiliSubtitleTracks(message.cid, message.bvid, 0);
      // Only an explicit absence is safe to treat as no subtitles, never HTTP/API errors.
      if (!result.success && result.message === '该视频没有可用字幕') return { success: true, subtitleTracks: [] };
      return result;
    }
    if (message.action === 'gunplaAutoContent') return getBilibiliSubtitleContentByTrack({ cid: message.cid, bvid: message.bvid, aid: info.aid, track: message.track }, 0);
    const stream = await fetchAudioStreamUrl(message.bvid, message.cid);
    if (!stream.success) throw Error('音频地址获取失败；请在B站检查登录与验证状态');
    const bytes = await downloadAudioDirectly(stream.audioUrl, stream.audioUrls);
    if (bytes.byteLength > 8*1024*1024) throw Error('音频超过8MB消息上限，请手动处理');
    return { success: true, audioData: Array.from(new Uint8Array(bytes)) };
  })().then(reply, () => reply({ success: false, message: '请求失败：请检查B站登录、验证或分P权限；未继续重试' }));
  return true;
});
