interface FontEntry {
  name: string;
  file: string;
  format?: 'woff2' | 'woff';
}

const FONT_LIST: FontEntry[] = [
  { name: '함초롬돋움', file: '/fonts/NotoSansKR-Regular.woff2' },
  { name: '함초롬바탕', file: '/fonts/NotoSerifKR-Regular.woff2' },
  { name: '함초롱돋움', file: '/fonts/NotoSansKR-Regular.woff2' },
  { name: '함초롱바탕', file: '/fonts/NotoSerifKR-Regular.woff2' },
  { name: '한컴돋움', file: '/fonts/NotoSansKR-Regular.woff2' },
  { name: '한컴바탕', file: '/fonts/NotoSerifKR-Regular.woff2' },
  { name: '새돋움', file: '/fonts/NotoSansKR-Regular.woff2' },
  { name: '새바탕', file: '/fonts/NotoSerifKR-Regular.woff2' },
  { name: 'HY헤드라인M', file: '/fonts/NotoSansKR-Bold.woff2' },
  { name: 'HYHeadLine M', file: '/fonts/NotoSansKR-Bold.woff2' },
  { name: 'HYHeadLine Medium', file: '/fonts/NotoSansKR-Bold.woff2' },
  { name: 'HY견고딕', file: '/fonts/NotoSansKR-Bold.woff2' },
  { name: 'HYGothic-Extra', file: '/fonts/NotoSansKR-Bold.woff2' },
  { name: 'HY그래픽', file: '/fonts/NotoSansKR-Regular.woff2' },
  { name: 'HYGraphic-Medium', file: '/fonts/NotoSansKR-Regular.woff2' },
  { name: 'HY그래픽M', file: '/fonts/NotoSansKR-Regular.woff2' },
  { name: 'HY견명조', file: '/fonts/NotoSerifKR-Bold.woff2' },
  { name: 'HYMyeongJo-Extra', file: '/fonts/NotoSerifKR-Bold.woff2' },
  { name: 'HY신명조', file: '/fonts/NotoSerifKR-Regular.woff2' },
  { name: 'HY중고딕', file: '/fonts/NotoSansKR-Regular.woff2' },
  { name: '양재튼튼체B', file: '/fonts/NotoSansKR-Bold.woff2' },
  { name: 'Malgun Gothic', file: '/fonts/Pretendard-Regular.woff2' },
  { name: '맑은 고딕', file: '/fonts/Pretendard-Regular.woff2' },
  { name: '돋움', file: '/fonts/NotoSansKR-Regular.woff2' },
  { name: '돋움체', file: '/fonts/NotoSansKR-Regular.woff2' },
  { name: '굴림', file: '/fonts/NotoSansKR-Regular.woff2' },
  { name: '굴림체', file: '/fonts/D2Coding-Regular.woff2' },
  { name: '새굴림', file: '/fonts/NotoSansKR-Regular.woff2' },
  { name: '바탕', file: '/fonts/NotoSerifKR-Regular.woff2' },
  { name: '바탕체', file: '/fonts/D2Coding-Regular.woff2' },
  { name: '궁서', file: '/fonts/GowunBatang-Regular.woff2' },
  { name: '궁서체', file: '/fonts/GowunBatang-Regular.woff2' },
  { name: '새궁서', file: '/fonts/GowunBatang-Regular.woff2' },
  { name: '나눔고딕', file: '/fonts/NanumGothic-Regular.woff2' },
  { name: '나눔명조', file: '/fonts/NanumMyeongjo-Regular.woff2' },
  { name: '나눔고딕코딩', file: '/fonts/NanumGothicCoding-Regular.woff2' },
  { name: 'Palatino Linotype', file: '/fonts/NotoSerifKR-Regular.woff2' },
  { name: 'Noto Sans KR', file: '/fonts/NotoSansKR-Regular.woff2' },
  { name: 'Noto Serif KR', file: '/fonts/NotoSerifKR-Regular.woff2' },
  { name: 'Pretendard', file: '/fonts/Pretendard-Regular.woff2' },
  { name: 'Pretendard Thin', file: '/fonts/Pretendard-Thin.woff2' },
  { name: 'Pretendard ExtraLight', file: '/fonts/Pretendard-ExtraLight.woff2' },
  { name: 'Pretendard Light', file: '/fonts/Pretendard-Light.woff2' },
  { name: 'Pretendard Medium', file: '/fonts/Pretendard-Medium.woff2' },
  { name: 'Pretendard SemiBold', file: '/fonts/Pretendard-SemiBold.woff2' },
  { name: 'Pretendard Bold', file: '/fonts/Pretendard-Bold.woff2' },
  { name: 'Pretendard ExtraBold', file: '/fonts/Pretendard-ExtraBold.woff2' },
  { name: 'Pretendard Black', file: '/fonts/Pretendard-Black.woff2' },
  { name: 'D2Coding', file: '/fonts/D2Coding-Regular.woff2' },
  { name: '해피니스 산스 레귤러', file: '/fonts/Happiness-Sans-Regular.woff2' },
  { name: 'Happiness Sans Regular', file: '/fonts/Happiness-Sans-Regular.woff2' },
  { name: '해피니스 산스 볼드', file: '/fonts/Happiness-Sans-Bold.woff2' },
  { name: 'Happiness Sans Bold', file: '/fonts/Happiness-Sans-Bold.woff2' },
  { name: '해피니스 산스 타이틀', file: '/fonts/Happiness-Sans-Title.woff2' },
  { name: 'Happiness Sans Title', file: '/fonts/Happiness-Sans-Title.woff2' },
  { name: '해피니스 산스 VF', file: '/fonts/HappinessSansVF.woff2' },
  { name: 'Happiness Sans VF', file: '/fonts/HappinessSansVF.woff2' },
  { name: 'Cafe24 Ssurround Bold', file: '/fonts/Cafe24Ssurround-v2.0.woff2' },
  { name: '카페24 슈퍼매직', file: '/fonts/Cafe24Supermagic-Regular-v1.0.woff2' },
  { name: 'Cafe24 Supermagic', file: '/fonts/Cafe24Supermagic-Regular-v1.0.woff2' },
  { name: 'SpoqaHanSans', file: '/fonts/SpoqaHanSans-Regular.woff2' },
  { name: '고운바탕', file: '/fonts/GowunBatang-Regular.woff2' },
  { name: '고운돋움', file: '/fonts/GowunDodum-Regular.woff2' },
];

export const REGISTERED_FONTS = new Set(FONT_LIST.map((font) => font.name));

const CRITICAL_FONTS = new Set(['함초롬바탕', '함초롬돋움']);
const OS_FONT_CANDIDATES = [
  '맑은 고딕', 'Malgun Gothic', '바탕', 'Batang', '돋움', 'Dotum',
  '굴림', 'Gulim', '굴림체', 'GulimChe', '바탕체', 'BatangChe', '궁서', 'Gungsuh',
  'Apple SD Gothic Neo', 'AppleMyungjo', 'AppleGothic',
  'Noto Sans KR', 'Noto Serif KR',
];

let fontFaceRegistered = false;
const loadedFiles = new Set<string>();
const detectedOSFonts = new Set<string>();

export function getDetectedOSFonts(): ReadonlySet<string> {
  return detectedOSFonts;
}

export async function loadWebFonts(
  docFonts?: string[],
  onProgress?: (loaded: number, total: number) => void,
): Promise<void> {
  if (!fontFaceRegistered) {
    detectOSFonts();
    registerFontFaces();
    fontFaceRegistered = true;
  }

  const targetSet = new Set([...(docFonts ?? []), ...CRITICAL_FONTS]);
  const targetFonts = FONT_LIST.filter((font) => {
    if (!targetSet.has(font.name)) return false;
    return !detectedOSFonts.has(font.name);
  });
  const toLoad = uniqueFonts(targetFonts);

  if (toLoad.length === 0) return;

  const fileToNames = mapFontAliases(toLoad);
  let completed = 0;
  const total = toLoad.length;
  for (const font of toLoad) {
    try {
      for (const name of fileToNames.get(font.file) ?? [font.name]) {
        const face = new FontFace(name, `url("${font.file}") format("${font.format ?? 'woff2'}")`);
        document.fonts.add(await face.load());
      }
      loadedFiles.add(font.file);
    } catch {
      // Missing fonts degrade to CSS fallback families; document loading should continue.
    } finally {
      completed += 1;
      onProgress?.(completed, total);
    }
  }
}

function mapFontAliases(fontsToLoad: FontEntry[]): Map<string, string[]> {
  const aliases = new Map<string, string[]>();
  const filesToLoad = new Set(fontsToLoad.map((font) => font.file));
  for (const font of FONT_LIST) {
    if (!filesToLoad.has(font.file) || detectedOSFonts.has(font.name)) continue;
    const names = aliases.get(font.file) ?? [];
    names.push(font.name);
    aliases.set(font.file, names);
  }
  return aliases;
}

function detectOSFonts(): void {
  for (const name of OS_FONT_CANDIDATES) {
    try {
      if (document.fonts.check(`16px "${name}"`)) {
        detectedOSFonts.add(name);
      }
    } catch {
      // Font detection is best-effort only.
    }
  }
}

function registerFontFaces(): void {
  const style = document.createElement('style');
  style.textContent = FONT_LIST
    .map((font) => `@font-face { font-family: "${font.name}"; src: url("${font.file}") format("${font.format ?? 'woff2'}"); font-display: swap; }`)
    .join('\n');
  document.head.appendChild(style);
}

function uniqueFonts(fonts: FontEntry[]): FontEntry[] {
  const seenFiles = new Set<string>();
  const result: FontEntry[] = [];
  for (const font of fonts) {
    if (loadedFiles.has(font.file) || seenFiles.has(font.file)) continue;
    seenFiles.add(font.file);
    result.push(font);
  }
  return result;
}
