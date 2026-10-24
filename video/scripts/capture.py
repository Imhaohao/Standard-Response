# Captures the map plates from the running app (npm run dev in the repo root, port 3000).
# Run from video/: python3 scripts/capture.py
import subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright

OUT = Path(__file__).resolve().parent.parent / "public" / "plates"
APP = "http://localhost:3000"
FIRE_STEPS = 16
CLEAN = "nextjs-portal{display:none!important} path[stroke='var(--signal)']{display:none!important}"
FULL = "() => { const s=document.querySelector('div.isolate'); s.style.cssText+='position:fixed;inset:0;width:100vw;height:100vh;z-index:99999'; }"
SCRUB = """(v) => { const i=document.querySelector('input[type=range]'); const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
  set.call(i,String(v)); i.dispatchEvent(new Event('input',{bubbles:true})); return Number(i.max); }"""
FLAT = "() => [...document.querySelectorAll('button')].find(b => b.textContent.includes('Flat view')).click()"


def save(page, name):
    png = OUT / f"{name}.png"
    page.screenshot(path=str(png))
    subprocess.run(["sips", "-s", "format", "jpeg", "-s", "formatOptions", "88", str(png), "--out", str(OUT / f"{name}.jpg")], check=True, capture_output=True)
    png.unlink()


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", args=["--use-angle=metal", "--enable-gpu"])
        page = browser.new_page(viewport={"width": 1920, "height": 1080}, device_scale_factor=2)
        page.goto(f"{APP}/lab", wait_until="networkidle")
        page.add_style_tag(content=CLEAN)
        page.wait_for_timeout(6000)
        last = page.evaluate(SCRUB, 0)
        page.evaluate(FULL)
        page.wait_for_timeout(2500)
        for step in range(FIRE_STEPS + 1):
            page.evaluate(SCRUB, round(last * step / FIRE_STEPS))
            page.wait_for_timeout(900)
            save(page, f"fire_{step:02d}")
        page.evaluate(FLAT)
        page.wait_for_timeout(2500)
        page.evaluate(FULL)
        page.wait_for_timeout(1500)
        save(page, "paper")
        browser.close()


main()
