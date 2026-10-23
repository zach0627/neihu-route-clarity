const taipeiClock = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

/** Derive display permissions from the observation and the viewer's current Taipei time. */
export function liveDisplayState(live, now = Date.now()) {
  const parts = Number.isFinite(now) ? Object.fromEntries(taipeiClock.formatToParts(now).map(part => [part.type, part.value])) : {};
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  const minute = Number(parts.hour) * 60 + Number(parts.minute);
  const date = typeof live?.date === 'string' ? live.date : '';
  const generatedAt = Date.parse(live?.generatedAt);
  const age = now - generatedAt;
  const fresh = Number.isFinite(age) && age >= 0 && age <= 30 * 60 * 1000;
  const sourceTime = Date.parse(live?.sourceTo), sourceAge = generatedAt - sourceTime, sourceViewerAge = now - sourceTime;
  const sourceParts = Number.isFinite(sourceTime) ? Object.fromEntries(taipeiClock.formatToParts(sourceTime).map(part => [part.type, part.value])) : {};
  const sourceFresh = live?.sourceTo === undefined || (Number.isFinite(sourceAge) && sourceAge >= 0 && sourceAge <= 5 * 60 * 1000 && sourceViewerAge >= 0 && sourceViewerAge <= 30 * 60 * 1000 && `${sourceParts.year}-${sourceParts.month}-${sourceParts.day}` === date);
  const polls = Number.isInteger(live?.polls) && live.polls > 0 ? live.polls : 0;
  const hasFullPolls = polls >= 15;
  const observedSegments = (live?.segments || []).filter(segment => Number.isFinite(segment.minutes) && segment.minutes > 0);
  const completeSegments = hasFullPolls ? observedSegments.filter(segment => segment.minutes >= 15) : [];
  const historical = /^\d{4}-\d{2}-\d{2}$/.test(date) && date < today;
  const eligible = date === today && minute >= 420 && minute < 570 && fresh && sourceFresh && live?.inWindow === true;
  const status = !observedSegments.length ? 'missing' : historical ? 'historical' : !eligible ? 'recent' : !completeSegments.length ? 'partial' : 'current';
  const label = { missing: '尚無有效觀測', historical: '歷史觀測', recent: '最近觀測', partial: '短期驗證觀測', current: '目前早尖峰觀測' }[status];
  return {
    status, label, isCurrent: status === 'current', hasFullPolls, polls,
    date: date || '日期未提供', period: live?.from && live?.to ? `${live.from}–${live.to}` : '時段未提供',
    observationsLabel: hasFullPolls ? `${polls}次觀測；各路段有效分級分鐘另列` : `短期驗證：${polls}次觀測／未滿15分鐘`,
    observedSegments, completeSegments,
    jammedSegments: completeSegments.filter(segment => segment.jammed15).sort((a, b) => b.share15 - a.share15),
  };
}
