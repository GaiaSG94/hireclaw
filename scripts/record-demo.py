"""Capture vidéo de la démo Hireclaw (60-90 s), navigateur réel, site réel.

Usage : /tmp/pwenv/bin/python scripts/record-demo.py [--url URL] [--out media/demo.webm]
"""
import argparse
import asyncio
import json
import os
import sys
import urllib.request

from playwright.async_api import async_playwright

DEFAULT_URL = "http://127.0.0.1:8137"


def api(url, path, body=None):
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(url + path, data=data,
                                 headers={"Content-Type": "application/json"} if body else {})
    with urllib.request.urlopen(req, timeout=30) as res:
        return json.loads(res.read().decode())


async def step(page, seconds):
    """Laisse la page vivre : les robots tournent, les chiffres bougent."""
    await page.wait_for_timeout(int(seconds * 1000))


async def work_sequence(page, url):
    """Le visiteur travaille jusqu'au paiement on-chain, puis retire ses gains."""
    await page.goto(f"{url}/work", wait_until="domcontentloaded")
    await step(page, 2.5)
    for _ in range(3):
        try:
            await page.wait_for_selector("#choices button", state="visible", timeout=15000)
            buttons = await page.query_selector_all("#choices button")
            await step(page, 0.8)
            await buttons[len(buttons) // 2].click(timeout=5000)
            await step(page, 2.4)
            if "payé on-chain" in await page.inner_text("#toast"):
                break
        except Exception:
            await step(page, 1.5)
    try:
        button = await page.query_selector("#withdraw-btn")
        if button and "hidden" not in (await button.get_attribute("class") or ""):
            await step(page, 1.0)
            await button.click(timeout=5000)
            await step(page, 4.0)
    except Exception:
        pass


async def tour(page, url, path, seconds, scroll=True):
    await page.goto(f"{url}{path}", wait_until="domcontentloaded")
    await step(page, seconds * 0.4)
    if scroll:
        height = await page.evaluate("document.body.scrollHeight")
        steps = 6
        for i in range(1, steps + 1):
            await page.evaluate(f"window.scrollTo(0, {int(height * i / steps)})")
            await step(page, (seconds * 0.6) / steps)
        await page.evaluate("window.scrollTo(0, 0)")
        await step(page, 1)
    else:
        await step(page, seconds * 0.6)


async def record(url, out_path):
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(args=["--force-device-scale-factor=1"])
        context = await browser.new_context(
            viewport={"width": 1280, "height": 800},
            record_video_dir=os.path.dirname(out_path) or ".",
            record_video_size={"width": 1280, "height": 800},
            locale="fr-FR",
        )
        page = await context.new_page()
        await work_sequence(page, url)
        await tour(page, url, "/boss", 8)
        await tour(page, url, "/demo", 9)
        await tour(page, url, "/testnet", 9)
        await tour(page, url, "/ledger", 5)
        await tour(page, url, "/code", 4)
        await page.goto(f"{url}/work", wait_until="domcontentloaded")
        await step(page, 4)
        await context.close()
        video = await page.video.path()
        await browser.close()
        os.replace(video, out_path)
        return out_path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default=DEFAULT_URL)
    parser.add_argument("--out", default="media/demo.webm")
    args = parser.parse_args()
    api(args.url, "/api/state")  # le backend répond ?
    path = asyncio.run(record(args.url, args.out))
    size = os.path.getsize(path)
    print(f"vidéo : {path} ({size / 1e6:.1f} Mo)")
    return 0


if __name__ == "__main__":
    sys.exit(main())