# ClanBridge

## A Clan Management and Coordination Platform for Clash of Clans

**Project proposal**

| | |
|---|---|
| **Prepared by** | [YOUR NAME] |
| **Prepared for** | [FRIEND'S NAME], Clan Leader |
| **Project type** | Solo development project |
| **Document version** | 1.0 |
| **Date** | July 2026 |
| **Status** | Draft for review |

> **Note on placeholders.** Items shown in square brackets need your input before this document is shared. They are listed together in Appendix A.

---

## 1. Executive summary

This proposal describes a web platform to replace the WhatsApp messages and paper logbooks currently used to manage three Clash of Clans clans.

The platform will automatically pull match data from Supercell's official Clash of Clans API and store it permanently, solving a problem that no amount of discipline in WhatsApp can fix: Clan War League data is deleted from the API when the season ends, and once it is gone it cannot be recovered. Everything the clans currently record by hand exists in the API for a few days and then disappears forever.

The system covers Clan War League, regular clan wars, Raid Weekend, Clan Games, base layout sharing, and clan announcements, across all three clans in a single interface with role-based access.

Hosting cost is zero. The platform runs entirely on free service tiers, with no credit card required and no monthly bill. The only investment is development time.

The project is built solo with no fixed deadline, using an incremental approach where each module is released to the clans as it becomes usable rather than waiting for the whole system to be complete.

---

## 2. Background

The clan family consists of three clans led by [FRIEND'S NAME]:

| Clan | Tag | Approx. members | League |
|---|---|---|---|
| [CLAN 1 NAME] | [#TAG] | [30/50] | [LEAGUE] |
| [CLAN 2 NAME] | [#TAG] | [30/50] | [LEAGUE] |
| [CLAN 3 NAME] | [#TAG] | [30/50] | [LEAGUE] |

Coordination today happens through two tools:

**A WhatsApp group** is used for announcements, war calls, base layout sharing, and general discussion. All message types share one timeline.

**Handwritten logbooks** are used to record Clan War League participation, attacks used, stars earned, and bonus medal decisions. These are maintained manually by the leader or a co-leader during each seven-day CWL season.

Both tools work, in the sense that the clans function. But both are lossy, and the effort required grows with every clan added.

---

## 3. Problem statement

### 3.1 Information is buried, not stored

WhatsApp is a conversation, not a database. A base layout shared three weeks ago is functionally gone — nobody will scroll back to find it. Important announcements are pushed off the screen within hours by ordinary chat. There is no way to ask "what did we agree about bonus medals last season" and get an answer.

### 3.2 Manual record-keeping does not scale

Recording CWL participation by hand requires someone to check the game repeatedly for seven consecutive days, across three clans. That is twenty-one clan-days of manual observation per month. Realistically, entries get missed, and a missed entry cannot be reconstructed later.

### 3.3 Historical data is permanently destroyed

This is the most serious issue and the strongest reason to build the system.

The Clash of Clans API exposes Clan War League data only while the league is in progress. When the season ends, the data is removed. It is not archived and cannot be requested again. The same is true for a regular war once the next war begins.

Every month that passes without an automated capture is a month of clan history that is gone permanently. The logbook exists precisely because of this, and it captures only a fraction of what the API briefly makes available.

### 3.4 Decisions cannot be justified with evidence

Bonus medal allocation, promotion, and removal from the clan are all judgement calls that members may dispute. Without reliable records, these decisions rest on memory and are a recurring source of friction.

### 3.5 The three clans cannot be seen together

Members move between the clans. Their history does not move with them. There is no combined view of the clan family, so the leader cannot see who is genuinely active across all three, or who has been carried by a stronger clan for months.

---

## 4. Objectives

| # | Objective | Success measure |
|---|---|---|
| O1 | Capture CWL data automatically and permanently | 100% of CWL war days recorded with no manual entry |
| O2 | Eliminate the handwritten logbook | Logbook not used for a full CWL season |
| O3 | Provide a single view across all three clans | Leader can compare participation across clans in one screen |
| O4 | Make participation history queryable | Any member's record for the last 6 months retrievable in under 30 seconds |
| O5 | Give base layouts a permanent, searchable home | Layouts findable by Town Hall level and type, not by scrolling chat |
| O6 | Operate at zero recurring cost | Monthly hosting bill remains at zero |
| O7 | Protect member data | No member can access another clan's private data or another member's account |

---

## 5. Scope

### 5.1 In scope

- Clan War League tracking, including daily snapshots, per-player attacks, stars, and missed attacks
- Availability polls before each Clan War League season and before each war
- Roster selection by leadership across all three clans, published to members
- Comparison of the selected roster against the players who actually participated
- Per-member contribution reports after each season and each war
- Bonus medal recording, with an auditable record of who awarded what and why
- Regular clan war board, including target assignment and attack status
- Raid Weekend participation and Clan Capital medal tracking
- Clan Games participation scoring
- Base layout library with in-game copy links, screenshots, and filtering
- Clan announcements and notice board
- Player identity verification via the official Clash of Clans player API token
- Role-based access covering leader, co-leader, elder, and member
- Multi-clan support for three clans in one deployment
- Progressive Web App with browser push notifications

### 5.2 Out of scope

The following are deliberately excluded, and the reasons matter.

**WhatsApp integration.** The WhatsApp Business API is a paid product requiring business verification, and it does not permit a bot to read or post in ordinary group chats. There is no free or compliant route to integrate with the existing group. WhatsApp will continue to be used for conversation; the platform handles records and announcements.

**Discord or Telegram bots.** Technically free and viable, but excluded at the client's request. The design does not preclude adding one later.

**In-game actions.** The Clash of Clans API is read-only. No system, including this one, can kick members, send messages in game, or modify a village. All actions of that kind remain manual.

**Attack replays and video.** Not exposed by the API.

**Base layout data.** The API does not provide base layouts in any form. Layouts must be uploaded by members as an in-game copy link plus a screenshot.

**Public access.** The platform serves three specific clans. It is not a public product and will not accept sign-ups from other clans.

**Monetisation.** The Clash of Clans API key is issued for non-commercial use. Advertising or charging money would breach Supercell's terms and risk the key being revoked.

---

## 6. Review of existing solutions

Several public Clash of Clans tools already exist. They were reviewed to confirm that building is justified.

| Tool | Strength | Why it does not solve this problem |
|---|---|---|
| ClashOfStats | Strong player and clan history | Read-only public statistics. No war planning, no bonus medal records, no clan-family view |
| Clash Ninja | Good upgrade and progress tracking | Individual player focus, not clan coordination |
| ClashKing | Extensive clan tools with Discord integration | Discord-centric, which the client has excluded. No private multi-clan management |
| In-game clan chat | Native and always available | Extremely short history, no structure, no export |

The common gap is that all of these serve either the individual player or the general public. None provides a private, permanent, multi-clan operational record owned by the clan leadership. That is the space this project occupies.

---

## 7. Proposed system

### 7.1 Module overview

| Module | Purpose | Primary users |
|---|---|---|
| M1 — Identity and roles | Account creation, player tag verification, role assignment | All |
| M2 — Clan directory | Live member list per clan, roles, donation and activity data | All |
| M3 — Clan War League | Season roster, daily war results, per-player attacks, missed attacks, bonus medals | Leadership, all members read-only |
| M4 — Clan war | Current war board, target assignment, attack status, war history | Leadership assign, members view and claim |
| M5 — Raid Weekend | Attacks used, capital loot, participation history | All |
| M6 — Clan Games | Per-season points per player | All |
| M7 — Base layouts | Upload, browse, filter, and vote on layouts | All |
| M8 — Announcements | Pinned notices and clan-family posts | Leadership post, all read |
| M9 — Admin | Sync health, audit log, member management | Leader only |
| M10 — Polls and roster selection | Availability polls, leader's roster selection across the three clans, contribution reports | Leadership select, all members respond and view |

### 7.2 Key features by module

**M1 — Identity and roles.** Members sign up with an email address, then prove ownership of their Clash of Clans account using the API token generated in game under Settings, More Settings, API Token. The token is verified against Supercell's verification endpoint and immediately discarded. This prevents any member from claiming another player's identity or record.

**M3 — Clan War League.** The core module. A scheduled job runs throughout each CWL season and writes an append-only record of every war day: opponent, roster, and every attack with stars and destruction percentage. Missed attacks are calculated, not typed. Bonus medal awards are recorded with the awarding leader's name and a timestamp, producing a permanent, disputable-in-good-faith record.

**M4 — Clan war.** Two separate concepts, deliberately not merged: the plan, which is what leadership assigned, and the outcome, which is what the API reports actually happened. Keeping these apart is what allows the system to show where planning and execution diverged.

**M7 — Base layouts.** Each entry stores the in-game copy link, a screenshot, Town Hall level, layout type such as war, farming, or trophy, the uploading member, and a vote count. This converts a stream of chat images into a searchable library.

**M9 — Admin.** Every page displays the age of its data. If a scheduled job fails, the leader sees it immediately rather than discovering it after a season is lost.

**M10 — Polls and roster selection.** The modules above record what the game did. This one supports what the leadership decides, which is the larger share of the actual workload.

Before each Clan War League season the leader opens an availability poll across all three clans. Members answer in one action. The leader then sees a single pool of available players — with their poll answer, current clan, Town Hall level, previous season performance, and activity score — and assigns players into each clan's roster. The database prevents a player being placed in two clans for the same season. The published roster is visible to every member, replacing a WhatsApp message that would otherwise be buried within hours.

The same pattern applies to regular wars, where the API cannot report who will participate, only who did.

After the season, the system compares the selected roster against the players who actually appeared, and produces a contribution report per member: attacks used, stars, average destruction, missed days, and bonus medal outcome. This comparison between plan and reality is the capability that neither the logbook nor WhatsApp can provide, and it is what converts bonus medal allocation from an argument into a decision with evidence behind it.

All of this is retained permanently and browsable by season.

---

## 8. System architecture

### 8.1 Overview

```
        Member's phone or browser
                    |
                    |  HTTPS
                    v
        Next.js application on Vercel
        (user interface + server API routes)
                    |
        +-----------+-----------+
        |                       |
        v                       v
   Supabase                RoyaleAPI proxy
   PostgreSQL + Storage         |
   (permanent records)          v
        ^                Clash of Clans
        |                official API
        |                (read-only)
        |
   GitHub Actions
   scheduled jobs
   (snapshots + backups)
```

### 8.2 Design decisions

**The browser never contacts the Clash of Clans API.** All game requests pass through the application's own server routes. The API key exists only on the server. This is both a security requirement and a practical one, since the key is bound to a fixed IP address.

**A proxy solves the fixed IP problem.** Supercell binds each API key to specific IP addresses. Serverless hosting has no fixed IP, which normally forces a paid virtual server. Routing requests through the RoyaleAPI proxy and registering the proxy's IP on the key removes this obstacle and keeps hosting free.

**Scheduled jobs run outside the web application.** GitHub Actions runs the snapshot jobs on a schedule, independent of whether anyone is using the site. This also keeps the free database from being suspended for inactivity.

**Records are append-only.** Snapshot jobs insert, never overwrite. Combined with unique database constraints, this makes every job safe to re-run and makes accidental data loss structurally difficult.

---

## 9. Technology stack

| Layer | Technology | Justification |
|---|---|---|
| Framework | Next.js with React and TypeScript | Single codebase for interface and server API. Strong mobile support, which matters because members will use phones |
| Styling | Tailwind CSS | Rapid interface development without a separate design system |
| Hosting | Vercel Hobby tier | Free, no credit card, automatic deployment from Git |
| Database | Supabase PostgreSQL | Free tier. Relational model suits the data. Row Level Security enforces access rules at the database layer |
| File storage | Supabase Storage | Free tier for base layout screenshots |
| Authentication | Supabase Auth | Free, integrates directly with Row Level Security |
| Game API access | Official API via RoyaleAPI proxy | Free. Removes the fixed IP restriction |
| Scheduled jobs | GitHub Actions | Free. More flexible scheduling than the free hosting tier provides |
| Notifications | Web Push, Progressive Web App | Free. Delivers alerts without requiring Discord or Telegram |

### 9.1 Known limitations of the free tier

These are accepted trade-offs, documented so they are not discovered as surprises.

| Limitation | Effect | Mitigation |
|---|---|---|
| Application sleeps when idle | First visit of the day may take 20 to 60 seconds | Members informed. Scheduled jobs keep the service partly warm |
| Database storage capped at 500 MB | Adequate for years of text records | Screenshots stored separately. Monitor growth |
| File storage capped at 1 GB | Roughly 1,000 compressed screenshots | Compress on upload. Archive old layouts |
| Database suspends after 7 days idle | Would take the site offline | Daily scheduled job prevents this automatically |
| No managed database backups | Data loss would be unrecoverable | Weekly automated export to private storage. See section 12 |

---

## 10. Data model

### 10.1 Core structure

Every record belongs to a clan. The `clan_id` column and the access rules built on it are the foundation of the multi-clan design, and are present from the first table created rather than added later.

```
clans               id, tag, name, badge_url, is_active
users               id, email, display_name, created_at
players             id, clan_id, user_id, tag, name, th_level,
                    verified, current_role
clan_roles          user_id, clan_id, role

cwl_seasons         id, clan_id, season, league
cwl_wars            id, season_id, day_number, opponent_name,
                    our_stars, their_stars, result
cwl_attacks         id, war_id, player_id, stars, destruction,
                    defender_position, attacked_at
cwl_bonuses         season_id, player_id, awarded_by, awarded_at, note

wars                id, clan_id, opponent_name, team_size, state,
                    start_time, end_time
war_targets         id, war_id, player_id, target_position, note,
                    assigned_by
war_attacks         id, war_id, player_id, stars, destruction,
                    attack_order

raid_seasons        id, clan_id, start_date, end_date, total_loot
raid_participants   id, raid_season_id, player_id, attacks_used, loot

clan_games          id, clan_id, season, start_date, end_date
clan_games_scores   id, clan_games_id, player_id, points

base_layouts        id, clan_id, uploaded_by, th_level, layout_type,
                    copy_link, image_url, votes, created_at
announcements       id, clan_id, author_id, title, body, pinned,
                    created_at

push_subscriptions  id, user_id, endpoint, keys
sync_log            id, clan_id, job_type, ran_at, status, error
audit_log           id, user_id, action, entity, entity_id, created_at
```

### 10.2 Notable design points

**`war_targets` is separate from `war_attacks`.** The plan and the outcome are distinct records. Merging them would destroy the ability to review planning quality.

**`sync_log` is a first-class table, not an afterthought.** A scheduled job that fails silently during a CWL season causes permanent, unrecoverable data loss. This table, surfaced in the interface, is the mechanism that makes such a failure visible within hours rather than days.

**`audit_log` records who changed what.** This protects the leader against both accidents and deliberate damage by a departing member.

**Deletion is always soft.** Records carry a `deleted_at` column and are never physically removed. Given that deleted history cannot be re-fetched from the API, this is a necessary safeguard.

---

## 11. Data synchronisation strategy

The Clash of Clans API provides no webhooks or push notifications. All data must be collected by polling on a schedule.

### 11.1 Schedule

| Data | Frequency | Rationale |
|---|---|---|
| Clan member list | Hourly | Changes slowly |
| Current war | Every 15 minutes while active, every 5 minutes in the final hour | Attack data must be captured before the war closes |
| Clan War League | Every 2 hours during the season, plus a guaranteed capture after each war day ends | The data is destroyed at season end |
| Raid Weekend | Daily, Friday to Monday | The API retains recent history, so urgency is lower |
| Clan Games | At season start and end | Scores are derived from the difference between two snapshots |

### 11.2 Reliability principles

**All jobs are idempotent.** Unique database constraints on natural keys mean a job can run any number of times without creating duplicate or conflicting records. This matters in practice because jobs will be re-run during development and after failures.

**Scheduled execution is not punctual.** Free scheduled runs can be delayed by ten to twenty minutes. No job is designed to depend on running at an exact moment.

**API error states are handled explicitly.** The system must correctly handle a clan not in war, a war that has ended, a private war log returning an access error, and the absence of a CWL group outside the first week of each month. Each of these is a normal condition, not an exception.

### 11.3 Clan Games scoring

The API does not expose Clan Games points directly. Each player carries a lifetime achievement total. Capturing this value at the start and end of each Clan Games period and taking the difference yields that player's score for the season. The same technique applies to seasonal donation figures.

---

## 12. Security and privacy

### 12.1 Threat assessment

An honest assessment of the risk profile shapes where effort is spent.

The Clash of Clans API is read-only. No endpoint can alter a village, remove a member, or spend currency. A leaked API key therefore cannot damage anyone's game account. The realistic consequences are rate limiting and revocation of the key.

The genuine risks are internal: incorrect access control exposing one clan's data to another, a member impersonating another player, accidental or malicious data deletion, and total loss of the database. These receive the majority of the security effort.

### 12.2 Controls

**Access control at the database layer.** Row Level Security policies are defined in PostgreSQL itself, so a defect in application code cannot bypass them. Every query is filtered by clan membership and role. This is the single most important security control in the system, and it is verified by deliberate testing: authenticating as an ordinary member of one clan and attempting to request another clan's data directly.

**Identity verification.** Members prove ownership of their Clash of Clans account using the official player API token. The token is verified and discarded, never stored and never written to logs.

**Credential handling.** The API key is held in environment variables on the server and in the repository's secrets store. It never appears in client code, in the repository, or in log output. The repository remains private.

**Upload safety.** Screenshot uploads are size-limited, validated by actual file content rather than filename, stripped of embedded metadata, and served directly from object storage rather than through the application.

**Content safety.** Announcements are stored as plain text or restricted markdown. Raw HTML is never rendered, preventing script injection by any member with posting rights.

**Rate limiting.** The application's own API routes are rate limited to prevent the platform being used as an open proxy to the Clash of Clans API, which would risk the key being throttled.

**Backups.** A weekly automated export writes the full database to private storage. Because destroyed CWL history cannot be recovered from any external source, this control is treated as essential rather than optional and is implemented in the first phase of development.

### 12.3 Member awareness

The platform asks members to paste an in-game API token, which conditions them to share credentials with websites. To avoid creating a habit that phishing sites could exploit, the verification page will state explicitly that the API token is safe to share, that a Supercell ID password is never required by any site, and that members should verify the address before entering anything.

---

## 13. Development plan

Development proceeds in phases, with each phase released to the clans as it becomes usable. There is no fixed deadline. The ordering is chosen so that value arrives early and later modules reuse code written for earlier ones.

| Phase | Deliverable | Notes |
|---|---|---|
| 1 | Foundation | Project setup, database schema, authentication, player verification, roles, clan sync, backup job |
| 2 | Clan War League | Snapshot job, sync log, season view, attack records, missed attacks, bonus medals |
| 3 | Announcements and notifications | Notice board, Progressive Web App, push notifications |
| 4 | Clan war | Current war board, target assignment, war history. Reuses phase 2 structure |
| 5 | Raid Weekend | Participation and medal tracking |
| 6 | Clan Games | Snapshot-difference scoring |
| 7 | Base layouts | Upload, storage, filtering, voting |
| 8 | Consolidation | Cross-clan reporting, admin tools, documentation, security review |

Phase 2 is the priority. A Clan War League season that passes before it is complete is a season that cannot be recovered.

### 13.1 Development approach

The project uses AI-assisted development. This is efficient for building features but has a known weakness: generated code reliably produces correct syntax and unreliably produces correct authorisation. Generated database queries frequently omit clan filtering and role checks.

The working practice is therefore that every database query is manually reviewed for clan filtering and permission checking before it is merged, with Row Level Security acting as the safety net for anything missed. This is stated explicitly because it is the main quality risk in the chosen approach.

---

## 14. Risk register

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Scheduled job fails silently during CWL | Medium | Severe and permanent | `sync_log` table, data age indicator on every page, admin alert |
| R2 | Database lost with no backup | Low | Severe and permanent | Weekly automated export from phase 1 onward |
| R3 | Clan war log set to private in game | Medium | Blocks war history collection | Confirmed public before development begins, documented as a requirement |
| R4 | API key invalidated by IP change | Medium | Sync stops | Proxy provides a stable IP. Separate keys for development and production |
| R5 | Authorisation defect exposes clan data | Medium | Moderate to serious | Row Level Security, deliberate penetration testing of clan boundaries |
| R6 | Free service tier terms change | Low | Moderate | Standard PostgreSQL and containerisable application permit migration to a low-cost server |
| R7 | Members do not adopt the platform | Medium | Project fails in practice | Early release of the CWL module, leader endorsement, WhatsApp retained for conversation |
| R8 | Free storage exhausted by screenshots | Low | Uploads blocked | Compression on upload, archival policy for old layouts |
| R9 | Solo developer availability | Medium | Slow progress | Phased releases mean partial completion still delivers value |

---

## 15. Cost

| Item | Cost |
|---|---|
| Application hosting | Free |
| Database and file storage | Free |
| Authentication | Free |
| Scheduled jobs | Free |
| Clash of Clans API key | Free, non-commercial licence |
| API proxy | Free |
| Domain | Free subdomain provided, or approximately USD 10 per year for a custom domain |
| **Recurring monthly total** | **Zero** |

The only material investment is development time. The design deliberately avoids any service that requires a credit card, so there is no possibility of an unexpected charge.

---

## 16. Success criteria

The project will be considered successful when the following are true after one full Clan War League season:

1. Every war day of the season is recorded with no manual data entry
2. The handwritten logbook was not used
3. The leader can produce any member's participation record for the previous six months within thirty seconds
4. Bonus medal allocations for the season carry a recorded justification
5. No member was able to access another clan's private data
6. Monthly hosting cost remained at zero
7. At least [X]% of members across the three clans have verified accounts

---

## Appendix A — Information required to finalise this document

| Item | Section |
|---|---|
| Your name | Cover |
| Clan leader's name | Cover, section 2 |
| Confirmed project name | Throughout, currently "ClanBridge" |
| Names and tags of all three clans | Section 2 |
| Approximate member count and league per clan | Section 2 |
| Target adoption percentage | Section 16 |

## Appendix B — Actions required before development begins

1. Register a developer account at developer.clashofclans.com and generate an API key
2. Confirm the war log privacy setting is public for all three clans
3. Verify the current RoyaleAPI proxy IP address and register it on the production key
4. Retrieve and store sample API responses for the clan, current war, CWL group, and capital raid endpoints, for use as development fixtures
5. Confirm with the clan leader whether leaders of one clan may view another clan's data
6. Confirm the rule by which bonus medals are allocated, so the system can record decisions against a stated policy

---

*End of document*