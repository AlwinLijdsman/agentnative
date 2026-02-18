#!/usr/bin/env python3
"""Debug script to extract per-card supplier info from HTML structure."""
import asyncio
from playwright.async_api import async_playwright

async def debug_cards():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        ctx = await browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            locale="en-US", viewport={"width": 1920, "height": 1080})
        page = await ctx.new_page()
        await page.goto("https://www.discovercars.com/switzerland/zurich", timeout=30000)
        await page.wait_for_load_state("domcontentloaded")
        await page.wait_for_timeout(5000)
        await page.evaluate("""() => {
            const btns = document.querySelectorAll('button.SearchModifier-SubmitBtn');
            for (const btn of btns) { btn.click(); return true; }
            return false;
        }""")
        await page.wait_for_timeout(12000)
        for i in range(10):
            await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
            await page.wait_for_timeout(2000)

        # Try different selectors for car cards
        card_info = await page.evaluate("""() => {
            // Look for car card containers
            const carImages = document.querySelectorAll('img.SearchCar-CarImage');
            const results = [];
            for (const img of carImages) {
                // Walk up to find the card container
                let card = img.closest('[class*="SearchCar"]') || img.parentElement?.parentElement?.parentElement;
                if (!card) continue;

                // Try multiple levels up to find the full card
                for (let i = 0; i < 5; i++) {
                    if (card.parentElement && card.parentElement.querySelectorAll('img.SearchCar-CarImage').length === 1) {
                        card = card.parentElement;
                    } else {
                        break;
                    }
                }

                const carName = img.alt;
                // Find supplier logos within this card
                const allImgs = card.querySelectorAll('img');
                const supplierAlts = [];
                for (const si of allImgs) {
                    if (si !== img && si.alt && !si.alt.includes('logo') && si.alt.length > 1) {
                        supplierAlts.push(si.alt);
                    }
                }

                // Also get text content snippet
                const text = card.innerText.substring(0, 500);

                // Get card class hierarchy
                const classes = [];
                let el = card;
                for (let i = 0; i < 3 && el; i++) {
                    classes.push(el.className?.substring(0, 60) || '');
                    el = el.parentElement;
                }

                results.push({
                    carName,
                    supplierAlts,
                    textSnippet: text.substring(0, 200),
                    cardClasses: classes
                });
            }
            return results;
        }""")

        print(f"Found {len(card_info)} car cards:\n")
        for i, card in enumerate(card_info):
            print(f"{i+1}. {card['carName']}")
            print(f"   Supplier alts: {card['supplierAlts']}")
            print(f"   Card classes: {card['cardClasses']}")
            print(f"   Text: {card['textSnippet'][:150]}")
            print()

        await browser.close()

asyncio.run(debug_cards())
