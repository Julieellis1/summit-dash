"""Checks preview/index.html inside <iframe sandbox="allow-scripts"> (no allow-same-origin)."""
import json, os, sys, time
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(__file__))
from browser_test import proxy, ARGS, OUT  # noqa  (importing runs nothing heavy: guarded below)

WRAP = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8766/wrap.html'
errors = []
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/chromium', args=ARGS, proxy=proxy())
    pg = b.new_page(viewport={'width': 1280, 'height': 800})
    pg.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))
    pg.on('console', lambda m: errors.append('console: ' + m.text) if m.type == 'error' else None)
    pg.goto(WRAP, wait_until='load', timeout=90000)
    fr = None
    for _ in range(120):
        fr = next((f for f in pg.frames if f != pg.main_frame), None)
        if fr and fr.query_selector('#go'): break
        pg.wait_for_timeout(500)
    fr.wait_for_selector('#go', timeout=60000)
    sandbox = pg.evaluate("document.querySelector('iframe').getAttribute('sandbox')")
    storage = fr.evaluate("(() => { try { localStorage.setItem('x','1'); return 'available'; } catch (e) { return 'blocked: ' + e.name; } })()")
    fr.uncheck('#tut'); fr.fill('#seed', '777'); fr.click('#go')
    fr.wait_for_function("() => window.__SD && window.__SD.eng && !window.__SD.busy", timeout=90000)
    for _ in range(40):
        if fr.query_selector('[data-ok]'): fr.click('[data-ok]')
        if not fr.evaluate('window.__SD.busy'): break
        pg.wait_for_timeout(300)
    t0 = fr.evaluate("window.__SD.eng.m('you').tile")
    fr.click('#rollBtn'); pg.wait_for_timeout(9000)
    for _ in range(40):
        if fr.query_selector('.opt:not([disabled])'):
            fr.click('.opt:not([disabled])'); pg.wait_for_timeout(300)
            if fr.query_selector('.tgt'): fr.click('.tgt')
        if fr.query_selector('.fork-card'): fr.click('.fork-card.safe')
        if not fr.evaluate('window.__SD.busy'): break
        pg.wait_for_timeout(400)
    t1 = fr.evaluate("window.__SD.eng.m('you').tile")
    pg.screenshot(path=f'{OUT}/preview-sandboxed-iframe.png')
    while fr.query_selector('.modal-back'):
        if fr.query_selector('.opt:not([disabled])'): fr.click('.opt:not([disabled])')
        elif fr.query_selector('[data-ok]'): fr.click('[data-ok]')
        else: break
        pg.wait_for_timeout(300)
    fr.evaluate('window.__SD.fastForward()')
    fr.wait_for_selector('.recap', timeout=120000)
    out = {'sandbox': sandbox, 'storage': storage, 'tile_before': t0, 'tile_after_roll': t1, 'end_screen': True,
           'app_errors': fr.evaluate('window.__SD.errors'), 'errors': errors}
    pg.screenshot(path=f'{OUT}/preview-end.png')
    b.close()
print(json.dumps(out, indent=1))
json.dump(out, open(os.path.join(OUT, 'preview-report.json'), 'w'), indent=1)
