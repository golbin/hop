use std::sync::Mutex;
use std::sync::OnceLock;
use serde_json::Value;

static LAW_PATHS: OnceLock<Mutex<Vec<String>>> = OnceLock::new();

async fn fetch_all_law_paths() -> Vec<String> {
    let client = match reqwest::Client::builder()
        .user_agent("hop-desktop-client/1.0")
        .build() {
            Ok(c) => c,
            Err(_) => return get_fallback_paths(),
        };

    let url = "https://api.github.com/repos/legalize-kr/legalize-kr/git/trees/main?recursive=1";
    let resp = match client.get(url).send().await {
        Ok(r) => r,
        Err(_) => return get_fallback_paths(),
    };

    let val: Value = match resp.json().await {
        Ok(v) => v,
        Err(_) => return get_fallback_paths(),
    };

    let mut paths = Vec::new();
    if let Some(tree) = val.get("tree").and_then(|v| v.as_array()) {
        for item in tree {
            if let Some(path) = item.get("path").and_then(|v| v.as_str()) {
                if path.starts_with("kr/") && path.ends_with(".md") {
                    paths.push(path.to_string());
                }
            }
        }
    }

    if paths.is_empty() {
        get_fallback_paths()
    } else {
        paths
    }
}

fn get_fallback_paths() -> Vec<String> {
    vec![
        "kr/대한민국헌법/헌법.md".to_string(),
        "kr/민법/법률.md".to_string(),
        "kr/형법/법률.md".to_string(),
        "kr/개인정보보호법/법률.md".to_string(),
        "kr/근로기준법/법률.md".to_string(),
        "kr/행정절차법/법률.md".to_string(),
        "kr/국가공무원법/법률.md".to_string(),
        "kr/지방공무원법/법률.md".to_string(),
        "kr/행정기본법/법률.md".to_string(),
        "kr/지방자치법/법률.md".to_string(),
        "kr/형사소송법/법률.md".to_string(),
        "kr/민사소송법/법률.md".to_string(),
        "kr/상법/법률.md".to_string(),
    ]
}

async fn get_or_init_law_paths() -> Vec<String> {
    let mutex = LAW_PATHS.get_or_init(|| Mutex::new(Vec::new()));
    {
        let lock = mutex.lock().unwrap();
        if !lock.is_empty() {
            return lock.clone();
        }
    }
    
    let fetched = fetch_all_law_paths().await;
    
    let mut lock = mutex.lock().unwrap();
    if lock.is_empty() {
        *lock = fetched;
    }
    lock.clone()
}

pub async fn search_law(query: &str) -> Result<String, String> {
    let normalized_query = query.replace(' ', "").to_lowercase();
    let paths = get_or_init_law_paths().await;
    
    let mut matches = Vec::new();
    for p in paths {
        let normalized_path = p.replace(' ', "").to_lowercase();
        if normalized_path.contains(&normalized_query) {
            matches.push(p);
        }
    }
    
    if matches.is_empty() {
        Ok(format!("'{}'에 매칭되는 법령을 찾을 수 없습니다.", query))
    } else {
        Ok(matches.join("\n"))
    }
}

pub async fn get_law_structure(path: &str) -> Result<String, String> {
    let url = format!(
        "https://raw.githubusercontent.com/legalize-kr/legalize-kr/main/{}",
        path.replace(' ', "%20")
    );
    let client = reqwest::Client::builder()
        .user_agent("hop-desktop-client/1.0")
        .build()
        .map_err(|e| e.to_string())?;
    
    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("법령을 불러오지 못했습니다. HTTP 상태: {}", resp.status()));
    }
    let content = resp.text().await.map_err(|e| e.to_string())?;
    
    let mut headings = Vec::new();
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('#') {
            headings.push(trimmed.to_string());
        }
    }
    
    if headings.is_empty() {
        Ok("조문 구조를 찾을 수 없거나 파일이 비어 있습니다.".to_string())
    } else {
        Ok(headings.join("\n"))
    }
}

pub async fn get_law_article(path: &str, article_query: &str) -> Result<String, String> {
    let url = format!(
        "https://raw.githubusercontent.com/legalize-kr/legalize-kr/main/{}",
        path.replace(' ', "%20")
    );
    let client = reqwest::Client::builder()
        .user_agent("hop-desktop-client/1.0")
        .build()
        .map_err(|e| e.to_string())?;
    
    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("법령을 불러오지 못했습니다. HTTP 상태: {}", resp.status()));
    }
    let content = resp.text().await.map_err(|e| e.to_string())?;
    
    let normalized_query = article_query.replace(' ', "").to_lowercase();
    let lines: Vec<&str> = content.lines().collect();
    let mut found_index = None;
    
    for (i, line) in lines.iter().enumerate() {
        let trimmed = line.trim();
        if trimmed.starts_with('#') {
            let normalized_line = trimmed.replace(' ', "").to_lowercase();
            if normalized_line.contains(&normalized_query) {
                found_index = Some(i);
                break;
            }
        }
    }
    
    let Some(start_idx) = found_index else {
        return Err(format!("조문 '{}'을(를) 찾을 수 없습니다.", article_query));
    };
    
    let mut article_content = Vec::new();
    article_content.push(lines[start_idx]);
    
    for line in lines.iter().skip(start_idx + 1) {
        let trimmed = line.trim();
        if trimmed.starts_with('#') {
            break;
        }
        article_content.push(*line);
    }
    
    Ok(article_content.join("\n"))
}
