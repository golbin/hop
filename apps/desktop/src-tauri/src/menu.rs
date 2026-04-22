use tauri::menu::{Menu, MenuItemBuilder, SubmenuBuilder};
use tauri::{App, Emitter};

pub fn install(app: &mut App) -> tauri::Result<()> {
    let app_about = MenuItemBuilder::with_id("file:about", "About HOP").build(app)?;
    let app_quit = MenuItemBuilder::with_id("app:quit", "Quit HOP")
        .accelerator("CmdOrCtrl+Q")
        .build(app)?;
    let new_doc = MenuItemBuilder::with_id("file:new-doc", "New")
        .accelerator("CmdOrCtrl+N")
        .build(app)?;
    let new_window = MenuItemBuilder::with_id("file:new-window", "New Window")
        .accelerator("CmdOrCtrl+Shift+N")
        .build(app)?;
    let open = MenuItemBuilder::with_id("file:open", "Open...")
        .accelerator("CmdOrCtrl+O")
        .build(app)?;
    let save = MenuItemBuilder::with_id("file:save", "Save")
        .accelerator("CmdOrCtrl+S")
        .build(app)?;
    let save_as = MenuItemBuilder::with_id("file:save-as", "Save As...")
        .accelerator("CmdOrCtrl+Shift+S")
        .build(app)?;
    let export_pdf = MenuItemBuilder::with_id("file:export-pdf", "Export PDF...")
        .accelerator("CmdOrCtrl+E")
        .build(app)?;
    let print = MenuItemBuilder::with_id("file:print", "Print...")
        .accelerator("CmdOrCtrl+P")
        .build(app)?;

    let undo = MenuItemBuilder::with_id("edit:undo", "Undo")
        .accelerator("CmdOrCtrl+Z")
        .build(app)?;
    let redo = MenuItemBuilder::with_id("edit:redo", "Redo")
        .accelerator("CmdOrCtrl+Shift+Z")
        .build(app)?;
    let cut = MenuItemBuilder::with_id("edit:cut", "Cut")
        .accelerator("CmdOrCtrl+X")
        .build(app)?;
    let copy = MenuItemBuilder::with_id("edit:copy", "Copy")
        .accelerator("CmdOrCtrl+C")
        .build(app)?;
    let paste = MenuItemBuilder::with_id("edit:paste", "Paste")
        .accelerator("CmdOrCtrl+V")
        .build(app)?;
    let find = MenuItemBuilder::with_id("edit:find", "Find")
        .accelerator("CmdOrCtrl+F")
        .build(app)?;

    let zoom_in = MenuItemBuilder::with_id("view:zoom-in", "Zoom In")
        .accelerator("CmdOrCtrl+=")
        .build(app)?;
    let zoom_out = MenuItemBuilder::with_id("view:zoom-out", "Zoom Out")
        .accelerator("CmdOrCtrl+-")
        .build(app)?;
    let zoom_100 = MenuItemBuilder::with_id("view:zoom-100", "Actual Size").build(app)?;
    let fit_page = MenuItemBuilder::with_id("view:zoom-fit-page", "Fit Page").build(app)?;
    let fit_width = MenuItemBuilder::with_id("view:zoom-fit-width", "Fit Width").build(app)?;

    let app_menu = SubmenuBuilder::new(app, "HOP")
        .item(&app_about)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .item(&app_quit)
        .build()?;
    let file_menu = SubmenuBuilder::new(app, "File")
        .item(&new_doc)
        .item(&new_window)
        .separator()
        .item(&open)
        .item(&save)
        .item(&save_as)
        .separator()
        .item(&export_pdf)
        .item(&print)
        .build()?;
    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .item(&undo)
        .item(&redo)
        .separator()
        .item(&cut)
        .item(&copy)
        .item(&paste)
        .separator()
        .item(&find)
        .build()?;
    let view_menu = SubmenuBuilder::new(app, "View")
        .item(&zoom_in)
        .item(&zoom_out)
        .item(&zoom_100)
        .separator()
        .item(&fit_page)
        .item(&fit_width)
        .build()?;
    let window_menu = SubmenuBuilder::new(app, "Window")
        .minimize()
        .close_window()
        .build()?;

    let menu = Menu::with_items(
        app,
        &[&app_menu, &file_menu, &edit_menu, &view_menu, &window_menu],
    )?;
    app.set_menu(menu)?;
    app.on_menu_event(|app, event| {
        let id = event.id().0.as_str();
        if id == "app:quit" {
            if let Err(error) = crate::app_quit::request_app_quit(app) {
                eprintln!("[menu] 앱 종료 요청 실패: {}", error);
            }
            return;
        }
        if id == "file:new-window" {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(error) = crate::windows::create_editor_window(&app) {
                    eprintln!("[menu] 새 창 생성 실패: {}", error);
                }
            });
            return;
        }
        if id.contains(':') {
            if let Some(label) = crate::windows::target_window_label(app) {
                let _ = app.emit_to(label, "hop-menu-command", id);
            } else {
                let _ = app.emit("hop-menu-command", id);
            }
        }
    });
    Ok(())
}
