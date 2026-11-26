# Tab organizer

The organizer files browser tabs into groups. It starts off, and it can do that work without a model.

## Language

**Organizer** (UI: **Auto-group new tabs**):
The switch that auto-groups new tabs in the focused window after they settle. It starts off.
_Avoid_: Bot, filing switch

**LLM switch**:
The switch that allows the **Advisor** to run. It starts off.
_Avoid_: Fallback, smart mode

**Feature card**:
The short description of a tab that the **Decider** may see: the site, the cleaned title, the path words, the opener's site, and a summary of each group already in the window.
_Avoid_: Page content, prompt, snapshot

**Decider**:
The part that chooses what happens to a tab from **Feature cards**, **Rules**, and the two switches.
_Avoid_: Classifier, engine

**Heuristic**:
The part of the **Decider** that matches a tab to a site or to shared words without a model.
_Avoid_: Fallback

**Advisor**:
The local model, used only while the **LLM switch** is on, when the **Heuristic** is unsure or a **Rule** sentence is too vague to compile.
_Avoid_: Fallback, cloud model

**Rule**:
A sentence a person saved, compiled into one or more sites and a group title.
_Avoid_: Prompt, filter, instruction

**Filing**:
Placing a tab into a tab group.
_Avoid_: Sorting, clustering

**Settle**:
The moment a tab has finished loading and its title has stayed still long enough to file.
_Avoid_: Debounce

**Reveal**:
Expanding the destination group when **Filing** a tab the person is looking at, and leaving that group expanded.
_Avoid_: Flash, highlight

**Sweep**:
One pass over the current window that files ungrouped pages. The group the person is looking at stays open, and the other groups from that pass stay collapsed. A sweep leaves the **Organizer** off.
_Avoid_: Scan, cleanup

**Clean up old tabs**:
Optional close of http(s) tabs unused longer than an age threshold (`lastAccessed`). Default off. Manual runs on this window with confirmation; auto uses `chrome.alarms` across normal windows.
_Avoid_: Suspend, discard, park, never list

**Protect**:
Sites, groups, or pages that Clean up old tabs must leave alone.
_Avoid_: Never list, whitelist, blocklist

**Stickiness**:
A tab a person dragged by hand. Watch mode leaves it where they put it. A **Sweep** still files it while it sits outside a group.
_Avoid_: Pin, lock

**Site group**:
A tab group whose tabs share a site.
_Avoid_: Domain bucket

**Topic group**:
A tab group whose tabs share a subject across sites.
_Avoid_: Task, session
