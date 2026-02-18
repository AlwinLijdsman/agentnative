#!/usr/bin/env python3
"""Test setting dates AND times via Playwright in DiscoverCars calendar."""
import asyncio
from playwright.async_api import async_playwright


async def select_dates():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        ctx = await browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            locale="en-US",
            viewport={"width": 1920, "height": 1080},
        )
        page = await ctx.new_page()
        await page.goto("https://www.discovercars.com/switzerland/zurich", timeout=30000)
        await page.wait_for_load_state("domcontentloaded")
        await page.wait_for_timeout(5000)

        # Accept cookies
        try:
            btn = page.locator("#onetrust-accept-btn-handler")
            if await btn.count() > 0:
                await btn.click()
                await page.wait_for_timeout(1000)
        except Exception:
            pass

        # ---- SET DATES ----
        # Click pickup date field to open calendar
        pickup_field = page.locator(".DatePicker-CalendarField").nth(2)
        print(f"Current pickup: {await pickup_field.text_content()}")
        await pickup_field.click()
        await page.wait_for_timeout(1500)

        # Click March 6 via mouse coordinates
        march6_box = await page.evaluate("""() => {
            const cals = document.querySelectorAll('.rdrCalendarWrapper');
            for (const cal of cals) {
                const rect = cal.getBoundingClientRect();
                if (rect.width === 0 || rect.y < 0) continue;
                const months = cal.querySelectorAll('.rdrMonth');
                for (const month of months) {
                    const mn = month.querySelector('.rdrMonthName');
                    if (mn && mn.textContent.includes('Mar')) {
                        const days = month.querySelectorAll('.rdrDay');
                        for (const day of days) {
                            if (day.classList.contains('rdrDayPassive')) continue;
                            const dn = day.querySelector('.rdrDayNumber span');
                            if (dn && dn.textContent.trim() === '6') {
                                const r = day.getBoundingClientRect();
                                return { x: r.x + r.width/2, y: r.y + r.height/2, found: true };
                            }
                        }
                    }
                }
            }
            return { found: false };
        }""")
        if march6_box.get("found"):
            await page.mouse.click(march6_box["x"], march6_box["y"])
            await page.wait_for_timeout(1500)

        # Click March 8
        march8_box = await page.evaluate("""() => {
            const cals = document.querySelectorAll('.rdrCalendarWrapper');
            for (const cal of cals) {
                const rect = cal.getBoundingClientRect();
                if (rect.width === 0 || rect.y < 0) continue;
                const months = cal.querySelectorAll('.rdrMonth');
                for (const month of months) {
                    const mn = month.querySelector('.rdrMonthName');
                    if (mn && mn.textContent.includes('Mar')) {
                        const days = month.querySelectorAll('.rdrDay');
                        for (const day of days) {
                            if (day.classList.contains('rdrDayPassive')) continue;
                            const dn = day.querySelector('.rdrDayNumber span');
                            if (dn && dn.textContent.trim() === '8') {
                                const r = day.getBoundingClientRect();
                                return { x: r.x + r.width/2, y: r.y + r.height/2, found: true };
                            }
                        }
                    }
                }
            }
            return { found: false };
        }""")
        if march8_box.get("found"):
            await page.mouse.click(march8_box["x"], march8_box["y"])
            await page.wait_for_timeout(1500)

        pickup_now = await page.locator(".DatePicker-CalendarField").nth(2).text_content()
        dropoff_now = await page.locator(".DatePicker-CalendarField").nth(3).text_content()
        print(f"Dates set: Pickup={pickup_now}, Dropoff={dropoff_now}")

        # ---- SET TIMES ----
        # The time dropdowns use CustomSelect. Visible ones are at indices 2 and 3.
        # They have a CustomSelect-Selected div that shows current value and
        # CustomSelect-Options container with CustomSelect-Option items.

        # Let's try clicking directly on the time display and selecting from the dropdown
        # First, check the structure of the visible time pickers
        time_structure = await page.evaluate("""() => {
            const dateRows = document.querySelectorAll('.DatePicker-DateTimeRow');
            const results = [];
            for (const row of dateRows) {
                const rect = row.getBoundingClientRect();
                if (rect.width === 0 || rect.y < 0 || rect.y > 1000) continue;

                const dateText = row.querySelector('.DatePicker-CalendarField')?.textContent?.trim() || '';
                const timeWrapper = row.querySelector('.DatePicker-TimeWrapper');
                if (!timeWrapper) continue;

                // Find the CustomSelect-Selected element
                const selected = timeWrapper.querySelector('.CustomSelect-Selected');
                const selectedText = selected?.textContent?.trim() || 'none';
                const selectedRect = selected?.getBoundingClientRect() || {};

                // Check if there's a dropdown visible
                const optionsContainer = timeWrapper.querySelector('.CustomSelect-Options');
                const isOpen = optionsContainer && window.getComputedStyle(optionsContainer).display !== 'none';

                results.push({
                    dateText,
                    selectedTime: selectedText,
                    selectedX: selectedRect.x || 0,
                    selectedY: selectedRect.y || 0,
                    selectedW: selectedRect.width || 0,
                    isOpen,
                    hasOptions: !!optionsContainer
                });
            }
            return results;
        }""")

        import json
        print(f"Time pickers: {json.dumps(time_structure, indent=2)}")

        # Click on the pickup time selector and set to 13:00
        for idx, ts in enumerate(time_structure):
            if ts["selectedW"] > 0:
                target_time = "13:00" if idx == 0 else "17:00"
                print(f"Setting time for '{ts['dateText']}' to {target_time}")

                # Click to open dropdown
                x = ts["selectedX"] + ts["selectedW"] / 2
                y = ts["selectedY"] + 15
                await page.mouse.click(x, y)
                await page.wait_for_timeout(800)

                # Find and click the target time option
                clicked_time = await page.evaluate("""(targetTime) => {
                    // Find all visible CustomSelect-Option elements
                    const options = document.querySelectorAll('.CustomSelect-Option');
                    for (const opt of options) {
                        const rect = opt.getBoundingClientRect();
                        if (rect.width === 0) continue;
                        if (opt.textContent.trim() === targetTime) {
                            opt.scrollIntoView();
                            opt.click();
                            return 'clicked ' + targetTime;
                        }
                    }
                    return 'not found';
                }""", target_time)
                print(f"  Result: {clicked_time}")
                await page.wait_for_timeout(500)

        # Final verification
        final_times = await page.evaluate("""() => {
            const rows = document.querySelectorAll('.DatePicker-DateTimeRow');
            const results = [];
            for (const row of rows) {
                const rect = row.getBoundingClientRect();
                if (rect.width === 0 || rect.y < 0 || rect.y > 1000) continue;
                const date = row.querySelector('.DatePicker-CalendarField')?.textContent?.trim() || '';
                const time = row.querySelector('.CustomSelect-Selected')?.textContent?.trim() || '';
                results.push(date + ' at ' + time);
            }
            return results;
        }""")
        print(f"\nFinal: {final_times}")

        # Click Search now
        print("\nClicking Search now...")
        await page.evaluate("""() => {
            const btns = document.querySelectorAll('button.SearchModifier-SubmitBtn');
            for (const btn of btns) { btn.click(); return; }
        }""")
        await page.wait_for_timeout(15000)

        print(f"URL: {page.url}")

        # Decode sq from URL
        url = page.url
        if 'sq=' in url:
            from urllib.parse import unquote
            import base64
            sq_b64 = unquote(url.split('sq=')[1].split('&')[0])
            sq_json = base64.b64decode(sq_b64).decode()
            print(f"sq: {sq_json}")

        body = await page.inner_text("body")
        or_similar = body.count("or similar")
        offers = [l.strip() for l in body.split("\n") if "offers found" in l]
        total_for = [l.strip() for l in body.split("\n") if "Total for" in l][:3]

        print(f"Cars: {or_similar}, Offers: {offers}, Total: {total_for}")

        lines = [l.strip() for l in body.split("\n") if l.strip()]
        car_count = 0
        for i, line in enumerate(lines):
            if "or similar" in line and i > 0:
                car_name = lines[i - 1]
                for j in range(i + 1, min(i + 20, len(lines))):
                    if lines[j].startswith("CHF"):
                        print(f"  {car_name}: {lines[j]}")
                        break
                car_count += 1
                if car_count >= 5:
                    break

        await browser.close()


asyncio.run(select_dates())
