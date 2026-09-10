# Building an MVP AI Agent for Data Center Site Selection, Design & Optimization

*A Practical Playbook (September 2026)*

> **Status (2026-09-10):** Agent #1 web MVP v0.1 is built in this folder — see [README.md](README.md). Keyless Cesium globe, deterministic scoring over OSM/Open-Meteo/USGS/FEMA/terrain, design+TCO bundle, memo + evidence trail, optional Claude narration. Verified headless end-to-end on the default Waco, TX box (9 candidates, ~17 s).

## TL;DR

- **Build a "Site-Selection & Feasibility Scoring Agent" first.** It is the highest-pain, most-fundable wedge. Power/interconnection is now the #1 gating constraint. Per LBNL's *Queued Up: 2025 Edition*, a project reaching commercial operation in 2024 spent an average of 55 months (4.5 years) in the interconnection queue (up from 22 months in 2008). It can run almost entirely on free public geospatial/grid/climate datasets, and incumbents (datacenterHawk, Hitachi Velocity Suite, Paces) are either broker-real-estate tools or clean-energy-first, leaving a defensible niche for an AI-native, deterministic-scored screener that outputs a ranked shortlist with an auditable evidence trail.
- **The strongest second product, and genuine whitespace, is a "Reference-Architecture + TCO Recommender"** that turns {target MW, rack density, region, tier} into a recommended power/cooling topology plus a capex/opex/PUE/WUE estimate. As of 2026 no single AI-native product fuses vendor reference designs, TCO calculators, and topology selection into one prompt-driven agent. The pieces exist only separately (Schneider's free TradeOff Tools and static reference designs, Cadence Reality digital twin, Vertiv/NVIDIA blueprints).
- **A solo founder/small team can ship a credible MVP of the scoring agent in 4–8 weeks** by keeping all scoring, PUE/TCO math, and geospatial joins deterministic and using the LLM only for orchestration, RAG over standards/incentive docs, narrative report generation, and data extraction. Keep the LLM out of the numbers to avoid liability and hallucination.

## Key Findings

### 1. Power has replaced land as the binding constraint

Across every 2026 source, power availability and grid-interconnection timing are the #1 site-selection factor. Per LBNL's *Queued Up: 2025 Edition* (data through end of 2024), the median interconnection request-to-commercial-operation duration has doubled from under 2 years for projects built in 2000–2007 to over 4 years for those built in 2018–2024. Industry commentary puts constrained-market time-to-power at 5–7 years. A 250 MW campus can face ~$1M in non-refundable interconnection fees, and single-site requests have jumped from 30–60 MW to 300 MW+.

**Implication:** an MVP that leads with deliverable-power screening, not real estate, is aligned with where the pain and budget actually are.

### 2. The competitive field splits into four lanes; none own AI-native screening + design recommendation

- **Market-intelligence / real estate:** datacenterHawk (acquired by S&P Global, completed September 1, 2026, folded into S&P Global Energy alongside 451 Research and FiberLocator) tracks 10,500+ data centers, 460+ markets, 500+ GW. The S&P/451 KnowledgeBase covers 12,960+ facilities across 131 countries. Subscription, quote-based, human-analyst-driven.
- **Grid/power intelligence:** Hitachi Energy Velocity Suite, LandGate, GridMatch, Grid8, interconnection.fyi/GridTracker (44,000+ interconnection queue requests tracked).
- **AI-native siting/permitting startups:** Paces ($11M Series A led by Navitas Capital, July 30, 2024, with Suffolk Technologies and MCJ Collective; later launched an autonomous "Paces Agent" for siting → interconnection → permitting), Lorica (permitting automation). Clean-energy-first and permitting-centric.
- **Design/engineering tools:** Schneider EcoStruxure reference designs + free TradeOff Tools (20 calculators), Cadence Reality/Future Facilities CFD digital twins, DCIM (Sunbird dcTrack, Nlyte, Schneider EcoStruxure IT, Eaton Brightlayer, EkkoSense for cooling). Operational, or require an already-built model.

### 3. Whitespace is clearest at the "requirements → recommended architecture + TCO" layer

As of 2026 this AI-native niche is not filled. Schneider offers static reference designs (~18 blueprints filtered manually) plus separate free capex/TCO calculators. Cadence Reality optimizes a design you already built. Vertiv+NVIDIA (7 MW GB200 NVL72 blueprint) and Siemens+nVent+NVIDIA (100 MW, 127 kW/rack Tier III blueprint) publish static engineering blueprints. Paces is scoped to power/permitting, not facility topology. An agent that fuses these into one recommender is defensible.

### 4. The domain is numerically well-defined, so deterministic calculators are feasible

- **Rack density:** ~15 kW (2017) → 40–80 kW (H100, 2024) → ~132 kW (GB200 NVL72, 2025) → ~240 kW next-gen expected; Vertiv projects >1 MW/rack cabinets by 2029. Air cooling fails above ~50–100 kW/rack, making direct-to-chip liquid cooling the default for AI halls.
- **Construction cost:** JLL 2026 Global Data Center Outlook forecasts global average shell-and-core at $11.3M/MW in 2026 (up from $10.7M in 2025 and $7.7M in 2020, ~7% CAGR). AI-optimized tenant fit-out runs "as high as $25 million per MW."
- **1 GW AI data center TCO (Epoch AI, May 14, 2026, Michael & Cottier):** $38B up-front capex and $0.9B annual opex, annualized $8.5B/year, of which servers are 60% ($5B/yr). Capex breakdown: servers $21.2B, facility $11.4B, network $4.9B.
- **PUE:** Uptime Institute Global Data Center Survey 2024 (n=526) reported 1.56 (flat for the fifth consecutive year), improving to 1.54 in 2025 (n=681). Best-in-class hyperscale 1.08–1.20.
- **WUE:** industry average 1.8–1.9 L/kWh; best-in-class 0.3–0.7 L/kWh.

## Details

### The problem space (2026), by pillar

**Site selection (global).** Ranked drivers:

1. Deliverable power + interconnection timeline (multi-year in constrained markets; queue position often worth more than the land)
2. Speed-to-power, driving behind-the-meter / bring-your-own-generation (natural gas bridging, fuel cells, co-located plants). datacenterHawk calls BTM "a structural change"
3. Political/community durability. 16 developments were delayed or denied on permitting between March 2024–2025; local moratoria are proliferating
4. Fiber/route diversity (a qualifier, not a differentiator; verify two truly independent paths)
5. Water availability (WRI Aqueduct stress)
6. Climate / cooling economizer hours
7. Land (100+ acres for hyperscale, slope <15°, outside wetlands/floodplains; Paces screens all 13.8M Texas parcels this way)
8. Tax incentives
9. Seismic/flood risk
10. Latency
11. Sovereignty/geopolitics

This is inherently a multi-criteria geospatial scoring problem.

**Technology selection.**

- Cooling: air (<30–40 kW/rack), rear-door heat exchangers, direct-to-chip DLC (40–150 kW/rack, PUE 1.03–1.1), immersion (100–200+ kW/rack, PUE 1.02–1.05).
- Electrical topology by tier: N+1 (Tier I/II, enterprise), N+1/2N (colo), 2N/2(N+1) (Tier III/IV, hyperscale). Tier III is typically N+1 supply/generation with 2N UPS/distribution ("concurrently maintainable"); Tier IV is fault-tolerant.
- UPS (modular vs. monolithic), generators (24–72h fuel), transformers (long lead times), modular/prefab (1.2 MW increments, faster deployment).
- Schneider modeling: a 40 kW liquid-cooled rack puts ~21% of capex into cooling vs. ~10% for a 10 kW air rack; electrical is 40–45% of budget.

**Design methodology.** Uptime Institute Tier (I–IV; performance-based, witnessed live testing; recognized in 114+ countries; ~$50–100k certification) vs. ANSI/TIA-942-C (prescriptive, Rated 1–4, full physical scope incl. site/architecture/telecom/fire/security; third-party audited; ~$20–50k) vs. ISO/IEC 22237 and EN 50600. Reference-design-driven workflow: set core parameters (criticality, capacity, growth, efficiency, density, budget) → compare → analyze trade-offs → customize → validate into detailed design. Phased/modular construction and capacity planning close the loop.

**Optimization.** PUE = Total Facility Energy ÷ IT Energy (ISO/IEC 30134-2, EN 50600-4-2; measure IT at UPS output minimum). WUE = annual site water (L) ÷ IT energy (kWh). TCO = capex (electrical, cooling, shell, IT) + opex (energy = PUE × IT load × hours × $/kWh; water; maintenance; staff). PUE 1.20 vs. 1.54 industry average is ~$10M/yr per 50 MW of IT load.

### Recommended MVP candidates (5), ranked

| # | Agent concept | Target user & JTBD | AI does | Deterministic core | Monetizable? | Whitespace |
|---|---|---|---|---|---|---|
| 1 ★ | Site-Selection & Feasibility Scoring Agent | Dev/strategy lead at operator: "Screen/rank candidate regions or parcels for a 100 MW AI campus." | NL query parsing; RAG over incentives/permitting/utility rules; extract data from utility PDFs; write ranked feasibility memo w/ evidence trail | Geospatial joins (distance to substation/fiber/gas), weighted multi-criteria score, power/water/climate/hazard indices | High. Replaces weeks of analyst work; per-seat + per-report | Incumbents are broker-RE or clean-energy-first; AI-native power-first screener is open |
| 2 ★ | Reference-Architecture + TCO Recommender | DC architect/pre-sales engineer: "{50 MW, 130 kW/rack, Texas, Tier III} → recommend power/cooling topology + capex/opex/PUE/WUE." | Map requirements → matching reference design via RAG; explain trade-offs; generate design narrative/BoQ outline | Topology decision tree, capex ($/MW by type/region), PUE/WUE/TCO calculators, density → cooling rules | High. Clear whitespace | Genuinely open; vendors have only static designs + separate calculators |
| 3 | Design-Methodology / Compliance & RFP Agent | Consultant/owner's rep: "Draft Tier III/TIA-942 compliance checklist + RFP for this design." | RAG over Uptime/TIA-942/ASHRAE/ISO; gap analysis; generate RFP & checklists | Requirement matrices, redundancy validation rules | Medium. Narrower, doc-heavy | Partly served by consultants; automatable |
| 4 | Optimization / What-If Agent | Ops/efficiency eng: "Cut PUE/energy cost; model cooling swap." | Scenario narration; suggest levers from RAG best-practice | PUE/WUE/energy/carbon models, sensitivity analysis | Medium. Overlaps DCIM/EkkoSense | Crowded operationally |
| 5 | Interconnection-Queue & Speed-to-Power Agent | Power procurement: "Where can I energize <24 months?" | Summarize queue/utility filings; risk narrative | Queue data joins, time-to-power modeling | High but data-ops heavy | Partly served (Grid8, GridTracker, Hitachi) |

**Recommended build-first: Agent #1.** It targets the #1 pain (power-first siting), runs on free/public data, produces a tangible deliverable (ranked shortlist + memo), and is the natural on-ramp to #2. Ship #1, then bolt on #2 as the expansion product. Together they cover "where to build" and "what to build."

### The "build this first" MVP: scope & week-by-week (4–8 weeks)

**Scope (MVP v0.1):** US-first (best free data), single vertical (AI/hyperscale greenfield, 50–300 MW).

- **Input:** a region/county/list of parcels + requirements (MW, density, tier, water sensitivity, latency target).
- **Output:** ranked table of candidates with sub-scores (power proximity, interconnection risk, fiber, water stress, climate/cooling hours, hazard, incentives, land) + an LLM-written feasibility memo citing each datapoint + downloadable evidence.

| Week | Milestone |
|---|---|
| 1 | **Data spine.** Ingest OpenStreetMap/Open Infrastructure Map power lines & substations (Overpass/Geofabrik/OpenInfraMap), EIA electricity prices & plants, WRI Aqueduct water risk, FEMA flood + USGS seismic, TeleGeography/PeeringDB fiber proxies, interconnection.fyi queue data, Good Jobs First/NCSL incentives. Store in PostGIS. |
| 2 | **Deterministic scoring engine.** Nearest-substation/line distance & voltage; distance to fiber, gas, water; Aqueduct stress bucket; climate/economizer-hours lookup; hazard flags; incentive match. Weighted, transparent, configurable score. Unit-test the math. |
| 3 | **Calculators.** Power sizing (IT → facility via PUE), capex ($/MW by type & region multiplier), opex/energy, PUE/WUE estimators. All deterministic, benchmark-seeded (JLL/Uptime numbers). |
| 4 | **RAG + agent orchestration.** Vector store over standards summaries, incentive statutes, utility interconnection rules, vendor reference designs. LLM (ReAct/tool-calling via LangChain/LlamaIndex) parses the query, calls scoring/calculator tools, retrieves context, drafts the memo. Tools have strict schemas; LLM never computes numbers. |
| 5–6 | **UI + evidence trail.** Map + ranked table + memo export (PDF). Every number links to its source layer/timestamp (auditability = trust + liability defense). |
| 7–8 | **Validation & pilot.** Back-test against 5–10 known/announced sites; have 2–3 domain experts red-team the rankings; run design-partner pilots. Add a "confidence + caveats" panel. |

### Technical architecture

**Pattern:** Agentic RAG with a hard deterministic core. LLM = orchestrator (ReAct/plan-execute), extractor (parse utility/permit PDFs into structured fields), retriever-synthesizer (RAG over standards/incentives), and narrator (report). Everything quantitative (scoring, distances, PUE/TCO) lives in tested Python functions, not the LLM. Mirrors "deterministic legal/compliance agent" designs that isolate math/logic for auditability.

**Stack:** Python + PostGIS/GeoPandas for geospatial; DuckDB/Postgres for tabular; a vector DB (pgvector/Chroma) for RAG; LangChain or LlamaIndex for tool-calling; any frontier LLM behind a provider-agnostic layer.

**Guardrails:** tool schemas + input validation; retrieval scoping; "no source, no claim" (memo cannot assert a number without a linked datapoint); explicit confidence bands; refuse extrapolation beyond data coverage.

**Evaluation:** (a) unit tests on calculators vs. worked examples; (b) golden set of expert-scored sites; (c) RAG faithfulness/citation checks; (d) human-in-the-loop sign-off before any client memo ships.

### Data sources (public/free)

| Domain | Source | URL | Notes / license |
|---|---|---|---|
| Power grid (lines/substations/plants) | Open Infrastructure Map / OpenStreetMap | openinframap.org; geofabrik.de/data/energy-networks.html | ODbL; 7M+ km lines, 1M+ substations; Overpass API |
| Aggregated grid + DCs + cables | OpenGridWorks | (aggregator of OSM/ENTSO-E/GEM/EIA/HIFLD/TeleGeography) | Visual scan |
| US electricity prices/plants | EIA (API) | eia.gov | Free API key |
| Europe grid data | ENTSO-E Transparency Platform | transparency.entsoe.eu | Free API (email for key); entsoe-py |
| Interconnection queues (US) | interconnection.fyi / GridTracker (LBNL Queued Up) | interconnection.fyi | 44k+ requests; CSV/Snowflake (paid for full) |
| Water risk | WRI Aqueduct 4.0 | wri.org/applications/aqueduct | Free w/ attribution; CSV/GIS; Earth Engine |
| Climate | ERA5 / Copernicus; NASA NEX-GDDP-CMIP6 | cds.climate.copernicus.eu | Free; for economizer hours |
| Fiber/subsea/latency | TeleGeography Submarine Cable Map; PeeringDB | telegeography.com; peeringdb.com | PeeringDB free API |
| Flood/seismic | FEMA NFHL; USGS seismic hazard | fema.gov; usgs.gov | Free |
| Incentives | Good Jobs First Subsidy Tracker; NCSL "Subsidizing Servers" | goodjobsfirst.org; ncsl.org | Free |
| Land/parcels | County GIS / commercial parcel APIs (Regrid) | — | Parcels often paid |
| Standards (for RAG) | Uptime Tier, ANSI/TIA-942-C, ISO/IEC 22237, ASHRAE TC9.9, EN 50600 | respective bodies | Standards are paid; use summaries/own notes |
| Reference designs | Schneider EcoStruxure (free); Vertiv/NVIDIA, Siemens/nVent blueprints | se.com; nvent.com | Free vendor docs |

### Go-to-market & validation

**Who to talk to:** heads of site selection / development at colo (Equinix, Digital Realty, Vantage, QTS), hyperscaler infra teams, developers/land-bankers, owner's-rep and MEP consulting firms (the 50,000+ fragmented permitting/engineering firms), and DC-focused brokers. For #2, target pre-sales engineers at OEMs/integrators and design-build GCs.

**Pricing (anchored to comparables):** SaaS per-seat plus per-report. Comparables: Sunbird dcTrack ~$19.50/cabinet/mo ($234/yr); Nlyte ~$1,000/rack (vendor-attributed, older); Schneider TradeOff Tools free (lead-gen); datacenterHawk and S&P/451 KnowledgeBase quote-based enterprise; market-intelligence subscriptions ~$199–$1,399/mo/seat. A defensible v1: ~$500–2,000/seat/mo for the platform + a premium per-feasibility-report fee (replaces weeks of analyst time on a project worth $1–2B in construction value). Paces validates willingness-to-pay ("grid insights in 5 days," ~3x YoY growth).

**Pilot ideas:**

1. Free back-test: score a client's last 3 sites and compare to what they learned the hard way.
2. "Shortlist-in-a-day" paid pilot for a live 100–300 MW search.
3. Design-partner arrangement (discount for feedback + logo).

**Risks:** Liability/accuracy (screening tool, not engineering-of-record; disclaim, keep human sign-off, cite every number); data licensing (OSM ODbL share-alike; parcel and queue data often paid; standards copyrighted, use summaries, never redistribute); data staleness (grid/queue data changes fast; timestamp everything); fast-following incumbents (Schneider/Cadence/NVIDIA and Paces could close the gap; move fast, own the AI-native workflow + evidence trail).

### Key formulas & benchmarks to embed

- **PUE** = Total Facility Energy ÷ IT Energy (≥ measured at UPS output). Industry avg 1.56 (Uptime 2024, n=526) / 1.54 (Uptime 2025, n=681); modern colo 1.30–1.45; best-in-class hyperscale 1.08–1.20; DLC 1.03–1.1; immersion 1.02–1.05.
- **WUE** = annual site water (L) ÷ IT energy (kWh). Ideal 0.0 (dry/air), industry avg 1.8–1.9, best-in-class 0.3–0.7 (NREL ~0.7 @ PUE 1.06). WUE/PUE trade off inversely.
- **Facility power** = IT load × PUE. **Annual energy** = facility power × 8,760 h × utilization. **Energy opex** = annual energy × $/kWh.
- **Rack density timeline:** 15 kW (2017) → 40–80 kW (H100, 2024) → ~132 kW (GB200 NVL72, 2025) → ~240 kW (next-gen expected) → >1 MW/cabinet (Vertiv forecast 2029). Air-cooling limit ~50–100 kW/rack.
- **Capex/MW (2026):** enterprise/Tier II ~$8–10M; colo/Tier III ~$10–12M; hyperscale/Tier IV ~$12–15M; standard shell-and-core avg $11.3M (JLL 2026); AI-optimized liquid-cooled $15–20M+; tenant IT fit-out adds up to $25M/MW (JLL); all-in with GPUs (1 GW GB200) ~$38M/MW (Epoch AI). Electrical 40–45% of budget, cooling 15–25% (up to ~21% at 40 kW liquid racks). Regional: Singapore ~$16M/MW, UK/Germany ~$14M, US ~$12M, India ~$6.5M.
- **Timelines:** building 12–18 months; grid interconnection averaged 55 months in queue for projects reaching operation in 2024 (LBNL Queued Up 2025); 5–7 years in constrained markets; sought-after sites deliver power in 18–24 months. Tier IV redundancy can add up to ~40% cost vs. lower tiers.
- **Redundancy mapping:** Tier I = N; Tier II = N+1 capacity; Tier III = concurrently maintainable (typ. N+1 supply/gen, 2N UPS/dist); Tier IV = fault-tolerant (2N / 2(N+1)).

## Recommendations

1. **Build Agent #1** (Site-Selection & Feasibility Scoring) as the first MVP, US-first, AI/hyperscale greenfield vertical, on the 4–8 week plan above. Lead with deliverable-power screening.
2. **Keep every number deterministic and every claim sourced.** The LLM orchestrates, retrieves, extracts, and writes. It does not compute. This is the accuracy story, liability shield, and differentiation vs. a generic chatbot.
3. **Line up 2–3 design partners before week 5** and validate via back-testing against known sites. Benchmark: if experts agree with ≥80% of top-3 rankings on back-tests, productize and start charging; if not, fix scoring weights/data before scaling.
4. **Sequence Agent #2** (Reference-Architecture + TCO Recommender) as the expansion product once #1 has paying users. Threshold to greenlight: ≥3 paying #1 customers explicitly asking "what should I build here?"
5. **Price at ~$500–2,000/seat/mo + per-report premium**; use a free back-test as the wedge. Re-price up once you can show a time-saved/ROI case study.
6. **Watch two threat signals:** Schneider/Cadence/NVIDIA shipping an AI recommender, or Paces expanding from power into facility design. If either happens, double down on the evidence-trail/auditability and multi-vendor neutrality they can't easily match.

## Caveats

- Many 2026 cost, density, and market figures come from vendor/broker/analyst commentary (JLL, Turner & Townsend, Archdesk, Goldman, Epoch AI, Uptime), not audited primary data; ranges vary widely (e.g., AI capex $15M–$45M/MW depending on scope and whether GPUs/land are included). Treat as planning ranges; always clarify IT-MW vs. facility-MW and what's in/out of scope.
- Forward-looking numbers are projections, not facts (240 kW/rack "expected," >1 MW/cabinet "forecast," liquid-cooling market forecasts, hyperscaler multi-trillion capex).
- Pricing for incumbents (datacenterHawk, S&P/451, Nlyte enterprise, JLL/Cushman) is not public; figures cited are best vendor-attributed or comparable anchors and should be confirmed directly.
- Data licensing is a real constraint: OSM/Aqueduct are free (with attribution/share-alike), but full interconnection-queue feeds, parcel data, and published standards are paid/copyrighted. Budget for these and never redistribute copyrighted standard text.
- This is a screening/decision-support tool, not engineering-of-record. Final siting, tiering, and design decisions require licensed engineers and formal utility studies.
- Whitespace can close fast. The "no single AI-native requirements → architecture + TCO product exists" finding is current as of 2026 but vendors are visibly moving toward it. Speed and workflow ownership matter more than any single feature.
