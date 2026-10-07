# rhwp 업데이트 운영 매뉴얼

이 문서는 HOP가 사용하는 `rhwp` 안정 릴리스를 새 버전으로 올릴 때 따르는 실행 체크리스트다.
경계의 설계와 소유권 원칙은 [`UPSTREAM.md`](../architecture/UPSTREAM.md)를 참고한다.

## 업데이트가 바꾸는 범위

`pnpm upstream:update -- <tag>`는 다음 항목을 하나의 candidate로 맞춘다.

* `third_party/rhwp` submodule pointer
* `config/rhwp-upstream.json`의 버전, 태그, 커밋, Rust 및 WASM 생성기 기준선
* `apps/studio-host/vendor/rhwp-core`의 WASM package와 provenance
* desktop과 Quick Look의 HOP-owned `[patch]` 선언과 `Cargo.lock`
* upstream에서 미러링하는 studio asset
* `config/rhwp-studio-overrides.json`의 upstream counterpart hash

`third_party/rhwp` 파일을 직접 고치거나 HOP 기능을 그 안에 추가하지 않는다.

## 1. 시작 전 준비

1. upstream GitHub Releases에서 올릴 안정 태그를 정한다. `vX.Y.Z` 형태의 명시적인 release tag만
   사용하고 branch, `main`, prerelease tag는 사용하지 않는다.
2. 현재 작업을 별도 브랜치에서 시작하고, 업데이트 도구가 소유하는 아래 파일에 미완료 변경이 없는지
   확인한다.

   ```sh
   git status --short
   git -C third_party/rhwp status --short
   ```

3. submodule과 JS 의존성을 현재 lockfile대로 준비한다.

   ```sh
   git submodule update --init --recursive
   pnpm install --frozen-lockfile --lockfile=true
   pnpm upstream:verify
   ```

4. `config/rhwp-upstream.json`의 `wasmPackVersion`과 로컬 `wasm-pack --version`이 같은지 확인한다.
   Rust toolchain은 candidate의 upstream `rust-toolchain.toml` 값으로 업데이트 도구가 선택한다.

## 2. candidate 생성

```sh
pnpm upstream:update -- vX.Y.Z
```

도구는 공식 `edwardkim/rhwp` origin에서 정확한 태그를 fetch하고 detached commit으로 이동한다.
WASM을 임시 디렉터리에서 새로 만들고, Cargo lockfile과 provenance 및 override baseline을 갱신한 뒤
전체 upstream 계약을 다시 검증한다. 검증 전에 기존 vendored WASM을 재사용하거나 생성 단계를 생략할
수 없다.

`wasm-pack` 자체를 의도적으로 올리는 작업이라면 새 버전의 재현성과 결과 diff를 먼저 검토한 후에만
다음처럼 한 번 허용한다.

```sh
HOP_ALLOW_WASM_PACK_VERSION_CHANGE=1 pnpm upstream:update -- vX.Y.Z
```

이 환경 변수는 일반적인 rhwp 업데이트에는 사용하지 않는다.

## 3. 생성된 diff 리뷰

```sh
git status --short
git diff --submodule=log -- third_party/rhwp
git diff -- config/rhwp-upstream.json config/rhwp-studio-overrides.json
git diff -- apps/desktop/src-tauri/Cargo.toml apps/desktop/src-tauri/Cargo.lock
git diff -- apps/desktop/quicklook/rust/Cargo.toml apps/desktop/quicklook/rust/Cargo.lock
git diff -- apps/studio-host/vendor/rhwp-core/PROVENANCE.json
```

다음을 확인한다.

* tag, commit, Cargo package, studio package와 vendored WASM 버전이 모두 같다.
* provenance에는 배포되는 모든 vendor 파일의 byte 수와 SHA-256이 있다.
* 두 Cargo manifest의 patch Git source/revision 또는 upstream vendor path/version과 lockfile의 `rhwp`가 같은 새 버전을 가리킨다. upstream이
  patch 저장소를 옮겼다면 updater가 이전 계약에서 새 계약으로 두 manifest를 함께 전환해야 한다.
* updater가 출력한 `Review changed studio inputs`의 각 파일을 upstream diff와 비교한다.
* `extension` 또는 `fork` counterpart 변경이 HOP adapter와 override의 전제 조건을 깨지 않는다.
* upstream에서 사라진 command, import, public asset 또는 native API를 HOP가 계속 참조하지 않는다.
* upstream 새 기능을 HOP 제품 정책에 자동 노출하지 않는다. 파일 형식, 저장, 인쇄, 창, recovery 동작은
  별도로 채택 여부를 결정한다.

upstream이 `svg2pdf`를 vendor path로 제공하면 두 native manifest는 각 manifest에서
`third_party/rhwp/vendor/svg2pdf`까지의 상대 경로를 사용한다. 기준선에는 upstream-relative path,
package version을 기록한다. 소스는 upstream commit으로 고정하며 검증기는 checkout의
tracked 변경·untracked 추가, 경로 이탈, lockfile의 단일 local package를 확인한다. Git patch를 사용하는 이전
기준선은 기존 source/revision 검증을 유지한다.

각 변경된 counterpart는 다음 순서로 분류한다.

1. upstream이 HOP workaround를 흡수했다면 override, alias, baseline과 전용 테스트를 함께 제거한다.
2. 제품 정책만 남았다면 공개 API를 조합하는 작은 adapter/extension으로 축소한다.
3. 독립적인 desktop 기능이면 contribution으로 유지한다.
4. upstream 내부 구현을 계속 복사해야 할 때만 fork를 유지하고 manifest 이유와 검증 책임을 갱신한다.

특히 renderer lifecycle, page positioning, ruler, undo/snapshot, validation repair를 host에서 재구현하지
않는다. upstream 공개 protocol을 사용하고 HOP은 backend 선택, native session, font authoring처럼 제품이
소유하는 정책만 경계에서 주입한다.

호환 수정은 우선 `apps/studio-host/src/upstream`, HOP contribution, 또는
`apps/desktop/rhwp-adapter`에 둔다. upstream 전체 파일 복사는 마지막 수단이며, 새 override가 필요하면
manifest에 전략과 이유를 함께 기록한다.

## 4. 자동 검증

upstream이 요구하는 Rust toolchain은 `config/rhwp-upstream.json`의 `rustToolchain` 값을 사용한다.
아래 예시의 `<toolchain>`을 그 값으로 바꾼다.

```sh
pnpm install --frozen-lockfile --lockfile=true
pnpm upstream:verify
RUSTUP_TOOLCHAIN=<toolchain> pnpm test
RUSTUP_TOOLCHAIN=<toolchain> pnpm run clippy:desktop
pnpm run build:studio
RUSTUP_TOOLCHAIN=<toolchain> pnpm --filter hop-desktop tauri build --debug --bundles app
git diff --check
```

`build:studio`나 Vitest가 Codex 앱 내장 Node의 native binding 오류로 실패하면 외부 Node 24가 먼저
선택되도록 `PATH`를 조정하고 `which node`로 확인한 뒤 다시 실행한다.

## 5. 제품 smoke test

최소한 현재 개발 OS에서 다음 흐름을 실제 문서로 확인한다.

* HWP와 HWPX 열기, drag/drop, 최근 문서
* 편집 후 HWP 저장, 재열기, 미저장 문서 교체/종료 guard
* 외부 파일 변경 충돌 처리
* 새 창과 다중 창에서 문서·이벤트 격리
* 로컬 글꼴 조회·적용과 문서 렌더링
* PDF 내보내기, 페이지 범위, 인쇄
* macOS Quick Look preview/thumbnail

배포 candidate라면 macOS, Windows, Linux CI를 모두 통과시키고, macOS 외 Windows 또는 Linux 한
환경에서도 핵심 파일·창·인쇄 흐름을 smoke test한다. OS별 GUI 검증을 로컬 한 환경의 성공으로 대체하지
않는다.

## 6. 실패와 복구

업데이트 명령이 실패하면 백업해 둔 HOP-owned 산출물과 이전 submodule commit을 자동 복구한다. 실패
후에는 다음으로 복구 결과를 확인한다.

```sh
git status --short
pnpm upstream:verify
```

자동 복구까지 실패했다는 `AggregateError`가 나오면 출력에 기록된 두 오류를 모두 보존하고 수동으로
파일을 덮어쓰지 않는다. 현재 변경 상태를 먼저 백업한 뒤 원래 gitlink와 lockfile을 기준으로 복구한다.
`git reset --hard`, force push, 태그 이동으로 복구하지 않는다.

## 완료 기준

* 업데이트 대상이 공식 source의 불변 안정 태그와 정확한 commit으로 고정되어 있다.
* updater가 관리하는 모든 산출물과 두 Cargo dependency graph가 같은 rhwp를 사용한다.
* 변경된 counterpart를 검토했고 필요한 호환 수정이 HOP-owned 경계 안에 있다.
* 자동 검증과 필요한 플랫폼 smoke test 결과가 작업 기록에 남아 있다.
* `third_party/rhwp` 내부는 clean이고 의도하지 않은 생성물이나 임시 파일이 없다.
