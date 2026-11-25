# Veyro roadmap (aggregator first, then the missing features)

Pace: two people (you + Claude), working when time allows. So the plan is in **sessions** (one focused sitting, roughly 2 to 4 hours),
not calendar days. Estimates are rough. Do them in order within a track; the two tracks run in parallel.

## Track A: business and legal (you; start now, they take calendar time)
- [ ] Put `website/` live at veyrotrack.com (see `website/README.md`). Confirm the contact email address on it.
- [ ] Shortlist 5 GPS vendors, 5 transporters, 1-2 shippers for outreach. Pitch: vendors get shipper demand; transporters win work; shippers get one integration.
- [ ] Lawyer: DPDP Act consent/retention, data-sharing and vendor-terms review, standard agreements (transporter, shipper, vendor).
- [ ] Meta WhatsApp Business verification, India SMS (DLT) registration, a telephony provider, payment gateway KYC (all slow; start early).
- [ ] Obtain a few sample trackers (GT06/Concox, Teltonika, an AIS-140 unit) for protocol testing.
- [ ] Decide where to host long-term (move to AWS Mumbai before real customer data).

## Track B: build

### Phase 1: aggregator pilot
| # | Milestone | Sessions |
|---|---|---|
| M1 | Website (done: `website/`) | 1 |
| M2 | Foundations: backups + restore test, staging, CI on every push, monitoring/alerts, move to India region | 2 |
| M3 | Org types (transporter/shipper/vendor/admin), user management screen, invites, password reset email, 2FA, audit log, API keys | 3 |
| M4 | Device gateway core (TCP/UDP, adapter interface, queue, backpressure) + GT06/Concox + JT808 adapters + device simulator | 3 |
| M5 | Teltonika + AIS-140 adapters; device registry; claim a device by registration number; dual-forward setup guide and remote config | 3 |
| M6 | Vehicle registry + ownership claim and verification | 2 |
| M7 | **Vendor Integration API v1** (push) + docs + sandbox + vendor feed simulator + vendor console. This is what you show vendors | 3 |
| M8 | Vendor pull-adapter framework + 2 example adapters | 2 |
| M9 | Consent and assignments (transporter approves), access policy engine on every read path, consent ledger, "who viewed my vehicle" | 4 |
| M10 | Shipper portal (cross-vendor live map, consignments, ETA) + Shipper API v1 + webhooks + WebSocket + SDK + docs | 5 |
| M11 | Vehicle handover between shippers (tested for no leakage), feed health dashboard and alerts, usage metering and billing | 3 |
| M12 | DPDP pack (consent records, retention, export/delete), security review, 100k-vehicle load test | 3 |
| | **Pilot-ready after Phase 1** (about 34 sessions) | |

### Phase 2: the missing core features
| # | Milestone | Sessions |
|---|---|---|
| M13 | Geofences, alert rules (speed, ignition, idle, offline, geofence, tamper, SOS), notifications (email, SMS, push, WhatsApp), alert inbox | 4 |
| M14 | Reports and exports (distance, idle, trips, summaries), scheduled email | 2 |
| M15 | Maintenance reminders and document expiry (insurance, PUC, fitness, permit, licence) | 3 |
| M16 | Fuel: sensors, calibration, fill/theft detection, fuel card import | 3 |
| M17 | Dispatch, route optimization, ETA, customer tracking link, proof of delivery | 5 |
| M18 | Trip expenses, profit per trip, FASTag/tolls, India compliance (AIS-140 flows, VAHAN, e-way bill, SOS handling) | 4 |
| M19 | Exact harsh-driving events from device sensors; EV module | 3 |

### Phase 3: apps and AI
| # | Milestone | Sessions |
|---|---|---|
| M20 | Manager + driver mobile apps | 8 |
| M21 | WhatsApp bot, then voice agent in Indian languages | 6 |
| M22 | Agents that act (with confirmation) + background agents (exception reports, predictive maintenance) | 3 |
| M23 | AI dashcam / driver monitoring via third-party platforms (needs hardware partners) | 5 |
| M24 | Full language coverage with native-speaker review; high availability, disaster-recovery drills | 4 |

Total: roughly 85-90 sessions. At three sessions a week that is about 7 months; the aggregator pilot is ready after about 3 months.

## Rules we keep
- Every milestone ships with tests, and any feature that shares data across organizations ships with a test proving one tenant cannot read another's data.
- Nothing is advertised as live on the website until it is.
