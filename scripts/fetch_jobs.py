#!/usr/bin/env python3
"""
Fetches current job postings located in Texas, USA from free job-data APIs,
filters them to postings no older than MAX_DAYS_OLD, de-duplicates, and
writes the result to data/jobs.json for the static site to read.

Data sources (both free, both legitimate/ToS-compliant public APIs):
  - Adzuna Job Search API   -> https://developer.adzuna.com/
  - USAJobs API (federal)   -> https://developer.usajobs.gov/

Required environment variables (set as GitHub Actions secrets):
  ADZUNA_APP_ID
  ADZUNA_APP_KEY
  USAJOBS_API_KEY
  USAJOBS_EMAIL   (the email you registered with USAJobs — sent as User-Agent)

Output: data/jobs.json
{
  "generated_at": "2026-08-06T12:00:00Z",
  "max_days_old": 20,
  "job_count": 123,
  "jobs": [
    {
      "id": "adzuna-123456",
      "title": "Machine Learning Engineer",
      "company": "Acme Corp",
      "city": "Austin",
      "state": "TX",
      "posted_date": "2026-07-28",
      "days_old": 9,
      "url": "https://...",
      "source": "Adzuna",
      "salary": "120000-150000",
      "description": "short snippet ..."
    },
    ...
  ]
}
"""

import json
import os
import sys
from datetime import datetime, timezone, date
import time

import requests

MAX_DAYS_OLD = 20
OUTPUT_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "jobs.json")

TEXAS_CITIES = [
    "Austin", "Houston", "Dallas", "San Antonio", "Fort Worth", "El Paso",
    "Arlington", "Corpus Christi", "Plano", "Irving", "Lubbock", "Frisco",
    "Garland", "McKinney", "Amarillo", "Grand Prairie", "Brownsville",
    "Killeen", "Denton", "Waco", "Round Rock", "Richardson", "Sugar Land",
    "College Station", "Pearland", "Tyler", "Abilene", "Beaumont",
    "The Woodlands", "Odessa", "Midland", "San Marcos", "New Braunfels",
]


def days_since(iso_date_str):
    try:
        posted = datetime.fromisoformat(iso_date_str.replace("Z", "+00:00"))
        if posted.tzinfo is None:
            posted = posted.replace(tzinfo=timezone.utc)
        delta = datetime.now(timezone.utc) - posted
        return delta.days
    except Exception:
        return None


def fetch_adzuna():
    """Pull Texas-wide postings from Adzuna, paging until results run past MAX_DAYS_OLD."""
    app_id = os.environ.get("ADZUNA_APP_ID")
    app_key = os.environ.get("ADZUNA_APP_KEY")
    if not app_id or not app_key:
        print("Adzuna: skipping, ADZUNA_APP_ID / ADZUNA_APP_KEY not set", file=sys.stderr)
        return []

    results = []
    for page in range(1, 6):  # up to 5 pages (~250 jobs) per run, plenty for a 20-day window
        url = f"https://api.adzuna.com/v1/api/jobs/us/search/{page}"
        params = {
            "app_id": app_id,
            "app_key": app_key,
            "results_per_page": 50,
            "where": "Texas",
            "max_days_old": MAX_DAYS_OLD,
            "sort_by": "date",
            "content-type": "application/json",
        }
        try:
            resp = requests.get(url, params=params, timeout=30)
            resp.raise_for_status()
            payload = resp.json()
        except Exception as exc:
            print(f"Adzuna: request failed on page {page}: {exc}", file=sys.stderr)
            break

        items = payload.get("results", [])
        if not items:
            break

        for job in items:
            posted_date = job.get("created", "")[:10]
            age = days_since(job.get("created", ""))
            if age is not None and age > MAX_DAYS_OLD:
                continue
            location_parts = job.get("location", {}).get("area", [])
            city = location_parts[-1] if location_parts else job.get("location", {}).get("display_name", "")
            results.append({
                "id": f"adzuna-{job.get('id')}",
                "title": job.get("title", "").strip(),
                "company": (job.get("company") or {}).get("display_name", "Undisclosed"),
                "city": city,
                "state": "TX",
                "posted_date": posted_date,
                "days_old": age,
                "url": job.get("redirect_url", ""),
                "source": "Adzuna",
                "salary": _salary_range(job),
                "description": (job.get("description") or "")[:280],
            })
        time.sleep(0.5)  # be polite to the API
    return results


def _salary_range(job):
    lo, hi = job.get("salary_min"), job.get("salary_max")
    if lo and hi:
        return f"${int(lo):,} - ${int(hi):,}"
    return ""


def fetch_usajobs():
    """Pull federal postings located in Texas from USAJobs."""
    api_key = os.environ.get("USAJOBS_API_KEY")
    email = os.environ.get("USAJOBS_EMAIL")
    if not api_key or not email:
        print("USAJobs: skipping, USAJOBS_API_KEY / USAJOBS_EMAIL not set", file=sys.stderr)
        return []

    headers = {
        "Host": "data.usajobs.gov",
        "User-Agent": email,
        "Authorization-Key": api_key,
    }
    params = {
        "LocationName": "Texas",
        "DatePosted": MAX_DAYS_OLD,
        "ResultsPerPage": 250,
    }
    try:
        resp = requests.get("https://data.usajobs.gov/api/search", headers=headers, params=params, timeout=30)
        resp.raise_for_status()
        payload = resp.json()
    except Exception as exc:
        print(f"USAJobs: request failed: {exc}", file=sys.stderr)
        return []

    results = []
    items = payload.get("SearchResult", {}).get("SearchResultItems", [])
    for item in items:
        d = item.get("MatchedObjectDescriptor", {})
        posted_date = (d.get("PublicationStartDate") or "")[:10]
        age = days_since(d.get("PublicationStartDate", "")) if d.get("PublicationStartDate") else None
        if age is not None and age > MAX_DAYS_OLD:
            continue
        locations = d.get("PositionLocation", [])
        city = locations[0].get("CityName", "").split(",")[0] if locations else "Texas"
        salary_range = ""
        remun = d.get("PositionRemuneration", [])
        if remun:
            lo = remun[0].get("MinimumRange")
            hi = remun[0].get("MaximumRange")
            if lo and hi:
                salary_range = f"${float(lo):,.0f} - ${float(hi):,.0f}"
        results.append({
            "id": f"usajobs-{d.get('PositionID')}",
            "title": d.get("PositionTitle", "").strip(),
            "company": d.get("OrganizationName", "U.S. Government"),
            "city": city,
            "state": "TX",
            "posted_date": posted_date,
            "days_old": age,
            "url": d.get("PositionURI", ""),
            "source": "USAJobs",
            "salary": salary_range,
            "description": (d.get("UserArea", {}).get("Details", {}).get("JobSummary", "") or "")[:280],
        })
    return results


def dedupe(jobs):
    seen = set()
    unique = []
    for j in jobs:
        key = (j["title"].lower(), j["company"].lower(), j["city"].lower())
        if key in seen:
            continue
        seen.add(key)
        unique.append(j)
    return unique


def main():
    all_jobs = []
    all_jobs.extend(fetch_adzuna())
    all_jobs.extend(fetch_usajobs())

    all_jobs = dedupe(all_jobs)
    all_jobs = [j for j in all_jobs if j["days_old"] is None or j["days_old"] <= MAX_DAYS_OLD]
    all_jobs.sort(key=lambda j: (j["days_old"] if j["days_old"] is not None else 999))

    output = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "max_days_old": MAX_DAYS_OLD,
        "job_count": len(all_jobs),
        "jobs": all_jobs,
    }

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    print(f"Wrote {len(all_jobs)} jobs to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
