import { useEffect, useState } from 'react';
import { ChatProvider } from './hooks/useChatStore';
import Sidebar from './components/Sidebar';
import ChatView from './components/ChatView';

/** 主题持久化键名 */
const THEME_KEY = 'xm-theme';

/** 初始化主题：优先读取本地存储，否则跟随系统偏好 */
function initTheme(): boolean {
  if (typeof window === 'undefined') return false;
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === 'dark' || saved === 'light') return saved === 'dark';
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

/** 带 View Transitions 能力的 Document 类型 */
type DocumentWithVt = Document & {
  startViewTransition?: (cb: () => void) => { finished: Promise<void> };
};

export default function App() {
  // 侧边栏开合状态：桌面默认展开，移动端默认收起
  const [sidebarOpen, setSidebarOpen] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 768 : true,
  );
  // 暗色主题：应用到 <html> 的 .dark 类，并持久化
  const [dark, setDark] = useState(initTheme);

  useEffect(() => {
    // 挂载时按保存/系统偏好应用主题；之后每次切换保持同步（toggleTheme 内已同步置类，此处幂等）
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light');
  }, [dark]);

  /**
   * 切换主题（带动态过渡）：
   * - 支持 View Transitions：从点击位置 (x, y) 圆形展开新主题
   * - 不支持：短暂给全局加颜色过渡类后切换，视觉上平滑渐变
   */
  function toggleTheme(x?: number, y?: number) {
    const next = !dark;
    const root = document.documentElement;
    const apply = () => {
      root.classList.toggle('dark', next);
      setDark(next);
    };

    const doc = document as DocumentWithVt;
    if (typeof doc.startViewTransition === 'function') {
      // 记录展开圆心（未传坐标时默认视口中心）
      root.style.setProperty('--vt-x', `${x ?? window.innerWidth / 2}px`);
      root.style.setProperty('--vt-y', `${y ?? window.innerHeight / 2}px`);
      try {
        const vt = doc.startViewTransition(apply);
        void vt.finished.catch(() => {
          /* 切换被打断时无需处理 */
        });
        return;
      } catch {
        /* 罕见失败：走降级路径 */
      }
    }
    root.classList.add('theme-transition');
    apply();
    window.setTimeout(() => root.classList.remove('theme-transition'), 400);
  }

  return (
    <ChatProvider>
      <div className="flex h-full w-full overflow-hidden bg-[var(--page-bg)]">
        {/* 移动端抽屉遮罩 */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-30 bg-black/40 backdrop-blur-sm md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}
        <Sidebar
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          theme={dark ? 'dark' : 'light'}
          onToggleTheme={(x, y) => toggleTheme(x, y)}
        />
        <ChatView
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen((v) => !v)}
        />
      </div>
    </ChatProvider>
  );
}