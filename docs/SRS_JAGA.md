# Software Requirements Specification (SRS)

**Product Name:** JAGA — Joint Alert, Guidance & Assistance
**Tagline:** An inclusive IoT-community hybrid early warning system for persons with disabilities during hydrometeorological disasters
**Document Version:** 2.0
**Status:** Draft — for development reference
**Prepared for:** U-DARE 4.0 — Disaster Futuristic Idea Competition (DFIC), Sub-theme 4
**Team:** Nazz (ICT), Yuli (ICT), [Electrical Engineering member]

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Overall Description](#2-overall-description)
3. [System Architecture Overview](#3-system-architecture-overview)
4. [Functional Requirements](#4-functional-requirements)
   - 4.1 [JAGA Pusat (National Admin)](#41-jaga-pusat--national-admin-role)
   - 4.2 [JAGA Desa (Village Operator)](#42-jaga-desa--village-operator-role)
   - 4.3 [JAGA Rescue (First Responder)](#43-jaga-rescue--first-responder-role)
   - 4.4 [JAGA Alarm (Portable Hardware)](#44-jaga-alarm--portable-personal-hardware)
5. [External Interface Requirements](#5-external-interface-requirements)
6. [Non-Functional Requirements](#6-non-functional-requirements)
7. [Data Model](#7-data-model)
8. [Glossary](#8-glossary)
9. [Open Issues / To Be Determined](#9-open-issues--to-be-determined)

---

## 1. Introduction

### 1.1 Purpose
This document specifies the functional and non-functional requirements of the JAGA system, intended as a development reference for the engineering team (software and hardware) as well as supporting documentation for the JAGA Futuristic Idea paper.

### 1.2 Scope
JAGA reduces disaster mortality among persons with disabilities (primarily deaf/hard-of-hearing and blind/low-vision individuals) and other vulnerable groups during flash floods and other hydrometeorological hazards. The system consists of:

| Component | Type | Description |
|---|---|---|
| **JAGA App** | Software | Single web/mobile application with 3 roles: JAGA Pusat, JAGA Desa, JAGA Rescue |
| **JAGA Alarm** | Hardware | Portable personal alert device carried by each registered beneficiary (keychain form factor) |

### 1.3 Definitions and Acronyms

| Term | Meaning |
|---|---|
| PWD | Person(s) with Disabilities |
| EWS | Early Warning System |
| LoRa | Long Range — low-power, long-range wireless radio protocol |
| RBAC | Role-Based Access Control |
| BMKG | Indonesia's Meteorological, Climatological, and Geophysical Agency |
| BNPB | Indonesia's National Disaster Management Agency |
| InaRISK | BNPB's national disaster risk mapping platform |
| NIK | Indonesian national identity number |
| Dinsos | Regional Social Affairs Office |
| Mesh relay | Device-to-device signal forwarding without fixed infrastructure |
| FR | Functional Requirement |
| NFR | Non-Functional Requirement |

### 1.4 References
- U-DARE 4.0 Term of Reference (TOR), DFIC branch, Sub-theme 4
- BMKG/BNPB flood alert classification standard (Normal–Waspada–Siaga–Awas)
- Meshtastic open-source mesh networking project (reference precedent for device-to-device LoRa relay)

---

## 2. Overall Description

### 2.1 Product Perspective
JAGA is a new, self-contained system designed to interoperate with (not replace) existing government infrastructure: BMKG hazard data, BNPB InaRISK risk maps, and Dinsos/BPS population data on persons with disabilities.

### 2.2 User Classes

| Role | Level | Authority |
|---|---|---|
| **JAGA Pusat** | National | Platform administration & data aggregation. **No alarm-trigger authority.** |
| **JAGA Desa** | Village | Local registry management + **sole authority to trigger JAGA Alarm devices** |
| **JAGA Rescue** | Field | Search, navigation, and evacuation status reporting |
| **PWD beneficiary** | End user (non-app) | Interacts only with the physical JAGA Alarm device |

### 2.3 Design Principles (carried from requirement elicitation)
1. **No single point of failure** — alarm authority rests with a village team, not one person.
2. **Human-in-the-loop** — every alert requires JAGA Desa confirmation before it is sent, preventing false-alarm fatigue.
3. **Data minimization** — only non-sensitive operational fields are visible in the app; sensitive identifiers (NIK, etc.) live in a restricted backend tied to official Dinsos/BPS data partnerships.
4. **Portable over fixed** — JAGA Alarm follows the person, not the household, since beneficiaries are not always home.
5. **Infrastructure-light coverage** — JAGA Alarm devices extend their own network via device-to-device mesh relay rather than depending on additional fixed infrastructure.

### 2.4 Constraints
- Must remain operational during total electricity and internet/cellular outages (device layer).
- Must align with existing BMKG/BNPB alert-tier terminology.
- Must comply with data-minimization and consent-based privacy principles.
- Prototype is conceptual (Written Futuristic Idea); a fully working build is not mandatory, but the design must be implementation-traceable.

### 2.5 Assumptions and Dependencies
- Village governments/Dinsos are willing to co-collect PWD data under a formal data-sharing agreement.
- At least one JAGA Desa command node with intermittent internet access exists per village for periodic sync with the national server.
- Enough JAGA Alarm units are distributed within a village's activity radius for mesh relay to be effective (see NFR-10).

---

## 3. System Architecture Overview

```
JAGA Alarm (worn by PWD) -- mesh relay --> JAGA Desa (village command node)
                                                 - manual trigger authority
                                                 - local PWD registry
                                                          |
                                            internet/4G when available
                                                          v
                                   JAGA Pusat (national) / JAGA Rescue (field app)
```

Two independent communication layers:
1. **JAGA Desa ↔ JAGA Alarm:** LoRa, fully offline-capable.
2. **JAGA Desa ↔ JAGA Pusat / JAGA Rescue backend:** internet/cellular when available, with store-and-forward buffering when disconnected; SMS gateway as fallback for critical alerts.

---

## 4. Functional Requirements

### 4.1 JAGA Pusat — National Admin Role

| ID | Feature | Requirement |
|---|---|---|
| FR-1.1 | Account & role management | The system shall allow JAGA Pusat to create, edit, and deactivate JAGA Desa and JAGA Rescue accounts, and assign roles/permissions. |
| FR-1.2 | National/provincial dashboard | The system shall display aggregated statistics: total registered PWD, number of active villages, alert history, and evacuation outcomes across regions. |
| FR-1.3 | Village status monitoring | The system shall show which villages are active/inactive and their last successful data sync time, to flag villages that have gone offline for an extended period. |
| FR-1.4 | Reporting & data export | The system shall allow JAGA Pusat to generate and export reports (CSV/PDF) for policy and statistical purposes. |
| FR-1.5 | Platform configuration | The system shall allow JAGA Pusat to manage global settings and track system/app version rollout. |
| FR-1.6 | Sensitive data governance panel | The system shall allow JAGA Pusat to control access to the restricted sensitive-data backend (e.g. NIK), ensuring it is never exposed to JAGA Desa or JAGA Rescue interfaces. |
| FR-1.7 | Broadcast/announcements | The system shall allow JAGA Pusat to send announcements or operational updates to all JAGA Desa teams. |
| FR-1.8 | Audit log | The system shall maintain a log of administrative actions (account changes, config changes, data access) for security and evaluation purposes. |
| FR-1.9 | No alarm authority (explicit restriction) | The system shall **not** provide JAGA Pusat any control to remotely trigger JAGA Alarm devices. This authority is exclusive to JAGA Desa (see Section 2.3). |

### 4.2 JAGA Desa — Village Operator Role

| ID | Feature | Requirement |
|---|---|---|
| FR-2.1 | Multi-user team login | The system shall support simultaneous login by multiple members of the village disaster team, not a single individual account. |
| FR-2.2 | PWD registry management | The system shall allow JAGA Desa to add, edit, and remove PWD household/beneficiary records (name, address, disability type, coordinates). |
| FR-2.3 | Manual trigger panel | The system shall require explicit manual confirmation from JAGA Desa before activating any JAGA Alarm device (human-in-the-loop). |
| FR-2.4 | Selective/group trigger | The system shall allow JAGA Desa to trigger a single device, a selected group, or all devices registered in the village. |
| FR-2.5 | Selective/group trigger | The system shall allow JAGA Desa to trigger a single device, a selected group, or all devices registered in the village. |
| FR-2.6 | Per-beneficiary status board | The system shall display real-time status per beneficiary: *Alert sent – no response*, *Assistance requested* (button pressed), or *Confirmed safe/evacuated* (verified by JAGA Rescue). |
| FR-2.7 | Dispatch JAGA Rescue | The system shall allow JAGA Desa to directly contact/dispatch JAGA Rescue teams from the dashboard, including relevant location and priority context. |
| FR-2.8 | Device health monitoring | The system shall display battery level and last-heartbeat timestamp for every registered JAGA Alarm, flagging devices that are offline or low on battery before a disaster occurs. |
| FR-2.9 | Offline/sync indicator | The system shall clearly indicate when it is operating in store-and-forward (offline) mode, queuing data locally until internet connectivity with JAGA Pusat is restored. |
| FR-2.10 | Event history log | The system shall retain a log of past alert events for post-disaster evaluation. |
| FR-2.11 | Beneficiary location map | The system shall display a map view showing the distribution of registered PWD across the village. |

### 4.3 JAGA Rescue — First Responder Role

| ID | Feature | Requirement |
|---|---|---|
| FR-3.1 | Organization-based login | The system shall support login scoped to responder organizations (fire department, police, SAR, volunteer groups). |
| FR-3.2 | Real-time notification feed | The system shall display incoming assistance requests from JAGA Desa, sorted by priority/urgency. |
| FR-3.3 | Priority map | The system shall display a map highlighting PWD locations, color-coded by urgency/disability type, with isolated or hard-to-reach zones highlighted in a red–orange–yellow gradient (informed by BNPB InaRISK and terrain/road accessibility data). |
| FR-3.4 | Route recommendation | The system shall suggest the fastest, most accessible route to a target location, functioning fully offline using cached map data. |
| FR-3.5 | Search-path tracking | The system shall record each team's traveled route in real time and mark already-covered areas, so other teams can prioritize unexplored routes (coverage path planning). |
| FR-3.6 | Beneficiary status update | The system shall allow a field team to update a beneficiary's status (found/evacuated, not found, unreachable), syncing instantly to the JAGA Desa dashboard. |
| FR-3.7 | Team coordination view | The system shall show the real-time position/coverage area of other JAGA Rescue teams operating in the same incident. |
| FR-3.8 | Offline map caching | The mobile application shall cache map tiles for offline use in areas without internet connectivity. |
| FR-3.9 | Post-operation report | The system shall allow a team to submit a summary report after completing a search-and-rescue operation. |

### 4.4 JAGA Alarm — Portable Personal Hardware

JAGA Alarm is a small, portable device (keychain form factor) carried by the registered beneficiary at all times — not installed at a fixed residence — so protection follows the person.

| ID | Feature | Requirement |
|---|---|---|
| FR-4.1 | Low-power standby | The device shall remain in a deep-sleep state and wake only upon receiving a valid activation signal via LoRa. |
| FR-4.2 | Multi-sensory alarm | Upon activation, the device shall simultaneously emit sound, strobe light (LED), and vibration. |
| FR-4.3 | Locked/unlocked confirmation button | The confirmation button shall remain **locked** under normal conditions. It **unlocks only after** an alarm is triggered. Pressing it sends an "assistance requested" signal back to JAGA Desa. This prevents accidental or unauthorized signals outside of an actual emergency. |
| FR-4.4 | Heartbeat signal | The device shall periodically transmit a low-frequency heartbeat (operational status + battery level) to JAGA Desa, independent of alarm state. |
| FR-4.5 | Device-to-device mesh relay | Each JAGA Alarm unit shall be capable of relaying another nearby unit's signal toward JAGA Desa (and vice versa), extending effective network coverage without requiring additional fixed infrastructure. This directly compensates for LoRa's reduced range in hilly/forested terrain. |
| FR-4.6 | Offline-independent operation | The device shall operate entirely on local battery and LoRa connectivity, independent of grid electricity and internet/cellular networks. |
| FR-4.7 | Compact, portable form factor | The device shall be small and lightweight enough to be worn or carried as a keychain, without requiring fixed installation. |

**State machine (FR-4.3 detail):**

```
[IDLE / LOCKED] --(JAGA Desa triggers alarm)--> [ALARM ACTIVE / BUTTON UNLOCKED]
[ALARM ACTIVE / BUTTON UNLOCKED] --(button pressed)--> [ASSISTANCE REQUESTED -> sent to JAGA Desa]
[ALARM ACTIVE / BUTTON UNLOCKED] --(no press)--> [status remains: "alert sent, unconfirmed"]
[ASSISTANCE REQUESTED or ALARM ACTIVE] --(JAGA Rescue confirms rescue in field)--> [IDLE / LOCKED]
```

---

## 5. External Interface Requirements

### 5.1 User Interfaces
- JAGA Pusat / JAGA Desa: responsive web dashboard
- JAGA Rescue: Android-first mobile application with offline map support

### 5.2 Hardware Interfaces
- JAGA Alarm: microcontroller with integrated LoRa radio module, rechargeable battery (e.g. Li-ion/LiFePO4)

### 5.3 Communication Interfaces

| Link | Medium | Notes |
|---|---|---|
| JAGA Desa ↔ JAGA Alarm | LoRa (mesh-capable) | No internet/cellular dependency |
| JAGA Desa ↔ JAGA Pusat / JAGA Rescue backend | Internet/cellular (when available) | Store-and-forward buffering when disconnected; SMS gateway as fallback for critical alerts |

### 5.4 Software/Data Interfaces
- Integration with BMKG hazard/weather data feed (when internet available)
- Integration with BNPB InaRISK risk map layers
- Data-sharing interface with Dinsos/BPS for official PWD population data

---

## 6. Non-Functional Requirements

| ID | Category | Requirement |
|---|---|---|
| NFR-1 | Reliability | JAGA Alarm shall remain functional for a defined minimum duration under total grid/network outage (duration to be determined by battery sizing — see Section 9). |
| NFR-2 | Reliability | The system shall have no single point of failure at the emergency decision-making level (village team, not one individual). |
| NFR-3 | Security/Privacy | The system shall follow data minimization: only non-sensitive fields (name, general location, route) are shown in JAGA Desa/Rescue interfaces. |
| NFR-4 | Security/Privacy | Sensitive identifiers (e.g. NIK) shall be stored separately in a restricted backend, accessible only via official government data partnership. |
| NFR-5 | Security/Privacy | PWD registration shall require documented consent, coordinated through village/Dinsos data-collection processes. |
| NFR-6 | Performance | Alert propagation time from JAGA Desa trigger to JAGA Alarm activation shall be minimized (near-instantaneous over direct LoRa link). |
| NFR-7 | Usability | The JAGA Alarm confirmation button shall be physically simple (single large, tactile button) to remain usable by persons with visual or motor impairments. |
| NFR-8 | Scalability | The data model shall support hierarchical aggregation from village to provincial to national level without redesign. |
| NFR-9 | Energy efficiency | JAGA Alarm shall use deep-sleep/wake-on-radio-interrupt design to minimize battery drain between alert events. |
| NFR-10 | Network coverage | Mesh relay effectiveness depends on a reasonable density of distributed JAGA Alarm units; coverage is scoped to a village's typical daily activity radius (homes, fields, schools, markets), not unlimited range. |
| NFR-11 | Portability | JAGA Alarm shall be compact and lightweight enough for continuous personal carry (keychain-scale), not a fixed installation. |

---

## 7. Data Model

### 7.1 PWD Registry — Operational (visible to JAGA Desa/Rescue)
| Field | Description |
|---|---|
| beneficiary_id | Unique identifier |
| name | Full name |
| general_location | Address/area, not necessarily precise live GPS |
| disability_type | Category (e.g. visual, hearing, mobility) |
| assigned_device_id | Linked JAGA Alarm unit |
| current_status | Alert sent / Assistance requested / Confirmed safe |

### 7.2 PWD Registry — Sensitive (restricted backend only)
| Field | Description |
|---|---|
| NIK | National identity number, sourced via official Dinsos/BPS partnership |
| other_gov_ids | Any additional official identifiers |

### 7.3 Device Telemetry (JAGA Alarm)
| Field | Description |
|---|---|
| device_id | Unique identifier |
| battery_level | Percentage |
| last_heartbeat | Timestamp |
| last_known_relay_path | For mesh diagnostics |

### 7.4 Event Log
| Field | Description |
|---|---|
| event_id | Unique identifier |
| trigger_source | JAGA Desa user/team |
| affected_devices | List of device_ids |
| rescue_route_history | Team path + status updates, for post-event review and missing-person search support |

---

## 8. Glossary

- **Human-in-the-loop:** A design pattern requiring explicit human confirmation before an automated system takes a consequential action (here: alarm activation).
- **Mesh relay:** A network topology where individual nodes (JAGA Alarm units) forward each other's signals, extending coverage without fixed infrastructure.
- **Store-and-forward:** A data handling mode where information is buffered locally during a connectivity outage and transmitted once connectivity resumes.
- **Coverage path planning:** A routing approach used by search teams to prioritize unexplored areas over already-covered ones.

---

## 9. Open Issues / To Be Determined

- [ ] Exact battery sizing and expected standby duration for JAGA Alarm (requires calculation by the Electrical Engineering team member).
- [ ] Minimum effective mesh-relay density (number of JAGA Alarm units per km² for reliable multi-hop coverage).
- [ ] Final hardware component selection (microcontroller model, LoRa module, battery chemistry) — deferred pending cost/availability research, per competition prototype constraints.
- [ ] Formal data-sharing agreement structure with Dinsos/BPS (legal/governance detail, outside pure technical scope).
