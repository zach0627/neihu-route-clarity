import { useEffect, useMemo, useState } from 'react';
import snapshot from '../data/dashboard.json';
import { buildRankings, buildObservedRankings, buildCongestionRankings, representativeDirections, CONGESTED_LEVELS, SEVERE_LEVEL, SPEED_WINDOW_MINUTES } from '../lib/ranking.mjs';
import { buildFlexRecommendations, minuteText, parseMinute, SECTORS, CANDIDATE_RADIUS_METERS } from '../lib/flex.mjs';
import { heatmapRows, parkPeriods, dailySeries, weekdaySeries, WEEKDAYS } from '../lib/dashboard.mjs';

const nf = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 1 });
const rateFormatter = new Intl.NumberFormat('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const bearingNames = { N: '北向', NE: '東北向', E: '東向', SE: '東南向', S: '南向', SW: '西南向', W: '西向', NW: '西北向' };
const reasons = { status: '設備狀態異常', abnormal_status: '設備狀態異常', lane_count: '車道數不符', lane_count_mismatch: '車道數不符', duplicate_lane: '車道編號重複', duplicate_lanes: '車道編號重複', negative_volume: '流量為負值', invalid_volume: '流量無效', error_diags: '車道品質旗標', error_diag: '車道品質旗標', quality_flag: '車道品質旗標', missing_minute: '缺少分鐘資料', missing: '缺少資料', duplicate_minute: '分鐘資料重複', volume: '流量無效', partial_lane_coverage: '未涵蓋實際全部車道', station_mismatch: '設備編號不符', timestamp: '時間標記無效', timestamp_alignment: '時間未對齊整分鐘', duplicate_link: '方向資料重複', missing_link: '缺少方向資料', lane_id: '車道編號無效', missing_vehicles: '缺少車種資料', vehicle_type: '車種代碼無效', duplicate_vehicle_type: '車種資料重複', conflicting_duplicate: '重複分鐘的計數不一致' };
const formatNumber = value => Number.isFinite(Number(value)) ? nf.format(Number(value)) : '—';
const directionName = direction => bearingNames[direction?.bearing] || direction?.bearing || direction?.roadDirection || '方向待確認';
const pretty = value => typeof value === 'string' ? value : JSON.stringify(value, null, 2);
const shortDate = date => String(date || '').replaceAll('-', '/');
const unique = values => [...new Set(values)];
const getDays = (direction, dates) => (direction?.days || []).filter(day => dates.includes(day.date));
const expectedMinutes = 150;
const categoryNames = { entering: '入園路段', internal: '園區內路段', leaving: '出園路段', outside: '園區外／邊界路段', expressway: '市區快速道路' };
const levelLetter = level => 'ABCDEF'[Number(level) - 1] || '—';
const levelLetters = levels => levels.map(levelLetter).join('、');
const percent = (part, whole) => whole ? part / whole * 100 : 0;

function Icon({ name = 'arrow', size = 20, ...props }) {
  const paths = {
    arrow: <><path d="M4 12h16M14 6l6 6-6 6" /></>,
    download: <><path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4" /></>,
    chart: <><path d="M4 4v16h17M8 15v-4m5 4V7m5 8v-6" /></>,
    document: <><path d="M14 3H5v18h14V8l-5-5Z" /><path d="M14 3v6h5M8 13h8m-8 4h6" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>,
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7h.01" /></>,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    external: <><path d="M14 3h7v7m0-7L10 14M10 3H3v18h18v-7" /></>,
    location: <><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" /><circle cx="12" cy="10" r="2" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name] || paths.arrow}</svg>;
}

function RouteArt() {
  return <div className="route-art" aria-label="內湖區往園區方向的裝飾示意，並非實際道路地圖" role="img">
    <svg viewBox="0 0 410 240" aria-hidden="true">
      <defs><pattern id="dots" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="#b3c6bf" /></pattern></defs>
      <rect width="410" height="240" fill="url(#dots)" />
      <path d="M-25 190h124a30 30 0 0 0 30-30V99a30 30 0 0 1 30-30h100a30 30 0 0 1 30 30v151M32-20v90a30 30 0 0 0 30 30h334M-20 37h121a30 30 0 0 1 30 30v170M217-20v150a30 30 0 0 0 30 30h185" stroke="#d1ded6" fill="none" strokeWidth="13" />
      <path d="M-10 190h109a30 30 0 0 0 30-30V99a30 30 0 0 1 30-30h100a30 30 0 0 1 30 30v61" fill="none" stroke="#f2a36d" strokeWidth="13" />
      <path d="M-10 190h109a30 30 0 0 0 30-30V99a30 30 0 0 1 30-30h100a30 30 0 0 1 30 30v61" fill="none" stroke="#fff9ed" strokeWidth="1.4" strokeDasharray="6 8" />
      <circle cx="129" cy="126" r="12" fill="#fff" stroke="#164d43" strokeWidth="3" /><circle cx="129" cy="126" r="4" fill="#164d43" />
      <circle cx="289" cy="160" r="22" fill="#164d43" /><path d="M281 160h16m-6-6 6 6-6 6" stroke="#fff" strokeWidth="2" fill="none" />
      <g fill="#164d43" fontFamily="system-ui,sans-serif" fontSize="13"><text x="150" y="132">內湖區</text><text x="319" y="163">園區方向</text></g>
    </svg>
    <span className="art-caption">範圍示意 · 非實際道路地圖</span>
  </div>;
}

/** Real map from official link shapes, the two-sided park road stretches and the geocoded official addresses; north is up. */
function ScopeMap({ directions, park, variant = 'hero', shareById }) {
  const linked = directions.filter(direction => direction.geometry?.shape?.length > 1);
  const addresses = (park?.acceptedPoints || []).map(point => [point.lon, point.lat]);
  const stretches = (park?.stretches || []).filter(stretch => stretch.line?.length > 1);
  if (!stretches.length || !linked.length) return <RouteArt />;
  const extent = variant === 'extent';
  const boundaryRoads = park?.extent?.boundaryRoads || [];
  const isBoundary = direction => boundaryRoads.some(item => item.road === direction.roadName || item.road.startsWith(direction.roadName));
  // The overview frames the official addresses and interior roads with ~150 m of margin; longer roads are clipped at the frame.
  const core = [...addresses, ...stretches.flatMap(stretch => stretch.line)];
  const margin = extent ? 0.0015 : 0;
  const all = extent ? [...core.map(([lon, lat]) => [lon - margin, lat - margin]), ...core.map(([lon, lat]) => [lon + margin, lat + margin])] : [...core, ...linked.filter(direction => direction.scope?.included).flatMap(direction => direction.geometry.shape)];
  const lons = all.map(point => point[0]), lats = all.map(point => point[1]);
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2, kx = Math.cos(midLat * Math.PI / 180);
  const minX = Math.min(...lons) * kx, maxX = Math.max(...lons) * kx, minY = Math.min(...lats), maxY = Math.max(...lats);
  const width = extent ? 760 : 410, pad = extent ? 24 : 10;
  const scale = (width - pad * 2) / (maxX - minX);
  const height = Math.round((maxY - minY) * scale) + pad * 2;
  const project = ([lon, lat]) => [pad + (lon * kx - minX) * scale, pad + (maxY - lat) * scale];
  const path = points => points.map((point, index) => `${index ? 'L' : 'M'}${project(point).map(value => value.toFixed(1)).join(' ')}`).join('');
  const tone = direction => direction.scope?.included ? (direction.scope.category === 'entering' ? 'entering' : 'internal') : 'excluded';
  const ordered = [...linked].sort((a, b) => Number(Boolean(a.scope?.included)) - Number(Boolean(b.scope?.included)));
  const marker = variant;
  const metre = scale / 111320;
  const radius = (park.radiusMeters || 0) * metre;
  return <figure className={`scope-map scope-map-${variant}`}>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={extent ? '內湖科技園區範圍圖：官方園區門牌、園區內道路與邊界道路' : '官方園區門牌與偵測器路段地圖'}>
      <defs><marker id={`arrow-entering-${marker}`} viewBox="0 0 8 8" refX="6" refY="4" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0 8 4 0 8Z" fill="#d77538" /></marker><marker id={`arrow-internal-${marker}`} viewBox="0 0 8 8" refX="6" refY="4" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0 8 4 0 8Z" fill="#174d43" /></marker></defs>
      {extent && <clipPath id="extent-frame"><rect x="0" y="0" width={width} height={height} /></clipPath>}
      <g clipPath={extent ? 'url(#extent-frame)' : undefined}>
      {extent && <g className="map-coverage">{addresses.map((point, index) => { const [x, y] = project(point); return <circle key={index} cx={x.toFixed(1)} cy={y.toFixed(1)} r={radius.toFixed(1)} />; })}</g>}
      <g className="map-park">{stretches.map((stretch, index) => <path key={index} d={path(stretch.line)} />)}</g>
      {extent ? <>
        {linked.filter(direction => !isBoundary(direction)).map(direction => <path key={direction.id} d={path(direction.geometry.shape)} className="map-link map-context" />)}
        {linked.filter(isBoundary).map(direction => <path key={direction.id} d={path(direction.geometry.shape)} className="map-link map-boundary" />)}
      </> : variant === 'heat' ? ordered.map(direction => { const share = shareById?.get(direction.id); return <path key={direction.id} d={path(direction.geometry.shape)} className={`map-link ${share == null ? 'map-excluded' : 'map-heat'}`} style={share == null ? undefined : { stroke: heat(share) }}><title>{`${direction.roadName} ${directionName(direction)} ${direction.vdId}：${share == null ? '不列入排名' : `${percentText(share)} 分鐘塞車`}`}</title></path>; }) : ordered.map(direction => <path key={direction.id} d={path(direction.geometry.shape)} className={`map-link map-${tone(direction)}`} markerEnd={tone(direction) === 'excluded' ? undefined : `url(#arrow-${tone(direction)}-${marker})`}><title>{`${direction.roadName} ${directionName(direction)} ${direction.vdId}：${categoryNames[direction.scope?.category] || '未判定'}`}</title></path>)}
      <g className="map-address">{addresses.map((point, index) => { const [x, y] = project(point); return <circle key={index} cx={x.toFixed(1)} cy={y.toFixed(1)} r={extent ? 2 : 1.3} />; })}</g>
      </g>
      {extent && <g className="map-labels">{(park.extent?.labels || []).map(label => { const [x, y] = project([label.lon, label.lat]); return <text key={label.road} x={x.toFixed(1)} y={y.toFixed(1)} className={label.boundary ? 'label-boundary' : ''}>{label.road}</text>; })}</g>}
      {extent && <g className="map-furniture"><g transform={`translate(${width - 34} 30)`}><path d="M0 -14 6 4 0 0 -6 4Z" /><text y="18">北</text></g><g transform={`translate(${pad} ${height - 14})`}><path d={`M0 0H${(500 * metre).toFixed(1)}`} /><path d={`M0 -4V4M${(500 * metre).toFixed(1)} -4V4`} /><text x={(250 * metre).toFixed(1)} y="-7">500 公尺</text></g></g>}
    </svg>
    {variant === 'heat' ? <figcaption><span><i className="key key-park" />園區內道路</span><span><i className="key key-heat" />往園區路段（顏色越深越塞）</span><span><i className="key key-excluded" />不列入排名</span></figcaption> : extent ? <figcaption><span><i className="key key-coverage" />官方園區門牌（周圍 {park.radiusMeters} 公尺）</span><span><i className="key key-park" />園區內道路（兩側門牌皆在範圍）</span><span><i className="key key-boundary" />邊界道路（只有單側屬園區）</span><span><i className="key key-excluded" />其他偵測器路段</span></figcaption>
      : <figcaption><span><i className="key key-park" />園區內道路（兩側門牌皆在官方範圍）</span><span><i className="key key-address" />官方園區門牌</span><span><i className="key key-entering" />入園路段</span><span><i className="key key-internal" />園區內路段</span><span><i className="key key-excluded" />不列入</span></figcaption>}
  </figure>;
}

function ParkExtent({ park, directions, onMethod }) {
  const extent = park?.extent;
  if (!extent) return null;
  const place = item => <><strong>{item.address.replace(/^臺北市內湖區.{2}里/, '')}</strong><span className="mono">{item.lat.toFixed(5)}, {item.lon.toFixed(5)}</span></>;
  const sameCorner = extent.north.address === extent.west.address;
  return <section className="section-block extent-section" aria-labelledby="extent-heading"><div className="section-heading ranking-heading"><div><div className="eyebrow">WHERE IS THE PARK</div><h2 id="extent-heading">內湖科技園區的範圍 <span className="heading-suffix">依臺北市商業處公布的門牌範圍</span></h2><p>園區的官方定義是一組門牌範圍。下圖把這些門牌用 TDX 官方地址定位畫出來，並標出園區內道路與邊界道路。</p></div><button className="text-button" onClick={onMethod}>怎麼判定往園區路段 <Icon size={16} /></button></div>
    <div className="extent-body"><ScopeMap directions={directions} park={park} variant="extent" />
      <div className="extent-facts">
        <div className="extent-size"><div><span>南北約</span><strong>{formatNumber(extent.northSouthKm)}<small> 公里</small></strong></div><div><span>東西約</span><strong>{formatNumber(extent.eastWestKm)}<small> 公里</small></strong></div></div>
        <dl className="extent-corners">{sameCorner ? <div><dt>最北、最西</dt><dd>{place(extent.north)}</dd></div> : <><div><dt>最北</dt><dd>{place(extent.north)}</dd></div><div><dt>最西</dt><dd>{place(extent.west)}</dd></div></>}<div><dt>最南</dt><dd>{place(extent.south)}</dd></div><div><dt>最東</dt><dd>{place(extent.east)}</dd></div></dl>
        <div className="extent-boundary"><strong>邊界道路：只有單側門牌屬於園區</strong><ul>{extent.boundaryRoads.map(item => <li key={item.road}><span>{item.road}</span><span>{item.text}</span></li>)}</ul><p>這些路的另一側不屬園區，所以是園區的邊緣；道路本身的車流不列入往園區排名，只有開進園區內道路的路段才列入。</p></div>
        <p className="small-note">極點與距離由官方門牌座標算出，不是行政區界或都市計畫線；商業處範圍原文與每個門牌座標，都列在「資料來源與計算」頁。</p>
        <div className="extent-freeway"><strong>為什麼沒有國道？</strong><p>國道主線多為過境車，匝道偵測器在官方資料中對應的是主線路段、無法確認是否通往園區；下匝道後仍須經市區道路，那些路段已納入判定。MVP 先不納入，理由詳見「資料來源與計算」。</p></div>
      </div></div>
  </section>;
}

function CategoryBadge({ direction }) {
  const category = direction?.scope?.category;
  if (!category) return null;
  return <Badge tone={category === 'entering' ? 'orange' : category === 'internal' ? 'teal' : 'neutral'}>{categoryNames[category]}</Badge>;
}

function LevelBar({ levelMinutes = {}, total }) {
  if (!total) return null;
  return <div className="level-bar" aria-hidden="true">{[1, 2, 3, 4, 5, 6].map(level => <span key={level} className={`level-${level}`} style={{ width: `${percent(levelMinutes[level] || 0, total)}%` }} />)}</div>;
}

function Badge({ children, tone = 'neutral' }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

function downloadFile(filename, content, mime) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvCell(value) {
  let text = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function StatCard({ label, value, unit, detail, accent }) {
  return <div className={`stat-card${accent ? ' stat-accent' : ''}`}><div className="stat-label">{label}</div><div className="stat-value">{value}<span>{unit}</span></div><div className="stat-detail">{detail}</div></div>;
}

function CoverageNotice({ coverage, onMethod }) {
  const requested = coverage.requestedDates?.length || 0;
  const available = coverage.availableDates?.length || 0;
  const partial = available < requested || coverage.status === 'partial';
  return <div className={`coverage-note ${partial ? 'coverage-partial' : 'coverage-complete'}`}>
    <div className="notice-symbol"><Icon name={partial ? 'info' : 'check'} size={20} /></div>
    <div><strong>{partial ? '資料尚未涵蓋所有目標日期' : '所選日期的資料已完成下載'}</strong><p>目標 {requested} 個週一至週五，目前有 {available} 個日期可分析。{partial ? '此快照僅分析可用日期，缺漏日不補零、不推估。' : '僅採用通過品質檢查的分鐘，完整度另列供比較。'}</p></div>
    <button className="text-button" onClick={onMethod}>查看資料狀態 <Icon size={16} /></button>
  </div>;
}

function QualityTable({ directions, dates, onInspect, showAll, setShowAll }) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const filtered = useMemo(() => directions.filter(direction => (showAll || direction.scope?.included) && `${direction.roadName} ${direction.vdId} ${direction.linkId} ${directionName(direction)}`.toLowerCase().includes(search.toLowerCase())).sort((a, b) => String(a.roadName).localeCompare(String(b.roadName), 'zh-TW')), [directions, showAll, search]);
  useEffect(() => setPage(1), [search, showAll, dates.join(',')]);
  const shown = filtered.slice(0, page * 10);
  return <section className="section-block quality-section" aria-labelledby="quality-heading">
    <div className="section-heading"><div><div className="eyebrow">DATA QUALITY</div><h2 id="quality-heading">路段資料檢查</h2><p>每個方向都能查看有效分鐘、異常原因與納入依據。</p></div><Badge>{filtered.length} 個方向</Badge></div>
    <div className="table-tools"><label className="search-box"><Icon name="search" size={18} /><input aria-label="搜尋路名或測點編號" value={search} onChange={event => setSearch(event.target.value)} placeholder="搜尋道路、方向或測點編號" /></label><label className="checkbox-label"><input type="checkbox" checked={showAll} onChange={event => setShowAll(event.target.checked)} />顯示範圍外與待排除方向</label></div>
    <div className="table-scroll"><table className="data-table audit-table"><thead><tr><th scope="col">道路 / 測點</th><th scope="col">行車方向</th><th scope="col">有效分鐘</th><th scope="col">完整有效日</th><th scope="col">範圍判定</th><th scope="col"><span className="sr-only">操作</span></th></tr></thead><tbody>
      {shown.map(direction => {
        const days = getDays(direction, dates);
        const valid = days.reduce((sum, day) => sum + (Number(day.validMinutes) || 0), 0);
        const expected = dates.length * expectedMinutes;
        const full = days.filter(day => day.validMinutes === expectedMinutes).length;
        const pct = expected ? Math.min(100, valid / expected * 100) : 0;
        return <tr key={direction.id}><td><strong>{direction.roadName || '道路名稱未提供'}</strong><span className="cell-sub mono">{direction.vdId}</span></td><td>{directionName(direction)}</td><td><div className="quality-value">{formatNumber(valid)} <span>/ {formatNumber(expected)}</span></div><div className="progress-track" aria-hidden="true"><span className={pct === 100 ? 'full' : ''} style={{ width: `${pct}%` }} /></div></td><td>{full} <span className="muted">/ {dates.length} 日</span></td><td><Badge tone={direction.scope?.included ? (direction.scope?.category === 'entering' ? 'orange' : 'teal') : 'neutral'}>{direction.scope?.included && direction.isRepresentative === false ? '同路段備選' : direction.scope?.category ? categoryNames[direction.scope.category] : direction.scope?.included ? (direction.scope?.status === 'reviewed' ? '方向已核對' : '方向初選') : '未納入範圍'}</Badge></td><td><button className="inspect-button" onClick={() => onInspect(direction)} aria-label={`查看${direction.roadName} ${directionName(direction)}的資料明細`}>明細 <Icon size={16} /></button></td></tr>;
      })}
      {!shown.length && <tr><td colSpan="6" className="empty-cell">沒有符合條件的測點。可調整搜尋文字，或顯示所有方向。</td></tr>}
    </tbody></table></div>
    <div className="table-bottom"><span>顯示 {shown.length} / {filtered.length} 個方向 · 完整基準：每日 {expectedMinutes} 分鐘</span>{shown.length < filtered.length && <button className="button button-small button-outline" onClick={() => setPage(value => value + 1)}>顯示更多</button>}</div>
  </section>;
}

function RankingTable({ rankings, targetExpectedMinutes, onInspect }) {
  const maximum = Math.max(1, ...rankings.map(row => Number(row.averageMinuteVolume) || 0));
  return <div className="table-scroll"><table className="data-table ranking-table"><thead><tr><th scope="col">排名</th><th scope="col">道路 / 行車方向</th><th scope="col">每有效分鐘平均車次</th><th scope="col">有效分鐘與完整度</th><th scope="col">實測累計車次</th><th scope="col">查看依據</th></tr></thead><tbody>{rankings.slice(0, 10).map((row, index) => <tr key={row.id || `${row.vdId}-${index}`}><td><span className={`rank-number ${index < 3 ? 'rank-leading' : ''}`}>{String(index + 1).padStart(2, '0')}</span></td><td><strong>{row.roadName}</strong><span className="cell-sub">{directionName(row)} <span className="mono">{row.vdId}</span></span><CategoryBadge direction={row} /></td><td className="volume-cell"><strong>{rateFormatter.format(row.averageMinuteVolume)}<span> 車次／分</span></strong><div className="volume-track" aria-hidden="true"><span style={{ width: `${Math.max(2, Number(row.averageMinuteVolume) / maximum * 100)}%` }} /></div></td><td className="observed-quality-cell"><span>{formatNumber(row.validMinutes)} / {formatNumber(row.expectedMinutes)} 分鐘</span><small>可用日期完整度 {formatNumber(row.qualityPercentage)}%</small>{targetExpectedMinutes !== row.expectedMinutes && <small>要求期間完整度 {formatNumber(targetExpectedMinutes ? row.validMinutes / targetExpectedMinutes * 100 : 0)}%</small>}</td><td><strong>{formatNumber(row.totalObservedVolume)}</strong><span className="cell-sub">僅有效分鐘 · {row.observedDays} 日有資料</span></td><td><button className="inspect-button" onClick={() => onInspect(row)}>明細 <Icon size={16} /></button></td></tr>)}</tbody></table></div>;
}

function VerificationNote({ row, validation }) {
  const check = validation?.byDirection?.find(item => item.id === row.id);
  if (check?.minutes) return <span className="cell-sub verify-ok">官方路段比對：等級相同 {formatNumber(percent(check.exact, check.minutes))}%（{formatNumber(check.minutes)} 分鐘）</span>;
  return <span className="cell-sub verify-none">無臺北市發布路段，僅偵測器推算</span>;
}

function CongestionTable({ rankings, onInspect, validation }) {
  return <div className="table-scroll"><table className="data-table congestion-table"><thead><tr><th scope="col">排名</th><th scope="col">道路 / 行車方向</th><th scope="col">壅塞分鐘比例（{levelLetters(CONGESTED_LEVELS)} 級）</th><th scope="col">嚴重壅塞（{levelLetter(SEVERE_LEVEL)} 級）</th><th scope="col">平均車速</th><th scope="col">有車速分鐘</th><th scope="col">查看依據</th></tr></thead><tbody>{rankings.slice(0, 10).map((row, index) => <tr key={row.id}><td><span className={`rank-number ${index < 3 ? 'rank-leading rank-congested' : ''}`}>{String(index + 1).padStart(2, '0')}</span></td><td><strong>{row.roadName}</strong><span className="cell-sub">{directionName(row)} <span className="mono">{row.vdId}</span></span><CategoryBadge direction={row} /><VerificationNote row={row} validation={validation} /></td><td className="volume-cell"><strong>{rateFormatter.format(row.congestedShare)}<span> %</span></strong><LevelBar levelMinutes={row.levelMinutes} total={row.classifiedMinutes} /><small className="cell-sub">{formatNumber(row.congestedMinutes)} / {formatNumber(row.classifiedMinutes)} 分鐘</small></td><td><strong>{rateFormatter.format(row.severeShare)} %</strong><span className="cell-sub">{formatNumber(row.severeMinutes)} 分鐘</span></td><td><strong>{formatNumber(row.averageSpeed)}</strong><span className="cell-sub">km/h · {SPEED_WINDOW_MINUTES} 分鐘車速平均</span></td><td>{formatNumber(row.speedMinutes)}<span className="cell-sub">另有 {formatNumber(row.noFlowMinutes)} 分鐘前 {SPEED_WINDOW_MINUTES} 分鐘都無車</span></td><td><button className="inspect-button" onClick={() => onInspect(row)}>明細 <Icon size={16} /></button></td></tr>)}</tbody></table></div>;
}

function CompletenessDiagnostics({ dates, directions, coverage, strictCount, onInspect, onMethod }) {
  const candidates = representativeDirections(directions);
  const required = dates.length * expectedMinutes;
  const requestedDays = coverage.requestedDates?.length || 0;
  const availableDays = coverage.availableDates?.length || 0;
  const scopeLabel = dates.length === 1 ? '當日' : '整期';
  const totals = candidates.map(direction => {
    const days = getDays(direction, dates);
    const valid = days.reduce((sum, day) => sum + (Number(day.validMinutes) || 0), 0);
    const received = days.reduce((sum, day) => sum + (Number(day.receivedMinutes) || 0), 0);
    return { direction, valid, received, fullDays: days.filter(day => day.validMinutes === expectedMinutes).length };
  });
  const best = totals.reduce((selected, item) => !selected || item.valid > selected.valid ? item : selected, null);
  const sharedGaps = dates.flatMap(date => {
    const missing = candidates.map(direction => Math.max(0, expectedMinutes - (direction.days?.find(day => day.date === date)?.receivedMinutes || 0)));
    if (!missing.length || !missing.every(count => count > 0)) return [];
    return [{ date, min: Math.min(...missing), max: Math.max(...missing) }];
  });
  const hasData = dates.length > 0 && totals.some(item => item.received > 0);
  return <div className="empty-ranking-explanation">
    <div className="ranking-empty"><div className="empty-graphic"><Icon name="chart" size={35} /><span className="empty-dot" /></div><div><Badge tone={strictCount ? 'teal' : 'amber'}>完整期間診斷</Badge><h3>嚴格完整資料條件：{strictCount} 個方向符合</h3><p>{hasData ? `主排名使用現有有效分鐘比較，已檢查 ${candidates.length} 個代表方向。若要求每個所選日期的 150 分鐘全部有效，任一天只有 149 / 150 分鐘，該方向就無法列入${scopeLabel}完整資料結果。這項診斷會保留，並公開主排名使用的資料缺口。` : '需要先取得所選日期的原始實測資料。缺少資料不表示車流為零，也不會產生推估名次。'}</p></div></div>
    <div className="empty-evidence">
      <div className="completeness-baselines" aria-label="目標與本次分析的分鐘基準"><div><span>目標完整期間</span><strong>{requestedDays} 日 × 150 = {formatNumber(requestedDays * expectedMinutes)} 分鐘</strong><small>每個方向都需符合的目標</small></div><div><span>本次所選日期</span><strong>{dates.length} 日 × 150 = {formatNumber(required)} 分鐘</strong><small>目前已取得 {availableDays} / {requestedDays} 日，僅檢查所選可用日期</small></div></div>
      {hasData && best && <div className="best-completeness"><div className="best-completeness-heading"><div><span className="eyebrow">COMPLETENESS CHECK</span><h4>{scopeLabel}最完整的代表方向</h4><p>{best.direction.roadName} · {directionName(best.direction)} <span className="mono">{best.direction.vdId}</span></p></div><div className="best-completeness-value"><strong>{formatNumber(best.valid)}<span> / {formatNumber(required)}</span></strong><small>可用日期完整度 · {formatNumber(required ? best.valid / required * 100 : 0)}%</small></div></div><div className="completeness-progress" aria-hidden="true"><span style={{ width: `${required ? Math.min(100, best.valid / required * 100) : 0}%` }} /></div><p>{best.valid < required ? <>仍少 <strong>{formatNumber(Math.max(0, required - best.valid))} 個有效分鐘</strong>：{formatNumber(Math.max(0, required - best.received))} 分鐘未收到，{formatNumber(Math.max(0, best.received - best.valid))} 分鐘未通過品質檢查。</> : '所選日期的分鐘資料已完整通過檢查。'}完整有效日期為 {best.fullDays} / {dates.length} 日。主排名只使用有效部分的實測計數，不補足成完整期間總量。</p><button className="text-button" onClick={() => onInspect(best.direction)}>查看最完整方向明細 <Icon size={16} /></button></div>}
      {sharedGaps.length > 0 && <div className="shared-gaps"><h4>全體代表方向都有資料缺漏的日期</h4><p>以下日期的 {candidates.length} 個代表方向，都未收到完整 150 分鐘；品質檢查剔除的分鐘另計。</p><ul>{sharedGaps.map(gap => <li className="shared-gap-item" key={gap.date}><span>{shortDate(gap.date)}</span><strong>每個方向缺 {gap.min === gap.max ? formatNumber(gap.min) : `${formatNumber(gap.min)}–${formatNumber(gap.max)}`} 分鐘</strong></li>)}</ul><p>僅這些日期，每個代表方向至少缺 {formatNumber(sharedGaps.reduce((sum, gap) => sum + gap.min, 0))} 分鐘資料。</p></div>}
      <div className="empty-explanation-footer"><p>這裡呈現資料完整度診斷；主排名比較各方向有效分鐘的平均車次，並非完整期間車流總量。</p><button className="text-button" onClick={onMethod}>了解排名的計算條件 <Icon size={16} /></button></div>
    </div>
  </div>;
}

/** Sequential single-hue ramp for congestion share (0 → light, 1 → dark brick); text stays in ink colours. */
const heat = share => share == null ? 'var(--heat-none)' : `color-mix(in srgb, var(--heat-high) ${Math.round(8 + share * 92)}%, var(--heat-low))`;
const percentText = value => value == null ? '—' : `${formatNumber(value * 100)}%`;
const LIVE_MODE = typeof __LIVE_MODE__ !== 'undefined' && __LIVE_MODE__;

function useLiveData() {
  const [live, setLive] = useState(null);
  useEffect(() => {
    if (!LIVE_MODE) return undefined;
    let stopped = false;
    const load = () => fetch(`./live.json?t=${Date.now()}`, { cache: 'no-store' }).then(response => response.ok ? response.json() : null).then(json => { if (!stopped) setLive(json); }).catch(() => {});
    load();
    const timer = setInterval(load, 5 * 60 * 1000);
    return () => { stopped = true; clearInterval(timer); };
  }, []);
  return live;
}

function HeatLegend() {
  return <div className="heat-legend" aria-hidden="true"><span>0%</span><i style={{ background: `linear-gradient(90deg, ${heat(0)}, ${heat(0.5)}, ${heat(1)})` }} /><span>100%</span><small>{levelLetters(CONGESTED_LEVELS)} 級分鐘比例</small></div>;
}

function BarChart({ items, valueOf, labelOf, noteOf, format, height = 150, highlight }) {
  const width = 640, top = 18, bottom = 34, gap = 2;
  const max = Math.max(0.0001, ...items.map(item => valueOf(item) ?? 0));
  const band = (width - 8) / items.length, barWidth = Math.max(4, band - gap * 2 - 4);
  const plot = height - top - bottom;
  return <svg className="bar-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={items.map(item => `${labelOf(item)} ${format(valueOf(item))}`).join('，')}>
    <line x1="4" x2={width - 4} y1={top + plot} y2={top + plot} className="chart-baseline" />
    {items.map((item, index) => { const value = valueOf(item); const h = value == null ? 0 : Math.max(2, value / max * plot); const x = 4 + index * band + (band - barWidth) / 2; const note = noteOf?.(item); const strong = highlight?.(item); return <g key={index} className={`bar${note ? ' bar-note' : ''}${strong ? ' bar-strong' : ''}`}><title>{`${labelOf(item)}${note ? `（${note}）` : ''}：${format(value)}`}</title><rect x={x} y={top + plot - h} width={barWidth} height={h} rx="2" /><rect x={x - gap} y={top} width={barWidth + gap * 2} height={plot} className="bar-hit" />{(strong || note) && <text x={x + barWidth / 2} y={top + plot - h - 5} className="bar-value">{note ? '假' : format(value)}</text>}<text x={x + barWidth / 2} y={height - 18} className="bar-label">{labelOf(item)}</text></g>; })}
  </svg>;
}

function DashboardPage({ data, dates, onInspect, onNavigate }) {
  const live = useLiveData();
  const [skipHolidays, setSkipHolidays] = useState(false);
  const holidays = data.holidays?.dates || [];
  const rows = useMemo(() => heatmapRows(data.directions || [], dates), [dates.join(',')]);
  const periods = useMemo(() => parkPeriods(rows), [rows]);
  const daily = useMemo(() => dailySeries(data.directions || [], dates, holidays), [dates.join(',')]);
  const weekdays = useMemo(() => weekdaySeries(daily, { skipHolidays }), [daily, skipHolidays]);
  const congestion = useMemo(() => buildCongestionRankings(data.directions || [], dates, { limit: 10 }), [dates.join(',')]);
  const volume = useMemo(() => buildObservedRankings(data.directions || [], dates, { limit: 1 }), [dates.join(',')]);
  const company = data.companies?.list?.[0];
  const flex = useMemo(() => company ? buildFlexRecommendations(company.location, data.directions || [], dates, { baselineMinute: parseMinute(data.companies.defaults?.baselineStart || '08:30') }) : [], [company, dates.join(',')]);
  const pooled = rows.reduce((total, row) => ({ jam: total.jam + row.periods.reduce((s, p) => s + p.congested, 0), all: total.all + row.classified }), { jam: 0, all: 0 });
  const peak = periods.reduce((best, period) => (period.share ?? -1) > (best?.share ?? -1) ? period : best, null);
  const v = data.validation;
  const shareById = new Map(rows.map(row => [row.direction.id, row.share]));
  const holidayList = holidays.map(item => `${shortDate(item.date).slice(5)} ${item.name}`).join('、');
  return <div className="dashboard-page">
    <div className="page-intro"><div className="eyebrow">DASHBOARD</div><h1>內湖科技園區早尖峰總覽</h1><p>{shortDate(dates[0])} — {shortDate(dates.at(-1))} 共 {dates.length} 個工作日，07:00–09:30。所有數字由政府開放資料計算，與「車流觀測」「彈性上班建議」頁使用同一份資料。</p><div className="hero-meta"><Badge tone={LIVE_MODE ? 'teal' : 'amber'}>{LIVE_MODE ? 'GitHub Pages 版：每 15 分鐘更新' : '離線示範版：歷史資料快照'}</Badge><span>快照產生 {data.meta?.generatedAt ? new Date(data.meta.generatedAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false }) : '—'}</span></div></div>
    <section className="stats-grid dashboard-kpis" aria-label="重點指標">
      <StatCard label="分析工作日" value={dates.length} unit="日" detail={`目標 ${data.coverage?.requestedDates?.length || 0} 日；含 ${holidays.length} 個國定假日`} />
      <StatCard label="往園區路段" value={rows.length} unit="個" detail={`${data.summary?.inScopeDirections ?? '—'} 個方向（入園 ${data.summary?.categories?.entering ?? '—'} · 園區內 ${data.summary?.categories?.internal ?? '—'}），同 LinkID 取一支代表`} />
      <StatCard label="園區整體塞車比例" value={formatNumber(pooled.all ? pooled.jam / pooled.all * 100 : 0)} unit="%" detail={`${levelLetters(CONGESTED_LEVELS)} 級分鐘 ÷ 已分級分鐘`} />
      <StatCard label="最塞的 15 分鐘" value={peak ? minuteText(peak.start) : '—'} unit="起" detail={peak ? `${minuteText(peak.start)}–${minuteText(peak.start + 15)} · ${percentText(peak.share)} 分鐘塞車` : ''} accent />
      <StatCard label="最塞路段" value={congestion[0] ? percentText(congestion[0].congestedShare / 100) : '—'} unit="" detail={congestion[0] ? `${congestion[0].roadName} ${directionName(congestion[0])}` : ''} />
      <StatCard label="車流量最高" value={volume[0] ? formatNumber(volume[0].averageMinuteVolume) : '—'} unit="輛/分" detail={volume[0] ? `${volume[0].roadName} ${directionName(volume[0])}` : ''} />
      <StatCard label="與官方路況等級相同" value={v?.minutes ? formatNumber(v.exact / v.minutes * 100) : '—'} unit="%" detail={v?.minutes ? `${formatNumber(v.minutes)} 分鐘逐分鐘比對 · 相差一級內 ${formatNumber(v.withinOne / v.minutes * 100)}%` : ''} />
      <StatCard label="資料完整度" value={formatNumber(daily.reduce((s, d) => s + d.valid, 0) / Math.max(1, rows.length * 150 * dates.length) * 100)} unit="%" detail="往園區路段的有效分鐘 ÷ 應有分鐘" />
    </section>
    <LivePanel live={live} company={company} flex={flex} onNavigate={onNavigate} />
    <section className="section-block dashboard-card" aria-labelledby="heatmap-heading"><div className="section-heading ranking-heading"><div><div className="eyebrow">WHEN & WHERE</div><h2 id="heatmap-heading">時段熱度圖：哪條路、幾點最塞</h2><p>每列一個往園區路段（依整體塞車比例排序），每格是該 15 分鐘時段 {levelLetters(CONGESTED_LEVELS)} 級分鐘的比例；點路名看明細。</p></div><HeatLegend /></div>
      <div className="table-scroll"><table className="heatmap"><thead><tr><th scope="col">路段</th><th scope="col">整體</th>{periods.map(period => <th scope="col" key={period.start}>{minuteText(period.start)}</th>)}</tr></thead><tbody>
        <tr className="heatmap-total"><th scope="row">園區整體</th><td><strong>{percentText(pooled.all ? pooled.jam / pooled.all : null)}</strong></td>{periods.map(period => <td key={period.start} style={{ background: heat(period.share) }} title={`園區整體 ${minuteText(period.start)}–${minuteText(period.start + 15)}：${percentText(period.share)}`}><span>{percentText(period.share)}</span></td>)}</tr>
        {rows.map(row => <tr key={row.direction.id}><th scope="row"><button className="text-button" onClick={() => onInspect(row.direction)}>{row.direction.roadName} {directionName(row.direction)}</button><span className="cell-sub">{categoryNames[row.direction.scope?.category]} · <span className="mono">{row.direction.vdId}</span></span></th><td><strong>{percentText(row.share)}</strong></td>{row.periods.map(period => <td key={period.start} style={{ background: heat(period.share) }} title={`${row.direction.roadName}${directionName(row.direction)} ${minuteText(period.start)}–${minuteText(period.start + 15)}：${percentText(period.share)}（${formatNumber(period.congested)} / ${formatNumber(period.classified)} 分鐘）`}><span className="sr-only">{percentText(period.share)}</span></td>)}</tr>)}
      </tbody></table></div></section>
    <div className="dashboard-two">
      <section className="section-block dashboard-card" aria-labelledby="peak-heading"><div className="section-heading ranking-heading"><div><div className="eyebrow">PEAK</div><h2 id="peak-heading">園區整體：每 15 分鐘塞車比例</h2><p>所有往園區路段合計；最高的時段標示數值。</p></div></div><div className="chart-wrap"><BarChart items={periods} valueOf={item => item.share} labelOf={item => minuteText(item.start)} format={percentText} highlight={item => item === peak} /></div></section>
      <section className="section-block dashboard-card" aria-labelledby="map-heading"><div className="section-heading ranking-heading"><div><div className="eyebrow">MAP</div><h2 id="map-heading">壅塞地圖</h2><p>往園區路段依整體塞車比例上色，灰色為不列入排名的路段。</p></div><HeatLegend /></div><div className="chart-wrap"><ScopeMap directions={data.directions || []} park={data.meta?.park} variant="heat" shareById={shareById} /></div></section>
    </div>
    <section className="section-block dashboard-card" aria-labelledby="daily-heading"><div className="section-heading ranking-heading"><div><div className="eyebrow">DAILY TREND</div><h2 id="daily-heading">每日趨勢</h2><p>標「假」的是國定假日（{holidayList || '無'}；人事行政總處 115 年辦公日曆表）。依決定，最小版本的排名不排除假日，這裡只標示。</p></div></div>
      <div className="dashboard-two dashboard-two-inner"><div><h3 className="chart-title">園區整體塞車比例</h3><BarChart items={daily} valueOf={item => item.share} labelOf={item => shortDate(item.date).slice(5)} noteOf={item => item.holiday} format={percentText} /></div><div><h3 className="chart-title">每路段每分鐘平均車次</h3><BarChart items={daily} valueOf={item => item.perMinute} labelOf={item => shortDate(item.date).slice(5)} noteOf={item => item.holiday} format={value => value == null ? '—' : `${formatNumber(value)} 輛`} /></div></div>
      <details className="disclosure"><summary>表格檢視：每日數值與資料健康度</summary><div className="table-scroll"><table className="data-table"><thead><tr><th scope="col">日期</th><th scope="col">星期</th><th scope="col">塞車比例</th><th scope="col">每分鐘車次</th><th scope="col">資料完整度</th><th scope="col">與官方等級相同</th></tr></thead><tbody>{daily.map(day => <tr key={day.date}><td>{shortDate(day.date)}{day.holiday ? `（${day.holiday}）` : ''}</td><td>{WEEKDAYS[day.weekday]}</td><td>{percentText(day.share)}</td><td>{formatNumber(day.perMinute)}</td><td>{percentText(day.completeness)}</td><td>{day.officialAgreement == null ? '—' : `${percentText(day.officialAgreement)}（${formatNumber(day.officialMinutes)} 分鐘）`}</td></tr>)}</tbody></table></div></details></section>
    <div className="dashboard-two">
      <section className="section-block dashboard-card" aria-labelledby="weekday-heading"><div className="section-heading ranking-heading"><div><div className="eyebrow">WEEKDAY</div><h2 id="weekday-heading">星期一到五比較</h2><p>{skipHolidays ? '已排除國定假日（只影響這張圖）。' : '含國定假日；可切換排除，看假日對平均的影響。'}</p></div><label className="checkbox-label"><input type="checkbox" checked={skipHolidays} onChange={event => setSkipHolidays(event.target.checked)} />排除國定假日</label></div><div className="chart-wrap"><BarChart items={weekdays} valueOf={item => item.share} labelOf={item => `${item.name}（${item.days}）`} format={percentText} highlight={() => true} /></div></section>
      <section className="section-block dashboard-card" aria-labelledby="flex-summary-heading"><div className="section-heading ranking-heading"><div><div className="eyebrow">FLEXIBLE START</div><h2 id="flex-summary-heading">{company ? `${company.shortName}彈性上班建議` : '彈性上班建議'}</h2><p>標準上班 {data.companies?.defaults?.baselineStart || '08:30'}（示範）；依各方向基準熱門塞車路段的塞車解除時間。</p></div><button className="text-button" onClick={() => onNavigate('flex')}>看推算依據 <Icon size={16} /></button></div>
        <div className="table-scroll"><table className="data-table"><thead><tr><th scope="col">方向</th><th scope="col">基準路段</th><th scope="col">建議最晚</th></tr></thead><tbody>{flex.map(rec => <tr key={rec.key}><td><span className="sector-dot" style={{ background: sectorColors[rec.key] }} />{rec.name}</td><td>{rec.benchmark ? `${rec.benchmark.roadName} ${directionName(rec.benchmark)}` : '—'}<span className="cell-sub">{rec.benchmark ? (rec.verified ? '有官方路段可驗證' : '僅偵測器推算') : ''}</span></td><td><strong>{minuteText(rec.recommendedMinute)}{rec.reachesEnd ? '+' : ''}</strong><span className="cell-sub">{rec.extensionMinutes ? `${rec.reachesEnd ? '至少 ' : ''}+${rec.extensionMinutes} 分鐘` : '維持標準'}</span></td></tr>)}</tbody></table></div></section>
    </div>
    <section className="section-block dashboard-card" aria-labelledby="top-heading"><div className="section-heading ranking-heading"><div><div className="eyebrow">TOP 10</div><h2 id="top-heading">塞車前十名</h2><p>完整欄位與匯出在「車流觀測」頁。</p></div><button className="text-button" onClick={() => onNavigate('ranking')}>車流觀測 <Icon size={16} /></button></div><ol className="top-list">{congestion.map(row => <li key={row.id}><button className="text-button" onClick={() => onInspect(row)}><span>{row.roadName} {directionName(row)}</span></button><i style={{ width: `${row.congestedShare}%`, background: heat(row.congestedShare / 100) }} /><strong>{formatNumber(row.congestedShare)}%</strong></li>)}</ol></section>
  </div>;
}

function LivePanel({ live, company, flex, onNavigate }) {
  if (!LIVE_MODE) return <div className="coverage-note live-note"><div className="notice-symbol"><Icon name="clock" size={20} /></div><div><strong>這是離線示範版，顯示歷史資料快照</strong><p>部署到 GitHub Pages 的版本，會由 GitHub Actions 在平日 07:00–09:30 每 15 分鐘呼叫 TDX 即時 API，更新目前塞車路段與當天的彈性上班建議；每天早上另外下載前一天的歷史資料重算排名。</p></div><button className="text-button" onClick={() => onNavigate('flex')}>15 分鐘更新怎麼做 <Icon size={16} /></button></div>;
  if (!live) return <div className="coverage-note live-note"><div className="notice-symbol"><Icon name="clock" size={20} /></div><div><strong>即時資料尚未產生</strong><p>平日 07:00–09:30 每 15 分鐘更新一次；目前顯示歷史快照。</p></div></div>;
  const jammed = (live.segments || []).filter(segment => segment.jammed15).sort((a, b) => b.share15 - a.share15);
  const liveCompany = (live.companies || []).find(item => item.id === company?.id);
  return <section className="section-block dashboard-card live-panel" aria-labelledby="live-panel-heading"><div className="section-heading ranking-heading"><div><div className="eyebrow">LIVE · 每 15 分鐘</div><h2 id="live-panel-heading">即時狀態</h2><p>更新於 {new Date(live.generatedAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false })}；資料 {live.from ? `${live.from}–${live.to}` : '—'}（臺北時間），{live.inWindow ? '早尖峰時段內' : '不在 07:00–09:30，僅供檢查'}。</p></div><Badge tone={jammed.length ? 'orange' : 'teal'}>{jammed.length} 個路段近 15 分鐘過半塞車</Badge></div>
    <div className="dashboard-two dashboard-two-inner"><div><h3 className="chart-title">近 15 分鐘塞車的往園區路段</h3>{jammed.length ? <ol className="top-list">{jammed.slice(0, 8).map(segment => <li key={segment.id}><span>{segment.roadName} {bearingNames[segment.bearing] || segment.bearing}</span><i style={{ width: `${segment.share15 * 100}%`, background: heat(segment.share15) }} /><strong>{percentText(segment.share15)}</strong></li>)}</ol> : <p className="small-note">目前沒有往園區路段在近 15 分鐘過半時間塞車。</p>}</div>
      <div><h3 className="chart-title">{company?.shortName}今日彈性上班（即時規則）</h3><div className="table-scroll"><table className="data-table"><thead><tr><th scope="col">方向</th><th scope="col">歷史建議</th><th scope="col">今日即時</th></tr></thead><tbody>{flex.map(rec => { const now = liveCompany?.directions?.find(item => item.key === rec.key); return <tr key={rec.key}><td>{rec.name}</td><td>{minuteText(rec.recommendedMinute)}</td><td><strong>{now ? minuteText(now.recommendedMinute) : '—'}</strong><span className="cell-sub">{now ? (now.jammed ? `基準路段近 15 分鐘 ${percentText(now.share)} 塞車，延後` : '基準路段未過半塞車，維持') : '無資料'}</span></td></tr>; })}</tbody></table></div></div></div></section>;
}

const sectorColors = { north: '#3d6fb0', east: '#c8642a', south: '#7a55a8', west: '#2c8063' };
const baselineChoices = ['08:00', '08:30', '09:00'];

/** Company-centred map: 2 km candidate circle, four compass sectors, candidate segments per direction and each benchmark. */
function CompanyMap({ company, recommendations, directions }) {
  const centre = [company.location.lon, company.location.lat];
  const kx = Math.cos(centre[1] * Math.PI / 180), radius = CANDIDATE_RADIUS_METERS / 111320;
  const size = 520, pad = 18, frame = radius * 1.15, scale = (size - pad * 2) / (frame * 2);
  const project = ([lon, lat]) => [size / 2 + (lon - centre[0]) * kx * scale, size / 2 - (lat - centre[1]) * scale];
  const path = points => points.map((point, index) => `${index ? 'L' : 'M'}${project(point).map(value => value.toFixed(1)).join(' ')}`).join('');
  const sectorOfId = new Map(recommendations.flatMap(rec => rec.candidates.map(row => [row.id, rec.key])));
  const benchmarks = new Set(recommendations.map(rec => rec.benchmark?.id).filter(Boolean));
  const ray = bearing => { const r = frame * scale; return [size / 2 + Math.sin(bearing * Math.PI / 180) * r, size / 2 - Math.cos(bearing * Math.PI / 180) * r]; };
  const [cx, cy] = project(centre);
  return <figure className="company-map"><svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${company.shortName}周邊四個方向的候選路段與基準路段`}>
    <circle cx={cx} cy={cy} r={radius * scale} className="company-radius" />
    {[45, 135, 225, 315].map(bearing => { const [x, y] = ray(bearing); return <line key={bearing} x1={cx} y1={cy} x2={x} y2={y} className="company-sector" />; })}
    {directions.filter(direction => direction.geometry?.shape?.length > 1).map(direction => { const key = sectorOfId.get(direction.id); return <path key={direction.id} d={path(direction.geometry.shape)} className={`company-link${benchmarks.has(direction.id) ? ' company-benchmark' : ''}`} style={key ? { stroke: sectorColors[key] } : undefined}><title>{`${direction.roadName} ${directionName(direction)} ${direction.vdId}`}</title></path>; })}
    {[['北', 0], ['東', 90], ['南', 180], ['西', 270]].map(([name, bearing]) => { const [x, y] = ray(bearing); const key = SECTORS.find(sector => sector.name === name).key; return <text key={name} x={(cx + (x - cx) * 0.9).toFixed(1)} y={(cy + (y - cy) * 0.9).toFixed(1)} className="company-sector-label" style={{ fill: sectorColors[key] }}>{name}</text>; })}
    <circle cx={cx} cy={cy} r="6" className="company-dot" /><text x={cx + 10} y={cy - 9} className="company-name">{company.shortName}</text>
  </svg><figcaption>以公司為中心，方位分成四區（北 315°–45°、東 45°–135°、南 135°–225°、西 225°–315°）；圓圈為 {formatNumber(CANDIDATE_RADIUS_METERS / 1000)} 公里候選範圍。彩色為各方向朝公司前進的路段，粗線為基準熱門塞車路段。</figcaption></figure>;
}

function PeriodStrip({ periods, jamShare }) {
  return <div className="period-strip" role="img" aria-label="各 15 分鐘時段的塞車分鐘比例">{periods.map(period => <div key={period.start} className={`period-cell${period.jammed ? ' period-jammed' : ''}`} title={`${minuteText(period.start)}–${minuteText(period.end)}：${period.share == null ? '無資料' : `${formatNumber(period.share * 100)}% 分鐘塞車`}，${period.jammedDays}/${period.days} 天過半塞車`}><span style={{ background: period.share == null ? '#eef1e8' : `rgba(184, 69, 44, ${0.12 + period.share * 0.88})` }} /><small>{minuteText(period.start)}</small></div>)}<p className="period-legend">色塊越深代表該時段塞車分鐘比例越高；外框標示過半時間（≥ {formatNumber(jamShare * 100)}%）在塞車的時段。</p></div>;
}

/** Why a direction gets extra flexible time and the exact basis of the increase, built only from the computed periods. */
function flexExplanation(rec, company) {
  const km = formatNumber(CANDIDATE_RADIUS_METERS / 1000);
  if (!rec.benchmark) return { why: [`${rec.name}方向在${company.shortName} ${km} 公里內，沒有朝公司前進、可分級的市區道路偵測器路段。`], formula: '增加 0 分鐘：沒有可推算的路段，維持標準上班時間。', basis: [], evidence: [] };
  const b = rec.benchmark;
  const jammed = rec.periods.filter(period => period.jammed);
  const hotter = rec.candidates.filter(row => row.id !== b.id && row.congestedShare > b.congestedShare);
  const period = start => rec.periods.find(item => item.start === start);
  const pct = item => `${formatNumber(item.share * 100)}%`;
  const official = (b.days || []).reduce((total, day) => { const c = day.officialComparison; return c ? { minutes: total.minutes + c.minutes, exact: total.exact + c.exact } : total; }, { minutes: 0, exact: 0 });
  const why = [`基準路段：「${b.roadName}${directionName(b)}」（${b.vdId}）。在${rec.name}方向 ${rec.candidates.length} 個朝公司前進的路段中，${rec.verified ? '它是有臺北市官方路段可驗證的路段裡最塞的' : '它最塞，但沒有官方路段可驗證'}：分析期間 ${formatNumber(b.congestedShare)}% 的分鐘為 ${levelLetters(CONGESTED_LEVELS)} 級。`];
  if (hotter.length) why.push(`另有 ${hotter.map(row => `${row.roadName}${directionName(row)}（${formatNumber(row.congestedShare)}%）`).join('、')} 更塞，但沒有官方路段可驗證，所以不當基準。`);
  let formula, basis = [];
  if (!jammed.length) {
    why.push(`這條路在 07:00–09:30 沒有任何 15 分鐘時段過半時間在塞車。`);
    formula = `增加 0 分鐘：沒有塞車時段，維持標準上班 ${minuteText(rec.baselineMinute)}。`;
  } else {
    const last = jammed.at(-1), next = period(last.end);
    why.push(`塞車時段：${jammed.map(item => `${minuteText(item.start)}–${minuteText(item.end)}（${pct(item)}，${item.jammedDays}/${item.days} 天過半塞車）`).join('、')}。這些 15 分鐘時段都有一半以上的時間在塞車。`);
    const base = minuteText(rec.baselineMinute), until = minuteText(rec.recommendedMinute), span = `${minuteText(rec.jamStart)}–${minuteText(rec.clearMinute)}`;
    if (rec.clearMinute <= rec.baselineMinute) why.push(`塞車在標準上班 ${base} 前就解除，不需延後。`);
    else if (rec.jamStart >= rec.baselineMinute) why.push(`塞車集中在標準上班 ${base} 之後的 ${span}。員工只要晚一點出門就會遇上這段塞車，在塞車中趕打卡；把最晚彈性上班延到塞車解除的 ${until}，晚出門的員工可以等塞車解除再到，不會因塞車遲到。`);
    else why.push(`標準上班 ${base} 正落在塞車時段 ${span} 之內，要準時打卡的員工正好在塞車中通勤，容易遲到；把最晚彈性上班延到 ${until}，員工可以避開塞車或等塞車解除再到。`);
    formula = rec.extensionMinutes ? `增加 ${rec.reachesEnd ? '至少 ' : ''}${rec.extensionMinutes} 分鐘 = 塞車解除 ${minuteText(rec.clearMinute)}${rec.reachesEnd ? '（觀測結束仍塞車）' : ''} − 標準上班 ${minuteText(rec.baselineMinute)}` : `增加 0 分鐘：塞車解除 ${minuteText(rec.clearMinute)} 不晚於標準上班 ${minuteText(rec.baselineMinute)}`;
    basis = [`塞車解除 = 最後一個塞車時段 ${minuteText(last.start)}–${minuteText(last.end)} 的結束時間：該時段 ${formatNumber(last.congested)} ÷ ${formatNumber(last.classified)} 分鐘 = ${pct(last)} ≥ ${formatNumber(rec.jamShare * 100)}%。`, next ? `下一個時段 ${minuteText(next.start)}–${minuteText(next.end)} 為 ${next.share == null ? '無資料' : pct(next)}，低於 ${formatNumber(rec.jamShare * 100)}%，視為已解除。` : `${minuteText(last.end)} 是觀測時段結束，之後是否仍塞車沒有資料，所以標示為「至少」。`, '增加分鐘數以 15 分鐘為單位，與每 15 分鐘的即時更新一致；建議時間不會早於公司的標準上班時間。'];
  }
  const evidence = [`TDX 臺北市車輛偵測器歷史資料（Historical/Road/Traffic/Live/VD/City/Taipei）${rec.days} 個有資料的工作日，每分鐘通過品質檢查的紀錄。`, `每分鐘車速取該分鐘與前 ${SPEED_WINDOW_MINUTES - 1} 分鐘的車次加權平均，依臺北市壅塞水準 ${b.geometry?.congestionLevelId || ''} 分級，${levelLetters(CONGESTED_LEVELS)} 級算塞車。`, rec.verified && official.minutes ? `這條路有臺北市官方路段 ${b.geometry.sectionId}；與官方逐分鐘壅塞等級相同 ${formatNumber(percent(official.exact, official.minutes))}%（${formatNumber(official.minutes)} 分鐘）。` : '這條路沒有臺北市官方路段，等級只由偵測器推算，信心較低。'];
  return { why, formula, basis, evidence };
}

function FlexExplanation({ rec, company }) {
  const e = flexExplanation(rec, company);
  return <div className="flex-explain">
    <div className="explain-block"><h4>為什麼要增加</h4><ul>{e.why.map((line, index) => <li key={index}>{line}</li>)}</ul></div>
    <div className="explain-formula"><h4>增加基準</h4><strong>{e.formula}</strong>{e.basis.length > 0 && <ul>{e.basis.map((line, index) => <li key={index}>{line}</li>)}</ul>}</div>
    {e.evidence.length > 0 && <div className="explain-block explain-evidence"><h4>依據資料</h4><ul>{e.evidence.map((line, index) => <li key={index}>{line}</li>)}</ul></div>}
  </div>;
}

function DirectionCard({ rec, company, onInspect }) {
  const b = rec.benchmark;
  return <article className="direction-card" style={{ '--sector': sectorColors[rec.key] }}>
    <header><div><span className="direction-name">{rec.name}</span><span className="direction-sub">方向來的員工</span></div><div className="direction-result"><small>建議最晚彈性上班</small><strong>{minuteText(rec.recommendedMinute)}{rec.reachesEnd ? '+' : ''}</strong><Badge tone={rec.extensionMinutes ? 'orange' : 'teal'}>{rec.extensionMinutes ? `比標準晚${rec.reachesEnd ? '至少' : ''} ${rec.extensionMinutes} 分鐘` : '維持標準時間'}</Badge></div></header>
    {b ? <><div className="direction-benchmark"><span>基準熱門塞車路段</span><button className="text-button" onClick={() => onInspect(b)}><strong>{b.roadName} {directionName(b)}</strong> <span className="mono">{b.vdId}</span> <Icon size={14} /></button><div className="direction-badges"><Badge tone={rec.verified ? 'teal' : 'amber'}>{rec.verified ? '有官方路段可驗證' : '僅偵測器推算'}</Badge><CategoryBadge direction={b} />{rec.reachesEnd && <Badge tone="amber">到 09:30 仍塞車</Badge>}</div></div>
      <PeriodStrip periods={rec.periods} jamShare={rec.jamShare} />
      <FlexExplanation rec={rec} company={company} />
      <details className="disclosure"><summary>每 15 分鐘檢查點的歷史紀錄（{rec.days} 天）</summary><div className="table-scroll"><table className="data-table check-table"><thead><tr><th scope="col">時段</th><th scope="col">塞車分鐘比例</th><th scope="col">過半塞車的天數</th><th scope="col">判定</th></tr></thead><tbody>{rec.periods.map(period => <tr key={period.start}><td>{minuteText(period.start)}–{minuteText(period.end)}</td><td>{period.share == null ? '無資料' : `${formatNumber(period.share * 100)}%（${formatNumber(period.congested)} / ${formatNumber(period.classified)}）`}</td><td>{period.jammedDays} / {period.days}</td><td>{period.jammed ? '塞車時段' : '—'}</td></tr>)}</tbody></table></div></details>
      <details className="disclosure"><summary>這個方向的 {rec.candidates.length} 個候選路段</summary><ul className="failure-list">{rec.candidates.map(row => <li key={row.id}><span className="mono">{row.vdId}</span><span>{row.roadName} {directionName(row)} · {formatNumber(row.congestedShare)}% 分鐘塞車 · {row.geometry?.sectionId ? '有官方路段' : '無官方路段'} · {categoryNames[row.scope?.category] || ''}{row.id === b.id ? ' · 基準' : ''}</span></li>)}</ul></details></>
      : <FlexExplanation rec={rec} company={company} />}
  </article>;
}

function FlexPage({ data, dates, onInspect, onMethod }) {
  const companies = data.companies?.list || [];
  const defaults = data.companies?.defaults || {};
  const [companyId, setCompanyId] = useState(companies[0]?.id);
  const [baseline, setBaseline] = useState(defaults.baselineStart || '08:30');
  const company = companies.find(item => item.id === companyId) || companies[0];
  const recommendations = useMemo(() => company ? buildFlexRecommendations(company.location, data.directions || [], dates, { baselineMinute: parseMinute(baseline) }) : [], [company, baseline, dates.join(',')]);
  if (!company) return <div className="method-page"><p>尚未設定範本公司。</p></div>;
  const exportFlex = () => {
    const rows = [['公司', '方向', '方位', '基準路段', '方向', 'VDID', '官方路段可驗證', '基準路段塞車分鐘比例%', '塞車時段', '塞車解除時間', '標準上班時間', '建議最晚彈性上班', '比標準晚（分鐘）', '分析天數', '為什麼要增加', '增加基準算式', '增加基準說明'], ...recommendations.map(rec => { const e = flexExplanation(rec, company); return [company.name, rec.name, `${rec.from}°–${rec.to}°`, rec.benchmark?.roadName || '', rec.benchmark ? directionName(rec.benchmark) : '', rec.benchmark?.vdId || '', rec.benchmark ? (rec.verified ? '是' : '否') : '', rec.benchmark ? rec.benchmark.congestedShare.toFixed(1) : '', rec.periods?.filter(period => period.jammed).map(period => minuteText(period.start)).join('、') || '', rec.clearMinute == null ? '' : `${minuteText(rec.clearMinute)}${rec.reachesEnd ? '（觀測結束仍塞）' : ''}`, minuteText(rec.baselineMinute), minuteText(rec.recommendedMinute), rec.extensionMinutes, rec.days || 0, e.why.join(' '), e.formula, e.basis.join(' ')]; })];
    downloadFile(`${company.shortName}_彈性上班建議.csv`, `${String.fromCharCode(0xFEFF)}${rows.map(row => row.map(csvCell).join(',')).join(String.fromCharCode(13, 10))}`, 'text/csv;charset=utf-8');
  };
  return <div className="flex-page">
    <div className="page-intro"><div className="eyebrow">FLEXIBLE START TIME</div><h1>依員工來的方向，<br />建議彈性上班時間。</h1><p>以範本公司為中心分東、南、西、北四個方向，找出每個方向最可能經過的熱門塞車路段，<br className="desktop-only" />依過去的塞車時段推算塞車何時解除，作為彈性上班的建議。</p></div>
    <section className="section-block flex-controls"><div className="section-heading ranking-heading"><div><div className="eyebrow">TEMPLATE COMPANY</div><h2>{company.name}</h2><p>官方住址：{company.location.officialAddress || company.address}（{company.source.title}，出表日期 {company.source.reportDate}）· TDX 地址定位：{company.location.matchedAddress}（{company.location.lat.toFixed(5)}, {company.location.lon.toFixed(5)}）</p></div><div className="ranking-actions">{companies.length > 1 && <label className="date-select"><span className="sr-only">選擇公司</span><select value={company.id} onChange={event => setCompanyId(event.target.value)}>{companies.map(item => <option key={item.id} value={item.id}>{item.shortName}</option>)}</select></label>}<label className="date-select"><span className="sr-only">標準上班時間</span><select aria-label="標準上班時間" value={baseline} onChange={event => setBaseline(event.target.value)}>{baselineChoices.map(choice => <option key={choice} value={choice}>標準上班 {choice}</option>)}</select></label><button className="button button-outline" onClick={exportFlex}><Icon name="download" size={17} />匯出建議 CSV</button></div></div>
      <div className="ranking-caveat"><Badge tone="teal">{dates.length} 個工作日歷史資料</Badge><Badge tone="amber">標準上班時間為示範假設</Badge><span>{defaults.baselineNote}</span></div>
      <div className="flex-overview"><CompanyMap company={company} recommendations={recommendations} directions={data.directions || []} /><div className="table-scroll"><table className="data-table flex-summary"><thead><tr><th scope="col">方向</th><th scope="col">基準熱門塞車路段</th><th scope="col">塞車解除</th><th scope="col">建議最晚彈性上班</th></tr></thead><tbody>{recommendations.map(rec => <tr key={rec.key}><td><span className="sector-dot" style={{ background: sectorColors[rec.key] }} />{rec.name}</td><td>{rec.benchmark ? <><strong>{rec.benchmark.roadName} {directionName(rec.benchmark)}</strong><span className="cell-sub">{rec.verified ? '有官方路段可驗證' : '僅偵測器推算'} · {formatNumber(rec.benchmark.congestedShare)}% 分鐘塞車</span></> : '無候選路段'}</td><td>{rec.clearMinute == null ? '無過半塞車時段' : `${minuteText(rec.clearMinute)}${rec.reachesEnd ? ' 仍塞' : ''}`}</td><td><strong>{minuteText(rec.recommendedMinute)}{rec.reachesEnd ? '+' : ''}</strong><span className="cell-sub">{rec.extensionMinutes ? `${rec.reachesEnd ? '至少 ' : ''}+${rec.extensionMinutes} 分鐘` : '維持標準'}</span></td></tr>)}</tbody></table></div></div></section>
    <div className="direction-grid">{recommendations.map(rec => <DirectionCard key={rec.key} rec={rec} company={company} onInspect={onInspect} />)}</div>
    <section className="method-card live-card" aria-labelledby="live-heading"><div className="section-heading"><div><div className="eyebrow">EVERY 15 MINUTES</div><h2 id="live-heading">每 15 分鐘更新：呼叫哪些 API、做哪些計算</h2></div><Badge tone="amber">營運設計，本版為歷史快照</Badge></div>
      <p>本頁的建議由 {dates.length} 個工作日的歷史資料算出，是「平常日的基準建議」。實際營運時，政府可每 15 分鐘（07:15、07:30 … 09:30）用相同規則更新當天的建議，發布給園區公司：</p>
      <ol className="live-steps"><li><strong>每分鐘取即時資料：</strong><code>GET https://tdx.transportdata.tw/api/basic/v2/Road/Traffic/Live/VD/City/Taipei</code>（臺北市車輛偵測器即時路況，官方更新週期 60 秒），保留各方向基準路段偵測器最近 15 分鐘的紀錄。</li><li><strong>品質檢查與分級：</strong>沿用本專案的逐分鐘品質規則、{SPEED_WINDOW_MINUTES} 分鐘車速與臺北市官方壅塞門檻（<code>GET .../Road/Traffic/CongestionLevel/City/Taipei</code>）。</li><li><strong>官方比對：</strong>有臺北市發布路段的基準路段，同時讀取 <code>GET .../Road/Traffic/Live/City/Taipei</code> 的官方壅塞等級，兩者差異大時人工確認。</li><li><strong>更新規則：</strong>檢查時間 t 的前 15 分鐘，若一半以上分鐘為 {levelLetters(CONGESTED_LEVELS)} 級，表示塞車尚未解除，當天最晚彈性上班改為「歷史建議」與「t + 15 分鐘」較晚者；否則維持歷史建議。</li><li><strong>發布：</strong>以 15 分鐘為單位公布各公司、各方向的最新建議與依據（基準路段、該時段塞車比例）。</li></ol>
      <p className="small-note">歷史建議與即時更新使用同一條「過半時間在塞車」規則，所以每個方向卡片中的「每 15 分鐘檢查點」表格，就是這條規則在過去每一天的模擬結果。即時更新需要在伺服器端保存 TDX 憑證，本版網頁為離線快照，不在瀏覽器中呼叫 API。</p><button className="text-button" onClick={onMethod}>查看彈性上班建議的完整計算方式 <Icon size={16} /></button></section>
  </div>;
}

const referenceApis = [
  { name: 'links', title: '路段編碼基本資料', detail: '每個 LinkID 的官方起點、終點、長度、道路分類', use: '判斷偵測器所在路段從哪裡開到哪裡' },
  { name: 'link-shapes', title: '路段線形（GeoJSON）', detail: '每個 LinkID 的官方道路線形', use: '繪製範圍地圖' },
  { name: 'road-link-shapes', title: '列名道路完整路段與線形', detail: '港墘路、瑞光路等列名道路每個 LinkID 的官方線形', use: '求出兩側門牌都在範圍內的園區內道路區段' },
  { name: 'geocode-000', title: '地址定位（地理編碼）', detail: '門牌 → 官方座標，回傳實際比對到的門牌', use: '把商業處公布的園區門牌範圍轉成座標' },
  { name: 'congestion-levels-taipei', title: '臺北市路況壅塞水準', detail: '各組別以速率劃分的 A–F 級門檻', use: '每分鐘車速分級的依據' },
  { name: 'sections-taipei', title: '臺北市發布路段', detail: '發布路段與 LinkID 的對應', use: '找出可與官方路況比對的路段' },
  { name: 'section-live-taipei', title: '臺北市發布路段即時路況', detail: '各發布路段目前採用的壅塞水準組別', use: '確認每個路段套用哪一組門檻' },
];

function ScopeMethod({ data }) {
  const park = data.meta?.park || {};
  const directions = data.directions || [];
  const categories = data.summary?.categories;
  if (!park.acceptedPoints?.length || !categories) return null;
  const included = directions.filter(direction => direction.scope?.included).sort((a, b) => String(a.scope.category).localeCompare(String(b.scope.category)) || String(a.roadName).localeCompare(String(b.roadName), 'zh-TW'));
  return <section className="method-card" aria-labelledby="scope-heading"><div className="section-heading"><div><div className="eyebrow">02 / PARK SCOPE</div><h2 id="scope-heading">「往園區路段」怎麼判定？</h2></div><Badge tone="teal">官方門牌 + 官方路段幾何</Badge></div>
    <p>園區的官方定義是臺北市商業處公布的「門牌範圍」，不是一條邊界線。所以先把範圍內的門牌用 TDX 地址定位轉成官方座標，投影到 TDX 官方道路線形上，找出同一條路兩側門牌都在範圍內的「園區內道路」；再看每個偵測器所在官方路段的起點與終點，是否落在園區內道路上。判定只用官方資料與道路幾何，與車流量高低無關。</p>
    <div className="scope-method-grid"><ScopeMap directions={directions} park={park} variant="compact" /><div className="formula-grid formula-grid-stack"><div><span>步驟 1 · 園區門牌</span><strong>{formatNumber(park.acceptedPoints?.length)} 個官方園區門牌座標</strong><p>沿官方範圍內的每條路查詢門牌，只採用定位服務回傳的實際門牌仍在官方範圍內的點；{formatNumber(park.rejectedPoints?.length)} 個查詢點的定位結果不在範圍內，未採用。</p></div><div><span>步驟 2 · 園區內道路</span><strong>兩側門牌都在官方範圍內的道路區段（共 {formatNumber((park.stretches || []).reduce((sum, stretch) => sum + stretch.lengthMeters, 0) / 1000)} 公里，雙向分計）</strong><p>官方範圍為「全部」的道路整條計入；有單雙號之分的道路，取單號側與雙號側範圍重疊的區段。內湖路一段（只有雙號）、舊宗路二段（只有單號）等邊界道路，另一側不屬園區，本身不算園區內道路。</p></div><div><span>步驟 3 · 路段位置</span><strong>官方路段起點、終點是否在園區內道路 {park.radiusMeters} 公尺內</strong><p>入園：終點在、起點不在。園區內：都在。出園：起點在、終點不在。園區外／邊界：都不在。官方道路分類為市區快速道路或匝道者（堤頂大道、環東大道）另列，不列入。</p></div><div><span>步驟 4 · 列入排名</span><strong>只排名入園與園區內路段</strong><p>入園 {categories.entering} 個、園區內 {categories.internal} 個方向列入；出園 {categories.leaving} 個、園區外 {categories.outside} 個、市區快速道路 {categories.expressway || 0} 個方向不列入。同 LinkID 多支偵測器只取一支代表。</p></div></div></div>
    {park.boundarySource && <div className="parameter-note"><strong>官方園區範圍原文（{park.boundarySource.maintainer}，資料更新 {park.boundarySource.dataUpdated}、檢視 {park.boundarySource.dataReviewed}）</strong><p>{park.boundarySource.officialText}</p></div>}
    <div className="inline-callout comparison-limit"><Icon name="info" /><p><strong>這是道路幾何判定，不是車輛目的地調查。</strong>入園路段的車在路口也可能直行離開，園區內路段也有穿越車流；偵測器無法追蹤個別車輛。{park.radiusMeters} 公尺是路口容許距離：本次官方路段端點與園區內道路的距離，50 公尺以內者都是同一路口，下一個 95 公尺者經官方路段確認是不同路口。每段的判定與距離都公開在下方清單。</p></div>
    <details className="disclosure"><summary>列入排名的 {included.length} 個方向與判定依據</summary><ul className="failure-list">{included.map(direction => <li key={direction.id}><span className="mono">{direction.vdId}</span><span><strong>{direction.roadName} {directionName(direction)}</strong> · {categoryNames[direction.scope.category]}{direction.isRepresentative === false ? '（同 LinkID 備選，不重複排名）' : ''}：{direction.scope.reason}</span></li>)}</ul></details>
    {park.acceptedPoints?.length > 0 && <details className="disclosure"><summary>園區範圍使用的官方門牌座標（{park.acceptedPoints.length}）與未採用的查詢點（{park.rejectedPoints?.length || 0}）</summary><ul className="failure-list">{park.acceptedPoints.map(point => <li key={point.query}><span className="mono">{point.lat?.toFixed(5)}, {point.lon?.toFixed(5)}</span><span>{point.matchedAddress}（查詢：{point.query}）</span></li>)}{(park.rejectedPoints || []).map(point => <li key={point.query}><span className="mono">未採用</span><span>{point.query} → {point.matchedAddress || '無結果'}：{point.reason}</span></li>)}</ul></details>}
    {park.boundarySource?.url && <a className="source-link" href={park.boundarySource.url} target="_blank" rel="noreferrer">{park.boundarySource.title} <Icon name="external" size={15} /></a>}
  </section>;
}

function CongestionMethod({ data, dates }) {
  const levelSets = data.meta?.congestionLevels || [];
  const validation = data.validation;
  const example = buildCongestionRankings(data.directions || [], dates, { limit: 1 })[0];
  if (!levelSets.length) return null;
  return <section className="method-card" aria-labelledby="congestion-method-heading"><div className="section-heading"><div><div className="eyebrow">04 / CONGESTION</div><h2 id="congestion-method-heading">塞車怎麼算？</h2></div><Badge tone="teal">臺北市官方速率門檻</Badge></div>
    <p>車流量是通過的車次，塞車要看車速。偵測器每分鐘、每車道都提供平均速度 <code>Speed</code>；我們先算出每個方向每分鐘的車速，再用臺北市在 TDX 發布的壅塞水準門檻分級。車速取 {SPEED_WINDOW_MINUTES} 分鐘視窗，是逐分鐘比對臺北市官方路段路況後選定的算法（見下方比對結果）。</p>
    <div className="formula-grid"><div><span>每分鐘車速（{SPEED_WINDOW_MINUTES} 分鐘視窗）</span><strong>Σ(車道 Speed × 車道車次) ÷ Σ 車道車次，取該分鐘與前 {SPEED_WINDOW_MINUTES - 1} 分鐘</strong><p>以車次加權，車多的車道、車多的分鐘影響較大。視窗內只用通過品質檢查的分鐘，該分鐘本身也必須有效；{SPEED_WINDOW_MINUTES} 分鐘內都沒有車通過就沒有車速，不當成順暢也不當成壅塞。</p></div><div><span>每分鐘等級</span><strong>依官方門檻分為 A–F 級</strong><p>下限 ≤ 車速 &lt; 上限。路段若有臺北市發布路段，使用官方指定組別；沒有則用同道路分類的預設組別。</p></div><div><span>塞車排名依據</span><strong>{levelLetters(CONGESTED_LEVELS)} 級分鐘 ÷ 已分級分鐘</strong><p>由高至低排序；同分再比 {levelLetter(SEVERE_LEVEL)} 級（嚴重壅塞）比例，再比平均車速。不設完整度門檻，有效車速分鐘一併列出。</p></div></div>
    {levelSets.map(set => <div className="table-scroll" key={set.CongestionLevelID}><table className="data-table level-table"><caption>{set.CongestionLevelName}（<code>{set.CongestionLevelID}</code>，衡量指標：{set.MeasureIndex === 'Speed' ? '速率' : set.MeasureIndex}）</caption><thead><tr><th scope="col">等級</th>{[...set.Levels].filter(level => level.Level > 0).sort((a, b) => a.Level - b.Level).map(level => <th scope="col" key={level.Level}>{level.LevelName || levelLetter(level.Level)}{CONGESTED_LEVELS.includes(level.Level) ? ' · 壅塞' : ''}</th>)}</tr></thead><tbody><tr><th scope="row">速率 km/h</th>{[...set.Levels].filter(level => level.Level > 0).sort((a, b) => a.Level - b.Level).map(level => <td key={level.Level}>{level.TopValue == null ? `≥ ${level.LowValue}` : `${level.LowValue} – 未滿 ${level.TopValue}`}</td>)}</tr></tbody></table></div>)}
    <div className="inline-callout"><Icon name="info" /><p><strong>門檻是官方的，「{levelLetters(CONGESTED_LEVELS)} 級算塞車」是本專案的定義。</strong>TDX 只公布臺北市各級的速率門檻與 A–F 代號，沒有公布各級的中文名稱或「哪幾級算壅塞」。本專案取速率最低的 {levelLetters(CONGESTED_LEVELS)} 兩級為壅塞分鐘，最低的 {levelLetter(SEVERE_LEVEL)} 級另列為嚴重壅塞；若改變定義，排名會跟著改變。</p></div>
    {example && <div className="actual-rate-example"><strong>本次塞車第一名的實際算式</strong><p>{example.roadName} · {directionName(example)}：{levelLetters(CONGESTED_LEVELS)} 級 {formatNumber(example.congestedMinutes)} 分鐘 ÷ 已分級 {formatNumber(example.classifiedMinutes)} 分鐘 = <strong>{rateFormatter.format(example.congestedShare)}%</strong>；分鐘平均車速 {formatNumber(example.averageSpeed)} km/h。另有 {formatNumber(example.noFlowMinutes)} 分鐘前 {SPEED_WINDOW_MINUTES} 分鐘都沒有車通過，不列入分母。</p></div>}
    {validation?.minutes > 0 && <div className="validation-box"><strong>與臺北市官方發布路段逐分鐘比對</strong><p>臺北市也用同一批偵測器發布路段路況（TDX 發布路段即時路況歷史資料，<code>DataSources.HasVD = 1</code>）。我們把同一分鐘、同一路段的官方壅塞等級與本專案算出的等級逐一比對（官方等級 0「資料不足」不比）：</p><div className="validation-stats"><div><span>比對分鐘</span><strong>{formatNumber(validation.minutes)}</strong><small>{validation.dates.length} 日 · {validation.byDirection.length} 個列入排名的方向</small></div><div><span>等級完全相同</span><strong>{rateFormatter.format(percent(validation.exact, validation.minutes))}%</strong><small>相差一級內 {rateFormatter.format(percent(validation.withinOne, validation.minutes))}%</small></div><div><span>本專案判為壅塞，官方也是</span><strong>{rateFormatter.format(percent(validation.bothCongested, validation.vdCongested))}%</strong><small>{formatNumber(validation.bothCongested)} / {formatNumber(validation.vdCongested)} 分鐘</small></div><div><span>官方判為壅塞，本專案也是</span><strong>{rateFormatter.format(percent(validation.bothCongested, validation.officialCongested))}%</strong><small>平均速度差 {formatNumber(validation.speedAbsDiffSum / validation.minutes)} km/h</small></div></div>{validation.singleMinute?.minutes > 0 && <div className="table-scroll"><table className="data-table level-table"><caption>車速算法與官方等級的一致度（同一批比對分鐘）</caption><thead><tr><th scope="col">算法</th><th scope="col">比對分鐘</th><th scope="col">等級完全相同</th><th scope="col">相差一級內</th><th scope="col">平均速度差</th></tr></thead><tbody><tr><th scope="row">只用當分鐘</th><td>{formatNumber(validation.singleMinute.minutes)}</td><td>{rateFormatter.format(percent(validation.singleMinute.exact, validation.singleMinute.minutes))}%</td><td>{rateFormatter.format(percent(validation.singleMinute.withinOne, validation.singleMinute.minutes))}%</td><td>{formatNumber(validation.singleMinute.speedAbsDiffSum / validation.singleMinute.minutes)} km/h</td></tr><tr><th scope="row">{validation.windowMinutes} 分鐘視窗（採用）</th><td>{formatNumber(validation.minutes)}</td><td>{rateFormatter.format(percent(validation.exact, validation.minutes))}%</td><td>{rateFormatter.format(percent(validation.withinOne, validation.minutes))}%</td><td>{formatNumber(validation.speedAbsDiffSum / validation.minutes)} km/h</td></tr></tbody></table></div>}<p className="small-note">官方路段速度的彙算方式未公開；以同一批分鐘比較，{validation.windowMinutes} 分鐘視窗最接近官方，因此採用。比對結果用來確認本專案分級方式與官方路況一致的程度。同一官方路段有兩支偵測器時（例如內湖路一段西向），官方如何合併未公開，差異較大，請看明細。{validation.missingDates?.length ? `未取得官方路段資料的日期：${validation.missingDates.map(item => shortDate(item.date)).join('、')}。` : ''}園區內部分道路沒有臺北市發布路段，只能用偵測器資料分級。</p></div>}
    <div className="inline-callout comparison-limit"><Icon name="info" /><p><strong>偵測器測的是單一地點的速度，不是整段路的旅行時間。</strong>測點下游路口號誌造成的停等，可能讓測點車速偏低或偏高；{SPEED_WINDOW_MINUTES} 分鐘內都沒有車通過的分鐘（可能是無車，也可能是車輛停住）沒有車速，不列入分母並另行列出。陽光街、瑞湖街、洲子街等園區巷道沒有臺北市發布路段，不知道官方會套用哪一組門檻，本專案使用市區一般道路預設組別；這些巷道較窄、路口密，低車速有一部分可能來自道路條件，而不只是車多。</p></div>
  </section>;
}

function FlexMethod({ data, dates }) {
  const company = data.companies?.list?.[0];
  if (!company) return null;
  const baselineMinute = parseMinute(data.companies.defaults?.baselineStart || '08:30');
  const example = buildFlexRecommendations(company.location, data.directions || [], dates, { baselineMinute }).find(rec => rec.benchmark && rec.verified && rec.clearMinute && !rec.reachesEnd);
  return <section className="method-card" aria-labelledby="flex-method-heading"><div className="section-heading"><div><div className="eyebrow">05 / FLEXIBLE START TIME</div><h2 id="flex-method-heading">彈性上班建議怎麼算？</h2></div><Badge tone="teal">與塞車排名同一套分級</Badge></div>
    <p>目標是讓園區公司知道：從不同方向來的員工，最可能遇到的熱門塞車路段大約幾點才解除，據此給予彈性上班時間，避免同一方向的員工都因塞車遲到。方法不因公司而改變，換一家公司只要換官方住址。</p>
    <ol className="live-steps"><li><strong>公司位置：</strong>官方住址取自臺灣證券交易所 OpenAPI 上市公司基本資料，再以 TDX 地址定位取得座標（{company.shortName}：{company.location.matchedAddress}）。</li><li><strong>四個方向：</strong>以公司為中心，依方位分為北（315°–45°）、東（45°–135°）、南（135°–225°）、西（225°–315°）。</li><li><strong>候選路段：</strong>公司 {formatNumber(CANDIDATE_RADIUS_METERS / 1000)} 公里內的市區道路偵測器路段（不含市區快速道路與匝道，同一 LinkID 只取一支），路段中點落在該方位，且行駛方向會更接近公司（官方路段終點比起點近）。</li><li><strong>基準熱門塞車路段：</strong>候選中塞車分鐘比例最高、且有臺北市官方發布路段可驗證的路段；若該方向都沒有官方路段，取最塞者並標示「僅偵測器推算」。</li><li><strong>15 分鐘時段：</strong>07:00–09:30 切成 10 個 15 分鐘時段，所有分析日合計後，該時段塞車分鐘比例 = {levelLetters(CONGESTED_LEVELS)} 級分鐘 ÷ 已分級分鐘；達一半以上為「塞車時段」。</li><li><strong>建議時間：</strong>最後一個塞車時段的結束時間即塞車解除時間；建議最晚彈性上班 = 標準上班時間與塞車解除時間的較晚者；比標準晚 = 兩者差距。到 09:30 仍塞車時標示「09:30+」。</li></ol>
    <p><strong>為什麼用 50% 與 15 分鐘：</strong>50% 代表該時段「過半時間在塞車」，可以直接解讀；15 分鐘與每 15 分鐘的即時更新同步，公司也方便以 15 分鐘為單位排班。每個方向卡片都列出「為什麼要增加」與「增加基準」算式，並附上每個 15 分鐘時段過半塞車的天數。</p>
    {example && <div className="actual-rate-example"><strong>實際算式：{company.shortName} {example.name}方向</strong><p>基準路段「{example.benchmark.roadName}{directionName(example.benchmark)}」。最後一個塞車時段 {minuteText(example.clearMinute - 15)}–{minuteText(example.clearMinute)}：{formatNumber(example.periods.find(period => period.end === example.clearMinute).congested)} ÷ {formatNumber(example.periods.find(period => period.end === example.clearMinute).classified)} = <strong>{formatNumber(example.periods.find(period => period.end === example.clearMinute).share * 100)}%</strong> ≥ 50%；下一段低於 50%。塞車解除 {minuteText(example.clearMinute)}，標準上班 {minuteText(example.baselineMinute)}，建議最晚彈性上班 {minuteText(example.recommendedMinute)}，晚 {example.extensionMinutes} 分鐘。</p></div>}
    <div className="inline-callout comparison-limit"><Icon name="info" /><p><strong>方向與路線是依方位推估，不是員工實際路徑。</strong>同一方向的員工可能走不同的路；本方法取該方向最可能遇到的熱門塞車路段當基準，讓建議偏向「最晚還在塞車的時間」，以避免多數人遲到。觀測時段只到 09:30；期間含 3 個國定假日（依使用者決定未排除），可能讓塞車比例略低；標準上班時間是示範假設，頁面可切換。</p></div>
  </section>;
}

function FreewayNote() {
  return <section className="method-card" aria-labelledby="freeway-heading"><div className="section-heading"><div><div className="eyebrow">SCOPE DECISION</div><h2 id="freeway-heading">為什麼本版沒有納入國道？</h2></div><Badge tone="amber">MVP 暫不納入</Badge></div>
    <ul className="check-list"><li><Icon name="info" /><span><strong>國道主線以過境車為主。</strong>內湖附近的國道 1 號與汐止五股高架，車流多是汐止、圓山之間的過境車，不能代表往園區的車。</span></li>
      <li><Icon name="info" /><span><strong>匝道去向無法用官方幾何確認。</strong>高公局的堤頂交流道上、下匝道偵測器（例如 <code>VD-N1H-N-18-O-SW-22-堤頂-往舊宗路</code> 與 <code>VD-N1H-N-18-I-EN-1-堤頂</code>），在官方靜態資料中都對應同一個國道主線 LinkID <code>00001A1102020A</code>，無法像市區路段一樣用路段起訖點判斷是否通往園區。</span></li>
      <li><Icon name="info" /><span><strong>下匝道後仍要走市區道路。</strong>依高公局匝道偵測器名稱，下匝道後接往舊宗路、成功路、環東大道等，進園區前還會經過市區道路；那些市區道路有臺北市偵測器，已在本版的範圍判定中。</span></li>
      <li><Icon name="info" /><span><strong>資料格式與品質規則不同。</strong>高公局偵測器資料沒有臺北市資料的車道品質旗標（ErrorDiags），需另訂品質規則。資料量方面，TDX 國道歷史偵測器資料一天約 5 GB（全台）；高公局交通資料庫每分鐘一個檔案約 168 KB，07:00–09:30 一天約 25 MB。</span></li></ul>
    <p className="small-note">下一版若要納入：從高公局交通資料庫取得每分鐘檔，建立匝道與市區道路的對應後，再把國道下匝道列為參考資訊。</p>
    <a className="source-link" href="https://tisvcloud.freeway.gov.tw/" target="_blank" rel="noreferrer">交通部高速公路局交通資料庫 <Icon name="external" size={15} /></a>
  </section>;
}

function SourceInventory({ data }) {
  const byName = new Map((data.referenceSources || []).map(source => [source.name, source]));
  const rows = [
    { org: '交通部 TDX · 臺北市政府', title: '臺北市車輛偵測器（設備、逐分鐘車流歷史）', url: 'https://tdx.transportdata.tw/api/historical/v2/Historical/Road/Traffic/Live/VD/City/Taipei', use: '車次、車速、車道品質旗標' },
    ...(data.validation?.sources?.length ? [{ org: '交通部 TDX · 臺北市政府', title: '臺北市發布路段即時路況歷史資料', url: 'https://tdx.transportdata.tw/api/historical/v2/Historical/Road/Traffic/Live/City/Taipei', use: `官方路段壅塞等級，逐分鐘交叉比對（${data.validation.sources.length} 日）` }] : []),
    ...referenceApis.filter(api => byName.has(api.name)).map(api => ({ org: '交通部 TDX', title: api.title, url: byName.get(api.name).url, use: `${api.use}；取得 ${new Date(byName.get(api.name).fetchedAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false })}` })),
    ...(data.meta?.park?.boundarySource ? [{ org: data.meta.park.boundarySource.maintainer, title: data.meta.park.boundarySource.title, url: data.meta.park.boundarySource.url, use: '園區門牌範圍（官方定義）' }] : []),
    ...(data.companies?.list || []).map(company => ({ org: '臺灣證券交易所', title: `上市公司基本資料（${company.shortName}，出表日期 ${company.source.reportDate}）`, url: company.source.url, use: `範本公司官方住址：${company.location.officialAddress || company.address}` })),
    { org: '行政院人事行政總處', title: '115 年政府行政機關辦公日曆表', url: 'https://www.dgpa.gov.tw/uploads/dgpa/files/202510/115%E5%B9%B4%E8%BE%A6%E5%85%AC%E6%97%A5%E6%9B%86%E8%A1%A8-1.pdf', use: '確認期間內 09/25、09/28、10/09 為放假日；依使用者決定，最小版本仍納入分析' },
  ];
  return <section className="method-card" aria-labelledby="inventory-heading"><div className="section-heading"><div><div className="eyebrow">DATA INVENTORY</div><h2 id="inventory-heading">本版使用的所有資料來源</h2></div><Badge tone="teal">{rows.length} 項</Badge></div><div className="table-scroll"><table className="data-table inventory-table"><thead><tr><th scope="col">提供單位</th><th scope="col">資料</th><th scope="col">用途</th></tr></thead><tbody>{rows.map(row => <tr key={row.url}><td>{row.org}</td><td><strong>{row.title}</strong><code className="cell-sub">{row.url}</code></td><td>{row.use}</td></tr>)}</tbody></table></div><p className="small-note">參考資料以 <code>npm run data:reference</code> 下載，原始回應與 SHA-256 存於本機 <code>research/reference</code>；官方路段路況以 <code>npm run data:sections</code> 下載。國道（高速公路局）偵測器已評估、本版不列入，理由見上方「為什麼本版沒有納入國道？」。</p></section>;
}

function MethodPage({ data, dates }) {
  const coverage = data.coverage || {};
  const sources = data.sources || [];
  const sample = data.sample || {};
  const comparisonExample = buildObservedRankings(data.directions || [], dates, { limit: 1 })[0];
  const example = sample.dynamic || sample.live || data.directions?.flatMap(direction => direction.days || []).find(day => day.example)?.example;
  const staticPath = 'https://tdx.transportdata.tw/api/historical/v2/Historical/Road/Traffic/VD/City/Taipei';
  const livePath = 'https://tdx.transportdata.tw/api/historical/v2/Historical/Road/Traffic/Live/VD/City/Taipei';
  return <div className="method-page">
    <div className="page-intro"><div className="eyebrow">SOURCES & METHODOLOGY</div><h1>每個數字，都有來處。</h1><p>從政府 API 到路段排名，公開資料來源、計算方式與目前的限制。<br className="desktop-only" />你可以把結果一路核對回每一分鐘的實際紀錄。</p></div>
    <div className="method-overview"><div><span className="step-num">01</span><strong>園區與路段</strong><p>官方門牌範圍、官方路段幾何</p></div><Icon /><div><span className="step-num">02</span><strong>逐分鐘實測</strong><p>每車道車次與車速</p></div><Icon /><div><span className="step-num">03</span><strong>品質檢查</strong><p>排除缺漏與異常資料</p></div><Icon /><div><span className="step-num">04</span><strong>兩種排名</strong><p>車流量與塞車各取前十</p></div></div>
    <section className="method-card" aria-labelledby="api-heading"><div className="section-heading"><div><div className="eyebrow">01 / DATA SOURCE</div><h2 id="api-heading">我們呼叫哪些 API？</h2></div><Badge tone="teal">交通部 TDX</Badge></div><p>使用同一日期的設備資料與歷史車流，依 <code>VDID</code>、<code>LinkID</code> 配對。設備資料說明測點位置、車道數與行車方向；歷史車流 API 提供當時每分鐘的流量與車速。</p>
      <div className="api-entry"><div className="api-entry-title"><Badge tone="teal">GET</Badge><h3>歷史設備資料</h3><span>位置、路名、方向、車道數</span></div><code className="endpoint">{staticPath}</code><p><code>TownName</code> 選出內湖區，並以 <code>DetectionLinks</code> 的方向與車道設定對應實測。</p></div>
      <div className="api-entry"><div className="api-entry-title"><Badge tone="teal">GET</Badge><h3>歷史車流資料</h3><span>一分鐘、各車道、各車種的流量</span></div><code className="endpoint">{livePath}</code><p>讀取 <code>DataCollectTime</code>、<code>LinkFlows</code>、<code>Lanes</code>、<code>Vehicles[].Volume</code>，並檢查設備狀態與車道品質。</p></div>
      {data.validation?.sources?.length > 0 && <div className="api-entry"><div className="api-entry-title"><Badge tone="teal">GET</Badge><h3>臺北市發布路段即時路況歷史資料</h3><span>官方路段旅行速度與壅塞等級</span></div><code className="endpoint">https://tdx.transportdata.tw/api/historical/v2/Historical/Road/Traffic/Live/City/Taipei</code><p>讀取 <code>SectionID</code>、<code>TravelSpeed</code>、<code>CongestionLevel</code>、<code>DataCollectTime</code>，只保留內湖測點對應路段的 07:00–09:30 紀錄，用來逐分鐘比對塞車分級。</p></div>}
      {(data.referenceSources || []).length > 0 && <div className="api-entry"><div className="api-entry-title"><Badge tone="teal">GET / POST</Badge><h3>官方參考資料</h3><span>園區範圍、路段幾何、壅塞門檻</span></div><ul className="failure-list">{referenceApis.map(api => { const source = data.referenceSources.find(item => item.name === api.name); return source ? <li key={api.name}><span><strong>{api.title}</strong></span><span><code>{source.method} {source.url}</code> · {api.detail}</span></li> : null; })}</ul></div>}
      <div className="parameter-note"><strong>下載參數</strong><p><code>Dates=YYYY-MM-DD</code> 指定日期，<code>$format=JSONL</code> 保存逐行 JSON。<code>$top</code> 設足量上限並記錄回傳筆數，避免把預覽資料當成全日資料。下載後再依臺北時間篩選早上時段。</p></div>
      <a className="source-link" href="https://tdx.transportdata.tw/api-service/swagger/basic/7f07d940-91a4-495d-9465-1c9df89d709c#/Traffic-City/VD_City" target="_blank" rel="noreferrer">查看 TDX 車輛偵測器 API 文件 <Icon name="external" size={15} /></a>
    </section>
    <ScopeMethod data={data} />
    <section className="method-card" aria-labelledby="calculation-heading"><div className="eyebrow">03 / VOLUME</div><h2 id="calculation-heading">車流量如何算出來？</h2><p>每分鐘的 <code>Volume</code> 是該車道、該車種的通過車次。我們使用實測計數逐筆累加；不同路口的測點各自比較，同一路段不把前後測點相加。</p>
      <div className="formula-grid"><div><span>單一方向，一分鐘</span><strong>所有車道、所有車種的 Volume 相加</strong><p>每筆只計一次，保留各車道原始計數。</p></div><div><span>有效部分的實測累計</span><strong>所選日期所有有效分鐘車次相加</strong><p>缺漏與異常分鐘不累計，也不計入平均值的分母。</p></div><div><span>主排名依據</span><strong>實測累計車次 ÷ 有效分鐘數</strong><p>比較每有效分鐘平均車次，取前十；不乘 150，也不推估完整早晨或整月總量。</p></div></div>
      {comparisonExample && <div className="actual-rate-example"><strong>本次排名的實際算式</strong><p>{comparisonExample.roadName} · {directionName(comparisonExample)}：{formatNumber(comparisonExample.totalObservedVolume)} 實測車次 ÷ {formatNumber(comparisonExample.validMinutes)} 有效分鐘 = <strong>{rateFormatter.format(comparisonExample.averageMinuteVolume)} 車次／分</strong>。這只代表有有效觀測的分鐘，不是完整時段總量。</p></div>}
      <div className="inline-callout comparison-limit"><Icon name="info" /><p><strong>各方向的有效時刻可能不同，排名可能受缺漏影響。</strong>缺漏若集中在尖峰，平均值可能偏低或偏高。這是各方向現有有效分鐘的實測比較，不能稱為完整月或完整 07:00–09:30 的車流量；不把平均值乘以 150 補足缺漏。</p></div><div className="inline-callout"><Icon name="info" /><p><strong>是通過車次，不是不同車輛數，也不是塞車程度。</strong>偵測器無法辨識車輛最後是否進入園區。「往園區」需由測點位置、道路連接與行車方向另行判定。</p></div>
      {sample.calculation && <details className="disclosure"><summary>查看本次資料的實際計算範例</summary><pre>{pretty(sample.calculation)}</pre></details>}
      <a className="source-link" href="https://www.motc.gov.tw/ch/app/data/doc?aplistdn=&detailNo=2&id=2737&module=bussiness&preview=&serno=201804270001&type=s" target="_blank" rel="noreferrer">交通部交通資料標準 <Icon name="external" size={15} /></a>
    </section>
    <CongestionMethod data={data} dates={dates} />
    <FlexMethod data={data} dates={data.coverage?.availableDates || dates} />
    <FreewayNote />
    <div className="method-two-columns"><section className="method-card"><div className="eyebrow">06 / QUALITY</div><h2>什麼資料可以進入排名？</h2><ul className="check-list"><li><Icon name="check" />同一測點、方向與分鐘先去重；計數衝突的紀錄排除。</li><li><Icon name="check" />設備狀態正常，流量為有效非負數。</li><li><Icon name="check" />車道編號不重複，車道數符合當日設備設定。</li><li><Icon name="check" />全部車道通過目前的保守品質旗標檢查。</li><li><Icon name="check" />至少有一個有效分鐘，合格計數才加入累計與平均值分母。</li><li><Icon name="check" />同一 LinkID 的多支測點不重複列入排名。</li></ul><p className="small-note">非正常旗標代表需要檢查，不等於已證明所有計數都錯誤。此版本逐分鐘保守排除，並公開原因；完整 150 分鐘為另外呈現的嚴格診斷，不是主排名的必要條件。</p><a className="source-link" href="https://motc-traffic.gitbook.io/motc-traffic/ji-chu-jian-he-1/yi-chang-dai-ma-shui-ming" target="_blank" rel="noreferrer">查看官方異常代碼說明 <Icon name="external" size={15} /></a></section>
    <section className="method-card"><div className="eyebrow">07 / TIME & SCOPE</div><h2>日期、時間與地理範圍</h2><dl className="method-dl"><div><dt>分析日期</dt><dd>{shortDate(data.meta?.requestedStart)} — {shortDate(data.meta?.requestedEnd)}</dd></div><div><dt>工作日定義</dt><dd>週一至週五，排除週六、週日；未額外排除國定假日。</dd></div><div><dt>每日時段</dt><dd>07:00–09:30 · Asia/Taipei</dd></div><div><dt>目前篩選</dt><dd><code>07:00 ≤ DataCollectTime &lt; 09:30</code>，即 07:00 至 09:29 的 150 個分鐘標記。</dd></div><div><dt>時間邊界</dt><dd>{data.meta?.boundaryNote || '依 DataCollectTime 分鐘標記篩選；標記代表區間起點或終點仍待官方確認。'}</dd></div><div><dt>道路範圍</dt><dd>{data.meta?.geographyNote || '僅內湖區內往內湖科技園區的方向。初選方向會標示判定理由，未經核對的方向不當成已確認事實。'}</dd></div></dl>{data.meta?.park?.sources?.length > 0 && <details className="disclosure"><summary>園區範圍與道路方向的核對來源</summary><p className="small-note">{data.meta.park.notes}</p><ul className="geography-sources">{data.meta.park.sources.map(source => <li key={source.url}><a className="source-link" href={source.url} target="_blank" rel="noreferrer">{source.title}<Icon name="external" size={13} /></a></li>)}</ul></details>}</section></div>
    <section className="method-card" aria-labelledby="coverage-heading"><div className="section-heading"><div><div className="eyebrow">08 / COMPLETENESS</div><h2 id="coverage-heading">這份快照涵蓋哪些日期？</h2></div><Badge tone={coverage.status === 'complete' ? 'teal' : 'amber'}>{coverage.status === 'complete' ? '下載完成' : '尚未涵蓋整月'}</Badge></div><p className="small-note">已下載 {(coverage.availableDates || []).length} / {(coverage.requestedDates || []).length} 日；待下載 {(coverage.pendingDates || []).length} 日，下載失敗 {(coverage.failedDates || []).length} 日。</p><p className="small-note">每方向目標為 {(coverage.requestedDates || []).length} 日 × 150 = {formatNumber((coverage.requestedDates || []).length * expectedMinutes)} 分鐘；已取得日期的完整基準為 {(coverage.availableDates || []).length} 日 × 150 = {formatNumber((coverage.availableDates || []).length * expectedMinutes)} 分鐘。主排名分母使用各方向實際通過品質檢查的分鐘數。</p><div className="date-grid">{(coverage.requestedDates || []).map(date => { const available = (coverage.availableDates || []).includes(date); const failed = (coverage.failedDates || []).find(item => (typeof item === 'string' ? item : item.date) === date); return <div key={date} className={`date-tile ${available ? 'date-available' : ''}`} title={failed?.reason || (available ? '原始資料已下載' : '尚無可用原始資料')}><span>{shortDate(date).slice(5)}</span><span>{available ? '已下載' : failed ? '未取得' : '待補齊'}</span></div>; })}</div><p className="small-note">「已下載」表示有可處理的原始資料，方向是否合格仍需個別檢查。缺少的日期不補零、不插值，也不以單日結果稱作整月結果。</p>{coverage.failedDates?.length > 0 && <details className="disclosure"><summary>查看尚未完成的日期與原因（{coverage.failedDates.length}）</summary><ul className="failure-list">{coverage.failedDates.map((item, index) => <li key={item.date || index}><span className="mono">{item.date || item}</span><span>{item.reason || '下載未完成'}</span></li>)}</ul></details>}</section>
    <section className="method-card" aria-labelledby="evidence-heading"><div className="eyebrow">09 / RAW EVIDENCE</div><h2 id="evidence-heading">原始資料與下載紀錄</h2><p>每次下載記錄來源網址、下載時間與 SHA-256，以便比對原始檔。這裡的範例直接取自這份快照的實際資料。</p>{example ? <details className="disclosure" open><summary>實際歷史車流 JSON 範例</summary><pre>{pretty(example)}</pre></details> : <p className="small-note">此快照尚無原始範例，請完成資料更新後再次查看。</p>}{sample.static && <details className="disclosure"><summary>對應的設備資料範例</summary><pre>{pretty(sample.static)}</pre></details>}
      {sources.map((source, index) => <details className="disclosure source-record" key={`${source.date}-${index}`}><summary>{source.date || `來源 ${index + 1}`} · API 查詢與檔案證據</summary><dl className="method-dl"><div><dt>設備 API</dt><dd><code>{source.staticUrl || staticPath}</code></dd></div><div><dt>車流 API</dt><dd><code>{source.liveUrl || livePath}</code></dd></div><div><dt>原始檔</dt><dd className="mono">{source.rawFile || '見本機 research 資料夾'}</dd></div><div><dt>下載時間</dt><dd>{source.downloadedAt || '來源清單未提供'}</dd></div><div><dt>完整性說明</dt><dd>{source.integrityNote || "此檔案可依記錄的 SHA-256 核對。"}</dd></div><div><dt>靜態資料雜湊</dt><dd className="mono">{source.staticSHA256 || "見本機下載紀錄"}</dd></div><div><dt>早晨資料雜湊</dt><dd className="mono">{source.morningSHA256 || "見本機下載紀錄"}</dd></div><div><dt>SHA-256</dt><dd className="mono">{typeof source.sha256 === 'object' ? pretty(source.sha256) : source.sha256 || '見本機來源清單'}</dd></div></dl></details>)}
    </section>
    <SourceInventory data={data} />
    <section className="offline-card"><div className="offline-icon"><Icon name="document" size={28} /></div><div><div className="eyebrow">LOCAL FIRST</div><h2>可以離線打開，憑證留在你的電腦。</h2><p>這個頁面讀取 build 時封裝的資料快照，打開 <code>dist/index.html</code> 即可瀏覽。瀏覽器不呼叫 TDX，也不需要輸入 Client Secret。</p><p>資料更新由本機腳本完成：<code>npm run data:update</code>，再執行 <code>npm run build</code>。憑證只放本機環境設定；Git 與 dist 都不應包含憑證或 Token。</p></div></section>
  </div>;
}

function DirectionDialog({ direction, dates, onClose }) {
  useEffect(() => { if (!direction) return undefined; const previous = document.activeElement; const handler = event => { if (event.key === 'Escape') onClose(); }; document.addEventListener('keydown', handler); const overflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; document.getElementById('dialog-close')?.focus(); return () => { document.removeEventListener('keydown', handler); document.body.style.overflow = overflow; previous?.focus(); }; }, [direction, onClose]);
  if (!direction) return null;
  const days = getDays(direction, dates);
  return <div className="dialog-backdrop" onClick={event => { if (event.target === event.currentTarget) onClose(); }}><section className="direction-dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title" onKeyDown={event => { if (event.key !== 'Tab') return; const items = [...event.currentTarget.querySelectorAll('button,a,input,select,summary,[tabindex="0"]')].filter(element => !element.disabled); if (!items.length) return; if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1).focus(); } else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0].focus(); } }}><div className="dialog-heading"><div><div className="eyebrow">DETECTOR DETAIL</div><h2 id="dialog-title">{direction.roadName} <span>{directionName(direction)}</span></h2><p className="mono">{direction.vdId} · LinkID {direction.linkId}</p></div><button id="dialog-close" className="icon-button" onClick={onClose} aria-label="關閉測點明細"><Icon name="close" /></button></div><div className="dialog-content"><div className="scope-explanation"><Badge tone={direction.scope?.included ? 'teal' : 'neutral'}>{direction.scope?.category ? `${categoryNames[direction.scope.category]} · ${direction.scope.included ? '列入排名' : '不列入排名'}` : direction.scope?.included ? '園區方向初選' : '未納入範圍'}</Badge><p>{direction.scope?.reason || '此方向的判定依據待補充。'}</p>{direction.scope?.included && direction.representativeId && <p className="small-note">此 LinkID 的代表測點：<span className="mono">{direction.representativeId}</span>。{direction.isRepresentative === false ? '本測點為同路段備選，不重複列入排名。' : '依預先設定的優先序選定，與車流量高低無關。'}</p>}</div><dl className="detail-grid"><div><dt>座標</dt><dd>{direction.position?.lat ?? '—'}, {direction.position?.lon ?? '—'}</dd></div><div><dt>可偵測車道數（靜態）</dt><dd>{direction.laneCount ?? '—'} 車道</dd></div><div><dt>道路實際車道數（靜態）</dt><dd>{direction.actualLaneCount ?? '來源未提供'}</dd></div><div><dt>範圍判定方式</dt><dd>{direction.scope?.status === 'geometry' ? '官方路段起訖點 × 官方門牌範圍' : direction.scope?.status === 'override' ? '人工例外（附理由）' : direction.scope?.status === 'reviewed' ? '已核對' : direction.scope?.included ? '待人工核對' : '未納入'}</dd></div>{direction.geometry && <><div><dt>官方路段</dt><dd>長 {formatNumber(direction.geometry.length * 1000)} 公尺 · {direction.geometry.roadClassName}</dd></div><div><dt>壅塞水準組別</dt><dd><span className="mono">{direction.geometry.congestionLevelId || '無'}</span>{direction.geometry.sectionId && <> · 官方路段 <span className="mono">{direction.geometry.sectionId}</span></>}</dd></div></>}{(() => { const row = buildCongestionRankings([{ ...direction, scope: { ...direction.scope, included: true } }], dates, { limit: 1 })[0]; return row ? <div><dt>所選日期壅塞</dt><dd>{levelLetters(CONGESTED_LEVELS)} 級 {rateFormatter.format(row.congestedShare)}% · 平均 {formatNumber(row.averageSpeed)} km/h</dd></div> : null; })()}</dl><h3>逐日有效分鐘</h3><div className="daily-cards">{dates.map(date => { const day = days.find(item => item.date === date); return <div key={date} className="daily-detail"><div className="daily-title"><strong>{shortDate(date)}</strong><Badge tone={day?.validMinutes === expectedMinutes ? 'teal' : 'amber'}>{day?.validMinutes === expectedMinutes ? '分鐘完整' : day ? '有待檢查' : '缺少資料'}</Badge></div><div className="daily-metrics"><span>收到 <strong>{day?.receivedMinutes ?? 0}</strong> 分鐘</span><span>有效 <strong>{day?.validMinutes ?? 0}</strong> / 150 分鐘</span>{day?.levelMinutes && <span>壅塞 <strong>{CONGESTED_LEVELS.reduce((sum, level) => sum + (day.levelMinutes[level] || 0), 0)}</strong> / {day.speedMinutes} 分鐘</span>}{day?.speedMinutes > 0 && <span>平均 <strong>{formatNumber(day.speedSum / day.speedMinutes)}</strong> km/h</span>}</div>{day?.levelMinutes && <LevelBar levelMinutes={day.levelMinutes} total={Object.values(day.levelMinutes).reduce((sum, count) => sum + count, 0)} />}<p className="small-note">有效分鐘累計：{day?.volume == null ? '未提供' : `${formatNumber(day.volume)} 車次`}{day?.validMinutes !== expectedMinutes && '（僅為有效部分，不作完整時段總量）'}</p>{day?.reasonCounts && <ul className="reason-list">{Object.entries(day.reasonCounts).filter(([, value]) => Number(value) > 0).map(([reason, count]) => <li key={reason}><span>{reasons[reason] || reason}</span><strong>{count}</strong></li>)}</ul>}</div>; })}</div><p className="small-note">同一分鐘可能觸發多個異常原因，所以各原因次數相加可能超過無效分鐘數。範例時間若以 +00:00 或 Z 表示，轉為臺北時間需加 8 小時；日期篩選均使用 Asia/Taipei。</p>{days.find(day => day.example)?.example && <details className="disclosure"><summary>查看此測點計數範例</summary><pre>{pretty(days.find(day => day.example).example)}</pre></details>}</div></section></div>;
}

export default function App() {
  const pageFromHash = () => ({ '#methodology': 'methodology', '#flex': 'flex', '#ranking': 'ranking' })[window.location.hash] || 'dashboard';
  const [page, setPage] = useState(pageFromHash);
  const [dateSelection, setDateSelection] = useState('all');
  const [showAll, setShowAll] = useState(false);
  const [inspected, setInspected] = useState(null);
  const data = snapshot;
  const directions = data.directions || [];
  const coverage = data.coverage || {};
  const availableDates = unique(coverage.availableDates || []).sort();
  const selectedDates = dateSelection === 'all' ? availableDates : [dateSelection];
  const rankings = useMemo(() => {
    const result = buildObservedRankings(directions, selectedDates, { limit: Infinity });
    return (Array.isArray(result) ? result : result?.rankings || []).map(row => ({ ...directions.find(direction => direction.id === (row.id || row.directionId) || (row.vdId && direction.vdId === row.vdId && direction.linkId === row.linkId)), ...row.direction, ...row }));
  }, [directions, dateSelection]);
  const strictRankings = useMemo(() => buildRankings(directions, selectedDates, { limit: Infinity }), [directions, dateSelection]);
  const congestionRankings = useMemo(() => buildCongestionRankings(directions, selectedDates, { limit: Infinity }), [directions, dateSelection]);
  const hasCongestion = directions.some(direction => direction.days?.some(day => day.levelMinutes));
  const targetExpectedMinutes = (dateSelection === 'all' ? (coverage.requestedDates?.length || 0) : selectedDates.length) * expectedMinutes;
  const inScope = directions.filter(direction => direction.scope?.included);
  const requestedCount = coverage.requestedDates?.length || 0;
  useEffect(() => { document.title = data.meta?.title || '內湖園區搞清楚要走的路'; const handler = () => setPage(pageFromHash()); window.addEventListener('hashchange', handler); return () => window.removeEventListener('hashchange', handler); }, []);
  const navigate = target => { setPage(target); window.location.hash = target; window.scrollTo({ top: 0, behavior: 'instant' }); };
  const inspect = direction => setInspected(directions.find(item => item.id === direction.id) || direction);
  const exportCongestion = () => {
    const rows = [['排名', '道路', '方向', '路段分類', 'VDID', 'LinkID', `壅塞分鐘比例%（${levelLetters(CONGESTED_LEVELS)}級）`, '壅塞分鐘', `嚴重壅塞比例%（${levelLetter(SEVERE_LEVEL)}級）`, '嚴重壅塞分鐘', '已分級分鐘', '平均車速km/h', '有車速分鐘', '無車通過分鐘', ...[1, 2, 3, 4, 5, 6].map(level => `${levelLetter(level)}級分鐘`), '壅塞水準組別', '分析日期'], ...congestionRankings.slice(0, 10).map((row, index) => [index + 1, row.roadName, directionName(row), categoryNames[row.scope?.category] || '', row.vdId, row.linkId, row.congestedShare.toFixed(2), row.congestedMinutes, row.severeShare.toFixed(2), row.severeMinutes, row.classifiedMinutes, row.averageSpeed.toFixed(1), row.speedMinutes, row.noFlowMinutes, ...[1, 2, 3, 4, 5, 6].map(level => row.levelMinutes[level] || 0), row.geometry?.congestionLevelId || '', selectedDates.join('、')])];
    downloadFile('內湖園區_塞車排名.csv', `${String.fromCharCode(0xFEFF)}${rows.map(row => row.map(csvCell).join(',')).join(String.fromCharCode(13, 10))}`, 'text/csv;charset=utf-8');
  };
  const exportRankings = () => {
    const rows = [['排名', '道路', '方向', 'VDID', 'LinkID', '每有效分鐘平均車次', '有效分鐘', '可用日期應有分鐘', '可用日期完整度%', '要求期間應有分鐘', '要求期間完整度%', '實測累計車次', '有實測資料日期數', '分析日期'], ...rankings.slice(0, 10).map((row, index) => [index + 1, row.roadName, directionName(row), row.vdId, row.linkId, row.averageMinuteVolume.toFixed(2), row.validMinutes, row.expectedMinutes, row.qualityPercentage, targetExpectedMinutes, targetExpectedMinutes ? row.validMinutes / targetExpectedMinutes * 100 : 0, row.totalObservedVolume, row.observedDays, selectedDates.join('、')])];
    downloadFile('內湖園區_車流排名.csv', `\uFEFF${rows.map(row => row.map(csvCell).join(',')).join('\r\n')}`, 'text/csv;charset=utf-8');
  };
  return <><a className="skip-link" href="#main-content">跳至主要內容</a><header className="site-header"><div className="header-inner"><a className="brand" href="#dashboard" onClick={event => { event.preventDefault(); navigate('dashboard'); }} aria-label="內湖園區搞清楚要走的路，回到總覽"><span className="brand-mark"><svg width="23" height="28" viewBox="0 0 23 28" fill="none" aria-hidden="true"><path d="M4 25V13a5 5 0 0 1 5-5h9M11 25V17a2 2 0 0 1 2-2h5" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/><path d="m14 3 5 5-5 5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/></svg></span><span>內湖園區<span className="brand-subtitle">搞清楚要走的路</span></span></a><nav className="main-nav" aria-label="主要導覽"><button onClick={() => navigate('dashboard')} className={page === 'dashboard' ? 'active' : ''} aria-current={page === 'dashboard' ? 'page' : undefined}><Icon name="chart" size={18} />總覽</button><button onClick={() => navigate('ranking')} className={page === 'ranking' ? 'active' : ''} aria-current={page === 'ranking' ? 'page' : undefined}><Icon name="chart" size={18} />車流觀測</button><button onClick={() => navigate('flex')} className={page === 'flex' ? 'active' : ''} aria-current={page === 'flex' ? 'page' : undefined}><Icon name="clock" size={18} />彈性上班建議</button><button onClick={() => navigate('methodology')} className={page === 'methodology' ? 'active' : ''} aria-current={page === 'methodology' ? 'page' : undefined}><Icon name="document" size={18} />資料來源與計算</button></nav><span className="local-indicator"><i />{LIVE_MODE ? '每 15 分鐘更新' : '本機資料快照'}</span></div></header>
    <main id="main-content" className="main-shell">{page === 'dashboard' ? <DashboardPage data={data} dates={availableDates} onInspect={inspect} onNavigate={navigate} /> : page === 'methodology' ? <MethodPage data={data} dates={selectedDates} /> : page === 'flex' ? <FlexPage data={data} dates={availableDates} onInspect={inspect} onMethod={() => navigate('methodology')} /> : <>
      <section className="hero"><div className="hero-copy"><div className="eyebrow"><span className="eyebrow-line" />NEIHU MORNING TRAFFIC</div><h1>早上的車流與塞車，<br />從資料看清楚。</h1><p>只看駛入或位於內湖科技園區的路段，<br />分別比較每有效分鐘車次與壅塞分鐘比例。</p><div className="hero-meta"><span><Icon name="clock" size={16} />07:00–09:30</span><span><Icon name="location" size={16} />往內湖科技園區路段</span><span>週一至週五</span></div></div><ScopeMap directions={directions} park={data.meta?.park} /></section>
      <CoverageNotice coverage={coverage} onMethod={() => navigate('methodology')} />
      <section className="stats-grid" aria-label="觀測概況"><StatCard label="可分析日期" value={selectedDates.length} unit="日" detail={`目標期間共 ${requestedCount} 個週一至週五`} /><StatCard label="內湖區偵測設備" value={data.summary?.stations ?? unique(directions.map(direction => direction.vdId)).length} unit="支" detail={`共 ${directions.length} 個行車方向`} /><StatCard label="往園區路段" value={inScope.length} unit="個" detail={data.summary?.categories ? `入園 ${data.summary.categories.entering} · 園區內 ${data.summary.categories.internal} · ${data.summary.representativeDirections} 個代表方向` : `${data.summary?.representativeDirections ?? inScope.filter(direction => direction.isRepresentative !== false).length} 個代表方向，避免同路段重複`} /><StatCard label="有實測資料可比較" value={rankings.length} unit="個" detail={`嚴格完整資料：${strictRankings.length} 個方向符合`} accent /></section>
      <ParkExtent park={data.meta?.park} directions={directions} onMethod={() => navigate('methodology')} />
      <section className="section-block ranking-section" aria-labelledby="ranking-heading"><div className="section-heading ranking-heading"><div><div className="eyebrow">MORNING FLOW RANKING</div><h2 id="ranking-heading">車流量 Top 10 <span className="heading-suffix">往內湖科技園區路段</span></h2><p>依 07:00–09:30 現有有效分鐘的平均車次排序；各路段缺漏情況一併呈現。</p></div><div className="ranking-actions"><label className="date-select"><span className="sr-only">選擇分析日期</span><select value={dateSelection} onChange={event => setDateSelection(event.target.value)}><option value="all">所有已下載日期（{availableDates.length} 日）</option>{availableDates.map(date => <option key={date} value={date}>{shortDate(date)}</option>)}</select></label><button className="button button-outline" onClick={exportRankings} disabled={!rankings.length} title={!rankings.length ? '目前沒有合格排名可匯出，可下載完整分析 JSON' : '匯出目前排名'}><Icon name="download" size={17} />匯出 CSV</button></div></div>
      <div className="ranking-caveat"><Badge tone="teal">有效分鐘實測比較</Badge><Badge tone="amber">{data.summary?.categories ? '官方路段幾何判定範圍' : '方向初選，待複核'}</Badge><span>依 DataCollectTime 標記篩選，統計區間起訖語義待確認；邊界可能差一分鐘。</span></div><div className="range-caption"><span className="range-dot" />目標期間 {shortDate(data.meta?.requestedStart)} — {shortDate(data.meta?.requestedEnd)}<span className="range-divider" /><span>目前分析 {selectedDates.length ? selectedDates.map(shortDate).join('、') : '尚無可用日期'}</span></div>
      {rankings.length > 0 ? <><RankingTable rankings={rankings} targetExpectedMinutes={targetExpectedMinutes} onInspect={inspect} /><p className="ranking-footnote">平均值 = 實測累計車次 ÷ 有效分鐘。各方向有效時刻不同，尖峰缺漏可能影響名次；這不是完整時段或整月總車流，也不乘以 150 推估缺漏。</p></> : <div className="ranking-empty"><div className="empty-graphic"><Icon name="chart" size={35} /></div><div><Badge tone="amber">尚無有效計數</Badge><h3>所選日期沒有可比較的有效分鐘</h3><p>未收到或未通過品質檢查的紀錄不當作零車流。可在下方查看資料完整度與排除原因。</p></div></div>}</section>
      {hasCongestion && <section className="section-block ranking-section congestion-section" aria-labelledby="congestion-heading"><div className="section-heading ranking-heading"><div><div className="eyebrow">MORNING CONGESTION RANKING</div><h2 id="congestion-heading">塞車 Top 10 <span className="heading-suffix">往內湖科技園區路段</span></h2><p>依臺北市官方壅塞水準門檻，把每分鐘車速分成 A–F 級，比較 {levelLetters(CONGESTED_LEVELS)} 級分鐘所占比例。</p></div><div className="ranking-actions"><button className="button button-outline" onClick={exportCongestion} disabled={!congestionRankings.length}><Icon name="download" size={17} />匯出塞車 CSV</button></div></div>
        <div className="ranking-caveat"><Badge tone="teal">官方速率門檻</Badge><Badge tone="amber">壅塞＝{levelLetters(CONGESTED_LEVELS)} 級（本專案定義）</Badge><span>車流量高不代表塞車；塞車路段的車速低，通過車次反而可能較少。日期篩選與上方車流量排名共用。</span></div>
        {congestionRankings.length > 0 ? <><CongestionTable rankings={congestionRankings} onInspect={inspect} validation={data.validation} /><p className="ranking-footnote">每分鐘車速取該分鐘與前 {SPEED_WINDOW_MINUTES - 1} 分鐘的車次加權平均（與臺北市官方路段速度最接近的算法）；壅塞分鐘比例 = {levelLetters(CONGESTED_LEVELS)} 級分鐘 ÷ 已分級分鐘，同比例再比 {levelLetter(SEVERE_LEVEL)} 級比例與平均車速。色條由左至右為 A 到 F 級。沒有臺北市發布路段的園區巷道只能用預設門檻，無法與官方比對。</p></> : <div className="ranking-empty"><div className="empty-graphic"><Icon name="chart" size={35} /></div><div><Badge tone="amber">尚無車速資料</Badge><h3>所選日期沒有可分級的車速分鐘</h3><p>沒有車通過或未通過品質檢查的分鐘不會被當成順暢或壅塞。</p></div></div>}</section>}
      <section className="section-block completeness-section" aria-labelledby="completeness-heading"><div className="section-heading"><div><div className="eyebrow">VALIDATION & COMPLETENESS</div><h2 id="completeness-heading">資料驗證與完整度</h2><p>現有資料可以比較；完整期間仍有缺口，以下逐項公開。</p></div></div><CompletenessDiagnostics dates={selectedDates} directions={directions} coverage={coverage} strictCount={strictRankings.length} onInspect={inspect} onMethod={() => navigate('methodology')} /></section>
      <QualityTable directions={directions} dates={selectedDates} onInspect={inspect} showAll={showAll} setShowAll={setShowAll} />
      <section className="transparency-strip"><div className="transparency-icon"><Icon name="document" size={25} /></div><div><h3>排名背後的依據，一起公開。</h3><p>查看實際 API、逐分鐘資料、計算公式與缺漏原因。</p></div><button className="button button-teal" onClick={() => navigate('methodology')}>資料來源與計算 <Icon size={17} /></button></section>
    </>}</main>
    <footer className="site-footer"><div><strong>內湖園區搞清楚要走的路</strong><p>資料來源：交通部 TDX · 時區：Asia/Taipei</p></div><div className="footer-right"><button className="text-button" onClick={() => downloadFile('內湖園區_分析快照.json', JSON.stringify({ ...data, exportSelection: { dates: selectedDates, metric: '每有效分鐘平均車次 = 實測累計車次 / 有效分鐘', targetExpectedMinutes, rankings, congestionMetric: data.meta?.congestionRule, congestionRankings: congestionRankings.slice(0, 10), strictCompleteDirections: strictRankings.length } }, null, 2), 'application/json;charset=utf-8')}><Icon name="download" size={15} />下載分析 JSON</button><span>快照產生 {data.meta?.generatedAt ? new Date(data.meta.generatedAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false }) : '時間未提供'}</span></div></footer>
    <DirectionDialog direction={inspected} dates={selectedDates} onClose={() => setInspected(null)} />
  </>;
}
