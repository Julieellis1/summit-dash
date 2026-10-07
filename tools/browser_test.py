"""Headless Chromium smoke test for Summit Dash.
Usage: python3 tools/browser_test.py [url]   (default http://localhost:8765/index.html)
Saves screenshots to shots/ and prints a JSON report.
"""
import json, os, sys, time, urllib.parse
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 and sys.argv[1].startswith('http') else 'http://localhost:8765/index.html'
OUT = os.path.join(os.path.dirname(__file__), '..', 'shots')
os.makedirs(OUT, exist_ok=True)

def proxy():
    p = os.environ.get('HTTPS_PROXY') or os.environ.get('https_proxy') or os.environ.get('HTTP_PROXY') or os.environ.get('http_proxy')
    if not p: return None
    u = urllib.parse.urlparse(p)
    d = {'server': f'{u.scheme}://{u.hostname}:{u.port}', 'bypass': 'localhost,127.0.0.1'}
    if u.username: d['username'] = urllib.parse.unquote(u.username); d['password'] = urllib.parse.unquote(u.password or '')
    return d

ARGS = ['--no-sandbox', '--ignore-certificate-errors', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required']
report = {}

def wait_idle(pg, timeout=60):
    t0 = time.time()
    while time.time() - t0 < timeout:
        # dismiss digests / confirm boxes automatically
        if pg.locator('[data-ok]').count():
            try: pg.locator('[data-ok]').first.click(timeout=2000)
            except Exception: pass
        st = pg.evaluate("() => ({busy: window.__SD.busy, modal: document.querySelectorAll('#modal-root .modal-back').length, card: !!document.querySelector('.card3d'), fork: !!document.querySelector('.fork-card')})")
        if st['card'] or st['fork']: return st
        if not st['busy'] and st['modal'] == 0: return st
        pg.wait_for_timeout(250)
    return {'timeout': True}

def resolve_choice(pg):
    if pg.locator('.fork-card').count():
        pg.locator('.fork-card.risky').click(); pg.wait_for_timeout(600); return 'fork'
    if pg.locator('.card3d').count():
        btns = pg.locator('.opt:not([disabled])')
        btns.first.click(); pg.wait_for_timeout(300)
        if pg.locator('.tgt').count(): pg.locator('.tgt').first.click()
        pg.wait_for_timeout(600); return 'fate'
    return None

def run(viewport, label, mobile=False, tutorial=False):
    errors = []
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/usr/bin/chromium', args=ARGS, proxy=proxy())
        ctx = b.new_context(viewport=viewport, device_scale_factor=2 if mobile else 1, is_mobile=mobile, has_touch=mobile)
        pg = ctx.new_page()
        pg.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))
        pg.on('console', lambda m: errors.append('console: ' + m.text) if m.type == 'error' and '404' not in m.text else None)
        pg.on('response', lambda r: errors.append(f'http {r.status}: {r.url}') if r.status >= 400 and 'favicon' not in r.url else None)
        pg.goto(URL, wait_until='load', timeout=90000)
        pg.wait_for_selector('#go', timeout=90000)
        pg.wait_for_timeout(1500)
        pg.screenshot(path=f'{OUT}/{label}-0-setup.png')
        pg.fill('#seed', '4242')
        if not tutorial: pg.uncheck('#tut')
        pg.click('#go')
        res = {}
        if tutorial:
            pg.wait_for_selector('.coach', timeout=60000); pg.wait_for_timeout(1200)
            pg.screenshot(path=f'{OUT}/{label}-1-tutorial.png')
            pg.locator('.coach .btn').click(); pg.wait_for_timeout(500)
            pg.click('#rollBtn'); pg.wait_for_selector('.card3d.flipped', timeout=60000); pg.wait_for_timeout(1400)
            pg.screenshot(path=f'{OUT}/{label}-2-tutorial-fate.png')
            resolve_choice(pg); pg.wait_for_selector('.coach .btn', timeout=30000)
            pg.locator('.coach .btn').click()
            res['tutorial'] = 'ok'
        pg.wait_for_function("() => !document.querySelector('#hud').classList.contains('hidden') && window.__SD.eng", timeout=60000)
        wait_idle(pg); pg.wait_for_timeout(1500)
        # roll a few times; capture the dice mid-tumble once and a card reveal
        rolls = 0; card_shot = False; dice_shot = False
        for day in range(4):
            for _ in range(14):
                st = wait_idle(pg)
                if resolve_choice(pg): continue
                v = pg.evaluate("() => ({t: window.__SD.eng.m('you').throws, over: window.__SD.eng.state.season.over, sum: window.__SD.eng.m('you').summitAt})")
                if v['over'] or v['t'] <= 0 or v['sum'] is not None: break
                pg.click('#rollBtn'); rolls += 1
                if not dice_shot:
                    pg.wait_for_timeout(450); pg.screenshot(path=f'{OUT}/{label}-3-dice.png'); dice_shot = True
                pg.wait_for_timeout(400)
                for _ in range(60):
                    if pg.locator('.card3d.flipped').count() or pg.locator('.fork-card').count(): break
                    if not pg.evaluate('window.__SD.busy'): break
                    pg.wait_for_timeout(250)
                if pg.locator('.card3d.flipped').count() and not card_shot:
                    pg.wait_for_timeout(1000); pg.screenshot(path=f'{OUT}/{label}-4-card-reveal.png'); card_shot = True
            if day == 0:
                wait_idle(pg); pg.wait_for_timeout(1200)
                pg.screenshot(path=f'{OUT}/{label}-5-gameplay.png')
            wait_idle(pg)
            if pg.evaluate('window.__SD.eng.state.season.over'): break
            pg.click('#endDayBtn'); pg.wait_for_timeout(500)
            if pg.locator('[data-ok]').count(): pg.locator('[data-ok]').first.click()
            wait_idle(pg, 90)
        res['rolls'] = rolls; res['card_shot'] = card_shot
        res['day_reached'] = pg.evaluate('window.__SD.eng.state.season.day')
        res['tile'] = pg.evaluate("window.__SD.eng.m('you').tile")
        if mobile:
            pg.click('#btnPanel'); pg.wait_for_timeout(700); pg.screenshot(path=f'{OUT}/{label}-6-panel.png')
            pg.click('#tabs button[data-tab="feed"]'); pg.wait_for_timeout(500); pg.screenshot(path=f'{OUT}/{label}-7-feed.png')
            pg.click('#grab'); pg.wait_for_timeout(500)
        else:
            pg.click('#tabs button[data-tab="feed"]'); pg.wait_for_timeout(400); pg.screenshot(path=f'{OUT}/{label}-6-feed.png')
            pg.click('#tabs button[data-tab="fair"]'); pg.wait_for_timeout(400); pg.screenshot(path=f'{OUT}/{label}-7-fairness.png')
            pg.click('#tabs button[data-tab="squad"]')
            pg.click('#btnOverview'); pg.wait_for_timeout(3500); pg.screenshot(path=f'{OUT}/{label}-8-overview.png'); pg.click('#btnOverview')
        # fast-forward to the end screen
        while pg.locator('#modal-root .modal-back').count():
            if not resolve_choice(pg):
                if pg.locator('[data-ok]').count(): pg.locator('[data-ok]').first.click()
                else: break
        pg.evaluate('window.__SD.fastForward()')
        pg.wait_for_selector('.recap', timeout=120000); pg.wait_for_timeout(1500)
        pg.screenshot(path=f'{OUT}/{label}-9-end.png')
        res['end_screen'] = True
        res['season'] = pg.evaluate("(() => { const s = window.__SD.eng.state.season; return {day: s.day, reason: s.endReason, firstSummitDay: s.firstSummitAt == null ? null : Math.floor(s.firstSummitAt/24)+1, eruptions: s.eruptions.length, winner: s.results[0].name, mine: s.results.find(r => r.id==='you')} })()")
        res['fps'] = pg.evaluate('window.__SD.fps || null')
        res['app_errors'] = pg.evaluate('window.__SD.errors')
        res['errors'] = [e for e in errors if 'favicon' not in e]
        b.close()
    report[label] = res
    json.dump(report, open(os.path.join(OUT, 'report.json'), 'w'), indent=1)

if __name__ == '__main__':
    which = sys.argv[2] if len(sys.argv) > 2 else 'both'
    if which in ('both', 'desktop'): run({'width': 1440, 'height': 900}, 'desktop')
    if which in ('both', 'mobile'): run({'width': 390, 'height': 844}, 'mobile', mobile=True, tutorial=True)
    print(json.dumps(report, indent=1))
