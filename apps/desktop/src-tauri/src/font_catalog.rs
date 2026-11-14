use serde::Serialize;
use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};
use usvg::fontdb::{self, Source};

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalFontEntry {
    pub family: String,
    pub post_script_name: String,
    pub style: String,
    pub weight: u16,
    pub source_kind: String,
    pub path: Option<String>,
}

pub fn desktop_extra_font_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();

    #[cfg(target_os = "macos")]
    {
        if let Some(home_dir) = env_path("HOME") {
            dirs.push(home_dir.join("Library/Fonts"));
        }
    }

    #[cfg(target_os = "linux")]
    {
        if let Some(home_dir) = env_path("HOME") {
            dirs.push(home_dir.join(".local/share/fonts"));
            dirs.push(home_dir.join(".fonts"));
        }

        let wsl_windows_fonts = PathBuf::from("/mnt/c/Windows/Fonts");
        if wsl_windows_fonts.is_dir() {
            dirs.push(wsl_windows_fonts);
        }
    }

    #[cfg(windows)]
    {
        if let Some(local_app_data) = env_path("LOCALAPPDATA") {
            dirs.extend(windows_user_font_dirs(&local_app_data));
        }
    }

    dedupe_existing_dirs(dirs)
}

pub fn pdf_font_dirs(app: &AppHandle) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Ok(resource_dir) = app.path().resource_dir() {
        dirs.push(resource_dir.join("fonts/pdf"));
    }
    dirs.extend(desktop_extra_font_dirs());
    dedupe_existing_dirs(dirs)
}

pub fn collect_desktop_local_font_entries() -> Vec<LocalFontEntry> {
    collect_local_font_entries(&desktop_extra_font_dirs())
}

pub fn read_desktop_local_font(path: &Path) -> Result<Vec<u8>, String> {
    let path = normalize_existing_path(path)
        .ok_or_else(|| crate::ui_text::text_with("font.notFound", &[&path.display()]))?;

    if !has_supported_font_extension(&path) {
        return Err(crate::ui_text::text_with("font.unsupportedExtension", &[&path.display()]));
    }

    let allowed_roots = desktop_extra_font_dirs();
    if !allowed_roots
        .iter()
        .any(|root| path_is_within_root(&path, root))
    {
        return Err(crate::ui_text::text_with("font.outsideDirs", &[&path.display()]));
    }

    fs::read(&path).map_err(|error| {
        crate::ui_text::text_with("font.readFailed", &[&path.display(), &error])
    })
}

pub fn create_font_database(extra_font_dirs: &[PathBuf]) -> fontdb::Database {
    let mut fontdb = fontdb::Database::new();
    fontdb.load_system_fonts();

    for dir in extra_font_dirs {
        if dir.is_dir() {
            fontdb.load_fonts_dir(dir);
        }
    }

    fontdb
}

pub fn collect_local_font_entries(extra_font_dirs: &[PathBuf]) -> Vec<LocalFontEntry> {
    let fontdb = create_font_database(extra_font_dirs);
    let file_backed_dirs = extra_font_dirs
        .iter()
        .filter(|dir| dir.is_dir())
        .cloned()
        .collect::<Vec<_>>();

    let mut seen = BTreeSet::new();
    let mut entries = Vec::new();

    for face in fontdb.faces() {
        let path = source_path(&face.source);
        let source_kind = classify_source(path.as_deref(), &file_backed_dirs);
        let style = style_name(face.style);

        let mut families = BTreeSet::new();
        for (family, _) in &face.families {
            let family = family.trim();
            if !family.is_empty() {
                families.insert(family.to_string());
            }
        }

        for family in families {
            let key = (
                family.clone(),
                face.post_script_name.clone(),
                style,
                face.weight.0,
                source_kind,
                path.clone(),
            );
            if !seen.insert(key) {
                continue;
            }

            entries.push(LocalFontEntry {
                family,
                post_script_name: face.post_script_name.clone(),
                style: style.to_string(),
                weight: face.weight.0,
                source_kind: source_kind.to_string(),
                path: path.clone(),
            });
        }
    }

    entries.sort_by(|left, right| {
        left.family
            .cmp(&right.family)
            .then(left.weight.cmp(&right.weight))
            .then(left.style.cmp(&right.style))
            .then(left.post_script_name.cmp(&right.post_script_name))
    });
    entries
}

fn source_path(source: &Source) -> Option<String> {
    match source {
        Source::File(path) | Source::SharedFile(path, _) => {
            Some(path.to_string_lossy().to_string())
        }
        Source::Binary(_) => None,
    }
}

fn classify_source(path: Option<&str>, file_backed_dirs: &[PathBuf]) -> &'static str {
    let Some(path) = path else {
        return "system-installed";
    };
    let normalized_path = normalize_existing_path(Path::new(path));
    let path = normalized_path
        .as_deref()
        .unwrap_or_else(|| Path::new(path));
    if file_backed_dirs.iter().any(|dir| path.starts_with(dir)) {
        "file-backed"
    } else {
        "system-installed"
    }
}

fn style_name(style: fontdb::Style) -> &'static str {
    match style {
        fontdb::Style::Normal => "normal",
        fontdb::Style::Italic => "italic",
        fontdb::Style::Oblique => "oblique",
    }
}

fn env_path(name: &str) -> Option<PathBuf> {
    std::env::var_os(name).map(PathBuf::from)
}

#[cfg(any(windows, test))]
fn windows_user_font_dirs(local_app_data: &Path) -> Vec<PathBuf> {
    vec![local_app_data.join("Microsoft/Windows/Fonts")]
}

fn dedupe_existing_dirs(dirs: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut seen = BTreeSet::new();
    let mut deduped = Vec::new();

    for dir in dirs {
        let Some(normalized_dir) = normalize_existing_path(&dir) else {
            continue;
        };
        if seen.insert(normalized_dir.clone()) {
            deduped.push(normalized_dir);
        }
    }

    deduped
}

fn normalize_existing_path(path: &Path) -> Option<PathBuf> {
    fs::canonicalize(path).ok()
}

fn path_is_within_root(path: &Path, root: &Path) -> bool {
    let Some(normalized_path) = normalize_existing_path(path) else {
        return false;
    };
    let Some(normalized_root) = normalize_existing_path(root) else {
        return false;
    };
    normalized_path.starts_with(&normalized_root)
}

fn has_supported_font_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| {
            matches!(
                ext.to_ascii_lowercase().as_str(),
                "ttf" | "otf" | "ttc" | "otc" | "woff" | "woff2"
            )
        })
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use usvg::fontdb::{FaceInfo, Stretch, Weight, ID};

    #[test]
    fn collect_local_font_entries_keeps_localized_family_aliases() {
        let faces = vec![FaceInfo {
            id: ID::dummy(),
            source: Source::File(PathBuf::from("/Library/Fonts/Test.ttf")),
            index: 0,
            families: vec![
                (
                    "Malgun Gothic".to_string(),
                    fontdb::Language::English_UnitedStates,
                ),
                (
                    "맑은 고딕".to_string(),
                    fontdb::Language::English_UnitedStates,
                ),
            ],
            post_script_name: "MalgunGothicRegular".to_string(),
            style: fontdb::Style::Normal,
            weight: Weight::NORMAL,
            stretch: Stretch::Normal,
            monospaced: false,
        }];

        let mut seen = BTreeSet::new();
        let mut entries = Vec::new();
        for face in &faces {
            let path = source_path(&face.source);
            for (family, _) in &face.families {
                let key = (
                    family.clone(),
                    face.post_script_name.clone(),
                    style_name(face.style),
                    face.weight.0,
                    "system-installed",
                    path.clone(),
                );
                if seen.insert(key) {
                    entries.push(LocalFontEntry {
                        family: family.clone(),
                        post_script_name: face.post_script_name.clone(),
                        style: style_name(face.style).to_string(),
                        weight: face.weight.0,
                        source_kind: "system-installed".to_string(),
                        path: path.clone(),
                    });
                }
            }
        }

        let families = entries
            .into_iter()
            .map(|entry| entry.family)
            .collect::<Vec<_>>();
        assert_eq!(
            families,
            vec!["Malgun Gothic".to_string(), "맑은 고딕".to_string()]
        );
    }

    #[test]
    fn classify_source_marks_extra_dirs_as_file_backed() {
        let extra_dir = PathBuf::from("/opt/hancom/Shared/TTF");
        assert_eq!(
            classify_source(Some("/opt/hancom/Shared/TTF/HYHeadLine.ttf"), &[extra_dir]),
            "file-backed"
        );
        assert_eq!(
            classify_source(
                Some("/System/Library/Fonts/Supplemental/Apple SD Gothic Neo.ttc"),
                &[]
            ),
            "system-installed"
        );
    }

    #[test]
    fn windows_user_font_dirs_use_local_app_data_root() {
        let root = PathBuf::from("C:/Users/test/AppData/Local");
        assert_eq!(
            windows_user_font_dirs(&root),
            vec![PathBuf::from(
                "C:/Users/test/AppData/Local/Microsoft/Windows/Fonts"
            )]
        );
    }

    #[test]
    fn path_is_within_root_rejects_escape_paths() {
        let temp = tempfile::tempdir().unwrap();
        let fonts_root = temp.path().join("fonts");
        let outside_root = temp.path().join("outside");
        fs::create_dir_all(&fonts_root).unwrap();
        fs::create_dir_all(&outside_root).unwrap();

        let allowed_font = fonts_root.join("test.ttf");
        let outside_font = outside_root.join("test.ttf");
        fs::write(&allowed_font, b"font").unwrap();
        fs::write(&outside_font, b"font").unwrap();

        assert!(path_is_within_root(&allowed_font, &fonts_root));
        assert!(!path_is_within_root(&outside_font, &fonts_root));
        assert!(has_supported_font_extension(&allowed_font));
        assert!(!has_supported_font_extension(
            &outside_root.join("notes.txt")
        ));
    }
}
