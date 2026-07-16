use serde::{Deserialize, Serialize};
#[cfg(any(test, all(target_os = "macos", debug_assertions)))]
use std::ffi::OsString;
#[cfg(any(test, all(target_os = "macos", debug_assertions)))]
use std::fs::OpenOptions;
#[cfg(any(test, all(target_os = "macos", debug_assertions)))]
use std::path::{Path, PathBuf};

#[cfg(any(test, all(target_os = "macos", debug_assertions)))]
const GEOMETRY_PROBE_ENV: &str = "HOP_PRINT_GEOMETRY_PROBE_PATH";
#[cfg(any(test, all(target_os = "macos", debug_assertions)))]
const MAX_PROBE_PAGES: u32 = 32;

#[cfg(any(test, all(target_os = "macos", debug_assertions)))]
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum ProbeStage {
    ConfigurationChecked,
    NativePrintEntered,
    TimerFired,
    ModalAborted,
    FiniteRangeCaptured,
}

#[cfg(any(test, all(target_os = "macos", debug_assertions)))]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProbeStatus {
    schema_version: u32,
    stage: ProbeStage,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PrintProbeInput {
    pub engine_page_count: u32,
    pub dom_page_count: u32,
    pub page_width_mm: f64,
    pub page_height_mm: f64,
    pub final_break_is_auto: bool,
}

impl PrintProbeInput {
    #[cfg(any(test, all(target_os = "macos", debug_assertions)))]
    pub(crate) fn validate(&self) -> Result<(), String> {
        if self.engine_page_count == 0 || self.engine_page_count > MAX_PROBE_PAGES {
            return Err(format!(
                "print geometry probe engine page count must be between 1 and {MAX_PROBE_PAGES}"
            ));
        }
        if self.dom_page_count != self.engine_page_count {
            return Err(
                "print geometry probe DOM page count must match engine page count".to_string(),
            );
        }
        if !self.page_width_mm.is_finite() || self.page_width_mm <= 0.0 {
            return Err("print geometry probe page width must be positive and finite".to_string());
        }
        if !self.page_height_mm.is_finite() || self.page_height_mm <= 0.0 {
            return Err("print geometry probe page height must be positive and finite".to_string());
        }
        if !self.final_break_is_auto {
            return Err("print geometry probe requires an automatic final page break".to_string());
        }
        Ok(())
    }
}

pub(crate) fn geometry_probe_configured() -> Result<bool, String> {
    #[cfg(all(target_os = "macos", debug_assertions))]
    {
        let Some(path) = configured_geometry_probe_path()? else {
            return Ok(false);
        };
        write_probe_stage(&path, ProbeStage::ConfigurationChecked)?;
        Ok(true)
    }
    #[cfg(not(all(target_os = "macos", debug_assertions)))]
    {
        Ok(false)
    }
}

#[cfg(any(test, all(target_os = "macos", debug_assertions)))]
pub(crate) fn write_probe_stage(observation_path: &Path, stage: ProbeStage) -> Result<(), String> {
    let status_path = probe_status_path(observation_path);
    let file = OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .open(status_path)
        .map_err(|error| format!("could not create print geometry probe status: {error}"))?;
    serde_json::to_writer(
        file,
        &ProbeStatus {
            schema_version: 1,
            stage,
        },
    )
    .map_err(|error| format!("could not write print geometry probe status: {error}"))
}

#[cfg(any(test, all(target_os = "macos", debug_assertions)))]
fn probe_status_path(observation_path: &Path) -> PathBuf {
    observation_path.with_extension("status.json")
}

#[cfg(all(target_os = "macos", debug_assertions))]
pub(crate) fn configured_geometry_probe_path() -> Result<Option<PathBuf>, String> {
    geometry_probe_path_from_value(std::env::var_os(GEOMETRY_PROBE_ENV))
}

#[cfg(any(test, all(target_os = "macos", debug_assertions)))]
fn geometry_probe_path_from_value(value: Option<OsString>) -> Result<Option<PathBuf>, String> {
    let Some(value) = value else {
        return Ok(None);
    };
    let path = PathBuf::from(value);
    validate_destination(&path)?;
    Ok(Some(path))
}

#[cfg(any(test, all(target_os = "macos", debug_assertions)))]
fn validate_destination(path: &Path) -> Result<(), String> {
    if !path.is_absolute() {
        return Err(format!("{GEOMETRY_PROBE_ENV} must be an absolute path"));
    }
    if path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_none_or(|extension| !extension.eq_ignore_ascii_case("json"))
    {
        return Err(format!("{GEOMETRY_PROBE_ENV} must use a .json extension"));
    }
    let parent = path
        .parent()
        .ok_or_else(|| format!("{GEOMETRY_PROBE_ENV} must have a parent directory"))?;
    if !parent.is_dir() {
        return Err(format!(
            "{GEOMETRY_PROBE_ENV} parent directory does not exist"
        ));
    }
    if path.exists() {
        return Err(format!("{GEOMETRY_PROBE_ENV} destination already exists"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsString;

    fn valid_input() -> PrintProbeInput {
        PrintProbeInput {
            engine_page_count: 1,
            dom_page_count: 1,
            page_width_mm: 210.0,
            page_height_mm: 297.0,
            final_break_is_auto: true,
        }
    }

    #[test]
    fn geometry_probe_path_requires_new_absolute_json_destination() {
        let directory = tempfile::tempdir().unwrap();
        let destination = directory.path().join("observation.json");
        assert_eq!(
            geometry_probe_path_from_value(Some(destination.clone().into_os_string())).unwrap(),
            Some(destination.clone())
        );
        assert!(geometry_probe_path_from_value(Some(OsString::from("relative.json"))).is_err());
        assert!(geometry_probe_path_from_value(Some(
            directory.path().join("observation.txt").into_os_string()
        ))
        .is_err());
        assert!(geometry_probe_path_from_value(Some(
            directory
                .path()
                .join("missing")
                .join("observation.json")
                .into_os_string()
        ))
        .is_err());
        std::fs::write(&destination, b"existing").unwrap();
        assert!(geometry_probe_path_from_value(Some(destination.into_os_string())).is_err());
    }

    #[test]
    fn probe_input_accepts_one_matching_finite_page() {
        assert_eq!(valid_input().validate(), Ok(()));
    }

    #[test]
    fn probe_input_rejects_zero_non_finite_or_mismatched_counts() {
        assert!(PrintProbeInput {
            engine_page_count: 0,
            ..valid_input()
        }
        .validate()
        .is_err());
        assert!(PrintProbeInput {
            dom_page_count: 2,
            ..valid_input()
        }
        .validate()
        .is_err());
        assert!(PrintProbeInput {
            page_height_mm: f64::NAN,
            ..valid_input()
        }
        .validate()
        .is_err());
        assert!(PrintProbeInput {
            page_width_mm: 0.0,
            ..valid_input()
        }
        .validate()
        .is_err());
        assert!(PrintProbeInput {
            final_break_is_auto: false,
            ..valid_input()
        }
        .validate()
        .is_err());
    }

    #[test]
    fn probe_stage_writes_only_a_sanitized_replaceable_sidecar() {
        let directory = tempfile::tempdir().unwrap();
        let observation = directory.path().join("observation.json");

        write_probe_stage(&observation, ProbeStage::ConfigurationChecked).unwrap();
        let status = probe_status_path(&observation);
        assert_eq!(status, directory.path().join("observation.status.json"));
        let first: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&status).unwrap()).unwrap();
        assert_eq!(
            first,
            serde_json::json!({
                "schemaVersion": 1,
                "stage": "configuration-checked",
            })
        );

        write_probe_stage(&observation, ProbeStage::NativePrintEntered).unwrap();
        let second = std::fs::read_to_string(status).unwrap();
        assert!(second.contains("native-print-entered"));
        for forbidden in [
            "documentPath",
            "fileName",
            "svg",
            "printer",
            "private-sentinel",
        ] {
            assert!(!second.contains(forbidden));
        }
    }
}
