//! 사용자에게 보이는 데스크톱 쪽 문구. 웹뷰가 정한 표시 언어(ko/en)를 따른다.
//!
//! 프런트엔드가 시작할 때 `set_ui_locale` 명령으로 언어를 알려 준다. 알려 주기 전과
//! 단위 테스트에서는 한국어다. 문구는 `{}` 자리표시자를 쓰고, 같은 키의 ko·en 문구는
//! 자리표시자 개수와 순서가 같아야 한다(테스트가 확인한다).

use std::fmt::Display;
use std::sync::atomic::{AtomicBool, Ordering};

static ENGLISH: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Lang {
    Ko,
    En,
}

/// 표시 언어를 바꾼다. `en`, `en-US` 등은 영어, 그 밖에는 한국어다.
pub fn set_locale(locale: &str) {
    let english = locale.trim().to_ascii_lowercase().starts_with("en");
    ENGLISH.store(english, Ordering::Relaxed);
}

fn current_lang() -> Lang {
    if ENGLISH.load(Ordering::Relaxed) {
        Lang::En
    } else {
        Lang::Ko
    }
}

/// 키에 해당하는 현재 언어의 문구. 없는 키는 키 문자열을 그대로 낸다(테스트가 막는다).
pub fn text(key: &'static str) -> &'static str {
    text_in(current_lang(), key)
}

/// `{}` 자리표시자를 순서대로 채운 문구.
pub fn text_with(key: &'static str, args: &[&dyn Display]) -> String {
    fill(text(key), args)
}

fn text_in(lang: Lang, key: &'static str) -> &'static str {
    match MESSAGES.iter().find(|(k, _, _)| *k == key) {
        Some((_, ko, en)) => match lang {
            Lang::Ko => *ko,
            Lang::En => *en,
        },
        None => key,
    }
}

fn fill(template: &str, args: &[&dyn Display]) -> String {
    let mut out = String::with_capacity(template.len() + 16);
    let mut rest = template;
    let mut args = args.iter();
    while let Some(pos) = rest.find("{}") {
        out.push_str(&rest[..pos]);
        match args.next() {
            Some(arg) => out.push_str(&arg.to_string()),
            None => out.push_str("{}"),
        }
        rest = &rest[pos + 2..];
    }
    out.push_str(rest);
    out
}

/// (키, 한국어, 영어)
const MESSAGES: &[(&str, &str, &str)] = &[
    ("session.lockFailed", "문서 세션 잠금 실패", "Could not lock the document session"),
    ("session.notFound", "문서 세션을 찾을 수 없습니다: {}", "Cannot find the document session: {}"),
    ("doc.blankFailed", "빈 문서 생성 실패: {}", "Failed to create a blank document: {}"),
    ("doc.newFileName", "새 문서.hwp", "New Document.hwp"),
    ("doc.parseFailed", "문서 파싱 실패", "Failed to parse the document"),
    ("doc.bytesParseFailed", "문서 바이트 파싱 실패", "Failed to parse the document data"),
    ("doc.editableConvertFailed", "편집 가능 문서 변환 실패", "Failed to prepare the document for editing"),
    ("doc.nativeCoreUnavailable", "네이티브 문서 코어를 사용할 수 없습니다", "The native document engine is not available"),
    ("doc.readFailed", "문서를 읽을 수 없습니다: {} ({})", "Cannot read the document: {} ({})"),
    ("doc.fileNotFound", "문서 파일을 찾을 수 없습니다: {}", "Cannot find the document file: {}"),
    ("doc.unsupportedExtension", "지원하지 않는 문서 확장자입니다: {}", "Unsupported document file type: {}"),
    ("doc.revisionChanged", "문서 revision이 변경되었습니다: expected {}, actual {}", "The document revision changed: expected {}, actual {}"),
    ("render.pageFailed", "페이지 렌더링 실패: {}", "Failed to render the page: {}"),
    ("query.unsupported", "지원하지 않는 query입니다: {}", "Unsupported query: {}"),
    ("mutation.unsupported", "지원하지 않는 mutation입니다: {}", "Unsupported change: {}"),
    ("args.jsonParseFailed", "JSON 파싱 실패: {}", "Failed to parse JSON: {}"),
    ("args.numberRequired", "숫자 인자가 필요합니다: {}", "A number is required: {}"),
    ("args.floatRequired", "실수 인자가 필요합니다: {}", "A decimal number is required: {}"),
    ("args.stringRequired", "문자열 인자가 필요합니다: {}", "Text is required: {}"),
    ("preview.readFailed", "미리보기용 문서를 읽을 수 없습니다: {} ({})", "Cannot read the document for preview: {} ({})"),
    ("preview.convertFailed", "미리보기용 문서 변환 실패", "Failed to prepare the document for preview"),
    ("preview.renderFailed", "문서 미리보기를 렌더링할 수 없습니다: {}", "Cannot render the document preview: {}"),
    ("save.hwpxTarget", "HWPX 경로에는 HWP 바이트를 저장할 수 없습니다. .hwp 파일로 저장하세요.", "HWP data cannot be saved to an .hwpx path. Save it as an .hwp file."),
    ("save.stagingReadFailed", "staging 파일을 읽을 수 없습니다: {} ({})", "Cannot read the staged file: {} ({})"),
    ("save.verifyFailed", "저장 바이트 검증 실패", "Failed to verify the saved data"),
    ("save.convertFailed", "저장 문서 변환 실패", "Failed to prepare the document for saving"),
    ("save.statAfterFailed", "저장 후 파일 상태를 확인할 수 없습니다: {} ({})", "Cannot check the file after saving: {} ({})"),
    ("external.changed", "파일이 외부에서 변경되었습니다", "The file was changed outside HOP"),
    ("external.removed", "원본 파일이 삭제되었거나 이동되었습니다", "The original file was deleted or moved"),
    ("external.statFailed", "원본 파일 상태를 확인할 수 없습니다: {} ({})", "Cannot check the original file: {} ({})"),
    ("external.changedOutsideHop", "원본 파일이 HOP 밖에서 변경되었습니다", "The original file was changed outside HOP"),
    ("path.saveContext", "저장 경로", "save location"),
    ("path.pdfContext", "PDF 경로", "PDF location"),
    ("path.parentMissing", "{}의 상위 디렉터리를 찾을 수 없습니다: {}", "Cannot find the parent folder of the {}: {}"),
    ("path.parentInvalid", "{}의 상위 디렉터리가 유효하지 않습니다: {}", "The parent folder of the {} is not valid: {}"),
    ("path.fileNameMissing", "저장 경로의 파일 이름을 찾을 수 없습니다: {}", "Cannot find the file name in the save location: {}"),
    ("path.saveParentMissing", "저장 경로의 상위 디렉터리를 찾을 수 없습니다: {}", "Cannot find the parent folder of the save location: {}"),
    ("tmp.createFailed", "임시 파일 생성 실패: {} ({})", "Failed to create a temporary file: {} ({})"),
    ("tmp.writeFailed", "임시 파일 쓰기 실패: {}", "Failed to write the temporary file: {}"),
    ("tmp.flushFailed", "임시 파일 flush 실패: {}", "Failed to flush the temporary file: {}"),
    ("file.replaceFailed", "파일 교체 실패: {} ({})", "Failed to replace the file: {} ({})"),
    ("fs.scopeFailed", "filesystem scope 갱신 실패: {}", "Failed to update file access: {}"),
    ("reveal.notFound", "파일 위치를 찾을 수 없습니다: {}", "Cannot find the file location: {}"),
    ("reveal.notLocalDir", "파일 위치가 로컬 디렉터리가 아닙니다: {}", "The file location is not a local folder: {}"),
    ("reveal.openFailed", "파일 위치를 열 수 없습니다: {}", "Cannot open the file location: {}"),
    ("print.dialogFailed", "인쇄 대화상자를 열 수 없습니다: {}", "Cannot open the print dialog: {}"),
    ("window.closeFailed", "창을 닫을 수 없습니다: {}", "Cannot close the window: {}"),
    ("window.createJobFailed", "새 창 생성 작업 실패: {}", "The new window task failed: {}"),
    ("window.createFailed", "새 창 생성 실패: {}", "Failed to create a new window: {}"),
    ("pdf.start", "PDF 내보내기를 시작합니다", "Starting PDF export"),
    ("pdf.pageRenderFailed", "페이지 {} 렌더링 실패: {}", "Failed to render page {}: {}"),
    ("pdf.pageProgress", "{} / {} 페이지 렌더링", "Rendering page {} / {}"),
    ("pdf.written", "PDF 파일을 저장했습니다", "Saved the PDF file"),
    ("pdf.done", "PDF 내보내기가 완료되었습니다", "PDF export finished"),
    ("pdf.extensionRequired", "PDF 파일 경로는 .pdf 확장자여야 합니다", "The PDF file name must end with .pdf"),
    ("pdf.noPages", "내보낼 페이지가 없습니다", "There are no pages to export"),
    ("pdf.invalidRange", "페이지 범위가 올바르지 않습니다: {}..{} / 총 {}페이지", "Invalid page range: {}..{} of {} pages"),
    ("pdf.stagingReadFailed", "PDF 내보내기용 staging 파일을 읽을 수 없습니다: {} ({})", "Cannot read the staged file for PDF export: {} ({})"),
    ("pdf.convertFailed", "PDF 내보내기용 문서 변환 실패", "Failed to prepare the document for PDF export"),
    ("pdf.openAfterFailed", "파일은 저장됐지만 OS 기본 앱으로 열 수 없습니다: {} ({})", "The file was saved, but the default app could not open it: {} ({})"),
    ("recent.locationMissing", "최근 문서 저장 위치를 찾을 수 없습니다: {}", "Cannot find where recent documents are stored: {}"),
    ("recent.readFailed", "최근 문서 목록을 읽을 수 없습니다: {}", "Cannot read the recent documents list: {}"),
    ("recent.locationCreateFailed", "최근 문서 저장 위치를 만들 수 없습니다: {}", "Cannot create the folder for recent documents: {}"),
    ("recent.saveFailed", "최근 문서 목록을 저장할 수 없습니다: {}", "Cannot save the recent documents list: {}"),
    ("recent.macosScheduleFailed", "macOS 최근 항목 등록 작업을 예약할 수 없습니다: {}", "Cannot schedule adding the file to macOS recent items: {}"),
    ("font.notFound", "로컬 폰트 파일을 찾을 수 없습니다: {}", "Cannot find the local font file: {}"),
    ("font.unsupportedExtension", "지원하지 않는 로컬 폰트 확장자입니다: {}", "Unsupported local font file type: {}"),
    ("font.outsideDirs", "지원된 로컬 폰트 디렉터리 밖의 파일입니다: {}", "The file is outside the supported local font folders: {}"),
    ("font.readFailed", "로컬 폰트 파일을 읽을 수 없습니다: {} ({})", "Cannot read the local font file: {} ({})"),
    ("open.windowQueueLockFailed", "창별 대기 중인 파일 열기 큐 잠금 실패", "Could not lock the pending file queue for the window"),
    ("open.queueLockFailed", "대기 중인 파일 열기 큐 잠금 실패", "Could not lock the pending file queue"),
    ("quit.lockFailed", "앱 종료 상태 잠금 실패", "Could not lock the quit state"),
    ("quit.emitFailed", "앱 종료 이벤트 전송 실패 ({}): {}", "Failed to send the quit event ({}): {}"),
    ("update.notReady", "새 업데이트가 준비되지 않았습니다.", "No new update is ready."),
    ("update.alreadyPreparing", "업데이트를 이미 준비하고 있습니다.", "The update is already being prepared."),
    ("update.alreadyReady", "업데이트가 이미 준비되었습니다. 다시 시작해서 적용하세요.", "The update is ready. Restart HOP to apply it."),
    ("update.needsRecheck", "업데이트 준비 정보가 없어 다시 확인이 필요합니다.", "Update information is missing. Check for updates again."),
    ("update.lockFailed", "업데이트 상태 잠금 실패", "Could not lock the update state"),
    ("update.unsavedChanges", "저장되지 않은 변경사항이 있어 지금은 업데이트할 수 없습니다. 저장 후 다시 시도하세요.", "There are unsaved changes, so the update cannot start now. Save and try again."),
    ("update.releaseOnly", "업데이트 설치는 릴리즈 빌드에서만 사용할 수 있습니다.", "Installing updates is only available in release builds."),
    ("update.downloadFailed", "업데이트 다운로드에 실패했습니다. 네트워크를 확인하고 다시 시도하세요.", "Downloading the update failed. Check your network and try again."),
    ("update.deferredUnsaved", "업데이트를 준비하는 동안 저장되지 않은 변경사항이 생겨 적용을 보류했습니다. 저장 후 다시 시도하세요.", "Unsaved changes appeared while the update was being prepared, so it is on hold. Save and try again."),
    ("update.installFailed", "업데이트 설치에 실패했습니다. 다시 시도하세요.", "Installing the update failed. Try again."),
    ("update.notReadyToApply", "적용할 업데이트가 아직 준비되지 않았습니다.", "The update is not ready to apply yet."),
    ("update.restartBlocked", "저장되지 않은 변경사항이 있어 다시 시작할 수 없습니다. 저장 후 다시 시도하세요.", "There are unsaved changes, so HOP cannot restart. Save and try again."),
];

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn keys_are_unique() {
        let mut seen = HashSet::new();
        for (key, _, _) in MESSAGES {
            assert!(seen.insert(*key), "duplicate key {key}");
        }
    }

    #[test]
    fn translations_keep_placeholders() {
        for (key, ko, en) in MESSAGES {
            assert_eq!(ko.matches("{}").count(), en.matches("{}").count(), "placeholders differ for {key}");
        }
    }

    #[test]
    fn looks_up_both_languages_without_touching_global_state() {
        assert_eq!(text_in(Lang::Ko, "pdf.noPages"), "내보낼 페이지가 없습니다");
        assert_eq!(text_in(Lang::En, "pdf.noPages"), "There are no pages to export");
        assert_eq!(text_in(Lang::En, "missing.key"), "missing.key");
    }

    #[test]
    fn fills_placeholders_in_order() {
        let template = text_in(Lang::En, "pdf.invalidRange");
        assert_eq!(fill(template, &[&1, &9, &4]), "Invalid page range: 1..9 of 4 pages");
        assert_eq!(fill("a {} b {}", &[&"x"]), "a x b {}");
    }

    #[test]
    fn every_key_used_in_sources_exists() {
        let src = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let calls = ["ui_text::text(\"", "ui_text::text_with(\""];
        let known: HashSet<&str> = MESSAGES.iter().map(|(key, _, _)| *key).collect();
        for entry in std::fs::read_dir(src).expect("src dir") {
            let path = entry.expect("entry").path();
            if path.extension().and_then(|ext| ext.to_str()) != Some("rs") {
                continue;
            }
            let source = std::fs::read_to_string(&path).expect("source");
            for call in calls {
                for (index, _) in source.match_indices(call) {
                    let rest = &source[index + call.len()..];
                    let key = &rest[..rest.find('"').expect("closing quote")];
                    assert!(known.contains(key), "{} uses unknown key {key}", path.display());
                }
            }
        }
    }
}
