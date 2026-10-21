---
name: motion-graphics
description: Designing motion graphics for YouTube — template selection, typography, timing, color, layout and when to write custom code scenes.
---
# Motion graphics

## Choose the right template for the content
| Content | Template |
| --- | --- |
| Intro, big statement, section opener | `title-card`, `kinetic-text`, `chapter-card`, `logo-reveal` |
| A single striking number | `big-number` |
| Several numbers | `stat-grid` |
| Comparing categories | `bar-chart` (horizontal for long labels or 9:16) |
| Trend over time | `line-chart` |
| Parts of a whole | `donut-chart` |
| Steps, how-to | `steps`, `bullet-list` (icon `number`) |
| Pros/cons, A vs B, before/after | `comparison` |
| History, roadmap | `timeline` |
| Jargon | `definition` |
| Quote, testimonial | `quote`; tweets/news/comments → `social-card` |
| Passage from a document | `highlight-text` |
| Screenshots/app/website | `image-showcase` (frame `browser`/`phone`) |
| Listicle entry | `ranking` |
| Over footage | `lower-third`, `callout`, `subscribe-cta`, `emoji-burst`, `progress-bar` |
| Retention hook | `question`, `countdown` |

Use `list_templates` for exact props. Templates follow the project brand colors and fonts automatically (`set_brand`).

## Timing
- Entrances are built in; keep a scene on screen long enough to read: duration ≥ 1.5s + 0.35s per word of on-screen text. Lists/charts: give each item ~0.6–1s.
- Match scene boundaries to the narration: a scene starts when the sentence that introduces it starts.
- Full-screen scenes usually 3–8s. Overlays 2–5s.

## Typography & layout
- One message per screen. Titles ≤ 8 words. Emphasize 1–2 key words with `*asterisks*` (accent color).
- Keep text inside safe areas (templates already do). For 9:16, avoid the top 12% and bottom 25%.
- Use the brand: heading font for titles, body font for text; accent color sparingly for emphasis.

## Variety without chaos
- Alternate backgrounds (`mesh`, `grid`, `dots`, `spotlight`, `gradient`) across consecutive scenes, keep the palette.
- Don't use the same template more than 2× in a row.

## Custom code scenes (when templates are not enough)
Write a custom scene with `write_code_scene` when the idea needs bespoke animation: animated diagrams, process flows with arrows, maps-like illustrations, particle effects, data stories, kinetic typography with unusual layouts, animated icons, etc. Load the `code-scenes` skill first — it has the exact API and examples. Always review the rendered frame it returns and fix issues.
