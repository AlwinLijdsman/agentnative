#!/usr/bin/env python3
"""
DiscoverCars.com Scraper
Extracts real car rental prices from the DiscoverCars search results page.
Two-phase approach: landing page → click Search → full results page.
"""

import asyncio
import json
import re
import sys
from datetime import datetime
from typing import Optional


def parse_results_page(body_text: str, img_alts: list[str], rental_days_override: int = 0) -> list[dict]:
    """
    Parse car rental results from the DiscoverCars search RESULTS page.
    Format per card:
      CarName
      or similar Category
      Automatic/Manual
      5 seats
      2 bags
      Air Conditioning
      5 doors
      Rental Conditions
      <Location>          (e.g. "Zurich Albisrieden", "Zurich Airport (ZRH)")
      <pickup info>       (e.g. "Rental office", "In terminal pick-up")
      <deposit info>
      <extras>
      <rating score>      (e.g. "8.6")
      <rating text>       (e.g. "Excellent")
      <review count>      (optional, e.g. "44 reviews")
      Total for N days
      CHF XXX.XX
      View deal
    """
    # Build supplier lookup from img alts:
    # Pattern: CarName → SupplierName → SupplierName (car image, supplier logo, supplier text)
    supplier_for_car = {}
    seen_car_names = set()
    i = 0
    while i < len(img_alts) - 1:
        alt = img_alts[i]
        # Skip non-car images (flags, logos, icons, category labels)
        if alt in ("", "Discovercars logo", "Company Logo", "Powered by Onetrust",
                    "star", "US", "GB", "CH", "DE", "FR", "IT", "AT", "NL", "ES",
                    "ID", "CZ", "DK", "HR", "LV", "LT", "HU", "MY", "NO", "PL",
                    "PT", "RO", "SK", "FI", "SE", "TR", "GR", "BG", "RU", "IL",
                    "SA", "TH", "KR", "JP", "CN", "TW",
                    "Small cars", "Medium cars", "Large cars", "SUVs",
                    "Vans", "Station wagons", "Convertibles", "Premium cars"):
            i += 1
            continue

        # Check if this looks like a car name (followed by a supplier name)
        next_alt = img_alts[i + 1] if i + 1 < len(img_alts) else ""
        # Car names contain spaces or are known car brands
        if next_alt and next_alt not in seen_car_names and alt != next_alt:
            # This might be CarName → SupplierName
            # Supplier names are typically: Europcar, Enterprise, SIXT, Hertz, Avis, Budget, etc.
            known_suppliers = {"Europcar", "Enterprise", "SIXT", "Sixt", "Hertz", "Avis",
                              "Budget", "Flizzr", "Thrifty", "Dollar", "National", "Alamo",
                              "Green Motion", "Goldcar", "Keddy", "Firefly"}
            if next_alt.strip() in known_suppliers:
                car_key = alt.strip().rstrip("\t")
                if car_key not in supplier_for_car:
                    supplier_for_car[car_key] = next_alt.strip()
                seen_car_names.add(car_key)
                i += 2  # Skip car + supplier
                # Also skip the second supplier logo (usually appears twice)
                if i < len(img_alts) and img_alts[i].strip() == next_alt.strip():
                    i += 1
                continue
        i += 1

    lines = [l.strip() for l in body_text.split("\n") if l.strip()]
    cars = []

    i = 0
    while i < len(lines) - 3:
        if "or similar" not in lines[i]:
            i += 1
            continue

        car_name = lines[i - 1] if i > 0 else "Unknown"
        category = lines[i].replace("or similar", "").strip()

        # Skip nav/header text
        if car_name in ("CHF", "English", "Help", "Log in", "Search now", "Deutsch", "Suchen"):
            i += 1
            continue

        transmission = ""
        total_price = 0.0
        rental_days_from_text = 0
        seats = 0
        bags = 0
        doors = 0
        has_ac = False
        rating_text = ""
        rating_score = 0.0
        review_count = 0
        location = ""
        extras = []

        # Scan forward for details
        for j in range(1, min(25, len(lines) - i)):
            line = lines[i + j]

            if line in ("Automatic", "Manual"):
                transmission = line.lower()

            elif re.match(r"^(\d+) seats?$", line):
                seats = int(re.match(r"^(\d+)", line).group(1))

            elif re.match(r"^(\d+) bags?$", line):
                bags = int(re.match(r"^(\d+)", line).group(1))

            elif re.match(r"^(\d+) doors?$", line):
                doors = int(re.match(r"^(\d+)", line).group(1))

            elif line == "Air Conditioning":
                has_ac = True

            elif line.startswith("CHF"):
                try:
                    price_str = line.replace("CHF", "").replace("\xa0", "").replace(",", "").strip()
                    total_price = float(price_str)
                except ValueError:
                    pass

            elif re.match(r"^Total for (\d+) days?$", line):
                m = re.match(r"^Total for (\d+) days?$", line)
                rental_days_from_text = int(m.group(1))

            elif line in ("Excellent", "Very Good", "Good", "Fair", "Superb", "Outstanding"):
                rating_text = line

            elif re.match(r"^\d+\.\d$", line):
                try:
                    rating_score = float(line)
                except ValueError:
                    pass

            elif re.match(r"^\d+ reviews?$", line):
                review_count = int(line.split()[0])

            elif line.startswith("Zurich") or line in ("Downtown",):
                location = line

            elif line in ("Unlimited mileage", "Winter tires", "Instant confirmation!",
                          "Free cancellation", "Low deposit", "Airport shuttle"):
                extras.append(line)

            elif line == "View deal":
                break

        # Compute per-day price
        days = rental_days_from_text or rental_days_override or 1
        price_per_day = round(total_price / days, 2) if total_price > 0 and days > 0 else 0

        # Look up supplier from img alts
        supplier = supplier_for_car.get(car_name.strip(), "")
        # Also try with tab-stripped name
        if not supplier:
            supplier = supplier_for_car.get(car_name.strip().rstrip("\t"), "")

        if total_price > 0 and car_name:
            cars.append({
                "car_name": car_name,
                "category": category,
                "transmission": transmission or "unknown",
                "price_per_day_chf": price_per_day,
                "total_price_chf": total_price,
                "rental_days": days,
                "seats": seats,
                "bags": bags,
                "doors": doors,
                "air_conditioning": has_ac,
                "rating_text": rating_text,
                "rating_score": rating_score,
                "review_count": review_count,
                "supplier": supplier,
                "location": location,
                "extras": extras,
            })

        i += 1

    return cars


def parse_cards(card_data: list[dict]) -> list[dict]:
    """
    Parse car rental results from per-card DOM extraction.
    Each card has: carName, supplier, text (the card's innerText).
    """
    cars = []
    for card in card_data:
        car_name = card.get("carName", "").strip()
        supplier = card.get("supplier", "").strip()
        text = card.get("text", "")
        if not car_name or not text:
            continue

        lines = [l.strip() for l in text.split("\n") if l.strip()]

        category = ""
        transmission = ""
        total_price = 0.0
        rental_days_from_text = 0
        seats = 0
        bags = 0
        doors = 0
        has_ac = False
        rating_text = ""
        rating_score = 0.0
        review_count = 0
        location = ""
        extras = []

        for line in lines:
            if "or similar" in line:
                category = line.replace("or similar", "").strip()

            elif line in ("Automatic", "Manual"):
                transmission = line.lower()

            elif re.match(r"^(\d+) seats?$", line):
                seats = int(re.match(r"^(\d+)", line).group(1))

            elif re.match(r"^(\d+) bags?$", line):
                bags = int(re.match(r"^(\d+)", line).group(1))

            elif re.match(r"^(\d+) doors?$", line):
                doors = int(re.match(r"^(\d+)", line).group(1))

            elif line == "Air Conditioning":
                has_ac = True

            elif line.startswith("CHF"):
                try:
                    price_str = line.replace("CHF", "").replace("\xa0", "").replace(",", "").strip()
                    total_price = float(price_str)
                except ValueError:
                    pass

            elif re.match(r"^Total for (\d+) days?$", line):
                m = re.match(r"^Total for (\d+) days?$", line)
                rental_days_from_text = int(m.group(1))

            elif line in ("Excellent", "Very Good", "Good", "Fair", "Superb", "Outstanding"):
                rating_text = line

            elif re.match(r"^\d+\.\d$", line):
                try:
                    rating_score = float(line)
                except ValueError:
                    pass

            elif re.match(r"^\d+ reviews?$", line):
                review_count = int(line.split()[0])

            elif line.startswith("Zurich") or line in ("Downtown",):
                location = line

            elif line in ("Unlimited mileage", "Winter tires", "Instant confirmation!",
                          "Free cancellation", "Low deposit", "Airport shuttle",
                          "Free shuttle service pick-up", "In terminal pick-up",
                          "Online check-in"):
                extras.append(line)

        # Compute per-day price
        d = rental_days_from_text or 1
        price_per_day = round(total_price / d, 2) if total_price > 0 and d > 0 else 0

        if total_price > 0 and car_name:
            cars.append({
                "car_name": car_name,
                "category": category,
                "transmission": transmission or "unknown",
                "price_per_day_chf": price_per_day,
                "total_price_chf": total_price,
                "rental_days": d,
                "seats": seats,
                "bags": bags,
                "doors": doors,
                "air_conditioning": has_ac,
                "rating_text": rating_text,
                "rating_score": rating_score,
                "review_count": review_count,
                "supplier": supplier,
                "location": location,
                "extras": extras,
            })

    return cars


def parse_landing_page(body_text: str, img_alts: list[str]) -> list[dict]:
    """
    Parse car rental results from the DiscoverCars LANDING page.
    Format per card (different from results page):
      CarName
      or similar Category
      Automatic/Manual
      <small ints: seats, bags, doors>
      A/C
      CHF XX.XX
      per day
    """
    # Build supplier lookup from numbered img alt sequence
    supplier_map = {}
    i = 0
    while i < len(img_alts) - 1:
        try:
            num = int(img_alts[i])
            supplier_name = img_alts[i + 1]
            if supplier_name not in ("star", "US", "GB", "CH", "DE", "FR", "IT", "AT", "NL", "ES") and len(supplier_name) > 1:
                supplier_map[num] = supplier_name
            i += 2
        except (ValueError, IndexError):
            i += 1

    lines = [l.strip() for l in body_text.split("\n") if l.strip()]
    cars = []
    car_index = 0

    i = 0
    while i < len(lines) - 3:
        if "or similar" not in lines[i]:
            i += 1
            continue

        car_name = lines[i - 1] if i > 0 else "Unknown"
        category = lines[i].replace("or similar", "").strip()

        if car_name in ("CHF", "English", "Help", "Log in", "Search now"):
            i += 1
            continue

        transmission = ""
        price = 0.0
        seats = 0
        bags = 0
        doors = 0
        has_ac = False
        rating_text = ""
        rating_score = 0.0
        review_count = 0
        extras = []
        small_ints = []

        for j in range(1, min(16, len(lines) - i)):
            line = lines[i + j]

            if line in ("Automatic", "Manual"):
                transmission = line.lower()
            elif line.startswith("CHF"):
                try:
                    price = float(line.replace("CHF", "").replace("\xa0", "").replace(",", ".").strip())
                except ValueError:
                    pass
            elif line in ("Excellent", "Very Good", "Good", "Fair", "Superb", "Outstanding"):
                rating_text = line
            elif re.match(r"^\d+\.\d$", line):
                try:
                    rating_score = float(line)
                except ValueError:
                    pass
            elif re.match(r"^\d+ reviews?$", line):
                review_count = int(line.split()[0])
            elif line == "A/C":
                has_ac = True
            elif line in ("Unlimited mileage", "Winter tires", "Instant confirmation!",
                          "Free cancellation", "Low deposit"):
                extras.append(line)
            elif line == "per day":
                pass
            elif line == "View deal":
                break
            else:
                try:
                    n = int(line)
                    if 1 <= n <= 9:
                        small_ints.append(n)
                except ValueError:
                    pass

        if len(small_ints) >= 1:
            seats = small_ints[0]
        if len(small_ints) >= 2:
            bags = small_ints[1]
        if len(small_ints) >= 3:
            doors = small_ints[2]

        car_index += 1
        supplier = supplier_map.get(car_index, "")

        if price > 0 and car_name:
            cars.append({
                "car_name": car_name,
                "category": category,
                "transmission": transmission or "unknown",
                "price_per_day_chf": price,
                "seats": seats,
                "bags": bags,
                "doors": doors,
                "air_conditioning": has_ac,
                "rating_text": rating_text,
                "rating_score": rating_score,
                "review_count": review_count,
                "supplier": supplier,
                "location": "",
                "extras": extras,
            })

        i += 1

    return cars


async def _set_search_dates(page, pickup_date: str, return_date: str, pickup_time: str, return_time: str):
    """
    Set pickup/return dates and times in the DiscoverCars landing page form.
    Uses Playwright mouse clicks on the react-date-range calendar and CustomSelect time picker.
    """
    from datetime import datetime as dt

    pickup_dt = dt.strptime(pickup_date, "%Y-%m-%d")
    return_dt = dt.strptime(return_date, "%Y-%m-%d")
    pickup_month = pickup_dt.strftime("%b")  # e.g. "Mar"
    return_month = return_dt.strftime("%b")
    pickup_day = str(pickup_dt.day)
    return_day = str(return_dt.day)

    # Click the visible pickup date field (index 2) to open calendar
    pickup_field = page.locator(".DatePicker-CalendarField").nth(2)
    try:
        await pickup_field.click(timeout=5000)
    except Exception:
        # Fallback: click via JS
        await page.evaluate("""() => {
            const fields = document.querySelectorAll('.DatePicker-CalendarField');
            for (const f of fields) {
                const r = f.getBoundingClientRect();
                if (r.width > 0 && r.y > 0 && r.y < 1000) { f.click(); return; }
            }
        }""")
    await page.wait_for_timeout(1500)

    # Helper: find and click a specific day in the visible calendar
    async def click_calendar_day(month_abbr: str, day_num: str) -> bool:
        box = await page.evaluate("""(args) => {
            const [monthAbbr, dayNum] = args;
            const cals = document.querySelectorAll('.rdrCalendarWrapper');
            for (const cal of cals) {
                const rect = cal.getBoundingClientRect();
                if (rect.width === 0 || rect.y < 0) continue;
                const months = cal.querySelectorAll('.rdrMonth');
                for (const month of months) {
                    const mn = month.querySelector('.rdrMonthName');
                    if (mn && mn.textContent.includes(monthAbbr)) {
                        const days = month.querySelectorAll('.rdrDay');
                        for (const day of days) {
                            if (day.classList.contains('rdrDayPassive')) continue;
                            const dn = day.querySelector('.rdrDayNumber span');
                            if (dn && dn.textContent.trim() === dayNum) {
                                const r = day.getBoundingClientRect();
                                return { x: r.x + r.width/2, y: r.y + r.height/2, found: true };
                            }
                        }
                    }
                }
            }
            return { found: false };
        }""", [month_abbr, day_num])
        if box.get("found"):
            await page.mouse.click(box["x"], box["y"])
            await page.wait_for_timeout(1000)
            return True
        return False

    # Navigate calendar to the pickup month if needed
    # The calendar shows 2 months. We may need to click "next" to reach the target month.
    for _ in range(6):  # Max 6 months forward
        months_visible = await page.evaluate("""() => {
            const cals = document.querySelectorAll('.rdrCalendarWrapper');
            const names = [];
            for (const cal of cals) {
                if (cal.getBoundingClientRect().width === 0) continue;
                for (const mn of cal.querySelectorAll('.rdrMonthName')) {
                    names.push(mn.textContent.trim());
                }
            }
            return names;
        }""")
        if any(pickup_month in m for m in months_visible):
            break
        # Click next button
        await page.evaluate("""() => {
            const btns = document.querySelectorAll('.rdrNextPrevButton.rdrNextButton, button.rdrNextButton');
            for (const b of btns) { const r = b.getBoundingClientRect(); if (r.width > 0) { b.click(); return; } }
        }""")
        await page.wait_for_timeout(500)

    # Click pickup day
    if await click_calendar_day(pickup_month, pickup_day):
        print(f"[DiscoverCars] Selected pickup: {pickup_month} {pickup_day}", file=sys.stderr)
    else:
        print(f"[DiscoverCars] WARNING: Could not select pickup day {pickup_month} {pickup_day}", file=sys.stderr)

    # Navigate to return month if different
    if return_month != pickup_month:
        for _ in range(3):
            months_visible = await page.evaluate("""() => {
                const cals = document.querySelectorAll('.rdrCalendarWrapper');
                const names = [];
                for (const cal of cals) {
                    if (cal.getBoundingClientRect().width === 0) continue;
                    for (const mn of cal.querySelectorAll('.rdrMonthName')) {
                        names.push(mn.textContent.trim());
                    }
                }
                return names;
            }""")
            if any(return_month in m for m in months_visible):
                break
            await page.evaluate("""() => {
                const btns = document.querySelectorAll('.rdrNextPrevButton.rdrNextButton, button.rdrNextButton');
                for (const b of btns) { const r = b.getBoundingClientRect(); if (r.width > 0) { b.click(); return; } }
            }""")
            await page.wait_for_timeout(500)

    # Click return day
    if await click_calendar_day(return_month, return_day):
        print(f"[DiscoverCars] Selected return: {return_month} {return_day}", file=sys.stderr)
    else:
        print(f"[DiscoverCars] WARNING: Could not select return day {return_month} {return_day}", file=sys.stderr)

    # Set times using mouse clicks (JS .click() doesn't trigger React state updates)
    async def set_time(wrapper_index: int, target_time: str, label: str = ""):
        """Click the time handler to open dropdown, then mouse-click the target time option."""
        # Step 1: Click the handler to open the dropdown via mouse coordinates
        handler_box = await page.evaluate("""(idx) => {
            const wrappers = document.querySelectorAll('.DatePicker-TimeWrapper');
            let visIdx = 0;
            for (const w of wrappers) {
                const r = w.getBoundingClientRect();
                if (r.width > 0 && r.y > 0 && r.y < 1000) {
                    if (visIdx === idx) {
                        const h = w.querySelector('.CustomSelect-SelectHandler');
                        if (h) {
                            const hr = h.getBoundingClientRect();
                            return { x: hr.x + hr.width/2, y: hr.y + hr.height/2, text: h.textContent.trim() };
                        }
                    }
                    visIdx++;
                }
            }
            return null;
        }""", wrapper_index)

        if not handler_box:
            print(f"[DiscoverCars] WARNING: Could not find time handler #{wrapper_index} for {label}", file=sys.stderr)
            return

        print(f"[DiscoverCars] {label} time handler shows: '{handler_box.get('text', '?')}'", file=sys.stderr)
        await page.mouse.click(handler_box["x"], handler_box["y"])
        await page.wait_for_timeout(800)

        # Step 2: Find the target time option and click it via mouse coordinates
        # scrollIntoView first, then get coordinates, then mouse.click
        option_box = await page.evaluate("""(targetTime) => {
            const options = document.querySelectorAll('.CustomSelect-SelectOption');
            for (const opt of options) {
                if (opt.textContent.trim() === targetTime) {
                    opt.scrollIntoView({ block: 'center' });
                    const r = opt.getBoundingClientRect();
                    return { x: r.x + r.width/2, y: r.y + r.height/2, found: true };
                }
            }
            return { found: false };
        }""", target_time)

        if option_box.get("found"):
            await page.mouse.click(option_box["x"], option_box["y"])
            await page.wait_for_timeout(500)
            print(f"[DiscoverCars] {label} time set to {target_time} (mouse click)", file=sys.stderr)
        else:
            print(f"[DiscoverCars] WARNING: Could not find time option '{target_time}' for {label}", file=sys.stderr)

    # Find visible time wrapper count (use 0-based visible indices, not raw DOM indices)
    visible_tw_count = await page.evaluate("""() => {
        const wrappers = document.querySelectorAll('.DatePicker-TimeWrapper');
        let count = 0;
        for (const w of wrappers) {
            const r = w.getBoundingClientRect();
            if (r.width > 0 && r.y > 0 && r.y < 1000) count++;
        }
        return count;
    }""")
    print(f"[DiscoverCars] Found {visible_tw_count} visible time wrappers", file=sys.stderr)

    if visible_tw_count >= 1:
        await set_time(0, pickup_time, label="Pickup")
    if visible_tw_count >= 2:
        await set_time(1, return_time, label="Return")

    # Verify final form state
    form_state = await page.evaluate("""() => {
        const fields = document.querySelectorAll('.DatePicker-CalendarField');
        const visible = [];
        for (const f of fields) {
            const r = f.getBoundingClientRect();
            if (r.width > 0 && r.y > 0 && r.y < 1000) visible.push(f.textContent.trim());
        }
        const timeWrappers = document.querySelectorAll('.DatePicker-TimeWrapper');
        const times = [];
        for (const tw of timeWrappers) {
            const r = tw.getBoundingClientRect();
            if (r.width > 0 && r.y > 0 && r.y < 1000) {
                const handler = tw.querySelector('.CustomSelect-SelectHandler');
                times.push(handler ? handler.textContent.trim() : 'N/A');
            }
        }
        return { dates: visible, times: times };
    }""")
    print(f"[DiscoverCars] Form state after setting: dates={form_state.get('dates')}, times={form_state.get('times')}", file=sys.stderr)

    await page.wait_for_timeout(500)


LOCATION_URLS = {
    "downtown": "https://www.discovercars.com/switzerland/zurich/downtown",
    "airport": "https://www.discovercars.com/switzerland/zurich/zrh",
    "zurich": "https://www.discovercars.com/switzerland/zurich",
}


async def scrape_discovercars(
    pickup_date: str,
    return_date: str,
    pickup_time: str = "10:00",
    return_time: str = "17:00",
    location: str = "downtown",
    automatic_only: bool = True,
    max_results: int = 30,
) -> dict:
    """
    Scrape DiscoverCars.com for real car rental prices in Zurich.
    Phase 1: Load landing page (downtown, airport, or general zurich)
    Phase 2: Click "Search now" to get full results page
    Phase 3: Scroll and extract all cars
    """
    from playwright.async_api import async_playwright

    base_url = LOCATION_URLS.get(location, LOCATION_URLS["downtown"])
    search_url = base_url
    used_results_page = False

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        ctx = await browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            locale="en-US",
            viewport={"width": 1920, "height": 1080},
        )
        page = await ctx.new_page()

        print(f"[DiscoverCars] Loading {base_url}...", file=sys.stderr)
        await page.goto(base_url, timeout=30000)
        await page.wait_for_load_state("domcontentloaded", timeout=15000)
        await page.wait_for_timeout(5000)

        # Close cookie consent
        try:
            cookie_btn = page.locator("#onetrust-accept-btn-handler")
            if await cookie_btn.count() > 0:
                await cookie_btn.click()
                await page.wait_for_timeout(1000)
        except Exception:
            pass

        # Phase 2: Set dates in the form (calendar dates work, time picker doesn't trigger React)
        # Strategy: submit form to get a valid search UUID, then reload with corrected sq parameter
        print(f"[DiscoverCars] Setting dates: {pickup_date} {pickup_time} → {return_date} {return_time}", file=sys.stderr)
        await _set_search_dates(page, pickup_date, return_date, pickup_time, return_time)

        # Click "Search now" to get a valid search UUID
        on_results_page = False
        for attempt in range(3):
            print(f"[DiscoverCars] Clicking 'Search now' (attempt {attempt + 1})...", file=sys.stderr)
            await page.evaluate("""() => {
                const btns = document.querySelectorAll('button.SearchModifier-SubmitBtn');
                for (const btn of btns) { btn.click(); return; }
            }""")

            await page.wait_for_timeout(12000 + attempt * 5000)
            search_url = page.url

            if "/search/" in page.url:
                on_results_page = True
                break

            if attempt < 2:
                print("[DiscoverCars] Retrying...", file=sys.stderr)
                await page.goto(base_url, timeout=30000)
                await page.wait_for_load_state("domcontentloaded", timeout=15000)
                await page.wait_for_timeout(5000)
                try:
                    cookie_btn = page.locator("#onetrust-accept-btn-handler")
                    if await cookie_btn.count() > 0:
                        await cookie_btn.click()
                        await page.wait_for_timeout(1000)
                except Exception:
                    pass
                await _set_search_dates(page, pickup_date, return_date, pickup_time, return_time)

        # Reload with corrected sq parameter (times may not have been set via the UI)
        if on_results_page:
            import urllib.parse as _urlparse
            import base64 as _b64
            parsed_url = _urlparse.urlparse(page.url)
            search_uuid = parsed_url.path.rstrip("/").split("/")[-1]

            # Extract the ACTUAL location ID from the initial search (don't hardcode 486)
            location_id = 486  # fallback
            try:
                params = _urlparse.parse_qs(parsed_url.query)
                orig_sq = params.get("sq", [""])[0]
                if orig_sq:
                    orig_data = json.loads(_b64.b64decode(orig_sq).decode("utf-8"))
                    location_id = orig_data.get("PickupLocationId", 486)
                    print(f"[DiscoverCars] Extracted location ID: {location_id}", file=sys.stderr)
            except Exception as e:
                print(f"[DiscoverCars] Could not extract location ID, using 486: {e}", file=sys.stderr)

            sq_data = {
                "PickupLocationId": location_id,
                "DropOffLocationId": location_id,
                "PickupDateTime": f"{pickup_date}T{pickup_time}:00",
                "DropOffDateTime": f"{return_date}T{return_time}:00",
                "ResidenceCountry": "CH",
                "DriverAge": 35,
                "Hash": "",
            }
            sq_b64 = _b64.b64encode(json.dumps(sq_data).encode()).decode()
            corrected_url = f"https://www.discovercars.com/search/{search_uuid}?sq={sq_b64}&searchVersion=2"

            print(f"[DiscoverCars] Reloading with corrected times: {pickup_time}/{return_time}", file=sys.stderr)
            await page.goto(corrected_url, timeout=30000)
            await page.wait_for_load_state("domcontentloaded", timeout=15000)
            await page.wait_for_timeout(12000)
            search_url = page.url

            body_check = await page.inner_text("body")
            or_similar_count = body_check.count("or similar")
            print(f"[DiscoverCars] After reload: {or_similar_count} cars on page", file=sys.stderr)
            if or_similar_count == 0:
                on_results_page = False

        # Post-retry: scroll and extract on results page, or fall back to landing page
        if on_results_page:
            used_results_page = True
            prev_count = body_check.count("or similar")
            for scroll_round in range(20):
                await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                await page.wait_for_timeout(2000)
                body_check = await page.inner_text("body")
                new_count = body_check.count("or similar")
                if new_count >= max_results:
                    break
                if new_count == prev_count and scroll_round > 4:
                    break
                prev_count = new_count
            print(f"[DiscoverCars] After scrolling: {prev_count} cars", file=sys.stderr)

            # Try "Show more" button
            try:
                show_more = await page.evaluate("""() => {
                    const btns = document.querySelectorAll('button, a');
                    for (const b of btns) {
                        const txt = (b.textContent || '').trim().toLowerCase();
                        if (txt.includes('show more') || txt.includes('load more') || txt.includes('next page')) {
                            b.click();
                            return true;
                        }
                    }
                    return false;
                }""")
                if show_more:
                    await page.wait_for_timeout(5000)
                    for scroll_round in range(5):
                        await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                        await page.wait_for_timeout(2000)
                    new_count = (await page.inner_text("body")).count("or similar")
                    print(f"[DiscoverCars] After 'Show more': {new_count} cars", file=sys.stderr)
            except Exception:
                pass
        else:
            print("[DiscoverCars] Could not reach results page, using landing page", file=sys.stderr)
            await page.goto(base_url, timeout=30000)
            await page.wait_for_load_state("domcontentloaded", timeout=15000)
            await page.wait_for_timeout(5000)
            search_url = base_url

        # Extract data using two approaches:
        # 1) Card-based DOM extraction (more reliable for supplier/location)
        # 2) Body text + img alts fallback
        body_text = await page.inner_text("body")
        img_alts = await page.evaluate("""
            () => Array.from(document.querySelectorAll('img')).map(img => (img.alt || '').trim())
        """)

        # Card-based extraction for results page
        card_data = []
        if used_results_page:
            card_data = await page.evaluate("""() => {
                const carImages = document.querySelectorAll('img.SearchCar-CarImage');
                const results = [];
                for (const img of carImages) {
                    // Walk up to SearchCar-Content (the full card)
                    let card = img;
                    for (let i = 0; i < 10; i++) {
                        if (!card.parentElement) break;
                        card = card.parentElement;
                        if (card.className && card.className.includes('SearchCar-Content')) break;
                    }
                    // If we didn't find SearchCar-Content, walk up further
                    if (!card.className || !card.className.includes('SearchCar-Content')) {
                        card = img;
                        for (let i = 0; i < 15; i++) {
                            if (!card.parentElement) break;
                            card = card.parentElement;
                        }
                    }

                    const carName = img.alt || '';

                    // Find supplier from img alts within card
                    const allImgs = card.querySelectorAll('img');
                    let supplier = '';
                    for (const si of allImgs) {
                        if (si !== img && si.alt && si.alt !== carName &&
                            !['star', 'Company Logo', 'Powered by Onetrust', 'Discovercars logo'].includes(si.alt) &&
                            si.alt.length > 2 && si.alt.length < 30 &&
                            !si.className.includes('SearchCar-CarImage')) {
                            supplier = si.alt;
                            break;
                        }
                    }

                    // Get full card text for parsing
                    const text = card.innerText || '';

                    results.push({ carName, supplier, text });
                }
                return results;
            }""")
            print(f"[DiscoverCars] Card DOM extraction: {len(card_data)} cards", file=sys.stderr)

        print(f"[DiscoverCars] Body: {len(body_text)} chars, {len(img_alts)} img alts", file=sys.stderr)
        await browser.close()

    # Parse using appropriate parser
    # Note: DiscoverCars counts rental days differently from calendar days
    # (e.g. Fri 13:00 → Sun 17:00 = 3 rental days, not 2 calendar days)
    # So we trust the "Total for N days" text from the page when available.
    fallback_days = max(1, (datetime.strptime(return_date, "%Y-%m-%d") - datetime.strptime(pickup_date, "%Y-%m-%d")).days)

    if used_results_page and card_data:
        all_cars = parse_cards(card_data)
        # Parser already extracted total_price, rental_days, and price_per_day from page text.
        # Only fill in rental_days if parser couldn't find "Total for N days".
        for car in all_cars:
            if not car.get("rental_days") or car["rental_days"] <= 0:
                car["rental_days"] = fallback_days
                car["total_price_chf"] = round(car["price_per_day_chf"] * fallback_days, 2)
    elif used_results_page:
        all_cars = parse_results_page(body_text, img_alts, rental_days_override=fallback_days)
        for car in all_cars:
            if not car.get("rental_days") or car["rental_days"] <= 0:
                car["rental_days"] = fallback_days
                car["total_price_chf"] = round(car["price_per_day_chf"] * fallback_days, 2)
    else:
        all_cars = parse_landing_page(body_text, img_alts)
        for car in all_cars:
            car["rental_days"] = fallback_days
            car["total_price_chf"] = round(car["price_per_day_chf"] * fallback_days, 2)

    print(f"[DiscoverCars] Parsed {len(all_cars)} total cars", file=sys.stderr)

    # Filter
    if automatic_only:
        results = [c for c in all_cars if c["transmission"] == "automatic"]
        print(f"[DiscoverCars] {len(results)} automatic cars after filtering", file=sys.stderr)
    else:
        results = all_cars

    # Sort by price per day
    results.sort(key=lambda c: c["price_per_day_chf"])

    # Limit
    results = results[:max_results]

    # Add source and booking URL
    for r in results:
        r["source"] = "discovercars"
        r["booking_url"] = base_url

    # Use the rental days from the first parsed car (comes from DiscoverCars page text)
    actual_days = results[0]["rental_days"] if results else fallback_days

    return {
        "results": results,
        "search_url": search_url if "/search/" in search_url else base_url,
        "source": "discovercars",
        "total_found": len(all_cars),
        "automatic_count": len([c for c in all_cars if c["transmission"] == "automatic"]),
        "manual_count": len([c for c in all_cars if c["transmission"] == "manual"]),
        "pickup_date": pickup_date,
        "return_date": return_date,
        "rental_days": actual_days,
        "used_results_page": used_results_page,
        "note": "Prices are per-day rates from DiscoverCars. Totals recalculated for your dates. Verify exact pricing via the search URL.",
    }


async def main():
    import argparse
    parser = argparse.ArgumentParser(description="DiscoverCars Scraper")
    parser.add_argument("pickup_date", help="YYYY-MM-DD")
    parser.add_argument("return_date", help="YYYY-MM-DD")
    parser.add_argument("--all", action="store_true", help="Include manual transmission")
    parser.add_argument("--max", type=int, default=30)
    parser.add_argument("--output", "-o", help="Output JSON file")
    args = parser.parse_args()

    result = await scrape_discovercars(
        args.pickup_date, args.return_date,
        automatic_only=not args.all,
        max_results=args.max,
    )

    output = json.dumps(result, indent=2, default=str, ensure_ascii=False)
    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(output)
        print(f"Results written to {args.output}", file=sys.stderr)
    else:
        print(output)


if __name__ == "__main__":
    asyncio.run(main())
