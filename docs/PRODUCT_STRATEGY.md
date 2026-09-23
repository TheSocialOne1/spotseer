# SpotSeer: Product Audit & Strategy (v2)

*September 2026. Written after rebuilding the pilot app from the ground up.*

## The one-paragraph verdict

The first version worked, but it wasn't a parking-intelligence product. It was five hand-placed pins on one block (two of them "your spot") with four buttons each, and it measured nothing. Your hypothesis is *"real-time information reduces parking search time,"* and v1 couldn't test it because it never recorded how long anyone searched. v2 is built around that measurement: every search is timed from "Find parking" to "I parked," every report can be linked to the park it enabled, and every report fades on a clock so stale information is never shown as fresh. The biggest risk to SpotSeer isn't the UI. It's **liquidity**: whether enough neighbors report often enough, in a small enough area, at the hours that matter. Everything below is organized around finding that out cheaply.

---

## 1. Audit of v1

### Product
| Question | v1 answer |
|---|---|
| What problem did it solve? | Coordinating a handoff between two people who already knew each other (you and your roommate). |
| Obvious value prop? | No. A stranger opening it saw "144 Bonito Ave — Your spot" and 20 buttons. |
| Intelligence product or just a map? | Just a map with a static list. Nothing learned, nothing was measured. |
| Confusing | "Space Opened" vs "I'm Leaving" for the same car; four buttons per pin; statuses that didn't say how sure they were. |
| Unnecessary | Pre-seeded spots, "your spot," the calibration page, per-card directions links. |
| Missing | Search timing, outcome confirmation tied to reports, trust/reputation, dedupe, rate limits, night mode, targeted alerts, analytics. |

### UX: 11:30 PM, 30 minutes into circling
1. **Why open it?** v1 gave no reason beyond "maybe someone tapped a button." v2: "Find parking" starts a timer and alerts, and shows the best live signal first.
2. **Where should I drive?** v1 listed five fixed spots without distances. v2 ranks live openings by confidence × proximity, each with a one-tap **Go** into Apple/Google Maps.
3. **How reliable is it?** v1 used fixed windows and never said. v2 shows *Confirmed* (two independent drivers) vs *Reported* (one), a High/Medium/Fading meter, and the age ("41s ago"). Pins dim as they age.
4. **Confirmed vs predicted?** v1 had no predictions (correctly), but didn't say so either. v2 states plainly that predictions arrive only once there's enough history to be honest about them.
5. **Quick reporting?** v1 made you find the right card first. v2's report buttons use your GPS position, so there's nothing to pick.
6. **Back to navigation?** v2: **Go** hands off to your nav app; the search survives the app switch and a reload.
7. **Night/driving use?** v1 was a bright white UI. v2 is dark-first with large targets (56px primary, 48px secondary), a minimal text hierarchy, and a "tap only when stopped" line.

### UI
v1 looked like a generic dashboard: emoji buttons, pastel cards, a light map. v2 has a full-bleed dark map as the hero, one bottom sheet that changes with your state (idle → searching → parked), and color used only for meaning (green = open, amber = leaving, red = full, blue = you). Color is never the *only* signal; every state also has a text label.

### Technical
| Area | v1 problem | v2 |
|---|---|---|
| Data model | Fixed "spots" table. Street parking isn't pre-defined spaces, and seeding pins doesn't scale past one block. | Reports are GPS events (append-only log) with a geohash cell id for aggregation. |
| Storage | Two parallel code paths (JSON files + Postgres), a bug magnet. | One SQL path: Neon in prod, embedded Postgres (PGlite) locally. |
| Security | `PATCH /api/spots/:id` let anyone on the internet move pins; no rate limits. | Removed. Reports are rate-limited per device and per (hashed) IP. |
| Location check | "Within 500 m of a pre-set spot," about 5 blocks, too loose. | Must be inside the pilot zone with GPS accuracy ≤ 75 m; the report is placed where you actually are. |
| Alerts | Every subscriber was pinged on every opening anywhere. | Only people actively searching within ~0.5 mi; 60 s cooldown; newest alert replaces the old one. |
| Identity | None, so no reputation, dedupe, or retention metrics. | Anonymous random device id (no account, no PII). |
| Polling | Every 8 s, full table, even in background tabs. | Every 10 s, live rows only, paused when the app is hidden. |

---

## 2. Keep / Remove / Redesign / Add

**Kept:** Next.js on Vercel, Neon Postgres, Web Push, GPS-gated reporting, Leaflet map, PWA install, the SpotSeer name.

**Removed:** pre-seeded spots and "your spot," the calibration page and its unauthenticated edit endpoint, the separate "Space Opened" button for the leaver (one "I'm leaving" tap is enough), the JSON-file storage path, the per-card directions link, Next.js boilerplate assets.

**Redesigned:** the data model (events + search sessions), the UI (dark, map-first, state-driven sheet), alerts (targeted), and trust (scored, decaying, corroborated).

**Added:**
- Timed search sessions: the primary metric, measured automatically
- Outcome linking: parking within 50 m of a live report "claims" it, which validates the report, credits the reporter, and removes it from the map
- A one-tap baseline question after parking ("usually takes…")
- Corroboration (a second device confirms instead of stacking another pin), duplicate suppression, rate limits
- Reputation: Beta(1,1) prior on "reports that someone actually parked in"
- A thank-you push to the reporter when their report gets someone parked
- `/stats`, a pilot scoreboard built around the hypothesis
- "Parked" events logged silently: the raw material for occupancy and turnover data
- Street names on reports (reverse geocoded)

---

## 3. The core loop, as built

```
Need parking → "Find parking" (timer starts, alerts armed)
  → best live openings ranked (confidence × distance) → "Go" (nav handoff)
  → "I parked" → search time recorded; nearby report claimed if one was used
  → reporter gets "your report got someone parked"
  → one-tap baseline answer → /stats updates
Later: "I'm leaving" → nearby searchers pinged → loop repeats for someone else
```

## 4. Data model

**`events`** (append-only): `type` (leaving · open · full · parked), `source` (user · session · future: prediction, sensor, city), `lat/lng`, `accuracy_m`, `geohash` (~150 m cell), `street`, `created_at`, `expires_at`, `corroborates` / `corroborations`, `claimed_at` / `claimed_by_session`, `device_id`, `ip_hash` (daily-salted).

**`search_sessions`**: start/last/end location, `started_at` / `ended_at`, `outcome` (parked · gave_up · timeout · abandoned), `used_event_id`, `baseline_minutes`, `alerts_sent`.

**`devices`**: first/last seen, `reports`, `claimed` → reputation.

**Why this shape:** each claimed report is a labeled training example ("a leaving report at cell X, hour H was taken N minutes later"). Each session is a measured outcome. Parked + leaving events give arrivals and departures per cell per hour, i.e. turnover. That's the dataset a city dashboard and a prediction model both need, collected as a side effect of the consumer app.

### Trust rules (`lib/signal.js`)
| Type | Lifetime | Base trust | Why |
|---|---|---|---|
| Leaving | 6 min | 0.80 | The driver is at their own car; the timing is the only fuzzy part |
| Open | 4 min | 0.60 | A passerby may have missed a hydrant, driveway, or red curb |
| Full | 12 min | 0.70 | An area-level negative signal changes slowly |

`score = min(1, base × (0.7 + 0.6 × reputation) + 0.15 × corroborations) × freshness`, where freshness decays linearly to 0 at expiry. The UI shows High ≥ 0.55, Medium ≥ 0.30, otherwise Fading. **No fake percentages:** "87% probability" would be false precision until a calibrated model exists.

---

## 5. Hard truths: where I'd challenge the brief

1. **At 11:30 PM, almost nobody is leaving.** Your own story proves it: spaces opened at 5 AM. A real-time handoff network is strongest at turnover times (morning commute, early evening) and weakest in the exact scenario that inspired it. What helps at 11:30 PM is (a) *negative* information (which blocks not to bother with: "Block full"), (b) *historical* information ("this block turns over first, around 5:40 AM"), (c) *legality* (street-sweeping side, legal until 8 AM), and honestly (d) *private overnight supply* (a driveway or an empty apartment space). That makes the "secondary" private-parking idea potentially the best answer to the original pain. Don't build it yet, but test demand early (see E5).
2. **Density beats area.** 10×10 blocks with 30 users is a dead map. Recruit 20–40 residents inside roughly 2×3 blocks around Bonito/Appleton/3rd, even though the technical zone (Ocean → 4th, Alamitos → Junipero) is larger.
3. **Industry says prediction beats real-time.** Parkopedia argues this publicly ([source](https://business.parkopedia.com/blog/why-predictions-beat-real-time-every-time)), because a crowd report is stale within minutes. They're partly right, which is why v2 expires reports aggressively. The counter-position: a hyperlocal *handoff* between the person leaving and the person circling is something they can't do, and it's also how *our* prediction training data gets generated.
4. **Report supply depends on goodwill.** "I'm leaving" asks someone to do a favor for a stranger. Levers, in order: neighbor reciprocity (a small, dense pilot), visible impact (the thank-you push, now built), and eventually *zero-effort* reporting (automatic departure detection, which needs a native app).
5. **A web app has a ceiling.** It can't track location in the background, can't detect a car Bluetooth disconnect (your "phone connected to my car" idea), and on iPhone can only push after Add to Home Screen. Once the pilot shows people use it, a native app (Expo/React Native) is the unlock for automatic "I'm leaving" and "I parked." That's the single biggest data-density lever.
6. **The measurement is biased, and that's fine for now.** People forget "I parked" (tracked as *unfinished*), self-reported baselines run high, and searches with reports may simply happen at easier times. The clean test is a **randomized holdout** (E3), not a before/after story.
7. **Never sell public space.** San Francisco sent MonkeyParking a cease-and-desist for auctioning public parking spots; it pivoted to private spaces ([TIME](https://time.com/2974647/monkeyparking-parking-space-app-suspended/), [Wikipedia](https://en.wikipedia.org/wiki/MonkeyParking)). No payments or tips tied to public-curb handoffs, ever.

---

## 6. Competitive landscape

| Product | What it does | How it gets data | Gap for dense residential |
|---|---|---|---|
| Google / Apple Maps | "Parking difficulty" hint near destinations | Aggregate location history | Coarse, destination-level; no block-level, no handoff |
| Waze | Navigation, some parking suggestions | Driver telemetry | Mostly garages; not built around curb turnover |
| [SpotAngels](https://www.spotangels.com/) | Street rules, sweeping alerts, garage deals, free-parking map | Crowdsourced rules, partnerships | Reviews cite accuracy problems, subscription/billing friction, ads, and sign-in walls ([App Store reviews](https://apps.apple.com/us/app/spotangels-parking-gas/id897809583?see-all=reviews)); strong on *rules*, not real-time handoffs |
| [Parkopedia / Parknav](https://parknav.com/) | ML "probability of parking" per street segment, sold B2B to automakers and cities | Payment transactions, vehicle sensors, floating-car data, city APIs | Great at scale, but no neighbor handoff and no ground-truth outcomes from residents |
| MonkeyParking | Auctioned public spots | Users | Shut down in SF; pivoted to private spaces |

**Where SpotSeer can win:** dense residential blocks at night, with neighbor-to-neighbor handoffs, measured outcomes (actual search time, actual claims), and trust built on a small known community. **Where it loses:** coverage and cold start. So stay tiny until the numbers work.

---

## 7. Prediction roadmap (gated by data, not ambition)

| Version | What it is | Gate to ship |
|---|---|---|
| **V1 (now)** | Live user reports with decay, corroboration, reputation | — |
| **V2 Historical** | Per cell × hour-of-week departure rates: "spaces here usually free up 6–8 AM" | ≥ 4 weeks of data and ≥ ~10 events per cell-hour shown |
| **V3 Statistical** | Poisson rate per cell-hour with empirical-Bayes shrinkage → P(≥1 opening in 10 min) = 1 − e^(−λ·10) | Calibrated on held-out weeks (Brier score, reliability plot). Shown in **blue as "Predicted"** only if calibrated |
| **V4 ML** | Gradient-boosted model: cell, hour-of-week, live reports, full reports, sweeping schedule, weather, holidays, local events → P(park within X min) | Thousands of labeled sessions; beats V3 on held-out data |
| **V5 Predictive routing** | Recommend *which street to try next* to minimize expected search time | V4 proven; enough coverage to route between alternatives |

Labels already being collected: report → claimed (yes/no, time-to-claim), session duration and outcome, full reports, parked events.

**External data worth adding early:** Long Beach street-sweeping schedules via the city's [Maps & GIS](https://www.longbeach.gov/pw/resources/maps/) / DataLB portal (verify format and license first). It's deterministic, useful on day one, and helps exactly in the 11:30 PM case.

---

## 8. Notification policy

- **Now:** pings only during an active search, only within ~800 m, at most one per minute, dropped if undelivered within 2 minutes, and the newest replaces the previous one. Reporters get one thank-you when their report is claimed. No marketing pushes, ever, during the pilot.
- **Next:** "Watch my block" for morning windows, meaning an early heads-up when historical departures start (after V2). A "conditions changed, try Cherry Ave" nudge once V3 can back it up.
- **Rule:** if an alert isn't actionable in the next 5 minutes, don't send it.

---

## 9. What breaks at scale (100 → 10k → 100k)

| Issue | Breaks around | Fix |
|---|---|---|
| OSM tiles + Nominatim reverse geocoding (free, light-use policies) | ~1k users | Paid tiles with a real dark style (MapTiler/Stadia/Mapbox); snap reports to precomputed OSM street segments instead of per-report geocoding |
| Polling `/api/live` every 10 s | ~5k concurrent | Bounding-box queries, short CDN cache, then SSE/WebSocket |
| Schema created in the request path on cold start | Any team > 1 | Real migrations (Drizzle/Kysely) |
| `lat BETWEEN` boxes for geo queries | ~millions of rows | PostGIS or H3 indexes |
| Anonymous device ids (Sybil reputation gaming) | Once anything is worth gaming | Phone/passkey accounts for reporters; anomaly detection (never-claimed reporters, impossible travel) |
| On-the-fly stats over whole tables | ~100k events | Nightly aggregates / materialized views per cell-hour |
| One hard-coded pilot zone | Second neighborhood | `zones` table with polygons |

---

## 10. Privacy (do before any public launch)

Where your car parks every night *is* your home address, and a random device id isn't anonymity. Before growth: a privacy policy and CCPA notice (California), a retention rule (e.g. raw coordinates aggregated to cells and deleted after 90 days), individual-level data never sold, and any city product built strictly on aggregates. Today: no accounts, no names; IPs are stored only as a daily-salted hash for abuse limits.

---

## 11. Validation plan: experiments before features

| # | Question | How | Pass bar |
|---|---|---|---|
| E0 | What's the real baseline? | Weeks 1–2: 15–30 residents in the 2×3 block core just time their searches (Find parking → I parked). Works with zero reports. | ≥ 40 completed searches; baseline median by hour-of-day |
| E1 | Will people report? | Leaving reports per active resident per week | ≥ 2 (most residents move their car 5+×/wk). If < 0.5, supply is the problem → prioritize native auto-detection |
| E2 | Are reports accurate? | Claim rate of leaving/open reports; corroboration rate | ≥ 25% claimed within lifetime in the core blocks |
| E3 | Does it cut search time? | **Randomized holdout:** 20% of sessions get no alerts and a hidden list. Compare medians | 25–50% lower median in the treated group, ~100+ sessions per arm |
| E4 | Do they come back? | Devices searching in ≥ 3 of their first 6 weeks | ≥ 40% |
| E5 | Will anyone pay, and for what? | Fake-door after a successful park: "SpotSeer Plus: early alerts + overnight options" | ≥ 5% tap interest → run a real pre-sale; also ask what they'd pay for an overnight private space |
| E6 | Is parking predictable? | Week-over-week correlation of cell × hour departures | r ≥ 0.5 → build V2/V3 |

The **/stats** page already reports E0, E2, E4, and the raw inputs for E1/E3/E6.

---

## 12. Business sequencing

1. **Prove consumer value** (E0–E4). No monetization.
2. **Consumer premium**: early/"watch my block" alerts, overnight guidance, predictions once calibrated.
3. **Private overnight supply**: driveways, unused apartment spaces, business lots after hours. Legal (private property), and it directly solves the late-night case.
4. **Local partners**: restaurants and venues that care about customer parking.
5. **Curb intelligence for cities/APIs**: aggregate occupancy, turnover, search time by block and hour. Pitch to Long Beach only with a year of data and a privacy-safe method. "Our network cut average search time X% in Alamitos Beach" is the sentence to earn.

---

## 13. Next priorities (in order)

1. Run E0/E1 with real neighbors in the 2×3 block core. **This matters more than any feature.**
2. A randomized alert holdout for E3 (small server change: assign ~20% of sessions to control).
3. A "Wasn't there" button on claimed/viewed reports: false-report signal for reputation.
4. Street-sweeping overlay from Long Beach GIS.
5. Custom domain + privacy policy.
6. If E1 shows weak supply: native app spike for automatic departure detection.
