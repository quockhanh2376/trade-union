# Trade Union Project Optimisation Report

## 1. Executive Summary

**Trade Union Group Manager** là desktop app (Tauri v2 + TypeScript + Rust + PowerShell) quản lý thành viên Exchange Online Distribution Group qua 2 queue Add/Remove. Version hiện tại **v2.0.5**, branch `main`, đồng bộ hoàn toàn với remote.

Project **hoạt động đúng chức năng cốt lõi** và đã có 4 hard-constraint test (Rust) bảo vệ các bất biến quan trọng (modern auth, DisableWAM, verbatim path). Ban đầu báo cáo ghi 3 nhóm vấn đề nổi bật cần xử lý; **cả 3 nhóm nay đã được giải quyết** (F-01 → F-08).

**Tiến độ giải quyết (cập nhật 2026-08-09):**

| Finding | Severity | Status | PR | Main commit |
|---------|----------|--------|----|-------------|
| F-01 | Critical | ✅ RESOLVED | #17 | `f90d803` |
| F-02 | Critical | ✅ RESOLVED | #18 | `7208782` |
| F-03 | High | ✅ RESOLVED | #19 | `e3fc990` |
| F-04 | High | ✅ RESOLVED | #20 | `6768020` |
| F-05 | High | ✅ RESOLVED | #20 | `6768020` |
| F-06 | High | ✅ RESOLVED | #21 | `9dd7d2d` |
| F-07 | High | ✅ RESOLVED | #22 | `805756e` |
| F-08 | High | ✅ RESOLVED | #22 | `805756e` |

**Tổng quan:** 8/20 findings đã resolved. **0 Critical còn mở, 0 High còn mở.** 12 findings còn lại là Medium/Low/Informational (F-09 → F-20). Findings chi tiết + remediation cho từng mục nằm ở Section 5.

**Hướng tối ưu tiếp theo (đã cập nhật):** bắt đầu từ F-09 (CSP) — Medium cao nhất tiếp theo. Xem Section 10 (Priority Plan) và Section 15 (Next Task).

---

## 2. Analysis Scope

| Mục | Giá trị |
|----|---------|
| Local path | `E:\Trade-Union` |
| Remote repository | `https://github.com/quockhanh2376/trade-union.git` |
| Branch local | `main` |
| Commit local | `3aa0e54` (Merge PR #16 release-v2.0.5) |
| Commit `origin/main` | `3aa0e54` (đồng bộ, 0 ahead / 0 behind) |
| Thời điểm phân tích | 2026-08-06 |

**Đã đọc nội dung (full):** `src/main.ts`, `src/style.css`, `src/types.ts`, `src/email.ts`, `src/queue.ts`, `src/storage.ts`, `src/auth.ts`, `src/constants.ts`, `index.html`, `vite.config.ts`, `tsconfig.json`, `src-tauri/src/main.rs`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, `src-tauri/build.rs`, `src-tauri/capabilities/default.json`, `src-tauri/installer-hooks/clean-install.nsh`, 4 file `src-tauri/scripts/*.ps1`, 3 file `tests/*.test.mjs`, `package.json`, `package-lock.json` (top), `.gitignore`, `README.md`, `project_analysis.md`, `RELEASE_CHECKLIST_v1.1.0.md`, `AGENTS.md`, `RELEASE_NOTES_v2.0.5.md`.

**Bỏ qua (sinh tự động/dung lượng lớn):** `.git/`, `node_modules/` (~60 MB), `dist/`, `src-tauri/target/` (~15 GB build cache), `__pycache__/`. Vẫn ghi nhận dung lượng.

**Giới hạn gặp phải:** Không có quyền `gh` CLI (chưa login) nên không kiểm tra được GitHub Release/PR state trực tiếp; các kết luận về remote dựa trên `git ls-remote` và `git fetch`. Không chạy behavioral test vì không có test harness DOM/PowerShell mock.

---

## 3. Local and Remote Comparison

| Kiểm tra | Kết quả |
|----------|---------|
| Local clean hay dirty | **Dirty (untracked only)** — 3 file untracked: `.zcode/`, `AGENTS.md`, `docs/`. Không có thay đổi tracked nào chưa commit. |
| Ahead/behind/diverged | **0 / 0** — đồng bộ hoàn toàn với `origin/main`. |
| File local khác remote | Không (working tree không có tracked diff). |
| Untracked files | `.zcode/` (tooling), `AGENTS.md` (doc chính xác nhất nhưng chưa commit), `docs/superpowers/plans/` (ghi chú thiết kế). |
| Staged / unstaged | Không có. |
| Rủi ro conflict | **Không** — local = remote. |
| Khuyến nghị đồng bộ | Không cần thao tác remote. Chỉ cần quyết định có commit `AGENTS.md` + `docs/` hay không. |

> Lưu ý: `AGENTS.md` (file hướng dẫn agent, chính xác nhất về kiến trúc hiện tại) và `docs/` đang untracked dù được các doc khác tham chiếu — đây là điểm bất nhất nhỏ.

---

## 4. Project Architecture

### Tech stack
- **Frontend:** TypeScript (strict mode) + Vite 5, **không framework** — UI render bằng template string + `innerHTML` + DOM manipulation thủ công.
- **Backend:** Rust (edition 2021), Tauri v2.3.
- **Automation:** PowerShell (`ExchangeOnlineManagement` module, bundled offline v3.9.2).
- **Build target:** ES2021, Chrome 105, Safari 13.

### Cấu trúc module
```
src/                    # FRONTEND (8 file)
├── main.ts (654)       # Monolith: template HTML + ~30 querySelector + tất cả logic
├── queue.ts (28)       # state singleton + mutation helpers
├── email.ts (41)       # normalize/parse/escape
├── storage.ts (93)     # localStorage/sessionStorage wrappers
├── auth.ts (30)        # in-memory auth TTL cache (10 min)
├── constants.ts (9)    # keys, regex, limits
├── types.ts (18)       # QueueName, GroupRunResult, ActionDetail
└── style.css (800)     # dark glassmorphism theme

src-tauri/
├── src/main.rs (555)   # 3 Tauri commands + PowerShell invocation
├── scripts/*.ps1 (4)   # manage_distribution_group (LIVE), detect/single/finalize (DEAD)
├── vendor/ (~61MB)     # ExchangeOnlineManagement 3.9.2 bundled offline (TRACKED)
└── installer-hooks/    # NSIS clean-install hook
```

### Entry points & luồng dữ liệu
1. `index.html` → `src/main.ts` (bootstrap).
2. Frontend gọi backend **chỉ qua 3 `invoke`**: `save_email_queues`, `run_group_action`, và `load_seed_emails` (backend command từng không được gọi — đã fix trong F-02, giờ frontend nạp queue đã persist lúc startup).
3. `run_group_action` (Rust) → `spawn_blocking` → `Command::new("pwsh.exe")` chạy `manage_distribution_group.ps1 -File` → parse `RESULT_JSON:` từ stdout → trả `GroupRunResult`.

### Điểm mạnh kiến trúc
- **Layering sạch:** frontend không đụng file/Exchange; Rust không đụng DOM; PowerShell không import app code. Hợp đồng là 3 command name.
- **Injection-resistant by construction:** dùng `-File` + `cmd.arg()` (argv token riêng) + PowerShell-side `Test-ValidEmail` regex → email/group string không thể shell-inject.
- **Modern auth bắt buộc:** không có `-Credential` ở đâu (có test bảo vệ).
- **Async/blocking split đúng:** heavy work nằm trong `spawn_blocking`.

### Điểm yếu kiến trúc
- `main.ts` là monolith 654 dòng làm 5 việc (UI render, state, logging, progress, drag-drop).
- `queue.ts` export `state` singleton mutable → `main.ts` bypass helper và mutate trực tiếp (dòng 333, 415, 431) → encapsulation leaky.
- 4 PowerShell script copy-paste ~250 dòng common helper (không có `.psm1` chung).

---

## 5. Findings

> **Cập nhật 2026-08-09:** F-01 → F-08 đã RESOLVED (xem cột Status). Finding text gốc được giữ nguyên để bảo toàn audit history; trạng thái giải quyết + remediation ghi ở cột cuối. F-09 → F-20 vẫn OPEN.

| ID | Mức độ | Nhóm | Vấn đề | Bằng chứng | Ảnh hưởng | Khuyến nghị | Status |
|----|--------|------|--------|-----------|-----------|-------------|--------|
| F-01 | **Critical** | Correctness | `package-lock.json` lệch version `2.0.4` trong khi `package.json`/`Cargo.toml`/`tauri.conf.json` = `2.0.5` | `package-lock.json:3,9` vs `package.json:4` | Build không tái lập đúng version; `npm ci` install metadata sai; release v2.0.5 có metadata inconsistent | `npm install` để regenerate lockfile, commit lại | ✅ RESOLVED — PR #17 (`f90d803`). `npm install --package-lock-only` regenerate lockfile về 2.0.5 |
| F-02 | **Critical** | Correctness | `initializeEmptyQueues` luôn wipe `state` về `[]` rồi `persistQueues()` — nhưng không bao giờ gọi `load_seed_emails` của backend | `src/main.ts:571-583` wipe + persist; `load_seed_emails` defined tại `main.rs:321` nhưng không có `invoke("load_seed_emails")` nào trong `main.ts` | Mỗi lần app khởi động, queue files (`emails.txt`/`removeemail.txt`) bị ghi đè về rỗng → backend persist vô nghĩa; `load_seed_emails` là dead command | Hoặc gọi `load_seed_emails` để nạp, hoặc xóa command + bỏ persist-on-startup (cần xác nhận intent) | ✅ RESOLVED — PR #18 (`7208782`). `initializeQueues` giờ load qua `resolveInitialQueues` + `loadFailed` lock khi load fail |
| F-03 | **High** | Testing | Không có behavioral test nào cho sản phẩm thật. 14 Node assertions + 4 Rust tests đều là **regex trên source text**, chỉ pin "spelling" không pin behavior | `tests/*.test.mjs` toàn `assert.match(source, /regex/)`; `main.rs:460-513` cũng grep `.ps1` | Regression trong logic email/queue/run-flow không bị phát hiện; refactor an toàn là không thể | Thêm unit test thật cho `normalizeEmail`/`parseEmails`/`queue` mutations (extract pure functions, test bằng vitest/node:test) | ✅ RESOLVED — PR #19 (`e3fc990`). 50 behavioral tests import production code (email.ts, queue.ts, run-reconciliation.ts) |
| F-04 | **High** | Dead code | `cli.py`, `trade_union.py`, `test_trade_union.py`, `AddEmailsToDistList.ps1` vẫn tracked nhưng không được `main.rs`/`main.ts` tham chiếu — là Python CLI đã chết | `git ls-files` confirm tracked; grep `TRADE_UNION` trong Rust chỉ match env-var; `project_analysis.md:46,132` + `AGENTS.md:11-13` flag từ lâu | Repo phình, reviewer nhầm sản phẩm; `test_trade_union.py` (247 dòng behavioral test) tạo ảo giác có test coverage | Xóa 4 file (sau khi confirm); cập nhật `README.md` | ✅ RESOLVED — PR #20 (`6768020`). Xóa 4 file + README deprecation notice |
| F-05 | **High** | Dead code | 2 PowerShell script không bao giờ được invoke và không trong `bundle.resources`: `single_email_action.ps1` (153 dòng), `finalize_group.ps1` (111 dòng) | Chỉ `manage_distribution_group.ps1` được `main.rs:97,120,400` gọi; `tauri.conf.json:32-36` chỉ list `manage_distribution_group.ps1` + `detect_group_type.ps1` + vendor | 264 dòng dead code + duplication (chúng copy-paste helper từ `manage_distribution_group.ps1`) | Xóa hoặc (nếu dự định dùng) wire vào backend + thêm vào bundle | ✅ RESOLVED — PR #20 (`6768020`). Xóa 2 file + cập nhật Rust/Node test loops |
| F-06 | **High** | Backend | Không có timeout cho PowerShell execution | `main.rs:424` `cmd.output()` block vô thời hạn; không có `tokio::time::timeout`/`wait_timeout`/`kill` | Nếu Exchange auth/install hang, `invoke` promise treo vĩnh viễn, UI stuck ở indeterminate progress | Wrap `.await` trong `tokio::time::timeout`; kill process + trả error khi timeout | ✅ RESOLVED — PR #21 (`9dd7d2d`). `run_with_timeout` helper + `wait-timeout` crate + 2 drain threads tránh deadlock pipe, timeout 15 phút |
| F-07 | **High** | Frontend | `runAction` không có busy guard ở entry — double-click Run có thể trigger 2 `invoke` chạy đồng thời | `main.ts:585-586` listener gọi `runAction` unconditionally; `setBusy(true)` mới chạy ở dòng 466 *sau* validation | 2 concurrent `run_group_action` race; cả 2 `rememberAuthSession`; queue auto-remove xung đột | Thêm `if (isBusy) return;` ở đầu `runAction` (dòng 440) | ✅ RESOLVED — PR #22 (`805756e`). `canStartRun` guard ở entry `runAction`, trước payload snapshot |
| F-08 | **High** | Frontend | Drag-drop + delete handler bypass `isBusy` — user có thể mutate queue giữa chừng khi `runAction` đang chạy | `main.ts:526-547` (delete), `557-567` (drop) không check `isBusy` | Email bị xóa/kéo giữa run → `autoRemoveCompletedEmails` (dòng 496) reconcile sai, email bị lost/silent re-add | Disable drop-zone + delete buttons khi busy (trong `setBusy`) | ✅ RESOLVED — PR #22 (`805756e`). `requireMutationsAllowed()` ở 6 entry points (Add/Remove/Clear/Undo/delete/drop) |
| F-09 | **Medium** | Security | CSP bị disable hoàn toàn | `tauri.conf.json:22` `"csp": null` | Nếu XSS xảy ra trong webview, attacker có thể `invoke("run_group_action", ...)` với payload tùy ý | Set CSP restrict `connect-src 'self'`, `script-src 'self'` | 🔵 OPEN |
| F-10 | **Medium** | Maintainability | 4 PowerShell script copy-paste ~250 dòng common helper (`Add-BundledExchangeModulePath`, `Ensure-ExchangeModule`, `Get-ExchangeConnectParameters`) — không có `.psm1` chung | `manage:24`, `detect:11`, `single:22`, `finalize:14` byte-for-byte identical | Fix (vd. thêm `-Repository PSGallery`) phải apply 4 chỗ; Rust test `main.rs:513-539` bù đắp bằng cách ép sync | Tạo `ExchangeCommon.psm1` bundle cùng, dot-source từ mỗi script | 🔵 OPEN (phạm vi giảm: chỉ còn 2 script sau F-05) |
| F-11 | **Medium** | Docs | `README.md` miêu tả Python CLI là sản phẩm chính, Tauri app chỉ là section phụ | `README.md:1-76` Python-first, Tauri chỉ từ dòng 77 | Người mới hiểu sai sản phẩm; `.python` instruction sai cho user thật | Rewrite README: Tauri-first, move Python ra "Legacy" section | 🟡 PARTIAL — F-04/F-05 đã thêm deprecation notice, nhưng chưa rewrite Tauri-first đầy đủ |
| F-12 | **Medium** | Docs | `project_analysis.md` lệch thực tế: liệt kê `src/` chỉ có 2 file (thực ra 8), nói "không có test" (thực ra có), `bundle.active: false` (thực ra true) | `project_analysis.md:29-51,128-129` | Doc gây nhầm lẫn cho maintainer | Cập nhật hoặc deprecate (AGENTS.md đã chính xác hơn) | 🔵 OPEN |
| F-13 | **Medium** | Accessibility | Modal không có focus trap / `role="dialog"`/`aria-modal`; drag-drop mouse-only (không keyboard); thiếu focus-visible outline trên hầu hết button | `style.css` `outline: none` ở các input; history modal `main.ts:117-128` thiếu role/aria | Keyboard/screen-reader user không dùng được đầy đủ; WCAG 2.4.7/2.1.1 | Thêm role/aria, focus trap, keyboard alternative cho drag-drop | 🔵 OPEN |
| F-14 | **Low** | Performance | `bindDynamicEvents()` re-bind toàn bộ listener + `renderZone` rewrite `innerHTML` trên mỗi mutation → O(N) per render | `main.ts:255` gọi `bindDynamicEvents` trong `render()`; `main.ts:247` innerHTML rebuild | Với 1000 email, mỗi drag/delete/keystroke teardown DOM O(N) | Event delegation (1 listener trên `<ul>` thay vì N trên `<li>`) | 🔵 OPEN |
| F-15 | **Low** | Performance | `updateBulkCount` parse toàn bộ editable trên mỗi `input` event → O(N) per keystroke = O(N²) khi gõ | `main.ts:184-188`, listener `main.ts:614-617` | Lag khi paste list lớn | Debounce update (vd. 150ms) | 🔵 OPEN |
| F-16 | **Low** | Type safety | `ActionDetail.status: string` thay vì union `"ok"\|"fail"` → ép runtime `normalizeStatus` | `types.ts:16`; `main.ts:258` | Mất type-check ở boundary; status mới không bị TS bắt | Đổi thành union, push validation lên Rust serialize | 🔵 OPEN |
| F-17 | **Low** | CI/CD | Không có CI, không có lint/format (ESLint/Prettier/rustfmt/clippy) | Không có `.github/workflows/`; không có config lint | Regression không tự bị chặn ở PR; style不一致 | Thêm GitHub Actions chạy `npm run build` + `node --test` + `cargo test` + clippy | 🔵 OPEN |
| F-18 | **Low** | Dead code/CSS | CSS rule cho element không tồn tại: `.composer textarea`, `.btn.wide`, `.lane-hint`, `.lane-head h2` | `style.css:257,667,368,352` | ~30 dòng dead CSS | Xóa sau khi confirm | 🔵 OPEN |
| F-19 | **Informational** | Hygiene | `trade-union-disable-empty-run-buttons.png` (281KB) tracked dù trong `.gitignore:60` (ignore thêm sau commit) | `git ls-files` confirm tracked | Bloat history nhẹ | `git rm --cached` (cần user approve vì touch history) | 🔵 OPEN |
| F-20 | **Informational** | Hygiene | `AGENTS.md` (doc chính xác nhất) và `docs/` đang untracked dù được commit-doc tham chiếu | `git status` untracked | Doc quan trọng không version-controlled | Commit vào repo | 🔵 OPEN |

---

## 6. Security Review

| Khía cạnh | Đánh giá | Bằng chứng |
|-----------|----------|-----------|
| **Secret management** | ✅ Tốt — không có secret/token/key trong tracked files. `.credentials/` rỗng + gitignored. | `git ls-files \| grep -iE secret\|token\|key` chỉ match tên DLL vendored |
| **Input validation (email)** | ✅ 2 lớp: Rust `normalize_email` (structural) + PowerShell `Test-ValidEmail` (strict allowlist regex) | `main.rs:162-177`; `manage_distribution_group.ps1:57-60` |
| **Shell injection** | ✅ An toàn by construction — `-File` + `cmd.arg()` argv token riêng, không qua shell | `main.rs:395-413` |
| **Authentication** | ✅ Modern auth bắt buộc (UPN), không `-Credential`; `DisableWAM` version-guarded; legacy cred file xóa lúc startup | `manage_distribution_group.ps1:123-163`; `main.rs:308-319` |
| **Authorization** | ⚠️ Không có RBAC app-level — dựa hoàn toàn vào Exchange Online permission của admin account | Theo thiết kế (admin-only tool) |
| **CSP** | ❌ **Disabled** (`"csp": null`) — XSS tiềm ẩn reach được `invoke` layer | `tauri.conf.json:22` |
| **XSS trong UI** | ✅ `escapeHtml` đầy đủ (text + cả single/double quote attribute); các sink `innerHTML` đều escape | `email.ts:34-41`; `main.ts:240,269` |
| **Dependency risks** | ⚠️ `Install-Module ExchangeOnlineManagement` fallback thiếu `-Repository PSGallery` pin + version bound | `manage_distribution_group.ps1:51` |
| **Logging dữ liệu nhạy cảm** | ⚠️ `runAction` log raw `stdout`/`stderr` từ PowerShell (dòng 489-490) vào activity log + localStorage — có thể chứa email/member info | `main.ts:489-490,221` |
| **Rate limiting / CSRF** | N/A — desktop app, không HTTP server |
| **File upload** | N/A — không có |

---

## 7. Performance Review

### Frontend
| Hiện trạng | Bottleneck | Cách đo | Tối ưu | Rủi ro |
|-----------|-----------|---------|--------|--------|
| `bindDynamicEvents` re-bind + `renderZone` innerHTML rebuild mỗi mutation (F-14) | O(N) DOM teardown per render; N=queue size | Paste 500 email, đo time mỗi drag/delete | Event delegation trên `<ul>` + diff rendering | Thay đổi lớn, cần test regression |
| `updateBulkCount` parse mỗi keystroke (F-15) | O(N²) khi gõ/dán list lớn | DevTools Performance tab khi paste 1000 dòng | Debounce 150ms | Thay đổi nhỏ, an toàn |

### Backend
| Hiện trạng | Bottleneck | Cách đo | Tối ưu | Rủi ro |
|-----------|-----------|---------|--------|--------|
| ~~PowerShell exec không timeout (F-06)~~ ✅ resolved | ~~Process hang → UI freeze vĩnh viễn~~ | ~~Mock Exchange hang, đo promise~~ | Đã fix: `run_with_timeout` + `wait-timeout` crate + 2 drain threads, timeout 15 phút (PR #21) | Đã giải quyết |
| `spawn_blocking` + `Command::output()` blocking | OK — đúng pattern | — | — | — |

### Database / Network
- Không có database. Network chỉ là Exchange Online (PowerShell-managed).
- Bundle MSI/EXE ~216-224 MB (WebView2 offlineInstaller + vendor module) — lớn nhưng trade-off cho offline install.

### Build
- `src-tauri/target` ~15 GB (build cache, gitignored) — OK.
- Frontend build `vite build` ~124ms, `tsc` nhanh — OK.
- Release build `cargo build --release` ~2 phút — chấp nhận được.

---

## 8. Dependency Review

| Dependency | Version | Đánh giá |
|-----------|---------|----------|
| `@tauri-apps/api` | ^2.1.1 | Cần thiết, version OK |
| `@tauri-apps/cli` | ^2.1.0 | Dev, OK |
| `typescript` | ^5.6.3 | OK |
| `vite` | ^5.4.10 | OK |
| `tauri` (Rust) | "2" | Major-version pin (lỏng nhưng chuẩn) |
| `serde` / `serde_json` | "1" | OK |
| `tauri-build` | "2" | OK |
| **ExchangeOnlineManagement** (vendor) | 3.9.2 | Bundled offline, reasonably current |

**Dư thừa/trùng chức năng:** Không phát hiện dependency dư thừa ở cấp package. Internally, 4 PowerShell script trùng ~250 dòng helper (F-10) — không phải dependency nhưng là duplication.

**Lockfile:** `Cargo.lock` đã đồng bộ 2.0.5. `package-lock.json` đã đồng bộ 2.0.5 (F-01 ✅ resolved PR #17). Tính tái lập JS build đã ổn định.

**Package lỗi thời:** Không audit được `npm audit` (chỉ đọc, không chạy) — cần user chạy `npm audit` để verify.

---

## 9. Testing and Quality Review

| Loại | Có/Không | Chi tiết |
|------|----------|----------|
| Unit test (behavioral) | ❌ cho app thật | Chỉ `test_trade_union.py` test dead code Python |
| Unit test (source-string) | ✅ | 14 Node assertions + 4 Rust tests — pin "spelling" không pin behavior |
| Integration test | ❌ | Không có |
| E2E test | ❌ | Không có Playwright/Vitest DOM/tauri-test |
| Lint | ❌ | Không ESLint/Prettier/clippy |
| Format | ❌ | Không rustfmt/prettier config |
| Type checking | ✅ | `tsc --noEmit` strict, zero `any` |
| Coverage | ❌ | Không đo |
| CI | ❌ | Không `.github/workflows/` |

**Luồng nghiệp vụ chưa được test bảo vệ:**
- Email normalization edge cases (`User@Domain.COM`, whitespace, dedup ordering)
- Queue state machine (drag-drop transfer, mutual exclusivity Add/Remove)
- `run_group_action` orchestration end-to-end (Rust→PS→RESULT_JSON parse→counting)
- Multi-group sequencing (vừa ship v2.0.5 nhưng chỉ pin placeholder string)
- Queue persistence round-trip (`save_email_queues`/`load_seed_emails`)
- Group-type detection flow

---

## 10. Prioritized Optimisation Plan

### Phase 0 — Safety and Baseline ✅ DONE
> F-01 → F-08 đã merge. Phase 0 + Phase 1 + phần lớn Phase 2 hoàn tất. Phase 2/3 còn lại là F-09+.
| Task | Priority | Files/Modules | Benefit | Risk | Validation | Dependencies |
|------|----------|---------------|---------|------|-----------|--------------|
| T0.1 Chạy `npm audit` + ghi baseline | Informational | `package-lock.json` | Biết vuln | Không | `npm audit` | — |
| T0.2 Chụp baseline `npm run build` + `cargo test` pass | Informational | — | Có điểm so sánh | Không | Exit code 0 | — |

### Phase 1 — Critical and High Priority ✅ DONE (F-01–F-08 resolved)
| Task | Priority | Files/Modules | Benefit | Risk | Validation | Dependencies | Status |
|------|----------|---------------|---------|------|-----------|--------------|--------|
| T1.1 Fix `package-lock.json` version skew (F-01) | Critical | `package-lock.json` | Build tái lập đúng | Thấp | `npm install` + diff chỉ version | — | ✅ PR #17 |
| T1.2 Khảo sát intent + fix queue-wipe-on-startup (F-02) | Critical | `src/main.ts:571-583` | Queue persist hoạt động | Cần xác nhận UX intent | Manual test restart app | T0.2 | ✅ PR #18 |
| T1.3 Thêm `isBusy` guard ở entry `runAction` (F-07) | High | `src/main.ts:440` | Chặn double-trigger | Thấp | Double-click Run, verify 1 invoke | — | ✅ PR #22 |
| T1.4 Disable drag/delete khi busy (F-08) | High | `src/main.ts:526-567` | Queue không mutate giữa run | Thấp | Drag giữa run, verify bị block | T1.3 | ✅ PR #22 |
| T1.5 Thêm PowerShell exec timeout (F-06) | High | `src-tauri/src/main.rs:424` | UI không freeze khi hang | Cần chọn timeout | Mock hang, verify error sau timeout | — | ✅ PR #21 |

### Phase 2 — Performance and Maintainability (F-03/F-04/F-05 ✅ resolved; F-10/F-11/F-15 còn lại)
| Task | Priority | Files/Modules | Benefit | Risk | Validation | Dependencies | Status |
|------|----------|---------------|---------|------|-----------|--------------|--------|
| T2.1 Xóa dead code Python + PS (F-04, F-05) | Medium | `cli.py`, `trade_union.py`, `test_trade_union.py`, `AddEmailsToDistList.ps1`, `single_email_action.ps1`, `finalize_group.ps1` | Repo gọn, không nhầm product | Phải confirm chưa dùng ở chỗ khác | grep toàn repo không còn reference | — | ✅ PR #20 |
| T2.2 Thêm behavioral unit test cho email/queue (F-03) | Medium | `tests/email.test.mjs` (mới), `tests/queue.test.mjs` (mới) | Phát hiện regression logic | Thấp | `node --test` pass | T2.1 (extract pure fn nếu cần) | ✅ PR #19 |
| T2.3 Extract `.psm1` chung cho PS helper (F-10) | Medium | `src-tauri/scripts/ExchangeCommon.psm1` (mới) | 1 chỗ fix thay 4 | Thấp | `cargo test` vẫn pass (test grep .ps1, cần cập nhật) | — | 🔵 OPEN |
| T2.4 Rewrite `README.md` Tauri-first (F-11) | Medium | `README.md` | Không nhầm product | Không | Review | T2.1 | 🟡 PARTIAL (deprecation notice đã thêm) |
| T2.5 Debounce `updateBulkCount` (F-15) | Low | `src/main.ts:184-188` | Bớt lag list lớn | Thấp | Paste 1000 email, đo | — | 🔵 OPEN |

### Phase 3 — Architecture and Developer Experience
| Task | Priority | Files/Modules | Benefit | Risk | Validation | Dependencies |
|------|----------|---------------|---------|------|-----------|--------------|
| T3.1 Thêm CSP (F-09) | Medium | `src-tauri/tauri.conf.json:22` | Chặn XSS→invoke | Cần test webview vẫn load | Manual run app | — |
| T3.2 Thêm CI GitHub Actions (F-17) | Low | `.github/workflows/ci.yml` (mới) | Chặn regression ở PR | Không | CI xanh | T2.2 |
| T3.3 Thêm ESLint + Prettier + clippy (F-17) | Low | config files mới | Style nhất quán | Thấp | `npm run lint` pass | — |
| T3.4 Accessibility: focus trap + keyboard DnD (F-13) | Medium | `src/main.ts`, `style.css` | Đạt WCAG | Trung bình | Axe audit | — |
| T3.5 Refactor `main.ts` monolith (F-14 prep) | Low | `src/main.ts` | Maintainability | Cao (refactor lớn) | Test suite pass | T2.2 |

---

## 11. Quick Wins

| # | Task | Lý do là quick win | Status |
|---|------|---------------------|--------|
| QW1 | Fix `package-lock.json` (T1.1) | 1 lệnh `npm install`, rủi ro gần 0, fix metadata inconsistency | ✅ DONE (F-01, PR #17) |
| QW2 | Thêm `if (isBusy) return;` ở đầu `runAction` (T1.3) | 1 dòng, chặn race condition nghiêm trọng | ✅ DONE (F-07, PR #22) |
| QW3 | Xóa `.composer textarea` + dead CSS (F-18) | Xóa ~30 dòng CSS cho element không tồn tại | 🔵 OPEN |
| QW4 | `git rm --cached trade-union-disable-empty-run-buttons.png` (F-19) | Bớt 281KB binary khỏi future commits (cần user approve) | 🔵 OPEN |
| QW5 | Commit `AGENTS.md` + `docs/` (F-20) | Doc chính xác nhất được version-controlled | 🔵 OPEN |
| QW6 | Đổi `ActionDetail.status` thành union (F-16) | 1 dòng type tightening, push validation lên boundary | 🔵 OPEN |

---

## 12. Changes Requiring User Approval

Các hành động **cần user thực hiện thủ công** (theo giới hạn an toàn):

- **Git/remote:** tạo branch, push commit, tạo/merge PR, force push, tạo/xóa tag, thay đổi repo settings.
- **Dead code removal (T2.1):** `git rm` các file Python + PS dead code — cần confirm không dùng ở tool/CI khác.
- **`git rm --cached` PNG (QW4):** touch tracked file, cần approve.
- **Dependency upgrade major:** nếu `npm audit`/`cargo audit` yêu cầu bump major.
- **CSP change (T3.1):** thay đổi security posture, cần test manual app.
- **Queue-wipe fix (T1.2):** cần xác nhận UX intent (start clean vs. restore) trước khi sửa.

> Không có thao tác remote nào được tự thực hiện trong lần phân tích này.

---

## 13. Recommended Branch and PR Strategy

| Branch | Scope | PR vào | Test cần chạy | Review criteria |
|--------|-------|--------|---------------|-----------------|
| `fix/package-lock-version` | T1.1 (lockfile skew) | `main` | `npm ci` + `npm run build` | Lockfile chỉ đổi version |
| `fix/run-action-busy-guard` | T1.3 + T1.4 (race conditions) | `main` | `node --test`, manual double-click | Không regression UI |
| `fix/powershell-timeout` | T1.5 (liveness) | `main` | `cargo test`, mock hang | Error surface sau timeout |
| `chore/remove-dead-code` | T2.1 (Python + PS dead) | `main` | grep no-reference, full test suite | Bundle size giảm |
| `test/behavioral-email-queue` | T2.2 (unit test thật) | `main` | `node --test tests/email.test.mjs` | Coverage logic core |
| `docs/readme-tauri-first` | T2.4 | `main` | Review | Không instruction sai |

**Thứ tự:** ~~T1.1 → T1.3/T1.4 → T1.5 → T2.1 → T2.2 → T2.4~~ (Phase 1 + phần lớn Phase 2 ✅ đã hoàn tất). Phase tiếp theo: T3.1 (F-09 CSP) → T2.3 (F-10 PS module) → T2.4 (F-11 README rewrite) → T3.2 (F-17 CI). Mỗi PR độc lập, rollback bằng `git revert`.

**Rollback plan:** Mỗi PR là 1 commit squash, revert an toàn vì không data migration.

---

## 14. Definition of Done

Project được xem là "đã tối ưu" khi:

- [x] `package-lock.json` version = `package.json` version (F-01 ✅ resolved PR #17)
- [x] Queue-wipe-on-startup đã có quyết định rõ + fix (F-02 ✅ resolved PR #18)
- [x] Có ≥1 behavioral test suite pass cho `normalizeEmail`/`parseEmails`/queue mutations (F-03 ✅ resolved PR #19 — 50 behavioral tests)
- [x] Dead code Python + 2 PS script đã xóa (F-04, F-05 ✅ resolved PR #20)
- [x] `runAction` có busy guard + drag/delete disabled khi busy (F-07, F-08 ✅ resolved PR #22)
- [x] PowerShell exec có timeout (F-06 ✅ resolved PR #21 — 15 phút + pipe deadlock fix)
- [ ] CSP được set (F-09 open)
- [ ] `README.md` Tauri-first (F-11 partial — deprecation notice đã thêm, chưa rewrite đầy đủ)
- [ ] CI chạy `build` + `node --test` + `cargo test` xanh trên PR (F-17 open)
- [ ] `npm audit` không có high/critical (cần user chạy để verify)
- [ ] `AGENTS.md` + `docs/` committed (F-20 open)

---

## 15. Proposed Next Implementation Task

> **Cập nhật 2026-08-09:** Task T1.1 (F-01) đề xuất trước đây đã hoàn tất (PR #17). Phần này giờ đề xuất task open tiếp theo.

**Task đề xuất tiếp theo:** **T3.1 — Thêm CSP (F-09)** (Medium, quick win).

**Lý do chọn:** F-01 → F-08 đã resolved hết. F-09 (CSP disabled) là Medium cao nhất còn mở, rủi ro thấp (chỉ đổi `tauri.conf.json`), có giá trị security rõ ràng (chặn XSS→invoke path).

**Mục tiêu:** Set CSP restrict `connect-src 'self'`, `script-src 'self'` trong `tauri.conf.json:22` thay vì `"csp": null`.

**File dự kiến thay đổi:**
- `src-tauri/tauri.conf.json` (1 dòng: `"csp": null` → CSP string)

**Test dự kiến:** Manual run app (`npm run tauri dev`) verify webview vẫn load, không lỗi CSP. Không thêm automated test (CSP là runtime config).

**Lệnh validation:**
```bash
npm run build                  # verify frontend build
npm run tauri dev              # manual verify app load + UI hoạt động
```

**Rủi ro:** Thấp — CSP chỉ restrict, không break functionality nếu frontend chỉ load local assets. Cần test manual vì CSP có thể chặn font/inline script nếu config sai.

**Điều kiện rollback:** `git checkout src-tauri/tauri.conf.json` (revert 1 file).

> ⚠️ **Không triển khai task này trong lần chạy hiện tại.** Chỉ đề xuất, chờ user quyết định.
