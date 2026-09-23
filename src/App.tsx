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

export default function App() {
  // 侧边栏开合状态：桌面默认展开，移动端默认收起
  const [sidebarOpen, setSidebarOpen] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 768 : true,
  );
  // 暗色主题：应用到 <html> 的 .dark 类，并持久化
  const [dark, setDark] = useState(initTheme);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light');
  }, [dark]);

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
          onToggleTheme={() => setDark((v) => !v)}
        />
        <ChatView
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen((v) => !v)}
        />
      </div>
    </ChatProvider>
  );
}