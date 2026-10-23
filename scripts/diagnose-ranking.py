#!/usr/bin/env python3
"""Offline ranking audit. Reads only the snapshot and named research cache files.

Run: python3 scripts/diagnose-ranking.py
Only Python standard-library modules are required; no credentials or network calls.
"""
import argparse
import json, pathlib, collections, datetime, hashlib

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--root', type=pathlib.Path, default=pathlib.Path(__file__).resolve().parents[1], help='Project directory; defaults to the script parent project.')
args = parser.parse_args()
root = args.root.resolve()
snapshot_path = root / 'data/dashboard.json'
d = json.loads(snapshot_path.read_text())
dates=d['coverage']['availableDates']; candidates=[x for x in d['directions'] if x['scope']['included'] and x['isRepresentative']]
by_vd=collections.defaultdict(list)
for c in candidates: by_vd[c['vdId']].append(c)

def canon(v): return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=False)
def classify(r,vd,link):
    reasons=[]
    tm=datetime.datetime.fromisoformat(r['DataCollectTime'].replace('Z','+00:00')).astimezone(datetime.timezone(datetime.timedelta(hours=8)))
    if tm.second or tm.microsecond: reasons.append('timestamp_alignment')
    if r.get('Status') != 0: reasons.append('status')
    matches=[f for f in r.get('LinkFlows',[]) if f.get('LinkID')==link['LinkID']]
    if len(matches)!=1: reasons.append('duplicate_link' if matches else 'missing_link')
    flow=matches[0] if matches else None
    lanes=(flow or {}).get('Lanes',[])
    if not isinstance(link.get('LaneNum'),int) or link['LaneNum']<=0 or len(lanes)!=link['LaneNum']: reasons.append('lane_count')
    if 'ActualLaneNum' in link and link['ActualLaneNum'] != link['LaneNum']: reasons.append('partial_lane_coverage')
    ids=[l.get('LaneID') for l in lanes]
    if any(not isinstance(i,int) or i<0 for i in ids): reasons.append('lane_id')
    if len(set(ids))!=len(ids): reasons.append('duplicate_lane')
    vol=0; flags=set(); lane_flags=collections.Counter(); diagnostics=[]
    for l in lanes:
        fs=l.get('ErrorDiags')
        if not isinstance(fs,list) or not fs or any(f!='diag0' for f in fs): reasons.append('error_diag')
        for f in fs or []:
            if f!='diag0': flags.add(f); lane_flags[f]+=1
        vs=l.get('Vehicles',[])
        if not vs: reasons.append('missing_vehicles')
        classes=[v.get('VehicleType') for v in vs]
        if any(not isinstance(t,str) or not t for t in classes): reasons.append('vehicle_type')
        if len(set(classes))!=len(classes): reasons.append('duplicate_vehicle_type')
        vols=[v.get('Volume') for v in vs]
        if any(type(v)!=int or v<0 or v>9007199254740991 for v in vols): reasons.append('volume')
        lv=sum(v for v in vols if type(v)==int and v>=0)
        vol+=lv
        diagnostics.append({'laneId':l.get('LaneID'),'volume':lv,'speed':l.get('Speed'),'occupancy':l.get('Occupancy'),'flags':fs})
    normalized=None
    if flow is not None:
        normalized=dict(flow); normalized['Lanes']=[]
        for l in lanes:
            nl=dict(l)
            if isinstance(nl.get('Vehicles'),list): nl['Vehicles']=sorted(nl['Vehicles'],key=lambda v:str(v.get('VehicleType','')))
            if isinstance(nl.get('ErrorDiags'),list): nl['ErrorDiags']=sorted(nl['ErrorDiags'])
            normalized['Lanes'].append(nl)
        normalized['Lanes']=sorted(normalized['Lanes'],key=lambda l:l.get('LaneID',-1))
    reasons=list(dict.fromkeys(reasons))
    return {'reasons':reasons,'volume':vol,'flags':sorted(flags),'laneFlagCounts':dict(lane_flags),'lanes':diagnostics,'timestamp':r['DataCollectTime'],'fingerprint':canon({'status':r.get('Status'),'reasons':reasons,'flow':normalized})}

out={c['id']:{'id':c['id'],'roadName':c['roadName'],'bearing':c['bearing'],'vdId':c['vdId'],'linkId':c['linkId'],'days':[]} for c in candidates}
mismatches=[]; flag_examples={}; global_counts=collections.Counter(); input_hashes=[]
for date in dates:
    statics=[json.loads(l) for l in (root/f'research/{date}-taipei-vd-static.jsonl').read_text(encoding='utf-8-sig').splitlines() if l.strip()]
    smap={s['VDID']:s for s in statics}; minutes={c['id']:{} for c in candidates}
    path=root/f'research/{date}-neihu-morning.jsonl'; input_hashes.append({'date':date,'morningSHA256':hashlib.sha256(path.read_bytes()).hexdigest()})
    with path.open(encoding='utf-8-sig') as f:
        for line in f:
            if not line.strip(): continue
            r=json.loads(line); cs=by_vd.get(r.get('VDID'))
            if not cs: continue
            tm=datetime.datetime.fromisoformat(r['DataCollectTime'].replace('Z','+00:00')).astimezone(datetime.timezone(datetime.timedelta(hours=8)))
            minute=tm.hour*60+tm.minute
            if str(tm.date())!=date or not 420<=minute<570: continue
            vd=smap.get(r['VDID'])
            if not vd: continue
            for c in cs:
                link=next((l for l in vd.get('DetectionLinks',[]) if l['LinkID']==c['linkId']),None)
                if not link: continue
                val=classify(r,vd,link); old=minutes[c['id']].get(minute)
                if old is None: minutes[c['id']][minute]=val
                elif old['fingerprint']!=val['fingerprint'] or old.get('conflict'):
                    old['conflict']=True;old['reasons']=['conflicting_duplicate']
    for c in candidates:
        vals=list(minutes[c['id']].values()); valid=[v for v in vals if not v['reasons']]; reasons=collections.Counter()
        flag_minutes=collections.Counter(); lane_flag_counts=collections.Counter()
        flags_only=hard_only=both=0; invalids=[]
        for v in vals:
            reasons.update(v['reasons']);flag_minutes.update(v['flags']);lane_flag_counts.update(v['laneFlagCounts'])
            if v['reasons']:
                hard=any(r!='error_diag' for r in v['reasons']); flagged='error_diag' in v['reasons']
                if flagged and not hard: flags_only+=1
                elif hard and not flagged: hard_only+=1
                else: both+=1
                invalids.append({k:v[k] for k in ['timestamp','reasons','volume','lanes']})
            for lane in v['lanes']:
                for flag in lane['flags'] or []:
                    if flag!='diag0' and len(flag_examples.setdefault(flag,[]))<4:
                        flag_examples[flag].append({'date':date,'id':c['id'],'roadName':c['roadName'],'bearing':c['bearing'],'timestamp':v['timestamp'],**lane})
        missing=150-len(vals)
        if missing: reasons['missing_minute']=missing
        day={'date':date,'receivedMinutes':len(vals),'validMinutes':len(valid),'observedVolume':sum(v['volume'] for v in valid),'reasonCounts':dict(reasons),'flagsOnlyMinutes':flags_only,'hardFaultOnlyMinutes':hard_only,'flagsAndHardFaultMinutes':both,'missingMinutes':missing,'flagDirectionMinutes':dict(flag_minutes),'flagLaneOccurrences':dict(lane_flag_counts),'invalidExamples':invalids[:2]}
        out[c['id']]['days'].append(day)
        shared=next((day for day in c['days'] if day['date']==date),None)
        if shared is None or shared['validMinutes']!=day['validMinutes'] or shared['receivedMinutes']!=day['receivedMinutes'] or (shared.get('volume') or 0)!=day['observedVolume'] or shared['reasonCounts']!=day['reasonCounts']:
            mismatches.append({'id':c['id'],'date':date,'independent':day,'shared':shared})

for c in out.values():
    days=c['days']; counts=collections.Counter();flags=collections.Counter();laneflags=collections.Counter()
    for day in days:
        counts.update(day['reasonCounts']);flags.update(day['flagDirectionMinutes']);laneflags.update(day['flagLaneOccurrences'])
    c.update({'expectedMinutes':150*len(dates),'receivedMinutes':sum(x['receivedMinutes'] for x in days),'validMinutes':sum(x['validMinutes'] for x in days),'fullDays':sum(x['validMinutes']==150 for x in days),'minimumDailyValidMinutes':min(x['validMinutes'] for x in days),'validCoverage':sum(x['validMinutes'] for x in days)/(150*len(dates)),'minimumDailyCoverage':min(x['validMinutes'] for x in days)/150,'observedVolume':sum(x['observedVolume'] for x in days),'reasonCounts':dict(counts),'flagsOnlyMinutes':sum(x['flagsOnlyMinutes'] for x in days),'hardFaultOnlyMinutes':sum(x['hardFaultOnlyMinutes'] for x in days),'flagsAndHardFaultMinutes':sum(x['flagsAndHardFaultMinutes'] for x in days),'missingMinutes':sum(x['missingMinutes'] for x in days),'flagDirectionMinutes':dict(flags),'flagLaneOccurrences':dict(laneflags)})
summary={'requestedDates':d['coverage']['requestedDates'],'availableDates':dates,'failedDates':d['coverage']['failedDates'],'candidateCount':len(candidates),'expectedDirectionMinutes':len(candidates)*len(dates)*150,'validDirectionMinutes':sum(c['validMinutes'] for c in out.values()),'flagsOnlyDirectionMinutes':sum(c['flagsOnlyMinutes'] for c in out.values()),'hardFaultOnlyDirectionMinutes':sum(c['hardFaultOnlyMinutes'] for c in out.values()),'flagsAndHardFaultDirectionMinutes':sum(c['flagsAndHardFaultMinutes'] for c in out.values()),'missingDirectionMinutes':sum(c['missingMinutes'] for c in out.values()),'requestedExpectedMinutesPerDirection':150*len(d['coverage']['requestedDates']),'availableExpectedMinutesPerDirection':150*len(dates),'requestedExpectedDirectionMinutes':150*len(d['coverage']['requestedDates'])*len(candidates),'unavailableDateDirectionMinutes':150*(len(d['coverage']['requestedDates'])-len(dates))*len(candidates),'strictQualifiers':sum(c['fullDays']==len(dates) for c in out.values()),'thresholds':[],'independentVsSnapshotMismatchCount':len(mismatches)}
for threshold in [.8,.9,.95,.98]:
    overall=[c['id'] for c in out.values() if c['validCoverage']>=threshold]
    everyday=[c['id'] for c in out.values() if c['minimumDailyCoverage']>=threshold]
    requested=[c['id'] for c in out.values() if c['validMinutes']/(150*len(d['coverage']['requestedDates']))>=threshold]
    summary['thresholds'].append({'threshold':threshold,'requestedOverallCoverageCount':len(requested),'requestedOverallCoverageIds':requested,'overallCoverageCount':len(overall),'overallCoverageIds':overall,'everyDayCoverageCount':len(everyday),'everyDayCoverageIds':everyday})
result={'method':'Independent Python recomputation from each date static JSONL and morning JSONL. No shared JS calculation helper imported. Candidate representative selection taken from published snapshot. Same raw record fingerprint normalization/dedup semantics replicated separately. Counts of invalid reasons can overlap; flags-only/hard-only/both/missing partition direction-minutes. Threshold summaries are diagnostics, not authorization to relax quality rules or impute totals.','snapshotSHA256':hashlib.sha256(snapshot_path.read_bytes()).hexdigest(),'summary':summary,'candidates':sorted(out.values(),key=lambda c:-c['validCoverage']),'flagExamples':flag_examples,'mismatches':mismatches,'inputMorningHashes':input_hashes}


def render_report(result):
    """Render counts from the independent audit; no product formulas are imported."""
    s = result['summary']
    candidates = result['candidates']
    requested_count = len(s['requestedDates'])
    available_count = len(s['availableDates'])
    available_expected = s['availableExpectedMinutesPerDirection']
    requested_expected = s['requestedExpectedMinutesPerDirection']
    reason_counts = collections.Counter()
    flags = collections.Counter()
    for candidate in candidates:
        reason_counts.update(candidate['reasonCounts'])
        flags.update(candidate['flagDirectionMinutes'])
    lines = [
        '# 原嚴格完整排名為 0 的診斷', '',
        '本報告診斷原先要求所有日期、所有分鐘完整的嚴格排名為何是 0。產品主排名目前已另依「有效觀測車次 ÷ 有效分鐘」呈現實測平均；本報告仍保留原品質檢查與完整日條件，沒有更動產品計算規則。', '',
        '## 重跑方式', '',
        '在專案目錄執行：', '',
        '```sh', 'python3 scripts/diagnose-ranking.py', '```', '',
        '只需 Python 3 標準函式庫。腳本不連線、不讀取 `.env`，也不需要憑證；讀取 `data/dashboard.json`，以及該快照已取得日期的 `research/YYYY-MM-DD-taipei-vd-static.jsonl`、`research/YYYY-MM-DD-neihu-morning.jsonl`。執行後重建本報告及 `research/ranking-diagnostics.json`。可用 `--root /absolute/project/path` 指定另一個本機專案。', '',
        'JSON 保存逐方向逐日分鐘、異常樣本與輸入雜湊。若與產品快照的逐日統計出現差異，腳本回傳非零結束狀態，差異詳列於 JSON 的 `mismatches`。', '',
        '## 判斷', '',
        f'現有嚴格規則要求每個代表方向在所有已取得日期都具備 150 個通過品質檢查的分鐘；任何一天少一個有效分鐘，便不列入整期排名。{s["candidateCount"]} 個代表候選方向有 **{s["strictQualifiers"]} 個**符合。舊版 dist 空白排名的直接資料來源是快照的 `rankings=[]`，不是單靠 build 即可修復。', '',
        f'本腳本沒有匯入產品共用計算函式。代表方向名單取自快照，原始計數、篩選、同分鐘衝突與每日加總另行實作；與快照逐日的 receivedMinutes、validMinutes、volume、reasonCounts 比較，差異數為 **{s["independentVsSnapshotMismatchCount"]}**。', '',
        '## 分母與日期', '',
        f'原要求共 {requested_count} 個週一至週五，每方向應有 **{requested_expected:,} 分鐘**；已取得 {available_count} 日，每方向 **{available_expected:,} 分鐘**。未取得的日期不能被默默從完整要求的分母扣掉。這裡的週一至週五尚包含國定假日，與政府機關上班日曆不同。', '',
    ]
    if candidates:
        best = candidates[0]
        lines += [
            f'最完整的 {best["roadName"]} {best["bearing"]}（{best["vdId"]}）有 {best["validMinutes"]:,} 個有效分鐘：以已取得日期為分母是 {best["validMinutes"]}/{available_expected}＝{best["validCoverage"]:.2%}；以原要求日期為分母則是 {best["validMinutes"]}/{requested_expected}＝{best["validMinutes"]/requested_expected:.2%}。', '',
        ]
    for failed in s['failedDates']:
        lines += [f'- {failed["date"]}：{failed["reason"]}']
    lines += ['', '## 日期與品質分布', '',
        f'以下方向分鐘分布只涵蓋 **{available_count} 個已取得日期**。', '',
        '| 項目 | 方向分鐘數 |', '|---|---:|',
        f'| {s["candidateCount"]} 個方向 × {available_count} 日 × 150 分鐘 | {s["expectedDirectionMinutes"]:,} |',
        f'| 完全通過現有初檢 | {s["validDirectionMinutes"]:,} |',
        f'| 僅 ErrorDiags 旗標未通過 | {s["flagsOnlyDirectionMinutes"]:,} |',
        f'| 僅結構、Status 或同分鐘衝突 | {s["hardFaultOnlyDirectionMinutes"]:,} |',
        f'| 旗標與結構／計數等問題並存 | {s["flagsAndHardFaultDirectionMinutes"]:,} |',
        f'| 已取得日期內沒有該分鐘標記 | {s["missingDirectionMinutes"]:,} |', '',
        f'另外，未取得日期對應 {s["unavailableDateDirectionMinutes"]:,} 個方向分鐘；完整原要求的總分母是 {s["requestedExpectedDirectionMinutes"]:,}。', '',
        '有效、僅旗標、僅其他、兩者並存、缺分鐘五類互斥。下列原因可以重疊，不能相加當成不合格分鐘數。', '',
        '| 原因 | 方向分鐘數 |', '|---|---:|',
    ]
    for reason, count in reason_counts.items():
        lines.append(f'| {reason} | {count:,} |')
    lines += ['', '## 共同時間缺口', '',
        '以下只描述已下載快取中的共同缺口。僅憑本機快取，不能判定政府來源端或下載程序何者造成；也不能把不同更新時間當成新的採樣分鐘。', '',
        '| 日期 | 每個代表方向都缺少的分鐘數 |', '|---|---:|',
    ]
    for date in dates:
        missing_counts = [next(day for day in c['days'] if day['date'] == date)['missingMinutes'] for c in candidates]
        if missing_counts and missing_counts[0] and len(set(missing_counts)) == 1:
            lines.append(f'| {date} | {missing_counts[0]} |')
    if '2026-10-02' in dates and '2026-10-05' in dates:
        lines += ['', '本次快取中 10/02 缺 07:02–08:01，另缺 08:06、08:11–08:13、08:16；10/05 缺 07:49–07:52。VQKWL61 的 10/02 07:01 有 60 筆同一採樣時間、內容變動的紀錄；10/05 07:48 有 5 筆。同分鐘內容衝突被排除，未作新分鐘加總。']
    lines += ['', '即使忽略品質旗標，共同缺分鐘仍會使「所有日完整」條件無人通過。', '',
        '## 一個分鐘如何影響整段期間', '',
    ]
    # Examples are selected from the current raw audit, not copied product totals.
    for station, date in [('VQKWL61', '2026-09-29'), ('VQKWL61', '2026-10-01'), ('VRFTM40', '2026-10-21')]:
        candidate = next((c for c in candidates if c['vdId'] == station), None)
        day = next((day for day in candidate['days'] if day['date'] == date), None) if candidate else None
        if not day or day['validMinutes'] != 149 or not day['invalidExamples']:
            continue
        example = day['invalidExamples'][0]
        local_time = datetime.datetime.fromisoformat(example['timestamp']).astimezone(datetime.timezone(datetime.timedelta(hours=8))).strftime('%H:%M')
        lane_description = '；'.join(f'Lane {lane["laneId"]}: Volume={lane["volume"]}, Speed={lane["speed"]}, Occupancy={lane["occupancy"]}, flags={",".join(lane["flags"] or [])}' for lane in example['lanes'])
        lines += [f'- {date} {candidate["roadName"]} {candidate["bearing"]}（{station}）有效 149/150 分鐘，{local_time} 因 {", ".join(example["reasons"])} 未通過。{lane_description}。通過分鐘加總 {day["observedVolume"]:,} 輛，仍不能稱為完整 150 分鐘總量。']
    lines += ['', '以上是保守規則的結果，不代表已證明被排除的 Volume 一定錯誤。', '',
        '## 官方旗標與樣本', '',
        '依交通部[異常代碼說明](https://motc-traffic.gitbook.io/motc-traffic/ji-chu-jian-he-1/yi-chang-dai-ma-shui-ming)，201–206 檢查車速、流量、佔有率之間的零值一致性；205 對應有流量、但車速與佔有率均為零。303 表示動態、靜態車道或 LinkID 對應不一致。102、106 分別涉及低於門檻的車速、佔有率；107 涉及採樣與更新時間差。', '',
        '| 旗標 | 有出現該旗標的方向分鐘數 |', '|---|---:|',
    ]
    for flag, count in sorted(flags.items()):
        lines.append(f'| {flag} | {count:,} |')
    lines += ['', '同一分鐘可能有多個旗標；衝突分鐘保留第一筆可見內容的旗標，因此與最終排除原因不是一對一。', '',
        '原始樣本有車道流量 1–3 輛，但速度、佔有率為 0，並有 diag201／203／205。這只證明欄位組合未通過一致性檢查，不能判定流量必錯、旗標是誤報，或來源四捨五入造成；需要來源規格或獨立證據。', '',
        '## 完整度門檻的敏感性', '',
        f'**已取得 {available_count} 日**（分母 {available_expected:,}）與**原要求 {requested_count} 日**（分母 {requested_expected:,}）必須分開閱讀。', '',
        '| 有效分鐘比例門檻 | 已取得日期整期達標數 | 已取得日期每天皆達標數 | 原要求全部日期整期達標數 |', '|---|---:|---:|---:|',
    ]
    for threshold in s['thresholds']:
        lines.append(f'| {threshold["threshold"]:.0%} | {threshold["overallCoverageCount"]} | {threshold["everyDayCoverageCount"]} | {threshold["requestedOverallCoverageCount"]} |')
    lines += ['', '這些只是敏感性診斷，不代表已採用的排名門檻。未取得日期按缺失處理，不能作零流量，也不能假設其品質與已取得日期相同。', '',
        '## 各代表候選方向', '',
        '有效觀測車次只加總通過檢查的原始 Volume，未補值或放大。各方向有效分鐘不同，此欄不能直接解讀為完整早尖峰總量的公平排行。', '',
        f'| 道路／方向 | 測點 | 有效分鐘 | 已取得日比例 /{available_expected} | 原要求比例 /{requested_expected} | 完整日 /{available_count} | 有效觀測車次 | 僅旗標 | 僅其他 | 兩者並存 | 已取得日內缺分鐘 |',
        '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
    ]
    for c in candidates:
        lines.append(f'| {c["roadName"]} {c["bearing"]} | {c["vdId"]} | {c["validMinutes"]} | {c["validCoverage"]:.2%} | {c["validMinutes"]/requested_expected:.2%} | {c["fullDays"]} | {c["observedVolume"]:,} | {c["flagsOnlyMinutes"]} | {c["hardFaultOnlyMinutes"]} | {c["flagsAndHardFaultMinutes"]} | {c["missingMinutes"]} |')
    lines += ['', '## 指標能說明的範圍', '',
        '- 保留完整日、完整時段總量的嚴格指標，並公開沒有合格結果的原因。',
        '- 有效分鐘實測車流率＝有效觀測車次÷有效分鐘，描述的是觀測時段平均；它不是缺失分鐘的估計，也不是完整 150 分鐘總車次。',
        '- 缺失或異常可能與交通繁忙程度相關，觀測平均仍可能有偏差。不得乘 150 冒充完整實測總量。',
        '- 朝園區方向仍是人工道路連接假設，不能證明每台車目的地在園區；此診斷沒有新增方向認證。', '',
    ]
    return '\n'.join(lines)


json_target = root / 'research/ranking-diagnostics.json'
report_target = root / 'docs/ranking-diagnostics.md'
json_target.parent.mkdir(parents=True, exist_ok=True)
report_target.parent.mkdir(parents=True, exist_ok=True)
json_target.write_text(json.dumps(result, indent=2, ensure_ascii=False) + '\n')
report_target.write_text(render_report(result))
print(f'Compared {len(candidates)} representative directions × {len(dates)} available days; mismatches={len(mismatches)}; strict qualifiers={summary["strictQualifiers"]}.')
print(f'Valid direction-minutes: {summary["validDirectionMinutes"]}/{summary["expectedDirectionMinutes"]} (available dates); requested denominator={summary["requestedExpectedDirectionMinutes"]}.')
print('Coverage thresholds: available / requested qualifiers')
for threshold in summary['thresholds']:
    print(f'{threshold["threshold"]:.0%}: {threshold["overallCoverageCount"]} / {threshold["requestedOverallCoverageCount"]}')
print('Wrote research/ranking-diagnostics.json and docs/ranking-diagnostics.md.')
if mismatches:
    raise SystemExit(1)
