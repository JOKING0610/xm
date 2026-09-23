import { useState } from 'react';
import { ChatProvider } from './hooks/useChatStore';
import Sidebar from './components/Sidebar';
import ChatView from './components/ChatView';

export default function App() {
  // 侧边栏开合状态：桌面默认展开，移动端默认收起
  const [sidebarOpen, setSidebarOpen] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 768 : true,
  );

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
        <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        <ChatView
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen((v) => !v)}
        />
      </div>
    </ChatProvider>
  );
}