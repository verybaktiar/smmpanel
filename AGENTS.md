# Project instructions

Bahasa kerja: Indonesia.

## Antislop (selalu aktif untuk semua coding di proyek ini)

Standing session instruction: jalankan antislop dalam mode **during** untuk setiap tugas coding di proyek ini — terapkan rules-nya saat membangun, tutup dengan Delivery Gate report. Jangan tanya during/after; preferensi proyek ini adalah `during`. Untuk tugas audit/konsultasi tanpa edit file, gunakan mode **after** hanya bila diminta eksplisit.

<!-- antislop:start -->
## antislop
For UI, copy, people, mobile layout, or code comments work, read these installed skill files directly (use these paths even if a same-named global skill exists):
- Core filter, always on: `antislop`: `.agents/skills/antislop/SKILL.md`
- UI / visual: `antislop-ui`: `.agents/skills/antislop-ui/SKILL.md`
- Copy & text: `antislop-copywriting`: `.agents/skills/antislop-copywriting/SKILL.md`
- People: `antislop-human`: `.agents/skills/antislop-human/SKILL.md`
- Mobile / responsive: `antislop-layoutmobile`: `.agents/skills/antislop-layoutmobile/SKILL.md`
- Code comments: `antislop-code`: `.agents/skills/antislop-code/SKILL.md`
Before starting, follow the core's "Two Usage Modes" section in strict order: explicit session instruction first, then global preference, then ask. A session instruction always wins. For a resolved mode, say `antislop active: <mode> (session override).` or `antislop active: <mode> (global preference).` once before presenting findings or making edits, using the actual mode and source. Acknowledging the user's request without naming the source does not replace this notice.
Only an explicit choice of antislop during or after selects a session mode. A request to review, audit, or avoid file edits does not select a mode; read the global preference in that case. Another skill's mode does not select antislop's mode.
If the mode is unresolved, ask during/after and end the response; wait for the answer before any UI review, planning, or concept. For read-only tasks, put the active-mode notice only at the start of the final answer, never in progress messages. For editing tasks, announce before the first edit and omit it from the final answer.
To update antislop later: `npx antislop-ai --update`, or run `npx antislop-ai` and pick Overwrite them.
<!-- antislop:end -->

## Skill pihak ketiga: impeccable + ECC

Selain antislop, ada dua set skill terpasang di `.agents/skills/`.

**impeccable** — arah desain untuk kerja UI/UX: shape, critique, audit, polish, animate, harden, adapt. Baca `.agents/skills/impeccable/SKILL.md` sebelum mengubah tampilan. State dan artefaknya ditulis ke `.impeccable/` di root (sebagian sudah di-gitignore).

**ECC** — 46 skill proses. Yang paling relevan untuk proyek ini:

- Backend/API: `backend-patterns`, `api-design`, `coding-standards`
- Review & verifikasi: `security-review`, `verification-loop`, `change-impact`, `module-regression`
- Testing: `tdd-workflow`, `e2e-testing`, `benchmark-methodology`
- Frontend: `frontend-patterns`
- Riset & dokumen: `deep-research`, `documentation-lookup`, `docs-governance`
- Perencanaan: `plan-canvas`, `context-and-decisions`

Beberapa skill ECC (`exa-search`, `fal-ai-media`, `mcp-server-patterns`, `mcp-dependency-review`, `x-api`) butuh MCP server atau layanan yang tidak terpasang di proyek ini — jangan dipakai, biarkan saja.

## kinetics (micro-interaction library)

For any UI motion work (hover, click, toggle, toast, tabs, modal, input feedback, reveals, loaders), read the skill at `.agents/skills/kinetics/SKILL.md` and pick an effect from `.agents/skills/kinetics/references/catalog.md` (153 spring-physics micro-interactions, per-effect CSS/React code in `references/`). Adapt selectors and colors to the project; keep the spring parameters. Always gate nonessential motion behind `prefers-reduced-motion`.
