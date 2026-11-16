use std::collections::HashMap;
use std::sync::Mutex;

#[derive(Default)]
pub struct PendingOpenPaths {
    global: Mutex<Vec<String>>,
    by_window: Mutex<HashMap<String, Vec<String>>>,
}

impl PendingOpenPaths {
    pub fn queue_global(&self, paths: impl IntoIterator<Item = String>) {
        if let Ok(mut pending) = self.global.lock() {
            pending.extend(paths);
        }
    }

    #[cfg(any(test, not(target_os = "macos")))]
    pub fn queue_for_window(&self, window_label: &str, paths: impl IntoIterator<Item = String>) {
        let mut paths = paths.into_iter().peekable();
        if paths.peek().is_none() {
            return;
        }

        if let Ok(mut pending) = self.by_window.lock() {
            pending
                .entry(window_label.to_string())
                .or_default()
                .extend(paths);
        }
    }

    pub fn discard_for_window(&self, window_label: &str) {
        if let Ok(mut pending) = self.by_window.lock() {
            pending.remove(window_label);
        }
    }

    pub fn take_for_window(&self, window_label: &str) -> Result<Vec<String>, String> {
        if let Some(paths) = self
            .by_window
            .lock()
            .map_err(|_| crate::ui_text::text("open.windowQueueLockFailed").to_string())?
            .remove(window_label)
        {
            return Ok(paths);
        }

        let mut paths = self
            .global
            .lock()
            .map_err(|_| crate::ui_text::text("open.queueLockFailed").to_string())?;
        Ok(paths.drain(..).collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn window_scoped_queue_takes_precedence() {
        let pending = PendingOpenPaths::default();
        pending.queue_global(["startup.hwp".to_string()]);
        pending.queue_for_window("main-new", ["second.hwp".to_string()]);

        assert_eq!(
            pending.take_for_window("main-new").unwrap(),
            vec!["second.hwp"]
        );
        assert_eq!(
            pending.take_for_window("main").unwrap(),
            vec!["startup.hwp"]
        );
    }

    #[test]
    fn missing_window_queue_falls_back_to_global_queue() {
        let pending = PendingOpenPaths::default();
        pending.queue_global(["first.hwp".to_string(), "second.hwpx".to_string()]);

        assert_eq!(
            pending.take_for_window("main").unwrap(),
            vec!["first.hwp", "second.hwpx"]
        );
        assert!(pending.take_for_window("main").unwrap().is_empty());
    }

    #[test]
    fn discarded_window_queue_is_not_returned_later() {
        let pending = PendingOpenPaths::default();
        pending.queue_for_window("main-new", ["orphan.hwp".to_string()]);
        pending.discard_for_window("main-new");

        assert!(pending.take_for_window("main-new").unwrap().is_empty());
    }

    #[test]
    fn empty_window_queue_does_not_shadow_global_queue() {
        let pending = PendingOpenPaths::default();
        pending.queue_global(["startup.hwp".to_string()]);
        pending.queue_for_window("main", std::iter::empty::<String>());

        assert_eq!(
            pending.take_for_window("main").unwrap(),
            vec!["startup.hwp"]
        );
    }
}
