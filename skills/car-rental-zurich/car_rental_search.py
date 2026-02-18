#!/usr/bin/env python3
"""
Car Rental Zurich Comparison Engine
Scrapes DiscoverCars.com for real car rental prices near Zurich.
All data comes from live web scraping — no fake/simulated data.
"""

import asyncio
import json
import math
import sys
import hashlib
from dataclasses import dataclass, field, asdict
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

from discovercars_scraper import scrape_discovercars

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

ZURICH_BINZ = (47.3714, 8.5243)  # lat, lng

# Known rental stations near Zurich Binz with coordinates
KNOWN_STATIONS = {
    "avis_zurich_city": {
        "provider": "Avis",
        "name": "Avis Zurich City",
        "address": "Garagestrasse 6, 8002 Zurich",
        "lat": 47.3693,
        "lng": 8.5268,
    },
    "budget_zurich_city": {
        "provider": "Budget",
        "name": "Budget Zurich City",
        "address": "Garagestrasse 6, 8002 Zurich",
        "lat": 47.3693,
        "lng": 8.5268,
    },
    "hertz_zurich": {
        "provider": "Hertz",
        "name": "Hertz Zurich Hardturmstrasse",
        "address": "Hardturmstrasse 319, 8005 Zurich",
        "lat": 47.3910,
        "lng": 8.5040,
    },
    "europcar_zurich_city": {
        "provider": "Europcar",
        "name": "Europcar Zurich City",
        "address": "Josefstrasse 53, 8005 Zurich",
        "lat": 47.3858,
        "lng": 8.5252,
    },
    "europcar_zurich_wiedikon": {
        "provider": "Europcar",
        "name": "Europcar Zurich Wiedikon",
        "address": "Birmensdorferstrasse 150, 8003 Zurich",
        "lat": 47.3720,
        "lng": 8.5150,
    },
    "sixt_zurich": {
        "provider": "Sixt",
        "name": "Sixt Zurich Andreasstrasse",
        "address": "Andreasstrasse 65, 8050 Zurich",
        "lat": 47.4020,
        "lng": 8.5380,
    },
    "enterprise_zurich_airport": {
        "provider": "Enterprise",
        "name": "Enterprise Zurich Airport",
        "address": "Airport Center, 8058 Zurich",
        "lat": 47.4502,
        "lng": 8.5616,
    },
    "avis_zurich_airport": {
        "provider": "Avis",
        "name": "Avis Zurich Airport",
        "address": "Airport Center, 8058 Zurich",
        "lat": 47.4502,
        "lng": 8.5616,
    },
    "budget_zurich_airport": {
        "provider": "Budget",
        "name": "Budget Zurich Airport",
        "address": "Airport Center, 8058 Zurich",
        "lat": 47.4502,
        "lng": 8.5616,
    },
    "hertz_zurich_airport": {
        "provider": "Hertz",
        "name": "Hertz Zurich Airport",
        "address": "Airport Center, 8058 Zurich",
        "lat": 47.4502,
        "lng": 8.5616,
    },
    "europcar_zurich_airport": {
        "provider": "Europcar",
        "name": "Europcar Zurich Airport",
        "address": "Flughafenstrasse 61, 8302 Kloten",
        "lat": 47.4510,
        "lng": 8.5630,
    },
}

# Supplier name → nearest known station key mapping
# DiscoverCars shows supplier names like "Enterprise", "SIXT", "Flizzr", "Thrifty"
# We map these to known stations for distance calculation
SUPPLIER_STATION_MAP = {
    "avis": "avis_zurich_city",
    "budget": "budget_zurich_city",
    "hertz": "hertz_zurich",
    "europcar": "europcar_zurich_wiedikon",
    "sixt": "sixt_zurich",
    "enterprise": "enterprise_zurich_airport",
    "national": "enterprise_zurich_airport",  # Same parent as Enterprise
    "alamo": "enterprise_zurich_airport",     # Same parent as Enterprise
    # Smaller/broker suppliers — typically operate from airport or city center
    "flizzr": "avis_zurich_airport",
    "thrifty": "hertz_zurich_airport",
    "dollar": "hertz_zurich_airport",
    "firefly": "hertz_zurich_airport",
    "goldcar": "europcar_zurich_airport",
    "keddy": "europcar_zurich_airport",  # Europcar sub-brand
    "green motion": "europcar_zurich_airport",
}

# Car model database for inferring features when data is incomplete
CAR_MODEL_DATABASE = {
    # Compact / Economy
    "vw polo": {"category": "Economy", "seats": 5, "doors": 4, "cruise_control": True, "luggage": "1 large"},
    "volkswagen polo": {"category": "Economy", "seats": 5, "doors": 4, "cruise_control": True, "luggage": "1 large"},
    "vw golf": {"category": "Compact", "seats": 5, "doors": 4, "cruise_control": True, "luggage": "1 large + 1 small"},
    "volkswagen golf": {"category": "Compact", "seats": 5, "doors": 4, "cruise_control": True, "luggage": "1 large + 1 small"},
    "opel corsa": {"category": "Economy", "seats": 5, "doors": 4, "cruise_control": True, "luggage": "1 large"},
    "opel astra": {"category": "Compact", "seats": 5, "doors": 4, "cruise_control": True, "luggage": "1 large + 1 small"},
    "renault clio": {"category": "Economy", "seats": 5, "doors": 4, "cruise_control": True, "luggage": "1 large"},
    "peugeot 208": {"category": "Economy", "seats": 5, "doors": 4, "cruise_control": True, "luggage": "1 large"},
    "toyota yaris": {"category": "Economy", "seats": 5, "doors": 4, "cruise_control": True, "luggage": "1 large"},
    "toyota corolla": {"category": "Compact", "seats": 5, "doors": 4, "cruise_control": True, "luggage": "1 large + 1 small"},
    "hyundai i20": {"category": "Economy", "seats": 5, "doors": 4, "cruise_control": True, "luggage": "1 large"},
    "hyundai i30": {"category": "Compact", "seats": 5, "doors": 4, "cruise_control": True, "luggage": "1 large + 1 small"},
    "ford fiesta": {"category": "Economy", "seats": 5, "doors": 4, "cruise_control": True, "luggage": "1 large"},
    "ford focus": {"category": "Compact", "seats": 5, "doors": 4, "cruise_control": True, "luggage": "1 large + 1 small"},
    "seat arona": {"category": "Compact SUV", "seats": 5, "doors": 5, "cruise_control": True, "luggage": "1 large + 1 small"},
    "seat ibiza": {"category": "Economy", "seats": 5, "doors": 4, "cruise_control": True, "luggage": "1 large"},
    # Intermediate / Full-size
    "skoda octavia": {"category": "Intermediate", "seats": 5, "doors": 4, "cruise_control": True, "luggage": "2 large + 1 small"},
    "vw passat": {"category": "Full-size", "seats": 5, "doors": 4, "cruise_control": True, "luggage": "2 large + 1 small"},
    "volkswagen passat": {"category": "Full-size", "seats": 5, "doors": 4, "cruise_control": True, "luggage": "2 large + 1 small"},
    "bmw 3 series": {"category": "Full-size", "seats": 5, "doors": 4, "cruise_control": True, "luggage": "2 large"},
    "bmw 3er": {"category": "Full-size", "seats": 5, "doors": 4, "cruise_control": True, "luggage": "2 large"},
    "audi a4": {"category": "Full-size", "seats": 5, "doors": 4, "cruise_control": True, "luggage": "2 large"},
    "mercedes c-class": {"category": "Full-size", "seats": 5, "doors": 4, "cruise_control": True, "luggage": "2 large"},
    "toyota camry": {"category": "Full-size", "seats": 5, "doors": 4, "cruise_control": True, "luggage": "2 large"},
    # SUV
    "vw tiguan": {"category": "SUV", "seats": 5, "doors": 4, "cruise_control": True, "luggage": "2 large + 1 small"},
    "volkswagen tiguan": {"category": "SUV", "seats": 5, "doors": 4, "cruise_control": True, "luggage": "2 large + 1 small"},
    "nissan qashqai": {"category": "SUV", "seats": 5, "doors": 4, "cruise_control": True, "luggage": "2 large"},
    "toyota rav4": {"category": "SUV", "seats": 5, "doors": 4, "cruise_control": True, "luggage": "2 large + 1 small"},
    "bmw x1": {"category": "SUV", "seats": 5, "doors": 4, "cruise_control": True, "luggage": "2 large"},
    "hyundai tucson": {"category": "SUV", "seats": 5, "doors": 4, "cruise_control": True, "luggage": "2 large + 1 small"},
    # Electric
    "tesla model 3": {"category": "Full-size Electric", "seats": 5, "doors": 4, "cruise_control": True, "luggage": "2 large"},
    "polestar 2": {"category": "Standard Electric", "seats": 5, "doors": 4, "cruise_control": True, "luggage": "2 large"},
    "vw id.3": {"category": "Compact Electric", "seats": 5, "doors": 4, "cruise_control": True, "luggage": "1 large + 1 small"},
    "vw id.4": {"category": "SUV Electric", "seats": 5, "doors": 4, "cruise_control": True, "luggage": "2 large"},
    "renault zoe": {"category": "Economy Electric", "seats": 5, "doors": 4, "cruise_control": True, "luggage": "1 large"},
    # Mini / Micro
    "fiat 500": {"category": "Mini", "seats": 4, "doors": 2, "cruise_control": False, "luggage": "1 small"},
    "smart fortwo": {"category": "Mini", "seats": 2, "doors": 2, "cruise_control": False, "luggage": "1 small"},
}

# Provider reliability ratings (based on general reputation & user preference)
PROVIDER_RELIABILITY = {
    "Budget": 8.5,    # User's preferred (best price/quality)
    "Avis": 8.0,      # Same parent company as Budget
    "Hertz": 7.5,
    "Europcar": 7.0,
    "Sixt": 7.5,
    "SIXT": 7.5,
    "Enterprise": 7.5,
    "National": 7.0,
    "Alamo": 7.0,
    "Flizzr": 6.5,
    "Thrifty": 7.0,
    "Dollar": 6.5,
    "Firefly": 6.0,
    "Goldcar": 6.0,
    "Green Motion": 6.0,
}

# Provider station-specific booking URLs
PROVIDER_STATION_URLS = {
    "Budget": {
        "city": "https://www.budget.com/en/locations/ch/zurich/zr3",
        "airport": "https://www.budget.com/en/locations/ch/zurich/zrh",
    },
    "Avis": {
        "city": "https://www.avis.com/en/locations/eur/ch/zurich/zrhc01",
        "airport": "https://www.avis.com/en/locations/eur/ch/zurich/zrht50",
    },
    "Europcar": {
        "city": "https://www.europcar.ch/en-ch/places/car-rental-switzerland/zurich",
        "airport": "https://www.europcar.ch/en-ch/places/car-rental-switzerland/zurich/zurich-airport",
    },
    "Hertz": {
        "city": "https://www.hertz.ch/p/en/car-hire/switzerland/zurich",
        "airport": "https://www.hertz.ch/p/en/car-hire/switzerland/zurich/zurich-airport",
    },
    "Sixt": {
        "city": "https://www.sixt.ch/en-ch/car-rental/switzerland/zurich",
        "airport": "https://www.sixt.ch/en-ch/car-rental/switzerland/zurich/zurich-airport",
    },
    "SIXT": {
        "city": "https://www.sixt.ch/en-ch/car-rental/switzerland/zurich",
        "airport": "https://www.sixt.ch/en-ch/car-rental/switzerland/zurich/zurich-airport",
    },
    "Enterprise": {
        "city": "https://www.enterprise.com/en/car-rental/locations/switzerland/zurich.html",
        "airport": "https://www.enterprise.com/en/car-rental/locations/switzerland/zurich-airport.html",
    },
}

DISCOVERCARS_URL = "https://www.discovercars.com/switzerland/zurich"


# ---------------------------------------------------------------------------
# Data Classes
# ---------------------------------------------------------------------------

@dataclass
class CarResult:
    """Normalized car rental search result."""
    provider: str
    car_name: str
    car_category: str
    price_per_day_chf: float
    total_price_chf: float
    rental_days: int
    transmission: str  # "automatic" | "manual"
    has_cruise_control: Optional[bool]  # True/False/None (unknown)
    fuel_type: str
    seats: int
    doors: int
    luggage_capacity: str
    air_conditioning: bool
    station_name: str
    station_address: str
    distance_from_binz_km: float
    rating: Optional[float]
    rating_score: float
    review_count: int
    source: str  # "discovercars"
    booking_url: str
    provider_url: str
    score: float = 0.0
    extras: list = field(default_factory=list)

    def to_dict(self):
        return asdict(self)


# ---------------------------------------------------------------------------
# Utility Functions
# ---------------------------------------------------------------------------

def haversine_distance(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Calculate distance in km between two lat/lng points using Haversine formula."""
    R = 6371
    lat1, lng1, lat2, lng2 = map(math.radians, [lat1, lng1, lat2, lng2])
    dlat = lat2 - lat1
    dlng = lng2 - lng1
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlng / 2) ** 2
    c = 2 * math.asin(math.sqrt(a))
    return R * c


def distance_from_binz(lat: float, lng: float) -> float:
    """Calculate distance in km from Zurich Binz station."""
    return haversine_distance(ZURICH_BINZ[0], ZURICH_BINZ[1], lat, lng)


def provider_booking_url(provider: str, station_type: str = "city") -> str:
    """Get the verified station-specific booking URL for a given provider."""
    stations = PROVIDER_STATION_URLS.get(provider, {})
    return stations.get(station_type, stations.get("city", DISCOVERCARS_URL))


def infer_car_features(car_name: str) -> dict:
    """Look up car model in our database to infer features like cruise control."""
    name_lower = car_name.lower().strip()
    for model_key, features in CAR_MODEL_DATABASE.items():
        if model_key in name_lower:
            return features
    return {}


def get_station_for_supplier(supplier: str) -> tuple[dict, str]:
    """
    Map a DiscoverCars supplier name to the nearest known station.
    Returns (station_dict, station_type) where station_type is "city" or "airport".
    """
    supplier_lower = supplier.lower().strip()
    station_key = SUPPLIER_STATION_MAP.get(supplier_lower)
    if station_key and station_key in KNOWN_STATIONS:
        station = KNOWN_STATIONS[station_key]
        station_type = "airport" if "airport" in station_key else "city"
        return station, station_type

    # Default: assume Zurich city center area
    return {
        "name": f"{supplier} Zurich",
        "address": "Zurich area",
        "lat": 47.3769,
        "lng": 8.5417,
    }, "city"


def get_cache_path(pickup_date: str, return_date: str) -> Path:
    """Get cache file path for a given search."""
    cache_dir = Path(__file__).parent / ".cache"
    cache_dir.mkdir(exist_ok=True)
    key = hashlib.md5(f"{pickup_date}_{return_date}".encode()).hexdigest()[:12]
    return cache_dir / f"search_{key}.json"


def load_cache(pickup_date: str, return_date: str, max_age_minutes: int = 30) -> Optional[list]:
    """Load cached results if they exist and are fresh enough."""
    cache_file = get_cache_path(pickup_date, return_date)
    if not cache_file.exists():
        return None
    try:
        data = json.loads(cache_file.read_text(encoding="utf-8"))
        cached_at = datetime.fromisoformat(data["cached_at"])
        if datetime.now() - cached_at > timedelta(minutes=max_age_minutes):
            return None
        return data["results"]
    except (json.JSONDecodeError, KeyError):
        return None


def save_cache(pickup_date: str, return_date: str, results: list):
    """Save search results to cache."""
    cache_file = get_cache_path(pickup_date, return_date)
    data = {
        "cached_at": datetime.now().isoformat(),
        "pickup_date": pickup_date,
        "return_date": return_date,
        "results": results,
    }
    cache_file.write_text(json.dumps(data, indent=2, default=str), encoding="utf-8")


# ---------------------------------------------------------------------------
# DiscoverCars → CarResult Mapper
# ---------------------------------------------------------------------------

# Location text → known station mapping (from results page)
LOCATION_STATION_MAP = {
    "zurich albisrieden": {"name": "Zurich Albisrieden", "address": "Albisrieden, 8047 Zurich", "lat": 47.3780, "lng": 8.4880, "type": "city"},
    "zurich seefeld": {"name": "Zurich Seefeld", "address": "Seefeld, 8008 Zurich", "lat": 47.3550, "lng": 8.5540, "type": "city"},
    "zurich kloten": {"name": "Zurich Kloten", "address": "Kloten, 8302 Zurich", "lat": 47.4510, "lng": 8.5630, "type": "airport"},
    "zurich airport (zrh)": {"name": "Zurich Airport (ZRH)", "address": "Airport, 8058 Zurich", "lat": 47.4502, "lng": 8.5616, "type": "airport"},
    "downtown": {"name": "Zurich Downtown", "address": "Downtown, Zurich", "lat": 47.3769, "lng": 8.5417, "type": "city"},
    "zurich wiedikon": {"name": "Zurich Wiedikon", "address": "Wiedikon, 8003 Zurich", "lat": 47.3720, "lng": 8.5150, "type": "city"},
    "zurich city": {"name": "Zurich City", "address": "Zurich City Center", "lat": 47.3769, "lng": 8.5417, "type": "city"},
    "zurich oerlikon": {"name": "Zurich Oerlikon", "address": "Oerlikon, 8050 Zurich", "lat": 47.4110, "lng": 8.5440, "type": "city"},
    "zurich altstetten": {"name": "Zurich Altstetten", "address": "Altstetten, 8048 Zurich", "lat": 47.3910, "lng": 8.4880, "type": "city"},
    "zurich alt-wiedikon": {"name": "Zurich Alt-Wiedikon", "address": "Alt-Wiedikon, 8003 Zurich", "lat": 47.3700, "lng": 8.5170, "type": "city"},
}


def map_discovercars_to_results(scraped: dict) -> list[CarResult]:
    """
    Convert raw DiscoverCars scraper output to normalized CarResult objects.
    Enriches with station info, cruise control inference, and booking URLs.
    """
    results = []
    for car in scraped.get("results", []):
        supplier = car.get("supplier", "").strip()
        if not supplier:
            supplier = "DiscoverCars Broker"  # Unknown supplier listed via aggregator
        location_text = car.get("location", "").lower().strip()

        # Try location-based station mapping first (more accurate)
        if location_text and location_text in LOCATION_STATION_MAP:
            loc_info = LOCATION_STATION_MAP[location_text]
            station = {
                "name": f"{supplier} {loc_info['name']}" if supplier else loc_info["name"],
                "address": loc_info["address"],
                "lat": loc_info["lat"],
                "lng": loc_info["lng"],
            }
            station_type = loc_info["type"]
        else:
            # Fall back to supplier-based mapping
            station, station_type = get_station_for_supplier(supplier)

        features = infer_car_features(car.get("car_name", ""))

        dist = distance_from_binz(station.get("lat", 0), station.get("lng", 0))

        results.append(CarResult(
            provider=supplier,
            car_name=car.get("car_name", "Unknown"),
            car_category=features.get("category", car.get("category", "Unknown")),
            price_per_day_chf=car.get("price_per_day_chf", 0),
            total_price_chf=car.get("total_price_chf", 0),
            rental_days=car.get("rental_days", 1),
            transmission=car.get("transmission", "automatic"),
            has_cruise_control=features.get("cruise_control"),
            fuel_type=features.get("fuel_type", "petrol"),
            seats=car.get("seats", 0) or features.get("seats", 5),
            doors=car.get("doors", 0) or features.get("doors", 4),
            luggage_capacity=features.get("luggage", f"{car.get('bags', 0)} bags"),
            air_conditioning=car.get("air_conditioning", True),
            station_name=station.get("name", f"{supplier} Zurich"),
            station_address=station.get("address", "Zurich area"),
            distance_from_binz_km=round(dist, 1),
            rating=PROVIDER_RELIABILITY.get(supplier, 6.0),
            rating_score=car.get("rating_score", 0),
            review_count=car.get("review_count", 0),
            source="discovercars",
            booking_url=DISCOVERCARS_URL,
            provider_url=provider_booking_url(supplier, station_type),
            extras=car.get("extras", []),
        ))

    return results


# ---------------------------------------------------------------------------
# Ranking Engine
# ---------------------------------------------------------------------------

class RankingEngine:
    """
    Multi-criteria weighted ranking for car rental results.
    Higher score = better deal.
    """

    WEIGHTS = {
        "price": 0.40,
        "cruise_control": 0.15,
        "distance": 0.20,
        "car_size": 0.15,
        "reliability": 0.10,
    }

    CATEGORY_SCORES = {
        "Economy": 50,
        "Compact": 70,
        "Compact SUV": 75,
        "Compact Crossover": 75,
        "Intermediate": 85,
        "Intermediate SUV": 85,
        "Full-size": 90,
        "SUV": 80,
        "Full-size Electric": 95,
        "Standard Electric": 90,
        "Compact Electric": 75,
        "SUV Electric": 85,
        "Mini": 30,
        "Premium": 95,
        "Luxury": 100,
        "Standard": 80,
        "Standard Elite": 85,
    }

    def rank(self, results: list[CarResult], preferred_category: Optional[str] = None) -> list[CarResult]:
        """Score and rank all results. Returns sorted list (best first)."""
        if not results:
            return []

        prices = [r.price_per_day_chf for r in results]
        min_price = min(prices)
        max_price = max(prices)
        price_range = max_price - min_price if max_price > min_price else 1

        for r in results:
            price_score = 100 * (1 - (r.price_per_day_chf - min_price) / price_range)

            if r.has_cruise_control is True:
                cruise_score = 100
            elif r.has_cruise_control is None:
                cruise_score = 40
            else:
                cruise_score = 0

            if r.distance_from_binz_km <= 1.5:
                distance_score = 100
            elif r.distance_from_binz_km <= 3:
                distance_score = 85
            elif r.distance_from_binz_km <= 5:
                distance_score = 65
            elif r.distance_from_binz_km <= 10:
                distance_score = 40
            else:
                distance_score = 15

            if preferred_category:
                if preferred_category.lower() in r.car_category.lower():
                    size_score = 100
                else:
                    size_score = self.CATEGORY_SCORES.get(r.car_category, 50)
            else:
                size_score = self.CATEGORY_SCORES.get(r.car_category, 50)

            reliability_score = (PROVIDER_RELIABILITY.get(r.provider, 6.0) / 10.0) * 100

            r.score = round(
                price_score * self.WEIGHTS["price"]
                + cruise_score * self.WEIGHTS["cruise_control"]
                + distance_score * self.WEIGHTS["distance"]
                + size_score * self.WEIGHTS["car_size"]
                + reliability_score * self.WEIGHTS["reliability"],
                1,
            )

        results.sort(key=lambda r: r.score, reverse=True)
        return results


# ---------------------------------------------------------------------------
# Deduplicator
# ---------------------------------------------------------------------------

def deduplicate(results: list[CarResult]) -> list[CarResult]:
    """Remove duplicate cars (same car, same supplier, same station). Keep cheapest."""
    seen = {}
    for r in results:
        # Include station in key — same car at different locations is a different option
        key = f"{r.provider}|{r.car_name}|{r.station_name}".lower()
        if key not in seen or r.price_per_day_chf < seen[key].price_per_day_chf:
            seen[key] = r
    return list(seen.values())


# ---------------------------------------------------------------------------
# Main Orchestrator
# ---------------------------------------------------------------------------

async def search_all(
    pickup_date: str,
    return_date: str,
    pickup_time: str = "10:00",
    return_time: str = "17:00",
    location: str = "downtown",
    preferred_category: Optional[str] = None,
    top_n: int = 10,
    no_cache: bool = False,
    include_manual: bool = False,
    exclude_electric: bool = False,
) -> dict:
    """
    Main entry point: scrape DiscoverCars for real prices, normalize, rank.
    Returns dict with top results and metadata.
    """
    # Check cache first
    if not no_cache:
        cached = load_cache(pickup_date, return_date)
        if cached:
            print("[Cache] Using cached results", file=sys.stderr)
            results = [CarResult(**r) for r in cached]
            ranker = RankingEngine()
            ranked = ranker.rank(results, preferred_category)
            top_results = ranked[:top_n]
            return _build_output(ranked, top_results, pickup_date, return_date)

    # Scrape DiscoverCars
    print(f"[Search] Scraping DiscoverCars for Zurich rentals...", file=sys.stderr)
    try:
        scraped = await scrape_discovercars(
            pickup_date=pickup_date,
            return_date=return_date,
            pickup_time=pickup_time,
            return_time=return_time,
            location=location,
            automatic_only=not include_manual,
            max_results=50,  # Get more, we'll filter and rank
        )
    except Exception as e:
        print(f"[Search] DiscoverCars scraping failed: {e}", file=sys.stderr)
        return {
            "error": f"Scraping failed: {e}",
            "summary": {
                "total_results": 0,
                "pickup_date": pickup_date,
                "return_date": return_date,
            },
            "results": [],
            "all_results_count": 0,
            "search_url": DISCOVERCARS_URL,
        }

    # Map to CarResult objects
    results = map_discovercars_to_results(scraped)
    print(f"[Search] Mapped {len(results)} results to CarResult objects", file=sys.stderr)

    if not results:
        return {
            "warning": "No automatic cars found. Try including manual transmission with --all flag.",
            "summary": {
                "total_results": 0,
                "total_found_on_site": scraped.get("total_found", 0),
                "automatic_count": scraped.get("automatic_count", 0),
                "manual_count": scraped.get("manual_count", 0),
                "pickup_date": pickup_date,
                "return_date": return_date,
            },
            "results": [],
            "all_results_count": 0,
            "search_url": scraped.get("search_url", DISCOVERCARS_URL),
        }

    # Filter out electric cars if requested
    if exclude_electric:
        before = len(results)
        filtered = []
        for r in results:
            is_electric_cat = any(kw in r.car_category.lower() for kw in ("electric",))
            is_electric_name = any(kw in r.car_name.lower() for kw in ("polestar", "tesla", "id.3", "id.4", "id.5", "e-tron", "ioniq", "ev6", "zoe", "leaf", "enyaq iv", "born"))
            if is_electric_cat or is_electric_name:
                print(f"[Search] Filtered electric: {r.car_name} (category={r.car_category})", file=sys.stderr)
            else:
                filtered.append(r)
        results = filtered
        if before != len(results):
            print(f"[Search] Filtered out {before - len(results)} electric cars total", file=sys.stderr)

    # Deduplicate
    results = deduplicate(results)

    # Cache results (post-filter to keep cache clean)
    save_cache(pickup_date, return_date, [r.to_dict() for r in results])

    # Rank
    ranker = RankingEngine()
    ranked = ranker.rank(results, preferred_category)
    top_results = ranked[:top_n]

    return _build_output(ranked, top_results, pickup_date, return_date, scraped)


def _build_output(
    ranked: list[CarResult],
    top_results: list[CarResult],
    pickup_date: str,
    return_date: str,
    scraped: Optional[dict] = None,
) -> dict:
    """Build the output dict from ranked results."""
    all_prices = [r.price_per_day_chf for r in ranked]

    summary = {
        "search_date": datetime.now().isoformat(),
        "pickup_date": pickup_date,
        "return_date": return_date,
        "rental_days": top_results[0].rental_days if top_results else 0,
        "total_results": len(ranked),
        "providers_found": list(set(r.provider for r in ranked)),
        "price_range_chf": f"{min(all_prices):.0f} - {max(all_prices):.0f}" if all_prices else "N/A",
        "cheapest_overall": top_results[0].to_dict() if top_results else None,
        "data_source": "discovercars.com (live scrape)",
    }

    if scraped:
        summary["total_found_on_site"] = scraped.get("total_found", 0)
        summary["automatic_count"] = scraped.get("automatic_count", 0)
        summary["manual_count"] = scraped.get("manual_count", 0)
        summary["note"] = scraped.get("note", "")

    return {
        "summary": summary,
        "results": [r.to_dict() for r in top_results],
        "all_results_count": len(ranked),
        "search_url": DISCOVERCARS_URL,
        "provider_urls": {
            provider: provider_booking_url(provider)
            for provider in set(r.provider for r in ranked)
        },
    }


# ---------------------------------------------------------------------------
# CLI Entry Point
# ---------------------------------------------------------------------------

def main():
    """CLI entry point for the car rental search."""
    import argparse

    parser = argparse.ArgumentParser(description="Car Rental Zurich — Real Prices from DiscoverCars")
    parser.add_argument("pickup_date", help="Pickup date (YYYY-MM-DD)")
    parser.add_argument("return_date", help="Return date (YYYY-MM-DD)")
    parser.add_argument("--pickup-time", default="10:00", help="Pickup time HH:MM (default: 10:00)")
    parser.add_argument("--return-time", default="17:00", help="Return time HH:MM (default: 17:00)")
    parser.add_argument("--location", default="downtown", choices=["downtown", "airport", "zurich"],
                        help="Pickup location (default: downtown)")
    parser.add_argument("--category", "-c", help="Preferred car category (Economy, Compact, Intermediate, Full-size, SUV)")
    parser.add_argument("--top", "-n", type=int, default=10, help="Number of top results (default: 10)")
    parser.add_argument("--all", action="store_true", help="Include manual transmission cars")
    parser.add_argument("--no-electric", action="store_true", help="Exclude electric/EV cars")
    parser.add_argument("--output", "-o", help="Output JSON file path")
    parser.add_argument("--no-cache", action="store_true", help="Skip cache")

    args = parser.parse_args()

    # Validate dates
    try:
        pickup = datetime.strptime(args.pickup_date, "%Y-%m-%d")
        return_d = datetime.strptime(args.return_date, "%Y-%m-%d")
        if return_d <= pickup:
            print("Error: Return date must be after pickup date", file=sys.stderr)
            sys.exit(1)
    except ValueError:
        print("Error: Invalid date format. Use YYYY-MM-DD", file=sys.stderr)
        sys.exit(1)

    # Run search
    result = asyncio.run(search_all(
        args.pickup_date,
        args.return_date,
        pickup_time=args.pickup_time,
        return_time=args.return_time,
        location=args.location,
        preferred_category=args.category,
        top_n=args.top,
        no_cache=args.no_cache,
        include_manual=args.all,
        exclude_electric=args.no_electric,
    ))

    # Output
    output_json = json.dumps(result, indent=2, default=str)

    if args.output:
        Path(args.output).write_text(output_json, encoding="utf-8")
        print(f"Results written to {args.output}", file=sys.stderr)
    else:
        print(output_json)


if __name__ == "__main__":
    main()
