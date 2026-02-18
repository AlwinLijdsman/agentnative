#!/usr/bin/env python3
"""Debug script to inspect img alts on DiscoverCars results page."""
import asyncio
from playwright.async_api import async_playwright

async def debug_alts():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        ctx = await browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            locale="en-US", viewport={"width": 1920, "height": 1080})
        page = await ctx.new_page()
        await page.goto("https://www.discovercars.com/switzerland/zurich", timeout=30000)
        await page.wait_for_load_state("domcontentloaded")
        await page.wait_for_timeout(5000)
        # Click search
        await page.evaluate("""() => {
            const btns = document.querySelectorAll('button.SearchModifier-SubmitBtn');
            for (const btn of btns) { btn.click(); return true; }
            return false;
        }""")
        await page.wait_for_timeout(12000)
        # Scroll
        for i in range(10):
            await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
            await page.wait_for_timeout(2000)

        # Get ALL img tags with src and alt
        imgs = await page.evaluate("""() => {
            return Array.from(document.querySelectorAll('img')).map(img => ({
                alt: (img.alt || '').trim(),
                src: (img.src || '').substring(0, 120),
                cls: (img.className || '').substring(0, 60)
            }))
        }""")
        for i, img in enumerate(imgs):
            if img["alt"]:
                print(f"{i:3d}. alt={repr(img['alt']):40s}  cls={repr(img['cls'])}")

        # Also dump the body text around car names for debugging
        body = await page.inner_text("body")
        lines = [l.strip() for l in body.split("\n") if l.strip()]
        print("\n--- Body text (car-related lines) ---")
        for i, line in enumerate(lines):
            if "or similar" in line or "Mazda" in line or "Toyota" in line or "Skoda" in line or "Ford" in line or "SEAT" in line or "Volkswagen" in line:
                # Print context: 2 lines before and 5 after
                start = max(0, i - 2)
                end = min(len(lines), i + 6)
                print(f"\n  [line {i}]:")
                for j in range(start, end):
                    marker = ">>>" if j == i else "   "
                    print(f"  {marker} {j:4d}: {lines[j]}")

        await browser.close()

asyncio.run(debug_alts())
