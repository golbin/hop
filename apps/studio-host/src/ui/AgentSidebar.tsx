import React, { useState, useRef, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { ContextChips } from './components/ContextChips';
import { DiffViewer } from './components/DiffViewer';
import { TypoCard, type TypoInfo } from './components/TypoCard';
import { useLawSystem } from './hooks/useLawSystem';
import '../styles/agent-sidebar.css';

interface Message {
  id: string;
  text: string;
  isUser: boolean;
  proposedText?: string;
  originalText?: string;
  isApprovalPending?: boolean;
}

import { DesktopBridgeApi } from '../core/tauri-bridge';

interface AgentSidebarProps {
  bridge: DesktopBridgeApi;
  onDocumentChanged?: () => void;
}

interface CategorizedFiles {
  public: string[];
  internal: string[];
  plan: string[];
  result: string[];
  cooperation: string[];
  others: string[];
}

export const AgentSidebar: React.FC<AgentSidebarProps> = ({ bridge, onDocumentChanged }) => {
  const [activeTab, setActiveTab] = useState<'chat' | 'law'>('chat');
  
  // 법령 시스템 관련 상태
  const [lawQuery, setLawQuery] = useState('');
  const [articleQuery, setArticleQuery] = useState('');
  const [lawSearchResults, setLawSearchResults] = useState<string[]>([]);
  const [selectedLawPath, setSelectedLawPath] = useState<string | null>(null);
  const [searchedArticleText, setSearchedArticleText] = useState<string | null>(null);
  const [searchedArticleQuery, setSearchedArticleQuery] = useState('');
  const [verifiedLaws, setVerifiedLaws] = useState<any[]>([]);
  const [verifying, setVerifying] = useState(false);

  const [messages, setMessages] = useState<Message[]>([
    { id: '1', text: '안녕하세요! 성동구청 AI 행정 어시스턴트입니다.\n\n문서에 내용을 입력하거나 명령을 내리면 문서에 실시간으로 반영됩니다. ⚡ 자동 반영이 켜져 있습니다.', isUser: false }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [typos, setTypos] = useState<TypoInfo[]>([]);
  const [formattingStyle, setFormattingStyle] = useState<'bulleted' | 'sentence'>('bulleted');
  const [targetAudience, setTargetAudience] = useState<'public' | 'internal' | 'plan' | 'result' | 'cooperation' | 'others'>('internal');
  const { searchLaw, fetchArticle, verifyDocumentLaws, appendLawText } = useLawSystem(showToast);

  const [ragFolderPath, setRagFolderPath] = useState<string | null>(null);
  const [categorizedFiles, setCategorizedFiles] = useState<CategorizedFiles | null>(null);
  const [genDestination, setGenDestination] = useState<'new' | 'append'>('append');
  const [autoApply, setAutoApply] = useState(true); // 자동 반영 모드
  const [toast, setToast] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const auditTimerRef = useRef<number | null>(null);

  const showToast = (text: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToast({ text, type });
    window.setTimeout(() => setToast(null), 3500);
  };

  const scrollToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(scrollToBottom, [messages]);

  const handleLawSearch = async () => {
    if (!lawQuery.trim()) return;
    try {
      const paths = await searchLaw(lawQuery);
      setLawSearchResults(paths);
      if (paths.length > 0) setSelectedLawPath(paths[0]);
    } catch (e) {
      showToast(`검색 실패: ${e}`, 'error');
    }
  };

  const handleFetchArticle = async (path: string) => {
    try {
      const text = await fetchArticle(path, articleQuery);
      if (text) {
        setSearchedArticleText(text);
        let q = articleQuery.trim();
        if (!q.startsWith('제')) q = '제' + q;
        if (!q.endsWith('조')) q = q + '조';
        setSearchedArticleQuery(q);
      }
    } catch (e) {
      showToast(String(e), 'error');
      setSearchedArticleText(null);
    }
  };

  const handleVerifyDocumentLaws = async () => {
    setVerifying(true);
    try {
      const laws = await verifyDocumentLaws();
      setVerifiedLaws(laws);
      showToast(`문서 내 ${laws.length}개의 법령 인용을 분석했습니다.`, 'success');
    } catch (e) {
      showToast(`분석 실패: ${e}`, 'error');
    } finally {
      setVerifying(false);
    }
  };

  const handleAppendLawText = async (text: string) => {
    try {
      await appendLawText(text);
      onDocumentChanged?.();
    } catch (e) {
      showToast(`추가 실패: ${e}`, 'error');
    }
  };

  const handleInsertLawInline = async (text: string) => {
    try {
      const caret = bridge.getCaretPosition();
      const sec = caret?.sectionIndex ?? 0;
      const para = caret?.paragraphIndex ?? 0;
      const charOffset = caret?.charOffset ?? 0;
      await invoke('ai_edit_document', {
        mode: charOffset > 0 ? 'insert' : 'append',
        text: ` [참조: ${text.split('\n')[0].replace('#', '').trim()}]`,
        sec, para, charOffset
      });
      onDocumentChanged?.();
      showToast('✓ 법령 인용이 커서 위치에 삽입되었습니다.', 'success');
    } catch (e) {
      showToast(`삽입 실패: ${e}`, 'error');
    }
  };

  const handleInsertLawFootnote = async (text: string) => {
    try {
      const caret = bridge.getCaretPosition();
      const sec = caret?.sectionIndex ?? 0;
      const para = caret?.paragraphIndex ?? 0;
      const charOffset = caret?.charOffset ?? 0;
      
      const res = (bridge as any).insertFootnote(sec, para, charOffset);
      if (res && res.ok) {
        const cleanText = text.replace(/#/g, '').trim();
        (bridge as any).insertTextInFootnote(sec, para, res.controlIdx, 0, 0, cleanText);
        onDocumentChanged?.();
        showToast('✓ 각주가 정상적으로 삽입되었습니다.', 'success');
      } else {
        showToast('각주를 삽입할 수 없습니다. 문서에 포커스가 있는지 확인하세요.', 'error');
      }
    } catch (e) {
      showToast(`각주 삽입 실패: ${e}`, 'error');
    }
  };

  const handleStandardizeCitation = async (citation: string, lawName: string, officialText: string) => {
    try {
      const match = officialText.match(/#\s*(제?\d+조\s*\([^)]+\))/);
      const officialTitle = match ? match[1] : officialText.split('\n')[0].replace('#', '').trim();
      const standardized = `${lawName} ${officialTitle}`;
      
      await invoke('mutate_document', {
        docId: "active",
        operation: "replaceText",
        args: {
          findText: citation,
          replaceText: standardized
        }
      });
      onDocumentChanged?.();
      
      setVerifiedLaws(prev => prev.map(item => {
        if (item.citation === citation) {
          return { ...item, citation: standardized, status: 'verified' };
        }
        return item;
      }));
      
      showToast(`✓ 법령 명칭이 현행화되었습니다: ${standardized}`, 'success');
    } catch (e) {
      showToast(`현행화 실패: ${e}`, 'error');
    }
  };

  const handleQuickGenerate = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const modeName = {
        'public': '보도자료/홍보',
        'plan': '계획서(추진계획)',
        'internal': '내부 보고/검토',
        'result': '결과보고서',
        'cooperation': '협조 공문/발신'
      }[targetAudience];
      
      const prompt = `현재 문서의 내용을 바르게 파악하고, 이를 바탕으로 저장창고의 사례를 참고하여 최적의 [${modeName}] 초안 문서를 작성하고 [EDIT:append]로 문서 하단에 바로 추가해주세요.`;
      
      const response = await invoke<string>('chat_with_agent', { 
        userInput: prompt,
        stylePreference: formattingStyle,
        targetAudience: targetAudience
      });

      // [EDIT:append] 태그 감지 또는 PROPOSAL 감지
      const editMatch = response.match(/\[EDIT:append\]([\s\S]*?)\[\/EDIT\]/i);
      const proposalMatch = response.match(/\[PROPOSAL\]([\s\S]*?)\[\/PROPOSAL\]/i);
      const insertText = editMatch?.[1]?.trim() ?? proposalMatch?.[1]?.trim();

      if (insertText) {
        if (genDestination === 'append') {
          await invoke('ai_edit_document', { mode: 'append', text: insertText });
          onDocumentChanged?.();
          showToast('✓ 문서 하단에 반영됨', 'success');
        } else {
          // 새 창: 생성 후 내용은 채팅에 표시
          await invoke('create_editor_window');
          showToast('새 창이 열렸습니다. 아래 내용을 복사하여 사용하세요.', 'info');
        }
      }

      setMessages(prev => [...prev, 
        { id: Date.now().toString(), text: prompt, isUser: true },
        { id: (Date.now()+1).toString(), text: insertText ? `✓ 문서에 반영됨\n\n${response}` : response, isUser: false }
      ]);
    } catch (e) {
      console.error(e);
      showToast(`오류: ${e}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchRagStatus = async () => {
    try {
      const status = await invoke<any>('get_rag_status');
      if (status.categorized) {
        setCategorizedFiles(status.categorized);
      }
    } catch (e) {
      console.error('RAG status fetch failed', e);
    }
  };

  const handleRefreshRag = async () => {
    if (!ragFolderPath) return;
    setIsRefreshing(true);
    try {
      await invoke('set_rag_folder', { folderPath: ragFolderPath });
      await fetchRagStatus();
    } catch (e) {
      console.error('RAG refresh failed', e);
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    // 앱 시작 시 저장된 폴더 경로 UI 상태만 복원 (실제 RAG 초기화는 Rust setup에서 자동 수행)
    const initRag = async () => {
      try {
        const lastPath = await invoke<string | null>('query_document', { docId: "config", query: "get_last_rag_path", args: {} });
        if (lastPath) {
          setRagFolderPath(lastPath); // UI 상태만 업데이트, set_rag_folder 재호출 안 함
          fetchRagStatus();
        }
      } catch (e) { /* ignore */ }
    };
    initRag();
    const interval = setInterval(fetchRagStatus, 5000);

    // AI 편집 적용 이벤트 수신: 미리보기 온 시 문서 갱신 트리거
    const handleAiEditApplied = () => {
      onDocumentChanged?.();
    };
    window.addEventListener('hop:ai-edit-applied', handleAiEditApplied);

    let unlisten: any = null;

    const setupCommandListener = async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        unlisten = await listen<any>('hop-ai-command-trigger', async (event) => {
          const payload = event.payload; // { command, args }
          const command = payload.command;
          const args = payload.args || {};
          
          const caret = bridge.getCaretPosition();
          const sec = caret?.sectionIndex ?? 0;
          const para = caret?.paragraphIndex ?? 0;
          const charOffset = caret?.charOffset ?? 0;

          try {
            switch (command) {
              case 'align_paragraph': {
                const align = args.align || 'Center';
                await invoke('mutate_document', {
                  docId: 'active',
                  operation: 'applyParagraphShape',
                  args: { sec, para, align }
                });
                onDocumentChanged?.();
                showToast(`✓ 문단을 ${align} 정렬했습니다.`, 'success');
                break;
              }
              case 'insert_table': {
                const rows = Number(args.rows || 3);
                const cols = Number(args.cols || 3);
                (bridge as any).createTable(sec, para, charOffset, rows, cols);
                onDocumentChanged?.();
                showToast(`✓ 커서 위치에 ${rows}행 ${cols}열 표를 생성했습니다.`, 'success');
                break;
              }
              case 'font_style': {
                const bold = !!args.bold;
                const size = Number(args.size || 10);
                const props = { fontBold: bold, fontSize: size };
                (bridge as any).applyCharFormat(sec, para, charOffset, charOffset + 1, JSON.stringify(props));
                onDocumentChanged?.();
                showToast(`✓ 글자 스타일 변경 완료 (굵게: ${bold}, 크기: ${size})`, 'success');
                break;
              }
              case 'insert_footnote': {
                const text = args.text || '';
                const res = (bridge as any).insertFootnote(sec, para, charOffset);
                if (res && res.ok && text) {
                  (bridge as any).insertTextInFootnote(sec, para, res.controlIdx, 0, 0, text);
                }
                onDocumentChanged?.();
                showToast(`✓ 각주를 삽입했습니다.`, 'success');
                break;
              }
              case 'print': {
                await bridge.printCurrentWebview();
                showToast('✓ 인쇄 대화상자를 열었습니다.', 'success');
                break;
              }
              case 'adjust_window': {
                const layout = args.layout || 'default';
                await invoke('adjust_window_layout', { layout });
                showToast(`✓ 화면 레이아웃 변경 완료: ${layout}`, 'success');
                break;
              }
              default:
                console.warn('알 수 없는 HWP 동기화 제어 명령:', command);
            }
          } catch (err) {
            console.error('HWP 동기화 제어 명령 실행 실패:', err);
            showToast(`명령 실행 실패: ${err}`, 'error');
          }
        });
      } catch (err) {
        console.error('Failed to register command listener:', err);
      }
    };

    setupCommandListener();

    return () => {
      clearInterval(interval);
      window.removeEventListener('hop:ai-edit-applied', handleAiEditApplied);
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  // 실시간 오타 검증 로직 (Debounced)
  useEffect(() => {
    const handleDocChange = () => {
      if (auditTimerRef.current) window.clearTimeout(auditTimerRef.current);
      
      auditTimerRef.current = window.setTimeout(async () => {
        try {
          const text = await invoke<string>('query_document', {
            docId: "active",
            query: "getText",
            args: {}
          });
          if (text.length < 2) return;
          
          const results = await invoke<TypoInfo[]>('check_spelling', { text });
          setTypos(results);
        } catch (e) {
          console.error('Audit failed', e);
        }
      }, 1000); // 1초 데드타임
    };

    window.addEventListener('hop:document-changed', handleDocChange);
    return () => window.removeEventListener('hop:document-changed', handleDocChange);
  }, []);

  const handleSend = async () => {
    if (!input.trim() || loading) return;

    const userMsg: Message = { id: Date.now().toString(), text: input, isUser: true };
    setMessages(prev => [...prev, userMsg]);
    const currentInput = input;
    setInput('');
    setLoading(true);

    try {
      const response = await invoke<string>('chat_with_agent', { 
        userInput: currentInput,
        stylePreference: formattingStyle,
        targetAudience: targetAudience
      });
      
      // [EDIT:append], [EDIT:insert], [EDIT:replace] 태그 감지 → 자동 반영
      const editAppendMatch = response.match(/\[EDIT:append\]([\s\S]*?)\[\/EDIT\]/i);
      const editInsertMatch = response.match(/\[EDIT:insert\]([\s\S]*?)\[\/EDIT\]/i);
      const editReplaceMatch = response.match(/\[EDIT:replace\]([\s\S]*?)\[\/EDIT\]/i);
      // [PROPOSAL] 태그 감지 → 자동 반영 ON이면 즉시 적용
      const proposalMatch = response.match(/\[(?:수정제안|PROPOSAL)\]\s*([\s\S]*?)\s*\[\/(?:수정제안|PROPOSAL)\]/i);

      let appliedEdit = false;
      let displayResponse = response;

      if (editAppendMatch) {
        const insertText = editAppendMatch[1].trim();
        if (insertText) {
          try {
            await invoke('ai_edit_document', { mode: 'append', text: insertText });
            onDocumentChanged?.();
            appliedEdit = true;
            displayResponse = response
              .replace(/\[EDIT:append\][\s\S]*?\[\/EDIT\]/i, '')
              .trim();
            showToast('✓ 문서 하단에 내용이 반영되었습니다', 'success');
          } catch (e) {
            showToast(`문서 편집 실패: ${e}`, 'error');
          }
        }
      } else if (editInsertMatch) {
        const insertText = editInsertMatch[1].trim();
        if (insertText) {
          try {
            const caret = bridge.getCaretPosition();
            await invoke('ai_edit_document', {
              mode: 'insert',
              text: insertText,
              sec: caret?.sectionIndex ?? 0,
              para: caret?.paragraphIndex ?? 0,
              charOffset: caret?.charOffset ?? 0,
            });
            onDocumentChanged?.();
            appliedEdit = true;
            displayResponse = response
              .replace(/\[EDIT:insert\][\s\S]*?\[\/EDIT\]/i, '')
              .trim();
            showToast('✓ 커서 위치에 내용이 삽입되었습니다', 'success');
          } catch (e) {
            showToast(`삽입 실패: ${e}`, 'error');
          }
        }
      } else if (editReplaceMatch) {
        const replaceBlock = editReplaceMatch[1].trim();
        const parts = replaceBlock.split('→');
        const findText = parts[0]?.trim() || '';
        const replaceText = parts.length > 1 ? parts.slice(1).join('→').trim() : '';

        if (findText && replaceText) {
          try {
            await invoke('ai_edit_document', {
              mode: 'replace',
              text: replaceText,
              findText: findText
            });
            onDocumentChanged?.();
            appliedEdit = true;
            displayResponse = response
              .replace(/\[EDIT:replace\][\s\S]*?\[\/EDIT\]/i, '')
              .trim();
            showToast('✓ 지정한 텍스트가 교체되었습니다', 'success');
          } catch (e) {
            showToast(`교체 실패: ${e}`, 'error');
          }
        }
      } else if (autoApply && proposalMatch) {
        // 자동 반영 ON + PROPOSAL 태그 → 즉시 적용
        const proposedText = proposalMatch[1].trim();
        if (proposedText) {
          try {
            await invoke('ai_edit_document', { mode: 'append', text: proposedText });
            onDocumentChanged?.();
            appliedEdit = true;
            displayResponse = response
              .replace(/\[(?:수정제안|PROPOSAL)\][\s\S]*?\[\/(?:수정제안|PROPOSAL)\]/i, '')
              .trim();
            showToast('✓ 문서에 자동 반영되었습니다', 'success');
          } catch (e) {
            showToast(`자동 반영 실패 — 수동으로 적용하세요`, 'error');
          }
        }
      }

      // autoApply OFF일 때 + PROPOSAL 있으면 DiffViewer 유지
      const pendingProposal = (!autoApply && !appliedEdit && proposalMatch)
        ? proposalMatch[1].trim()
        : undefined;

      const currentDocText = (!autoApply && !appliedEdit && proposalMatch)
        ? await invoke<string>('query_document', { docId: "active", query: "getText", args: {} }).catch(() => "")
        : undefined;

      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        text: appliedEdit ? `✅ 내용이 문서에 반영되었습니다.${displayResponse ? '\n\n' + displayResponse : ''}` : displayResponse || response,
        isUser: false,
        proposedText: pendingProposal,
        originalText: currentDocText,
        isApprovalPending: !!pendingProposal
      }]);
    } catch (e) {
      setMessages(prev => [...prev, { id: 'err', text: `오류: ${e}`, isUser: false }]);
    } finally {
      setLoading(false);
    }
  };

  // Table Parsing Logic (reused from DiffViewer)
  const parseTableData = (text: string): {rows: number, cols: number} | null => {
    const jsonMatch = text.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      try {
        const data = JSON.parse(jsonMatch[0]);
        if (typeof data.text === 'string') {
          const rows = data.text.split('\n')
            .map(row => row.split(',').map(cell => cell.trim()))
            .filter(row => row.length > 0 && row.some(cell => cell !== ""));
          if (rows.length > 0 && rows[0].length > 0) {
            return { rows: rows.length, cols: rows[0].length };
          }
        }
        if (data.rows && data.cols) return { rows: Number(data.rows), cols: Number(data.cols) };
      } catch (e) { /* ignore */ }
    }

    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const mdRows = lines.filter(l => l.startsWith('|') && l.endsWith('|'));
    if (mdRows.length >= 2) {
      const rows = mdRows.filter(r => !r.match(/^\|[\s\-:|]+\|$/));
      if (rows.length > 0) {
        const firstRowCells = rows[0].split('|').filter((_, i, arr) => i > 0 && i < arr.length - 1);
        return { rows: rows.length, cols: firstRowCells.length };
      }
    }
    return null;
  };

  const handleApply = async (newText: string) => {
    try {
      const caret = bridge.getCaretPosition();
      const sec = caret?.sectionIndex ?? 0;
      const para = caret?.paragraphIndex ?? 0;
      const charOffset = caret?.charOffset ?? 0;

      let textToInsert = newText;
      let format: any = null;

      // 0. Parse potential JSON with formatting
      try {
        const parsed = JSON.parse(newText);
        if (parsed.text) {
          textToInsert = parsed.text;
          format = parsed.format;
        }
      } catch (e) { /* not JSON, use as plain text */ }

      // 1. Detect Tables
      const tableInfo = parseTableData(textToInsert);
      if (tableInfo) {
        await invoke('mutate_document', { 
          docId: "active", 
          operation: "insertTable", 
          args: { sec, para, charOffset, rows: tableInfo.rows, cols: tableInfo.cols }
        });
        onDocumentChanged?.();
        showToast('현재 커서 위치에 표가 생성되었습니다', 'success');
        setMessages(prev => prev.map(m => ({ ...m, proposedText: undefined })));
        return;
      }

      // 2. ai_edit_document로 예외 안전하게 삽입
      await invoke('ai_edit_document', {
        mode: charOffset > 0 ? 'insert' : 'append',
        text: textToInsert,
        sec, para, charOffset,
      });

      // 3. Apply Formatting if requested
      if (format) {
        if (format.bold || format.size) {
          await invoke('mutate_document', {
            docId: "active",
            operation: "applyCharacterShape",
            args: {
              sec, para, charOffset,
              length: textToInsert.length,
              fontBold: format.bold || false,
              fontSize: format.size || 10
            }
          });
        }
        if (format.align) {
          await invoke('mutate_document', {
            docId: "active",
            operation: "applyParagraphShape",
            args: { sec, para, align: format.align }
          });
        }
      }

      onDocumentChanged?.();
      showToast('✓ 문서에 반영되었습니다', 'success');
      setMessages(prev => prev.map(m => ({ ...m, proposedText: undefined })));
    } catch (e) {
      console.error('Apply failure:', e);
      try {
        await invoke('ai_edit_document', { mode: 'append', text: newText });
        onDocumentChanged?.();
        showToast('하단에 내용이 추가되었습니다', 'info');
        setMessages(prev => prev.map(m => ({ ...m, proposedText: undefined })));
      } catch (e2) {
        showToast(`반영 실패: ${e2}`, 'error');
      }
    }
  };

  const handleReclassify = async (fileName: string, targetCat: string) => {
    try {
      await invoke('reclassify_file', { filePath: fileName, targetCategory: targetCat });
      await fetchRagStatus();
    } catch (e) {
      console.error('Reclassification failed', e);
    }
  };

  const handleAddFileToCategory = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{
          name: '한글 문서',
          extensions: ['hwp', 'hwpx']
        }]
      });

      if (selected && typeof selected === 'string') {
        await invoke('reclassify_file', { filePath: selected, targetCategory: targetAudience });
        await fetchRagStatus();
      }
    } catch (e) {
      console.error('File add failed', e);
    }
  };

  const handleSelectFolder = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: '행정 계획서 및 참고자료 폴더 선택'
      });
      
      if (selected && typeof selected === 'string') {
        await invoke('set_rag_folder', { folderPath: selected });
        setRagFolderPath(selected);
        showToast(`'${selected.split('\\').pop()}' 폴더가 지식창고로 설정되었습니다.`, 'success');
      }
    } catch (e) {
      console.error('Folder selection failed', e);
    }
  };

  return (
    <div className="agent-sidebar">
      <div className="as-header">
        <div className="as-title">
          <span style={{fontSize: '1.2rem'}}>✨</span>
          <span>성동구 AI 행정 어시스턴트</span>
        </div>
        <div className="as-style-toggle">
          <button 
            className="as-style-btn"
            onClick={handleSelectFolder}
            title="참고 자료 폴더 설정"
          >
            📁 {ragFolderPath ? ragFolderPath.split('\\').pop() : '폴더 설정'}
          </button>
          {ragFolderPath && (
            <button 
              className={`as-refresh-btn ${isRefreshing ? 'spinning' : ''}`}
              onClick={handleRefreshRag}
              title="강제 재색인"
              disabled={isRefreshing}
            >
              🔄
            </button>
          )}
          <div className="as-status-indicator" style={{
            background: isRefreshing ? '#f1c40f' : '#2ecc71',
            padding: '2px 8px',
            borderRadius: '10px',
            fontSize: '0.7rem',
            color: '#fff',
            fontWeight: 'bold',
            marginLeft: 'auto'
          }}>
            {isRefreshing ? '색인 중...' : `연결됨 (${
              categorizedFiles ? Object.values(categorizedFiles).flat().length : 0
            })`}
          </div>
          <button 
            className={`as-style-btn ${formattingStyle === 'bulleted' ? 'active' : ''}`}
            onClick={() => setFormattingStyle('bulleted')}
            title="개조식"
          >
            개조식
          </button>
          <button 
            className={`as-style-btn ${formattingStyle === 'sentence' ? 'active' : ''}`}
            onClick={() => setFormattingStyle('sentence')}
            title="문장식"
          >
            문장식
          </button>
        </div>
      </div>

      {/* ── 탭 스위처 추가 ────────────────────────────── */}
      <div className="as-tabs">
        <button 
          className={`as-tab-btn ${activeTab === 'chat' ? 'active' : ''}`}
          onClick={() => setActiveTab('chat')}
        >
          🤖 AI 행정 비서
        </button>
        <button 
          className={`as-tab-btn ${activeTab === 'law' ? 'active' : ''}`}
          onClick={() => setActiveTab('law')}
        >
          ⚖️ 법령 시스템
        </button>
      </div>

      {activeTab === 'chat' ? (
        <>
          <div className="as-audience-bar">
            <div className="as-audience-chips">
              <button 
                className={`as-chip-btn ${targetAudience === 'public' ? 'active' : ''}`}
                onClick={() => setTargetAudience('public')}
              >
                📢 보도/홍보
              </button>
              <button 
                className={`as-chip-btn ${targetAudience === 'plan' ? 'active' : ''}`}
                onClick={() => setTargetAudience('plan')}
              >
                📝 계획서
              </button>
              <button 
                className={`as-chip-btn ${targetAudience === 'internal' ? 'active' : ''}`}
                onClick={() => setTargetAudience('internal')}
              >
                📋 내부보고
              </button>
              <button 
                className={`as-chip-btn ${targetAudience === 'result' ? 'active' : ''}`}
                onClick={() => setTargetAudience('result')}
              >
                ✅ 결과보고
              </button>
              <button 
                className={`as-chip-btn ${targetAudience === 'cooperation' ? 'active' : ''}`}
                onClick={() => setTargetAudience('cooperation')}
              >
                🤝 협조공문
              </button>
              <button 
                className={`as-chip-btn ${targetAudience === 'others' ? 'active' : ''}`}
                onClick={() => setTargetAudience('others')}
              >
                📁 기타
              </button>
            </div>
          </div>

          {categorizedFiles && (
            <div className="as-categorized-browser">
              <div className="as-cb-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  🔍 {{
                    'public': '보도자료/홍보',
                    'plan': '계획서/추진계획',
                    'internal': '보고/기획/검토',
                    'result': '결과보고서',
                    'cooperation': '공문/협조',
                    'others': '기본/미분류'
                  }[targetAudience]} 참조 문서 ({
                    categorizedFiles[targetAudience]?.length || 0
                  })
                </div>
                <button 
                  className="as-add-ref-btn"
                  onClick={handleAddFileToCategory}
                  title="이 분류에 파일 강제 참조"
                  style={{
                    padding: '2px 8px',
                    fontSize: '0.7rem',
                    borderRadius: '4px',
                    border: '1px solid var(--as-accent)',
                    background: 'transparent',
                    color: 'var(--as-accent)',
                    cursor: 'pointer'
                  }}
                >
                  ➕ 파일 추가
                </button>
              </div>
              <div className="as-cb-list">
                {(categorizedFiles[targetAudience] || []).map((file, idx) => (
                  <div key={idx} className="as-cb-item" title={file}>
                    <div className="as-cb-content">
                      <span className="as-cb-icon">📄</span>
                      <span className="as-cb-name">{file}</span>
                    </div>
                    <div className="as-cb-item-actions">
                      <select 
                        className="as-move-select"
                        value={targetAudience}
                        onChange={(e) => handleReclassify(file, e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <option value="public">📢 보도</option>
                        <option value="plan">📝 계획</option>
                        <option value="internal">📋 내부</option>
                        <option value="result">✅ 결과</option>
                        <option value="cooperation">🤝 협조</option>
                      </select>
                    </div>
                  </div>
                ))}
                {(!categorizedFiles[targetAudience] || categorizedFiles[targetAudience].length === 0) && (
                  <div className="as-cb-empty">해당 분류의 문서를 찾을 수 없습니다.</div>
                )}
              </div>
            </div>
          )}

          {/* New: Immediate Document Generation Bar */}
          <div className="as-quick-gen-bar">
            <div className="as-qg-options">
              <label className="as-qg-label">생성 위치:</label>
              <select 
                className="as-qg-select"
                value={genDestination}
                onChange={(e) => setGenDestination(e.target.value as 'new' | 'append')}
              >
                <option value="new">🆕 새 창으로</option>
                <option value="append">⬇️ 문서 하단에</option>
              </select>
            </div>
            <label style={{ fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
              <input type="checkbox" checked={autoApply} onChange={e => setAutoApply(e.target.checked)} />
              AI 자동 반영
            </label>
            <button 
              className="as-qg-btn" 
              disabled={loading}
              onClick={handleQuickGenerate}
            >
              ⚡ 즉시 문서 초안 생성
            </button>
          </div>

          <ContextChips />

          {typos.length > 0 && (
            <div className="as-alerts" style={{padding: '10px 16px', background: 'rgba(231, 76, 60, 0.05)', borderBottom: '1px solid var(--as-border)'}}>
              <div style={{fontSize: '0.8rem', fontWeight: 'bold', marginBottom: '8px', color: '#e74c3c'}}>⚠️ 실시간 교열 알림 ({typos.length})</div>
              <div style={{display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '150px', overflowY: 'auto'}}>
                {typos.map((typo, idx) => (
                  <TypoCard key={idx} typo={typo} onFixed={() => setTypos(prev => prev.filter((_, i) => i !== idx))} />
                ))}
              </div>
            </div>
          )}

          <div className="as-chat-area">
            {messages.map(msg => (
              <div key={msg.id} className={`as-msg ${msg.isUser ? 'as-msg-user' : 'as-msg-bot'}`}>
                <div className="as-msg-text">
                  {msg.text}
                  {msg.proposedText && (
                    <div className="as-approval-zone" style={{ display: 'block', visibility: 'visible', opacity: 1, minHeight: '100px' }}>
                      <div className="as-approval-header">
                        ⚖️ 교정 제안 승인 대기 (내용 길이: {msg.proposedText.length})
                      </div>
                      <div className="as-diff-container">
                        <DiffViewer 
                          oldText={msg.originalText || ""} 
                          newText={msg.proposedText} 
                          onApply={() => handleApply(msg.proposedText!)}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {loading && <div className="as-msg as-msg-bot"><span className="as-typing">문서 분석 중…</span></div>}
            <div ref={chatEndRef} />
          </div>

          <div className="as-input-area">
            <input 
              className="as-input"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSend()}
              placeholder={autoApply ? '명령하면 문서에 즉시 반영됩니다...' : '행정 업무를 지시하세요...'}
            />
            <button className="as-send-btn" onClick={handleSend} disabled={loading}>➤</button>
          </div>
        </>
      ) : (
        <div className="as-law-panel">
          {/* 법령 실시간 검증 섹션 */}
          <div className="as-law-section">
            <div className="as-law-section-title">🔍 실시간 문서 내 법령 검증 & 현행화</div>
            <button 
              className="as-verify-trigger-btn"
              disabled={verifying}
              onClick={handleVerifyDocumentLaws}
            >
              {verifying ? '문서 분석 및 법령 검증 중...' : '⚡ 문서 내 법령 인용 분석 및 검증'}
            </button>
            
            <div style={{ marginTop: '12px' }}>
              {verifiedLaws.length === 0 ? (
                <div style={{ fontSize: '0.8rem', color: '#7f8c8d', fontStyle: 'italic', textAlign: 'center', padding: '12px' }}>
                  발견된 법령 인용이 없거나 아직 분석을 수행하지 않았습니다. (예: "형법 제347조" 등이 본문에 포함되어야 합니다)
                </div>
              ) : (
                <div className="as-verify-list">
                  {verifiedLaws.map((item, idx) => (
                    <div key={idx} className={`as-verify-card status-${item.status === 'verified' ? 'verified' : item.status === 'not_found' ? 'not-found' : 'mismatch'}`}>
                      <div className="as-verify-header">
                        <span className="as-verify-title">{item.citation}</span>
                        <span className={`as-verify-badge badge-${item.status === 'verified' ? 'verified' : item.status === 'not_found' ? 'not-found' : 'mismatch'}`}>
                          {item.status === 'verified' ? '검증 완료' : item.status === 'not_found' ? '미등록 법령' : '확인 필요'}
                        </span>
                      </div>
                      
                      {item.context && (
                        <div className="as-verify-context" title={item.context}>
                          문맥: "{item.context}"
                        </div>
                      )}
                      
                      {item.officialText ? (
                        <>
                          <div className="as-verify-body">
                            {item.officialText}
                          </div>
                          <div className="as-law-article-actions" style={{ marginTop: '8px' }}>
                            <button 
                              className="as-law-action-btn"
                              onClick={() => handleStandardizeCitation(item.citation, item.lawName, item.officialText)}
                            >
                              ⚡ 명칭 현행화
                            </button>
                            <button 
                              className="as-law-action-btn as-law-action-btn-primary"
                              onClick={() => handleInsertLawFootnote(item.officialText)}
                            >
                              📝 각주 삽입
                            </button>
                          </div>
                        </>
                      ) : (
                        <div style={{ fontSize: '0.75rem', color: '#e74c3c', marginTop: '6px' }}>
                          이 법령 조문 정보를 온라인에서 조회할 수 없습니다. 명칭이나 조 번호를 확인하세요.
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 통합 법령 검색 섹션 */}
          <div className="as-law-section">
            <div className="as-law-section-title">📖 대한민국 통합 법령 검색</div>
            <div className="as-law-search-box">
              <div className="as-law-search-row">
                <input 
                  className="as-law-input"
                  placeholder="법령명 (예: 형법, 민법)"
                  value={lawQuery}
                  onChange={e => setLawQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleLawSearch()}
                />
                <button className="as-law-search-btn" onClick={handleLawSearch}>검색</button>
              </div>
              
              {lawSearchResults.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '4px' }}>
                  <label style={{ fontSize: '0.75rem', fontWeight: 600 }}>매칭된 법령 선택:</label>
                  <select 
                    className="as-qg-select"
                    value={selectedLawPath || ''}
                    onChange={e => {
                      setSelectedLawPath(e.target.value);
                      setSearchedArticleText(null);
                    }}
                  >
                    {lawSearchResults.map((path, idx) => (
                      <option key={idx} value={path}>
                        {path.replace('kr/', '').replace('.md', '')}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="as-law-search-row" style={{ marginTop: '8px' }}>
                <input 
                  className="as-law-input"
                  placeholder="조 번호 (예: 347 또는 제347조)"
                  value={articleQuery}
                  onChange={e => setArticleQuery(e.target.value)}
                  disabled={!selectedLawPath}
                  onKeyDown={e => e.key === 'Enter' && selectedLawPath && handleFetchArticle(selectedLawPath)}
                />
                <button 
                  className="as-law-search-btn" 
                  onClick={() => selectedLawPath && handleFetchArticle(selectedLawPath)}
                  disabled={!selectedLawPath}
                >
                  조문 조회
                </button>
              </div>
            </div>

            {searchedArticleText && (
              <div className="as-law-article-view" style={{ marginTop: '12px' }}>
                <div className="as-law-article-title">
                  ⚖️ {selectedLawPath?.replace('kr/', '').replace('.md', '')} {searchedArticleQuery}
                </div>
                <div className="as-law-article-body">
                  {searchedArticleText}
                </div>
                <div className="as-law-article-actions">
                  <button 
                    className="as-law-action-btn"
                    onClick={() => handleInsertLawInline(searchedArticleText)}
                  >
                    ⚡ 본문 삽입
                  </button>
                  <button 
                    className="as-law-action-btn as-law-action-btn-primary"
                    onClick={() => handleInsertLawFootnote(searchedArticleText)}
                  >
                    📝 각주 삽입
                  </button>
                  <button 
                    className="as-law-action-btn"
                    onClick={() => handleAppendLawText(searchedArticleText)}
                  >
                    ⬇️ 하단 추가
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 인라인 토스트 */}
      {toast && (
        <div className="as-toast" style={{
          background: toast.type === 'success' ? '#2ecc71' : toast.type === 'error' ? '#e74c3c' : '#3498db',
        }}>
          {toast.text}
        </div>
      )}
    </div>
  );
};
