"""Builds the static design mockups (HTML) for review. Not part of the app."""
from pathlib import Path

OUT = Path(__file__).parent

ICONS = {
    "home": '<path d="M3 10l7-6 7 6v7H3z"/>',
    "open": '<rect x="3" y="4" width="14" height="12" rx="2"/><path d="M3 8h14"/>',
    "in": '<path d="M10 3v10M6 9l4 4 4-4M4 17h12"/>',
    "bill": '<path d="M5 3h10v14l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5z"/><path d="M8 7h4M8 10h4"/>',
    "chq": '<rect x="2.5" y="5" width="15" height="10" rx="1.5"/><path d="M5.5 11h5M13 9h2"/>',
    "bank": '<path d="M3 8l7-4 7 4M4 8v7M8 8v7M12 8v7M16 8v7M3 16h14"/>',
    "rec": '<path d="M4 10l4 4 8-8"/>',
    "print": '<path d="M6 7V3h8v4M5 14H3V8h14v6h-2"/><rect x="6" y="11" width="8" height="6"/>',
    "school": '<path d="M2 8l8-4 8 4-8 4z"/><path d="M5 10v4c3 2 7 2 10 0v-4"/>',
    "lock": '<rect x="4" y="9" width="12" height="8" rx="1.5"/><path d="M7 9V6a3 3 0 016 0v3"/>',
    "file": '<path d="M5 3h7l3 3v11H5z"/><path d="M12 3v3h3"/>',
    "gear": '<circle cx="10" cy="10" r="2.5"/><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4"/>',
}

NAV = [
    (None, [("dashboard", "ડેશબોર્ડ", "home")]),
    ("માહિતી", [
        ("opening", "ઉઘડતી સિલક", "open"),
        ("receipts", "ગ્રાન્ટ આવક", "in"),
        ("bills", "બિલ", "bill"),
        ("cheques", "ચેક", "chq"),
        ("bank", "બેન્ક ચાર્જ", "bank"),
        ("rec", "પરિશિષ્ટ ૯ મેળવણું", "rec"),
    ]),
    ("છાપકામ", [("reports", "રિપોર્ટ", "print")]),
    ("સેટિંગ", [
        ("masters", "શાળા અને ગ્રાન્ટ હેડ", "school"),
        ("yearend", "વર્ષ બંધ કરો", "lock"),
        ("import", "જૂની ફાઈલ લાવો", "file"),
        ("settings", "સેટિંગ", "gear"),
    ]),
]


def icon(name):
    return f'<svg viewBox="0 0 20 20">{ICONS[name]}</svg>'


def sidebar(active):
    parts = ['<aside class="side"><div class="brand"><b>SMC હિસાબ</b><span>બેટાવાડાના મુવાડા પ્રા. શાળા</span></div><nav class="nav">']
    for group, items in NAV:
        if group:
            parts.append(f'<div class="nav-group">{group}</div>')
        for key, label, ic in items:
            cls = ' class="on"' if key == active else ""
            parts.append(f'<a{cls}>{icon(ic)}{label}</a>')
    parts.append('</nav><div class="side-foot"><span class="dot"></span>બેકઅપ સાચવેલ · ૨ મિનિટ પહેલાં</div></aside>')
    return "".join(parts)


def page(name, active, crumb, body, extra_css=""):
    html = f"""<!doctype html><html lang="gu"><head><meta charset="utf-8">
<link rel="stylesheet" href="base.css"><style>{extra_css}</style></head><body>
<div class="app">{sidebar(active)}<div class="main">
<div class="topbar"><div class="crumb">{crumb}</div>
<div class="row"><span class="year">વર્ષ ૨૦૨૫–૨૬ <span style="color:var(--ink-3)">▾</span></span></div></div>
<div class="content">{body}</div></div></div></body></html>"""
    (OUT / f"{name}.html").write_text(html, encoding="utf-8")


# ------------------------------------------------------------- dashboard
heads = [
    ("વ્યાજ/વટાવ", "312", "245", "557", "0", "0", "557"),
    ("શાળા સ્વચ્છતા ગ્રાન્ટ", "1,200", "10,000", "11,200", "9,000", "0", "2,200"),
    ("વાલીસંમેલન ગ્રાન્ટ", "0", "2,000", "2,000", "2,000", "0", "0"),
    ("બાળમેળો ગ્રાન્ટ", "500", "3,000", "3,500", "2,850", "0", "650"),
    ("ઈન્ટરનેટ ગ્રાન્ટ", "0", "6,000", "6,000", "5,400", "0", "600"),
    ("પ્રજ્ઞા ગ્રાન્ટ", "2,150", "0", "2,150", "0", "2,150", "0"),
    ("ફસ્ટ એઈડ બોક્સ ગ્રાન્ટ", "0", "1,000", "1,000", "1,000", "0", "0"),
    ("પ્રવેશોત્સવ ગ્રાન્ટ", "0", "1,500", "1,500", "1,500", "0", "0"),
]
rows = "".join(
    f"<tr><td>{h[0]}</td>" + "".join(f'<td class="num{" muted" if v=="0" else ""}">{v}</td>' for v in h[1:]) + "</tr>"
    for h in heads
)
dash = f"""
<div class="head"><div><h1>બેટાવાડાના મુવાડા પ્રા. શાળા</h1>
<p class="sub">બારિયાના મુવાડા · કપડવંજ · DISE 24160201802 · 01/04/2025 – 31/03/2026</p></div>
<div class="row"><button class="btn">{icon('print').replace('<svg','<svg width=15 height=15 fill=none stroke=currentColor stroke-width=1.6')} રિપોર્ટ છાપો</button>
<button class="btn primary">+ નવું બિલ</button></div></div>

<div class="stats">
 <div class="stat"><div class="l">બંધ સિલક (બેન્ક)</div><div class="v"><small>₹</small>4,007</div><div class="n">BOB અંતિસર</div></div>
 <div class="stat"><div class="l">બંધ સિલક (રોકડ)</div><div class="v"><small>₹</small>0</div><div class="n">હાથ પરની રોકડ</div></div>
 <div class="stat"><div class="l">વર્ષ દરમ્યાન મળેલ</div><div class="v"><small>₹</small>23,745</div><div class="n">૧૨ આવક</div></div>
 <div class="stat"><div class="l">કુલ ખર્ચ</div><div class="v"><small>₹</small>23,900</div><div class="n">૪૧ બિલ · ૮ ચેક</div></div>
</div>

<div style="display:grid;grid-template-columns:1fr 300px;gap:22px">
<div class="card">
 <div class="card-h"><h3>પરિશિષ્ટ ૧૦ – વાર્ષિક ગ્રાન્ટ પત્રક</h3><span class="muted">રકમ ₹ માં</span></div>
 <table><thead><tr><th>વિગત</th><th class="num">શરૂની સિલક</th><th class="num">મળેલ ગ્રાન્ટ</th><th class="num">કુલ</th><th class="num">ખર્ચ</th><th class="num">પરત</th><th class="num">બંધ સિલક</th></tr></thead>
 <tbody>{rows}</tbody>
 <tfoot><tr><td>કુલ</td><td class="num">4,162</td><td class="num">23,745</td><td class="num">27,907</td><td class="num">21,750</td><td class="num">2,150</td><td class="num">4,007</td></tr></tfoot></table>
</div>
<div style="display:flex;flex-direction:column;gap:22px">
 <div class="card"><div class="card-h"><h3>ધ્યાન આપો</h3><span class="tag warn">૨</span></div>
  <div style="padding:6px 20px 14px;font-size:13px;line-height:1.55">
   <div style="padding:10px 0;border-bottom:1px solid var(--line-2)">ચેક ૧૦૯ હજી બેન્કમાં વટાવાયો નથી<div class="hint">ચેક → ૧૦૯</div></div>
   <div style="padding:10px 0">બિલ 7/3 કોઈ ચેક સાથે જોડાયેલ નથી<div class="hint">બિલ → 7/3</div></div>
  </div></div>
 <div class="card"><div class="card-h"><h3>આ વર્ષની નોંધ</h3></div>
  <div style="padding:8px 20px 16px;font-size:13px">
   <div class="row" style="justify-content:space-between;padding:7px 0"><span style="color:var(--ink-2)">ગ્રાન્ટ આવક</span><b class="num" style="font-weight:500">12</b></div>
   <div class="row" style="justify-content:space-between;padding:7px 0"><span style="color:var(--ink-2)">બિલ</span><b class="num" style="font-weight:500">41</b></div>
   <div class="row" style="justify-content:space-between;padding:7px 0"><span style="color:var(--ink-2)">ચેક</span><b class="num" style="font-weight:500">8</b></div>
   <div class="row" style="justify-content:space-between;padding:7px 0"><span style="color:var(--ink-2)">બેન્ક ચાર્જ</span><b class="num" style="font-weight:500">1</b></div>
  </div></div>
</div></div>
"""
page("1-dashboard", "dashboard", "<b>ડેશબોર્ડ</b>", dash)

# ------------------------------------------------------------- bills
bills = [
    ("1/1", "25/06/2025", "પ્રવેશોત્સવ કીટ", "શ્રી વિદ્યાર્થી ટ્રેડર્સ", "પ્રવેશોત્સવ ગ્રાન્ટ", "500", "103"),
    ("1/2", "08/07/2025", "સફાઈકામ મજૂરી", "હસમુખભાઈ મંગળભાઈ હરિજન", "શાળા સ્વચ્છતા ગ્રાન્ટ", "500", "103"),
    ("1/3", "15/07/2025", "સફાઈ મટીરીયલ્સ", "જય અંબે જનરલ સ્ટોર્સ", "શાળા સ્વચ્છતા ગ્રાન્ટ", "1,450", "103"),
    ("1/4", "02/08/2025", "ફસ્ટ એઈડ બોક્સ કીટ", "શ્રી મેડિકલ સ્ટોર્સ", "ફસ્ટ એઈડ બોક્સ ગ્રાન્ટ", "1,000", "103"),
    ("1/5", "14/08/2025", "વાલીસંમેલન સરભરા", "શ્રી રામ ફરસાણ", "વાલીસંમેલન ગ્રાન્ટ", "2,000", "103"),
    ("2/1", "05/09/2025", "ઈન્ટરનેટ બિલ – સપ્ટે.", "Jio Fiber", "ઈન્ટરનેટ ગ્રાન્ટ", "1,350", "105"),
    ("2/2", "05/10/2025", "ઈન્ટરનેટ બિલ – ઓક્ટો.", "Jio Fiber", "ઈન્ટરનેટ ગ્રાન્ટ", "1,350", "105"),
    ("3/1", "18/11/2025", "બાળમેળો સામગ્રી", "શ્રી ગણેશ સ્ટેશનરી", "બાળમેળો ગ્રાન્ટ", "2,850", "107"),
    ("7/3", "12/01/2026", "સફાઈકામ મજૂરી", "હસમુખભાઈ મંગળભાઈ હરિજન", "શાળા સ્વચ્છતા ગ્રાન્ટ", "600", None),
    ("7/4", "20/01/2026", "ઝાડુ અને ડસ્ટબિન", "જય અંબે જનરલ સ્ટોર્સ", "શાળા સ્વચ્છતા ગ્રાન્ટ", "850", None),
]
brows = "".join(
    f'<tr><td class="num" style="text-align:left">{b[0]}</td><td class="num" style="text-align:left;color:var(--ink-2)">{b[1]}</td>'
    f'<td>{b[2]}<div class="hint" style="margin-top:2px">{b[3]}</div></td><td style="color:var(--ink-2)">{b[4]}</td>'
    f'<td class="num">{b[5]}</td><td>' + (f'<span class="tag ok">ચેક {b[6]}</span>' if b[6] else '<span class="tag warn">ચેક બાકી</span>') + '</td></tr>'
    for b in bills
)
billsbody = f"""
<div class="head"><div><h1>બિલ</h1><p class="sub">વર્ષ દરમ્યાન થયેલ ખર્ચના બિલ. ચેક સાથે જોડતાં ચેકની રકમ આપોઆપ ગણાય છે.</p></div>
<button class="btn primary">+ નવું બિલ</button></div>
<div class="row" style="justify-content:space-between;margin-bottom:14px">
 <div class="row"><div class="search">⌕&nbsp; બિલ નં., વિગત કે વેપારી શોધો…</div>
 <span class="chip on">બધાં · 41</span><span class="chip">ચેક બાકી · 2</span><span class="chip">ગ્રાન્ટ હેડ ▾</span></div>
 <span style="font-size:13px;color:var(--ink-3)">કુલ <b style="color:var(--ink);font-weight:600" class="num">₹ 21,750</b></span>
</div>
<div class="card"><table>
<thead><tr><th style="width:80px">બિલ નં.</th><th style="width:110px">તારીખ</th><th>વિગત</th><th>ગ્રાન્ટ હેડ</th><th class="num">ચોખ્ખી રકમ</th><th style="width:110px">ચુકવણી</th></tr></thead>
<tbody>{brows}</tbody></table>
<div class="row" style="justify-content:space-between;padding:12px 20px;border-top:1px solid var(--line-2);font-size:12.5px;color:var(--ink-3)">
<span>1–10 / 41 બિલ</span><span class="row" style="gap:6px"><span class="btn ghost" style="padding:4px 10px">‹ પાછળ</span><span class="btn" style="padding:4px 10px">આગળ ›</span></span></div></div>
"""
page("2-bills", "bills", "માહિતી &nbsp;/&nbsp; <b>બિલ</b>", billsbody)

# ------------------------------------------------------------- cheque form
cheq_css = """
.sheet{display:grid;grid-template-columns:1fr 340px;gap:22px}
.sec{padding:22px 24px;border-bottom:1px solid var(--line-2)}
.sec:last-child{border-bottom:0}
.sec h4{font-size:13px;font-weight:600;margin-bottom:16px}
.alloc td{padding:9px 0;border:0;font-size:13.5px}
"""
picked = [("1/1", "પ્રવેશોત્સવ કીટ", "500", True), ("1/2", "સફાઈકામ મજૂરી", "500", True),
          ("1/3", "સફાઈ મટીરીયલ્સ", "1,450", True), ("1/4", "ફસ્ટ એઈડ બોક્સ કીટ", "1,000", True),
          ("7/3", "સફાઈકામ મજૂરી", "600", False), ("7/4", "ઝાડુ અને ડસ્ટબિન", "850", False)]
prow = "".join(
    f'<tr><td style="width:36px"><span class="check{" on" if p[3] else ""}"></span></td><td class="num" style="text-align:left;width:60px">{p[0]}</td><td>{p[1]}</td><td class="num">{p[2]}</td></tr>'
    for p in picked
)
chq = f"""
<div class="head"><div><h1>નવો ચેક</h1><p class="sub">ચેક સાથે બિલ જોડો — ગ્રાન્ટ હેડ મુજબ વહેંચણી આપોઆપ થશે.</p></div>
<div class="row"><button class="btn ghost">રદ કરો</button><button class="btn primary">ચેક સાચવો</button></div></div>
<div class="sheet">
<div class="card">
 <div class="sec"><h4>ચેકનો પ્રકાર</h4>
  <div class="seg"><span class="on">ખર્ચની ભરપાઈ</span><span>સીધી ચુકવણી</span><span>ગ્રાન્ટ પરત</span></div></div>
 <div class="sec"><h4>ચેકની વિગત</h4>
  <div class="grid3">
   <div class="field"><label>ચેક નંબર</label><div class="input num" style="text-align:left">103</div></div>
   <div class="field"><label>ચેક તારીખ</label><div class="input num" style="text-align:left">09/06/2025</div></div>
   <div class="field"><label>વટાવ્યા તારીખ</label><div class="input num" style="text-align:left;color:var(--ink-3)">DD/MM/YYYY</div><div class="hint">બેન્ક સ્ટેટમેન્ટ મુજબ</div></div>
   <div class="field" style="grid-column:span 2"><label>કોને ચુકવ્યો</label><div class="input focus">સભ્ય સચિવ દિપકકુમાર.વી.પટેલ</div></div>
   <div class="field"><label>વાઉચર નં.</label><div class="input num" style="text-align:left">1</div></div>
  </div></div>
 <div class="sec" style="padding-bottom:10px"><div class="row" style="justify-content:space-between;margin-bottom:6px"><h4 style="margin:0">જોડેલાં બિલ</h4><span style="font-size:12.5px;color:var(--ink-3)">૪ પસંદ કર્યાં</span></div>
  <table class="alloc" style="margin-top:6px"><tbody>{prow.replace('<td', '<td style="border-bottom:1px solid var(--line-2)"', 0)}</tbody></table></div>
</div>
<div style="display:flex;flex-direction:column;gap:22px">
<div class="card" style="padding:22px 24px">
 <div style="font-size:12.5px;color:var(--ink-3)">ચેકની રકમ</div>
 <div style="font-size:30px;font-weight:500;margin:6px 0 18px" style="font-variant-numeric:tabular-nums">₹ 3,450</div>
 <div style="font-size:12.5px;color:var(--ink-3);margin-bottom:6px">ગ્રાન્ટ હેડ મુજબ વહેંચણી</div>
 <table class="alloc"><tbody>
  <tr><td>શાળા સ્વચ્છતા ગ્રાન્ટ</td><td class="num">1,950</td></tr>
  <tr><td>ફસ્ટ એઈડ બોક્સ ગ્રાન્ટ</td><td class="num">1,000</td></tr>
  <tr><td>પ્રવેશોત્સવ ગ્રાન્ટ</td><td class="num">500</td></tr>
  <tr><td style="border-top:1px solid var(--line);font-weight:600">કુલ</td><td class="num" style="border-top:1px solid var(--line);font-weight:600">3,450</td></tr>
 </tbody></table>
</div>
<div class="notice"><span>ⓘ</span><span>આ રકમ બિલ પરથી ગણાય છે, હાથે લખવાની જરૂર નથી.</span></div>
</div></div>
"""
page("3-cheque-form", "cheques", "માહિતી &nbsp;/&nbsp; ચેક &nbsp;/&nbsp; <b>નવો ચેક</b>", chq, cheq_css)

# ------------------------------------------------------------- reports
rep_css = """
.reps{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
.rep{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:18px 20px;display:flex;flex-direction:column;gap:4px}
.rep b{font-size:14.5px;font-weight:600}
.rep > span{font-size:12.5px;color:var(--ink-3);line-height:1.5}
.rep .a{margin-top:12px;display:flex;gap:8px}
.rep .a .btn{padding:6px 12px;font-size:12.5px}
.rep.sel{border-color:var(--accent-line);box-shadow:inset 3px 0 0 var(--accent)}
.secl{font-size:12px;color:var(--ink-3);margin:24px 0 10px}
"""
def rep(t, d, sel=False):
    return f'<div class="rep{" sel" if sel else ""}"><b>{t}</b><span>{d}</span><div class="a"><span class="btn">પૂર્વાવલોકન</span><span class="btn">PDF</span><span class="btn ghost">Excel</span></div></div>'
reps = f"""
<div class="head"><div><h1>રિપોર્ટ</h1><p class="sub">બધા રિપોર્ટ દાખલ કરેલી માહિતી પરથી આપોઆપ બને છે.</p></div>
<div class="row"><span class="btn">છાપવાનું લેઆઉટ</span><button class="btn primary">બધા રિપોર્ટ એક PDF માં</button></div></div>
<div class="secl">હિસાબી ચોપડા</div>
<div class="reps">
{rep("રોજમેળ", "રોકડ અને બેન્ક – તારીખ મુજબ જમા/ઉધાર, પાના નંબર સાથે", True)}
{rep("ખાતાવહી", "દરેક ગ્રાન્ટ હેડની અલગ ખાતાવહી")}
{rep("ગ્રાન્ટ રજિસ્ટર", "વર્ષ દરમ્યાન મળેલ દરેક ગ્રાન્ટની નોંધ")}
</div>
<div class="secl">રજિસ્ટર અને વાઉચર</div>
<div class="reps">
{rep("ચેક રજિસ્ટર", "આપેલા ચેક, તારીખ અને વટાવ્યાની વિગત")}
{rep("બિલ રજિસ્ટર", "બધાં બિલ – વાઉચર નંબર મુજબ")}
{rep("વાઉચર", "દરેક ચેક માટે ચુકવણી વાઉચર")}
</div>
<div class="secl">પત્રકો</div>
<div class="reps">
{rep("પત્રક-D", "ગ્રાન્ટ મુજબ ખર્ચનું પત્રક")}
{rep("પરિશિષ્ટ ૯", "બેન્ક સાથે મેળવણું (રીકન્સીલિએશન)")}
{rep("પરિશિષ્ટ ૧૦", "વાર્ષિક ગ્રાન્ટ પત્રક")}
</div>
"""
page("4-reports", "reports", "છાપકામ &nbsp;/&nbsp; <b>રિપોર્ટ</b>", reps, rep_css)
